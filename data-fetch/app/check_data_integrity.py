# -*- coding: utf-8 -*-
"""数据完整性检查与补数脚本。

对三张核心表按 [起始日期, 今天] 逐日核对：
- ai_daily_snapshots：按 published_date 逐日应有 1 篇日报（工作日）；
- precious_metal_snapshots / tech_market_snapshots：每个配置标的按
  fetched_at（交易日）逐日应有 1 行。

交易日不从日历推导：以「库内该标的已出现的全部日期 ∪ akshare 远程返回的日期」
为基准判断缺口，避免把节假日当成缺失。补数复用 akshare_client / ai_daily_client
的现成抓取与 upsert/幂等插入逻辑，唯一键冲突自动跳过，可安全重复执行。

用法（在 data-fetch 目录下）：
    python -m app.check_data_integrity                      # 默认从 30 天前查起
    python -m app.check_data_integrity --start 2026-08-01   # 指定起始日期
    python -m app.check_data_integrity --start 2026-08-01 --no-repair   # 只报告不修复
"""
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any

import pandas as pd
from sqlalchemy import text
from sqlalchemy.engine import Engine

from .akshare_client import (
    PRECIOUS_METALS,
    TECH_MARKETS,
    _history_change,
    _history_records,
    _normalize_columns,
    _overview,
    _row_date,
    _row_value,
)
from .ai_daily_client import AIDailyClient, DEFAULT_MAX_ENTRIES
from .config import settings
from .db import build_engine, insert_records_if_absent, upsert_records

AI_DAILY_UPDATE_COLUMNS = (
    "title", "source_url", "published_date", "summary", "read_time",
    "content", "sections_json", "links_json", "meta_json", "fetched_at",
)


@dataclass
class TableReport:
    table: str
    checked_days: int = 0
    missing: list[str] = field(default_factory=list)
    repaired: int = 0
    failures: list[str] = field(default_factory=list)

    def summary(self) -> str:
        status = "OK" if not self.missing else f"{len(self.missing)} missing"
        repaired = f", repaired {self.repaired}" if self.repaired else ""
        failures = f", failures {len(self.failures)}" if self.failures else ""
        return f"[{self.table}] checked {self.checked_days} days: {status}{repaired}{failures}"


def _parse_start(raw: str | None) -> date:
    if not raw:
        return date.today() - timedelta(days=30)
    try:
        return datetime.strptime(raw.strip(), "%Y-%m-%d").date()
    except ValueError as exc:
        raise SystemExit(f"invalid --start date (expect YYYY-MM-DD): {raw}") from exc


def _day(d: datetime) -> str:
    return d.strftime("%Y-%m-%d")


# ---- AI 日报 ----


def _ai_dates_in_range(engine: Engine, start: date, end: date) -> set[str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT published_date FROM ai_daily_snapshots "
                "WHERE published_date >= :start AND published_date <= :end"
            ),
            {"start": _day(datetime.combine(start, datetime.min.time())), "end": _day(datetime.combine(end, datetime.min.time()))},
        ).fetchall()
    return {str(row[0])[:10] for row in rows}


def check_ai_daily(engine: Engine, start: date, end: date, repair: bool) -> TableReport:
    report = TableReport("ai_daily_snapshots")
    # 日报只在工作日发布：以库内已出现过的日期作为"哪些日子有报"的先验，
    # 缺口 = [start, end] 内既非周末、又没有任何一天存在记录的连续区间两端。
    have = _ai_dates_in_range(engine, start, end)
    weekdays = [
        start + timedelta(days=i)
        for i in range((end - start).days + 1)
        if (start + timedelta(days=i)).weekday() < 5
    ]
    report.checked_days = len(weekdays)

    if have:
        # 库内数据的最早/最晚有报日期之间不该有空洞；区间外（早于最早/晚于最晚）不判缺，
        # 因为源站是否发布无法预知。
        first_have, last_have = min(have), max(have)
        holes = [
            _day(d)
            for d in weekdays
            if _day(d) not in have and first_have <= _day(d) <= last_have
        ]
        report.missing = holes
    else:
        report.missing = []

    if repair and report.missing:
        repaired_days = _repair_ai_daily(engine, set(report.missing), report)
        report.repaired = repaired_days
    return report


def _repair_ai_daily(engine: Engine, want_days: set[str], report: TableReport) -> int:
    """按天补抓缺失日报：拉索引，过滤出 published_date 命中缺失日的条目逐篇抓取。

    缺失日可能不在最新 N 篇里（比如中断漏抓了一周），因此直接拉全量索引：
    源站本身只保留有限历史（约 270 篇），全量拉一次的成本可接受。
    """
    client = AIDailyClient()
    try:
        entries = client.fetch_index(0)
    except Exception as exc:
        report.failures.append(f"index fetch failed: {exc}")
        return 0
    from .ai_daily_client import _extract_date_from_slug

    repaired = 0
    fetched_at = datetime.now()
    for entry in entries:
        day = _extract_date_from_slug(entry["slug"])
        if day not in want_days:
            continue
        try:
            payload = client.fetch_daily(entry, fetched_at)
        except Exception as exc:
            report.failures.append(f"{entry['slug']}: fetch failed: {exc}")
            continue
        upsert_records(engine, "ai_daily_snapshots", [client.to_record(payload)], AI_DAILY_UPDATE_COLUMNS)
        repaired += 1
    return repaired


