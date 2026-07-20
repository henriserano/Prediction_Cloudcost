from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from core.config import get_settings
from core.errors import AppError
from core.logging import get_logger, request_id_ctx, setup_logging
from core.session import decode_session
from core.user_context import reset_current_user_id, set_current_user_id
from routes.routes_advanced import router as advanced_router
from routes.routes_analytics import router as analytics_router
from routes.routes_auth import router as auth_router
from routes.routes_aws import router as aws_router
from routes.routes_azure import router as azure_router
from routes.routes_chat import router as chat_router
from routes.routes_conversations import router as conversations_router
from routes.routes_credentials import router as credentials_router
from routes.routes_data import router as data_router
from routes.routes_events import router as events_router
from routes.routes_forecast import router as forecast_router
from routes.routes_gcp import router as gcp_router
from routes.routes_health import router as health_router
from routes.routes_local_billing import router as local_billing_router
from routes.routes_portfolios import router as portfolios_router
from routes.routes_simulation import router as simulation_router

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    setup_logging(level="INFO", json_logs=True)

    # SEC-018: fail fast if argon2-cffi is missing or has a broken native
    # binding — otherwise the first /signup call would surface a 500 to the
    # user instead of a clear boot-time error.
    from core.crypto import smoke_test_argon2

    try:
        smoke_test_argon2()
        logger.info("argon2_smoke_ok")
    except Exception as exc:
        logger.error("argon2_smoke_failed", extra={"error": repr(exc)})
        raise RuntimeError(
            "Argon2 self-test failed at startup. Install/repair argon2-cffi "
            "(and argon2-cffi-bindings on musl/alpine images) and restart."
        ) from exc

    from data.loader import load_daily_costs, load_daily_per_service

    load_daily_costs()
    load_daily_per_service()
    logger.info("data_loaded")
    logger.info(
        "startup_config",
        extra={
            "google_redirect_uri": settings.google_redirect_uri,
            "frontend_url": settings.frontend_url,
        },
    )

    from core.precompute import warm_cache

    precompute_summary = await warm_cache()
    logger.info(
        "cache_ready", extra={"ok": precompute_summary["ok"], "total": precompute_summary["total"]}
    )

    yield


settings = get_settings()

# SEC-008 / SEC-012: CORS wildcard with credentials is a hard error in prod.
# In prod, CORS_ORIGINS must be set to the specific frontend domain (e.g.
# "https://finops.example.com") — never "*". The wildcard default is
# only acceptable for local development, where it stays a warning.
if "*" in settings.cors_origins_list:
    if settings.env == "prod":
        raise RuntimeError(
            "SECURITY (SEC-012): CORS_ORIGINS is '*' in production while "
            "allow_credentials=True. Set CORS_ORIGINS to the specific frontend "
            "domain(s) and restart."
        )
    logger.warning(
        "SECURITY: cors_origins is set to '*'. "
        "Set CORS_ORIGINS to the specific frontend domain before deploying to prod.",
    )

# SEC-013: Mutating/admin endpoints are protected by the X-API-Key header.
# Refuse to start in prod when no API key is configured — otherwise those
# endpoints would silently be left open.
if settings.env == "prod" and not settings.api_key:
    raise RuntimeError(
        "SECURITY (SEC-013): API_KEY is empty in production. Set the API_KEY "
        "environment variable (used to authenticate X-API-Key on mutating "
        "endpoints) and restart."
    )

# SEC-021 (H-5): the JWT signing key must be provided in prod. Without an
# explicit ``SESSION_SECRET`` the auth layer falls back to an in-process
# ephemeral secret — every worker or ECS task rotation silently invalidates
# every session, and horizontal scaling produces per-worker key divergence.
if settings.env == "prod" and not settings.session_secret:
    raise RuntimeError(
        "SECURITY (SEC-021): SESSION_SECRET is empty in production. Provision "
        "a 32-byte random secret (see Secrets Manager) and restart."
    )

