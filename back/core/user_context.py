"""Per-request user identity propagation.

SEC-020: analytics, forecast and advanced analysis routes read from shared
per-process caches. Before this module, every user's request read the same
`_injected_events` list, so anyone (authenticated or not) could dump whichever
user's data was last synced. See routes_events.py for the store rewrite.

The ContextVar is set by the security middleware in ``main.py`` from the
session cookie. Every downstream helper reads it via
``current_user_scope()`` and uses the value as the key into per-user stores
and cache slots. Anonymous requests get the fixed sentinel ``_anon`` — they
should only reach routes that don't touch user data (health, /api/data with
no ingestion). All data-bearing routes must depend on
``require_current_user_id`` and refuse anonymous callers.
"""

from __future__ import annotations

from contextvars import ContextVar

_current_user_id: ContextVar[str | None] = ContextVar("current_user_id", default=None)

ANONYMOUS_SCOPE = "_anon"


def set_current_user_id(user_id: str | None):
    """Set the ContextVar. Returns the reset token so callers can restore."""
    return _current_user_id.set(user_id)


def reset_current_user_id(token) -> None:
    _current_user_id.reset(token)


def get_current_user_id() -> str | None:
    return _current_user_id.get()


def current_user_scope() -> str:
    """Stable key for per-user cache/store slots. Never empty — anonymous
    callers get ``ANONYMOUS_SCOPE`` so no accidental cross-user reads on a
    missing check."""
    return _current_user_id.get() or ANONYMOUS_SCOPE
