"""Per-provider credentials activation registry.

Historical shape: each provider had its own ``_activate_<name>_from_payload``
helper in ``routes/routes_credentials.py`` (and a matching per-provider status
endpoint block). The helpers only differed by which keys they pulled from the
decrypted payload and which ``core.*_session.activate_user_*`` they called.

This module centralises that pattern behind a descriptor so:

* ``routes_credentials`` becomes a single generic dispatch instead of an
  if/elif chain per provider.
* Adding a fourth provider (GCP OAuth-refresh, IBM, OCI…) is one descriptor
  entry, not a new route file.
* Field aliasing (``access_key_id`` ↔ ``AWS_ACCESS_KEY_ID``) is defined once,
  used everywhere.

Nothing here talks to the database or the request — it only wraps the
in-memory session cache, so it can be imported freely without triggering the
network side effects of the ``routes`` layer.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Sequence

from core.logging import get_logger

logger = get_logger(__name__)


def _first(payload: dict, aliases: Sequence[str]) -> str | None:
    """Return the first non-empty value in ``payload`` matching any alias.

    Keeps callers from writing ``payload.get("a") or payload.get("A")`` chains
    that turn into copy-paste bugs when a fourth alias joins the list.
    """
    for key in aliases:
        value = payload.get(key)
        if value:
            return str(value)
    return None


@dataclass(frozen=True)
class CredentialsProvider:
    """Recipe for activating an in-memory session from a decrypted payload.

    - ``name``: matches the Literal in ``schemas/credentials.py`` ("aws", "azure").
    - ``required``: field(s) whose absence yields a warning + no-op activation.
    - ``activate``: called with the sanitised kwargs.
    - ``optional_defaults``: hard-coded defaults for optional fields (region…).
    """

    name: str
    field_map: dict[str, tuple[str, ...]]
    required: tuple[str, ...]
    activate: Callable[..., None]
    optional_defaults: dict[str, str]


_registry: dict[str, CredentialsProvider] = {}


def register(provider: CredentialsProvider) -> None:
    _registry[provider.name] = provider


def activate_from_payload(provider_name: str, user_id: str, payload: dict) -> None:
    """Dispatch to the registered activator for ``provider_name``.

    Missing required fields log a warning and no-op (matching the pre-refactor
    behaviour: the encrypted row stays intact, only the in-memory activation
    is skipped so the user can retry with a fresh payload).
    """
    provider = _registry.get(provider_name)
    if provider is None:
        return

    kwargs: dict[str, str | None] = {}
    for field, aliases in provider.field_map.items():
        value = _first(payload, aliases)
        if value is None and field in provider.optional_defaults:
            value = provider.optional_defaults[field]
        kwargs[field] = value

    missing = [f for f in provider.required if not kwargs.get(f)]
    if missing:
        logger.warning(
            f"{provider_name}_activation_missing_fields",
            extra={"user_id": user_id, "missing": missing, "keys": list(payload.keys())},
        )
        return

    try:
        provider.activate(user_id=user_id, **kwargs)
    except RuntimeError as exc:
        # SDK not installed — the credentials row is fine, activation just
        # can't happen until the package is added to requirements.
        logger.warning(
            f"{provider_name}_activation_sdk_missing",
            extra={"user_id": user_id, "error": str(exc)},
        )