# SEC-011: Disable interactive API docs AND the raw OpenAPI schema in
# production. Without ``openapi_url=None`` the schema itself is still
# served at /openapi.json even when Swagger/Redoc are off, so an attacker
# gets the full endpoint list for free.
_docs_url = "/docs" if settings.env != "prod" else None
_redoc_url = "/redoc" if settings.env != "prod" else None
_openapi_url = "/openapi.json" if settings.env != "prod" else None

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="FinOps GCP — REST API for cost analysis and forecasting",
    lifespan=lifespan,
    docs_url=_docs_url,
    redoc_url=_redoc_url,
    openapi_url=_openapi_url,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    """SEC-009: Add security response headers to every response."""
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    # SEC-022: X-XSS-Protection was removed. Modern browsers ignore or actively
    # de-recommend it (older Chromium versions were subject to XS-Leaks via the
    # filter). CSP below is the load-bearing defence.
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    # SEC-023: minimal CSP for a JSON API. ``default-src 'none'`` blocks any
    # accidental HTML/JS execution should a route ever return non-JSON;
    # ``frame-ancestors 'none'`` complements X-Frame-Options for older UAs.
    response.headers["Content-Security-Policy"] = (
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
    )
    if settings.env == "prod":
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    return response


@app.middleware("http")
async def user_context_middleware(request: Request, call_next):
    """SEC-020: populate the per-request user_id ContextVar from the session
    cookie so downstream loaders/store lookups can scope per-user without
    threading the id through every function signature.

    This middleware never raises 401 — routes that require an authenticated
    caller depend on ``require_current_user_id`` (which does). Anonymous
    callers just get a None scope; per-user stores return empty slices.
    """
    cookie_name = settings.session_cookie_name
    token = request.cookies.get(cookie_name)
    user_id = decode_session(token) if token else None
    ctx_token = set_current_user_id(user_id)
    try:
        return await call_next(request)
    finally:
        reset_current_user_id(ctx_token)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    rid = request.headers.get("X-Request-Id") or uuid.uuid4().hex
    token = request_id_ctx.set(rid)
    try:
        response = await call_next(request)
        response.headers["X-Request-Id"] = rid
        return response
    finally:
        request_id_ctx.reset(token)


@app.middleware("http")
async def api_version_alias_middleware(request: Request, call_next):
    """Transparent /api/v1/* → /api/* alias.

    The dashboard and every existing client call the API at ``/api/<path>``.
    Introducing a versioned prefix in one step would break them all, so this
    middleware accepts ``/api/v1/<path>`` as an alias of the same handler.
    New clients can opt in to ``/api/v1/*`` today; a future ``/api/v2/*`` can
    branch off without touching the unversioned surface.

    The rewrite is transparent (no redirect) so cookies, X-API-Key headers
    and streaming responses all flow through untouched.
    """
    path = request.scope.get("path", "")
    if path.startswith("/api/v1/"):
        request.scope["path"] = "/api/" + path[len("/api/v1/") :]
        # Also rewrite the raw path so downstream logs / URL reconstruction
        # match the effective handler.
        request.scope["raw_path"] = request.scope["path"].encode("ascii")
    elif path == "/api/v1":
        request.scope["path"] = "/api"
        request.scope["raw_path"] = b"/api"
    response = await call_next(request)
    # Advertise the current stable version so clients can discover what they
    # are speaking to without a separate meta endpoint.
    response.headers.setdefault("X-API-Version", "v1")
    return response


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    payload = {"error": {"code": exc.code, "message": exc.message, "details": exc.details}}
    return JSONResponse(status_code=exc.status_code, content=payload)


app.include_router(health_router)
app.include_router(analytics_router)
app.include_router(forecast_router)
app.include_router(gcp_router)
app.include_router(aws_router)
app.include_router(azure_router)
app.include_router(events_router)
app.include_router(data_router)
app.include_router(advanced_router)
app.include_router(chat_router)
app.include_router(auth_router)
app.include_router(conversations_router)
app.include_router(credentials_router)
app.include_router(local_billing_router)
app.include_router(portfolios_router)
app.include_router(simulation_router)
