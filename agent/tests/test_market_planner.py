"""多步行情取数规划器测试：计划编排、占位符替换、步骤执行与降级。"""

import json
from types import SimpleNamespace

from app import market_planner
from app.market_planner import (
    _resolve_placeholders,
    analyze_market_data,
    plan_steps,
    run_market_plan,
)


class ScriptedLLM:
    """按 (stage, 序号) 脚本化回复的假 LLM；记录每次调用。"""

    def __init__(self, tool_replies: list[str]) -> None:
        self.tool_replies = list(tool_replies)
        self.tool_index = 0
        self.calls: list[tuple[str, str]] = []

    def chat(self, messages, user_prompt, stage=""):
        self.calls.append((stage, messages[-1]["content"][:80]))
        if stage == "tool":
            reply = self.tool_replies[min(self.tool_index, len(self.tool_replies) - 1)]
            self.tool_index += 1
            return SimpleNamespace(content=reply, request={"model": "fake", "messages": messages}, response={}, latency_ms=1)
        return SimpleNamespace(content="ok", request={"model": "fake", "messages": messages}, response={}, latency_ms=1)

    def analyze(self, system_prompt, user_prompt, stage=""):
        return "ok"


PLAN_TWO_STEPS = json.dumps([
    {"step": 1, "purpose": "查华天科技的股票代码", "interface": "stock_info_a_code_name"},
    {"step": 2, "purpose": "查华天科技日K", "interface": "stock_zh_a_hist"},
])


def test_plan_steps_parses_llm_plan_and_caps_steps() -> None:
    llm = ScriptedLLM([PLAN_TWO_STEPS])
    steps = plan_steps(llm, "看一下华天科技")
    assert [s["interface"] for s in steps] == ["stock_info_a_code_name", "stock_zh_a_hist"]
    assert steps[0]["purpose"] == "查华天科技的股票代码"


def test_plan_steps_rejects_garbage() -> None:
    assert plan_steps(ScriptedLLM(["我觉得应该分两步"]), "x") == []
    assert plan_steps(ScriptedLLM(["[]"]), "x") == []
    assert plan_steps(ScriptedLLM(['{"step": 1}']), "x") == []


def test_plan_steps_caps_at_max() -> None:
    big_plan = json.dumps([
        {"step": i, "purpose": f"步骤{i}", "interface": "spot_hist_sge"} for i in range(1, 9)
    ])
    steps = plan_steps(ScriptedLLM([big_plan]), "x")
    assert len(steps) == market_planner.MAX_STEPS


def test_resolve_placeholders_pulls_value_from_prior_step() -> None:
    step_results = [{
        "step": 1,
        "purpose": "查代码",
        "result": {"columns": ["代码", "名称"], "rows": [{"代码": "002185", "名称": "华天科技"}]},
    }]
    resolved = _resolve_placeholders({"symbol": "$step1.股票代码"}, step_results)
    assert resolved["symbol"] == "002185"
    # 解析不到的占位符保留原样
    unresolved = _resolve_placeholders({"symbol": "$step2.不存在"}, step_results)
    assert unresolved["symbol"] == "$step2.不存在"


def test_run_market_plan_two_steps_end_to_end(monkeypatch) -> None:
    """计划两步：查代码 -> 用代码查日K；两步结果都进入最终文本。"""
    llm = ScriptedLLM([
        PLAN_TWO_STEPS,                     # 规划
        json.dumps({"symbol": "002185"}),   # step1 填参（无参数接口，占位即可）
        json.dumps({"action": "next"}),     # step1 后继续
        json.dumps({"symbol": "002185", "period": "daily"}),  # step2 填参
        json.dumps({"action": "satisfied"}),  # step2 后结束
    ])

    code_table = {"interface": "stock_info_a_code_name", "columns": ["代码", "名称"], "rows": [{"代码": "002185", "名称": "华天科技"}], "total_rows": 1}
    daily = {"interface": "stock_zh_a_hist", "columns": ["日期", "收盘"], "rows": [{"日期": "2026-10-13", "收盘": 14.98}], "total_rows": 1}
    captured: dict[str, tuple] = {}

    def fake_call(name, arguments):
        captured["calls"] = captured.get("calls", []) + [(name, arguments)]
        return code_table if name == "stock_info_a_code_name" else daily

    monkeypatch.setattr(market_planner, "call_akshare", fake_call)

    text = run_market_plan(llm, "看一下华天科技", lambda name: f"接口 {name} 文档")

    assert [name for name, _ in captured["calls"]] == ["stock_info_a_code_name", "stock_zh_a_hist"]
    # 第二步的参数由第一步结果解析而来
    assert captured["calls"][1][1]["symbol"] == "002185"
    assert "华天科技" in text and "14.98" in text


