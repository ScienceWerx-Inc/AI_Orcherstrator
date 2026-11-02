from __future__ import annotations

import asyncio
import threading

import numpy as np

from ..config import Settings
from .base import EmbeddingBackend, EmbeddingResult, ModelUnavailable


class SentenceTransformerEmbeddingBackend(EmbeddingBackend):
    """Real sentence-transformers embeddings, loaded lazily per model."""

    name = "sentence-transformers"

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._models: dict[str, object] = {}
        self._lock = threading.Lock()

    def availability(self) -> tuple[bool, str]:
        try:
            import sentence_transformers  # noqa: F401
        except ImportError:
            return (
                False,
                "Install the embeddings extra: pip install '.[embeddings]'",
            )
        return True, "sentence-transformers is installed"

    def _load(self, model: str) -> object:
        from sentence_transformers import SentenceTransformer

        with self._lock:
            cached = self._models.get(model)
            if cached is not None:
                return cached
            try:
                instance = SentenceTransformer(
                    self._settings.model_path(model),
                    device=self._settings.device,
                )
            except Exception as exc:  # pragma: no cover - depends on local model
                raise ModelUnavailable(
                    f"Unable to load embedding model '{model}': {exc}"
                ) from exc
            self._models[model] = instance
            return instance

    def loaded_models(self) -> list[str]:
        return sorted(self._models)

    def warmup(self, model: str) -> None:
        self._load(model)

    def _encode(
        self, instance: object, texts: list[str], dimensions: int | None
    ) -> EmbeddingResult:
        vectors = instance.encode(  # type: ignore[attr-defined]
            texts,
            batch_size=min(self._settings.max_batch_size, max(1, len(texts))),
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        matrix = np.asarray(vectors, dtype=np.float32)
        if matrix.ndim == 1:
            matrix = matrix.reshape(1, -1)

        if dimensions is not None:
            if dimensions > matrix.shape[1]:
                raise ValueError(
                    f"dimensions={dimensions} exceeds the model's native dimension "
                    f"{matrix.shape[1]}"
                )
            matrix = matrix[:, :dimensions]
            norms = np.linalg.norm(matrix, axis=1, keepdims=True)
            matrix = matrix / np.clip(norms, 1e-12, None)

        tokenizer = getattr(instance, "tokenizer", None)
        if tokenizer is not None:
            prompt_tokens = sum(
                len(tokenizer.encode(text, add_special_tokens=False)) for text in texts
            )
        else:  # tokenizer is part of the sentence-transformers contract
            raise ModelUnavailable(
                "The loaded embedding model did not expose a tokenizer; token "
                "accounting would be fabricated, so the request is rejected."
            )

        return EmbeddingResult(
            vectors=matrix.tolist(),
            prompt_tokens=int(prompt_tokens),
        )

    async def embed(
        self, model: str, texts: list[str], dimensions: int | None
    ) -> EmbeddingResult:
        available, reason = self.availability()
        if not available:
            raise ModelUnavailable(reason)
        instance = await asyncio.to_thread(self._load, model)
        return await asyncio.to_thread(self._encode, instance, texts, dimensions)
