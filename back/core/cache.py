from __future__ import annotations

import threading
import time
from typing import Any

from core.user_context import current_user_scope


def scoped_key(*parts: object) -> str:
    """Build a cache key prefixed with the current user's scope (SEC-020).

    The events store and data loader are keyed per user, so any result cached
    from them MUST be too — a bare "analytics:kpi" key computed for user A
    would be served verbatim to user B on the next cache hit (cross-tenant
    leak + wrong numbers). Every ``app_cache`` producer in analytics/forecast
    goes through this helper; anonymous callers land on the fixed ``_anon``
    scope, which is also where startup precompute warms the demo results.
    """
    return ":".join((current_user_scope(), *(str(p) for p in parts)))


class _CacheEntry:
    __slots__ = ("created_at", "expires_at", "last_access", "value")

    def __init__(self, value: Any, expires_at: float | None) -> None:
        now = time.monotonic()
        self.value = value
        self.expires_at = expires_at
        self.created_at = now
        # PERF-002: touched on every ``get`` — a scalar write is dozens of
        # instructions cheaper than the OrderedDict.move_to_end linked-list
        # splice that used to run under the global lock on every cache hit.
        self.last_access = now


# SEC: hard cap on the number of entries kept in memory. Without a cap, an
# unauthenticated caller can hit ?z_threshold=<float> with slightly different
# values on repeat and inflate the store forever — each entry holds an entire
# computed response payload. 512 covers legitimate warm-cache keys (analytics,
# forecast:<model>:<horizon>, advanced analyses) with headroom to spare.
DEFAULT_MAX_ENTRIES = 512

# On overflow we evict this fraction of the store in a single pass, instead of
# popping one entry at a time. Amortises the O(n) sort across many future
# ``set`` calls — with 512 entries and 0.1, one eviction pass drops ~51 keys.
_EVICT_BATCH_FRACTION = 0.1


class AppCache:
    """Thread-safe in-memory result cache with optional TTL and approx-LRU eviction.

    Bounded by ``max_entries``. On overflow, the coldest fraction of entries
    (by ``last_access``) is dropped in a single pass on ``set``. Reads only
    update a per-entry timestamp — no lock-serialised linked-list mutation,
    so hot-path contention stays flat under load.
    """

    def __init__(self, max_entries: int = DEFAULT_MAX_ENTRIES) -> None:
        # Plain dict, ordering not load-bearing anymore.
        self._store: dict[str, _CacheEntry] = {}
        # Regular Lock (not RLock) — none of the paths below recurse.
        self._lock = threading.Lock()
        self._max_entries = max_entries
        self._hits = 0
        self._misses = 0
        self._evictions = 0

    def get(self, key: str) -> Any:
        # Short critical section: dict lookup + TTL check + timestamp bump.
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                self._misses += 1
                return None
            now = time.monotonic()
            if entry.expires_at is not None and now > entry.expires_at:
                del self._store[key]
                self._misses += 1
                return None
            entry.last_access = now
            self._hits += 1
            return entry.value

    def _evict_batch_locked(self) -> None:
        """Drop the coldest ~10% of entries. Caller MUST hold ``self._lock``."""
        overflow = len(self._store) - self._max_entries
        if overflow <= 0:
            return
        # Batch = at least the overflow, and at least floor(max*fraction) so
        # the O(n) scan below amortises across many future ``set`` calls.
        batch = max(overflow, int(self._max_entries * _EVICT_BATCH_FRACTION))
        # Partial sort by last_access. n <= 512 in practice — a full sort is
        # well below any perceptible latency.
        coldest = sorted(self._store.items(), key=lambda kv: kv[1].last_access)[:batch]
        for k, _ in coldest:
            self._store.pop(k, None)
            self._evictions += 1

    def set(self, key: str, value: Any, ttl: float | None = None) -> None:
        expires_at = time.monotonic() + ttl if ttl is not None else None
        with self._lock:
            self._store[key] = _CacheEntry(value, expires_at)
            if len(self._store) > self._max_entries:
                self._evict_batch_locked()

    def invalidate(self, *keys: str) -> None:
        with self._lock:
            for k in keys:
                self._store.pop(k, None)

    def invalidate_prefix(self, prefix: str) -> int:
        """Drop every entry whose key starts with ``prefix``; returns the count.

        Used by ingest endpoints to evict a single user's scope
        (``"<user_id>:"``) instead of nuking the whole store — a global
        ``clear()`` also threw away the anonymous-scope precompute and every
        other user's warm entries on each upload, triggering full walk-forward
        CV recomputes for everyone.
        """
        with self._lock:
            doomed = [k for k in self._store if k.startswith(prefix)]
            for k in doomed:
                del self._store[k]
            return len(doomed)

    def clear(self) -> None:
        with self._lock:
            self._store.clear()
            self._hits = 0
            self._misses = 0
            self._evictions = 0

    def stats(self) -> dict:
        with self._lock:
            total = self._hits + self._misses
            return {
                "keys": len(self._store),
                "max_entries": self._max_entries,
                "hits": self._hits,
                "misses": self._misses,
                "evictions": self._evictions,
                "hit_rate": round(self._hits / total, 4) if total else 0.0,
            }

    def keys(self) -> list[str]:
        with self._lock:
            return sorted(self._store.keys())


app_cache = AppCache()
