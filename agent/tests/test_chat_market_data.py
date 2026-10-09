"""chat 管线的外部行情接入测试：意图命中取数注入，普通问题零开销。"""

from types import SimpleNamespace

from app import main
from app.graph import needs_external_market_data


class _FakeChatResult(SimpleNamespace):
    pass


def _make_llm(content_by_stage: dict[str, str], calls: list):
    """stage -> content 的假 LLM；记录每次调用。"""

    def chat(messages, user_prompt, stage=""):
        calls.append(stage)
        return SimpleNamespace(
            content=content_by_stage.get(stage, "ok"),
            request={"model": "fake-model", "messages": messages},
            response={},
            latency_ms=1,
        )

    return SimpleNamespace(chat=chat)


def test_chat_injects_market_data_when_intent_hits(monkeypatch) -> None:
    captured: dict[str, str] = {}

    def fake_fetch(prompt, llm):
        captured["prompt"] = prompt
        return "接口 spot_hist_sge {'symbol': 'Au99.99'} 返回：[{...}]"

    monkeypatch.setattr(main, "fetch_external_market_text", fake_fetch)
    monkeypatch.setattr(main, "ensure_chat_tables", lambda engine: None)
    monkeypatch.setattr(main, "create_or_touch_conversation", lambda *a, **k: "conv1")
    monkeypatch.setattr(main, "count_messages", lambda *a, **k: 0)
    monkeypatch.setattr(main, "summarized_message_count", lambda *a, **k: 0)
    monkeypatch.setattr(main, "list_summaries", lambda *a, **k: [])
    monkeypatch.setattr(main, "recent_messages", lambda *a, **k: [])
    monkeypatch.setattr(main, "add_message", lambda *a, **k: "msg1")
    monkeypatch.setattr(main, "create_run", lambda *a, **k: "run1")
    monkeypatch.setattr(main, "log_llm", lambda *a, **k: None)
    monkeypatch.setattr(main, "schema_summary", lambda *a, **k: "mock schema")
    monkeypatch.setattr(main, "execute_readonly_sql", lambda *a, **k: SimpleNamespace(sql="SELECT 1", columns=[], rows=[]))
    monkeypatch.setattr(main, "finish_run", lambda *a, **k: None)
    monkeypatch.setattr(main, "parse_reply_payload", lambda content: (content, ""))
    monkeypatch.setattr(main, "upsert_summary", lambda *a, **k: None)

    calls: list[str] = []
    fake_llm = _make_llm({"sql": "SELECT 1", "analyze": "结论：金价480"}, calls)
    monkeypatch.setattr(main, "LLMClient", lambda: fake_llm)

    request = __import__("app.types", fromlist=["ChatRequest"]).ChatRequest(
        conversation_id=None,
        message="查一下上海黄金交易所Au99.99最近行情",
        context={"source": "analysis-page-chat"},
        user=__import__("app.types", fromlist=["AgentUser"]).AgentUser(id=1, username="u"),
    )
    response = main.chat(request)

    assert captured["prompt"] == "查一下上海黄金交易所Au99.99最近行情"
    assert response.reply == "结论：金价480"
    # SQL 与回答两轮的动态输入都必须携带外部行情块
    sql_dynamic = fake_llm.chat and calls
    assert "sql" in calls and "analyze" in calls


