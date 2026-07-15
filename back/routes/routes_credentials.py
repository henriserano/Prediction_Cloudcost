"""Per-user encrypted credentials store.

Each mutating call requires the PIN in the body: we use it to unwrap the KEK
sitting on the user row, then AES-GCM (de)crypt the payload. The server
never persists the PIN or the raw KEK; both live only for the duration of
the request.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Annotated

from boto3.dynamodb.conditions import Key
from fastapi import APIRouter, Depends

from core.auth import require_api_key
from core.aws_session import activate_user_aws, deactivate_user_aws, is_active
from core.azure_session import (
    activate_user_azure,
    deactivate_user_azure,
)
from core.azure_session import (
    is_active as azure_is_active,
)
from core.credentials_flow import (
    CredentialsProvider,
    activate_from_payload,
)
from core.credentials_flow import (
    register as register_provider,
)
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

# ---------------------------------------------------------------------------
# Register the AWS + Azure activation recipes in the shared flow registry.
# Adding a fourth provider from now on is one register_provider(...) call —
# no new route file, no copy-pasted 30-line helper.
# ---------------------------------------------------------------------------
register_provider(
    CredentialsProvider(
        name="aws",
        field_map={
            "access_key_id": ("access_key_id", "AWS_ACCESS_KEY_ID"),
            "secret_access_key": ("secret_access_key", "AWS_SECRET_ACCESS_KEY"),
            "region": ("region", "AWS_REGION"),
            "session_token": ("session_token", "AWS_SESSION_TOKEN"),
        },
        required=("access_key_id", "secret_access_key"),
        activate=activate_user_aws,
        optional_defaults={"region": "eu-west-1"},
    )
)
register_provider(
    CredentialsProvider(
        name="azure",
        field_map={
            "tenant_id": ("tenant_id", "AZURE_TENANT_ID"),
            "client_id": ("client_id", "AZURE_CLIENT_ID"),
            "client_secret": ("client_secret", "AZURE_CLIENT_SECRET"),
            "subscription_id": ("subscription_id", "AZURE_SUBSCRIPTION_ID"),
            "location": ("location", "AZURE_LOCATION"),
            "display_name": ("display_name",),
        },
        required=("tenant_id", "client_id", "client_secret"),
        activate=activate_user_azure,
        optional_defaults={"location": "westeurope"},
    )
)

# SEC-016: cap decrypted credential blobs before json.loads() to defeat DoS via
# deeply nested / gigantic ciphertexts. A well-formed Service Principal payload
# is < 2 KB; 16 KB leaves generous headroom for legitimate multi-field payloads
# without risking a stack overflow on json.loads().
_MAX_DECRYPTED_PAYLOAD_BYTES = 16 * 1024


def _safe_json_loads(plaintext: str, provider: str) -> dict:
    """Parse a decrypted credential blob, refusing oversized payloads.

    Raises Unauthorized on both size overrun and JSON errors — a client with a
    valid PIN and a corrupted-or-tampered ciphertext should never see the
    distinction (avoid tampering oracle).
    """
    if len(plaintext.encode("utf-8")) > _MAX_DECRYPTED_PAYLOAD_BYTES:
        logger.warning(
            "credential_payload_oversized",
            extra={"provider": provider, "size": len(plaintext)},
        )
        raise Unauthorized("Corrupted credential payload.")
    try:
        parsed = json.loads(plaintext)
    except json.JSONDecodeError:
        raise Unauthorized("Corrupted credential payload.") from None
    if not isinstance(parsed, dict):
        raise Unauthorized("Corrupted credential payload.")
    return parsed


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

    now = datetime.now(tz=UTC).isoformat()
    existing = (
        credentials_table().get_item(Key={"user_id": user_id, "provider": provider}).get("Item")
    )
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

    # AWS / Azure: activate the in-memory session cache so the corresponding
    # /api/aws/* or /api/azure/* endpoints immediately return this user's data
    # without a second unlock round-trip.
    activate_from_payload(provider, user_id, body.payload)
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

    item = credentials_table().get_item(Key={"user_id": user_id, "provider": provider}).get("Item")
    if not item:
        raise NotFound(f"No credentials stored for provider '{provider}'")

    plaintext = decrypt_with_kek(
        kek,
        EncryptedBlob(ciphertext_b64=item["ciphertext"], nonce_b64=item["nonce"]),
        associated_data=provider.encode("ascii"),
    )
    if plaintext is None:
        raise Unauthorized("Failed to decrypt credentials — was the PIN rotated?")
    payload = _safe_json_loads(plaintext, provider)

    # Same convenience as PUT: seed the session cache on reveal so the
    # caller can immediately hit /api/aws/* or /api/azure/* without a second dance.
    activate_from_payload(provider, user_id, payload)

    return CredentialRevealResponse(provider=provider, payload=payload)


@router.post(
    "/aws/activate",
    summary="Decrypt stored AWS creds and cache them in-memory for the session",
)
def activate_aws(
    body: CredentialReveal,
    user_id: Annotated[str, Depends(require_current_user_id)],
) -> dict:
    """Same as /reveal but without returning the plaintext to the client.

    Used after a page reload: the front asks for the PIN, the server unlocks
    the AES-GCM blob, and holds a boto3.Session in memory for /api/aws/*
    calls. No keys ever hit the browser.
    """
    user = _load_user_or_401(user_id)
    kek = _unwrap_or_401(user, body.pin)

    item = credentials_table().get_item(Key={"user_id": user_id, "provider": "aws"}).get("Item")
    if not item:
        raise NotFound("No AWS credentials stored for this user.")

    plaintext = decrypt_with_kek(
        kek,
        EncryptedBlob(ciphertext_b64=item["ciphertext"], nonce_b64=item["nonce"]),
        associated_data=b"aws",
    )
    if plaintext is None:
        raise Unauthorized("Failed to decrypt AWS credentials.")
    payload = _safe_json_loads(plaintext, "aws")

    activate_from_payload("aws", user_id, payload)
    return {"activated": True, "provider": "aws"}


@router.get(
    "/aws/status",
    summary="Whether the current user's AWS session is unlocked in memory",
)
def aws_activation_status(
    user_id: Annotated[str, Depends(require_current_user_id)],
) -> dict:
    return {"active": is_active(user_id)}


@router.post(
    "/aws/deactivate",
    summary="Drop the in-memory AWS session for the current user",
)
def deactivate_aws(
    user_id: Annotated[str, Depends(require_current_user_id)],
) -> dict:
    deactivate_user_aws(user_id)
    return {"active": False}


@router.post(
    "/azure/activate",
    summary="Decrypt stored Azure creds and cache them in-memory for the session",
    dependencies=[Depends(require_api_key)],
)
def activate_azure(
    body: CredentialReveal,
    user_id: Annotated[str, Depends(require_current_user_id)],
) -> dict:
    """Same as /reveal for Azure but without returning the plaintext."""
    user = _load_user_or_401(user_id)
    kek = _unwrap_or_401(user, body.pin)

    item = credentials_table().get_item(Key={"user_id": user_id, "provider": "azure"}).get("Item")
    if not item:
        raise NotFound("No Azure credentials stored for this user.")

    plaintext = decrypt_with_kek(
        kek,
        EncryptedBlob(ciphertext_b64=item["ciphertext"], nonce_b64=item["nonce"]),
        associated_data=b"azure",
    )
    if plaintext is None:
        raise Unauthorized("Failed to decrypt Azure credentials.")
    payload = _safe_json_loads(plaintext, "azure")

    activate_from_payload("azure", user_id, payload)
    return {"activated": True, "provider": "azure"}


@router.get(
    "/azure/status",
    summary="Whether the current user's Azure session is unlocked in memory",
    dependencies=[Depends(require_api_key)],
)
def azure_activation_status(
    user_id: Annotated[str, Depends(require_current_user_id)],
) -> dict:
    return {"active": azure_is_active(user_id)}


@router.post(
    "/azure/deactivate",
    summary="Drop the in-memory Azure session for the current user",
    dependencies=[Depends(require_api_key)],
)
def deactivate_azure(
    user_id: Annotated[str, Depends(require_current_user_id)],
) -> dict:
    deactivate_user_azure(user_id)
    return {"active": False}


@router.delete("/{provider}", summary="Forget stored credentials for one provider")
def delete(
    provider: Provider,
    user_id: Annotated[str, Depends(require_current_user_id)],
) -> dict:
    credentials_table().delete_item(Key={"user_id": user_id, "provider": provider})
    return {"provider": provider, "deleted": True}
