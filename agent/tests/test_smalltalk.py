"""闲聊意图判断（LLM 分类）与 /chat 闲聊直答路径测试。"""

import json
from types import SimpleNamespace

from app import main
from app.smalltalk import classify_message


# ---- LLM 分类器 ----


def _classifier_llm(reply: str, calls: list | None = None):
    def chat(messages, user_prompt, stage=""):
        if calls is not None:
            calls.append((stage, messages))
        return SimpleNamespace(content=reply, request={"model": "fake", "messages": messages}, response={}, latency_ms=1)

    return SimpleNamespace(chat=chat)


def test_classifier_detects_smalltalk_variants() -> None:
    assert classify_message(_classifier_llm('{"smalltalk": true, "type": "identity"}'), "你是小狗")
    assert classify_message(_classifier_llm('{"smalltalk": true, "type": "greeting"}'), "早上好")
    assert classify_message(_classifier_llm('好的，结果如下：{"smalltalk": true} 请查收'), "谢谢")


def test_classifier_routes_business_questions_to_pipeline() -> None:
    assert not classify_message(_classifier_llm('{"smalltalk": false, "type": "business"}'), "分析黄金")
    assert not classify_message(_classifier_llm('{"smalltalk": false}'), "英伟达最新股价")


def test_classifier_defaults_to_business_on_bad_output() -> None:
    # JSON 解析失败 / 缺字段 / 抛异常 -> 一律按业务问题走查库管线
    assert not classify_message(_classifier_llm("我觉得是闲聊"), "你好")
    assert not classify_message(_classifier_llm('{"type": "greeting"}'), "你好")
    assert not classify_message(_classifier_llm(""), "你好")


def test_classifier_includes_recent_history() -> None:
    calls: list = []
    llm = _classifier_llm('{"smalltalk": false}', calls)
    classify_message(llm, "继续", [{"role": "user", "content": "分析黄金"}, {"role": "assistant", "content": "金价480"}])
    dynamic = calls[0][1][-1]["content"]
    assert "分析黄金" in dynamic and "金价480" in dynamic and "最新消息：继续" in dynamic


# ---- /chat 闲聊直答路径 ----


def _patch_chat_pipeline(monkeypatch, classifier_reply: str, reply: str = "你好呀，我是 AI 助手", chat_log: list | None = None):
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
    monkeypatch.setattr(main, "fetch_external_market_text", lambda *a, **k: [])

    execute_calls: list = []

    def fake_execute(*a, **k):
        execute_calls.append(1)
        return SimpleNamespace(sql="SELECT 1", columns=[], rows=[])

    monkeypatch.setattr(main, "execute_readonly_sql", fake_execute)

    def chat(messages, user_prompt, stage=""):
        if chat_log is not None:
            chat_log.append((stage, messages))
        # 分类器调用：输出 classifier_reply；其余 stage：输出 reply
        content = classifier_reply if stage == "tool" else reply
        return SimpleNamespace(content=content, request={"model": "fake", "messages": messages}, response={}, latency_ms=1)

    fake_llm = SimpleNamespace(chat=chat)
    monkeypatch.setattr(main, "LLMClient", lambda: fake_llm)
    return execute_calls


def _make_request(message: str):
    return __import__("app.types", fromlist=["ChatRequest"]).ChatRequest(
        conversation_id=None,
        message=message,
        context={"source": "analysis-page-chat"},
        user=__import__("app.types", fromlist=["AgentUser"]).AgentUser(id=1, username="u"),
    )


def test_chat_smalltalk_skips_sql_pipeline(monkeypatch) -> None:
    chat_log: list = []
    execute_calls = _patch_chat_pipeline(monkeypatch, '{"smalltalk": true, "type": "identity"}', chat_log=chat_log)

    response = main.chat(_make_request("你是小狗"))

    assert response.reply == "你好呀，我是 AI 助手"
    assert execute_calls == []  # 不查库
    # 第一轮是 tool 分类，第二轮才是闲聊直答；不存在 sql stage
    assert [stage for stage, _ in chat_log] == ["tool", "analyze"]


def test_chat_business_question_still_uses_sql_pipeline(monkeypatch) -> None:
    monkeypatch.setattr(main, "schema_summary", lambda *a, **k: "mock schema")
    chat_log: list = []
    execute_calls = _patch_chat_pipeline(monkeypatch, '{"smalltalk": false}', reply="结论：金价480", chat_log=chat_log)

    response = main.chat(_make_request("分析黄金"))

    assert response.reply == "结论：金价480"
    assert len(execute_calls) == 1  # 照常查库
    assert "sql" in [stage for stage, _ in chat_log]  # 走完整管线


def test_chat_classifier_failure_falls_back_to_pipeline(monkeypatch) -> None:
    monkeypatch.setattr(main, "schema_summary", lambda *a, **k: "mock schema")
    chat_log: list = []
    execute_calls = _patch_chat_pipeline(monkeypatch, "分类器坏了", reply="结论：按业务回答", chat_log=chat_log)

    response = main.chat(_make_request("你是小狗"))

    # 分类失败 -> 保守走业务管线
    assert response.reply == "结论：按业务回答"
    assert len(execute_calls) == 1
