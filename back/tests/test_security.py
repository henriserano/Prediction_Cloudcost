"""Security regression tests.

Covers the SEC-01x / SEC-02x fixes:
  - SEC-013: X-API-Key required on mutating endpoints when API_KEY is set.
  - SEC-014: GCP OAuth tokens are bound to a per-browser session (sid cookie)
    AND to the authenticated JWT user (SEC-020 tightening — cross-user replay
    of gcp_sid is refused).
  - SEC-016: multipart uploads are size- and count-capped.
  - SEC-017: empty/short series produce a clean 422, not a 500 traceback.
  - SEC-020: per-user events store — anonymous callers never see any user's
    ingested data, and analytics/forecast routes require authentication.
"""

from __future__ import annotations

import pandas as pd
import pytest

pytest_plugins = ("asyncio",)

_TEST_USER_ID = "test-user"


def _issue_test_session(user_id: str = _TEST_USER_ID) -> str:
    """Return a valid JWT signed with the current SESSION_SECRET so httpx
    ASGI requests carry an authenticated identity through the middleware.
    """
    from core.session import issue_session

    return issue_session(user_id)


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
    from core.cache import app_cache
    from data.loader import invalidate_cache
    from routes import routes_events, routes_gcp

    routes_events._injected_events.clear()
    with routes_gcp._state_lock:
        routes_gcp._token_store.clear()
        routes_gcp._oauth_states.clear()
    app_cache.clear()
    invalidate_cache()
    yield
    routes_events._injected_events.clear()
    with routes_gcp._state_lock:
        routes_gcp._token_store.clear()
        routes_gcp._oauth_states.clear()
    app_cache.clear()
    invalidate_cache()


@pytest.fixture
def user_context(monkeypatch):
    """Set the per-request ContextVar so functions that read events pick up
    the test user's slice. Only needed for tests calling analysis functions
    directly — HTTP tests get the ContextVar populated by the middleware
    when the ``sid`` cookie is present.
    """
    from core.user_context import reset_current_user_id, set_current_user_id

    tok = set_current_user_id(_TEST_USER_ID)
    yield _TEST_USER_ID
    reset_current_user_id(tok)


def _client():
    import httpx
    from httpx import ASGITransport

    from main import app

    return httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _auth_cookies() -> dict:
    from core.config import get_settings

    return {get_settings().session_cookie_name: _issue_test_session()}


_EVENT_PAYLOAD = {
    "events": [{"date": "2026-01-15", "service": "Cloud SQL", "cost": 1.0}],
    "replace": True,
}


# ─────────────────────────────────────────────────────────────────────────────
# SEC-013 — require_api_key
# ─────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_events_open_when_no_api_key_configured_in_dev(monkeypatch):
    """Empty API_KEY + env=dev → mutating endpoints stay open to authenticated
    callers (local dev). Anonymous still rejected by SEC-020."""
    from core.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "api_key", "")
    monkeypatch.setattr(settings, "env", "dev")

    async with _client() as client:
        response = await client.post("/api/events", json=_EVENT_PAYLOAD, cookies=_auth_cookies())
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_events_401_without_key_when_api_key_configured(monkeypatch):
    from core.config import get_settings

    monkeypatch.setattr(get_settings(), "api_key", "sekret-key")

    async with _client() as client:
        response = await client.post("/api/events", json=_EVENT_PAYLOAD, cookies=_auth_cookies())
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


@pytest.mark.asyncio
async def test_events_401_with_wrong_key(monkeypatch):
    from core.config import get_settings

    monkeypatch.setattr(get_settings(), "api_key", "sekret-key")

    async with _client() as client:
        response = await client.post(
            "/api/events",
            json=_EVENT_PAYLOAD,
            headers={"X-API-Key": "wrong"},
            cookies=_auth_cookies(),
        )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_events_200_with_correct_key(monkeypatch):
    from core.config import get_settings

    monkeypatch.setattr(get_settings(), "api_key", "sekret-key")

    async with _client() as client:
        response = await client.post(
            "/api/events",
            json=_EVENT_PAYLOAD,
            headers={"X-API-Key": "sekret-key"},
            cookies=_auth_cookies(),
        )
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_events_401_anonymous_even_with_valid_api_key(monkeypatch):
    """SEC-020: mutating events endpoint additionally requires an authenticated
    session — an X-API-Key alone (no ``sid`` cookie) is not enough."""
    from core.config import get_settings

    monkeypatch.setattr(get_settings(), "api_key", "sekret-key")

    async with _client() as client:
        response = await client.post(
            "/api/events",
            json=_EVENT_PAYLOAD,
            headers={"X-API-Key": "sekret-key"},
        )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_analytics_endpoint_requires_authentication():
    """SEC-020: analytics routes now reject anonymous callers so they cannot
    read another user's most-recent events store."""
    async with _client() as client:
        response = await client.get("/api/kpi")
    assert response.status_code == 401


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
    """A token stored for sid A + user A must be invisible to sid B and to
    an authenticated user other than A (SEC-014 + SEC-020 tightening)."""
    from routes import routes_gcp

    routes_gcp._store_session_token(
        "sid-aaa",
        {"access_token": "tok", "email": "a@example.com"},
        user_id=_TEST_USER_ID,
    )
    other_jwt = _issue_test_session("other-user")

    async with _client() as client:
        as_a = (
            await client.get(
                "/api/gcp/status",
                headers={"Cookie": f"gcp_sid=sid-aaa; sid={_issue_test_session()}"},
            )
        ).json()
        # Same gcp_sid but different JWT user — must fall back to "unauthenticated".
        as_other = (
            await client.get(
                "/api/gcp/status",
                headers={"Cookie": f"gcp_sid=sid-aaa; sid={other_jwt}"},
            )
        ).json()
        as_b = (
            await client.get(
                "/api/gcp/status",
                headers={"Cookie": f"gcp_sid=sid-bbb; sid={_issue_test_session()}"},
            )
        ).json()
        anon = (await client.get("/api/gcp/status")).json()

    assert as_a["authenticated"] is True
    assert as_a["email"] == "a@example.com"
    assert as_other["authenticated"] is False
    assert as_b["authenticated"] is False
    assert anon["authenticated"] is False


