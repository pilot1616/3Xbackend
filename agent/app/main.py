from __future__ import annotations

import json

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.encoders import jsonable_encoder
from dotenv import load_dotenv

load_dotenv()

from .config import settings
from .chat_store import (
    add_message,
    create_or_touch_conversation,
    create_run,
    ensure_chat_tables,
    finish_run,
    list_conversations,
    list_messages,
    log_llm,
    recent_messages,
)
from .db import build_engine, execute_readonly_sql, schema_summary
from .graph import build_graph
from .llm import LLMClient
from .types import ChatRequest, ChatResponse, PromptRequest, PromptResponse


engine = build_engine()
workflow = build_graph(engine)

app = FastAPI(title="3X Agent", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/prompt", response_model=PromptResponse)
def prompt(request: PromptRequest) -> PromptResponse:
    if not settings.llm_api_key:
        raise HTTPException(status_code=500, detail="LLM_API_KEY is not configured")
    try:
        result = workflow.invoke(
            {
                "prompt": request.prompt,
                "context": request.context,
                "db_scope": request.db_scope,
            }
        )
    except Exception as exc:
        return PromptResponse(answer="", query_summary="", sources=[], error=str(exc))

    sources = []
    query_result = result.get("query_result")
    if query_result:
        sources.append(
            {
                "sql": query_result.sql,
                "columns": query_result.columns,
                "rows": query_result.rows,
            }
        )
    return PromptResponse(
        answer=result.get("answer", ""),
        query_summary=result.get("query_summary", ""),
        sources=sources,
        error=result.get("error", ""),
    )


@app.get("/conversations")
def conversations(user_id: int) -> dict[str, object]:
    ensure_chat_tables(engine)
    return {"records": list_conversations(engine, user_id)}


@app.get("/conversations/{conversation_id}/messages")
def conversation_messages(conversation_id: str, user_id: int) -> dict[str, object]:
    try:
        ensure_chat_tables(engine)
        return {"records": list_messages(engine, conversation_id, user_id)}
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    if not settings.llm_api_key:
        raise HTTPException(status_code=500, detail="LLM_API_KEY is not configured")

    ensure_chat_tables(engine)
    llm = LLMClient()
    user = request.user.model_dump()
    source = str(request.context.get("source") or "analysis-page")
    conversation_id = create_or_touch_conversation(engine, request.conversation_id, user, source, request.message[:60])
    user_message_id = add_message(engine, conversation_id, user, "user", request.message)
    run_id = create_run(engine, conversation_id, user_message_id, request.message)

    try:
        history = recent_messages(engine, conversation_id, user["id"], 6)
        schema = schema_summary(engine, ["ai_daily_snapshots", "precious_metal_snapshots", "tech_market_snapshots"])
        history_text = "\n".join([f"{item['role']}: {item['content']}" for item in history])

        sql_system = (
            "你是企业内部数据分析 SQL 规划助手。"
            "只能输出一条 MySQL 只读 SELECT/WITH SQL，不要 Markdown。"
            "必须优先使用给定的 AI 日报、贵金属、科技市场表。"
        )
        sql_user = (
            f"用户问题：{request.message}\n\n"
            f"最近对话：\n{history_text}\n\n"
            f"上下文：{request.context}\n\n"
            f"可用 schema：\n{schema}\n\n"
            "请生成一条能回答用户问题的 MySQL 查询，最多 50 行。"
        )
        try:
            sql_call = llm.chat(sql_system, sql_user)
            log_llm(engine, run_id, "generate_sql", settings.llm_model, sql_call.request, sql_call.response, latency_ms=sql_call.latency_ms)
        except Exception as exc:
            log_llm(engine, run_id, "generate_sql", settings.llm_model, {"system": sql_system, "user": sql_user}, None, error=str(exc))
            raise

        query_result = execute_readonly_sql(engine, sql_call.content)
        visible_query_summary = f"columns={query_result.columns}\nrows={len(query_result.rows)}"
        sources = jsonable_encoder([{"sql": query_result.sql, "columns": query_result.columns, "rows": query_result.rows}])

        answer_system = "你是企业内部 AI 金融分析助手。请根据查询结果和对话历史回答，给出结论、依据、风险和建议。"
        answer_user = (
            f"用户问题：{request.message}\n\n"
            f"最近对话：\n{history_text}\n\n"
            f"查询摘要：\n{visible_query_summary}\n\n"
            f"查询结果：\n{sources[0]['rows']}"
        )
        try:
            answer_call = llm.chat(answer_system, answer_user)
            log_llm(engine, run_id, "analyze_data", settings.llm_model, answer_call.request, answer_call.response, latency_ms=answer_call.latency_ms)
        except Exception as exc:
            log_llm(engine, run_id, "analyze_data", settings.llm_model, {"system": answer_system, "user": answer_user}, None, error=str(exc))
            raise
        assistant_message_id = add_message(engine, conversation_id, user, "assistant", answer_call.content)
        finish_run(
            engine,
            run_id,
            "success",
            assistant_message_id=assistant_message_id,
            generated_sql=query_result.sql,
            query_summary=visible_query_summary,
            sources_json=json.dumps(sources, ensure_ascii=False),
            latency_ms=sql_call.latency_ms + answer_call.latency_ms,
        )
        return ChatResponse(conversation_id=conversation_id, message_id=assistant_message_id, reply=answer_call.content, query_summary=visible_query_summary, sources=sources, run_id=run_id)
    except Exception as exc:
        finish_run(engine, run_id, "failed", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc)) from exc


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=False)
