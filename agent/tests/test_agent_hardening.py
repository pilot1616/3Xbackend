from __future__ import annotations

import httpx
import pytest

import app.main as main
from app.config import settings
from app.llm import LLMClient


def test_default_allowed_tables_are_data_and_public_forum() -> None:
    assert settings.allowed_table_set == {
        "ai_daily_snapshots",
        "precious_metal_snapshots",
        "tech_market_snapshots",
        "questions",
        "comments",
        "question_files",
        "question_likes",
    }


def test_default_allowed_tables_exclude_private_tables() -> None:
    # 用户表带密码/密保哈希，任何默认配置下都不得暴露给 LLM 查询。
    assert "users" not in settings.allowed_table_set


def test_rate_limit_rejects_after_budget(monkeypatch) -> None:
    monkeypatch.setattr(main, "_rate_limit_windows", {})
    for _ in range(main.RATE_LIMIT_MAX_REQUESTS):
        main.check_rate_limit(424242)

    with pytest.raises(main.RateLimitError):
        main.check_rate_limit(424242)


def test_rate_limit_is_per_user(monkeypatch) -> None:
    monkeypatch.setattr(main, "_rate_limit_windows", {})
    for _ in range(main.RATE_LIMIT_MAX_REQUESTS):
        main.check_rate_limit(111)

    # 另一个用户不受影响
    main.check_rate_limit(222)


class _StubResponse:
    def __init__(self, status_code: int) -> None:
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("error", request=None, response=None)

    def json(self) -> dict:
        return {"choices": [{"message": {"content": "ok"}}]}


class _StubStreamResponse:
    """模拟 httpx stream 响应：status + SSE 行迭代。"""

    def __init__(self, status_code: int, lines: list[str]) -> None:
        self.status_code = status_code
        self._lines = lines

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            # 真实 httpx 的 HTTPStatusError 总是携带 response
            raise httpx.HTTPStatusError("error", request=None, response=self)

    def iter_lines(self) -> list[str]:
        return self._lines

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def _sse_lines(content_chunks: list[str]) -> list[str]:
    lines = [f'data: {{"choices":[{{"delta":{{"content":"{chunk}"}}}}]}}' for chunk in content_chunks]
    lines.append("data: [DONE]")
    return lines


def test_llm_client_chat_streams_and_aggregates(monkeypatch) -> None:
    client = LLMClient()
    calls: list[int] = []

    def fake_stream(method, path, json=None):
        calls.append(1)
        if len(calls) == 1:
            return _StubStreamResponse(503, [])
        return _StubStreamResponse(200, _sse_lines(["你好", "，世界"]))

    monkeypatch.setattr(client._stream_client, "stream", fake_stream)
    monkeypatch.setattr(main.time, "sleep", lambda seconds: None)

    result = client.chat("system", "user")

    # 503 后重试一次，聚合的 content 完整
    assert len(calls) == 2
    assert result.content == "你好，世界"


def test_llm_client_does_not_retry_client_errors(monkeypatch) -> None:
    client = LLMClient()
    calls: list[int] = []

    def fake_stream(method, path, json=None):
        calls.append(1)
        return _StubStreamResponse(400, [])

    monkeypatch.setattr(client._stream_client, "stream", fake_stream)

    with pytest.raises(httpx.HTTPStatusError):
        client.chat("system", "user")

    assert len(calls) == 1


def test_llm_client_logs_calls(monkeypatch) -> None:
    logs: list[tuple[str, str, str]] = []
    client = LLMClient(logger=lambda stage, model, request, response, latency, error: logs.append((stage, error, response["content"])))
    monkeypatch.setattr(client._stream_client, "stream", lambda method, path, json=None: _StubStreamResponse(200, _sse_lines(["ok"])))

    client.chat("system", "user")

    assert len(logs) == 1
    assert logs[0][0] == "graph_generate_sql"
    assert logs[0][1] == ""
    assert logs[0][2] == "ok"


def test_prompt_returns_generic_error_without_leaking_details(monkeypatch) -> None:
    # 图抛错时响应必须只含通用文案，不能带出异常原文（表名等细节）。
    monkeypatch.setattr(
        main,
        "build_graph",
        lambda engine, llm_logger=None: (_ for _ in ()).throw(RuntimeError("Table 'secret_table' doesn't exist")),
    )

    from fastapi.testclient import TestClient

    client = TestClient(main.app, raise_server_exceptions=False)

    response = client.post("/prompt", json={"prompt": "分析黄金"})
    body = response.json()

    assert response.status_code == 200
    assert body["error"] == main.GENERIC_AGENT_ERROR
    assert "secret_table" not in body["error"]


def test_chat_answer_stage_never_carries_sql_only_instruction(monkeypatch) -> None:
    """防回归：回答阶段若复用 SQL 角色 prompt，聊天会直接吐 SQL 给用户。"""
    import re

    source = open("app/main.py", encoding="utf-8").read()
    # 提取 /chat 内构造 answer_messages 之前的 answer_instruction 定义
    match = re.search(r'answer_instruction = \((.*?)\)\n\s*dynamic_for_answer', source, re.DOTALL)
    assert match, "answer_instruction block not found"
    instruction = match.group(1)
    assert "SQL" not in instruction or "不要输出 SQL" in instruction
    assert "中文结论" in instruction
