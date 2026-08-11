from __future__ import annotations

from typing import Any, TypedDict

from langgraph.graph import END, StateGraph

from .db import TableSample
from .llm import LLMClient


class AgentState(TypedDict, total=False):
    prompt: str
    context: dict[str, Any]
    db_scope: str | None
    plan: str
    selected_tables: list[str]
    samples: list[TableSample]
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
            "query_summary": "",
            "error": "",
        }

    def plan_query(state: AgentState) -> AgentState:
        from .db import list_tables, table_fingerprint

        prompt = state["prompt"].lower()
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

    def run_db_query(state: AgentState) -> AgentState:
        from .db import collect_scope, describe_table

        selected = state.get("selected_tables") or []
        samples: list[TableSample] = []
        for table in selected[:5]:
            try:
                columns, rows = describe_table(db_engine, table)
            except Exception:
                continue
            samples.append(TableSample(table=table, columns=columns, rows=rows))
        if not samples:
            samples = collect_scope(db_engine, None)
        summary_lines = []
        for sample in samples:
            summary_lines.append(f"table={sample.table}, columns={sample.columns}, rows={len(sample.rows)}")
        return {**state, "samples": samples, "query_summary": "\n".join(summary_lines)}

    def analyze_data(state: AgentState) -> AgentState:
        system_prompt = (
            "你是企业内部数据分析助手。"
            "你会根据数据库样本和用户问题，给出简洁、可执行的分析结论。"
        )
        sample_text = "\n".join(
            [
                f"TABLE: {sample.table}\nCOLUMNS: {sample.columns}\nROWS: {sample.rows}"
                for sample in state.get("samples", [])
            ]
        )
        user_prompt = (
            f"用户问题：{state['prompt']}\n\n"
            f"查询摘要：\n{state.get('query_summary', '')}\n\n"
            f"数据库样本：\n{sample_text}\n\n"
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
    graph.add_node("run_db_query", run_db_query)
    graph.add_node("analyze_data", analyze_data)
    graph.add_node("format_response", format_response)

    graph.set_entry_point("parse_prompt")
    graph.add_edge("parse_prompt", "plan_query")
    graph.add_edge("plan_query", "run_db_query")
    graph.add_edge("run_db_query", "analyze_data")
    graph.add_edge("analyze_data", "format_response")
    graph.add_edge("format_response", END)

    return graph.compile()
