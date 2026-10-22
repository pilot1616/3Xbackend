# -*- coding: utf-8 -*-
"""多步行情取数规划器：LLM 编排计划，执行器逐步调用白名单接口。

流程（fetch-data 降级路径使用）：
  1. 规划：接口目录摘要 + 用户问题 → LLM 输出步骤计划（≤ MAX_STEPS 步）；
  2. 执行循环（每步）：
     a. 解析参数里的占位符（$stepN.field 引用前序步骤结果）；
     b. 该接口完整文档 → LLM 填参数（含前序结果摘要）；
     c. 调白名单接口（call_akshare，失败抛 AkshareToolError）；
     d. 结果摘要 → LLM 判断：satisfied（够回答）/ next（继续）/ replan（修订计划）；
  3. 全部步骤产出拼接为 market_data_text。

设计约束：
- 执行器不做业务决策，只做参数替换、白名单调用与结果传递；
- LLM 判断失败、计划非法、步数超限都保守终止，绝不抛异常打断主管线；
- 每步之间 LLM 决策走 tool stage 模型（最便宜）。
"""
from __future__ import annotations

import json
import re
import time
from datetime import date
from typing import Any

from .akshare_tool import AkshareToolError, call_akshare, catalog_summary
from .llm import LLMClient, build_stable_messages

# 计划步数上限：每步伴随一次参数填写 + 一次继续/终止判断，网关延迟下必须封顶。
MAX_STEPS = 3
# 外部取数全链（规划+执行+重规划+analyst）的总预算：超时立即降级为空数据，
# 防止 planner 循环 × 重规划 × analyst 多轮叠加把一次聊天拖到小时级。
MARKET_PLAN_BUDGET_SECONDS = 300.0
# 注入 LLM 的步骤结果摘要每步上限（字符）。
STEP_RESULT_CHARS = 1200

_PLAN_SYSTEM = (
    "你是行情数据取数规划器。用户的问题在内部数据库没有查到结果，需要通过外部"
    " AKShare 接口取数回答。以下是可用接口目录（名称+能力摘要）：\n{catalog}\n\n"
    "请规划一个逐步取数计划。规则：\n"
    f"- 最多 {MAX_STEPS} 步，每步调用一个接口；\n"
    '- 参数里可以引用前序步骤的结果，写法为 "$stepN.字段说明"，例如第一步查'
    ' "华天科技的代码"，第二步参数写 {"symbol": "$step1.代码"}；\n'
    "- 全市场大表接口（A股代码名称表 stock_info_a_code_name、A股实时快照"
    " stock_zh_a_spot_em）支持元参数 _row_filter：填用户问题里的标的名称关键词，"
    "服务端会在全表行内过滤后再返回，务必带上，否则命中行会被截断吞掉；\n"
    "- 如果问题需要先做名称到代码的解析（如 A股中文名），优先用 stock_info_a_code_name"
    "（其数据源不稳定，若该步失败可将 stock_zh_a_spot_em + _row_filter 作为备选）；\n"
    "- A股日 K 优先用 stock_zh_a_hist；如果它调用失败（东财 kline 接口常被限流），"
    "改用备用的 stock_zh_a_daily（新浪源，symbol 要带 sz/sh 前缀，如 sz002594）；\n"
    "- 能一步取到就直接一步，不要为简单问题强行拆步。\n"
    '只输出一行 JSON 数组，不要解释，不要 Markdown：'
    '[{"step": 1, "purpose": "这一步取什么", "interface": "接口名"}, ...]'
)

_FILL_SYSTEM = (
    "你是 AKShare 接口参数填写助手。根据接口文档、用户问题和前序步骤的结果，"
    "为当前这一步填写调用参数。前序结果里如果有占位符引用的信息，直接用具体值替换。"
    "日期参数一律用 yyyymmdd 字符串，且以今天（{today}）为锚："
    "查最新行情时 end_date 用今天、start_date 用最近 1~3 个月，绝不要沿用历史对话里出现过的旧日期；"
    "全市场大表接口（stock_info_a_code_name、"
    "stock_zh_a_spot_em）必须带 _row_filter 参数，值为用户问题里的标的名关键词"
    '（如 中芯国际、紫金矿业），也支持 jq 表达式（以 . 开头，如 . | map(select(.name == "牧原股份"))）。'
    '引用前序步骤结果时，占位符支持 jq 精确取值："$step1<[0].code>" 取第1步第一行的 code 字段，'
    '或 "$step1<map(select(.name == "牧原股份")) | .[0].code>" 按名称筛选后取代码。'
    "只输出一行 JSON 参数对象，"
    "不要解释，不要 Markdown：{\"参数名\": \"值\", ...}"
)

