from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


class ModelUnavailable(RuntimeError):
    """The requested capability has no usable backend (missing package/model)."""


class ModelNotAllowed(PermissionError):
    """The model is not in the configured allowlist."""


@dataclass
class EmbeddingResult:
    vectors: list[list[float]]
    prompt_tokens: int


@dataclass
class RerankResult:
    index: int
    score: float


@dataclass
class GenerationResult:
    text: str
    prompt_tokens: int
    completion_tokens: int
    finish_reason: str


class EmbeddingBackend(Protocol):
    name: str

    def availability(self) -> tuple[bool, str]: ...

    async def embed(
        self, model: str, texts: list[str], dimensions: int | None
    ) -> EmbeddingResult: ...


class RerankBackend(Protocol):
    name: str

    def availability(self) -> tuple[bool, str]: ...

    async def rerank(
        self, model: str, query: str, documents: list[str]
    ) -> list[RerankResult]: ...


class InferenceBackend(Protocol):
    name: str

    def availability(self) -> tuple[bool, str]: ...

    async def generate(
        self,
        model: str,
        prompt: str,
        max_new_tokens: int,
        temperature: float,
        top_p: float,
        stop: list[str] | None,
    ) -> GenerationResult: ...