@pytest.mark.asyncio
async def test_gcp_authenticated_endpoints_401_for_other_session():
    from routes import routes_gcp

    routes_gcp._store_session_token("sid-aaa", {"access_token": "tok"}, user_id=_TEST_USER_ID)

    async with _client() as client:
        response = await client.get(
            "/api/gcp/billing-accounts",
            headers={"Cookie": f"gcp_sid=sid-bbb; sid={_issue_test_session()}"},
        )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


@pytest.mark.asyncio
async def test_gcp_logout_only_clears_requester_session():
    from routes import routes_gcp

    routes_gcp._store_session_token("sid-aaa", {"access_token": "tok-a"}, user_id=_TEST_USER_ID)
    routes_gcp._store_session_token("sid-bbb", {"access_token": "tok-b"}, user_id="other-user")

    async with _client() as client:
        response = await client.get(
            "/api/gcp/logout",
            headers={"Cookie": f"gcp_sid=sid-aaa; sid={_issue_test_session()}"},
        )
    assert response.status_code == 200

    with routes_gcp._state_lock:
        assert "sid-aaa" not in routes_gcp._token_store
        assert "sid-bbb" in routes_gcp._token_store


def test_gcp_session_store_cap_evicts_oldest():
    from routes import routes_gcp

    for i in range(routes_gcp._MAX_SESSIONS + 5):
        routes_gcp._store_session_token(
            f"sid-{i:04d}", {"access_token": f"tok-{i}"}, user_id=f"u-{i}"
        )

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
    # NotEnoughData now returns 400 with a machine-readable code — 422 was
    # reserved for FastAPI's own schema-validation failures, mixing the two
    # made it impossible for the front to dispatch on the reason.
    assert exc_info.value.status_code == 400
    assert exc_info.value.code == "NOT_ENOUGH_DATA"


def test_descriptive_stats_raises_on_empty_series(monkeypatch):
    import analysis.timeseries as ts
    from core.errors import AppError

    monkeypatch.setattr(ts, "load_daily_costs", lambda: pd.DataFrame(columns=["ds", "y"]))

    with pytest.raises(AppError) as exc_info:
        ts.get_descriptive_stats()
    assert exc_info.value.status_code == 400
    assert exc_info.value.code == "NOT_ENOUGH_DATA"


def test_stl_raises_on_short_series(monkeypatch):
    import analysis.timeseries as ts
    from core.errors import AppError

    short = pd.DataFrame({"ds": pd.date_range("2026-01-01", periods=10, freq="D"), "y": range(10)})
    monkeypatch.setattr(ts, "load_daily_costs", lambda: short)

    with pytest.raises(AppError) as exc_info:
        ts.get_stl_decomposition()
    assert exc_info.value.status_code == 400
    assert exc_info.value.code == "NOT_ENOUGH_DATA"


@pytest.mark.asyncio
async def test_stats_route_returns_400_not_500_on_empty_series(monkeypatch):
    import analysis.timeseries as ts

    monkeypatch.setattr(ts, "load_daily_costs", lambda: pd.DataFrame(columns=["ds", "y"]))

    async with _client() as client:
        response = await client.get("/api/stats", cookies=_auth_cookies())
    # 400 + NOT_ENOUGH_DATA code — see NotEnoughData docstring in core/errors.py.
    assert response.status_code == 400
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
        response = await client.post("/api/events/upload", files=files, cookies=_auth_cookies())
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
            cookies=_auth_cookies(),
        )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"


# ─────────────────────────────────────────────────────────────────────────────
# Model registry — legacy aliases still resolve
# ─────────────────────────────────────────────────────────────────────────────