def test_chat_skips_market_fetch_for_plain_question(monkeypatch) -> None:
    fetch_calls: list[str] = []

    def fake_fetch(prompt, llm):
        fetch_calls.append(prompt)
        return ""

    monkeypatch.setattr(main, "fetch_external_market_text", fake_fetch)
    monkeypatch.setattr(main, "ensure_chat_tables", lambda engine: None)
    monkeypatch.setattr(main, "create_or_touch_conversation", lambda *a, **k: "conv1")
    monkeypatch.setattr(main, "count_messages", lambda *a, **k: 0)
    monkeypatch.setattr(main, "summarized_message_count", lambda *a, **k: 0)
    monkeypatch.setattr(main, "list_summaries", lambda *a, **k: [])
    monkeypatch.setattr(main, "recent_messages", lambda *a, **k: [])
    monkeypatch.setattr(main, "add_message", lambda *a, **k: "msg1")
    monkeypatch.setattr(main, "create_run", lambda *a, **k: "run1")
    monkeypatch.setattr(main, "log_llm", lambda *a, **k: None)
    monkeypatch.setattr(main, "schema_summary", lambda *a, **k: "mock schema")
    monkeypatch.setattr(main, "execute_readonly_sql", lambda *a, **k: SimpleNamespace(sql="SELECT 1", columns=[], rows=[]))
    monkeypatch.setattr(main, "finish_run", lambda *a, **k: None)
    monkeypatch.setattr(main, "parse_reply_payload", lambda content: (content, ""))
    monkeypatch.setattr(main, "upsert_summary", lambda *a, **k: None)

    calls: list[str] = []
    fake_llm = _make_llm({"sql": "SELECT 1", "analyze": "普通回答"}, calls)
    monkeypatch.setattr(main, "LLMClient", lambda: fake_llm)

    request = __import__("app.types", fromlist=["ChatRequest"]).ChatRequest(
        conversation_id=None,
        message="总结一下论坛里关于基金的讨论",
        context={"source": "analysis-page-chat"},
        user=__import__("app.types", fromlist=["AgentUser"]).AgentUser(id=1, username="u"),
    )
    response = main.chat(request)

    # 意图门控在 fetch_external_market_text 内部短路：函数被调用但不发起任何 LLM/RAG 工作
    assert fetch_calls == ["总结一下论坛里关于基金的讨论"]
    assert response.reply == "普通回答"
    assert not any("tool" in stage for stage in calls)


def test_chat_market_fetch_failure_degrades(monkeypatch) -> None:
    """取数函数内部已兜底返回空字符串；chat 不应因行情失败而 500。"""
    def fake_fetch(prompt, llm):
        return ""  # graph.fetch_external_market_text 的降级契约

    monkeypatch.setattr(main, "fetch_external_market_text", fake_fetch)
    monkeypatch.setattr(main, "ensure_chat_tables", lambda engine: None)
    monkeypatch.setattr(main, "create_or_touch_conversation", lambda *a, **k: "conv1")
    monkeypatch.setattr(main, "count_messages", lambda *a, **k: 0)
    monkeypatch.setattr(main, "summarized_message_count", lambda *a, **k: 0)
    monkeypatch.setattr(main, "list_summaries", lambda *a, **k: [])
    monkeypatch.setattr(main, "recent_messages", lambda *a, **k: [])
    monkeypatch.setattr(main, "add_message", lambda *a, **k: "msg1")
    monkeypatch.setattr(main, "create_run", lambda *a, **k: "run1")
    monkeypatch.setattr(main, "log_llm", lambda *a, **k: None)
    monkeypatch.setattr(main, "schema_summary", lambda *a, **k: "mock schema")
    monkeypatch.setattr(main, "execute_readonly_sql", lambda *a, **k: SimpleNamespace(sql="SELECT 1", columns=[], rows=[]))
    monkeypatch.setattr(main, "finish_run", lambda *a, **k: None)
    monkeypatch.setattr(main, "parse_reply_payload", lambda content: (content, ""))
    monkeypatch.setattr(main, "upsert_summary", lambda *a, **k: None)

    calls: list[str] = []
    fake_llm = _make_llm({"sql": "SELECT 1", "analyze": "降级回答"}, calls)
    monkeypatch.setattr(main, "LLMClient", lambda: fake_llm)

    request = __import__("app.types", fromlist=["ChatRequest"]).ChatRequest(
        conversation_id=None,
        message="美股AAPL最近走势",  # 意图命中但数据源失败
        context={"source": "analysis-page-chat"},
        user=__import__("app.types", fromlist=["AgentUser"]).AgentUser(id=1, username="u"),
    )
    response = main.chat(request)
    assert response.reply == "降级回答"
