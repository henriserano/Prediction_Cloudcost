from __future__ import annotations

import io
from typing import Annotated, List, Optional

import pandas as pd
from fastapi import APIRouter, File, Form, UploadFile
from pydantic import BaseModel, Field

from core.errors import BadRequest
from core.logging import get_logger
from schemas.gcp import EventsIngestRequest, EventsIngestResponse, DateRange, PreviewKPI

logger = get_logger(__name__)

router = APIRouter(prefix="/api", tags=["events"])

# Module-level store: list of normalised row dicts
_injected_events: list[dict] = []

# Absolute upper bound on total rows kept in the in-memory store (SEC-005).
_MAX_STORE_SIZE = 100_000

# Per-file size cap to avoid memory blow-ups on hostile uploads (10 MB).
_MAX_FILE_BYTES = 10 * 1024 * 1024

# Column aliases we accept in uploaded CSVs. First value that matches wins.
_DATE_COLUMN_ALIASES = ("Mois", "Date", "Usage Start Date", "usage_start_time", "day", "ds")
_SERVICE_COLUMN_ALIASES = ("Description du service", "Service", "service", "service.description")
_COST_COLUMN_ALIASES = (
    "Sous-total (€)",
    "Sous-total non arrondi (€)",
    "Coût catalogue (€)",
    "Cost",
    "cost",
    "Coût",
)


def _build_dataframe(rows: list[dict]) -> pd.DataFrame:
    """Build a DataFrame from the stored event dicts, matching daily_costs schema."""
    if not rows:
        return pd.DataFrame(columns=["ds", "Sous-total (€)", "service"])
    df = pd.DataFrame(rows)
    df["ds"] = pd.to_datetime(df["ds"])
    df["Sous-total (€)"] = df["Sous-total (€)"].astype(float)
    return df.sort_values("ds").reset_index(drop=True)


def _first_matching_column(df: pd.DataFrame, aliases: tuple[str, ...]) -> Optional[str]:
    """Return the first column of ``df`` whose name matches an alias (case-insensitive)."""
    lower_map = {c.lower(): c for c in df.columns}
    for alias in aliases:
        if alias in df.columns:
            return alias
        real = lower_map.get(alias.lower())
        if real:
            return real
    return None


def _to_iso_date(value) -> Optional[str]:
    """Normalise a cell value to YYYY-MM-DD. Accepts YYYY-MM (→ first of month)."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    s = str(value).strip()
    if not s:
        return None
    if len(s) == 7 and s[4] == "-":
        s = f"{s}-01"
    try:
        return pd.to_datetime(s, errors="raise").strftime("%Y-%m-%d")
    except Exception:
        return None


def _to_float_eu(value) -> Optional[float]:
    """Parse a European-locale number: '224,59' or '1 234,56' → float."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip().replace(" ", "").replace(" ", "")
    if not s:
        return None
    # If the string uses both '.' and ',', assume '.' is thousands sep (EU style).
    if s.count(",") == 1 and s.count(".") == 0:
        s = s.replace(",", ".")
    elif s.count(",") == 1 and s.count(".") >= 1:
        s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def _parse_billing_csv(filename: str, raw_bytes: bytes) -> tuple[list[dict], list[str]]:
    """Parse one CSV file into normalised event rows.

    Returns ``(rows, warnings)``. Empty rows list means the file was
    unparseable; the ``warnings`` list surfaces per-file issues to the client.
    """
    warnings: list[str] = []
    if len(raw_bytes) > _MAX_FILE_BYTES:
        warnings.append(
            f"{filename}: file exceeds the {_MAX_FILE_BYTES // (1024 * 1024)} MB limit"
        )
        return [], warnings

    try:
        # Try UTF-8 with BOM first (Excel export default), fall back to latin-1.
        try:
            text = raw_bytes.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = raw_bytes.decode("latin-1")
        df = pd.read_csv(io.StringIO(text), sep=None, engine="python")
    except Exception as exc:
        warnings.append(f"{filename}: could not parse as CSV ({exc.__class__.__name__})")
        return [], warnings

    date_col = _first_matching_column(df, _DATE_COLUMN_ALIASES)
    service_col = _first_matching_column(df, _SERVICE_COLUMN_ALIASES)
    cost_col = _first_matching_column(df, _COST_COLUMN_ALIASES)

    missing = [
        label for label, col in [("date", date_col), ("service", service_col), ("cost", cost_col)]
        if col is None
    ]
    if missing:
        warnings.append(
            f"{filename}: missing column(s) {missing}. "
            f"Found headers: {list(df.columns)[:10]}"
        )
        return [], warnings

    rows: list[dict] = []
    skipped = 0
    for _, r in df.iterrows():
        ds = _to_iso_date(r[date_col])
        cost = _to_float_eu(r[cost_col])
        service = str(r[service_col]).strip() if not pd.isna(r[service_col]) else ""
        if ds is None or cost is None or not service:
            skipped += 1
            continue
        rows.append(
            {
                "ds": ds,
                "Sous-total (€)": cost,
                "service": service,
                "description": filename,
            }
        )
    if skipped:
        warnings.append(f"{filename}: skipped {skipped} row(s) with invalid values")
    return rows, warnings


