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
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response

from core.config import get_settings
from core.crypto import create_wrapped_kek, hash_pin, verify_pin, verify_pin_or_dummy
from core.dynamo import credentials_table, users_table
from core.errors import BadRequest, Unauthorized
from core.logging import get_logger
from core.session import get_current_user_id, issue_session, require_current_user_id
from schemas.auth import AuthResponse, LoginRequest, SignupRequest, UserPublic

logger = get_logger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


_SLUG_RE = re.compile(r"[^a-z0-9]+")

# SEC-025 (H-2): PIN space is 10^6 — Argon2id slows offline but does nothing
# for an online brute-force. Track failed attempts on the user row itself and
# lock the account with exponential backoff after ``_LOCKOUT_THRESHOLD``
# consecutive failures. Successful auth resets the counter. Per-IP rate
# limiting is left to the ALB / API-gateway layer where it belongs.
_LOCKOUT_THRESHOLD = 5
_LOCKOUT_BASE_SECONDS = 30
_LOCKOUT_MAX_SECONDS = 3600  # 1h ceiling; keeps a lost-PIN scenario recoverable

# SEC-025 / H-3: identical error text for every failure mode. Signup, login,
# and verify-pin all use this string so a caller cannot distinguish "user
# doesn't exist" from "wrong PIN" from "locked out" by response body alone.
_AUTH_FAILED_MESSAGE = "Nom ou PIN incorrect."


def _now_epoch() -> int:
    return int(datetime.now(tz=UTC).timestamp())


def _lockout_seconds_for(attempts: int) -> int:
    """Exponential backoff: 30, 60, 120, 240, ... up to 1 hour."""
    if attempts < _LOCKOUT_THRESHOLD:
        return 0
    over = attempts - _LOCKOUT_THRESHOLD
    delay = _LOCKOUT_BASE_SECONDS * (2**over)
    return min(delay, _LOCKOUT_MAX_SECONDS)


def _register_auth_failure(user_id: str, item: dict) -> None:
    """Increment failed_attempts and, past the threshold, stamp ``locked_until``.

    Called only when we know the user exists — attempts against unknown
    display_names cannot be tracked (there is no row) and are absorbed by the
    dummy-hash timing burn instead.
    """
    attempts = int(item.get("failed_attempts", 0)) + 1
    locked_until = (
        _now_epoch() + _lockout_seconds_for(attempts) if attempts >= _LOCKOUT_THRESHOLD else 0
    )
    try:
        users_table().update_item(
            Key={"user_id": user_id},
            UpdateExpression="SET failed_attempts = :a, locked_until = :l",
            ExpressionAttributeValues={":a": attempts, ":l": locked_until},
        )
    except Exception as exc:
        # Never let a lockout write failure become a client-visible error;
        # log it and move on — the attacker still hits the constant-time verify.
        logger.warning("lockout_write_failed", extra={"error": repr(exc), "user_id": user_id})


def _reset_auth_failures(user_id: str) -> None:
    try:
        users_table().update_item(
            Key={"user_id": user_id},
            UpdateExpression="SET failed_attempts = :z, locked_until = :z",
            ExpressionAttributeValues={":z": 0},
        )
    except Exception as exc:
        logger.warning("lockout_reset_failed", extra={"error": repr(exc), "user_id": user_id})


def _is_locked(item: dict) -> bool:
    return int(item.get("locked_until", 0) or 0) > _now_epoch()


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
        # SEC-027: Strict blocks the cookie on cross-site navigations and
        # forms; the Next.js proxy is same-origin so the app itself is
        # unaffected. Combined with the proxy-side Origin check in
        # lib/server/backend-proxy.ts this closes the residual CSRF surface.
        samesite="strict",
        path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(
        key=settings.session_cookie_name,
        path="/",
        httponly=True,
        samesite="strict",
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


@router.post(
    "/signup", response_model=AuthResponse, summary="Create account or log in with existing PIN"
)
def signup(body: SignupRequest, response: Response) -> AuthResponse:
    """Idempotent: creating twice with the same PIN just logs you in.

    SEC-025 (H-2 / H-3): failure paths return an identical error to the login
    endpoint so signup cannot be used to enumerate valid display_names.
    Wrong-PIN attempts on an existing user count towards the account lockout
    counter (see :func:`_register_auth_failure`).
    """
    user_id = _slugify(body.display_name)
    table = users_table()

    existing = table.get_item(Key={"user_id": user_id}).get("Item")
    is_new = False

    if existing:
        if _is_locked(existing):
            raise Unauthorized(_AUTH_FAILED_MESSAGE)
        if not verify_pin_or_dummy(body.pin, existing.get("pin_hash")):
            _register_auth_failure(user_id, existing)
            raise Unauthorized(_AUTH_FAILED_MESSAGE)
        _reset_auth_failures(user_id)
        item = existing
    else:
        wrapped, _raw_kek = create_wrapped_kek(body.pin)
        now = datetime.now(tz=UTC).isoformat()
        item = {
            "user_id": user_id,
            "display_name": body.display_name,
            "created_at": now,
            "pin_hash": hash_pin(body.pin),
            "kek_ciphertext": wrapped.ciphertext_b64,
            "kek_nonce": wrapped.nonce_b64,
            "kek_salt": wrapped.salt_b64,
            "failed_attempts": 0,
            "locked_until": 0,
        }
        table.put_item(Item=item, ConditionExpression="attribute_not_exists(user_id)")
        is_new = True
        logger.info("user_created", extra={"user_id": user_id})

    _set_session_cookie(response, user_id)
    return AuthResponse(user=_to_public(item), is_new=is_new)


@router.post("/login", response_model=AuthResponse, summary="Explicit login")
def login(body: LoginRequest, response: Response) -> AuthResponse:
    """SEC-025 (H-2 / M-3): constant-time verify against a dummy hash when the
    user doesn't exist so timing cannot leak existence; lockout counter armed
    on the user row after 5 consecutive failures with exponential backoff.
    """
    user_id = _slugify(body.display_name)
    item = users_table().get_item(Key={"user_id": user_id}).get("Item")

    # Lockout applies before the Argon2 verify to save CPU under attack, but
    # only for real users — an attacker probing an unknown name still burns
    # a full Argon2 pass via the dummy branch below.
    if item and _is_locked(item):
        raise Unauthorized(_AUTH_FAILED_MESSAGE)

    pin_hash = item.get("pin_hash") if item else None
    ok = verify_pin_or_dummy(body.pin, pin_hash)
    if not ok or not item:
        if item:
            _register_auth_failure(user_id, item)
        raise Unauthorized(_AUTH_FAILED_MESSAGE)

    _reset_auth_failures(user_id)
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
    if _is_locked(item):
        raise Unauthorized(_AUTH_FAILED_MESSAGE)
    if not verify_pin(body.pin, item["pin_hash"]):
        _register_auth_failure(user_id, item)
        raise Unauthorized(_AUTH_FAILED_MESSAGE)
    _reset_auth_failures(user_id)
    return {"ok": True}
