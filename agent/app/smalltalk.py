# -*- coding: utf-8 -*-
"""闲聊意图判断：由 LLM 分类，替代写死的关键词规则。

问候/身份/感谢/玩笑等闲聊消息无需查库，走直答快车道；业务问题走
SQL 管线。判断由一轮轻量 LLM 调用完成，带最近对话历史，能正确处理
"继续"、"接着说"这类依赖上下文的指代。

保守策略：LLM 回复解析失败、输出不合法时一律视为业务问题（宁可多查
一次库，不吞掉正经提问）。
"""
from __future__ import annotations

import json
from typing import Any

from .llm import LLMClient, build_stable_messages

# 注入判断的历史条数上限（最近 N 条原文，含 user/assistant）。
HISTORY_LIMIT = 6

_SMALLTALK_SYSTEM = (
    "你是聊天意图分类器。判断用户的最新消息是否属于「闲聊」："
    "问候语、询问你的身份/能力、感谢、告别、玩笑、情绪表达等不需要查询任何数据就能回答的消息。"
    "需要查数据的问题（行情、价格、日报、统计、对比等）不是闲聊；"
    "依赖历史对话才能理解的「继续」「接着说」不算闲聊，除非历史显示只是在寒暄。"
    "只输出一行 JSON，不要解释，不要 Markdown："
    '{"smalltalk": true 或 false, "type": "greeting/identity/thanks/farewell/joke/business"}'
)

_SMALLTALK_INSTRUCTION = "输出约定：只输出一行 JSON。"


def classify_message(llm: LLMClient, message: str, history: list[dict[str, Any]] | None = None) -> bool:
    """返回 True 表示消息是闲聊（走直答）；False 或判断失败表示业务问题。"""
    history_text = ""
    for item in (history or [])[-HISTORY_LIMIT:]:
        role = str(item.get("role") or "user")
        content = str(item.get("content") or "")[:200]
        history_text += f"{role}: {content}\n"

    dynamic = f"最新消息：{message}"
    if history_text:
        dynamic = f"[最近对话]\n{history_text}\n{dynamic}"

    try:
        result = llm.chat(
            build_stable_messages(_SMALLTALK_SYSTEM, _SMALLTALK_INSTRUCTION, dynamic),
            "",
            stage="tool",
        )
        text = result.content.strip()
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end <= start:
            return False
        payload = json.loads(text[start : end + 1])
    except Exception:
        # 分类失败保守降级为业务问题。
        return False
    return payload.get("smalltalk") is True
