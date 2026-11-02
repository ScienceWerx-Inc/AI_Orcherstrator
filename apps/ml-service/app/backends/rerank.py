from __future__ import annotations

import asyncio
import threading

from ..config import Settings
from .base import ModelUnavailable, RerankBackend, RerankResult


class CrossEncoderRerankBackend(RerankBackend):
    """Real cross-encoder scoring via sentence-transformers."""

    name = "cross-encoder"

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._models: dict[str, object] = {}
        self._lock = threading.Lock()

    def availability(self) -> tuple[bool, str]:
        try:
            from sentence_transformers import CrossEncoder  # noqa: F401
        except ImportError:
            return (
                False,
                "Install the embeddings extra: pip install '.[embeddings]'",
            )
        return True, "sentence-transformers CrossEncoder is installed"

    def _load(self, model: str) -> object:
        from sentence_transformers import CrossEncoder

        with self._lock:
            cached = self._models.get(model)
            if cached is not None:
                return cached
            try:
                instance = CrossEncoder(
                    self._settings.model_path(model),
                    device=self._settings.device,
                )
            except Exception as exc:  # pragma: no cover - depends on local model
                raise ModelUnavailable(f"Unable to load rerank model '{model}': {exc}") from exc
            self._models[model] = instance
            return instance

    def loaded_models(self) -> list[str]:
        return sorted(self._models)

    def warmup(self, model: str) -> None:
        self._load(model)

    def _score(self, instance: object, query: str, documents: list[str]) -> list[RerankResult]:
        pairs = [(query, document) for document in documents]
        scores = instance.predict(pairs, batch_size=self._settings.max_batch_size)  # type: ignore[attr-defined]
        results = [
            RerankResult(index=index, score=float(score))
            for index, score in enumerate(scores)
        ]
        results.sort(key=lambda item: (-item.score, item.index))
        return results

    async def rerank(
        self, model: str, query: str, documents: list[str]
    ) -> list[RerankResult]:
        available, reason = self.availability()
        if not available:
            raise ModelUnavailable(reason)
        instance = await asyncio.to_thread(self._load, model)
        return await asyncio.to_thread(self._score, instance, query, documents)
