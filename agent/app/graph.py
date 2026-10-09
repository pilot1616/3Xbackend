from __future__ import annotations

import json
import re
from typing import Any, TypedDict

from langgraph.graph import END, StateGraph

from .akshare_tool import AkshareToolError, call_akshare, format_result_for_prompt
from .db import QueryResult
from .llm import LLMClient, LLMLogger
from .market_rag import search_interfaces


MARKET_DATA_RULES = (
    "市场数据规则：precious_metal_snapshots 和 tech_market_snapshots 均按交易日保存日线数据；"
    "日 K 线字段使用 price（收盘价兼容字段）、open、high、low；历史记录按 symbol 分组并按 fetched_at 排序。"
    "不要把每次抓取轮询误解成分钟线或实时行情。"
    "价格、涨跌幅等数值列（price/open/high/low/change/change_percent/market_cap/pe_ratio 等）是 VARCHAR 字符串，"
    "可能带千分位逗号，SQL 里做排序、比较、聚合前必须先 CAST(REPLACE(列, ',', '') AS DECIMAL(20,6))，"
    "直接对字符串 ORDER BY 或比较会得到错误的字典序结果。"
    "最新行情同步是小时级轮询，最近几天的 fetched_at 是小时级时间戳而更早的历史是交易日粒度；"
    "按天统计或取日线序列时必须用 DATE(fetched_at) 分组、每组取当日 MAX(fetched_at) 的记录，"
    "否则同一天会出现多行导致序列失真。"
    "tech_market_snapshots 的 market_cap、pe_ratio、beta、eps、dividend、yield 是科技标的的估值/扩展字段，"
    "这些字段可能为空，查询最新估值时必须按 symbol 取 MAX(fetched_at) 对应的完整记录，不能把不同日期的字段拼在一起。"
    "市场标的应同时返回 name（中文标的名）和 symbol（国际代码）；不要只返回代码。"
)

MARKET_TABLES = ("precious_metal_snapshots", "tech_market_snapshots")
AI_TABLE = "ai_daily_snapshots"

# 外部行情意图关键词：命中才走 akshare 取数节点，避免每个请求都多付一次 LLM 调用。
# 这些是"库里没有、必须远程取"的数据诉求；库内已有行情的常规分析不在此列。
EXTERNAL_MARKET_KEYWORDS = (
    "akshare",
    "上金所", "上海黄金交易所", "上海金", "上海银",
    "sge", "au99", "au9999", "ag99",
    "现货金", "现货银", "现货价格", "金价", "银价",
    "分时", "实时行情", "实时数据",
    "美股", "港股", "纳斯达克", "纳斯达克指数", "道琼斯", "标普",
    "期货", "主力合约", "连续合约", "基差",
    "cpi", "lpr", "通胀", "物价指数", "贷款市场报价利率",
    "前复权", "后复权", "复权",
    "etf", "日线", "周线", "月线",
    "历史行情", "历史数据", "历史k", "k线数据",
)


def needs_external_market_data(prompt: str) -> bool:
    text = prompt.lower()
    return any(keyword in text for keyword in EXTERNAL_MARKET_KEYWORDS)


def select_tables_for_prompt(prompt: str, available_tables: list[str]) -> list[str]:
    """Choose relevant tables without relying on database table ordering."""
    available = set(available_tables)
    text = prompt.lower()
    # 全词匹配，避免 "email" 里的 "ai"、"speed" 里的 "pe" 之类子串误触发。
    def has(keyword: str) -> bool:
        return re.search(rf"(?<![a-z0-9]){re.escape(keyword)}(?![a-z0-9])", text) is not None

    has_ai = any(has(keyword) for keyword in ("ai", "日报", "新闻", "资讯", "主题", "舆情"))
    has_metal = any(has(keyword) for keyword in ("金属", "贵金属", "黄金", "白银", "铂", "钯", "铜", "镍", "铝", "锌", "xau", "xag", "xpt", "xpd", "xcu", "xni", "xal", "xzn"))
    has_tech = any(has(keyword) for keyword in ("科技", "芯片", "半导体", "etf", "指数", "股票", "估值", "市盈率", "pe", "市值", "k线", "行情", "tech"))
    selected: list[str] = []

    if has_metal or (not has_ai and not has_tech and any(has(keyword) for keyword in ("市场", "标的", "价格", "收盘", "开盘"))):
        selected.append("precious_metal_snapshots")
    if has_tech:
        selected.append("tech_market_snapshots")
    if has_ai:
        selected.insert(0, AI_TABLE)

    result = [table for table in selected if table in available]
    if result:
        return result
    return [table for table in available_tables[:3]]


