from __future__ import annotations

import asyncio
import logging

from .backends.base import ModelNotAllowed, ModelUnavailable
from .backends.embeddings import SentenceTransformerEmbeddingBackend
from .backends.generation import TransformersGenerationBackend
from .backends.rerank import CrossEncoderRerankBackend
from .config import Settings

logger = logging.getLogger(__name__)

CAPABILITIES = ("embedding", "rerank", "inference")


class ModelRegistry:
    """Owns the real backend adapters and the model allowlist."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.embedding = SentenceTransformerEmbeddingBackend(settings)
        self.rerank = CrossEncoderRerankBackend(settings)
        self.inference = TransformersGenerationBackend(settings)

    def backend(self, capability: str):
        mapping = {
            "embedding": self.embedding,
            "rerank": self.rerank,
            "inference": self.inference,
        }
        if capability not in mapping:
            raise ModelUnavailable(f"Unknown capability '{capability}'")
        return mapping[capability]

    def ensure_allowed(self, model: str) -> None:
        allowed = self.settings.allowed_model_set
        if not allowed:
            raise ModelNotAllowed(
                "No models are configured. Set ML_EMBEDDING_MODELS, "
                "ML_RERANK_MODELS or ML_INFERENCE_MODELS on the service."
            )
        if model not in allowed:
            raise ModelNotAllowed(
                f"Model '{model}' is not in this service's allowlist"
            )

    def models_for(self, capability: str) -> list[str]:
        if capability == "embedding":
            return self.settings.embedding_model_list
        if capability == "rerank":
            return self.settings.rerank_model_list
        if capability == "inference":
            return self.settings.inference_model_list
        return []

    def describe(self) -> dict:
        backends = {}
        for capability in CAPABILITIES:
            backend = self.backend(capability)
            available, detail = backend.availability()
            backends[capability] = {
                "backend": backend.name,
                "available": available,
                "detail": detail,
                "loadedModels": backend.loaded_models(),
            }

        models = []
        for capability in CAPABILITIES:
            backend = self.backend(capability)
            available, detail = backend.availability()
            for model in self.models_for(capability):
                models.append(
                    {
                        "id": model,
                        "capability": capability,
                        "backend": backend.name,
                        "available": available,
                        "detail": detail,
                        "loaded": model in backend.loaded_models(),
                    }
                )

        return {"backends": backends, "models": models}

    def health(self) -> dict:
        descriptions = self.describe()
        any_available = any(
            backend["available"] for backend in descriptions["backends"].values()
        )
        configured = len(self.settings.allowed_model_set)
        return {
            "status": "ok" if any_available and configured > 0 else "degraded",
            "service": self.settings.service_name,
            "environment": self.settings.environment,
            "configuredModels": configured,
            "backends": descriptions["backends"],
        }

    async def preload(self) -> list[str]:
        loaded: list[str] = []
        for capability, model in self.settings.preload_model_list:
            if capability not in CAPABILITIES:
                raise ValueError(
                    f"ML_PRELOAD_MODELS entry has unknown capability '{capability}'"
                )
            self.ensure_allowed(model)
            backend = self.backend(capability)
            available, detail = backend.availability()
            if not available:
                raise ModelUnavailable(detail)
            await asyncio.to_thread(backend.warmup, model)
            loaded.append(f"{capability}:{model}")
            logger.info("preloaded model", extra={"capability": capability, "model": model})
        return loaded
