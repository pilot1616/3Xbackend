from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
import json
from typing import Any

import akshare as ak
import pandas as pd


@dataclass(frozen=True)
class MarketTarget:
    symbol: str
    name: str
    source_symbol: str
    category: str = ""


PRECIOUS_METALS = [
    MarketTarget(symbol="XAU", name="Gold", source_symbol="GC"),
    MarketTarget(symbol="XAG", name="Silver", source_symbol="SI"),
    MarketTarget(symbol="XPT", name="Platinum", source_symbol="XPT"),
    MarketTarget(symbol="XPD", name="Palladium", source_symbol="XPD"),
]

TECH_MARKETS = [
    MarketTarget(symbol="NDX", name="Nasdaq 100", source_symbol=".NDX", category="index"),
    MarketTarget(symbol="QQQ", name="Invesco QQQ Trust", source_symbol="QQQ", category="etf"),
    MarketTarget(symbol="XLK", name="Technology Select Sector SPDR Fund", source_symbol="XLK", category="etf"),
    MarketTarget(symbol="SMH", name="VanEck Semiconductor ETF", source_symbol="SMH", category="etf"),
    MarketTarget(symbol="IGV", name="iShares Expanded Tech-Software Sector ETF", source_symbol="IGV", category="etf"),
]


def _normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.columns = [str(col).strip() for col in df.columns]
    return df


def _row_value(row: pd.Series, *candidates: str) -> str:
    for key in candidates:
        if key in row and pd.notna(row[key]):
            value = str(row[key]).strip()
            if value and value.lower() != "nan":
                return value
    return ""


def _find_row(df: pd.DataFrame, target: MarketTarget) -> pd.Series | None:
    if df.empty:
        return None
    symbol_columns = ["代码", "symbol", "Symbol", "合约", "名称", "name", "Name", "中文名称"]
    for col in symbol_columns:
        if col not in df.columns:
            continue
        matched = df[df[col].astype(str).str.upper().str.contains(target.source_symbol.upper(), regex=False, na=False)]
        if not matched.empty:
            return matched.iloc[0]
    return None


def _overview(row: pd.Series) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in row.to_dict().items():
        if pd.notna(value):
            result[str(key)] = str(value)
    return result


def fetch_precious_metals(fetched_at: datetime) -> tuple[list[dict[str, Any]], list[str]]:
    failures: list[str] = []
    records: list[dict[str, Any]] = []
    for target in PRECIOUS_METALS:
        try:
            futures_df = _normalize_columns(ak.futures_foreign_commodity_realtime(symbol=target.source_symbol))
        except Exception as exc:
            failures.append(f"{target.symbol}: realtime failed: {exc}")
            continue
        row = futures_df.iloc[0] if not futures_df.empty else None
        if row is None:
            failures.append(f"{target.symbol}: row not found for {target.source_symbol}")
            continue
        overview = _overview(row)
        price = _row_value(row, "最新价", "最新", "price", "last", "现价")
        if not price:
            failures.append(f"{target.symbol}: price not found")
            continue
        records.append(
            {
                "source": "akshare",
                "symbol": target.symbol,
                "name": target.name,
                "source_url": "akshare:futures_foreign_commodity_realtime",
                "price": price,
                "change": _row_value(row, "涨跌", "change"),
                "change_percent": _row_value(row, "涨跌幅", "涨跌幅%", "change_percent"),
                "prev_close": _row_value(row, "昨日结算价", "昨收", "前收盘", "Prev Close"),
                "open": _row_value(row, "开盘价", "开盘", "今开", "Open"),
                "bid": _row_value(row, "买价", "Bid"),
                "ask": _row_value(row, "卖价", "Ask"),
                "day_range": " - ".join(value for value in [_row_value(row, "最低价"), _row_value(row, "最高价")] if value),
                "week52_range": "",
                "volume": _row_value(row, "成交量", "volume"),
                "avg_volume": "",
                "last_update_text": _row_value(row, "更新时间", "time", "时间"),
                "contract_month": _row_value(row, "合约月份", "月份"),
                "settlement_date": "",
                "tick_size": "",
                "contract_size": "",
                "tick_value": "",
                "base_unit": "",
                "overview_json": json.dumps(overview, ensure_ascii=False),
                "fetched_at": fetched_at,
            }
        )
    return records, failures


def _fetch_us_spot() -> pd.DataFrame:
    for fn_name in ("stock_us_spot_em", "stock_us_spot"):
        fn = getattr(ak, fn_name, None)
        if fn is None:
            continue
        try:
            df = fn()
        except Exception:
            continue
        if not df.empty:
            return _normalize_columns(df)
    return pd.DataFrame()


def _latest_history_row(df: pd.DataFrame) -> tuple[pd.Series | None, pd.Series | None]:
    if df.empty:
        return None, None
    normalized = _normalize_columns(df)
    if "date" in normalized.columns:
        normalized = normalized.sort_values("date")
    latest = normalized.iloc[-1]
    previous = normalized.iloc[-2] if len(normalized.index) >= 2 else None
    return latest, previous


def _history_change(latest: pd.Series, previous: pd.Series | None) -> tuple[str, str]:
    if previous is None:
        return "", ""
    try:
        latest_close = float(latest["close"])
        previous_close = float(previous["close"])
    except Exception:
        return "", ""
    change = latest_close - previous_close
    percent = (change / previous_close * 100) if previous_close else 0
    return f"{change:.4f}", f"{percent:.4f}"


def _tech_history(target: MarketTarget) -> tuple[pd.Series | None, pd.Series | None, str]:
    if target.symbol == "NDX":
        df = ak.index_us_stock_sina(symbol=target.source_symbol)
        return (*_latest_history_row(df), "akshare:index_us_stock_sina")
    df = ak.stock_us_daily(symbol=target.source_symbol)
    return (*_latest_history_row(df), "akshare:stock_us_daily")


def fetch_tech_markets(fetched_at: datetime) -> tuple[list[dict[str, Any]], list[str]]:
    failures: list[str] = []
    records: list[dict[str, Any]] = []

    for target in TECH_MARKETS:
        try:
            row, previous, source_url = _tech_history(target)
        except Exception as exc:
            failures.append(f"{target.symbol}: history failed: {exc}")
            continue
        if row is None:
            failures.append(f"{target.symbol}: history row not found for {target.source_symbol}")
            continue
        overview = _overview(row)
        change, change_percent = _history_change(row, previous)
        price = _row_value(row, "close", "最新价", "最新", "现价", "price", "last", "收盘")
        if not price:
            failures.append(f"{target.symbol}: price not found")
            continue
        records.append(
            {
                "source": "akshare",
                "category": target.category,
                "symbol": target.symbol,
                "name": target.name,
                "source_url": source_url,
                "price": price,
                "change": change,
                "change_percent": change_percent,
                "prev_close": _row_value(previous, "close") if previous is not None else "",
                "open": _row_value(row, "open", "开盘", "今开"),
                "bid": "",
                "ask": "",
                "day_range": " - ".join(value for value in [_row_value(row, "low"), _row_value(row, "high")] if value),
                "week52_range": "",
                "volume": _row_value(row, "volume", "成交量"),
                "avg_volume": "",
                "market_cap": _row_value(row, "总市值", "市值", "market_cap"),
                "pe_ratio": _row_value(row, "市盈率", "PE", "pe"),
                "beta": "",
                "eps": "",
                "dividend": "",
                "yield": "",
                "last_update_text": _row_value(row, "date", "更新时间", "time", "时间"),
                "overview_json": json.dumps(overview, ensure_ascii=False),
                "fetched_at": fetched_at,
            }
        )
    return records, failures