def test_legacy_model_aliases_resolve():
    from forecast.engine import MODEL_ALIASES, MODELS, resolve_model

    for legacy, honest in MODEL_ALIASES.items():
        assert resolve_model(legacy) == honest
        assert honest in MODELS
    assert resolve_model("ETS") == "ETS"
    assert resolve_model("nope") is None


# ─────────────────────────────────────────────────────────────────────────────
# SEC-020 — analytics/forecast result cache is scoped per user
# ─────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_analytics_and_forecast_cache_isolated_between_users(monkeypatch):
    """Regression for the cross-tenant cache leak: user A's cached /api/kpi
    and /api/forecast results must never be served to user B.

    Before the fix, the compute layer cached under global keys
    ("analytics:kpi", "forecast:ETS:30") while the data underneath was
    per-user — the first user to warm the cache decided everyone's numbers.
    """
    from core.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "api_key", "")
    monkeypatch.setattr(settings, "env", "dev")

    def _events(amount: float) -> dict:
        dates = pd.date_range("2026-01-01", periods=30, freq="D")
        return {
            "events": [
                {"date": d.strftime("%Y-%m-%d"), "service": "Cloud SQL", "cost": amount}
                for d in dates
            ],
            "replace": True,
        }

    cookie_name = settings.session_cookie_name
    cookies_a = {cookie_name: _issue_test_session("user-a")}
    cookies_b = {cookie_name: _issue_test_session("user-b")}

    async with _client() as client:
        r = await client.post("/api/events", json=_events(100.0), cookies=cookies_a)
        assert r.status_code == 200
        r = await client.post("/api/events", json=_events(200.0), cookies=cookies_b)
        assert r.status_code == 200

        # A warms the cache first — B's read right after is the leak scenario.
        kpi_a = (await client.get("/api/kpi", cookies=cookies_a)).json()
        kpi_b = (await client.get("/api/kpi", cookies=cookies_b)).json()
        # Second read for A hits the cache and must still be A's numbers.
        kpi_a2 = (await client.get("/api/kpi", cookies=cookies_a)).json()

        fc_a = (
            await client.get("/api/forecast/summary?horizon=30&model=ETS", cookies=cookies_a)
        ).json()
        fc_b = (
            await client.get("/api/forecast/summary?horizon=30&model=ETS", cookies=cookies_b)
        ).json()

    assert kpi_a["total_spend"] == pytest.approx(30 * 100.0)
    assert kpi_b["total_spend"] == pytest.approx(30 * 200.0)
    assert kpi_a2 == kpi_a

    # Forecasts on a flat series converge to the series level — each user must
    # get a total in their own order of magnitude, not the other's.
    assert fc_a["total_forecast"] == pytest.approx(30 * 100.0, rel=0.15)
    assert fc_b["total_forecast"] == pytest.approx(30 * 200.0, rel=0.15)


@pytest.mark.asyncio
async def test_ingest_invalidates_own_scope_only(monkeypatch):
    """An ingest by user B must not evict user A's cached results (the old
    global clear() forced a full walk-forward CV recompute for everyone), and
    B must see fresh numbers immediately after their own re-ingest."""
    from core.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "api_key", "")
    monkeypatch.setattr(settings, "env", "dev")

    def _events(amount: float, n: int = 20) -> dict:
        dates = pd.date_range("2026-02-01", periods=n, freq="D")
        return {
            "events": [
                {"date": d.strftime("%Y-%m-%d"), "service": "BigQuery", "cost": amount}
                for d in dates
            ],
            "replace": True,
        }

    cookie_name = settings.session_cookie_name
    cookies_a = {cookie_name: _issue_test_session("user-a")}
    cookies_b = {cookie_name: _issue_test_session("user-b")}

    from core.cache import app_cache

    async with _client() as client:
        assert (
            await client.post("/api/events", json=_events(50.0), cookies=cookies_a)
        ).status_code == 200
        kpi_a = (await client.get("/api/kpi", cookies=cookies_a)).json()
        assert app_cache.get("user-a:analytics:kpi") is not None

        # B ingests — A's cached entry must survive.
        assert (
            await client.post("/api/events", json=_events(70.0), cookies=cookies_b)
        ).status_code == 200
        assert app_cache.get("user-a:analytics:kpi") is not None

        # B re-ingests different amounts — B's own KPI must refresh.
        kpi_b1 = (await client.get("/api/kpi", cookies=cookies_b)).json()
        assert (
            await client.post("/api/events", json=_events(90.0), cookies=cookies_b)
        ).status_code == 200
        kpi_b2 = (await client.get("/api/kpi", cookies=cookies_b)).json()

    assert kpi_a["total_spend"] == pytest.approx(20 * 50.0)
    assert kpi_b1["total_spend"] == pytest.approx(20 * 70.0)
    assert kpi_b2["total_spend"] == pytest.approx(20 * 90.0)
