from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class EmbeddingRequest(BaseModel):
    model: str = Field(min_length=1, max_length=200)
    input: str | list[str]
    dimensions: int | None = Field(default=None, ge=1, le=8192)
    encoding_format: Literal["float"] = "float"


class EmbeddingItem(BaseModel):
    object: Literal["embedding"] = "embedding"
    index: int
    embedding: list[float]


class EmbeddingUsage(BaseModel):
    prompt_tokens: int
    total_tokens: int


class EmbeddingResponse(BaseModel):
    object: Literal["list"] = "list"
    data: list[EmbeddingItem]
    model: str
    usage: EmbeddingUsage


class RerankRequest(BaseModel):
    model: str = Field(min_length=1, max_length=200)
    query: str = Field(min_length=1)
    documents: list[str] = Field(min_length=1, max_length=100)
    top_n: int | None = Field(default=None, ge=1, le=100)


class RerankItem(BaseModel):
    index: int
    relevance_score: float


class RerankResponse(BaseModel):
    model: str
    results: list[RerankItem]


class InferenceRequest(BaseModel):
    model: str = Field(min_length=1, max_length=200)
    prompt: str = Field(min_length=1)
    max_new_tokens: int = Field(default=256, ge=1, le=4096)
    temperature: float = Field(default=0.0, ge=0.0, le=2.0)
    top_p: float = Field(default=1.0, gt=0.0, le=1.0)
    stop: list[str] = Field(default_factory=list, max_length=8)


class InferenceChoice(BaseModel):
    index: int
    text: str
    finish_reason: Literal["stop", "length"]


class InferenceUsage(BaseModel):
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


class InferenceResponse(BaseModel):
    model: str
    choices: list[InferenceChoice]
    usage: InferenceUsage
