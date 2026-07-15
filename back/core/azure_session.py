"""Per-user Azure credentials cache.

Mirror of ``core.aws_session`` for Azure Service Principals. When a user
unlocks their encrypted Azure credentials with their PIN, we hold the raw
``ClientSecretCredential`` (and the default subscription/location) in
memory for a bounded TTL. Every ``/api/azure/*`` route pulls that credential
so requests are scoped to the caller — never to the server default.

The plaintext client_secret never leaves this module; nothing is persisted
on disk. Process restart = every user must re-unlock via their PIN. That is
by design: only the AES-GCM ciphertext lives in DynamoDB.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Any

from core.logging import get_logger

logger = get_logger(__name__)


# Same TTL as AWS — keeps a leaked PID window bounded, forces PIN re-entry.
_TTL_SECONDS = 60 * 60


@dataclass
class _CachedAzure:
    credential: Any  # azure.identity.ClientSecretCredential (typed loosely to keep imports lazy)
    tenant_id: str
    subscription_id: str | None
    location: str
    display_name: str | None
    expires_at: float


_cache: dict[str, _CachedAzure] = {}
_cache_lock = threading.Lock()


def _prune_locked(now: float) -> None:
    """Remove expired entries. Caller must hold ``_cache_lock``."""
    expired = [uid for uid, entry in _cache.items() if entry.expires_at <= now]
    for uid in expired:
        del _cache[uid]


def activate_user_azure(
    user_id: str,
    tenant_id: str,
    client_id: str,
    client_secret: str,
    subscription_id: str | None,
    location: str,
    display_name: str | None = None,
) -> None:
    """Build an azure-identity credential and cache it for the user.

    Never logs the client_secret; only the tenant and last-4 of client_id.
    Raises RuntimeError if the ``azure-identity`` package isn't installed —
    the caller (routes) surface that as a clean AppError.
    """
    try:
        from azure.identity import ClientSecretCredential  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "azure-identity is not installed. Add it to back/requirements.txt "
            "to enable Azure integration."
        ) from exc

    cred = ClientSecretCredential(
        tenant_id=tenant_id,
        client_id=client_id,
        client_secret=client_secret,
    )
    with _cache_lock:
        _prune_locked(time.time())
        _cache[user_id] = _CachedAzure(
            credential=cred,
            tenant_id=tenant_id,
            subscription_id=subscription_id,
            location=location,
            display_name=display_name,
            expires_at=time.time() + _TTL_SECONDS,
        )
    logger.info(
        "azure_session_activated",
        extra={
            "user_id": user_id,
            "tenant_id": tenant_id,
            "client_suffix": client_id[-4:] if client_id else "",
            "subscription_id": subscription_id,
        },
    )


def get_user_azure(user_id: str | None) -> _CachedAzure | None:
    """Return the cached Azure entry for ``user_id`` (or None if none/expired)."""
    if not user_id:
        return None
    with _cache_lock:
        _prune_locked(time.time())
        return _cache.get(user_id)


def deactivate_user_azure(user_id: str) -> None:
    """Forget the cached Azure credential for ``user_id`` — used on logout."""
    with _cache_lock:
        _cache.pop(user_id, None)


def is_active(user_id: str | None) -> bool:
    return get_user_azure(user_id) is not None
