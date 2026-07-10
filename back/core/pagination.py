"""Opt-in offset/limit pagination for list endpoints.

Contract chosen to preserve backward compatibility with existing clients:

* When the caller does NOT send ``?limit=...``, the response is returned
  unchanged and no pagination headers are set. Existing dashboards keep
  fetching the full list.
* When ``?limit=...`` is provided (with optional ``?offset=...``), the list
  is sliced and pagination metadata is exposed via response headers
  (X-Total-Count, X-Offset, X-Limit, X-Next-Offset) so the response body
  stays a plain array — no envelope, no schema break.

Callers wanting a proper envelope can build one on top of the headers; the
headers themselves are cheap to add and follow the same convention used by
GitHub and other public REST APIs.
"""
from __future__ import annotations

from typing import Optional, Sequence, TypeVar

from fastapi import Response

T = TypeVar("T")


def apply_pagination(
    items: Sequence[T],
    response: Response,
    *,
    limit: Optional[int],
    offset: int = 0,
) -> list[T]:
    """Slice ``items`` and stamp pagination headers on ``response``.

    Rules:
      - ``limit=None``: return list(items) unchanged, no headers set.
      - ``limit >= 0``: slice [offset : offset+limit] and expose:
          X-Total-Count : total number of items before slicing
          X-Offset      : offset used
          X-Limit       : limit used
          X-Next-Offset : offset+limit if more items remain, else absent
      - ``offset`` beyond ``len(items)`` yields an empty slice, still with
        X-Total-Count set so the caller can detect end-of-list.
    """
    if limit is None:
        return list(items)

    total = len(items)
    if offset < 0:
        offset = 0
    end = offset + limit
    sliced = list(items[offset:end])

    response.headers["X-Total-Count"] = str(total)
    response.headers["X-Offset"] = str(offset)
    response.headers["X-Limit"] = str(limit)
    if end < total:
        response.headers["X-Next-Offset"] = str(end)
    return sliced
