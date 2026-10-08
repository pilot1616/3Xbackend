"""AKShare 行情数据工具：白名单接口目录 + 受控执行。

设计对齐 db.py 的白名单哲学：LLM 只能调用 CATALOG 里登记的接口，
参数由目录声明校验，执行带超时和行数上限，输出统一成 JSON 安全结构
（NaN/Inf 归 null、Decimal/日期转字符串），防止脏数据打爆下游或注入 prompt。
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Callable

import akshare as ak


# 单次调用最多返回给 LLM 的行数；行情分析 50 行足够，行数是 prompt 体积大头。
MAX_ROWS = 50
# akshare 底层是爬虫式 HTTP 调用，必须限时，防止数据源挂起拖垮 worker。
CALL_TIMEOUT_SECONDS = 30.0


@dataclass(frozen=True)
class AkshareFunction:
    """一个允许调用的 akshare 接口的元数据。"""

    name: str
    description: str
    params: dict[str, str]  # 参数名 -> 说明（含取值约定，例如 symbol="Au99.99"）
    required: tuple[str, ...] = ()
    # 接口默认就返回全市场快照，不需要参数；这类结果行数很大，必须截断。
    default_limit: int = MAX_ROWS


# 全部条目的描述与参数说明均核对自本地镜像文档（akshare_docs 1.18.97）。
# 只登记业务可能用到的行情/宏观接口；需要扩目录时在这里加一条并跑测试核实。
CATALOG: dict[str, AkshareFunction] = {
    fn.name: fn
    for fn in (
        # ---- 贵金属（核心业务） ----
        AkshareFunction(
            name="spot_hist_sge",
            description="上海黄金交易所-行情走势-历史数据（日频）",
            params={"symbol": '品种代码，如 "Au99.99"；全品种列表用 spot_symbol_table_sge 获取'},
            required=("symbol",),
        ),
        AkshareFunction(
            name="spot_quotations_sge",
            description="上海黄金交易所-行情走势-实时数据",
            params={},
        ),
        AkshareFunction(
            name="spot_golden_benchmark_sge",
            description="上海黄金交易所-上海金基准价-历史数据",
            params={},
        ),
        AkshareFunction(
            name="spot_silver_benchmark_sge",
            description="上海黄金交易所-上海银基准价-历史数据",
            params={},
        ),
        AkshareFunction(
            name="spot_symbol_table_sge",
            description="上海黄金交易所-全部交易品种列表（用于查品种代码）",
            params={},
        ),
        # ---- A 股 ----
        AkshareFunction(
            name="stock_zh_a_hist",
            description="东方财富-沪深京 A 股日/周/月历史行情（当日收盘价需收盘后获取）",
            params={
                "symbol": '股票代码，不带市场标识，如 "000001"',
                "period": '周期：daily / weekly / monthly，默认 daily',
                "start_date": '开始日期，格式 "20200101"',
                "end_date": '结束日期，格式 "20240528"',
                "adjust": '复权：""（默认不复权）/ "qfq" 前复权 / "hfq" 后复权',
            },
            required=("symbol",),
        ),
        AkshareFunction(
            name="stock_zh_a_spot_em",
            description="东方财富-沪深京 A 股实时行情快照（全市场，结果按行数截断）",
            params={},
            default_limit=30,
        ),
        AkshareFunction(
            name="stock_individual_info_em",
            description="东方财富-个股基本信息（行业、总股本、市值等）",
            params={"symbol": '股票代码，带交易所前缀，如 "600019"'},
            required=("symbol",),
        ),
        AkshareFunction(
            name="stock_zh_a_hist_min_em",
            description="东方财富-沪深京 A 股分时行情（只能取近期数据）",
            params={
                "symbol": '股票代码，如 "000001"',
                "period": '周期：1/5/15/30/60 分钟，默认 1',
                "adjust": '复权："" / "qfq" / "hfq"',
            },
            required=("symbol",),
        ),
        # ---- 指数 ----
        AkshareFunction(
            name="index_zh_a_hist",
            description="东方财富-中国股票指数历史行情（日/周/月）",
            params={
                "symbol": '指数代码，不带市场标识，如 "399282"',
                "period": '周期：daily / weekly / monthly',
                "start_date": '开始日期 "20200101"',
                "end_date": '结束日期 "20240528"',
            },
            required=("symbol",),
        ),
        AkshareFunction(
            name="stock_zh_index_daily_em",
            description="东方财富-股票指数日频率历史数据",
            params={"symbol": '指数代码，如 "sh000001"'},
            required=("symbol",),
        ),
        # ---- 美股 / 港股 ----
        AkshareFunction(
            name="stock_us_hist",
            description="东方财富-美股每日行情（日/周/月）",
            params={
                "symbol": '美股代码，如 "AAPL"；代码列表用 stock_us_spot_em 获取',
                "period": '周期：daily / weekly / monthly',
                "start_date": '开始日期 "20200101"',
                "end_date": '结束日期 "20240528"',
                "adjust": '复权："" / "qfq" / "hfq"',
            },
            required=("symbol",),
        ),
        AkshareFunction(
            name="stock_us_daily",
            description="新浪-美股历史行情，adjust=\"qfq\" 返回前复权",
            params={
                "symbol": '美股代码，如 "AAPL"',
                "adjust": '"" 未复权 / "qfq" 前复权',
            },
            required=("symbol",),
        ),
        AkshareFunction(
            name="stock_us_spot_em",
            description="东方财富-美股实时行情快照（全市场，结果按行数截断）",
            params={},
            default_limit=30,
        ),
        AkshareFunction(
            name="stock_hk_spot_em",
            description="东方财富-港股实时行情快照（15 分钟延时，结果按行数截断）",
            params={},
            default_limit=30,
        ),
        # ---- 期货 / 现货 ----
        AkshareFunction(
            name="futures_main_sina",
            description="新浪-期货主力连续合约历史数据",
            params={
                "symbol": '连续合约代码，如 "IF0"；列表用 futures_display_main_sina 获取',
                "start_date": '开始日期 "19900101"',
                "end_date": '结束日期 "20240528"',
            },
            required=("symbol",),
        ),
        AkshareFunction(
            name="spot_price_qh",
            description="99 期货-期现-现货走势（部分品种有期货收盘价与现货价）",
            params={"symbol": '品种名，如 "螺纹钢"；可用品种用 spot_price_table_qh 获取'},
            required=("symbol",),
        ),
        # ---- ETF / 宏观 ----
        AkshareFunction(
            name="fund_etf_hist_em",
            description="东方财富-ETF 历史行情（日频）",
            params={
                "symbol": 'ETF 代码，如 "510300"',
                "period": '周期：daily / weekly / monthly',
                "start_date": '开始日期 "20200101"',
                "end_date": '结束日期 "20240528"',
                "adjust": '复权："" / "qfq" / "hfq"',
            },
            required=("symbol",),
        ),
        AkshareFunction(
            name="macro_china_cpi",
            description="中国 CPI 居民消费价格指数（月度，200801 至今）",
            params={},
        ),
        AkshareFunction(
            name="macro_china_lpr",
            description="中国 LPR 贷款市场报价利率（19910421 至今）",
            params={},
        ),
    )
}


class AkshareToolError(Exception):
    """调用参数或执行失败，错误信息可以安全返回给调用方。"""


def _json_safe(value: Any) -> Any:
    """把 DataFrame 单元格值转成 JSON 安全类型。"""
    if value is None or value is getattr(math, "nan", None):
        return None
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return value
    if isinstance(value, (bool, int, str)):
        # pandas 脏数据常以字符串 "nan" 出现，与缺失值同等对待。
        return None if isinstance(value, str) and value.strip().lower() in ("nan", "none", "<na>") else value
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    # pandas Timestamp / pd.NA 等走 str 兜底
    text = str(value)
    return None if text in ("nan", "NaT", "None", "<NA>") else text


def validate_call(name: str, arguments: dict[str, Any]) -> AkshareFunction:
    """校验接口名与参数，返回元数据；任何不合法都抛 AkshareToolError。"""
    fn = CATALOG.get(name)
    if fn is None:
        raise AkshareToolError(f"接口 {name} 不在允许目录中；可调用 list_akshare_functions 查看")
    unknown = set(arguments) - set(fn.params)
    if unknown:
        raise AkshareToolError(f"接口 {name} 不接受参数: {sorted(unknown)}；可用参数: {sorted(fn.params)}")
    missing = [p for p in fn.required if arguments.get(p) in (None, "")]
    if missing:
        raise AkshareToolError(f"接口 {name} 缺少必填参数: {missing}")
    return fn


def call_akshare(name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
    """执行一个白名单内的 akshare 接口，返回 JSON 安全的 {columns, rows, total_rows}。

    行数超过 fn.default_limit 时尾部截断，total_rows 保留真实行数供分析时说明。
    """
    arguments = {k: v for k, v in (arguments or {}).items() if v not in (None, "")}
    fn = validate_call(name, arguments)

    func: Callable[..., Any] = getattr(ak, name, None)
    if func is None:
        raise AkshareToolError(f"当前 akshare 版本没有接口 {name}")

    try:
        frame = func(**arguments)
    except Exception as exc:
        # 数据源错误原文可能带内部 URL 细节，压缩成单行再返回。
        raise AkshareToolError(f"接口 {name} 调用失败: {str(exc)[:200]}") from exc

    if frame is None or len(frame) == 0:
        return {"interface": name, "arguments": arguments, "columns": [], "rows": [], "total_rows": 0}

    limit = fn.default_limit
    columns = [str(c) for c in frame.columns]
    rows = [
        {col: _json_safe(row[col]) for col in columns}
        for row in frame.head(limit).to_dict(orient="records")
    ]
    return {
        "interface": name,
        "arguments": arguments,
        "columns": columns,
        "rows": rows,
        "total_rows": int(len(frame)),
        "truncated": len(frame) > limit,
    }


def list_akshare_functions() -> list[dict[str, Any]]:
    """目录的 JSON 视图，可直接作为 OpenAI tools schema 的 function 定义。"""
    return [
        {
            "type": "function",
            "function": {
                "name": fn.name,
                "description": fn.description,
                "parameters": {
                    "type": "object",
                    "properties": {k: {"type": "string", "description": v} for k, v in fn.params.items()},
                    "required": list(fn.required),
                },
            },
        }
        for fn in CATALOG.values()
    ]


def format_result_for_prompt(result: dict[str, Any]) -> str:
    """把调用结果压成给 LLM 看的紧凑文本（省 token，保留全部关键列）。"""
    if not result["rows"]:
        return f"接口 {result['interface']} 返回 0 行"
    head = json.dumps(result["rows"], ensure_ascii=False, default=str)
    note = f"（共 {result['total_rows']} 行，已截断）" if result.get("truncated") else f"（共 {result['total_rows']} 行）"
    return f"接口 {result['interface']} {result['arguments']} 返回{note}：\n{head}"
