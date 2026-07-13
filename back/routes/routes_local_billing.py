"""Aggregated billing view on the local events store.

Returns a shape compatible with the three cloud /billing endpoints so the
frontend's :func:`usePortfolioAggregate` can merge locally-imported files
(CSV / Excel via /collecte) alongside cloud data without a provider-specific
branch. See :mod:`schemas.local_billing` for the exact response contract.

Aggregation is on the same fingerprint the rest of Analyse reads from — the
events store when populated, the parquet demo fallback otherwise.
"""
from __future__ import annotations

from typing import Annotated

import pandas as pd
from fastapi import APIRouter, Query

from core.cache import app_cache
from data.loader import get_last_source, load_daily_per_service
from schemas.gcp import DateRange
from schemas.local_billing import (
    LocalBillingByMonth,
    LocalBillingByService,
    LocalBillingResponse,
)


router = APIRouter(prefix="/api/events", tags=["events"])


@router.get(
    "/billing",
    response_model=LocalBillingResponse,
    summary="Aggregate the local events store into per-service + per-month totals",
)
def local_billing(
    months: Annotated[int, Query(ge=1, le=24)] = 6,
) -> LocalBillingResponse:
    """Return the last ``months`` months of imported events aggregated by
    service and by month.

    The endpoint reads the same source that Analyse uses (events store first,
    parquet demo fallback if empty), so the numbers stay consistent between
    the per-file view (Fichier tab) and the consolidated portfolio view.
    """
    cache_key = f"local_billing:{months}"
    cached = app_cache.get(cache_key)
    if cached is not None:
        return cached

    df = load_daily_per_service()
    if df is None or len(df) == 0:
        response = LocalBillingResponse(
            period=DateRange(start="", end=""),
            total=0.0,
            by_service=[],
            by_month=[],
            currency="EUR",
            source=get_last_source().get("daily_per_service", "empty"),
            event_count=0,
        )
        app_cache.set(cache_key, response)
        return response

    # Restrict to the trailing window. `months` is applied on the daily grid so
    # partial months contribute proportionally (matches the cloud endpoints).
    end = pd.to_datetime(df["ds"]).max()
    start = end - pd.DateOffset(months=months)
    df = df[df["ds"] >= start]

    service_cols = [c for c in df.columns if c != "ds"]
    if not service_cols:
        response = LocalBillingResponse(
            period=DateRange(
                start=df["ds"].min().strftime("%Y-%m-%d"),
                end=df["ds"].max().strftime("%Y-%m-%d"),
            ),
            total=0.0,
            by_service=[],
            by_month=[],
            currency="EUR",
            source=get_last_source().get("daily_per_service", "unknown"),
            event_count=int(len(df)),
        )
        app_cache.set(cache_key, response)
        return response

    # ── by service ────────────────────────────────────────────────────────────
    per_service = df[service_cols].sum(axis=0)
    total = float(per_service.sum())
    by_service = [
        LocalBillingByService(
            service=str(name),
            cost=round(float(cost), 4),
            pct=round(float(cost) / total * 100.0, 4) if total > 0 else 0.0,
        )
        for name, cost in per_service.sort_values(ascending=False).items()
        if float(cost) > 0
    ]

    # ── by month ──────────────────────────────────────────────────────────────
    df_m = df.assign(month=df["ds"].dt.strftime("%Y-%m"))
    monthly = df_m.groupby("month")[service_cols].sum().sum(axis=1)
    by_month = [
        LocalBillingByMonth(month=str(m), cost=round(float(v), 4))
        for m, v in monthly.sort_index().items()
    ]

    response = LocalBillingResponse(
        period=DateRange(
            start=df["ds"].min().strftime("%Y-%m-%d"),
            end=df["ds"].max().strftime("%Y-%m-%d"),
        ),
        total=round(total, 4),
        by_service=by_service,
        by_month=by_month,
        currency="EUR",
        source=get_last_source().get("daily_per_service", "unknown"),
        event_count=int(len(df)),
    )
    app_cache.set(cache_key, response)
    return response
