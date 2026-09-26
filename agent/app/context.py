"""会话上下文压缩：分段摘要 + 尾部原文。

纯函数模块，不做任何 IO，方便单测。消息计量单位是"条"：
每轮 /chat 固定产生 user + assistant 两条消息。
"""
from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Any

# 每段覆盖的消息条数（6 条 = 3 轮对话）。
SEGMENT_MESSAGE_COUNT = 6
# 注入 prompt 的摘要段数上限。
MAX_SUMMARY_SEGMENTS = 12
# 尾部原文最多条数。
RECENT_MESSAGE_LIMIT = 6
# 单条原文截断长度（字符）。
RECENT_MESSAGE_MAX_CHARS = 300
# 单段摘要长度上限（字符），超出硬截断。
SUMMARY_MAX_CHARS = 300


@dataclass(frozen=True)
class SegmentPlan:
    """一次 /chat 调用前的分段状态。"""

    # 已封段的消息总数。
    summarized_count: int
    # 会话消息总数（不含本轮将要落库的消息）。
    total_count: int
    # 本轮回答落库后是否凑满一个新段、需要生成摘要。
    should_summarize: bool
    # should_summarize 为 True 时，新段覆盖的消息区间 [start, end)。
    pending_start: int = 0
    pending_end: int = 0
    # 新段的段号。
    pending_index: int = 0


def plan_segmenting(total_count: int, summarized_count: int) -> SegmentPlan:
    """判断本轮回答落库后是否凑满新段。

    total_count 是取历史时的会话消息数；本轮还会追加 2 条
    （user + assistant），所以封段判断基于 total_count + 2。
    """
    after_reply = total_count + 2
    unsummarized = after_reply - summarized_count
    if unsummarized >= SEGMENT_MESSAGE_COUNT and unsummarized % SEGMENT_MESSAGE_COUNT == 0:
        return SegmentPlan(
            summarized_count=summarized_count,
            total_count=total_count,
            should_summarize=True,
            pending_start=after_reply - SEGMENT_MESSAGE_COUNT,
            pending_end=after_reply,
            pending_index=summarized_count // SEGMENT_MESSAGE_COUNT,
        )
    return SegmentPlan(
        summarized_count=summarized_count,
        total_count=total_count,
        should_summarize=False,
    )


def _truncate(text: str, limit: int) -> str:
    text = (text or "").strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "…"


def build_history_block(
    summaries: list[dict[str, Any]],
    recent_messages: list[dict[str, Any]],
) -> str:
    """组装注入 prompt 的历史上下文块。

    summaries: list_summaries 的行（segment_index, message_count, summary），
               按段号升序；调用方可先做封顶截断。
    recent_messages: 最近消息（role, content），按时间升序。
    """
    parts: list[str] = []

    if summaries:
        lines = []
        start = 1
        for item in summaries:
            count = int(item.get("message_count") or 0)
            end = start + count - 1
            lines.append(f"第{item['segment_index'] + 1}段(消息{start}-{end})：{_truncate(item.get('summary') or '', SUMMARY_MAX_CHARS)}")
            start = end + 1
        parts.append("[历史分段摘要]\n" + "\n".join(lines))

    if recent_messages:
        lines = [
            f"{item.get('role', 'user')}: {_truncate(item.get('content') or '', RECENT_MESSAGE_MAX_CHARS)}"
            for item in recent_messages
        ]
        parts.append("[最近消息]\n" + "\n".join(lines))

    return "\n\n".join(parts)


def summarize_instruction() -> str:
    """凑满段时附加给模型的输出格式要求。"""
    return (
        "另外，本轮对话恰好满一个分析段落，请把回复组织为 JSON（不要 Markdown）：\n"
        '{"reply": "给用户的回答", "segment_summary": "仅总结这批最近消息：出现的标的代码与名称、'
        "时间范围、用户关注的问题、已得出的结论和数字，300字内，直接陈述事实\"}\n"
    )


def plain_reply_instruction() -> str:
    """未凑满段的轮次：直接纯文本回答，不承担摘要职责。"""
    return "直接回答用户问题，不要输出 JSON 或任何格式说明。"


def parse_reply_payload(content: str) -> tuple[str, str]:
    """解析模型回复：凑段轮要求 {"reply", "segment_summary"} JSON。

    返回 (reply, segment_summary)。任何解析失败都退回把原文当 reply、
    摘要留空——主回答绝不因摘要机制失败而受影响。
    """
    text = (content or "").strip()
    if not text.startswith("{"):
        return text, ""
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return text, ""
    if not isinstance(payload, dict) or not isinstance(payload.get("reply"), str):
        return text, ""
    summary = payload.get("segment_summary")
    return payload["reply"], summary.strip() if isinstance(summary, str) else ""
