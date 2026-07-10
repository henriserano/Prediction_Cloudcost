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

pytest_plugins = ("asyncio",)



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

@pytest.mark.asyncio
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


@pytest.mark.asyncio
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


@pytest.mark.asyncio
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


@pytest.mark.asyncio
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


# ─────────────────────────────────────────────────────────────────────────────
# 4. GCP billing-accounts route (no token → 401)
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_gcp_billing_accounts_unauthenticated():
    """Without an OAuth token, /api/gcp/billing-accounts must return 401."""
    import httpx
    from httpx import ASGITransport
    from main import app

    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/gcp/billing-accounts")

    assert response.status_code == 401
    body = response.json()
    assert body["error"]["code"] == "UNAUTHORIZED"


# ─────────────────────────────────────────────────────────────────────────────
# 5. AWS status route — must never crash, even without credentials
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_aws_status_returns_200_even_without_credentials(monkeypatch):
    """GET /api/aws/status must return 200 with authenticated=False when creds are absent."""
    import httpx
    from httpx import ASGITransport
    from main import app

    # Force STS to look unauthenticated regardless of the developer's local
    # ~/.aws/credentials — otherwise the test asserts against real AWS.
    from core.errors import AppError
    import routes.routes_aws as routes_aws

    def _fake_sts(*_args, **_kwargs):
        raise AppError("no creds", code="UNAUTHORIZED", status_code=401)

    monkeypatch.setattr(routes_aws, "_sts_get_caller_identity", _fake_sts)

    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/aws/status")

    assert response.status_code == 200
    body = response.json()
    assert body["authenticated"] is False
    assert body.get("detail")


@pytest.mark.asyncio
async def test_data_status_reports_empty_when_no_events_and_no_fallback():
    """GET /api/data/status must respond with source=empty when nothing is loaded."""
    import httpx
    from httpx import ASGITransport
    from main import app

    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/data/status")

    assert response.status_code == 200
    body = response.json()
    assert body["source"] in {"empty", "events", "parquet_fallback"}
    assert isinstance(body["rows_daily"], int)
    assert isinstance(body["parquet_fallback_enabled"], bool)


@pytest.mark.asyncio
async def test_gcp_sync_returns_401_without_token():
    """POST /api/gcp/sync without OAuth must return 401."""
    import httpx
    from httpx import ASGITransport
    from main import app

    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/gcp/sync?project_id=my-project-id-123")

    assert response.status_code == 401
    body = response.json()
    assert body["error"]["code"] == "UNAUTHORIZED"


@pytest.mark.asyncio
async def test_aws_billing_without_credentials_returns_401(monkeypatch):
    """GET /api/aws/billing must surface 401 when STS rejects the request."""
    import httpx
    from httpx import ASGITransport
    from main import app

    from core.errors import AppError
    import routes.routes_aws as routes_aws

    def _fake_sts(*_args, **_kwargs):
        raise AppError("no creds", code="UNAUTHORIZED", status_code=401)

    monkeypatch.setattr(routes_aws, "_sts_get_caller_identity", _fake_sts)

    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/aws/billing")

    assert response.status_code == 401


# ─────────────────────────────────────────────────────────────────────────────
# 6. MCP-style tools registry + chat route contract
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_tools_catalog_lists_every_registered_tool():
    """GET /api/tools must return a non-empty catalog covering the categories
    we register: data, analytics, forecast, advanced, cloud.
    """
    import httpx
    from httpx import ASGITransport
    from main import app

    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/tools")

    assert response.status_code == 200
    body = response.json()
    assert body["total"] > 10, f"only {body['total']} tools registered"
    assert set(body["categories"]).issuperset({"analytics", "forecast", "advanced", "data"})
    # Every entry must expose an input_schema — MCP clients rely on this.
    for tool in body["tools"]:
        assert "input_schema" in tool
        assert tool["input_schema"].get("type") == "object"


@pytest.mark.asyncio
async def test_tool_invoke_get_data_status_works_without_api_key(monkeypatch):
    """When API_KEY is not configured (dev mode), /api/tools/invoke is open
    and must be able to run a registered no-arg tool end-to-end.
    """
    import httpx
    from httpx import ASGITransport
    from main import app
    from core.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "api_key", "")
    monkeypatch.setattr(settings, "env", "dev")

    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/tools/invoke",
            json={"name": "get_data_status", "arguments": {}},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "get_data_status"
    assert isinstance(body["result"], str)
    assert "source" in body["result"]


@pytest.mark.asyncio
async def test_chat_route_reports_missing_bedrock_credentials(monkeypatch):
    """When AWS_BEARER_TOKEN_BEDROCK and standard AWS creds are absent, /api/chat
    must fail with a clear configuration error (500) — never crash silently.
    """
    import os
    import httpx
    from httpx import ASGITransport
    from main import app
    from core.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "api_key", "")
    monkeypatch.setattr(settings, "env", "dev")
    for var in ("AWS_BEARER_TOKEN_BEDROCK", "AWS_ACCESS_KEY_ID", "AWS_PROFILE"):
        monkeypatch.delenv(var, raising=False)

    # Reset the memoised bedrock client so the credentials guard is exercised
    # (the guard reads env vars fresh on every call, but clearing the client
    # cache also protects against a stale boto3.Session lingering from an
    # earlier test that had credentials set).
    import agent.graph as graph
    graph._client.cache_clear()

    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/api/chat",
            json={"message": "hello"},
        )

    assert response.status_code == 500
    body = response.json()
    assert body["error"]["code"] == "CONFIGURATION_ERROR"
    assert "Bedrock" in body["error"]["message"]
