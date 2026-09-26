import pytest

from app.context import (
    RECENT_MESSAGE_MAX_CHARS,
    SEGMENT_MESSAGE_COUNT,
    build_history_block,
    parse_reply_payload,
    plan_segmenting,
)


class TestPlanSegmenting:
    def test_no_segment_before_first_full_window(self) -> None:
        # 消息数 0 和 5（+2 后是 2 和 7）都不足一个整段。
        assert plan_segmenting(0, 0).should_summarize is False
        assert plan_segmenting(5, 0).should_summarize is False

    def test_segment_closes_when_window_fills(self) -> None:
        # 4 条已有消息 + 本轮 2 条 = 6 → 封第 0 段，覆盖 [0, 6)。
        plan = plan_segmenting(4, 0)

        assert plan.should_summarize is True
        assert plan.pending_start == 0
        assert plan.pending_end == SEGMENT_MESSAGE_COUNT
        assert plan.pending_index == 0

    def test_second_segment_uses_offset(self) -> None:
        # 已封 6 条，10 + 2 = 12 → 封第 1 段，覆盖 [6, 12)。
        plan = plan_segmenting(10, 6)

        assert plan.should_summarize is True
        assert plan.pending_index == 1
        assert plan.pending_start == 6
        assert plan.pending_end == 12

    def test_no_segment_when_unsummarized_not_multiple(self) -> None:
        # 已封 6 条，11 + 2 = 13，未入段 7 条不是整段 → 不封。
        assert plan_segmenting(11, 6).should_summarize is False


class TestBuildHistoryBlock:
    def test_includes_summaries_and_recent(self) -> None:
        block = build_history_block(
            [{"segment_index": 0, "message_count": 6, "summary": "用户关注XAU"}],
            [{"role": "user", "content": "白银呢"}],
        )

        assert "[历史分段摘要]" in block
        assert "第1段(消息1-6)：用户关注XAU" in block
        assert "[最近消息]" in block
        assert "白银呢" in block

    def test_truncates_long_messages(self) -> None:
        block = build_history_block(
            [],
            [{"role": "assistant", "content": "x" * 5000}],
        )

        assert len(block) < 600
        assert "…" in block

    def test_empty_inputs_render_empty_block(self) -> None:
        assert build_history_block([], []) == ""


class TestParseReplyPayload:
    def test_parses_json_reply_and_summary(self) -> None:
        reply, summary = parse_reply_payload(
            '{"reply": "黄金上涨", "segment_summary": "用户连续询问贵金属"}'
        )

        assert reply == "黄金上涨"
        assert summary == "用户连续询问贵金属"

    def test_plain_text_falls_back(self) -> None:
        reply, summary = parse_reply_payload("这是普通文本回答")

        assert reply == "这是普通文本回答"
        assert summary == ""

    def test_broken_json_falls_back(self) -> None:
        raw = '{"reply": "截断的'
        reply, summary = parse_reply_payload(raw)

        assert reply == raw
        assert summary == ""

    def test_non_string_summary_is_ignored(self) -> None:
        reply, summary = parse_reply_payload('{"reply": "r", "segment_summary": 123}')

        assert reply == "r"
        assert summary == ""
