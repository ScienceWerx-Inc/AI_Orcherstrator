FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY app ./app

# Base image installs the API only. Pass --build-arg ML_EXTRAS=embeddings or
# ML_EXTRAS=inference (or "embeddings,inference") for real model execution.
ARG ML_EXTRAS=""
RUN pip install --upgrade pip \
    && if [ -n "$ML_EXTRAS" ]; then pip install ".[$ML_EXTRAS]"; else pip install .; fi

RUN useradd --create-home --uid 10001 mlservice
USER mlservice

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8000/health/live || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
