"""chat 管线的外部行情接入测试：先查库，库内结果不足且意图命中才降级取数。"""

from types import SimpleNamespace

from app import main
from app.graph import needs_external_market_data


class _FakeChatResult(SimpleNamespace):
    pass


def _make_llm(content_by_stage: dict[str, str], calls: list):
    """stage -> content 的假 LLM；记录每次调用。tool 分类默认判为业务问题。"""

    def chat(messages, user_prompt, stage=""):
        calls.append(stage)
        content = content_by_stage.get(stage, '{"smalltalk": false}' if stage == "tool" else "ok")
        return SimpleNamespace(
            content=content,
            request={"model": "fake-model", "messages": messages},
            response={},
            latency_ms=1,
        )

    return SimpleNamespace(chat=chat)


def test_chat_fetches_market_data_only_when_db_result_empty(monkeypatch) -> None:
    """库内查询结果为空（回答不了）且 LLM 门控判定需要外部数据 -> 降级取数并注入。"""
    captured: dict[str, str] = {}

    def fake_fetch(prompt, llm):
        captured["prompt"] = prompt
        return "接口 spot_hist_sge {'symbol': 'Au99.99'} 返回：[{...}]"

    monkeypatch.setattr(main, "fetch_external_market_text", fake_fetch)
    monkeypatch.setattr(main, "classify_external_data_need", lambda llm, prompt, engine=None: True)
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
    # 第一个 LLM 调用是 smalltalk 分类（tool），其后才是 SQL 生成
    assert calls[0] == "tool"
    assert "sql" in calls and "analyze" in calls


def test_chat_skips_market_fetch_when_db_result_has_rows(monkeypatch) -> None:
    """先查库后取数：库内有行时即使意图命中也绝不远程取数。"""
    fetch_calls: list[str] = []

    def fake_fetch(prompt, llm):
        fetch_calls.append(prompt)
        return "不该被取到的外部数据"

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
    monkeypatch.setattr(main, "execute_readonly_sql", lambda *a, **k: SimpleNamespace(sql="SELECT 1", columns=["price"], rows=[{"price": "480"}]))
    monkeypatch.setattr(main, "finish_run", lambda *a, **k: None)
    monkeypatch.setattr(main, "parse_reply_payload", lambda content: (content, ""))
    monkeypatch.setattr(main, "upsert_summary", lambda *a, **k: None)

    calls: list[str] = []
    fake_llm = _make_llm({"sql": "SELECT 1", "analyze": "库内回答"}, calls)
    monkeypatch.setattr(main, "LLMClient", lambda: fake_llm)

    request = __import__("app.types", fromlist=["ChatRequest"]).ChatRequest(
        conversation_id=None,
        message="查一下上海黄金交易所Au99.99最近行情",
        context={"source": "analysis-page-chat"},
        user=__import__("app.types", fromlist=["AgentUser"]).AgentUser(id=1, username="u"),
    )
    response = main.chat(request)

    assert fetch_calls == []  # 库内数据足够，不发起取数
    assert response.reply == "库内回答"


def test_chat_skips_market_fetch_for_plain_question(monkeypatch) -> None:
    """LLM 门控判定不需要外部数据 -> 不发起取数。"""
    fetch_calls: list[str] = []

    def fake_fetch(prompt, llm):
        fetch_calls.append(prompt)
        return ""

    monkeypatch.setattr(main, "fetch_external_market_text", fake_fetch)
    gate_calls: list[str] = []
    def fake_gate(llm, prompt, engine=None):
        gate_calls.append(prompt)
        return False
    monkeypatch.setattr(main, "classify_external_data_need", fake_gate)
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

    # 库内结果为空时门控被调用一次并拒绝；取数函数完全不被触发
    assert gate_calls == ["总结一下论坛里关于基金的讨论"]
    assert fetch_calls == []
    assert response.reply == "普通回答"
    # 只有 smalltalk 分类一次 tool 调用，无 akshare 参数规划的 tool 调用
    assert calls.count("tool") == 1


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
