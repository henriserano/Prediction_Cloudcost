from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from core.config import get_settings
from core.errors import AppError
from core.logging import get_logger, request_id_ctx, setup_logging
from routes.routes_analytics import router as analytics_router
from routes.routes_forecast import router as forecast_router
from routes.routes_health import router as health_router

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    setup_logging(level="INFO", json_logs=True)

    # Eagerly load parquet files into LRU cache so first request is fast
    from data.loader import load_daily_costs, load_daily_per_service

    load_daily_costs()
    load_daily_per_service()
    logger.info("Data loaded into cache")

    yield


settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="FinOps GCP — REST API for cost analysis and forecasting",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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