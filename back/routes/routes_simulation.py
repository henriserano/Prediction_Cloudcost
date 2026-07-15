"""Agentic-project scoping simulator.

Endpoints:

- ``GET  /api/simulation/reference``    → static catalogs (LLMs, tools, targets)
- ``POST /api/simulation/estimate``     → run the deterministic estimator
- ``POST /api/simulation/push``         → ingest projected events into /api/events

The estimator itself lives in :mod:`analysis.simulation`; this module is a thin
routing layer + the FinOps ingestion glue.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from analysis.simulation import get_reference_catalog, simulate
from core.auth import require_api_key
from core.errors import BadRequest
from core.logging import get_logger
from core.session import require_current_user_id
from schemas.gcp import BillingEvent, EventsIngestRequest
from schemas.simulation import (
    ReferenceCatalog,
    SimulationInputs,
    SimulationPushRequest,
    SimulationPushResponse,
    SimulationResult,
)

logger = get_logger(__name__)

router = APIRouter(prefix="/api/simulation", tags=["simulation"])


@router.get(
    "/reference",
    response_model=ReferenceCatalog,
    summary="Reference catalog (LLM pricing, tools, deployment targets)",
)
def reference() -> ReferenceCatalog:
    return get_reference_catalog()


@router.post(
    "/estimate",
    response_model=SimulationResult,
    summary="Run the scoping simulator: cost projection + architecture + risks",
)
def estimate(inputs: SimulationInputs) -> SimulationResult:
    return simulate(inputs)


@router.post(
    "/push",
    response_model=SimulationPushResponse,
    dependencies=[Depends(require_api_key)],
    summary="Ingest the projected monthly events into the FinOps model (append mode)",
)
def push(
    body: SimulationPushRequest,
    user_id: str = Depends(require_current_user_id),
) -> SimulationPushResponse:
    """Push the ``projected_monthly_events`` from an estimate into /api/events.

    Reuses the existing events ingest so the projection lands in the same
    store the dashboard and forecast engine read from. Mode is always
    ``replace=false`` — the workshop scenario adds to the current data.
    """
    if not body.events:
        raise BadRequest("events list must not be empty")

    try:
        events = [BillingEvent(**e) for e in body.events]
    except Exception as exc:
        raise BadRequest(f"Invalid event payload: {exc}") from exc

    # Delegate to the canonical ingest — pass user_id explicitly since Depends
    # sentinels don't resolve on direct Python calls (would drop rows in a
    # phantom slot no downstream reader can see).
    from routes.routes_events import ingest_events

    resp = ingest_events(
        EventsIngestRequest(events=events, replace=False),
        user_id=user_id,
    )
    logger.info(
        "simulation_pushed",
        extra={
            "project_name": body.project_name,
            "ingested": resp.ingested,
        },
    )
    return SimulationPushResponse(
        ingested=resp.ingested,
        project_name=body.project_name,
        period_start=resp.date_range.start,
        period_end=resp.date_range.end,
    )
