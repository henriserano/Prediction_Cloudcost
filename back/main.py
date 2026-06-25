from __future__ import annotations

import os
import uuid
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from core.config import get_settings
from core.logging import setup_logging, request_id_ctx, get_logger
from core.errors import AppError

from routes.routes_health import router as health_router

logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    settings = get_settings()

    # Logging
    setup_logging(level="INFO", json_logs=True)

    # HuggingFace cache dir (avoid downloading each run)
    os.environ.setdefault("HF_HOME", settings.hf_home)

    yield


app = FastAPI(
    title=get_settings().app_name,
    version=get_settings().app_version,
    lifespan=lifespan,
)

# CORS (utile si front)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # en prod, restreins !
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Middleware Request-ID (corrélation logs + debug) ---
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


# --- Handler global AppError -> JSON propre ---
@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    from fastapi.responses import JSONResponse

    payload = {"error": {"code": exc.code, "message": exc.message, "details": exc.details}}
    return JSONResponse(status_code=exc.status_code, content=payload)


# --- Routes ---
app.include_router(health_router)