class AgentState(TypedDict, total=False):
    prompt: str
    context: dict[str, Any]
    db_scope: str | None
    plan: str
    selected_tables: list[str]
    schema: str
    sql: str
    query_result: QueryResult
    analysis: str
    answer: str
    query_summary: str
    error: str
    # akshare 外部行情取数结果（format_result_for_prompt 的文本），供 analyze_data 汇总。
    market_data_text: str


def _extract_json(text: str) -> str:
    """从 LLM 回复中抠出第一个 JSON 对象（容忍 ```json 围栏与前后废话）。"""
    start = text.find("{")
    if start < 0:
        raise ValueError(f"no json object in response: {text[:200]}")
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    raise ValueError(f"unbalanced json in response: {text[:200]}")


def fetch_external_market_text(prompt: str, llm: LLMClient) -> str:
    """外部行情取数（RAG 选接口 -> LLM 定参数 -> akshare tool 执行）。

    供 LangGraph 节点与 /chat 管线共用；任何一步失败都返回空字符串降级，
    绝不抛异常打断主管线。
    """
    from .llm import build_stable_messages

    if not needs_external_market_data(prompt):
        return ""

    candidates = search_interfaces(prompt, topk=3)
    if not candidates:
        return ""

    catalog_text = "\n\n".join(
        f"候选接口 {i + 1}：{c['interface']}\n文档：\n{c['doc']}" for i, c in enumerate(candidates)
    )
    system = (
        "你是 AKShare 行情接口参数规划助手。根据用户问题和候选接口文档，"
        "选择最合适的一个接口并给出调用参数。"
        "只输出一行 JSON：{\"interface\": \"接口名\", \"arguments\": {参数名: 值}}，"
        "不要解释，不要 Markdown。日期参数一律用 yyyymmdd 字符串。"
        "如果所有候选接口都无法回答用户问题，输出 {\"interface\": \"\"}。"
    )
    dynamic = f"用户问题：{prompt}\n\n候选接口文档：\n{catalog_text}\n\n请输出 JSON。"
    try:
        decision = llm.chat(build_stable_messages(system, "输出约定：只输出一行 JSON。", dynamic), "", stage="tool")
        payload = json.loads(_extract_json(decision.content))
    except (ValueError, json.JSONDecodeError):
        return ""

    iface = str(payload.get("interface") or "")
    if iface not in {c["interface"] for c in candidates}:
        return ""
    arguments = payload.get("arguments") or {}
    if not isinstance(arguments, dict):
        arguments = {}

    try:
        result = call_akshare(iface, {str(k): v for k, v in arguments.items()})
    except AkshareToolError:
        # 数据源失败降级为无外部数据，主管线继续走库内分析。
        return ""

    return format_result_for_prompt(result)


