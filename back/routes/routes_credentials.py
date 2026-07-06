"""Per-user encrypted credentials store.

Each mutating call requires the PIN in the body: we use it to unwrap the KEK
sitting on the user row, then AES-GCM (de)crypt the payload. The server
never persists the PIN or the raw KEK; both live only for the duration of
the request.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Annotated

from boto3.dynamodb.conditions import Key
from fastapi import APIRouter, Depends

from core.crypto import (
    EncryptedBlob,
    WrappedKek,
    decrypt_with_kek,
    encrypt_with_kek,
    unwrap_kek,
    verify_pin,
)
from core.dynamo import credentials_table, users_table
from core.errors import BadRequest, NotFound, Unauthorized
from core.logging import get_logger
from core.session import require_current_user_id
from schemas.credentials import (
    CredentialMetadata,
    CredentialReveal,
    CredentialRevealResponse,
    CredentialUpsert,
    Provider,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/api/credentials", tags=["credentials"])


def _load_user_or_401(user_id: str) -> dict:
    item = users_table().get_item(Key={"user_id": user_id}).get("Item")
    if not item:
        raise Unauthorized("User no longer exists")
    return item


def _unwrap_or_401(user: dict, pin: str) -> bytes:
    if not verify_pin(pin, user["pin_hash"]):
        raise Unauthorized("PIN incorrect.")
    kek = unwrap_kek(
        pin,
        WrappedKek(
            ciphertext_b64=user["kek_ciphertext"],
            nonce_b64=user["kek_nonce"],
            salt_b64=user["kek_salt"],
        ),
    )
    if kek is None:
        # PIN matched the Argon2 hash but the wrapped KEK didn't open —
        # means the user record is corrupted or PIN was rotated without
        # rewrapping. Refuse rather than "recover" silently.
        raise Unauthorized("Unable to unlock credential store.")
    return kek


@router.get("", summary="List providers with stored credentials for the current user")
def list_(user_id: Annotated[str, Depends(require_current_user_id)]) -> dict:
    resp = credentials_table().query(
        KeyConditionExpression=Key("user_id").eq(user_id),
    )
    items = resp.get("Items", [])
    metas = [
        CredentialMetadata(
            provider=it["provider"],
            label=it.get("label"),
            created_at=datetime.fromisoformat(it["created_at"]),
            updated_at=datetime.fromisoformat(it["updated_at"]),
        ).model_dump(mode="json")
        for it in items
    ]
    return {"credentials": metas}


@router.put(
    "/{provider}",
    response_model=CredentialMetadata,
    summary="Store (or replace) credentials for a provider",
)
def upsert(
    provider: Provider,
    body: CredentialUpsert,
    user_id: Annotated[str, Depends(require_current_user_id)],
) -> CredentialMetadata:
    if body.provider != provider:
        raise BadRequest("provider in body does not match URL")

    user = _load_user_or_401(user_id)
    kek = _unwrap_or_401(user, body.pin)

    plaintext = json.dumps(body.payload, ensure_ascii=False)
    blob = encrypt_with_kek(kek, plaintext, associated_data=provider.encode("ascii"))

    now = datetime.now(tz=timezone.utc).isoformat()
    existing = credentials_table().get_item(
        Key={"user_id": user_id, "provider": provider}
    ).get("Item")
    created_at = existing["created_at"] if existing else now

    credentials_table().put_item(
        Item={
            "user_id": user_id,
            "provider": provider,
            "label": body.label,
            "ciphertext": blob.ciphertext_b64,
            "nonce": blob.nonce_b64,
            "created_at": created_at,
            "updated_at": now,
        }
    )
    logger.info(
        "credential_upserted",
        extra={"user_id": user_id, "provider": provider},
    )
    return CredentialMetadata(
        provider=provider,
        label=body.label,
        created_at=datetime.fromisoformat(created_at),
        updated_at=datetime.fromisoformat(now),
    )


@router.post(
    "/{provider}/reveal",
    response_model=CredentialRevealResponse,
    summary="Decrypt and return the raw payload for one provider",
)
def reveal(
    provider: Provider,
    body: CredentialReveal,
    user_id: Annotated[str, Depends(require_current_user_id)],
) -> CredentialRevealResponse:
    user = _load_user_or_401(user_id)
    kek = _unwrap_or_401(user, body.pin)

    item = credentials_table().get_item(
        Key={"user_id": user_id, "provider": provider}
    ).get("Item")
    if not item:
        raise NotFound(f"No credentials stored for provider '{provider}'")

    plaintext = decrypt_with_kek(
        kek,
        EncryptedBlob(ciphertext_b64=item["ciphertext"], nonce_b64=item["nonce"]),
        associated_data=provider.encode("ascii"),
    )
    if plaintext is None:
        raise Unauthorized("Failed to decrypt credentials — was the PIN rotated?")
    try:
        payload = json.loads(plaintext)
    except json.JSONDecodeError:
        raise Unauthorized("Corrupted credential payload")
    return CredentialRevealResponse(provider=provider, payload=payload)


@router.delete("/{provider}", summary="Forget stored credentials for one provider")
def delete(
    provider: Provider,
    user_id: Annotated[str, Depends(require_current_user_id)],
) -> dict:
    credentials_table().delete_item(Key={"user_id": user_id, "provider": provider})
    return {"provider": provider, "deleted": True}
