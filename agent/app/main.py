from __future__ import annotations

import collections
import json
import secrets
import threading
import time

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from dotenv import load_dotenv

load_dotenv()

from .config import settings
from .chat_store import (
    add_message,
    count_messages,
    create_or_touch_conversation,
    create_run,
    ensure_chat_tables,
    finish_run,
    list_conversations,
    list_messages,
    list_summaries,
    log_llm,
    recent_messages,
    summarized_message_count,
    upsert_summary,
)
from .context import (
    MAX_SUMMARY_SEGMENTS,
    RECENT_MESSAGE_LIMIT,
    build_history_block,
    parse_reply_payload,
    plan_segmenting,
    summarize_instruction,
)
from .akshare_tool import AkshareToolError, call_akshare, list_akshare_functions
from .db import build_engine, execute_readonly_sql, schema_summary
from .graph import MARKET_DATA_RULES, build_graph, fetch_external_market_text
from .llm import LLMClient, build_stable_messages
from .types import (
    AkshareCallRequest,
    AkshareCallResponse,
    ChatRequest,
    ChatResponse,
    PromptRequest,
    PromptResponse,
)

GENERIC_AGENT_ERROR = "分析服务暂时不可用，请稍后重试"

RATE_LIMIT_MAX_REQUESTS = 10
RATE_LIMIT_WINDOW_SECONDS = 60.0

_rate_limit_lock = threading.Lock()
_rate_limit_windows: dict[int, deque[float]] = {}


class RateLimitError(Exception):
    """Raised when a user exceeds the per-user request budget."""


def check_rate_limit(user_id: int) -> None:
    """Sliding-window per-user budget shared by /prompt and /chat."""
    now = time.monotonic()
    with _rate_limit_lock:
        window = _rate_limit_windows.setdefault(user_id, collections.deque())
        while window and now - window[0] > RATE_LIMIT_WINDOW_SECONDS:
            window.popleft()
        if len(window) >= RATE_LIMIT_MAX_REQUESTS:
            raise RateLimitError("too many requests")
        window.append(now)


engine = build_engine()

app = FastAPI(title="3X Agent", version="0.1.0")
if settings.cors_origin_list:
    # Whitelist mode: browsers only get credentials for explicit origins.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    # No whitelist configured (local development): open access without cookies.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )


@app.middleware("http")
async def verify_internal_token(request: Request, call_next):
    token = settings.internal_token
    if token and request.url.path != "/health":
        provided = request.headers.get("x-agent-token", "")
        if not secrets.compare_digest(provided, token):
            return JSONResponse(status_code=401, content={"detail": "invalid agent token"})
    return await call_next(request)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/akshare/tools")
def akshare_tools() -> dict[str, object]:
    """列出所有允许调用的 akshare 接口（OpenAI tools schema 格式）。"""
    return {"tools": list_akshare_functions()}


@app.post("/akshare/call", response_model=AkshareCallResponse)
def akshare_call(request: AkshareCallRequest) -> AkshareCallResponse:
    """执行一个白名单内的 akshare 接口，返回 JSON 安全的行情数据。"""
    try:
        result = call_akshare(request.interface, request.arguments)
    except AkshareToolError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception:
        raise HTTPException(status_code=502, detail="行情数据源暂时不可用，请稍后重试") from None
    return AkshareCallResponse(**result)


