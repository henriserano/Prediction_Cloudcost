"""Auth endpoints for the POC identity layer.

Threat model reminder (see back/core/crypto.py docstring for details):
- Nom + PIN 6 chiffres = identification POC. Argon2 slows offline attacks
  but a determined attacker still cracks 10^6 PINs.
- Session is a JWT in an httpOnly cookie. Not CSRF-protected yet — mutating
  endpoints still rely on the ``X-API-Key`` header, and the frontend proxies
  through Next.js so cross-site POSTs need CORS to succeed.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response

from core.config import get_settings
from core.crypto import create_wrapped_kek, hash_pin, verify_pin
from core.dynamo import users_table, credentials_table
from core.errors import AppError, BadRequest, Unauthorized
from core.logging import get_logger
from core.session import get_current_user_id, issue_session, require_current_user_id
from schemas.auth import AuthResponse, LoginRequest, SignupRequest, UserPublic

logger = get_logger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(name: str) -> str:
    slug = _SLUG_RE.sub("-", name.lower()).strip("-")
    if not slug:
        raise BadRequest("display_name contains no usable characters")
    return slug[:64]


def _set_session_cookie(response: Response, user_id: str) -> None:
    settings = get_settings()
    token = issue_session(user_id)
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=settings.session_ttl_hours * 3600,
        httponly=True,
        secure=(settings.env == "prod"),
        samesite="lax",
        path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(
        key=settings.session_cookie_name,
        path="/",
        httponly=True,
        samesite="lax",
        secure=(settings.env == "prod"),
    )


def _has_credentials(user_id: str) -> bool:
    """Return True when the user has at least one credential row.
    Best-effort: on DynamoDB errors we assume False rather than 500 the caller.
    """
    try:
        from boto3.dynamodb.conditions import Key

        resp = credentials_table().query(
            KeyConditionExpression=Key("user_id").eq(user_id),
            Limit=1,
            Select="COUNT",
        )
        return int(resp.get("Count", 0)) > 0
    except Exception as exc:
        logger.warning("has_credentials_probe_failed", extra={"error": repr(exc)})
        return False


def _to_public(item: dict) -> UserPublic:
    return UserPublic(
        user_id=item["user_id"],
        display_name=item.get("display_name", item["user_id"]),
        created_at=datetime.fromisoformat(item["created_at"]),
        has_credentials=_has_credentials(item["user_id"]),
    )


@router.post("/signup", response_model=AuthResponse, summary="Create account or log in with existing PIN")
def signup(body: SignupRequest, response: Response) -> AuthResponse:
    """Idempotent: creating twice with the same PIN just logs you in.

    We collapse signup + login on purpose — the POC flow is "type your name
    and PIN, land in the app". A separate login exists for the case where
    the frontend already knows the user exists (nicer error messages).
    """
    user_id = _slugify(body.display_name)
    table = users_table()

    existing = table.get_item(Key={"user_id": user_id}).get("Item")
    is_new = False

    if existing:
        if not verify_pin(body.pin, existing["pin_hash"]):
            raise Unauthorized("Ce nom est déjà pris. PIN incorrect.")
        item = existing
    else:
        wrapped, _raw_kek = create_wrapped_kek(body.pin)
        now = datetime.now(tz=timezone.utc).isoformat()
        item = {
            "user_id": user_id,
            "display_name": body.display_name,
            "created_at": now,
            "pin_hash": hash_pin(body.pin),
            "kek_ciphertext": wrapped.ciphertext_b64,
            "kek_nonce": wrapped.nonce_b64,
            "kek_salt": wrapped.salt_b64,
        }
        table.put_item(Item=item, ConditionExpression="attribute_not_exists(user_id)")
        is_new = True
        logger.info("user_created", extra={"user_id": user_id})

    _set_session_cookie(response, user_id)
    return AuthResponse(user=_to_public(item), is_new=is_new)


@router.post("/login", response_model=AuthResponse, summary="Explicit login")
def login(body: LoginRequest, response: Response) -> AuthResponse:
    user_id = _slugify(body.display_name)
    item = users_table().get_item(Key={"user_id": user_id}).get("Item")
    if not item or not verify_pin(body.pin, item["pin_hash"]):
        raise Unauthorized("Nom ou PIN incorrect.")
    _set_session_cookie(response, user_id)
    return AuthResponse(user=_to_public(item), is_new=False)


@router.post("/logout", summary="Clear the session cookie")
def logout(response: Response) -> dict:
    _clear_session_cookie(response)
    return {"ok": True}


@router.get("/me", response_model=UserPublic, summary="Current user")
def me(request: Request) -> UserPublic:
    user_id = get_current_user_id(request)
    if not user_id:
        raise Unauthorized("Not authenticated")
    item = users_table().get_item(Key={"user_id": user_id}).get("Item")
    if not item:
        # Session pointing at a deleted user — force re-login on the client.
        raise Unauthorized("User no longer exists")
    return _to_public(item)


@router.post(
    "/verify-pin",
    summary="Verify a PIN without issuing a session — used to unlock credentials",
)
def verify_pin_endpoint(
    request: Request,
    body: LoginRequest,
    user_id: Annotated[str, Depends(require_current_user_id)],
) -> dict:
    """Some flows need a fresh PIN check even when the user is already logged
    in (revealing/adding credentials). We accept ``display_name`` in the body
    only for consistency with LoginRequest; only the PIN is used, and the
    display_name is ignored — we always check against the session's user_id.
    """
    _ = body.display_name  # ignored on purpose (documented above)
    item = users_table().get_item(Key={"user_id": user_id}).get("Item")
    if not item:
        raise Unauthorized("User no longer exists")
    if not verify_pin(body.pin, item["pin_hash"]):
        raise Unauthorized("PIN incorrect.")
    return {"ok": True}
