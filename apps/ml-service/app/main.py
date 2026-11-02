from __future__ import annotations

import json
import logging
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from . import __version__
from .api import router as api_router
from .backends.base import ModelNotAllowed, ModelUnavailable
from .config import Settings, get_settings
from .metrics import instrument
from .registry import ModelRegistry


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "level": record.levelname.lower(),
            "time": datetime.now(timezone.utc).isoformat(),
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key in ("capability", "model", "event"):
            value = record.__dict__.get(key)
            if value is not None:
                payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload)


def configure_logging(settings: Settings) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(settings.log_level.upper())


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings)
    logger = logging.getLogger("ai-ml-service")
    registry = ModelRegistry(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        logger.info(
            json.dumps(
                {
                    "event": "startup",
                    "service": settings.service_name,
                    "environment": settings.environment,
                    "embeddings": settings.embedding_model_list,
                    "rerank": settings.rerank_model_list,
                    "inference": settings.inference_model_list,
                }
            )
        )
        if settings.preload_model_list:
            loaded = await registry.preload()
            logger.info(json.dumps({"event": "preload_complete", "loaded": loaded}))
        yield
        logger.info("shutdown")

    app = FastAPI(
        title="AI Middleware ML service",
        version=__version__,
        description=(
            "Optional self-hosted embeddings, reranking and generation service. "
            "Every response is produced by a real local model; unavailable "
            "backends return 503 instead of fabricated output."
        ),
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.registry = registry

    instrument(app)
    app.include_router(api_router)
    @app.get("/health/live", tags=["health"])
    async def live() -> dict:
        return {"status": "ok", "service": settings.service_name}

    @app.get("/health/ready", tags=["health"])
    async def ready() -> dict:
        return registry.health()

    @app.exception_handler(ModelUnavailable)
    async def model_unavailable_handler(request: Request, exc: ModelUnavailable):
        logger.warning("model unavailable", extra={"event": "model_unavailable"})
        return JSONResponse(
            status_code=503,
            content={
                "error": {
                    "message": str(exc),
                    "type": "service_unavailable",
                    "code": "model_unavailable",
                }
            },
        )

    @app.exception_handler(ModelNotAllowed)
    async def model_not_allowed_handler(request: Request, exc: ModelNotAllowed):
        return JSONResponse(
            status_code=404,
            content={
                "error": {
                    "message": str(exc),
                    "type": "invalid_request_error",
                    "code": "model_not_configured",
                }
            },
        )

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException):
        error_type = (
            "invalid_request_error"
            if 400 <= exc.status_code < 500
            else "server_error"
        )
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": {
                    "message": str(exc.detail),
                    "type": error_type,
                    "code": f"http_{exc.status_code}",
                }
            },
            headers=exc.headers,
        )

    return app


app = create_app()
