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
from typing import Any

from .akshare_tool import AkshareToolError, call_akshare, catalog_summary
from .llm import LLMClient, build_stable_messages

# 计划步数上限：每步伴随一次参数填写 + 一次继续/终止判断，网关延迟下必须封顶。
MAX_STEPS = 3
# 注入 LLM 的步骤结果摘要每步上限（字符）。
STEP_RESULT_CHARS = 1200

_PLAN_SYSTEM = (
    "你是行情数据取数规划器。用户的问题在内部数据库没有查到结果，需要通过外部"
    " AKShare 接口取数回答。以下是可用接口目录（名称+能力摘要）：\n{catalog}\n\n"
    "请规划一个逐步取数计划。规则：\n"
    f"- 最多 {MAX_STEPS} 步，每步调用一个接口；\n"
    '- 参数里可以引用前序步骤的结果，写法为 "$stepN.字段说明"，例如第一步查'
    ' "华天科技的代码"，第二步参数写 {"symbol": "$step1.代码"}；\n'
    "- 如果问题需要先做名称到代码的解析（如 A股中文名），第一步应使用代码名称表接口；\n"
    "- 能一步取到就直接一步，不要为简单问题强行拆步。\n"
    '只输出一行 JSON 数组，不要解释，不要 Markdown：'
    '[{"step": 1, "purpose": "这一步取什么", "interface": "接口名"}, ...]'
)