def build_graph(db_engine, llm_logger: LLMLogger | None = None) -> Any:
    llm = LLMClient(logger=llm_logger)

    def parse_prompt(state: AgentState) -> AgentState:
        prompt = state["prompt"].strip()
        scope = state.get("db_scope") or "auto"
        return {
            **state,
            "plan": f"Analyze prompt with scope={scope}",
            "selected_tables": [],
            "schema": "",
            "sql": "",
            "query_summary": "",
            "error": "",
        }

    def fetch_market_data(state: AgentState) -> AgentState:
        """外部行情节点：逻辑在 fetch_external_market_text（与 /chat 共用）。"""
        return {**state, "market_data_text": fetch_external_market_text(state["prompt"], llm)}

    def plan_query(state: AgentState) -> AgentState:
        from .db import list_tables, table_fingerprint

        prompt = state["prompt"].lower()
        context = state.get("context") or {}
        if str(context.get("source") or "").startswith(("analysis-page", "ai-chat-page")):
            analysis_tables = [AI_TABLE, *MARKET_TABLES]
            available = set(list_tables(db_engine))
            return {**state, "selected_tables": [table for table in analysis_tables if table in available]}

        explicit_scope = state.get("db_scope")
        if explicit_scope not in (None, "", "auto"):
            return {**state, "selected_tables": [explicit_scope]}

        tables = list_tables(db_engine)
        market_tables = select_tables_for_prompt(state["prompt"], tables)
        if market_tables:
            return {**state, "selected_tables": market_tables}

        keywords = [word for word in prompt.replace("，", " ").replace(",", " ").split() if len(word) >= 2]
        matched: list[str] = []
        for table in tables:
            score = 0
            fingerprint = table_fingerprint(db_engine, table).lower()
            for keyword in keywords:
                if keyword in table.lower():
                    score += 3
                if keyword in fingerprint:
                    score += 1
            if score > 0:
                matched.append(table)
        if not matched:
            matched = tables[:3]
        return {**state, "selected_tables": matched}

    def generate_sql(state: AgentState) -> AgentState:
        from .db import schema_summary
        from .llm import build_stable_messages

        schema = schema_summary(db_engine, state.get("selected_tables") or None)
        # system 含角色+规则+schema，逐字节稳定；动态内容全部集中在最后一条 user。
        stable_system = (
            "你是企业内部数据分析 SQL 规划助手。"
            "你只能输出一条 MySQL 只读 SQL，不要解释，不要 Markdown。"
            "只能使用给定 schema 中存在的表和字段。"
            "禁止 INSERT、UPDATE、DELETE、DROP、ALTER、CREATE、TRUNCATE。"
            "如果用户问题涉及 AI 与市场联动，必须同时查询 AI 日报表和金融行情表。"
            "如果用户问题无法精确回答，输出一个用于获取最相关事实的 SELECT 查询。"
            + MARKET_DATA_RULES
            + "\n可用数据表 schema（只能使用这些表和字段）：\n"
            + schema
        )
        stable_instruction = "输出约定：只输出 SQL 本身；结果行数尽量控制在 50 行以内。"
        dynamic_user = (
            f"用户问题：{state['prompt']}\n\n"
            f"上下文：{state.get('context', {})}\n\n"
            "请生成一条 MySQL 查询。"
        )
        sql = llm.analyze(build_stable_messages(stable_system, stable_instruction, dynamic_user), "", stage="sql")
        return {**state, "schema": schema, "sql": sql.strip()}

    def run_db_query(state: AgentState) -> AgentState:
        from .db import execute_readonly_sql

        query_result = execute_readonly_sql(db_engine, state.get("sql", ""))
        query_summary = (
            f"sql={query_result.sql}\n"
            f"columns={query_result.columns}\n"
            f"rows={len(query_result.rows)}"
        )
        return {**state, "query_result": query_result, "query_summary": query_summary}

    def analyze_data(state: AgentState) -> AgentState:
        from .llm import build_stable_messages

        # 与 generate_sql 共用同一份 system 前缀（角色措辞不同会破坏前缀一致性，
        # 因此角色描述合并为通用版），只有最后一条 user 消息是动态内容。
        stable_system = (
            "你是企业内部数据分析助手。"
            "你根据数据库查询结果和用户问题，给出简洁、可执行的分析结论；"
            "若任务要求生成 SQL，则只输出一条 MySQL 只读 SELECT/WITH SQL，不要解释，不要 Markdown。"
            + MARKET_DATA_RULES
        )
        stable_instruction = "输出约定：分析类任务输出结论、依据、异常点、建议。"
        result_text = ""
        query_result = state.get("query_result")
        if query_result:
            result_text = f"SQL: {query_result.sql}\nCOLUMNS: {query_result.columns}\nROWS: {query_result.rows}"
        market_data_text = state.get("market_data_text") or ""
        market_block = (
            f"\n\n外部行情数据（AKShare 实时获取）：\n{market_data_text}" if market_data_text else ""
        )
        dynamic_user = (
            f"用户问题：{state['prompt']}\n\n"
            f"查询摘要：\n{state.get('query_summary', '')}\n\n"
            f"查询结果：\n{result_text}"
            f"{market_block}\n\n"
            "请输出：结论、依据、异常点、建议。"
            + ("分析时必须引用外部行情数据的具体数字。" if market_data_text else "")
        )
        analysis = llm.analyze(build_stable_messages(stable_system, stable_instruction, dynamic_user), "", stage="analyze")
        return {**state, "analysis": analysis, "answer": analysis or "LLM returned empty response"}

    def format_response(state: AgentState) -> AgentState:
        return {
            **state,
            "answer": state.get("answer", ""),
            "error": state.get("error", ""),
        }

    graph = StateGraph(AgentState)
    graph.add_node("parse_prompt", parse_prompt)
    graph.add_node("fetch_market_data", fetch_market_data)
    graph.add_node("plan_query", plan_query)
    graph.add_node("generate_sql", generate_sql)
    graph.add_node("run_db_query", run_db_query)
    graph.add_node("analyze_data", analyze_data)
    graph.add_node("format_response", format_response)

    graph.set_entry_point("parse_prompt")
    graph.add_edge("parse_prompt", "fetch_market_data")
    graph.add_edge("fetch_market_data", "plan_query")
    graph.add_edge("plan_query", "generate_sql")
    graph.add_edge("generate_sql", "run_db_query")
    graph.add_edge("run_db_query", "analyze_data")
    graph.add_edge("analyze_data", "format_response")
    graph.add_edge("format_response", END)

    return graph.compile()