def test_run_market_plan_runs_analyst_after_steps(monkeypatch) -> None:
    """步骤产出后走 analyst 循环节点：返回整理后的事实清单而非原始摘要。

    单步计划的 LLM 调用次序：plan -> fill -> analyst(keep) -> analyst(finish)
    -> analyst 最终清单（decide_next 对单步短路）。
    """
    llm = ScriptedLLM([
        json.dumps([{"step": 1, "purpose": "直接取", "interface": "spot_hist_sge"}]),  # plan
        "{}",  # step1 填参（无参数接口）
        json.dumps({"action": "keep", "fact": "Au99.99 最新收盘 480.5（2024-01-02）"}),  # analyst 轮1
        json.dumps({"action": "finish"}),  # analyst 轮2：数据足够
        "数据事实清单：Au99.99 最新收盘 480.5（2024-01-02），数据覆盖至该日，完整无截断。",  # 最终清单
    ])
    monkeypatch.setattr(
        market_planner, "call_akshare",
        lambda name, arguments: {"interface": name, "arguments": arguments, "columns": ["date", "close"],
                                  "rows": [{"date": "2024-01-02", "close": 480.5}], "total_rows": 1},
    )
    text = run_market_plan(llm, "上海金行情", lambda name: "doc")
    assert text.startswith("数据事实清单：")
    assert "480.5" in text
    # analyst 循环 + 最终清单共 3 次 tool 调用在 fill 之后
    assert llm.calls[-1][0] == "tool"
    assert len(llm.calls) == 5


def test_analyst_loop_views_step_data_on_demand(monkeypatch) -> None:
    """analyst 先看目录，view 某步后再 keep/finish；查看内容进对话。"""
    from app.market_planner import analyze_market_data

    llm = ScriptedLLM([
        json.dumps({"action": "view", "step": 2, "filter": "2026"}),
        json.dumps({"action": "keep", "fact": "最新收盘 14.98（2026-10-13）"}),
        json.dumps({"action": "finish"}),
        "数据事实清单：最新收盘 14.98（2026-10-13）。",
    ])
    step_results = [
        {"step": 1, "purpose": "查代码", "interface": "stock_info_a_code_name",
         "result": {"arguments": {}, "columns": ["code"], "rows": [{"code": "688981"}], "total_rows": 1}},
        {"step": 2, "purpose": "查日K", "interface": "stock_zh_a_hist",
         "result": {"arguments": {"symbol": "688981"}, "columns": ["日期", "收盘"],
                     "rows": [{"日期": "2020-07-16", "收盘": 82.92}, {"日期": "2026-10-13", "收盘": 14.98}],
                     "total_rows": 2}},
    ]
    text = analyze_market_data(llm, "看一下中芯国际", step_results)
    assert text.startswith("数据事实清单：")
    # view 轮的下一条 user 消息（calls[1] 记录的是该轮的最后一条 user 内容）
    # 包含过滤后的 2026 行，不含 2020 行
    viewed_content = llm.calls[1][1]
    assert "2026-10-13" in viewed_content and "14.98" in viewed_content
    assert "2020-07-16" not in viewed_content


