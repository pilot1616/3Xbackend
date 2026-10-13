"""闲聊意图识别与 /chat 闲聊直答路径测试。"""

from types import SimpleNamespace

from app import main
from app.smalltalk import is_smalltalk


# ---- 意图识别 ----


def test_greetings_and_identity_are_smalltalk() -> None:
    assert is_smalltalk("你好")
    assert is_smalltalk("hello!")
    assert is_smalltalk("你是谁")
    assert is_smalltalk("你是小狗")
    assert is_smalltalk("你会什么")
    assert is_smalltalk("谢谢")
    assert is_smalltalk("拜拜")


def test_data_questions_are_never_smalltalk() -> None:
    assert not is_smalltalk("分析黄金")
    assert not is_smalltalk("英伟达最新股价")
    assert not is_smalltalk("查一下最近的AI日报")
    assert not is_smalltalk("黄金和英伟达的股价有没有什么隐藏关系")
    assert not is_smalltalk("你好，帮我看看黄金行情")  # 问候+数据诉求=业务问题


def test_long_or_empty_text_is_not_smalltalk() -> None:
    assert not is_smalltalk("")
    assert not is_smalltalk("这是很长的一段话" * 10)
    # 短句无数据诉求、也不匹配任何闲聊模式：保守视为业务问题
    assert not is_smalltalk("帮我个忙")


# ---- /chat 闲聊直答路径 ----


def _patch_chat_pipeline(monkeypatch, fetch_calls: list, execute_calls: list, reply: str = "你好呀，我是 AI 助手", chat_log: list | None = None):
    monkeypatch.setattr(main, "ensure_chat_tables", lambda engine: None)
    monkeypatch.setattr(main, "create_or_touch_conversation", lambda *a, **k: "conv1")
    monkeypatch.setattr(main, "count_messages", lambda *a, **k: 0)
    monkeypatch.setattr(main, "summarized_message_count", lambda *a, **k: 0)
    monkeypatch.setattr(main, "list_summaries", lambda *a, **k: [])
    monkeypatch.setattr(main, "recent_messages", lambda *a, **k: [])
    monkeypatch.setattr(main, "add_message", lambda *a, **k: "msg1")
    monkeypatch.setattr(main, "create_run", lambda *a, **k: "run1")
    monkeypatch.setattr(main, "log_llm", lambda *a, **k: None)
    monkeypatch.setattr(main, "finish_run", lambda *a, **k: None)
    monkeypatch.setattr(main, "parse_reply_payload", lambda content: (content, ""))
    monkeypatch.setattr(main, "upsert_summary", lambda *a, **k: None)
    monkeypatch.setattr(main, "fetch_external_market_text", lambda *a, **k: fetch_calls.append(1) or "")

    def fake_execute(*a, **k):
        execute_calls.append(1)
        return SimpleNamespace(sql="SELECT 1", columns=[], rows=[])

    monkeypatch.setattr(main, "execute_readonly_sql", fake_execute)

    def chat(messages, user_prompt, stage=""):
        if chat_log is not None:
            chat_log.append((stage, messages))
        return SimpleNamespace(
            content=reply,
            request={"model": "fake", "messages": messages},
            response={},
            latency_ms=1,
        )

    fake_llm = SimpleNamespace(chat=chat)
    monkeypatch.setattr(main, "LLMClient", lambda: fake_llm)
    return fake_llm


def _make_request(message: str):
    return __import__("app.types", fromlist=["ChatRequest"]).ChatRequest(
        conversation_id=None,
        message=message,
        context={"source": "analysis-page-chat"},
        user=__import__("app.types", fromlist=["AgentUser"]).AgentUser(id=1, username="u"),
    )


def test_chat_smalltalk_skips_sql_pipeline(monkeypatch) -> None:
    fetch_calls: list = []
    execute_calls: list = []
    chat_log: list = []
    _patch_chat_pipeline(monkeypatch, fetch_calls, execute_calls, chat_log=chat_log)

    response = main.chat(_make_request("你是小狗"))

    assert response.reply == "你好呀，我是 AI 助手"
    assert execute_calls == []  # 不查库
    assert fetch_calls == []  # 不抓外部行情
    assert chat_log[0][0] == "analyze"  # 闲聊只走一轮直答
    assert "你是小狗" in chat_log[0][1][-1]["content"]
    assert "schema" not in chat_log[0][1][0]["content"].lower() or "mock" not in chat_log[0][1][0]["content"]


def test_chat_business_question_still_uses_sql_pipeline(monkeypatch) -> None:
    fetch_calls: list = []
    execute_calls: list = []
    monkeypatch.setattr(main, "schema_summary", lambda *a, **k: "mock schema")
    _patch_chat_pipeline(monkeypatch, fetch_calls, execute_calls, reply="结论：金价480")

    response = main.chat(_make_request("分析黄金"))

    assert response.reply == "结论：金价480"
    assert len(execute_calls) == 1  # 照常查库
