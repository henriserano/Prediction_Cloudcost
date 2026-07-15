"""Per-user AWS credentials cache.

When a user unlocks their encrypted credentials with their PIN, we cache the
resulting boto3 Session in-process for a bounded TTL. Subsequent ``/api/aws/*``
requests pick up that Session instead of the server's default credential
chain — so each user sees their own accounts and billing data.

The plaintext keys never leave this module:
- ``activate_user_aws(user_id, payload)`` builds a Session and caches it.
- ``get_user_boto3_session(user_id)`` returns the cached Session (or None).
- Cache is a plain dict with per-entry ``expires_at``; a background sweep isn't
  needed because we check TTL on every lookup.

Restart of the process = every user must re-activate. That's on purpose — no
plaintext AWS keys persist on disk, only the AES-GCM ciphertext in DynamoDB.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass

import boto3

from core.logging import get_logger

logger = get_logger(__name__)


# TTL kept short so a leaked PID or memory dump has a bounded exposure window.
# The user re-enters their PIN when it expires. 60 min feels right for a POC;
# tune down for prod once the flow is validated.
_TTL_SECONDS = 60 * 60


@dataclass
class _CachedSession:
    session: boto3.session.Session
    region: str
    account_id: str | None
    expires_at: float


_cache: dict[str, _CachedSession] = {}
_cache_lock = threading.Lock()


def _prune_locked(now: float) -> None:
    """Remove expired entries. Caller must hold ``_cache_lock``."""
    expired = [uid for uid, entry in _cache.items() if entry.expires_at <= now]
    for uid in expired:
        del _cache[uid]


def activate_user_aws(
    user_id: str,
    access_key_id: str,
    secret_access_key: str,
    region: str,
    session_token: str | None = None,
    account_id: str | None = None,
) -> None:
    """Cache a boto3 Session built from the user's plaintext credentials.

    ``account_id`` is optional — routes that need it call STS lazily. Never
    logs the keys themselves; only the region and last-4 of the access-key id.
    """
    session = boto3.session.Session(
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key,
        aws_session_token=session_token,
        region_name=region,
    )
    with _cache_lock:
        _prune_locked(time.time())
        _cache[user_id] = _CachedSession(
            session=session,
            region=region,
            account_id=account_id,
            expires_at=time.time() + _TTL_SECONDS,
        )
    logger.info(
        "aws_session_activated",
        extra={
            "user_id": user_id,
            "region": region,
            "key_suffix": access_key_id[-4:] if access_key_id else "",
        },
    )


def get_user_boto3_session(user_id: str | None) -> boto3.session.Session | None:
    """Return the cached boto3 Session for ``user_id`` (or None if none/expired)."""
    if not user_id:
        return None
    with _cache_lock:
        _prune_locked(time.time())
        entry = _cache.get(user_id)
        return entry.session if entry else None


def get_user_region(user_id: str | None) -> str | None:
    """Return the cached region for ``user_id`` (or None)."""
    if not user_id:
        return None
    with _cache_lock:
        _prune_locked(time.time())
        entry = _cache.get(user_id)
        return entry.region if entry else None


def deactivate_user_aws(user_id: str) -> None:
    """Forget the cached session for ``user_id`` — used on logout."""
    with _cache_lock:
        _cache.pop(user_id, None)


def is_active(user_id: str | None) -> bool:
    return get_user_boto3_session(user_id) is not None