def test_run_market_plan_falls_back_to_raw_when_analyst_fails(monkeypatch) -> None:
    """analyst 循环失败（输出不可解析）-> 回落原始步骤摘要，不丢数据。"""
    llm = ScriptedLLM([
        json.dumps([{"step": 1, "purpose": "直接取", "interface": "spot_hist_sge"}]),  # plan
        "{}",  # step1 填参
        "我觉得应该先看步骤一",  # analyst 轮1 不可解析 -> 循环退出 -> facts 空 -> 返回空
    ])
    monkeypatch.setattr(
        market_planner, "call_akshare",
        lambda name, arguments: {"interface": name, "arguments": arguments, "columns": ["date", "close"],
                                  "rows": [{"date": "2024-01-02", "close": 480.5}], "total_rows": 1},
    )
    text = run_market_plan(llm, "上海金行情", lambda name: "doc")
    assert "480.5" in text and "[步骤1]" in text  # 原始摘要仍在


def test_run_market_plan_fails_fast_when_plan_dies(monkeypatch) -> None:
    """第一步就 fail（数据源没有该标的）-> 返回空文本降级。"""
    llm = ScriptedLLM([
        PLAN_TWO_STEPS,
        "{}",
        json.dumps({"action": "fail", "reason": "数据源没有该标的"}),
    ])
    monkeypatch.setattr(
        market_planner, "call_akshare",
        lambda name, arguments: {"interface": name, "columns": [], "rows": [], "total_rows": 0},
    )
    assert run_market_plan(llm, "看一下不存在的标的", lambda name: "doc") == ""


def test_run_market_plan_survives_tool_error(monkeypatch) -> None:
    """接口调用抛 AkshareToolError：记为空结果，计划继续/终止不抛异常。"""
    from app.akshare_tool import AkshareToolError

    llm = ScriptedLLM([
        json.dumps([{"step": 1, "purpose": "直接取", "interface": "spot_hist_sge"}]),
        "{}",
        json.dumps({"action": "satisfied"}),
    ])

    def boom(name, arguments):
        raise AkshareToolError("接口调用失败")

    monkeypatch.setattr(market_planner, "call_akshare", boom)
    assert run_market_plan(llm, "上海金行情", lambda name: "doc") == ""


def test_run_market_plan_empty_plan_returns_empty(monkeypatch) -> None:
    assert run_market_plan(ScriptedLLM(["我不输出 JSON"]), "x", lambda name: "doc") == ""


def test_run_market_plan_audits_every_step(monkeypatch) -> None:
    """每步取数（含重试与重规划轮）都触发 on_step 审计，记录接口+参数+行数+错误。"""
    llm = ScriptedLLM([
        # 轮1 plan：东财链两步
        json.dumps([
            {"step": 1, "purpose": "查代码", "interface": "stock_info_a_code_name"},
            {"step": 2, "purpose": "查日K", "interface": "stock_zh_a_hist"},
        ]),
        json.dumps({"_row_filter": "牧原股份"}),                      # fill step1
        json.dumps({"action": "next"}),                               # decide
        json.dumps({"symbol": "002714", "start_date": "20261001"}),   # fill step2（将失败）
        json.dumps({"symbol": "002714", "start_date": "20261001"}),   # fill step2 重试
        # replan plan：换新浪源
        json.dumps([{"step": 1, "purpose": "查日K", "interface": "stock_zh_a_daily"}]),
        json.dumps({"symbol": "sz002714", "start_date": "20261001"}), # replan fill
        json.dumps({"action": "finish"}),                             # analyst finish
        "数据事实清单：002714 最新收盘 41.23（2026-10-19）。",          # analyst 最终
    ])

    def fake_call(name, arguments):
        if name == "stock_zh_a_hist":
            from app.akshare_tool import AkshareToolError
            raise AkshareToolError("remote end closed")
        if name == "stock_info_a_code_name":
            return {"interface": name, "arguments": arguments, "columns": ["code"],
                    "rows": [{"code": "002714"}], "total_rows": 1}
        return {"interface": name, "arguments": arguments, "columns": ["date", "close"],
                "rows": [{"date": "2026-10-19", "close": 41.23}], "total_rows": 1}

    monkeypatch.setattr(market_planner, "call_akshare", fake_call)
    audits: list[dict] = []
    text = run_market_plan(llm, "继续", lambda name: "doc", on_step=audits.append)

    assert "41.23" in text
    # 至少 3 条审计：step1 成功、step2 失败（重试）、重规划轮新浪成功
    by_iface = {(a["round"], a["interface"]): a for a in audits}
    step1 = by_iface[(0, "stock_info_a_code_name")]
    assert step1["rows"] == 1 and step1["error"] == ""
    assert step1["arguments"] == {"_row_filter": "牧原股份"}
    step2 = [a for a in audits if a["interface"] == "stock_zh_a_hist"]
    assert step2 and step2[0]["rows"] == 0 and "失败" in step2[0]["error"]
    replan = by_iface[(1, "stock_zh_a_daily")]
    assert replan["rows"] == 1 and replan["error"] == ""
    assert replan["arguments"]["symbol"] == "sz002714"


