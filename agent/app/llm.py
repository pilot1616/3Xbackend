from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeoutError
from dataclasses import dataclass, field
import json
import time
from typing import Any, Callable

import httpx

from .config import settings


class LLMHardTimeout(Exception):
    """LLM 调用超过硬上限（线程池兜底超时）。"""


@dataclass
class LLMCallResult:
    content: str
    request: dict[str, Any]
    response: dict[str, Any]
    latency_ms: int
    usage: dict[str, Any] | None = None


@dataclass
class LLMStreamResult:
    content: str
    request: dict[str, Any]
    latency_ms: int
    usage: dict[str, Any] | None = None
    error: str = ""


# 可选审计钩子：签名 (stage, model, request, response, latency_ms, error)。
# /prompt 的 LangGraph 管线靠它把每次 LLM 调用写入 agent_llm_logs。
LLMLogger = Callable[[str, str, dict[str, Any], dict[str, Any] | None, int, str], None]


def build_stable_messages(
    stable_system: str,
    stable_instruction: str,
    dynamic_user: str,
) -> list[dict[str, str]]:
    """构造利于 prompt cache 命中的 messages。

    前缀必须逐字节稳定：system（角色+规则+schema）和固定的输出格式说明
    放在最前，所有会变化的内容（问题、历史、查询结果）集中在最后一条。
    """
    return [
        {"role": "system", "content": stable_system},
        {"role": "user", "content": stable_instruction},
        {"role": "user", "content": dynamic_user},
    ]


