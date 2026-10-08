import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app import main
from app.ai_daily_client import (
    AIDailyClient,
    _build_summary,
    _clean_html,
    _extract_date_from_slug,
    _is_useful_paragraph,
    _normalize_text,
)
from app.interrupt import InterruptEvent, Interrupted
from app.db import upsert_records


# ---- 中断控制 ----


def test_interrupt_event_request_and_reset() -> None:
    event = InterruptEvent()
    assert not event.requested
    event.request(reason="test stop", source="test")
    assert event.requested and event.reason == "test stop" and event.source == "test"
    # 重复请求保留第一次原因
    event.request(reason="second", source="test")
    assert event.reason == "test stop"
    event.reset()
    assert not event.requested


def test_checkpoint_raises_interrupted_with_location() -> None:
    event = InterruptEvent()
    event.request(reason="stop", source="test")
    with pytest.raises(Interrupted) as exc_info:
        event.checkpoint("precious_metals")
    assert exc_info.value.where == "precious_metals"
    assert "stop" in str(exc_info.value)


def test_sync_latest_interrupts_between_stages(monkeypatch) -> None:
    """第一个阶段完成后，后续阶段全部跳过且已落库数据保留。"""
    executed: list[str] = []

    monkeypatch.setattr(main, "build_engine", lambda: object())

    def fake_metals(engine, fetched_at):
        executed.append("metals")
        # 阶段执行途中请求中断：模拟用户在贵金属阶段结束时按下 Ctrl+C
        main.global_interrupt.request(reason="mid-sync", source="test")
        return {"inserted": 5, "failures": []}

    monkeypatch.setattr(main, "_sync_metals", fake_metals)
    monkeypatch.setattr(main, "_sync_tech", lambda e, f: executed.append("tech") or {"inserted": 0, "failures": []})
    monkeypatch.setattr(main, "_sync_ai_daily", lambda e: executed.append("ai") or {"inserted": 0, "failures": []})

    result = main.sync_once_result()

    assert executed == ["metals"]  # 后两个阶段被中断跳过
    assert result["interrupted"] is True
    assert result["preciousMetals"] == 5  # 已落库数据保留
    assert result["stages"] == ["precious_metals:ok", "tech_markets:interrupted", "ai_daily:interrupted"]


def test_sync_stop_api_requests_interrupt(monkeypatch) -> None:
    client = TestClient(main.app)
    response = client.post("/sync/stop")
    assert response.status_code == 200
    assert response.json()["requested"] is True
    assert main.global_interrupt.requested
    main.global_interrupt.reset()


def test_interrupted_cli_exit_code(monkeypatch) -> None:
    """CLI 模式下中断返回 130（128+SIGINT 惯例）。"""
    monkeypatch.setattr(main, "install_signal_handlers", lambda *a, **k: None)
    monkeypatch.setattr(main, "restore_signal_handlers", lambda: None)

    def raise_interrupted():
        raise Interrupted("precious_metals", "sig", "test")

    monkeypatch.setattr(main, "sync_once", raise_interrupted)
    with pytest.raises(SystemExit) as exc_info:
        main.main()
    assert exc_info.value.code == 130


# ---- AI 日报解析（对齐 Go 版行为）----


def test_clean_html_entities_and_tags() -> None:
    assert _clean_html("<p>hello&nbsp;&amp; world</p>") == "hello & world"


def test_extract_date_from_slug() -> None:
    assert _extract_date_from_slug("ai-daily/2026-09-30") == "2026-09-30"
    assert _extract_date_from_slug("no-date-here") == ""


def test_is_useful_paragraph_filters_noise() -> None:
    assert _is_useful_paragraph("OpenAI 发布了新的模型，性能显著提升，支持多模态输入输出。", "")
    assert not _is_useful_paragraph("导航", "")
    assert not _is_useful_paragraph("太短", "")
    assert not _is_useful_paragraph("重复标题内容", "重复标题内容")


def test_normalize_text_strips_prefix_and_tail() -> None:
    text = _normalize_text("摘要：OpenAI 发布新模型。访问网页版↗️")
    assert text.startswith("OpenAI") and "访问网页版" not in text


