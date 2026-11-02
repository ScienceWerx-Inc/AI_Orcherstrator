from __future__ import annotations

import asyncio
import threading

from ..config import Settings
from .base import GenerationResult, InferenceBackend, ModelUnavailable


class TransformersGenerationBackend(InferenceBackend):
    """Real Hugging Face text generation; no canned completions."""

    name = "transformers"

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._pipelines: dict[str, object] = {}
        self._lock = threading.Lock()

    def availability(self) -> tuple[bool, str]:
        try:
            import transformers  # noqa: F401
            import torch  # noqa: F401
        except ImportError:
            return (
                False,
                "Install the inference extra: pip install '.[inference]'",
            )
        return True, "transformers and torch are installed"

    def _load(self, model: str) -> object:
        from transformers import pipeline

        with self._lock:
            cached = self._pipelines.get(model)
            if cached is not None:
                return cached

            device = self._settings.device
            kwargs: dict[str, object] = {"trust_remote_code": False}
            if device == "auto":
                kwargs["device_map"] = "auto"
            elif device == "cuda":
                kwargs["device"] = 0
            elif device == "mps":
                kwargs["device"] = "mps"
            else:
                kwargs["device"] = -1

            try:
                instance = pipeline(
                    "text-generation",
                    model=self._settings.model_path(model),
                    **kwargs,
                )
            except Exception as exc:  # pragma: no cover - depends on local model
                raise ModelUnavailable(f"Unable to load generation model '{model}': {exc}") from exc
            self._pipelines[model] = instance
            return instance

    def loaded_models(self) -> list[str]:
        return sorted(self._pipelines)

    def warmup(self, model: str) -> None:
        self._load(model)

    def _generate(
        self,
        instance: object,
        prompt: str,
        max_new_tokens: int,
        temperature: float,
        top_p: float,
        stop: list[str] | None,
    ) -> GenerationResult:
        tokenizer = getattr(instance, "tokenizer", None)
        if tokenizer is None:
            raise ModelUnavailable(
                "The loaded generation pipeline did not expose a tokenizer; token "
                "accounting would be fabricated, so the request is rejected."
            )

        prompt_tokens = len(tokenizer.encode(prompt, add_special_tokens=False))
        outputs = instance(  # type: ignore[operator]
            prompt,
            max_new_tokens=max_new_tokens,
            do_sample=temperature > 0,
            temperature=max(temperature, 1e-5),
            top_p=top_p,
            num_return_sequences=1,
            return_full_text=False,
            pad_token_id=getattr(tokenizer, "eos_token_id", None),
        )
        text = str(outputs[0]["generated_text"])

        finish_reason = "length"
        for marker in stop or []:
            if not marker:
                continue
            position = text.find(marker)
            if position != -1:
                text = text[:position]
                finish_reason = "stop"

        completion_tokens = len(tokenizer.encode(text, add_special_tokens=False))
        if finish_reason != "stop" and completion_tokens < max_new_tokens:
            finish_reason = "stop"

        return GenerationResult(
            text=text,
            prompt_tokens=int(prompt_tokens),
            completion_tokens=int(completion_tokens),
            finish_reason=finish_reason,
        )

    async def generate(
        self,
        model: str,
        prompt: str,
        max_new_tokens: int,
        temperature: float,
        top_p: float,
        stop: list[str] | None,
    ) -> GenerationResult:
        available, reason = self.availability()
        if not available:
            raise ModelUnavailable(reason)
        instance = await asyncio.to_thread(self._load, model)
        return await asyncio.to_thread(
            self._generate,
            instance,
            prompt,
            max_new_tokens,
            temperature,
            top_p,
            stop,
        )
