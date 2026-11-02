from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. All variables use the ``ML_`` prefix."""

    model_config = SettingsConfigDict(env_prefix="ML_", env_file=".env", extra="ignore")

    service_name: str = "ai-ml-service"
    environment: str = "development"
    host: str = "0.0.0.0"
    port: int = 8000
    log_level: str = "info"

    # Shared secret checked on every request when set. The gateway should send
    # it as `Authorization: Bearer <token>` or `x-internal-token`.
    internal_token: str | None = None

    # Directory containing local model snapshots. When unset, model names are
    # resolved by the underlying library (which may download from the Hub).
    model_dir: str | None = None

    # Comma-separated model identifiers. A model must be listed here before the
    # service will load it; an empty list means "no models configured".
    embedding_models: str = ""
    rerank_models: str = ""
    inference_models: str = ""

    # cpu | cuda | mps | auto
    device: str = "cpu"
    max_batch_size: int = 32

    # Comma-separated "capability:model" entries loaded at startup.
    preload_models: str = ""

    # Text generation defaults; requests may override within safe limits.
    max_new_tokens: int = 512

    @staticmethod
    def _split(value: str) -> list[str]:
        return [item.strip() for item in value.split(",") if item.strip()]

    @property
    def embedding_model_list(self) -> list[str]:
        return self._split(self.embedding_models)

    @property
    def rerank_model_list(self) -> list[str]:
        return self._split(self.rerank_models)

    @property
    def inference_model_list(self) -> list[str]:
        return self._split(self.inference_models)

    @property
    def allowed_model_set(self) -> set[str]:
        return set(
            self.embedding_model_list
            + self.rerank_model_list
            + self.inference_model_list
        )

    @property
    def preload_model_list(self) -> list[tuple[str, str]]:
        entries: list[tuple[str, str]] = []
        for item in self._split(self.preload_models):
            if ":" not in item:
                continue
            capability, model = item.split(":", 1)
            entries.append((capability.strip(), model.strip()))
        return entries

    def model_path(self, model: str) -> str:
        if self.model_dir:
            candidate = Path(self.model_dir) / model
            if candidate.exists():
                return str(candidate)
        return model


@lru_cache
def get_settings() -> Settings:
    return Settings()