# ---- 行情（贵金属 / 科技市场共用同一套逻辑）----


def _market_dates_by_symbol(engine: Engine, table: str, symbol: str, start: datetime, end: datetime) -> set[str]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                f"SELECT DISTINCT DATE(fetched_at) FROM `{table}` "
                "WHERE symbol = :symbol AND fetched_at >= :start AND fetched_at <= :end"
            ),
            {"symbol": symbol, "start": start, "end": end},
        ).fetchall()
    return {str(row[0]) for row in rows}


def _market_latest_row(engine: Engine, table: str, symbol: str) -> dict[str, Any] | None:
    with engine.connect() as conn:
        row = conn.execute(
            text(
                f"SELECT * FROM `{table}` WHERE symbol = :symbol ORDER BY fetched_at DESC LIMIT 1"
            ),
            {"symbol": symbol},
        ).mappings().first()
    return dict(row) if row else None


def _metal_record(target, row: pd.Series, previous: pd.Series | None, fetched_at: datetime) -> dict[str, Any]:
    overview = _overview(row)
    return {
        "source": "akshare",
        "symbol": target.symbol,
        "name": target.name,
        "source_url": "akshare:futures_foreign_hist",
        "price": _row_value(row, "close"),
        "change": _history_change(row, previous)[0],
        "change_percent": _history_change(row, previous)[1],
        "prev_close": _row_value(previous, "close") if previous is not None else "",
        "open": _row_value(row, "open"),
        "high": _row_value(row, "high"),
        "low": _row_value(row, "low"),
        "bid": "",
        "ask": "",
        "day_range": " - ".join(value for value in [_row_value(row, "low"), _row_value(row, "high")] if value),
        "week52_range": "",
        "volume": _row_value(row, "volume"),
        "avg_volume": "",
        "last_update_text": _row_value(row, "date"),
        "contract_month": "",
        "settlement_date": "",
        "tick_size": "",
        "contract_size": "",
        "tick_value": "",
        "base_unit": "",
        "overview_json": json_dumps(overview),
        "fetched_at": fetched_at,
    }


def _tech_record(target, row: pd.Series, previous: pd.Series | None, fetched_at: datetime, source_url: str) -> dict[str, Any]:
    overview = _overview(row)
    change, change_percent = _history_change(row, previous)
    return {
        "source": "akshare",
        "category": target.category,
        "symbol": target.symbol,
        "name": target.name,
        "source_url": source_url,
        "price": _row_value(row, "close", "收盘"),
        "change": change,
        "change_percent": change_percent,
        "prev_close": _row_value(previous, "close") if previous is not None else "",
        "open": _row_value(row, "open"),
        "high": _row_value(row, "high"),
        "low": _row_value(row, "low"),
        "bid": "",
        "ask": "",
        "day_range": " - ".join(value for value in [_row_value(row, "low"), _row_value(row, "high")] if value),
        "week52_range": "",
        "volume": _row_value(row, "volume"),
        "avg_volume": "",
        "market_cap": "",
        "pe_ratio": "",
        "beta": "",
        "eps": "",
        "dividend": "",
        "yield": "",
        "last_update_text": _row_value(row, "date"),
        "overview_json": json_dumps(overview),
        "fetched_at": fetched_at,
    }


def json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def check_market_table(
    engine: Engine,
    table: str,
    targets: list,
    start: date,
    end: date,
    repair: bool,
    report: TableReport,
) -> None:
    """逐标的核对 [start, end] 内每个交易日的数据是否存在。

    交易日基准取「该标的库内已出现过的全部日期」：行情表的历史数据本身就是
    按数据源的交易日粒度落的，用库内日期集合做基准比从日历推导（无法感知
    节假日休市）可靠。缺口 = 基准日内落在 [start, end] 但库内该区间没有行的日期。
    """
    start_dt = datetime.combine(start, datetime.min.time())
    end_dt = datetime.combine(end + timedelta(days=1), datetime.min.time())

    for target in targets:
        latest = _market_latest_row(engine, table, target.symbol)
        if latest is None:
            report.failures.append(f"{target.symbol}: no rows in table at all; run history sync first")
            continue

        # 交易日基准：该标的库内全历史日期 ∩ [start, end] 之外的推导不可靠，
        # 因此只核对「库内曾经有数据的日期」在检查区间内是否缺失。
        all_days = _market_dates_by_symbol(engine, table, target.symbol, datetime(1970, 1, 1), end_dt)
        expected = sorted(d for d in all_days if start <= datetime.strptime(d, "%Y-%m-%d").date() <= end)
        have_in_range = _market_dates_by_symbol(engine, table, target.symbol, start_dt, end_dt)
        missing_days = [d for d in expected if d not in have_in_range]
        report.checked_days += len(expected)
        report.missing.extend(f"{target.symbol}: {d}" for d in missing_days)

        if repair and missing_days:
            inserted = _repair_market_symbol(engine, table, target, missing_days, report)
            report.repaired += inserted