class LLMClient:
    # 429/5xx/网络抖动重试一次；网关偶发抖动不应直接变成用户可见的 500。
    RETRYABLE_STATUS = {429, 500, 502, 503, 504}
    # 单次 LLM 调用的硬上限（秒）：httpx 的 read timeout 在部分环境下（连接池
    # 复用/SSL 缓冲）不能保证触发，外层用线程池兜底，超时按失败处理。
    CALL_HARD_TIMEOUT_SECONDS = 150.0

    def __init__(self, logger: LLMLogger | None = None) -> None:
        # 非流式：整体超时用配置值（当前 25s 量级）。
        # 流式：连接 10s，但 read 是"两个 chunk 的间隔"——推理模型（grok）在
        # 思考阶段可能 1-2 分钟不吐 chunk，给足 180s，只防真挂死。
        stream_timeout = httpx.Timeout(10.0, read=180.0, write=30.0, connect=10.0)
        self._client = httpx.Client(
            timeout=httpx.Timeout(settings.llm_timeout_seconds),
            # 忽略 shell 里的 http(s)_proxy：死代理会把出网请求送进黑洞（含 localhost）
            trust_env=False,
            base_url=settings.llm_base_url,
            headers={
                "Authorization": f"Bearer {settings.llm_api_key}",
                "Content-Type": "application/json",
            },
        )
        self._stream_client = httpx.Client(
            timeout=stream_timeout,
            trust_env=False,
            base_url=settings.llm_base_url,
            headers={
                "Authorization": f"Bearer {settings.llm_api_key}",
                "Content-Type": "application/json",
            },
        )
        self._logger = logger
        self._stage_count = 0

    def _call_with_hard_timeout(self, fn, *args, **kwargs):
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(fn, *args, **kwargs)
            try:
                return future.result(timeout=self.CALL_HARD_TIMEOUT_SECONDS)
            except FuturesTimeoutError as exc:
                raise LLMHardTimeout(f"LLM 调用超过 {self.CALL_HARD_TIMEOUT_SECONDS}s 硬上限") from exc

    def analyze(self, system_prompt: str, user_prompt: str, stage: str = "") -> str:
        return self.chat(system_prompt, user_prompt, stage=stage).content

    def chat(self, system_prompt: str, user_prompt: str, stage: str = "") -> LLMCallResult:
        # 兼容旧签名：system_prompt 传 list 时直接作为完整 messages 使用（稳定前缀模式）。
        # 传输层统一走流式：推理模型思考期可能长时间不出 chunk，非流式整包读
        # 会在网关 60s 处必然超时；流式聚合后对外语义不变。
        messages = (
            list(system_prompt)
            if isinstance(system_prompt, list)
            else [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ]
        )
        model = settings.model_for_stage(stage) if stage else settings.llm_model
        payload = {
            "model": model,
            "messages": messages,
            "stream": True,
        }
        started = time.monotonic()
        error = ""
        usage: dict[str, Any] | None = None
        parts: list[str] = []
        attempts = 2
        for attempt in range(1, attempts + 1):
            parts = []
            usage = None
            try:
                self._call_with_hard_timeout(self._stream_once, payload, parts)
                break
            except LLMHardTimeout:
                error = f"hard timeout {self.CALL_HARD_TIMEOUT_SECONDS}s"
                if attempt == attempts:
                    raise
                time.sleep(0.8)
                continue
            except httpx.HTTPStatusError as exc:
                error = str(exc)
                status = exc.response.status_code if exc.response is not None else None
                # 4xx 是请求本身的问题（模型名错、鉴权失败），重试无意义
                if status is not None and status not in self.RETRYABLE_STATUS:
                    raise
                if attempt == attempts:
                    raise
                time.sleep(0.8)
                continue
            except httpx.HTTPError as exc:
                error = str(exc)
                if attempt == attempts:
                    raise
                time.sleep(0.8)
                continue
        latency_ms = int((time.monotonic() - started) * 1000)
        data = {"stream": True, "content": "".join(parts)}
        self._emit_log(payload, data if error == "" else None, latency_ms, error)
        return LLMCallResult(
            content="".join(parts),
            request=payload,
            response=data,
            latency_ms=latency_ms,
            usage=usage,
        )

    def _emit_log(self, request: dict[str, Any], response: dict[str, Any] | None, latency_ms: int, error: str) -> None:
        if self._logger is None:
            return
        self._stage_count += 1
        stage = "graph_llm_call" if self._stage_count > 1 else "graph_generate_sql"
        try:
            self._logger(stage, str(request.get("model") or settings.llm_model), request, response, latency_ms, error)
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

    def _stream_once(self, payload: dict[str, Any], parts: list[str]) -> dict[str, Any] | None:
        """执行一次流式请求：把 content 增量 append 到 parts，返回 usage。

        供 chat/chat_stream 调用，通常包在 _call_with_hard_timeout 里。
        """
        usage: dict[str, Any] | None = None
        with self._stream_client.stream("POST", "/chat/completions", json=payload) as response:
            response.raise_for_status()
            for line in response.iter_lines():
                line = (line or "").strip()
                if not line.startswith("data:"):
                    continue
                body = line[len("data:"):].strip()
                if body == "[DONE]":
                    break
                try:
                    chunk = json.loads(body)
                except json.JSONDecodeError:
                    continue
                usage = chunk.get("usage") or usage
                choices = chunk.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                text = delta.get("content")
                if isinstance(text, str) and text:
                    parts.append(text)
        return usage

    def chat_stream(self, system_prompt, user_prompt: str = "", stage: str = "") -> "LLMStreamResult":
        """流式调用：返回 LLMStreamResult，content 为聚合后的完整文本。

        内部逐行解析 OpenAI chunk 协议（data: {...} / data: [DONE]），
        delta.reasoning_content（思考过程）被跳过，不计入 content。
        usage 取自流尾的 usage chunk。
        """
        messages = (
            list(system_prompt)
            if isinstance(system_prompt, list)
            else [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ]
        )
        model = settings.model_for_stage(stage) if stage else settings.llm_model
        payload = {
            "model": model,
            "messages": messages,
            "stream": True,
        }
        started = time.monotonic()
        error = ""
        usage: dict[str, Any] | None = None
        parts: list[str] = []
        try:
            try:
                usage = self._call_with_hard_timeout(self._stream_once, payload, parts)
            except httpx.HTTPError as exc:
                error = str(exc)
                raise
        finally:
            latency_ms = int((time.monotonic() - started) * 1000)
            self._emit_log(payload, {"stream": True, "content": "".join(parts)} if error == "" else None, latency_ms, error)
        return LLMStreamResult(content="".join(parts), request=payload, latency_ms=latency_ms, usage=usage, error=error)