def test_run_market_plan_audit_callback_exception_never_breaks(monkeypatch) -> None:
    """审计回调抛异常不能打断取数主管线。"""
    llm = ScriptedLLM([
        json.dumps([{"step": 1, "purpose": "直接取", "interface": "spot_hist_sge"}]),
        "{}",                             # fill
        json.dumps({"action": "finish"}), # analyst finish
        "数据事实清单：最新收盘 480.5。",
    ])
    monkeypatch.setattr(
        market_planner, "call_akshare",
        lambda name, arguments: {"interface": name, "arguments": arguments, "columns": ["close"],
                                  "rows": [{"close": 480.5}], "total_rows": 1},
    )

    def bad_audit(record):
        raise RuntimeError("audit sink down")

    text = run_market_plan(llm, "上海金行情", lambda name: "doc", on_step=bad_audit)
    assert "480.5" in text


def test_history_flows_through_planner_chain() -> None:
    """history 必须到达 plan / fill / decide / analyst 的每一轮 prompt。"""
    llm = ScriptedLLM([
        json.dumps([{"step": 1, "purpose": "取行情", "interface": "spot_hist_sge"}]),  # plan
        json.dumps({}),  # fill
        json.dumps({"action": "satisfied"}),  # decide（1步计划会短路，这里防御性保留）
        json.dumps({"action": "keep", "fact": "Au99.99 最新收盘 480.5"}),  # analyst 轮1
        json.dumps({"action": "finish"}),  # analyst 轮2
        "数据事实清单：Au99.99 最新收盘 480.5。",  # analyst 最终
    ])
    history = [{"role": "user", "content": "看一下上海金"}, {"role": "assistant", "content": "好的"}]
    orig_call = market_planner.call_akshare
    market_planner.call_akshare = lambda name, arguments: {"interface": name, "arguments": arguments, "columns": ["close"], "rows": [{"close": 480.5}], "total_rows": 1}
    try:
        text = run_market_plan(llm, "继续", lambda name: "doc", history)
    finally:
        market_planner.call_akshare = orig_call

    assert "上海金" in text or "480.5" in text
    # plan / fill / analyst 的动态输入里都带历史
    assert "上海金" in llm.calls[0][1]  # plan
    assert "上海金" in llm.calls[1][1]  # fill
    assert any("上海金" in content for _, content in llm.calls[3:])  # analyst 轮次


def test_analyst_final_output_leak_is_sanitized(monkeypatch) -> None:
    """最终清单复读内部协议 JSON 时，用 facts 兜底输出而非透传。"""
    llm = ScriptedLLM([
        json.dumps({"action": "keep", "fact": "比亚迪A股代码为002594，最新收盘价数据缺失"}),
        json.dumps({"action": "finish"}),
        '{"action": "keep", "fact": "比亚迪A股代码为002594"}',  # 复读协议原文
    ])
    step_results = [{"step": 1, "purpose": "查代码", "interface": "stock_info_a_code_name",
                     "result": {"arguments": {}, "columns": ["code"], "rows": [{"code": "002594"}], "total_rows": 1}}]
    text = analyze_market_data(llm, "继续", step_results, [{"role": "user", "content": "看一下比亚迪"}])
    assert '"action"' not in text  # 协议原文不能透传
    assert "002594" in text  # facts 兜底