def test_build_summary_cuts_at_marker() -> None:
    summary = _build_summary("OpenAI 发布新模型。重点内容：详细列表", "")
    assert summary == "OpenAI 发布新模型。"


def test_fetch_index_parses_and_sorts(monkeypatch) -> None:
    html = """
    <a href="/docs/ai-daily/2026-10-01">AI 日报 10-01</a>
    <a href="/docs/ai-daily/2026-09-30">AI 日报 09-30</a>
    <a href="/other/page">无关页面</a>
    """
    client = AIDailyClient()
    monkeypatch.setattr(client, "_get", lambda url: html)
    entries = client.fetch_index(max_entries=5)
    assert [e["slug"] for e in entries] == ["docs/ai-daily/2026-10-01", "docs/ai-daily/2026-09-30"]
    assert entries[0]["title"] == "AI 日报 10-01"


def test_fetch_latest_interrupts_between_articles(monkeypatch) -> None:
    """第二篇文章抓取前收到中断 -> 第一篇已抓数据保留，无 failure 误报。"""
    html = '<a href="/docs/ai-daily/2026-10-01">A</a><a href="/docs/ai-daily/2026-09-30">B</a>'
    event = InterruptEvent()
    client = AIDailyClient(interrupt=event)

    calls = [0]

    def fake_fetch_daily(entry, fetched_at):
        calls[0] += 1
        if calls[0] == 2:
            event.request(reason="stop after first", source="test")
            # checkpoint 在 fetch_daily 的 _get 里触发
            client._checkpoint(f"article {entry['slug']}")
        from app.ai_daily_client import AIDailyPayload

        return AIDailyPayload(source="hex2077", title=entry["title"], slug=entry["slug"],
                              source_url=entry["url"], published_date="", summary="s", read_time="",
                              content="c", fetched_at=fetched_at.isoformat())

    monkeypatch.setattr(client, "_get", lambda url: html if "docs/" in url and "ai-daily" not in url else html)
    monkeypatch.setattr(client, "fetch_daily", fake_fetch_daily)

    records, failures = client.fetch_latest(5)
    assert calls[0] == 2
    assert len(records) == 1 and records[0]["slug"] == "docs/ai-daily/2026-10-01"
    assert failures == []


def test_to_record_json_fields() -> None:
    from app.ai_daily_client import AIDailyPayload

    payload = AIDailyPayload(source="hex2077", title="t", slug="s", source_url="u",
                             published_date="2026-10-01", summary="sum", read_time="5 min",
                             content="c", sections=[{"heading": "h", "items": ["i"]}],
                             links=[{"title": "l", "url": "u2"}], meta={"entrySlug": "s"},
                             fetched_at="2026-10-08T00:00:00")
    record = AIDailyClient.to_record(payload)
    assert json.loads(record["sections_json"])[0]["heading"] == "h"
    assert json.loads(record["links_json"])[0]["url"] == "u2"
    assert record["published_date"] == "2026-10-01"


# ---- upsert ----


def test_upsert_records_overwrites_on_conflict() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE ai_daily_snapshots ("
            "id INTEGER PRIMARY KEY, source TEXT NOT NULL, slug TEXT NOT NULL, "
            "title TEXT, fetched_at TEXT, UNIQUE(source, slug))"
        ))

    first = [{"source": "hex2077", "slug": "a", "title": "v1", "fetched_at": "t1"}]
    assert upsert_records(engine, "ai_daily_snapshots", first, ["title", "fetched_at"]) >= 1

    second = [{"source": "hex2077", "slug": "a", "title": "v2", "fetched_at": "t2"}]
    upsert_records(engine, "ai_daily_snapshots", second, ["title", "fetched_at"])

    with engine.connect() as conn:
        rows = conn.execute(text("SELECT title, fetched_at FROM ai_daily_snapshots WHERE slug='a'")).fetchall()
    assert len(rows) == 1 and rows[0][0] == "v2" and rows[0][1] == "t2"
