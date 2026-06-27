from __future__ import annotations

from typing import List

import numpy as np
import pandas as pd

from data.loader import load_daily_costs, load_daily_per_service
from schemas.analytics import KPIData, ServiceShare
from core.cache import app_cache


def _service_cols(df: pd.DataFrame) -> List[str]:
    return [c for c in df.columns if c != "ds"]


def get_service_shares() -> List[ServiceShare]:
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
        if daily.mean() > 0:
            cvs[svc] = float(np.std(daily, ddof=1) / np.mean(daily) * 100)
        else:
            cvs[svc] = 0.0

    ranked = sorted(totals.items(), key=lambda x: x[1], reverse=True)
    result: List[ServiceShare] = []
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
            )
        )
    app_cache.set("analytics:services", result)
    return result


def get_kpi() -> KPIData:
    cached = app_cache.get("analytics:kpi")
    if cached is not None:
        return cached
    daily = load_daily_costs()
    svc_df = load_daily_per_service()

    arr = daily["y"].values.astype(float)
    total_spend = float(arr.sum())
    daily_avg = float(np.mean(arr))

    # Linear trend slope (€/day)
    x = np.arange(len(arr), dtype=float)
    coeffs = np.polyfit(x, arr, 1)
    slope = float(coeffs[0])

    # 30-day forecast using average of last 14 days
    last_14_avg = float(np.mean(arr[-14:]))
    forecast_30 = round(last_14_avg * 30, 2)

    # Anomaly count (Z > 2)
    mean_, std_ = np.mean(arr), np.std(arr, ddof=1)
    anomaly_count = int(np.sum(np.abs((arr - mean_) / std_) > 2.0))

    # Top service
    services = [c for c in svc_df.columns if c != "ds"]
    totals = {svc: float(svc_df[svc].sum()) for svc in services}
    top_svc = max(totals, key=lambda k: totals[k])
    top_pct = round(totals[top_svc] / total_spend * 100, 2)

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