@app.post("/prompt", response_model=PromptResponse)
def prompt(request: PromptRequest) -> PromptResponse:
    if not settings.llm_api_key:
        raise HTTPException(status_code=500, detail="LLM_API_KEY is not configured")
    if request.user is not None:
        try:
            check_rate_limit(request.user.id)
        except RateLimitError:
            raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试")

    # 审计记录失败不应拖垮分析本身：DB 不可用时降级为无 run 记录继续执行。
    run_id = ""
    try:
        ensure_chat_tables(engine)
        # /prompt 不属于任何会话；run 记录用空 conversation_id，仅用于审计与排障。
        run_id = create_run(engine, "", "", request.prompt[:200])
    except Exception:
        run_id = ""

    def log_graph_llm(stage: str, model: str, llm_request: dict, llm_response: dict | None, latency_ms: int, error: str) -> None:
        if not run_id:
            return
        log_llm(engine, run_id, stage, model, llm_request, llm_response, error=error, latency_ms=latency_ms)

    try:
        result = build_graph(engine, llm_logger=log_graph_llm).invoke(
            {
                "prompt": request.prompt,
                "context": request.context,
                "db_scope": request.db_scope,
            }
        )
    except Exception as exc:
        # 异常原文可能带出 SQL/表结构细节，只入 run 记录不返回给客户端。
        if run_id:
            try:
                finish_run(engine, run_id, "failed", error=str(exc))
            except Exception:
                pass
        return PromptResponse(answer="", query_summary="", sources=[], error=GENERIC_AGENT_ERROR)

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
    query_summary = result.get("query_summary", "")
    answer = result.get("answer", "")
    error = result.get("error", "")
    try:
        if run_id:
            finish_run(
                engine,
                run_id,
                "success" if not error else "failed",
                generated_sql=query_result.sql if query_result else "",
                query_summary=query_summary,
                sources_json=json.dumps(sources, ensure_ascii=False, default=str),
                error=error,
            )
    except Exception:
        pass
    return PromptResponse(answer=answer, query_summary=query_summary, sources=sources, error=error)


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
    try:
        check_rate_limit(request.user.id)
    except RateLimitError:
        raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试")

    ensure_chat_tables(engine)
    llm = LLMClient()
    user = request.user.model_dump()
    source = str(request.context.get("source") or "analysis-page")
    conversation_id = create_or_touch_conversation(engine, request.conversation_id, user, source, request.message[:60])

    # 取历史时本轮 user 消息尚未落库，这里拿到的尾部原文不含当前消息。
    total_count = count_messages(engine, conversation_id, user["id"])
    summarized_count = summarized_message_count(engine, conversation_id)
    plan = plan_segmenting(total_count, summarized_count)
    summaries = list_summaries(engine, conversation_id, MAX_SUMMARY_SEGMENTS)
    recent = recent_messages(
        engine,
        conversation_id,
        user["id"],
        RECENT_MESSAGE_LIMIT + 2,  # 多取 2 条留给摘要重叠指代
    )
    recent = recent[-RECENT_MESSAGE_LIMIT:]
    history_text = build_history_block(summaries, recent)
    if plan.should_summarize:
        history_text += "\n\n" + summarize_instruction()

    user_message_id = add_message(engine, conversation_id, user, "user", request.message)
    run_id = create_run(engine, conversation_id, user_message_id, request.message)

    try:
        # 外部行情：与 /prompt 的 fetch_market_data 节点共用同一逻辑；
        # 意图不命中零开销，命中后任何失败都降级为空文本，不阻断聊天。
        market_data_text = fetch_external_market_text(request.message, llm)
        if market_data_text:
            log_llm(engine, run_id, "fetch_market_data", settings.model_for_stage("tool"), {"interface": "akshare"}, {"rows": market_data_text[:2000]})

        # 前缀缓存要求"同一 stage 的多次请求"开头逐字节一致：
        # 共享 system（角色+规则+schema），stage 差异放在各自的 instruction 里，
        # 动态内容（问题/历史/查询结果）全部集中在最后一条 user。
        schema = schema_summary(engine, ["ai_daily_snapshots", "precious_metal_snapshots", "tech_market_snapshots"])
        stable_system = (
            "你是企业内部 AI 金融分析助手，负责分析贵金属、科技市场行情和 AI 日报数据。"
            + MARKET_DATA_RULES
            + "\n可用数据表 schema（只能使用这些表和字段）：\n"
            + schema
        )
        sql_instruction = (
            "当前任务：根据用户问题和历史对话生成一条 MySQL 只读查询。"
            "优先写简单直接的查询，避免多层嵌套 CTE 和子查询（网关响应慢，查询越简单返回越快）。"
            "只输出一条 SELECT/WITH SQL 本身，不要解释，不要 Markdown；行数控制在 20 行以内；"
            "涉及联动分析时优先关联 AI 日报与行情表。"
        )
        answer_instruction = (
            "当前任务：根据下方查询结果和对话历史，用自然语言回答用户。"
            "必须输出人能直接看懂的中文结论，绝对不要输出 SQL 或代码；"
            "结构为：结论、依据（引用具体数字）、风险、建议。"
        )
        # 外部行情块注入 SQL 生成与回答两轮：前者用于联动分析，后者强制引用数字。
        market_block = f"\n\n外部行情数据（AKShare 实时获取）：\n{market_data_text}" if market_data_text else ""
        market_answer_rule = (
            "\n分析时必须引用外部行情数据的具体数字。" if market_data_text else ""
        )

        dynamic_for_sql = (
            f"用户问题：{request.message}\n\n"
            f"{history_text}\n\n"
            f"上下文：{request.context}"
            f"{market_block}\n\n"
            "请生成一条能回答用户问题的 MySQL 查询。"
            + (f"\n{summarize_instruction()}" if plan.should_summarize else "")
        )
        sql_messages = build_stable_messages(stable_system, sql_instruction, dynamic_for_sql)
        try:
            sql_call = llm.chat(sql_messages, "", stage="sql")
            log_llm(engine, run_id, "generate_sql", sql_call.request["model"], sql_call.request, sql_call.response, latency_ms=sql_call.latency_ms)
        except Exception as exc:
            log_llm(engine, run_id, "generate_sql", settings.model_for_stage("sql"), {"messages": sql_messages}, None, error=str(exc))
            raise

        # 20 行足够分析用：结果行是 prompt 输入大头，直接决定第二轮耗时。
        try:
            query_result = execute_readonly_sql(engine, sql_call.content, limit=20)
        except Exception as sql_exc:
            # 模型偶尔生成坏 SQL；带错误反馈自修复一次，比直接失败或干等超时都快。
            repair_dynamic = (
                f"用户问题：{request.message}\n\n"
                f"{history_text}\n\n"
                f"你上一条 SQL 执行失败：\nSQL: {sql_call.content[:500]}\n错误: {str(sql_exc)[:300]}\n\n"
                f"上下文：{request.context}\n\n"
                "请重新生成一条能回答用户问题的、更简单可靠的 MySQL 查询。"
            )
            repair_messages = build_stable_messages(stable_system, sql_instruction, repair_dynamic)
            try:
                sql_call = llm.chat(repair_messages, "", stage="sql")
                log_llm(engine, run_id, "generate_sql_repair", sql_call.request["model"], sql_call.request, sql_call.response, latency_ms=sql_call.latency_ms)
            except Exception as exc:
                log_llm(engine, run_id, "generate_sql_repair", settings.model_for_stage("sql"), {"messages": repair_messages}, None, error=str(exc))
                raise
            query_result = execute_readonly_sql(engine, sql_call.content, limit=20)
        visible_query_summary = f"columns={query_result.columns}\nrows={len(query_result.rows)}"
        sources = jsonable_encoder([{"sql": query_result.sql, "columns": query_result.columns, "rows": query_result.rows}])

        dynamic_for_answer = (
            f"用户问题：{request.message}\n\n"
            f"{history_text}\n\n"
            f"查询摘要：\n{visible_query_summary}\n\n"
            f"查询结果：\n{sources[0]['rows']}"
            f"{market_block}\n\n"
            "请给出自然语言回答。"
            + market_answer_rule
        )
        answer_messages = build_stable_messages(stable_system, answer_instruction, dynamic_for_answer)
        try:
            answer_call = llm.chat(answer_messages, "", stage="analyze")
            log_llm(engine, run_id, "analyze_data", answer_call.request["model"], answer_call.request, answer_call.response, latency_ms=answer_call.latency_ms)
        except Exception as exc:
            log_llm(engine, run_id, "analyze_data", settings.model_for_stage("analyze"), {"messages": answer_messages}, None, error=str(exc))
            raise

        reply_text, segment_summary = parse_reply_payload(answer_call.content)
        assistant_message_id = add_message(engine, conversation_id, user, "assistant", reply_text)
        if plan.should_summarize and segment_summary:
            try:
                upsert_summary(
                    engine,
                    conversation_id,
                    plan.pending_index,
                    plan.pending_end - plan.pending_start,
                    segment_summary,
                )
            except Exception:
                pass  # 摘要落库失败不影响主回答；该段下轮补
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
        return ChatResponse(conversation_id=conversation_id, message_id=assistant_message_id, reply=reply_text, query_summary=visible_query_summary, sources=sources, run_id=run_id)
    except Exception as exc:
        finish_run(engine, run_id, "failed", error=str(exc))
        raise HTTPException(status_code=500, detail=GENERIC_AGENT_ERROR) from exc


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=False)