class MultiFileUploadResponse(BaseModel):
    """Summary of a /api/events/upload run."""

    files_processed: int
    ingested: int = Field(description="Total rows added across all files")
    total_rows: int = Field(description="Total rows in the store after upload")
    date_range: DateRange
    preview_kpi: PreviewKPI
    per_file: dict[str, int] = Field(
        default_factory=dict,
        description="Rows ingested per uploaded filename.",
    )
    warnings: list[str] = Field(default_factory=list)


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

    new_rows: list[dict] = []
    for evt in body.events:
        # Pydantic validators on BillingEvent already enforce date format,
        # non-negative cost, and service max length (SEC-005, SEC-006).
        # Re-validate cost at the route level as a defence-in-depth measure.
        if evt.cost < 0:
            raise BadRequest(
                f"cost must be >= 0, got {evt.cost}",
                details={"offending_cost": evt.cost},
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
        # Enforce absolute store cap before appending (SEC-005).
        if len(_injected_events) + len(new_rows) > _MAX_STORE_SIZE:
            raise BadRequest(
                f"Appending {len(new_rows)} events would exceed the maximum store size "
                f"of {_MAX_STORE_SIZE} rows. Use replace=True to reset the store first.",
                details={"current_size": len(_injected_events), "incoming": len(new_rows), "max": _MAX_STORE_SIZE},
            )
        # Use extend instead of concatenation to avoid O(N) list copy (SEC-005).
        _injected_events.extend(new_rows)

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


@router.post(
    "/events/upload",
    response_model=MultiFileUploadResponse,
    summary="Ingest one or several billing CSV files in a single multipart request",
)
async def upload_billing_files(
    files: Annotated[List[UploadFile], File(description="One or more billing CSV files")],
    replace: Annotated[bool, Form(description="If true, wipe the store before ingesting")] = False,
) -> MultiFileUploadResponse:
    """Upload one or more billing CSVs (multipart/form-data).

    Accepted headers per file are auto-detected among common variants
    (Rapports Billing GCP export, AWS CUR summaries, etc.). Per-row parsing
    failures are silently skipped and surfaced in the ``warnings`` field so
    a bad row in one file doesn't fail the whole batch.
    """
    global _injected_events

    if not files:
        raise BadRequest("No files provided.")

    all_rows: list[dict] = []
    per_file: dict[str, int] = {}
    warnings: list[str] = []

    for uf in files:
        raw = await uf.read()
        rows, file_warnings = _parse_billing_csv(uf.filename or "unnamed.csv", raw)
        all_rows.extend(rows)
        per_file[uf.filename or "unnamed.csv"] = len(rows)
        warnings.extend(file_warnings)

    if not all_rows:
        raise BadRequest(
            "No rows could be parsed from the uploaded files.",
            details={"warnings": warnings, "per_file": per_file},
        )

    if replace:
        _injected_events = list(all_rows)
    else:
        if len(_injected_events) + len(all_rows) > _MAX_STORE_SIZE:
            raise BadRequest(
                f"Appending {len(all_rows)} rows would exceed the store cap "
                f"of {_MAX_STORE_SIZE}. Retry with replace=true.",
                details={
                    "current_size": len(_injected_events),
                    "incoming": len(all_rows),
                    "max": _MAX_STORE_SIZE,
                },
            )
        _injected_events.extend(all_rows)

    # Invalidate downstream caches so analytics/forecast see the fresh data.
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

    df = _build_dataframe(_injected_events)
    dates = df["ds"].dt.strftime("%Y-%m-%d")
    total_spend = float(df["Sous-total (€)"].sum())
    unique_days = df["ds"].nunique()
    daily_avg = total_spend / unique_days if unique_days > 0 else 0.0

    logger.info(
        "events_upload_complete",
        extra={
            "files": len(files),
            "ingested": len(all_rows),
            "warnings": len(warnings),
        },
    )

    return MultiFileUploadResponse(
        files_processed=len(files),
        ingested=len(all_rows),
        total_rows=len(_injected_events),
        date_range=DateRange(start=dates.min(), end=dates.max()),
        preview_kpi=PreviewKPI(total_spend=round(total_spend, 2), daily_avg=round(daily_avg, 2)),
        per_file=per_file,
        warnings=warnings,
    )


def get_injected_events_df() -> pd.DataFrame:
    """Return the current injected events as a DataFrame (used by other modules)."""
    return _build_dataframe(_injected_events)
