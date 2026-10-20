# -*- coding: utf-8 -*-
"""jq 求值：对 API 返回的 JSON 数据做结构化筛选。

设计：
- 优先用 python jq 绑定（进程内，无子进程开销）；未安装时回落系统 jq 命令；
  两者都不可用时返回 None，调用方回落到关键词模糊匹配。
- 判断规则：filter 表达式以 "." 或 "[" 开头视为 jq；否则视为普通关键词，
  走调用方原有的 contains 匹配（保持旧行为与 LLM 的低成本用法）。
- 非 ASCII 字段名自动改写：akshare 返回的列名多为中文（如 .日期），而 jq 的
  `.field` 语法只接受 ASCII 标识符——求值前把 .中文 / {中文} 自动改写为
  .["中文"] / {"中文"}，LLM 直接写中文列名即可。
- 安全：jq 是纯函数式查询语言，无 IO/执行能力；输出加字符上限防止
  "select * 全表" 式表达式把 5000 行灌进 prompt。
"""
from __future__ import annotations

import json
import re
import subprocess
from typing import Any

# jq 输出的字符上限：超长截断（尾部是最新数据，保留尾部）。
JQ_OUTPUT_CHARS = 2000
# 非 ASCII 字段名（akshare 中文列名）：.日期 -> .["日期"]，{日期, 收盘} -> {"日期", "收盘"}
_UNICODE_FIELD_RE = re.compile(
    r"(\.\s*)?([\u4e00-\u9fff][\u4e00-\u9fff\w]*(?:\s*,\s*[\u4e00-\u9fff][\u4e00-\u9fff\w]*)*)(?=\s*[,\}\)\s]|$)"
)


def _normalize_unicode_fields(expression: str) -> str:
    """把 jq 表达式里的裸中文字段名改写成 ["中文"] 形式。

    处理三种出现位置：.日期、{日期, 收盘}（对象简写）、select(.日期 ...)。
    已有引号包裹的（["日期"]）不改。裸 [ 开头（如 "[0].code"）补前导点。
    """
    # 裸 [ 开头：jq 流式输出需要明确的 . 前缀语义，统一规范化为 .
    if expression.startswith("[") and not expression.startswith(".["):
        expression = "." + expression

    # 先处理对象简写 {日期, 收盘}（无 . 前缀）
    text = re.sub(
        r"\{([\u4e00-\u9fff][\u4e00-\u9fff\w]*(?:\s*,\s*[\u4e00-\u9fff][\u4e00-\u9fff\w]*)*)\}",
        lambda m: "{" + ", ".join(f'"{p.strip()}"' for p in m.group(1).split(",")) + "}",
        expression,
    )
    # 再处理 .日期（避免改写已引号包裹的）
    text = re.sub(
        r"\.(?!\[)([\u4e00-\u9fff][\u4e00-\u9fff\w]*)",
        lambda m: f'.["{m.group(1)}"]',
        text,
    )
    return text


try:  # 进程内绑定
    import jq as _pyjq  # type: ignore
except ImportError:  # pragma: no cover
    _pyjq = None


def is_jq_filter(filter_expr: str) -> bool:
    """判断 filter 是否为 jq 表达式（以 . 或 [ 开头，排除纯关键词）。"""
    text = (filter_expr or "").strip()
    return text.startswith(".") or text.startswith("[")


def eval_jq(data: Any, expression: str) -> list[Any] | None:
    """对 data 求值 jq 表达式，返回结果列表；求值失败返回 None。

    data 通常是一个 rows 列表（list[dict]）。返回 None 表示 jq 层失败，
    调用方应回落到关键词匹配；返回 [] 表示表达式合法但筛不出数据（真无结果）。
    输出超过 JQ_OUTPUT_CHARS 时头尾保留。
    """
    expression = (expression or "").strip()
    if not expression:
        return None
    expression = _normalize_unicode_fields(expression)
    if _pyjq is not None:
        try:
            results = _pyjq.compile(expression).input(data).all()
        except Exception:
            return None
    else:  # pragma: no cover - 系统命令回落
        try:
            proc = subprocess.run(
                ["jq", "-c", expression],
                input=json.dumps(data, ensure_ascii=False, default=str),
                capture_output=True, text=True, timeout=10,
            )
            if proc.returncode != 0:
                return None
            results = [json.loads(line) for line in proc.stdout.splitlines() if line.strip()]
        except Exception:
            return None

    results = _clip(results if isinstance(results, list) else [results])
    # map/select 类表达式的输出形态是 [[...]]（单层包裹），展平为 [...]
    if len(results) == 1 and isinstance(results[0], list):
        return _clip(results[0])
    return results


def eval_jq_text(data: Any, expression: str) -> str | None:
    """eval_jq 的文本版：返回紧凑 JSON 文本；失败返回 None。"""
    results = eval_jq(data, expression)
    if results is None:
        return None
    text = json.dumps(results, ensure_ascii=False, default=str)
    if len(text) <= JQ_OUTPUT_CHARS:
        return text
    # 头尾保留（尾部最新）
    omitted = len(text) - JQ_OUTPUT_CHARS
    head = text[: JQ_OUTPUT_CHARS // 2]
    tail = text[-(JQ_OUTPUT_CHARS // 2):]
    return f"{head}……（jq 输出过长，省略 {omitted} 字符，尾部为最新）……{tail}"


def _clip(results: list[Any]) -> list[Any]:
    """行数上限：jq 输出超过 200 行时保留尾部（最新数据）。"""
    if len(results) > 200:
        return results[-200:]
    return results
