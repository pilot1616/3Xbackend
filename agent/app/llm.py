from __future__ import annotations

from dataclasses import dataclass
import time
from typing import Any

import httpx

from .config import settings


@dataclass
class LLMCallResult:
    content: str
    request: dict[str, Any]
    response: dict[str, Any]
    latency_ms: int


class LLMClient:
    def __init__(self) -> None:
        self._client = httpx.Client(
            timeout=settings.llm_timeout_seconds,
            base_url=settings.llm_base_url,
            headers={
                "Authorization": f"Bearer {settings.llm_api_key}",
                "Content-Type": "application/json",
            },
        )

    def analyze(self, system_prompt: str, user_prompt: str) -> str:
        return self.chat(system_prompt, user_prompt).content

    def chat(self, system_prompt: str, user_prompt: str) -> LLMCallResult:
        payload = {
            "model": settings.llm_model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "stream": False,
        }
        started = time.monotonic()
        response = self._client.post("/chat/completions", json=payload)
        latency_ms = int((time.monotonic() - started) * 1000)
        response.raise_for_status()
        data = response.json()
        choices = data.get("choices") or []
        if not choices:
            return LLMCallResult(content="", request=payload, response=data, latency_ms=latency_ms)
        message = choices[0].get("message") or {}
        return LLMCallResult(content=message.get("content", "") or "", request=payload, response=data, latency_ms=latency_ms)
