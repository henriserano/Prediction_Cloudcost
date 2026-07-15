from __future__ import annotations

import numpy as np
import pandas as pd

from analysis.service_taxonomy import categorize
from core.cache import app_cache
from data.loader import load_daily_costs, load_daily_per_service
from schemas.analytics import KPIData, ServiceShare


def _service_cols(df: pd.DataFrame) -> list[str]:
    return [c for c in df.columns if c != "ds"]


def get_service_shares() -> list[ServiceShare]:
    cached = app_cache.get("analytics:services")
    if cached is not None:
        return cached
    df = load_daily_per_service()
    services = _service_cols(df)

    totals = {svc: float(df[svc].sum()) for svc in services}
    grand_total = sum(totals.values())

    cvs: dict[str, float] = {}
    for svc in services:
        daily = df[svc].dropna().values.astype(float)
        # ddof=1 std is undefined for n<2 and NaN silently propagates through
        # the schema; also guard against zero mean to avoid division-by-zero.
        if len(daily) < 2 or daily.mean() <= 0:
            cvs[svc] = 0.0
            continue
        cvs[svc] = float(np.std(daily, ddof=1) / np.mean(daily) * 100)

    ranked = sorted(totals.items(), key=lambda x: x[1], reverse=True)
    result: list[ServiceShare] = []
    cum = 0.0
    for svc, total in ranked:
        pct = round(total / grand_total * 100, 2) if grand_total else 0.0
        cum += pct
        result.append(
            ServiceShare(
                service=svc,
                cost=round(total, 4),
                pct=round(pct, 2),
                cv=round(cvs[svc], 2),
                cum_pct=round(cum, 2),
                category=categorize(svc),
            )
        )
    app_cache.set("analytics:services", result)
    return result


def _empty_kpi() -> KPIData:
    """Neutral KPI payload returned when no data has been loaded yet.

    Prevents 500s on /api/kpi when the events store is empty and no parquet
    fallback is available — the frontend should surface an empty state instead
    of an error toast.
    """
    return KPIData(
        total_spend=0.0,
        daily_avg=0.0,
        trend_slope=0.0,
        forecast_next_30=0.0,
        anomaly_count=0,
        top_service="",
        top_service_pct=0.0,
        data_points=0,
        period_start="",
        period_end="",
    )


def get_kpi() -> KPIData:
    cached = app_cache.get("analytics:kpi")
    if cached is not None:
        return cached
    daily = load_daily_costs()
    svc_df = load_daily_per_service()

    if len(daily) == 0 or "y" not in daily.columns:
        kpi = _empty_kpi()
        app_cache.set("analytics:kpi", kpi)
        return kpi

    arr = daily["y"].values.astype(float)
    total_spend = float(arr.sum())
    daily_avg = float(np.mean(arr))

    # Linear trend slope (€/day) — polyfit needs ≥ 2 points.
    if len(arr) >= 2:
        x = np.arange(len(arr), dtype=float)
        coeffs = np.polyfit(x, arr, 1)
        slope = float(coeffs[0])
    else:
        slope = 0.0

    # 30-day forecast using average of the last up-to-14 days
    last_window = arr[-14:] if len(arr) >= 14 else arr
    last_14_avg = float(np.mean(last_window))
    forecast_30 = round(last_14_avg * 30, 2)

    # Anomaly count (Z > 2) — std needs ≥ 2 samples with ddof=1.
    if len(arr) >= 2:
        mean_, std_ = np.mean(arr), np.std(arr, ddof=1)
        anomaly_count = int(np.sum(np.abs((arr - mean_) / std_) > 2.0)) if std_ > 0 else 0
    else:
        anomaly_count = 0

    # Top service
    services = [c for c in svc_df.columns if c != "ds"]
    totals = {svc: float(svc_df[svc].sum()) for svc in services}
    if totals:
        top_svc = max(totals, key=lambda k: totals[k])
        top_pct = round(totals[top_svc] / total_spend * 100, 2) if total_spend > 0 else 0.0
    else:
        top_svc = ""
        top_pct = 0.0

    kpi = KPIData(
        total_spend=round(total_spend, 2),
        daily_avg=round(daily_avg, 4),
        trend_slope=round(float(slope), 6),
        forecast_next_30=forecast_30,
        anomaly_count=anomaly_count,
        top_service=top_svc,
        top_service_pct=top_pct,
        data_points=len(arr),
        period_start=daily["ds"].iloc[0].strftime("%Y-%m-%d"),
        period_end=daily["ds"].iloc[-1].strftime("%Y-%m-%d"),
    )
    app_cache.set("analytics:kpi", kpi)
    return kpi
