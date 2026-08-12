from __future__ import annotations

from typing import Any, TypedDict

from langgraph.graph import END, StateGraph

from .db import QueryResult
from .llm import LLMClient


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
        if context.get("source") == "analysis-page":
            analysis_tables = [
                "ai_daily_snapshots",
                "precious_metal_snapshots",
                "tech_market_snapshots",
            ]
            available = set(list_tables(db_engine))
            return {**state, "selected_tables": [table for table in analysis_tables if table in available]}

        explicit_scope = state.get("db_scope")
        if explicit_scope not in (None, "", "auto"):
            return {**state, "selected_tables": [explicit_scope]}

        tables = list_tables(db_engine)
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
