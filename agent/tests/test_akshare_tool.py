import math

import pandas as pd
import pytest

from app.akshare_tool import (
    AkshareToolError,
    CATALOG,
    _json_safe,
    call_akshare,
    format_result_for_prompt,
    list_akshare_functions,
    validate_call,
)


def test_catalog_entries_have_doc_verified_metadata() -> None:
    # 每个白名单接口必须在当前 akshare 版本真实存在，且必填参数都声明过说明。
    for fn in CATALOG.values():
        assert hasattr(__import__("akshare"), fn.name), fn.name
        assert fn.description
        for required in fn.required:
            assert required in fn.params, fn.name


def test_validate_call_rejects_unknown_interface() -> None:
    with pytest.raises(AkshareToolError, match="不在允许目录"):
        validate_call("stock_zh_a_tick_163", {})


def test_validate_call_rejects_unknown_params() -> None:
    with pytest.raises(AkshareToolError, match="不接受参数"):
        validate_call("spot_golden_benchmark_sge", {"symbol": "Au99.99"})


def test_validate_call_requires_required_params() -> None:
    with pytest.raises(AkshareToolError, match="缺少必填参数"):
        validate_call("spot_hist_sge", {})


def test_call_akshare_rejects_non_whitelisted_attribute(monkeypatch) -> None:
    # 即使有人往 akshare 模块上挂了危险函数，目录外一律拒绝。
    with pytest.raises(AkshareToolError):
        call_akshare("__builtins__", {})


def test_call_akshare_truncates_rows(monkeypatch) -> None:
    frame = pd.DataFrame({"价格": range(120)})

    def fake_func(**kwargs):
        return frame

    monkeypatch.setattr("akshare.spot_quotations_sge", fake_func)
    result = call_akshare("spot_quotations_sge", {})
    assert result["total_rows"] == 120
    assert result["truncated"] is True
    assert len(result["rows"]) == CATALOG["spot_quotations_sge"].default_limit


def test_call_akshare_empty_frame(monkeypatch) -> None:
    empty_frame = pd.DataFrame()

    def fake_func(**kwargs):
        return empty_frame

    import akshare

    monkeypatch.setattr(akshare, "spot_golden_benchmark_sge", fake_func)
    result = call_akshare("spot_golden_benchmark_sge", {})
    assert result["rows"] == []
    assert result["total_rows"] == 0


def test_json_safe_handles_nan_and_decimal() -> None:
    import decimal

    assert _json_safe(float("nan")) is None
    assert _json_safe(float("inf")) is None
    assert _json_safe(decimal.Decimal("1.5")) == 1.5
    assert _json_safe(pd.Timestamp("2024-01-02")) == "2024-01-02T00:00:00"
    assert _json_safe("nan") is None
    assert _json_safe(3) == 3


def test_call_akshare_wraps_source_errors(monkeypatch) -> None:
    def boom(**kwargs):
        raise TimeoutError("https://internal.example.com secret timed out")

    import akshare

    monkeypatch.setattr(akshare, "spot_hist_sge", boom)
    with pytest.raises(AkshareToolError, match="调用失败"):
        call_akshare("spot_hist_sge", {"symbol": "Au99.99"})


def test_list_akshare_functions_matches_openai_schema() -> None:
    tools = list_akshare_functions()
    names = {t["function"]["name"] for t in tools}
    assert "spot_hist_sge" in names and "stock_zh_a_hist" in names
    for tool in tools:
        assert tool["type"] == "function"
        params = tool["function"]["parameters"]
        assert params["type"] == "object"
        for required in tool["function"]["parameters"].get("required", []):
            assert required in params["properties"]


def test_format_result_for_prompt_compact() -> None:
    text = format_result_for_prompt(
        {
            "interface": "spot_hist_sge",
            "arguments": {"symbol": "Au99.99"},
            "rows": [{"date": "2024-01-02", "close": 480.5}],
            "total_rows": 1,
            "truncated": False,
        }
    )
    assert "spot_hist_sge" in text and "480.5" in text and math.isfinite(len(text))
