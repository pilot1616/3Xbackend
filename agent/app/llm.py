from __future__ import annotations

from dataclasses import dataclass
import time
from typing import Any, Callable

import httpx

from .config import settings


@dataclass
class LLMCallResult:
    content: str
    request: dict[str, Any]
    response: dict[str, Any]
    latency_ms: int


# 可选审计钩子：签名 (stage, model, request, response, latency_ms, error)。
# /prompt 的 LangGraph 管线靠它把每次 LLM 调用写入 agent_llm_logs。
LLMLogger = Callable[[str, str, dict[str, Any], dict[str, Any] | None, int, str], None]


class LLMClient:
    # 429/5xx/网络抖动重试一次；网关偶发抖动不应直接变成用户可见的 500。
    RETRYABLE_STATUS = {429, 500, 502, 503, 504}

    def __init__(self, logger: LLMLogger | None = None) -> None:
        self._client = httpx.Client(
            timeout=settings.llm_timeout_seconds,
            base_url=settings.llm_base_url,
            headers={
                "Authorization": f"Bearer {settings.llm_api_key}",
                "Content-Type": "application/json",
            },
        )
        self._logger = logger
        self._stage_count = 0

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
        error = ""
        try:
            try:
                response = self._request_with_retry(payload)
                response.raise_for_status()
                data = response.json()
            except httpx.HTTPError as exc:
                error = str(exc)
                raise
        finally:
            latency_ms = int((time.monotonic() - started) * 1000)
            self._emit_log(payload, data if error == "" else None, latency_ms, error)
        choices = data.get("choices") or []
        if not choices:
            return LLMCallResult(content="", request=payload, response=data, latency_ms=latency_ms)
        message = choices[0].get("message") or {}
        return LLMCallResult(content=message.get("content", "") or "", request=payload, response=data, latency_ms=latency_ms)

    def _emit_log(self, request: dict[str, Any], response: dict[str, Any] | None, latency_ms: int, error: str) -> None:
        if self._logger is None:
            return
        self._stage_count += 1
        stage = "graph_llm_call" if self._stage_count > 1 else "graph_generate_sql"
        try:
            self._logger(stage, settings.llm_model, request, response, latency_ms, error)
        except Exception:
            pass

    def _request_with_retry(self, payload: dict[str, Any]):
        attempts = 2
        for attempt in range(1, attempts + 1):
            try:
                response = self._client.post("/chat/completions", json=payload)
            except httpx.HTTPError:
                if attempt == attempts:
                    raise
                time.sleep(0.8)
                continue
            if response.status_code in self.RETRYABLE_STATUS and attempt < attempts:
                time.sleep(0.8)
                continue
            return response
        raise RuntimeError("unreachable")
