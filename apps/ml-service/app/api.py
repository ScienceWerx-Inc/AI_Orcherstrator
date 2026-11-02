from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status

from .schemas import (
    EmbeddingItem,
    EmbeddingRequest,
    EmbeddingResponse,
    EmbeddingUsage,
    InferenceChoice,
    InferenceRequest,
    InferenceResponse,
    InferenceUsage,
    RerankItem,
    RerankRequest,
    RerankResponse,
)
from .metrics import INFERENCE_TOKENS
from .security import verify_token

router = APIRouter(prefix="/v1", dependencies=[Depends(verify_token)])


@router.get("/models")
async def list_models(request: Request) -> dict:
    registry = request.app.state.registry
    description = registry.describe()
    return {
        "object": "list",
        "data": [
            {
                "id": model["id"],
                "object": "model",
                "capability": model["capability"],
                "owned_by": model["backend"],
                "available": model["available"],
                "loaded": model["loaded"],
            }
            for model in description["models"]
        ],
        "backends": description["backends"],
    }


@router.post("/embeddings", response_model=EmbeddingResponse)
async def create_embeddings(body: EmbeddingRequest, request: Request) -> EmbeddingResponse:
    registry = request.app.state.registry
    settings = request.app.state.settings

    registry.ensure_allowed(body.model)
    texts = [body.input] if isinstance(body.input, str) else list(body.input)
    if not texts:
        raise HTTPException(
            status_code=422,
            detail="input must contain at least one string",
        )
    if len(texts) > settings.max_batch_size:
        raise HTTPException(
            status_code=413,
            detail=f"Batch of {len(texts)} exceeds ML_MAX_BATCH_SIZE={settings.max_batch_size}",
        )
    if any(not text.strip() for text in texts):
        raise HTTPException(
            status_code=422,
            detail="input strings must not be empty",
        )

    try:
        result = await registry.embedding.embed(body.model, texts, body.dimensions)
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail=str(exc),
        ) from exc

    INFERENCE_TOKENS.labels("embedding", "prompt").inc(result.prompt_tokens)

    return EmbeddingResponse(
        data=[
            EmbeddingItem(index=index, embedding=vector)
            for index, vector in enumerate(result.vectors)
        ],
        model=body.model,
        usage=EmbeddingUsage(
            prompt_tokens=result.prompt_tokens,
            total_tokens=result.prompt_tokens,
        ),
    )


@router.post("/rerank", response_model=RerankResponse)
async def rerank(body: RerankRequest, request: Request) -> RerankResponse:
    registry = request.app.state.registry
    registry.ensure_allowed(body.model)

    results = await registry.rerank.rerank(body.model, body.query, body.documents)
    if body.top_n is not None:
        results = results[: body.top_n]

    return RerankResponse(
        model=body.model,
        results=[RerankItem(index=item.index, relevance_score=item.score) for item in results],
    )


@router.post("/inference", response_model=InferenceResponse)
async def inference(body: InferenceRequest, request: Request) -> InferenceResponse:
    registry = request.app.state.registry
    registry.ensure_allowed(body.model)

    result = await registry.inference.generate(
        body.model,
        body.prompt,
        body.max_new_tokens,
        body.temperature,
        body.top_p,
        body.stop,
    )

    INFERENCE_TOKENS.labels("inference", "prompt").inc(result.prompt_tokens)
    INFERENCE_TOKENS.labels("inference", "completion").inc(result.completion_tokens)

    return InferenceResponse(
        model=body.model,
        choices=[
            InferenceChoice(
                index=0,
                text=result.text,
                finish_reason=result.finish_reason,  # type: ignore[arg-type]
            )
        ],
        usage=InferenceUsage(
            prompt_tokens=result.prompt_tokens,
            completion_tokens=result.completion_tokens,
            total_tokens=result.prompt_tokens + result.completion_tokens,
        ),
    )
