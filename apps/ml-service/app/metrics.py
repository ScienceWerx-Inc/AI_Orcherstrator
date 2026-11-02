from __future__ import annotations

import time

from fastapi import FastAPI, Request, Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest

REQUESTS = Counter(
    "ml_service_http_requests_total",
    "HTTP requests handled by the ML service",
    ["method", "path", "status"],
)
LATENCY = Histogram(
    "ml_service_http_request_duration_seconds",
    "HTTP request latency for the ML service",
    ["method", "path"],
)
INFERENCE_TOKENS = Counter(
    "ml_service_tokens_total",
    "Tokens processed by capability",
    ["capability", "direction"],
)


def instrument(app: FastAPI) -> None:
    """Minimal Prometheus instrumentation without third-party routing hooks."""

    @app.middleware("http")
    async def metrics_middleware(request: Request, call_next):
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            REQUESTS.labels(request.method, request.url.path, "500").inc()
            raise
        route = request.scope.get("route")
        path = getattr(route, "path", request.url.path)
        elapsed = time.perf_counter() - started
        REQUESTS.labels(request.method, path, str(response.status_code)).inc()
        LATENCY.labels(request.method, path).observe(elapsed)
        return response

    @app.get("/metrics", include_in_schema=False)
    async def metrics() -> Response:
        return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