def test_replan_on_partial_failure_uses_prefill(monkeypatch) -> None:
    """部分步骤失败（东财限流）-> 触发重规划且必须换不同接口；成功步骤结果保留为前序。"""
    history = [{"role": "user", "content": "看一下牧原股份的日K行情"}]
    replan_prompts: list[str] = []

    # 消耗次序：plan1, fill1, decide(next), fill2, fill2-retry,
    # [decide 短路：len(step_results)==len(steps) 直接 satisfied，不调 LLM]
    # replan-plan, replan-fill, analyst(finish), analyst final
    llm = ScriptedLLM([
        # 轮1 plan：东财链
        json.dumps([
            {"step": 1, "purpose": "查代码", "interface": "stock_info_a_code_name"},
            {"step": 2, "purpose": "查日K", "interface": "stock_zh_a_hist"},
        ]),
        json.dumps({"_row_filter": "牧原股份"}),                       # fill step1
        json.dumps({"action": "next"}),                                # decide after step1
        json.dumps({"symbol": "002714", "start_date": "20261001"}),   # fill step2
        json.dumps({"symbol": "002714", "start_date": "20261001"}),   # fill step2 重试
        # replan plan（重规划）：换新浪链（decide 对最后一步短路，不消耗）
        json.dumps([
            {"step": 1, "purpose": "查日K", "interface": "stock_zh_a_daily"},
        ]),
        json.dumps({"symbol": "sz002714", "start_date": "20261001"}), # replan fill
        json.dumps({"action": "finish"}),                              # analyst finish
        "数据事实清单：002714 最新收盘 41.23（2026-10-19）。",          # analyst 最终
    ])

    def fake_call(name, arguments):
        if name == "stock_zh_a_hist":
            from app.akshare_tool import AkshareToolError
            raise AkshareToolError("接口 stock_zh_a_hist 调用失败: remote end closed")
        if name == "stock_info_a_code_name":
            return {"interface": name, "arguments": arguments, "columns": ["code", "name"],
                    "rows": [{"code": "002714", "name": "牧原股份"}], "total_rows": 1}
        return {"interface": name, "arguments": arguments, "columns": ["date", "close"],
                "rows": [{"date": "2026-10-19", "close": 41.23}], "total_rows": 1}

    monkeypatch.setattr(market_planner, "call_akshare", fake_call)

    text = run_market_plan(llm, "继续", lambda name: "doc", history)

    # 重规划轮真的发起了（step2 失败 -> 外层带教训重规划）
    plan_prompts = [c[1] for c in llm.calls if "上一轮计划的以下步骤全部失败" in c[1]]
    assert plan_prompts, "replan prompt was never issued"
    assert "上一轮计划的以下步骤全部失败" in plan_prompts[0]
    assert "改用备用数据源" in plan_prompts[0]
    # 最终拿到了新浪源的数据
    assert "41.23" in text and "2026-10-19" in text


def test_no_replan_when_all_steps_succeed(monkeypatch) -> None:
    """全部成功不触发重规划（只有一次 plan 调用）。"""
    # 单步计划 decide 短路（len(step_results)==len(steps)），不消耗 decide 回复。
    llm = ScriptedLLM([
        json.dumps([{"step": 1, "purpose": "直接取", "interface": "spot_hist_sge"}]),
        "{}",                                          # fill
        json.dumps({"action": "finish"}),              # analyst finish
        "数据事实清单：最新收盘 480.5。",
    ])
    monkeypatch.setattr(
        market_planner, "call_akshare",
        lambda name, arguments: {"interface": name, "arguments": arguments, "columns": ["close"],
                                  "rows": [{"close": 480.5}], "total_rows": 1},
    )
    text = run_market_plan(llm, "上海金行情", lambda name: "doc")
    assert "480.5" in text
    # plan 调用的 dynamic 含"用户问题"且非 fill/analyst/decide 特征
    plan_calls = [c for c in llm.calls if "当前步骤目的" not in c[1] and "取数数据集" not in c[1]
                  and "计划：步骤" not in c[1] and "已确认的事实" not in c[1]
                  and "请开始筛选" not in c[1] and "上一轮计划" not in c[1]]
    assert len(plan_calls) == 1
