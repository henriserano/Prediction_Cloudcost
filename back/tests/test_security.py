"""Security regression tests.

Covers the SEC-01x fixes:
  - SEC-013: X-API-Key required on mutating endpoints when API_KEY is set.
  - SEC-014: GCP OAuth tokens are bound to a per-browser session (sid cookie);
    two sessions never see each other's token, logout only clears the caller.
  - SEC-016: multipart uploads are size- and count-capped.
  - SEC-017: empty/short series produce a clean 422, not a 500 traceback.
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
    """Stub parquet loaders + cache warmup so tests run without data files."""
    import data.loader as loader

    empty_daily = pd.DataFrame(columns=["ds", "y"])
    empty_per_service = pd.DataFrame(columns=["ds"])

    def _stub(df):
        def _loader():
            return df
        # invalidate_cache() calls .cache_clear() on the (normally lru_cached)
        # loaders — the stub must expose it too.
        _loader.cache_clear = lambda: None
        return _loader

    monkeypatch.setattr(loader, "load_daily_costs", _stub(empty_daily))
    monkeypatch.setattr(loader, "load_daily_per_service", _stub(empty_per_service))

    import core.precompute as precompute

    async def _noop_warm_cache():
        return {"ok": 0, "total": 0}

    monkeypatch.setattr(precompute, "warm_cache", _noop_warm_cache)


@pytest.fixture(autouse=True)
def clean_state():
    """Isolate the shared in-memory state between tests."""
    from routes import routes_events, routes_gcp
    from core.cache import app_cache
    from data.loader import invalidate_cache

    routes_events._injected_events = []
    with routes_gcp._state_lock:
        routes_gcp._token_store.clear()
        routes_gcp._oauth_states.clear()
    app_cache.clear()
    invalidate_cache()
    yield
    routes_events._injected_events = []
    with routes_gcp._state_lock:
        routes_gcp._token_store.clear()
        routes_gcp._oauth_states.clear()
    app_cache.clear()
    invalidate_cache()


def _client():
    import httpx
    from httpx import ASGITransport
    from main import app

    return httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


_EVENT_PAYLOAD = {
    "events": [{"date": "2026-01-15", "service": "Cloud SQL", "cost": 1.0}],
    "replace": True,
}


# ─────────────────────────────────────────────────────────────────────────────
# SEC-013 — require_api_key
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_events_open_when_no_api_key_configured_in_dev(monkeypatch):
    """Empty API_KEY + env=dev → mutating endpoints stay open (local dev)."""
    from core.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "api_key", "")
    monkeypatch.setattr(settings, "env", "dev")

    async with _client() as client:
        response = await client.post("/api/events", json=_EVENT_PAYLOAD)
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_events_401_without_key_when_api_key_configured(monkeypatch):
    from core.config import get_settings

    monkeypatch.setattr(get_settings(), "api_key", "sekret-key")

    async with _client() as client:
        response = await client.post("/api/events", json=_EVENT_PAYLOAD)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


@pytest.mark.asyncio
async def test_events_401_with_wrong_key(monkeypatch):
    from core.config import get_settings

    monkeypatch.setattr(get_settings(), "api_key", "sekret-key")

    async with _client() as client:
        response = await client.post(
            "/api/events", json=_EVENT_PAYLOAD, headers={"X-API-Key": "wrong"}
        )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_events_200_with_correct_key(monkeypatch):
    from core.config import get_settings

    monkeypatch.setattr(get_settings(), "api_key", "sekret-key")

    async with _client() as client:
        response = await client.post(
            "/api/events", json=_EVENT_PAYLOAD, headers={"X-API-Key": "sekret-key"}
        )
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_admin_cache_clear_requires_key(monkeypatch):
    from core.config import get_settings

    monkeypatch.setattr(get_settings(), "api_key", "sekret-key")

    async with _client() as client:
        denied = await client.post("/admin/cache/clear")
        allowed = await client.post("/admin/cache/clear", headers={"X-API-Key": "sekret-key"})
    assert denied.status_code == 401
    assert allowed.status_code == 200


# ─────────────────────────────────────────────────────────────────────────────
# SEC-014 — GCP session isolation
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_gcp_status_isolated_between_sessions():
    """A token stored for sid A must be invisible to sid B and to anonymous."""
    from routes import routes_gcp

    routes_gcp._store_session_token("sid-aaa", {"access_token": "tok", "email": "a@example.com"})

    async with _client() as client:
        as_a = (await client.get("/api/gcp/status", headers={"Cookie": "sid=sid-aaa"})).json()
        as_b = (await client.get("/api/gcp/status", headers={"Cookie": "sid=sid-bbb"})).json()
        anon = (await client.get("/api/gcp/status")).json()

    assert as_a["authenticated"] is True
    assert as_a["email"] == "a@example.com"
    assert as_b["authenticated"] is False
    assert anon["authenticated"] is False


@pytest.mark.asyncio
async def test_gcp_authenticated_endpoints_401_for_other_session():
    from routes import routes_gcp

    routes_gcp._store_session_token("sid-aaa", {"access_token": "tok"})

    async with _client() as client:
        response = await client.get(
            "/api/gcp/billing-accounts", headers={"Cookie": "sid=sid-bbb"}
        )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


@pytest.mark.asyncio
async def test_gcp_logout_only_clears_requester_session():
    from routes import routes_gcp

    routes_gcp._store_session_token("sid-aaa", {"access_token": "tok-a"})
    routes_gcp._store_session_token("sid-bbb", {"access_token": "tok-b"})

    async with _client() as client:
        response = await client.get("/api/gcp/logout", headers={"Cookie": "sid=sid-aaa"})
    assert response.status_code == 200

    with routes_gcp._state_lock:
        assert "sid-aaa" not in routes_gcp._token_store
        assert "sid-bbb" in routes_gcp._token_store


def test_gcp_session_store_cap_evicts_oldest():
    from routes import routes_gcp

    for i in range(routes_gcp._MAX_SESSIONS + 5):
        routes_gcp._store_session_token(f"sid-{i:04d}", {"access_token": f"tok-{i}"})

    with routes_gcp._state_lock:
        assert len(routes_gcp._token_store) <= routes_gcp._MAX_SESSIONS
        # Oldest sessions were evicted, newest kept.
        assert "sid-0000" not in routes_gcp._token_store
        assert f"sid-{routes_gcp._MAX_SESSIONS + 4:04d}" in routes_gcp._token_store


# ─────────────────────────────────────────────────────────────────────────────
# SEC-017 — empty/short series guards
# ─────────────────────────────────────────────────────────────────────────────

def test_get_forecast_raises_not_enough_data_on_empty_series(monkeypatch):
    import forecast.engine as engine
    from core.errors import AppError

    monkeypatch.setattr(engine, "load_daily_costs", lambda: pd.DataFrame(columns=["ds", "y"]))

    with pytest.raises(AppError) as exc_info:
        engine.get_forecast(30, "ETS")
    assert exc_info.value.status_code == 422
    assert exc_info.value.code == "NOT_ENOUGH_DATA"


def test_descriptive_stats_raises_on_empty_series(monkeypatch):
    import analysis.timeseries as ts
    from core.errors import AppError

    monkeypatch.setattr(ts, "load_daily_costs", lambda: pd.DataFrame(columns=["ds", "y"]))

    with pytest.raises(AppError) as exc_info:
        ts.get_descriptive_stats()
    assert exc_info.value.status_code == 422


def test_stl_raises_on_short_series(monkeypatch):
    import analysis.timeseries as ts
    from core.errors import AppError

    short = pd.DataFrame(
        {"ds": pd.date_range("2026-01-01", periods=10, freq="D"), "y": range(10)}
    )
    monkeypatch.setattr(ts, "load_daily_costs", lambda: short)

    with pytest.raises(AppError) as exc_info:
        ts.get_stl_decomposition()
    assert exc_info.value.status_code == 422


@pytest.mark.asyncio
async def test_stats_route_returns_422_not_500_on_empty_series(monkeypatch):
    import analysis.timeseries as ts

    monkeypatch.setattr(ts, "load_daily_costs", lambda: pd.DataFrame(columns=["ds", "y"]))

    async with _client() as client:
        response = await client.get("/api/stats")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "NOT_ENOUGH_DATA"


# ─────────────────────────────────────────────────────────────────────────────
# SEC-016 — upload caps
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_upload_rejects_too_many_files():
    from routes.routes_events import _MAX_FILES_PER_REQUEST

    files = [
        ("files", (f"f{i}.csv", b"Date,Service,Cost\n2026-01-01,SQL,1\n", "text/csv"))
        for i in range(_MAX_FILES_PER_REQUEST + 1)
    ]
    async with _client() as client:
        response = await client.post("/api/events/upload", files=files)
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_upload_rejects_oversized_file_with_413(monkeypatch):
    # Shrink the cap so the test does not allocate 10 MB.
    import routes.routes_events as re_mod

    monkeypatch.setattr(re_mod, "_MAX_FILE_BYTES", 1024)
    big = b"Date,Service,Cost\n" + b"x" * 2048
    async with _client() as client:
        response = await client.post(
            "/api/events/upload",
            files=[("files", ("big.csv", big, "text/csv"))],
        )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"


# ─────────────────────────────────────────────────────────────────────────────
# Model registry — legacy aliases still resolve
# ─────────────────────────────────────────────────────────────────────────────

def test_legacy_model_aliases_resolve():
    from forecast.engine import MODELS, MODEL_ALIASES, resolve_model

    for legacy, honest in MODEL_ALIASES.items():
        assert resolve_model(legacy) == honest
        assert honest in MODELS
    assert resolve_model("ETS") == "ETS"
    assert resolve_model("nope") is None
