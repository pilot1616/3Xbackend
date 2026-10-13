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


def _result_digest(result: dict[str, Any]) -> str:
    """步骤结果的紧凑摘要，注入后续 LLM 调用。"""
    from .akshare_tool import format_result_for_prompt

    return format_result_for_prompt(result)[:STEP_RESULT_CHARS]


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

    # 汇总所有步骤产出
    parts = [
        f"[步骤{r['step']}] {r['purpose']}（{r['interface']}）：{_result_digest(r['result'])}"
        for r in step_results
        if r["result"].get("rows")
    ]
    return "\n\n".join(parts)
