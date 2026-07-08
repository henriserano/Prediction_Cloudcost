from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from typing import AsyncGenerator

# Load .env BEFORE any module that reads os.environ (boto3, ChatBedrockConverse,
# etc.) is imported. pydantic-settings alone only populates the Settings object,
# not os.environ, so AWS_BEARER_TOKEN_BEDROCK / AWS_PROFILE would otherwise be
# invisible to the boto3 default credential chain.
try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    # python-dotenv missing: rely on the shell environment. pydantic-settings
    # still works via its own dotenv reader for the Settings model itself.
    pass

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from core.config import get_settings
from core.errors import AppError
from core.logging import get_logger, request_id_ctx, setup_logging
from routes.routes_analytics import router as analytics_router
from routes.routes_forecast import router as forecast_router
from routes.routes_health import router as health_router
from routes.routes_gcp import router as gcp_router
from routes.routes_aws import router as aws_router
from routes.routes_events import router as events_router
from routes.routes_data import router as data_router
from routes.routes_advanced import router as advanced_router
from routes.routes_chat import router as chat_router
from routes.routes_tools import router as tools_router
from routes.routes_auth import router as auth_router
from routes.routes_conversations import router as conversations_router
from routes.routes_credentials import router as credentials_router
from routes.routes_simulation import router as simulation_router

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    setup_logging(level="INFO", json_logs=True)

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
    logger.info("cache_ready", extra={"ok": precompute_summary["ok"], "total": precompute_summary["total"]})

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

# SEC-011: Disable interactive API docs in production to avoid exposing the
# full API surface and enabling direct endpoint invocation by attackers.
_docs_url = "/docs" if settings.env != "prod" else None
_redoc_url = "/redoc" if settings.env != "prod" else None

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="FinOps GCP — REST API for cost analysis and forecasting",
    lifespan=lifespan,
    docs_url=_docs_url,
    redoc_url=_redoc_url,
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
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if settings.env == "prod":
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    return response


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


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    payload = {"error": {"code": exc.code, "message": exc.message, "details": exc.details}}
    return JSONResponse(status_code=exc.status_code, content=payload)


app.include_router(health_router)
app.include_router(analytics_router)
app.include_router(forecast_router)
app.include_router(gcp_router)
app.include_router(aws_router)
app.include_router(events_router)
app.include_router(data_router)
app.include_router(advanced_router)
app.include_router(chat_router)
app.include_router(tools_router)
app.include_router(auth_router)
app.include_router(conversations_router)
app.include_router(credentials_router)
app.include_router(simulation_router)