_FILL_SYSTEM = (
    "你是 AKShare 接口参数填写助手。根据接口文档、用户问题和前序步骤的结果，"
    "为当前这一步填写调用参数。前序结果里如果有占位符引用的信息，直接用具体值替换。"
    "日期参数一律用 yyyymmdd 字符串；只输出一行 JSON 参数对象，"
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
    """把 $stepN.field 占位符替换为前序步骤结果里的值；解析不到的保留原样交 LLM 处理。"""
    resolved: dict[str, Any] = {}
    for key, value in arguments.items():
        text = str(value)
        if not text.startswith("$step"):
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
    """在步骤结果里按提示找值：先精确列名，再按行内模糊匹配。"""
    rows = step_result.get("rows") or []
    columns = step_result.get("columns") or []
    if not rows:
        return None
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


def plan_steps(llm: LLMClient, prompt: str) -> list[dict[str, Any]]:
    """生成取数步骤计划；计划非法或为空返回 []。"""
    try:
        result = llm.chat(
            build_stable_messages(
                _PLAN_SYSTEM.replace("{catalog}", _catalog_digest()),
                "输出约定：只输出一行 JSON 数组。",
                f"用户问题：{prompt}",
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


def fill_arguments(llm: LLMClient, interface: str, interface_doc: str, prompt: str, purpose: str, step_results: list[dict[str, Any]]) -> dict[str, Any]:
    """为当前步骤填参数；解析失败返回空参数（必填校验会拦下并报错）。"""
    results_text = "\n\n".join(
        f"步骤{r['step']}（{r['purpose']}）：{_result_digest(r['result'])}" for r in step_results
    ) or "（无前序步骤）"
    dynamic = (
        f"用户问题：{prompt}\n\n当前步骤目的：{purpose}\n\n"
        f"接口：{interface}\n文档：\n{interface_doc}\n\n前序步骤结果：\n{results_text}\n\n"
        "请输出该接口的调用参数 JSON。"
    )
    try:
        result = llm.chat(
            build_stable_messages(_FILL_SYSTEM, "输出约定：只输出一行 JSON 参数对象。", dynamic),
            "",
            stage="tool",
        )
        payload = _parse_json_object(result.content)
        return payload if payload else {}
    except Exception:
        return {}


def decide_next(llm: LLMClient, prompt: str, steps: list[dict[str, Any]], step_results: list[dict[str, Any]]) -> str:
    """判断取数是否完成：satisfied / next / fail；判断失败保守按 satisfied（已有数据可用）。"""
    if len(step_results) >= len(steps):
        return "satisfied"
    plan_text = "；".join(f"步骤{s['step']}:{s['purpose']}({s['interface']})" for s in steps)
    results_text = "\n\n".join(
        f"步骤{r['step']}（{r['purpose']}）：{_result_digest(r['result'])}" for r in step_results
    )
    try:
        result = llm.chat(
            build_stable_messages(
                _DECIDE_SYSTEM,
                "输出约定：只输出一行 JSON。",
                f"用户问题：{prompt}\n\n计划：{plan_text}\n\n已获结果：\n{results_text}",
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


def run_market_plan(llm: LLMClient, prompt: str, search_doc) -> str:
    """规划并执行取数计划，返回注入分析轮的 market_data_text。

    search_doc: (interface_name) -> str，返回接口文档文本（RAG/目录查找的回调）。
    任何环节失败都不抛异常：返回空字符串降级，由主管线继续。
    """
    steps = plan_steps(llm, prompt)
    if not steps:
        return ""

    step_results: list[dict[str, Any]] = []
    for step in steps:
        interface = step["interface"]
        interface_doc = search_doc(interface)
        arguments = fill_arguments(llm, interface, interface_doc, prompt, step["purpose"], step_results)
        # 占位符先做本地替换，减少 LLM 填参出错面
        arguments = _resolve_placeholders(arguments, step_results)
        try:
            result = call_akshare(interface, arguments)
        except AkshareToolError:
            result = {"interface": interface, "arguments": arguments, "columns": [], "rows": [], "total_rows": 0, "error": "调用失败"}
        step_results.append({**step, "result": result})

        action = decide_next(llm, prompt, steps, step_results)
        if action == "fail":
            # 计划不可达：放弃取数（除非已有部分结果可用）
            if any((r["result"].get("rows") for r in step_results)):
                break
            return ""
        if action == "satisfied":
            break

    # 汇总所有步骤产出：中间步骤（代码表等大表）按整体用户问题+各步目的过滤命中行
    parts = []
    for r in step_results:
        if not r["result"].get("rows"):
            continue
        hints = [prompt] + [s["purpose"] for s in steps]
        parts.append(
            f"[步骤{r['step']}] {r['purpose']}（{r['interface']}）：{_result_digest(r['result'], hints)}"
        )
    raw_text = "\n\n".join(parts)
    if not raw_text:
        return ""

    # analyst 节点：循环式筛选。数据集带元信息分页给 LLM，按需查看，
    # 避免把全部原始数据塞进单个 prompt。失败回落原始摘要文本。
    curated = analyze_market_data(llm, prompt, step_results)
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
    "工作方式：\n"
    "1. 数据按步骤组织，每步有元信息（接口、参数、行数）和简要预览；完整数据按需查看；\n"
    "2. 每轮你只能输出一行 JSON，不要解释，不要 Markdown：\n"
    '   - 查看某步的完整数据: {"action": "view", "step": 2, "filter": "可选，行过滤关键词，如 2026-10 或 中芯"}\n'
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
        preview = json.dumps(rows[:BRIEF_ROWS], ensure_ascii=False, default=str) if rows else "（无数据行）"
        if len(preview) > 400:
            preview = preview[:400] + "…"
        blocks.append(
            f"[步骤{r['step']}] {r['purpose']}\n"
            f"  接口: {r['interface']} 参数: {json.dumps(result.get('arguments', {}), ensure_ascii=False)}{error}\n"
            f"  共 {result.get('total_rows', len(rows))} 行，列: {columns}\n"
            f"  预览: {preview}"
        )
    return "\n".join(blocks)


def _view_step_data(step_result: dict[str, Any], filter_hint: str) -> str:
    """返回某步的完整数据（可带本地过滤）；超长时头尾保留。"""
    rows = step_result["result"].get("rows") or []
    if filter_hint:
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


def analyze_market_data(llm: LLMClient, prompt: str, step_results: list[dict[str, Any]]) -> str:
    """analyst 循环：目录 → 按需查看 → 累积事实 → 输出事实清单。

    返回事实清单文本；整个循环失败时返回空串（调用方回落原始摘要）。
    """
    if not step_results or not any((r["result"].get("rows") for r in step_results)):
        return ""

    brief = _dataset_brief(step_results)
    dynamic = f"用户问题：{prompt}\n\n取数数据集：\n{brief}\n\n请开始筛选（输出一行 JSON）。"
    facts: list[str] = []
    messages = build_stable_messages(_ANALYST_SYSTEM, "输出约定：每轮只输出一行 JSON。", dynamic)

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
                _ANALYST_SYSTEM,
                _ANALYST_FINAL_INSTRUCTION,
                f"用户问题：{prompt}\n\n已确认的事实：\n{facts_text}",
            ),
            "",
            stage="tool",
        )
        text = (final.content or "").strip()
        return text if len(text) >= 30 else ""
    except Exception:
        return ""