_DECIDE_SYSTEM = (
    "你是取数进度判断器。根据用户问题、取数计划和已获得的步骤结果，判断当前数据是否"
    "足够回答问题。只输出一行 JSON：{\"action\": \"satisfied\" 或 \"next\" 或 \"fail\", "
    "\"reason\": \"一句话理由\"}。satisfied=数据足够；next=计划还有后续步骤且当前结果正常；"
    "fail=计划无法达成（接口反复失败/结果与问题无关/数据源没有该标的数据），应放弃取数。"
)


def _catalog_digest() -> str:
    """接口目录摘要（每接口一行：名称+描述），供规划用。"""
    return "\n".join(f"- {item['name']}：{item['description']}" for item in catalog_summary())


def _parse_json_object(text: str) -> dict[str, Any] | None:
    """从 LLM 回复中抠出第一个 JSON 对象；失败返回 None。"""
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        payload = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def _extract_iface_doc_text(interface_doc: str) -> str:
    return interface_doc


def _resolve_placeholders(arguments: dict[str, Any], step_results: list[dict[str, Any]]) -> dict[str, Any]:
    """把 $stepN 占位符替换为前序步骤结果里的值；解析不到的保留原样交 LLM 处理。

    两种写法：
    - "$stepN.提示词"：列名/模糊匹配（旧格式，向后兼容）；
    - "$stepN<jq 表达式>"：jq 作用于该步 rows，如 "$step1<[0].code"、
      "$step1<map(select(.name == \\"牧原股份\\")) | .[0].code>"。
    """
    resolved: dict[str, Any] = {}
    for key, value in arguments.items():
        text = str(value)
        if not text.startswith("$step"):
            resolved[key] = value
            continue
        # jq 形式：$stepN<expression>
        jq_match = re.match(r"^\$step(\d+)<(.+)>$", text, re.DOTALL)
        if jq_match:
            step_no, expr = int(jq_match.group(1)), jq_match.group(2)
            source = next((r for r in step_results if r.get("step") == step_no), None)
            if source:
                from .jq_filter import eval_jq

                jq_rows = eval_jq(source["result"].get("rows") or [], expr.strip())
                if jq_rows:
                    first = jq_rows[0]
                    resolved[key] = first.get("value", first) if isinstance(first, dict) else first
                else:
                    resolved[key] = value  # 无结果/失败，保留原样
            else:
                resolved[key] = value
            continue
        match = re.match(r"^\$step(\d+)\.(.+)$", text)
        if not match:
            resolved[key] = value
            continue
        step_no, hint = int(match.group(1)), match.group(2)
        source = next((r for r in step_results if r.get("step") == step_no), None)
        resolved[key] = _find_value(source["result"], hint) if source else value
    return resolved


def _find_value(step_result: dict[str, Any], hint: str) -> Any:
    """在步骤结果里按提示找值：jq 路径优先，再列名精确匹配，最后行内模糊匹配。

    hint 以 . 开头时视为 jq 表达式，作用于该步的 rows（如 ".[0].code"）。
    """
    rows = step_result.get("rows") or []
    if not rows:
        return None

    from .jq_filter import eval_jq, is_jq_filter

    if is_jq_filter(hint):
        jq_rows = eval_jq(rows, hint)
        if jq_rows:
            first = jq_rows[0]
            return first.get("value", first) if isinstance(first, dict) else first
        if jq_rows is not None:
            return None  # 合法 jq 但无结果

    columns = step_result.get("columns") or []
    hint_lower = hint.lower()
    exact = [c for c in columns if c.lower() in hint_lower or hint_lower in c.lower()]
    for row in rows:
        for col in exact:
            if row.get(col):
                return row[col]
    # 模糊：在第一行的所有值里找包含提示词的
    for row in rows:
        for value in row.values():
            if value and hint_lower in str(value).lower():
                return value
    return None


