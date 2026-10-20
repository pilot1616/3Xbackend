"""jq 筛选层测试：求值、判断、降级链与各接入点。"""

import json

from app.jq_filter import eval_jq, eval_jq_text, is_jq_filter
from app.market_planner import _find_value, _resolve_placeholders, _view_step_data
from app.akshare_tool import call_akshare, ROW_FILTER_KEY


ROWS = [
    {"日期": "2026-09-01", "收盘": 40.1},
    {"日期": "2026-10-19", "收盘": 41.23},
    {"日期": "2026-10-20", "收盘": 41.5},
]


def test_is_jq_filter_discriminates() -> None:
    assert is_jq_filter(".[-3:]")
    assert is_jq_filter('. | map(select(.收盘 > 40))')
    assert not is_jq_filter("2026-10")
    assert not is_jq_filter("牧原股份")
    assert not is_jq_filter("")


def test_eval_jq_basic_operations() -> None:
    assert eval_jq(ROWS, ".[-1]") == [{"日期": "2026-10-20", "收盘": 41.5}]
    # map/select 的单层包裹输出会被 helper 展平
    assert eval_jq(ROWS, ". | map(select(.日期 >= \"2026-10-01\"))") == [
        {"日期": "2026-10-19", "收盘": 41.23},
        {"日期": "2026-10-20", "收盘": 41.5},
    ]
    # 投影
    proj = eval_jq(ROWS, ". | map({日期})")
    assert proj == [{"日期": "2026-09-01"}, {"日期": "2026-10-19"}, {"日期": "2026-10-20"}]


def test_eval_jq_invalid_returns_none() -> None:
    assert eval_jq(ROWS, ".这是一个不合法的表达式!!!") is None
    # 真无结果是合法空（包裹层已展平）
    assert eval_jq(ROWS, '. | map(select(.日期 == "1999-01-01"))') == []


def test_eval_jq_text_clips_long_output() -> None:
    big = [{"i": i, "pad": "x" * 50} for i in range(200)]
    text = eval_jq_text(big, ".")
    assert len(text) <= 2200
    assert "省略" in text


def test_view_step_data_supports_jq_filter() -> None:
    step = {"step": 1, "result": {"rows": ROWS, "columns": ["日期", "收盘"]}}
    out = _view_step_data(step, ".[-1]")
    assert "2026-10-20" in out and "41.5" in out
    assert "2026-09-01" not in out
    # 关键词回落仍可用
    out2 = _view_step_data(step, "2026-09-01")
    assert "40.1" in out2


def test_placeholder_supports_jq_path() -> None:
    step_results = [{"step": 1, "purpose": "查代码", "interface": "x",
                     "result": {"rows": [{"code": "002714", "name": "牧原股份"}], "columns": ["code", "name"]}}]
    # jq 路径
    resolved = _resolve_placeholders({"symbol": "$step1<[0].code>"}, step_results)
    assert resolved["symbol"] == "002714"
    # jq + select
    resolved2 = _resolve_placeholders(
        {"symbol": "$step1<map(select(.name == \"牧原股份\")) | .[0].code>"}, step_results)
    assert resolved2["symbol"] == "002714"
    # 旧格式不受影响（提示词匹配列名）
    resolved3 = _resolve_placeholders({"symbol": "$step1.code"}, step_results)
    assert resolved3["symbol"] == "002714"


def test_row_filter_supports_jq_expression(monkeypatch) -> None:
    """_row_filter 用 jq 表达式过滤 DataFrame 行。"""
    import pandas as pd
    import app.akshare_tool as at

    df = pd.DataFrame([
        {"代码": "002714", "名称": "牧原股份", "最新价": 41.23},
        {"代码": "600519", "名称": "贵州茅台", "最新价": 1500.0},
    ])
    monkeypatch.setattr(at.ak, "stock_zh_a_spot_em", lambda **k: df)

    result = at.call_akshare("stock_zh_a_spot_em", {ROW_FILTER_KEY: '. | map(select(.名称 == "牧原股份"))'})
    assert len(result["rows"]) == 1
    assert result["rows"][0]["代码"] == "002714"
    # 关键词回落
    result2 = at.call_akshare("stock_zh_a_spot_em", {ROW_FILTER_KEY: "牧原"})
    assert len(result2["rows"]) == 1
