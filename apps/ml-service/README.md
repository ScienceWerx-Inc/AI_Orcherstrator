# ML service (optional)

Self-hosted embeddings, reranking and text generation behind a small FastAPI
API. It exists so teams can register their own GPU-backed models as
`SELF_HOSTED` entries in the model registry.

This service does **not** contain a mock mode. If a model backend or model file
is missing, requests return `503 model_unavailable` and readiness reports
`degraded`; it never fabricates vectors or completions. Local development
without a GPU should use the gateway's `MOCK` provider instead.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health/live` | process liveness |
| `GET` | `/health/ready` | backend/model availability, never lies |
| `GET` | `/v1/models` | configured models and backend status |
| `POST` | `/v1/embeddings` | OpenAI-shaped embeddings |
| `POST` | `/v1/rerank` | cross-encoder relevance ordering |
| `POST` | `/v1/inference` | text generation with real token accounting |
| `GET` | `/metrics` | Prometheus metrics |

All `/v1` routes require `Authorization: Bearer $ML_INTERNAL_TOKEN` when that
variable is set.

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `ML_ENVIRONMENT` | `development` | informational |
| `ML_INTERNAL_TOKEN` | empty | shared secret for service-to-service calls |
| `ML_MODEL_DIR` | empty | local model directory; otherwise library resolution |
| `ML_EMBEDDING_MODELS` | empty | comma-separated allowlist |
| `ML_RERANK_MODELS` | empty | comma-separated allowlist |
| `ML_INFERENCE_MODELS` | empty | comma-separated allowlist |
| `ML_DEVICE` | `cpu` | `cpu`, `cuda`, `mps` or `auto` |
| `ML_MAX_BATCH_SIZE` | `32` | embeddings batch cap |
| `ML_PRELOAD_MODELS` | empty | e.g. `embedding:BAAI/bge-small-en-v1.5` |

## Install

Base API (no model execution):

```bash
cd apps/ml-service
python3 -m venv .venv
. .venv/bin/activate
pip install -e ".[dev]"
```

Real model execution (pick what you need):

```bash
pip install -e ".[embeddings]"   # sentence-transformers + torch
pip install -e ".[inference]"    # transformers + torch
```

## Run

```bash
ML_EMBEDDING_MODELS=BAAI/bge-small-en-v1.5 \
ML_RERANK_MODELS=BAAI/bge-reranker-base \
ML_INFERENCE_MODELS=HuggingFaceTB/SmolLM2-360M-Instruct \
ML_DEVICE=cpu \
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Test the API:

```bash
pytest
```

## Wiring into the gateway

The gateway will call this service from a `SELF_HOSTED` model adapter in a later
phase. For now, the registry and pricing logic already support `SELF_HOSTED`
models with a `gpuHourlyCostUsd`, and the cost service allocates GPU cost from
measured latency.