def _result_digest(result: dict[str, Any], hints: list[str] | None = None) -> str:
    """步骤结果的紧凑摘要，注入后续 LLM 调用。

    hints 是当前/后续步骤的占位符提示（如"股票代码"）：全市场大表（代码表、
    实时快照）直接倾倒会被截断成无关的前 50 行，先按提示过滤出命中行再格式化。
    """
    from .akshare_tool import format_result_for_prompt

    filtered = result
    if hints and result.get("rows") and len(result["rows"]) > 10:
        matched = _filter_rows_by_hints(result, hints)
        if matched:
            filtered = {**result, "rows": matched, "total_rows": len(matched), "truncated": False,
                        "_filtered_note": f"已按提示过滤出 {len(matched)} 行相关记录"}
    return format_result_for_prompt(filtered)[:STEP_RESULT_CHARS]


def _filter_rows_by_hints(result: dict[str, Any], hints: list[str]) -> list[dict[str, Any]]:
    """在结果行里找包含任一提示词的行（名称/代码等模糊匹配）。"""
    hints_lower = [h.lower() for h in hints if h]
    if not hints_lower:
        return []
    matched = []
    for row in result["rows"]:
        row_text = " ".join(str(v) for v in row.values() if v).lower()
        if any(h in row_text for h in hints_lower):
            matched.append(row)
        if len(matched) >= 5:
            break
    return matched


# 注入规划/填参/决策/analyst 各环节的最近历史条数。
PLANNER_HISTORY_LIMIT = 6


def _history_text(history: list[dict[str, Any]] | None) -> str:
    """把对话历史压成紧凑文本；空返回空串。"""
    if not history:
        return ""
    lines = []
    for item in history[-PLANNER_HISTORY_LIMIT:]:
        role = str(item.get("role") or "user")
        content = str(item.get("content") or "")[:200]
        lines.append(f"{role}: {content}")
    return "[最近对话]\n" + "\n".join(lines)


def plan_steps(llm: LLMClient, prompt: str, history: list[dict[str, Any]] | None = None, replan_hint: str = "") -> list[dict[str, Any]]:
    """生成取数步骤计划；计划非法或为空返回 []。replan_hint 非空时是重规划（附失败教训）。"""
    hist = _history_text(history)
    dynamic = f"用户问题：{prompt}"
    if hist:
        dynamic = f"{hist}\n\n{dynamic}"
    if replan_hint:
        dynamic = (
            f"上一轮计划的以下步骤全部失败，请改用备用数据源重新规划"
            f"（如东财 kline 限流时改用新浪 stock_zh_a_daily）：\n{replan_hint}\n\n{dynamic}"
        )
    try:
        result = llm.chat(
            build_stable_messages(
                _PLAN_SYSTEM.replace("{catalog}", _catalog_digest()),
                "输出约定：只输出一行 JSON 数组。",
                dynamic,
            ),
            "",
            stage="tool",
        )
        text = result.content.strip()
        start, end = text.find("["), text.rfind("]")
        if start < 0 or end <= start:
            return []
        steps = json.loads(text[start : end + 1])
    except Exception:
        return []
    if not isinstance(steps, list) or not steps:
        return []
    valid = []
    for i, step in enumerate(steps[:MAX_STEPS], start=1):
        if not isinstance(step, dict) or not step.get("interface"):
            continue
        valid.append({"step": i, "purpose": str(step.get("purpose") or ""), "interface": str(step["interface"])})
    return valid


