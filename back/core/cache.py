from __future__ import annotations

import threading
import time
from collections import OrderedDict
from typing import Any


class _CacheEntry:
    __slots__ = ("value", "expires_at", "created_at")

    def __init__(self, value: Any, expires_at: float | None) -> None:
        self.value = value
        self.expires_at = expires_at
        self.created_at = time.monotonic()


# SEC: hard cap on the number of entries kept in memory. Without a cap, an
# unauthenticated caller can hit ?z_threshold=<float> with slightly different
# values on repeat and inflate the store forever — each entry holds an entire
# computed response payload. 512 covers legitimate warm-cache keys (analytics,
# forecast:<model>:<horizon>, advanced analyses) with headroom to spare.
DEFAULT_MAX_ENTRIES = 512


class AppCache:
    """Thread-safe in-memory result cache with optional TTL and LRU eviction.

    Bounded by ``max_entries``. When full, the least-recently-used key is
    dropped on the next ``set()``. Reads count as "used" — an entry is only
    considered stale for eviction if nothing else has touched it in a while.
    """

    def __init__(self, max_entries: int = DEFAULT_MAX_ENTRIES) -> None:
        self._store: "OrderedDict[str, _CacheEntry]" = OrderedDict()
        self._lock = threading.RLock()
        self._max_entries = max_entries
        self._hits = 0
        self._misses = 0
        self._evictions = 0

    def get(self, key: str) -> Any:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                self._misses += 1
                return None
            if entry.expires_at is not None and time.monotonic() > entry.expires_at:
                del self._store[key]
                self._misses += 1
                return None
            # Mark as most-recently-used.
            self._store.move_to_end(key)
            self._hits += 1
            return entry.value

    def set(self, key: str, value: Any, ttl: float | None = None) -> None:
        expires_at = time.monotonic() + ttl if ttl is not None else None
        with self._lock:
            if key in self._store:
                self._store.move_to_end(key)
            self._store[key] = _CacheEntry(value, expires_at)
            while len(self._store) > self._max_entries:
                self._store.popitem(last=False)  # drop LRU
                self._evictions += 1

    def invalidate(self, *keys: str) -> None:
        with self._lock:
            for k in keys:
                self._store.pop(k, None)

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
