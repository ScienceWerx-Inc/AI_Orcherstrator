from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.backends.base import EmbeddingResult, GenerationResult, ModelUnavailable, RerankResult
from app.config import Settings
from app.main import create_app


class FakeEmbedding:
    name = "fake-embedding"

    def __init__(self) -> None:
        self._loaded: list[str] = []

    def availability(self) -> tuple[bool, str]:
        return True, "fake backend for tests"

    def loaded_models(self) -> list[str]:
        return list(self._loaded)

    def warmup(self, model: str) -> None:
        self._loaded.append(model)

    async def embed(self, model: str, texts: list[str], dimensions: int | None):
        vectors = [[float(len(text)), float(index)] for index, text in enumerate(texts)]
        return EmbeddingResult(vectors=vectors, prompt_tokens=sum(len(text.split()) for text in texts))


class FakeRerank:
    name = "fake-rerank"

    def availability(self) -> tuple[bool, str]:
        return True, "fake backend for tests"

    def loaded_models(self) -> list[str]:
        return []

    def warmup(self, model: str) -> None:
        return None

    async def rerank(self, model: str, query: str, documents: list[str]):
        scored = [RerankResult(index=index, score=float(len(doc))) for index, doc in enumerate(documents)]
        scored.sort(key=lambda item: (-item.score, item.index))
        return scored


class FakeInference:
    name = "fake-inference"

    def availability(self) -> tuple[bool, str]:
        return True, "fake backend for tests"

    def loaded_models(self) -> list[str]:
        return []

    def warmup(self, model: str) -> None:
        return None

    async def generate(self, model, prompt, max_new_tokens, temperature, top_p, stop):
        text = f"echo: {prompt}"
        return GenerationResult(
            text=text,
            prompt_tokens=len(prompt.split()),
            completion_tokens=len(text.split()),
            finish_reason="stop",
        )


class UnavailableEmbedding(FakeEmbedding):
    name = "missing-backend"

    def availability(self) -> tuple[bool, str]:
        return False, "model backend is not installed"

    async def embed(self, model: str, texts: list[str], dimensions: int | None):
        raise ModelUnavailable("model backend is not installed")


def build_settings(**overrides) -> Settings:
    values = {
        "environment": "test",
        "embedding_models": "fake-embed",
        "rerank_models": "fake-rerank",
        "inference_models": "fake-gen",
        "max_batch_size": 8,
    }
    values.update(overrides)
    return Settings(**values)


def build_client(settings: Settings | None = None) -> TestClient:
    app = create_app(settings or build_settings())
    app.state.registry.embedding = FakeEmbedding()
    app.state.registry.rerank = FakeRerank()
    app.state.registry.inference = FakeInference()
    return TestClient(app)


@pytest.fixture
def client() -> TestClient:
    with build_client() as test_client:
        yield test_client


def test_health_live(client: TestClient) -> None:
    response = client.get("/health/live")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_readiness_reports_backends(client: TestClient) -> None:
    response = client.get("/health/ready")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["configuredModels"] == 3
    assert body["backends"]["embedding"]["available"] is True


def test_readiness_is_degraded_without_models() -> None:
    with build_client(build_settings(embedding_models="", rerank_models="", inference_models="")) as test_client:
        body = test_client.get("/health/ready").json()
        assert body["status"] == "degraded"
        assert body["configuredModels"] == 0


def test_lists_configured_models(client: TestClient) -> None:
    response = client.get("/v1/models")
    assert response.status_code == 200
    models = {item["id"]: item for item in response.json()["data"]}
    assert set(models) == {"fake-embed", "fake-rerank", "fake-gen"}
    assert models["fake-embed"]["capability"] == "embedding"


def test_embeddings_returns_real_vectors_and_usage(client: TestClient) -> None:
    response = client.post(
        "/v1/embeddings",
        json={"model": "fake-embed", "input": ["hello world", "second"]},
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["data"]) == 2
    assert body["data"][0]["embedding"] == [11.0, 0.0]
    assert body["data"][1]["embedding"] == [6.0, 1.0]
    assert body["usage"]["prompt_tokens"] == 3
    assert body["usage"]["total_tokens"] == 3


def test_embeddings_rejects_empty_batch(client: TestClient) -> None:
    response = client.post("/v1/embeddings", json={"model": "fake-embed", "input": []})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "http_422"


def test_embeddings_rejects_oversized_batch() -> None:
    with build_client(build_settings(max_batch_size=2)) as test_client:
        response = test_client.post(
            "/v1/embeddings",
            json={"model": "fake-embed", "input": ["a", "b", "c"]},
        )
        assert response.status_code == 413


def test_embeddings_rejects_unconfigured_model(client: TestClient) -> None:
    response = client.post("/v1/embeddings", json={"model": "unknown", "input": "hi"})
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "model_not_configured"


def test_embeddings_reports_missing_backend() -> None:
    app = create_app(build_settings())
    app.state.registry.embedding = UnavailableEmbedding()
    with TestClient(app) as test_client:
        response = test_client.post("/v1/embeddings", json={"model": "fake-embed", "input": "hi"})
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "model_unavailable"


def test_rerank_orders_by_score_and_respects_top_n(client: TestClient) -> None:
    response = client.post(
        "/v1/rerank",
        json={
            "model": "fake-rerank",
            "query": "refund policy",
            "documents": ["a", "longer document", "mid doc"],
            "top_n": 2,
        },
    )
    assert response.status_code == 200
    results = response.json()["results"]
    assert [item["index"] for item in results] == [1, 2]
    assert results[0]["relevance_score"] > results[1]["relevance_score"]


def test_inference_returns_model_output_and_token_accounting(client: TestClient) -> None:
    response = client.post(
        "/v1/inference",
        json={"model": "fake-gen", "prompt": "hello there", "max_new_tokens": 16},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["choices"][0]["text"] == "echo: hello there"
    assert body["choices"][0]["finish_reason"] == "stop"
    assert body["usage"]["prompt_tokens"] == 2
    assert body["usage"]["total_tokens"] == body["usage"]["prompt_tokens"] + body["usage"]["completion_tokens"]


def test_shared_secret_is_enforced() -> None:
    with build_client(build_settings(internal_token="top-secret")) as test_client:
        assert test_client.get("/v1/models").status_code == 401
        assert (
            test_client.get("/v1/models", headers={"authorization": "Bearer wrong"}).status_code
            == 401
        )
        assert (
            test_client.get("/v1/models", headers={"authorization": "Bearer top-secret"}).status_code
            == 200
        )
        assert test_client.get("/health/live").status_code == 200