def fill_arguments(llm: LLMClient, interface: str, interface_doc: str, prompt: str, purpose: str, step_results: list[dict[str, Any]], history: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """为当前步骤填参数；解析失败返回空参数（必填校验会拦下并报错）。"""
    results_text = "\n\n".join(
        f"步骤{r['step']}（{r['purpose']}）：{_result_digest(r['result'])}" for r in step_results
    ) or "（无前序步骤）"
    hist = _history_text(history)
    hist_block = f"{hist}\n\n" if hist else ""
    dynamic = (
        f"{hist_block}用户问题：{prompt}\n\n当前步骤目的：{purpose}\n\n"
        f"接口：{interface}\n文档：\n{interface_doc}\n\n前序步骤结果：\n{results_text}\n\n"
        "请输出该接口的调用参数 JSON。"
    )
    try:
        result = llm.chat(
            build_stable_messages(_FILL_SYSTEM.replace("{today}", date.today().isoformat()), "输出约定：只输出一行 JSON 参数对象。", dynamic),
            "",
            stage="tool",
        )
        payload = _parse_json_object(result.content)
        return payload if payload else {}
    except Exception:
        return {}


def decide_next(llm: LLMClient, prompt: str, steps: list[dict[str, Any]], step_results: list[dict[str, Any]], history: list[dict[str, Any]] | None = None) -> str:
    """判断取数是否完成：satisfied / next / fail；判断失败保守按 satisfied（已有数据可用）。"""
    if len(step_results) >= len(steps):
        return "satisfied"
    plan_text = "；".join(f"步骤{s['step']}:{s['purpose']}({s['interface']})" for s in steps)
    results_text = "\n\n".join(
        f"步骤{r['step']}（{r['purpose']}）：{_result_digest(r['result'])}" for r in step_results
    )
    hist = _history_text(history)
    hist_block = f"{hist}\n\n" if hist else ""
    try:
        result = llm.chat(
            build_stable_messages(
                _DECIDE_SYSTEM,
                "输出约定：只输出一行 JSON。",
                f"{hist_block}用户问题：{prompt}\n\n计划：{plan_text}\n\n已获结果：\n{results_text}",
            ),
            "",
            stage="tool",
        )
        payload = _parse_json_object(result.content)
        if payload and payload.get("action") in ("satisfied", "next", "fail"):
            return str(payload["action"])
    except Exception:
        pass
    return "satisfied"


def run_market_plan(llm: LLMClient, prompt: str, search_doc, history: list[dict[str, Any]] | None = None) -> str:
    """规划并执行取数计划，返回注入分析轮的 market_data_text。

    search_doc: (interface_name) -> str，返回接口文档文本（RAG/目录查找的回调）。
    history 是最近对话（含指代消息的上文），透传给所有 LLM 子调用。
    首轮计划无产出时，带失败教训重规划一次（换备用数据源）。
    任何环节失败都不抛异常：返回空字符串降级，由主管线继续。
    整个外部取数链受总预算约束（deadline），超时立即降级返回空串。
    """
    deadline = time.monotonic() + MARKET_PLAN_BUDGET_SECONDS
    step_results = _run_plan_once(llm, prompt, search_doc, history, deadline=deadline)
    failures = getattr(_run_plan_once, "_last_failures", [])
    # 有失败步骤就重规划一次（换备用数据源），已成功的步骤结果作为 prefill 传入
    # （如已解析出的股票代码），重规划轮不必重取；全部成功则直接产出。
    if step_results and not failures:
        return _compose_output(llm, prompt, step_results, _plan_purposes(step_results), history, deadline=deadline)

    # 首轮无产出或部分失败：带失败教训重规划（如东财 kline 限流 -> 换新浪源）。
    lessons = "; ".join(
        f"步骤{s['step']} 接口 {s['interface']} 失败({s['error']})——"
        "必须改用【不同的接口/数据源】规划该步骤，不要再用同一个接口"
        for s in failures
    )
    if not lessons or time.monotonic() >= deadline:
        return ""
    prior_ok = [r for r in step_results if r["result"].get("rows")]
    step_results = _run_plan_once(llm, prompt, search_doc, history, replan_hint=lessons, prior_results=prior_ok, deadline=deadline)
    if step_results and any(r["result"].get("rows") for r in step_results):
        return _compose_output(llm, prompt, step_results, _plan_purposes(step_results), history, deadline=deadline)
    return ""


def _record_failures(step_results: list[dict[str, Any]]) -> None:
    """把失败步骤的教训挂到函数属性上，供外层重规划参考。"""
    _run_plan_once._last_failures = [
        {**s, "error": s["result"].get("error") or "返回空数据"}
        for s in step_results if not s["result"].get("rows")
    ]


def _run_plan_once(llm: LLMClient, prompt: str, search_doc, history, replan_hint: str = "", prior_results: list[dict[str, Any]] | None = None, deadline: float | None = None) -> list[dict[str, Any]]:
    """执行一轮完整的计划-执行流程，返回步骤结果列表（含空结果步骤）。

    replan_hint 非空表示重规划（附失败教训）；prior_results 是上一轮成功
    的步骤结果，作为前序上下文（占位符引用、填参参考）带入。
    deadline 是共享预算时钟：每个环节开始前检查，超时把剩余步骤记为跳过。
    """
    steps = plan_steps(llm, prompt, history, replan_hint)
    if not steps:
        return []

    step_results: list[dict[str, Any]] = list(prior_results or [])
    for step in steps:
        if deadline is not None and time.monotonic() >= deadline:
            step_results.append({"step": step.get("step", len(step_results) + 1), "interface": step["interface"], "purpose": step.get("purpose", ""), "result": {"columns": [], "rows": [], "total_rows": 0, "error": "外部取数总预算已用完，跳过"}})
            continue
        interface = step["interface"]
        interface_doc = search_doc(interface)
        arguments = fill_arguments(llm, interface, interface_doc, prompt, step["purpose"], step_results, history)
        # 占位符先做本地替换，减少 LLM 填参出错面
        arguments = _resolve_placeholders(arguments, step_results)
        try:
            result = call_akshare(interface, arguments)
        except AkshareToolError:
            # 数据源偶发抖动/源站挂掉：换一次参数重试（LLM 重新填参），
            # 仍失败才记为空结果。教训（错误信息）会出现在下一轮填参上下文里。
            retry_args = fill_arguments(
                llm, interface, interface_doc,
                prompt, step["purpose"] + "（上次该接口调用失败，请换参数或用备选参数重试）",
                step_results, history,
            )
            retry_args = _resolve_placeholders(retry_args, step_results)
            try:
                result = call_akshare(interface, retry_args)
            except AkshareToolError:
                result = {"interface": interface, "arguments": arguments, "columns": [], "rows": [], "total_rows": 0,
                          "error": "调用失败（重试后仍失败）"}
        step_results.append({**step, "result": result})

        action = decide_next(llm, prompt, steps, step_results, history)
        if action == "fail":
            # 计划不可达：终止本轮（失败教训已记录，供外层重规划）
            break
        if action == "satisfied":
            break

    # 记录失败步骤的教训（供外层重规划）；部分成功时只记失败的那些。
    failed = [s for s in step_results if not s["result"].get("rows")]
    if failed:
        _record_failures(step_results)
    else:
        _run_plan_once._last_failures = []
    return step_results


def _plan_purposes(step_results: list[dict[str, Any]]) -> list[str]:
    return [r["purpose"] for r in step_results]


def _compose_output(llm: LLMClient, prompt: str, step_results: list[dict[str, Any]], purposes: list[str], history, deadline: float | None = None) -> str:
    """汇总步骤产出并跑 analyst；无产出返回空串。"""
    parts = []
    for r in step_results:
        if not r["result"].get("rows"):
            continue
        hints = [prompt] + purposes
        parts.append(
            f"[步骤{r['step']}] {r['purpose']}（{r['interface']}）：{_result_digest(r['result'], hints)}"
        )
    raw_text = "\n\n".join(parts)
    if not raw_text:
        return ""
    curated = analyze_market_data(llm, prompt, step_results, history) if time.monotonic() < deadline else ""
    return curated if curated else raw_text


# ---- analyst：循环式数据筛选 ----

# 最多查看数据块的轮数（每轮一次 LLM 小调用，token 少而准）。
ANALYST_MAX_ROUNDS = 5
# 单次"查看数据块"返回给 LLM 的最大字符数（超出时本地截断，头尾保留）。
VIEW_CHARS = 1500
# 数据目录里每个步骤的简要信息行数上限。
BRIEF_ROWS = 3

_ANALYST_SYSTEM = (
    "你是行情数据分析师。fetch 环节刚通过外部接口取回了一批数据，你需要从中"
    "筛选出回答用户问题所需的事实，最后输出一份「数据事实清单」。\n"
    "今天是 {today}。行情数据的新鲜度至关重要：\n"
    "- 历史行情接口通常按日期升序返回，最新数据在【尾部最后一行】；\n"
    "- keep 之前必须确认日期是可得的最新交易日；如果 keep 的事实日期离今天超过 7 天，"
    "视为筛选失败，必须用 view（filter 填最新年份月份）定位最新行；\n"
    "- 引用价格时必须标注该价格的日期。\n"
    "工作方式：\n"
    "1. 数据按步骤组织，每步有元信息（接口、参数、行数）和简要预览；完整数据按需查看；\n"
    "2. 每轮你只能输出一行 JSON，不要解释，不要 Markdown：\n"
    '   - 查看某步的完整数据: {"action": "view", "step": 2, "filter": "<过滤条件>"}\n'
    '     filter 支持两种写法：\n'
    '     a) jq 表达式（以 . 开头，推荐，作用于该步的行数组）：\n'
    '        ".[-3:]" 取最新3行；". | map(select(\\"日期\\" >= \\"2026-10-01\\"))" 按日期过滤；\n'
    '        ". | map({日期, 收盘, 涨跌幅})" 只留需要的列；\n'
    '        ". | sort_by(.日期) | .[-1]" 取日期最新的一行\n'
    '     b) 普通关键词（如 2026-10），按行内包含匹配\n'
    '   - 记录一条事实并继续: {"action": "keep", "fact": "一句话事实（含具体数字与日期）"}\n'
    '   - 数据足够，输出最终清单: {"action": "finish"}\n'
    '   - 数据无法回答问题: {"action": "abort", "reason": "缺口说明"}\n'
    "3. facts 可以跨多轮累积（keep 多次）；view 不消耗 facts；\n"
    "4. 交叉核对一致性（名称与代码、日期口径），只保留与问题直接相关的数据；\n"
    "5. 不要给出投资结论或建议，只输出事实。\n"
    "你输出的每一轮都必须是上述四种 action 之一的 JSON。"
)

_ANALYST_FINAL_INSTRUCTION = (
    "基于以上已确认的事实（facts）输出最终的数据事实清单："
    "列出关键数字（最新价、日期、涨跌幅、市值等）、交叉核对结果、数据边界"
    "（数据覆盖到哪个日期、是否截断、哪些字段缺失）。"
    "不要给出投资结论或建议。"
)


def _dataset_brief(step_results: list[dict[str, Any]]) -> str:
    """数据目录：每步的元信息 + 前几行预览。LLM 据此决定查看哪步。"""
    blocks = []
    for r in step_results:
        result = r["result"]
        rows = result.get("rows") or []
        columns = result.get("columns") or []
        error = f"，错误：{result['error']}" if result.get("error") else ""
        row_filter = f"（已按「{result['row_filter']}」过滤）" if result.get("row_filter") else ""
        # 历史行情按日期升序返回：预览必须含尾部（最新数据），否则 LLM 只见最旧的行。
        if rows:
            preview = json.dumps(rows[:BRIEF_ROWS], ensure_ascii=False, default=str)
            if len(rows) > BRIEF_ROWS:
                tail = json.dumps(rows[-BRIEF_ROWS:], ensure_ascii=False, default=str)
                omitted = max(0, len(rows) - 2 * BRIEF_ROWS)
                preview += f"\n  ……（省略 {omitted} 行）……\n  尾部（最新）: {tail}"
            if len(preview) > 700:
                preview = preview[:700] + "…"
        else:
            preview = "（无数据行）"
        blocks.append(
            f"[步骤{r['step']}] {r['purpose']}\n"
            f"  接口: {r['interface']} 参数: {json.dumps(result.get('arguments', {}), ensure_ascii=False)}"
            f"{row_filter}{error}\n"
            f"  共 {result.get('total_rows', len(rows))} 行，列: {columns}\n"
            f"  预览: {preview}"
        )
    return "\n".join(blocks)


def _view_step_data(step_result: dict[str, Any], filter_hint: str) -> str:
    """返回某步的完整数据（可带过滤）；超长时头尾保留。

    filter_hint 以 . 或 [ 开头时按 jq 表达式求值（支持日期比较、排序、投影）；
    否则按关键词做行内包含匹配；jq 求值失败回落关键词。
    """
    rows = step_result["result"].get("rows") or []
    if filter_hint:
        from .jq_filter import eval_jq_text, is_jq_filter

        if is_jq_filter(filter_hint):
            jq_text = eval_jq_text(rows, filter_hint)
            if jq_text is not None:
                return f"jq 筛选「{filter_hint}」结果：\n{jq_text}"
            # jq 求值失败 -> 回落关键词匹配
        hint = filter_hint.lower()
        rows = [
            row for row in rows
            if hint in " ".join(str(v) for v in row.values() if v).lower()
        ]
        if not rows:
            return f"（步骤{step_result['step']} 没有匹配过滤条件「{filter_hint}」的行）"
    text = json.dumps(rows, ensure_ascii=False, default=str)
    if len(text) <= VIEW_CHARS:
        return f"共 {len(rows)} 行：{text}"
    # 头尾保留（最新行情在尾部）
    half = VIEW_CHARS // 2
    keep = max(1, len(rows) // 2)
    while keep > 1:
        head_part = json.dumps(rows[:keep], ensure_ascii=False, default=str)
        tail_part = json.dumps(rows[-keep:], ensure_ascii=False, default=str)
        if len(head_part) <= half and len(tail_part) <= half:
            omitted = len(rows) - 2 * keep
            return f"共 {len(rows)} 行（中间省略 {omitted} 行，尾部是最新数据）：\n{head_part}\n……\n{tail_part}"
        keep = max(1, keep // 2)
    return f"共 {len(rows)} 行（仅保留最后一行，即最新数据）：\n{json.dumps(rows[-1:], ensure_ascii=False, default=str)}"


def analyze_market_data(llm: LLMClient, prompt: str, step_results: list[dict[str, Any]], history: list[dict[str, Any]] | None = None) -> str:
    """analyst 循环：目录 → 按需查看 → 累积事实 → 输出事实清单。

    返回事实清单文本；整个循环失败时返回空串（调用方回落原始摘要）。
    """
    if not step_results or not any((r["result"].get("rows") for r in step_results)):
        return ""

    brief = _dataset_brief(step_results)
    hist = _history_text(history)
    hist_block = f"{hist}\n\n" if hist else ""
    system = _ANALYST_SYSTEM.replace("{today}", date.today().isoformat())
    dynamic = f"{hist_block}用户问题：{prompt}\n\n取数数据集：\n{brief}\n\n请开始筛选（输出一行 JSON）。"
    facts: list[str] = []
    messages = build_stable_messages(system, "输出约定：每轮只输出一行 JSON。", dynamic)

    try:
        for _ in range(ANALYST_MAX_ROUNDS):
            result = llm.chat(messages, "", stage="tool")
            payload = _parse_json_object(result.content or "")
            if not payload:
                break
            action = payload.get("action")

            if action == "keep":
                fact = str(payload.get("fact") or "").strip()
                if fact:
                    facts.append(fact)

            if action == "finish":
                break
            if action == "abort":
                reason = str(payload.get("reason") or "数据无法回答问题")
                facts.append(f"[数据缺口] {reason}")
                break
            if action == "view":
                step_no = int(payload.get("step") or 0)
                target = next((r for r in step_results if r["step"] == step_no), None)
                view_text = _view_step_data(target, str(payload.get("filter") or "")) if target else f"（不存在步骤{step_no}）"
                # 查看结果作为新一轮 user 消息追加，模型在原对话上继续
                messages.append({"role": "assistant", "content": json.dumps(payload, ensure_ascii=False)})
                messages.append({"role": "user", "content": f"[步骤{step_no} 数据]\n{view_text}\n\n继续（输出一行 JSON；已记录事实 {len(facts)} 条）。"})
            else:
                # keep 或无法识别的动作：让模型继续下一轮
                messages.append({"role": "assistant", "content": json.dumps(payload, ensure_ascii=False)})
                messages.append({"role": "user", "content": f"已记录 {len(facts)} 条事实。继续（输出一行 JSON）。"})

        if not facts:
            return ""
        facts_text = "\n".join(f"- {f}" for f in facts)
        final = llm.chat(
            build_stable_messages(
                system,
                _ANALYST_FINAL_INSTRUCTION,
                f"{hist_block}用户问题：{prompt}\n\n已确认的事实：\n{facts_text}",
            ),
            "",
            stage="tool",
        )
        text = (final.content or "").strip()
        # 协议泄漏防护：模型偶尔复读循环里的 action JSON 原文而非人话清单。
        # 检测到内部协议标记时直接用 facts 兜底输出（事实本身是可靠的）。
        if '"action"' in text or text.lstrip("-* ").startswith('{"'):
            header = f"数据事实清单（用户问题：{prompt}）：\n"
            return header + facts_text if len(header + facts_text) >= 30 else ""
        return text if len(text) >= 30 else ""
    except Exception:
        return ""