def _repair_market_symbol(engine: Engine, table: str, target, expected: list[str], report: TableReport) -> int:
    """拉全量历史，按缺失日期过滤后补插（唯一键 symbol+fetched_at 幂等）。"""
    import akshare as ak

    try:
        if table == "precious_metal_snapshots":
            df = ak.futures_foreign_hist(symbol=target.source_symbol)
            source_url = "akshare:futures_foreign_hist"
        else:
            if target.symbol == "NDX":
                df = ak.index_us_stock_sina(symbol=target.source_symbol)
                source_url = "akshare:index_us_stock_sina"
            else:
                df = ak.stock_us_daily(symbol=target.source_symbol)
                source_url = "akshare:stock_us_daily"
    except Exception as exc:
        report.failures.append(f"{target.symbol}: history fetch failed: {exc}")
        return 0

    df = _normalize_columns(df)
    if df.empty or "date" not in df.columns:
        report.failures.append(f"{target.symbol}: empty history from source")
        return 0

    df = df.sort_values("date")
    dates = pd.to_datetime(df["date"], errors="coerce")
    df = df[dates.notna()]
    dates = pd.to_datetime(df["date"], errors="coerce")

    want = set(expected)
    if not want:
        return 0

    records: list[dict[str, Any]] = []
    previous: pd.Series | None = None
    for _, row in df.iterrows():
        row_date = _row_date(row, datetime.now())
        if _day(row_date) in want:
            if table == "precious_metal_snapshots":
                records.append(_metal_record(target, row, previous, row_date))
            else:
                records.append(_tech_record(target, row, previous, row_date, source_url))
        previous = row

    if not records:
        return 0

    if table == "precious_metal_snapshots":
        inserted = insert_records_if_absent(engine, table, records, ["source", "symbol", "fetched_at"])
    else:
        inserted = insert_records_if_absent(engine, table, records, ["source", "symbol", "fetched_at"])
    return inserted


def run(start_raw: str | None, repair: bool) -> int:
    start = _parse_start(start_raw)
    end = date.today()
    engine = build_engine()

    print(f"data integrity check: {start} .. {end} (repair={'on' if repair else 'off'})")
    reports: list[TableReport] = []

    reports.append(check_ai_daily(engine, start, end, repair))

    for table, targets in (
        ("precious_metal_snapshots", list(PRECIOUS_METALS)),
        ("tech_market_snapshots", list(TECH_MARKETS)),
    ):
        market_report = TableReport(table)
        check_market_table(engine, table, targets, start, end, repair, market_report)
        reports.append(market_report)

    exit_code = 0
    for report in reports:
        print(report.summary())
        if repair and report.missing:
            still_missing = [item for item in report.missing if _item_still_missing(engine, report, item)]
            if report.repaired:
                print(f"  repaired {report.repaired} rows")
            if still_missing:
                # 补数后仍缺：基本是源站本身没有该日数据（如停刊日），
                # 属正常现象，只提示不计入退出码。
                print(f"  not on source after repair (source has no data for these days): {len(still_missing)}")
                for miss in still_missing[:20]:
                    print(f"  not-available: {miss}")
                if len(still_missing) > 20:
                    print(f"  ... and {len(still_missing) - 20} more")
        elif report.missing:
            for miss in report.missing[:20]:
                print(f"  missing: {miss}")
            if len(report.missing) > 20:
                print(f"  ... and {len(report.missing) - 20} more")
            exit_code = 1
        for failure in report.failures:
            print(f"  failure: {failure}")
    return exit_code


def _item_still_missing(engine: Engine, report: TableReport, item: str) -> bool:
    """repair 后复核一条缺口是否仍然存在；item 形如 'XAU: 2026-09-10' 或 '2026-09-10'。"""
    symbol, _, day = item.partition(": ")
    day = (day or item).strip()[:10]
    try:
        if symbol and symbol != item:
            for table in ("precious_metal_snapshots", "tech_market_snapshots"):
                with engine.connect() as conn:
                    row = conn.execute(
                        text(
                            f"SELECT 1 FROM `{table}` WHERE symbol = :symbol "
                            "AND DATE(fetched_at) = :day LIMIT 1"
                        ),
                        {"symbol": symbol, "day": day},
                    ).first()
                    if row:
                        return False
            return True
        with engine.connect() as conn:
            row = conn.execute(
                text("SELECT 1 FROM ai_daily_snapshots WHERE published_date = :day LIMIT 1"),
                {"day": day},
            ).first()
        return row is None
    except Exception:
        return True


def main() -> None:
    parser = argparse.ArgumentParser(description="Check and repair market/ai-daily data integrity")
    parser.add_argument("--start", default=None, help="检查起始日期 YYYY-MM-DD（默认 30 天前）")
    parser.add_argument("--no-repair", action="store_true", help="只检查报告缺口，不执行补数")
    args = parser.parse_args()
    raise SystemExit(run(args.start, repair=not args.no_repair))


if __name__ == "__main__":
    main()
