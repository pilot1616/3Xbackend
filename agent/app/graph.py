from __future__ import annotations

from typing import Any, TypedDict

from langgraph.graph import END, StateGraph

from .db import QueryResult
from .llm import LLMClient


MARKET_DATA_RULES = (
    "市场数据规则：precious_metal_snapshots 和 tech_market_snapshots 均按交易日保存日线数据；"
    "日 K 线字段使用 price（收盘价兼容字段）、open、high、low；历史记录按 symbol 分组并按 fetched_at 排序。"
    "不要把每次抓取轮询误解成分钟线或实时行情。"
    "tech_market_snapshots 的 market_cap、pe_ratio、beta、eps、dividend、yield 是科技标的的估值/扩展字段，"
    "这些字段可能为空，查询最新估值时必须按 symbol 取 MAX(fetched_at) 对应的完整记录，不能把不同日期的字段拼在一起。"
    "市场标的应同时返回 name（中文标的名）和 symbol（国际代码）；不要只返回代码。"
)

MARKET_TABLES = ("precious_metal_snapshots", "tech_market_snapshots")
AI_TABLE = "ai_daily_snapshots"


def select_tables_for_prompt(prompt: str, available_tables: list[str]) -> list[str]:
    """Choose relevant tables without relying on database table ordering."""
    available = set(available_tables)
    text = prompt.lower()
    has_ai = any(keyword in text for keyword in ("ai", "日报", "新闻", "资讯", "主题", "舆情"))
    has_metal = any(keyword in text for keyword in ("金属", "贵金属", "黄金", "白银", "铂", "钯", "铜", "镍", "铝", "锌", "xau", "xag", "xpt", "xpd", "xcu", "xni", "xal", "xzn"))
    has_tech = any(keyword in text for keyword in ("科技", "芯片", "半导体", "etf", "指数", "股票", "估值", "市盈率", "pe", "市值", "k线", "行情", "tech"))
    selected: list[str] = []

    if has_metal or (not has_ai and not has_tech and any(keyword in text for keyword in ("市场", "标的", "价格", "收盘", "开盘"))):
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


def build_graph(db_engine) -> Any:
    llm = LLMClient()

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

        schema = schema_summary(db_engine, state.get("selected_tables") or None)
        system_prompt = (
            "你是企业内部数据分析 SQL 规划助手。"
            "你只能输出一条 MySQL 只读 SQL，不要解释，不要 Markdown。"
            "只能使用给定 schema 中存在的表和字段。"
            "禁止 INSERT、UPDATE、DELETE、DROP、ALTER、CREATE、TRUNCATE。"
            "如果用户问题涉及 AI 与市场联动，必须同时查询 AI 日报表和金融行情表。"
            "如果用户问题无法精确回答，输出一个用于获取最相关事实的 SELECT 查询。"
            + MARKET_DATA_RULES
        )
        user_prompt = (
            f"用户问题：{state['prompt']}\n\n"
            f"上下文：{state.get('context', {})}\n\n"
            f"可用 schema：\n{schema}\n\n"
            "请生成一条 MySQL 查询。结果行数请尽量控制在 50 行以内。"
        )
        sql = llm.analyze(system_prompt, user_prompt)
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
        system_prompt = (
            "你是企业内部数据分析助手。"
            "你会根据数据库查询结果和用户问题，给出简洁、可执行的分析结论。"
            + MARKET_DATA_RULES
        )
        query_result = state.get("query_result")
        result_text = ""
        if query_result:
            result_text = f"SQL: {query_result.sql}\nCOLUMNS: {query_result.columns}\nROWS: {query_result.rows}"
        user_prompt = (
            f"用户问题：{state['prompt']}\n\n"
            f"查询摘要：\n{state.get('query_summary', '')}\n\n"
            f"查询结果：\n{result_text}\n\n"
            "请输出：结论、依据、异常点、建议。"
        )
        analysis = llm.analyze(system_prompt, user_prompt)
        return {**state, "analysis": analysis, "answer": analysis or "LLM returned empty response"}

    def format_response(state: AgentState) -> AgentState:
        return {
            **state,
            "answer": state.get("answer", ""),
            "error": state.get("error", ""),
        }

    graph = StateGraph(AgentState)
    graph.add_node("parse_prompt", parse_prompt)
    graph.add_node("plan_query", plan_query)
    graph.add_node("generate_sql", generate_sql)
    graph.add_node("run_db_query", run_db_query)
    graph.add_node("analyze_data", analyze_data)
    graph.add_node("format_response", format_response)

    graph.set_entry_point("parse_prompt")
    graph.add_edge("parse_prompt", "plan_query")
    graph.add_edge("plan_query", "generate_sql")
    graph.add_edge("generate_sql", "run_db_query")
    graph.add_edge("run_db_query", "analyze_data")
    graph.add_edge("analyze_data", "format_response")
    graph.add_edge("format_response", END)

    return graph.compile()
