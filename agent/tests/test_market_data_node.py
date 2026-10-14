import json

from types import SimpleNamespace

import pytest

from app.akshare_tool import AkshareToolError
from app.graph import _extract_json, classify_external_data_need, needs_external_market_data
from app.market_rag import search_interfaces


# ---- 意图判断 ----


def test_intent_gate_hits_external_market_requests() -> None:
    assert needs_external_market_data("查一下上海黄金交易所Au99.99的历史行情")
    assert needs_external_market_data("美股 AAPL 最近日线走势")
    assert needs_external_market_data("最新的CPI是多少")
    assert needs_external_market_data("给我黄金的现货价格")


def test_intent_gate_passes_internal_analysis() -> None:
    # 库内数据/闲聊类请求不应触发远程取数。
    assert not needs_external_market_data("分析近7天AI日报的主题热度")
    assert not needs_external_market_data("总结一下论坛里关于基金的讨论")
    assert not needs_external_market_data("你好")


# ---- RAG 接口检索 ----


def test_rag_finds_sge_interface_for_gold_query() -> None:
    hits = search_interfaces("查一下上海黄金交易所Au99.99的历史行情", topk=2)
    assert hits[0]["interface"] == "spot_hist_sge"
    assert "输入参数" in hits[0]["doc"]


def test_rag_exact_interface_name_wins() -> None:
    hits = search_interfaces("stock_us_hist 的参数有哪些", topk=1)
    assert hits[0]["interface"] == "stock_us_hist"


def test_rag_only_returns_whitelisted_interfaces() -> None:
    from app.akshare_tool import CATALOG

    hits = search_interfaces("获取全部A股的tick逐笔成交数据", topk=5)
    assert all(h["interface"] in CATALOG for h in hits)


# ---- JSON 提取 ----


def test_extract_json_plain_and_fenced() -> None:
    assert _extract_json('{"interface": "a"}') == '{"interface": "a"}'
    assert _extract_json('```json\n{"interface": "a", "arguments": {"x": "1"}}\n```') == '{"interface": "a", "arguments": {"x": "1"}}'
    assert _extract_json('好的，结果如下：{"interface": "a"} 请查收') == '{"interface": "a"}'
    with pytest.raises(ValueError):
        _extract_json("没有对象")


# ---- 节点执行（mock LLM 与 akshare 执行）----


class FakeLLM:
    """按需返回内容：need_external 为门控分类回复，其余按 replies 队列依次返回。"""

    def __init__(self, content: str, need_external: bool = True) -> None:
        self.content = content
        self.need_external = need_external
        self.calls = 0
        self.stages: list[str] = []

    def chat(self, messages, user_prompt="", stage=""):
        self.calls += 1
        self.stages.append(stage)
        if stage == "tool" and self.calls == 1:
            # 第一次 tool 调用是外部数据需求分类
            return SimpleNamespace(
                content=json.dumps({"need_external": self.need_external}),
                request={"model": "fake", "messages": messages},
                response={},
                latency_ms=1,
            )
        return SimpleNamespace(
            content=self.content,
            request={"model": "fake", "messages": messages},
            response={},
            latency_ms=1,
        )

    def analyze(self, system_prompt, user_prompt, stage=""):
        return self.content


def _make_graph_with(monkeypatch, llm, akshare_result=None, akshare_error=False):
    import app.graph as graph_mod

    monkeypatch.setattr(graph_mod, "LLMClient", lambda logger=None: llm)
    if akshare_error:
        def boom(name, arguments):
            raise AkshareToolError("接口调用失败")
        monkeypatch.setattr(graph_mod, "call_akshare", boom)
    else:
        monkeypatch.setattr(graph_mod, "call_akshare", lambda name, arguments: akshare_result)
    return graph_mod.build_graph(db_engine=object()).nodes["fetch_market_data"].bound


def test_fetch_market_node_skips_non_market_prompt(monkeypatch) -> None:
    """LLM 门控判定为非数据诉求 -> 不发起取数。"""
    llm = FakeLLM("", need_external=False)
    node = _make_graph_with(monkeypatch, llm)
    state = node.invoke({"prompt": "分析AI日报主题热度", "query_result": None, "market_data_text": None})
    assert state["market_data_text"] == ""
    assert llm.calls == 1  # 只花一次门控分类调用，无接口规划调用


