"""
Smoke tests for the FinOps backend.

These tests verify:
  - Core imports work without parquet files present
  - Pydantic schema validation enforces constraints
  - Key HTTP routes respond correctly via ASGI test transport

The app lifespan event loads parquet files and warms a cache.
Both loaders are monkeypatched to return empty DataFrames so the
test suite runs without any data files (e.g., in CI).
"""
from __future__ import annotations

import pandas as pd
import pytest

# pytest-anyio registers the anyio backend and the @pytest.mark.anyio marker
pytest_plugins = ("anyio",)

# ─────────────────────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def mock_data_loader(monkeypatch):
    """
    Replace parquet loaders with stubs that return empty DataFrames.
    Also stub warm_cache so the lifespan does not attempt real precomputation.
    This fixture applies to every test in this module automatically.
    """
    import data.loader as loader

    empty_daily = pd.DataFrame(columns=["ds", "y"])
    empty_per_service = pd.DataFrame(columns=["ds"])

    monkeypatch.setattr(loader, "load_daily_costs", lambda: empty_daily)
    monkeypatch.setattr(loader, "load_daily_per_service", lambda: empty_per_service)

    # Stub warm_cache so the lifespan succeeds without real data
    import core.precompute as precompute

    async def _noop_warm_cache():
        return {"ok": 0, "total": 0}

    monkeypatch.setattr(precompute, "warm_cache", _noop_warm_cache)


# ─────────────────────────────────────────────────────────────────────────────
# 1. Import test
# ─────────────────────────────────────────────────────────────────────────────

def test_app_import():
    """Importing main and obtaining the FastAPI app object must not raise."""
    from main import app
    from fastapi import FastAPI
    assert isinstance(app, FastAPI)


# ─────────────────────────────────────────────────────────────────────────────
# 2. Pydantic schema validation
# ─────────────────────────────────────────────────────────────────────────────

def test_events_ingest_request_empty_list_is_accepted_by_pydantic():
    """
    EventsIngestRequest accepts an empty list at the schema level;
    the route layer raises BadRequest — that is tested separately.
    This test simply confirms the model instantiates without error.
    """
    from schemas.gcp import EventsIngestRequest
    req = EventsIngestRequest(events=[], replace=False)
    assert req.events == []


def test_billing_event_negative_cost_raises():
    """BillingEvent.cost must be >= 0; a negative value must raise ValidationError."""
    from pydantic import ValidationError
    from schemas.gcp import BillingEvent

    with pytest.raises(ValidationError) as exc_info:
        BillingEvent(date="2026-01-15", service="Cloud SQL", cost=-1.0)

    errors = exc_info.value.errors()
    # At least one error must reference the cost field
    assert any(e["loc"] == ("cost",) for e in errors)


def test_billing_event_invalid_date_format_raises():
    """BillingEvent.date must match YYYY-MM-DD."""
    from pydantic import ValidationError
    from schemas.gcp import BillingEvent

    with pytest.raises(ValidationError):
        BillingEvent(date="15/01/2026", service="BigQuery", cost=10.0)


def test_billing_event_valid():
    """A well-formed BillingEvent must deserialise without errors."""
    from schemas.gcp import BillingEvent

    evt = BillingEvent(date="2026-01-15", service="BigQuery", cost=42.50)
    assert evt.cost == 42.50
    assert evt.service == "BigQuery"


# ─────────────────────────────────────────────────────────────────────────────
# 3. Route tests — ASGI transport (no real HTTP, no network)
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_health_endpoint_returns_200():
    """GET /health must return HTTP 200."""
    import httpx
    from httpx import ASGITransport
    from main import app

    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body.get("status") == "ok"


@pytest.mark.anyio
async def test_gcp_status_unauthenticated():
    """GET /api/gcp/status without a token must return authenticated=false."""
    import httpx
    from httpx import ASGITransport
    from main import app

    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/gcp/status")

    assert response.status_code == 200
    body = response.json()
    assert body.get("authenticated") is False


@pytest.mark.anyio
async def test_events_ingest_with_valid_body():
    """POST /api/events with a valid single event must return HTTP 200."""
    import httpx
    from httpx import ASGITransport
    from main import app

    payload = {
        "events": [
            {
                "date": "2026-01-15",
                "service": "Cloud SQL",
                "cost": 123.45,
                "description": "smoke test",
            }
        ],
        "replace": True,
    }

    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/events", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body.get("ingested") == 1


@pytest.mark.anyio
async def test_events_ingest_empty_list_returns_400():
    """POST /api/events with an empty events list must return HTTP 400."""
    import httpx
    from httpx import ASGITransport
    from main import app

    payload = {"events": [], "replace": False}

    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/events", json=payload)

    # The route raises BadRequest when events list is empty
    assert response.status_code == 400
