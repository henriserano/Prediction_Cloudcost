from __future__ import annotations

from typing import List

import pandas as pd
from fastapi import APIRouter

from core.errors import BadRequest
from schemas.gcp import EventsIngestRequest, EventsIngestResponse, DateRange, PreviewKPI

router = APIRouter(prefix="/api", tags=["events"])

# Module-level store: list of normalised row dicts
_injected_events: list[dict] = []


def _build_dataframe(rows: list[dict]) -> pd.DataFrame:
    """Build a DataFrame from the stored event dicts, matching daily_costs schema."""
    if not rows:
        return pd.DataFrame(columns=["ds", "Sous-total (€)", "service"])
    df = pd.DataFrame(rows)
    df["ds"] = pd.to_datetime(df["ds"])
    df["Sous-total (€)"] = df["Sous-total (€)"].astype(float)
    return df.sort_values("ds").reset_index(drop=True)


@router.post("/events", response_model=EventsIngestResponse)
def ingest_events(body: EventsIngestRequest) -> EventsIngestResponse:
    """
    Ingest billing events into the in-memory store.

    - replace=True  → clear the store first, then add new events
    - replace=False → append new events to the existing store
    """
    global _injected_events

    if not body.events:
        raise BadRequest("events list must not be empty")

    # Normalise incoming events to row dicts
    new_rows: list[dict] = []
    for evt in body.events:
        try:
            pd.Timestamp(evt.date)  # validate date string
        except Exception:
            raise BadRequest(
                f"Invalid date format: '{evt.date}'. Expected YYYY-MM-DD.",
                details={"offending_date": evt.date},
            )
        new_rows.append(
            {
                "ds": evt.date,
                "Sous-total (€)": float(evt.cost),
                "service": evt.service,
                "description": evt.description or "",
            }
        )

    if body.replace:
        _injected_events = new_rows
    else:
        _injected_events = _injected_events + new_rows

    # Invalidate downstream caches so analytics/forecast see fresh data
    try:
        from core.cache import app_cache
        app_cache.clear()
    except Exception:
        pass

    try:
        from data.loader import invalidate_cache
        invalidate_cache()
    except Exception:
        pass

    # Build summary statistics from the full store
    total_rows = len(_injected_events)
    df = _build_dataframe(_injected_events)

    dates = df["ds"].dt.strftime("%Y-%m-%d")
    date_start = dates.min()
    date_end = dates.max()

    total_spend = float(df["Sous-total (€)"].sum())
    unique_days = df["ds"].nunique()
    daily_avg = total_spend / unique_days if unique_days > 0 else 0.0

    return EventsIngestResponse(
        ingested=len(new_rows),
        total_rows=total_rows,
        date_range=DateRange(start=date_start, end=date_end),
        preview_kpi=PreviewKPI(total_spend=round(total_spend, 2), daily_avg=round(daily_avg, 2)),
    )


def get_injected_events_df() -> pd.DataFrame:
    """Return the current injected events as a DataFrame (used by other modules)."""
    return _build_dataframe(_injected_events)