def test_fetch_market_node_skips_when_db_result_sufficient(monkeypatch) -> None:
    """先查库后取数：库内有行时即使意图命中也不远程取数。"""
    llm = FakeLLM("")
    node = _make_graph_with(monkeypatch, llm)
    state = node.invoke({
        "prompt": "上海金交所最新行情",
        "query_result": {"sql": "SELECT 1", "columns": ["price"], "rows": [{"price": "480"}]},
        "market_data_text": None,
    })
    assert state["market_data_text"] == ""
    assert llm.calls == 0  # 库内数据足够，一次 LLM 都不花


def test_fetch_market_node_calls_tool_and_formats(monkeypatch) -> None:
    decision = json.dumps({"interface": "spot_hist_sge", "arguments": {"symbol": "Au99.99"}})
    llm = FakeLLM(decision)
    akshare_result = {
        "interface": "spot_hist_sge",
        "arguments": {"symbol": "Au99.99"},
        "rows": [{"date": "2024-01-02", "close": 480.5}],
        "total_rows": 1,
        "truncated": False,
    }
    node = _make_graph_with(monkeypatch, llm, akshare_result=akshare_result)
    state = node.invoke({"prompt": "查一下上海黄金交易所Au99.99的历史行情", "query_result": None})
    assert "spot_hist_sge" in state["market_data_text"]
    assert "480.5" in state["market_data_text"]


def test_fetch_market_node_rejects_off_candidate_interface(monkeypatch) -> None:
    # LLM 幻觉出候选之外（目录之外）的接口 -> 必须拒绝，不能执行。
    llm = FakeLLM('{"interface": "stock_zh_a_tick_163", "arguments": {}}')
    node = _make_graph_with(monkeypatch, llm, akshare_result={"rows": [{"x": 1}], "total_rows": 1, "interface": "x", "arguments": {}, "truncated": False})
    state = node.invoke({"prompt": "上海金交所最新行情", "query_result": None})
    assert state["market_data_text"] == ""


def test_fetch_market_node_survives_tool_error(monkeypatch) -> None:
    llm = FakeLLM('{"interface": "spot_hist_sge", "arguments": {"symbol": "Au99.99"}}')
    node = _make_graph_with(monkeypatch, llm, akshare_error=True)
    state = node.invoke({"prompt": "上海金交所最新行情", "query_result": None})
    assert state["market_data_text"] == ""


def test_fetch_market_node_survives_bad_llm_json(monkeypatch) -> None:
    llm = FakeLLM("我觉得应该用 spot_hist_sge，但是我不输出 JSON")
    node = _make_graph_with(monkeypatch, llm, akshare_result={"rows": [], "total_rows": 0, "interface": "x", "arguments": {}, "truncated": False})
    state = node.invoke({"prompt": "上海金交所最新行情", "query_result": None})
    assert state["market_data_text"] == ""


def test_external_gate_uses_history_for_anaphora(monkeypatch) -> None:
    """「继续」类指代消息：门控必须结合历史判断，而不是只看字面。"""
    import json as _json
    from types import SimpleNamespace as _NS

    class GateLLM:
        def __init__(self):
            self.calls = []

        def chat(self, messages, user_prompt="", stage=""):
            self.calls.append((stage, messages[-1]["content"]))
            return _NS(content=_json.dumps({"need_external": True}),
                       request={"model": "fake", "messages": messages}, response={}, latency_ms=1)

        def analyze(self, system_prompt, user_prompt, stage=""):
            return ""

    llm = GateLLM()
    history = [
        {"role": "user", "content": "看一下比亚迪"},
        {"role": "assistant", "content": "结论：库里没有比亚迪的记录，无法判断。"},
    ]
    assert classify_external_data_need(llm, "继续", engine=None, history=history)
    # 历史进入了门控 prompt，字面"继续"旁边的上文可见
    assert "比亚迪" in llm.calls[0][1]
