# -*- coding: utf-8 -*-
"""LLM 日志只读查询（运维后门）：runs 总账 + 每次 LLM 调用明细 + 阶段统计。

仅供 /logs/* 调试接口使用；数据源是 agent_runs / agent_llm_logs 两张审计表。
"""
from __future__ import annotations

import json
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Engine


def list_runs(engine: Engine, limit: int = 50, status: str = "", search: str = "") -> list[dict[str, Any]]:
    """最近的 run 列表（总账）。search 模糊匹配 prompt。"""
    limit = max(1, min(limit, 200))
    conditions = ["1=1"]
    params: dict[str, Any] = {"limit": limit}
    if status:
        conditions.append("status = :status")
        params["status"] = status
    if search:
        conditions.append("prompt LIKE :search")
        params["search"] = f"%{search}%"

    with engine.connect() as conn:
        rows = conn.execute(
            text(
                f"""
                SELECT run_id, conversation_id, user_message_id, assistant_message_id,
                       status, LEFT(prompt, 200) AS prompt, LEFT(generated_sql, 500) AS generated_sql,
                       LEFT(query_summary, 300) AS query_summary, LEFT(error, 300) AS error,
                       started_at, finished_at, latency_ms
                FROM agent_runs
                WHERE {' AND '.join(conditions)}
                ORDER BY id DESC
                LIMIT :limit
                """
            ),
            params,
        ).mappings().all()
    return [dict(r) for r in rows]


def run_detail(engine: Engine, run_id: str) -> dict[str, Any] | None:
    """单次 run 的完整明细：总账 + 该 run 的全部 LLM 调用（含完整请求/响应）。"""
    with engine.connect() as conn:
        run = conn.execute(
            text(
                """
                SELECT run_id, conversation_id, user_message_id, assistant_message_id,
                       status, prompt, generated_sql, query_summary, sources_json, error,
                       started_at, finished_at, latency_ms
                FROM agent_runs WHERE run_id = :run_id
                """
            ),
            {"run_id": run_id},
        ).mappings().first()
        if run is None:
            return None
        logs = conn.execute(
            text(
                """
                SELECT log_id, stage, model, request_json, response_json, error, latency_ms, created_at
                FROM agent_llm_logs WHERE run_id = :run_id ORDER BY id ASC
                """
            ),
            {"run_id": run_id},
        ).mappings().all()

    log_entries = []
    for row in logs:
        entry = dict(row)
        # 完整 JSON 解析后返回，前端直接展示格式化内容；解析失败保留原文。
        for key in ("request_json", "response_json"):
            raw = entry.get(key)
            if isinstance(raw, str) and raw:
                try:
                    entry[key] = json.loads(raw)
                except (json.JSONDecodeError, ValueError):
                    pass
        log_entries.append(entry)
    result = dict(run)
    result["llm_calls"] = log_entries
    return result


def stage_stats(engine: Engine, since_hours: int = 168) -> list[dict[str, Any]]:
    """按阶段聚合：调用量、错误数、平均耗时（默认最近 7 天）。"""
    since_hours = max(1, min(since_hours, 24 * 90))
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT stage, COUNT(*) AS calls,
                       SUM(CASE WHEN error IS NOT NULL AND error != '' THEN 1 ELSE 0 END) AS errors,
                       ROUND(AVG(latency_ms) / 1000, 1) AS avg_seconds,
                       ROUND(MAX(latency_ms) / 1000, 1) AS max_seconds
                FROM agent_llm_logs
                WHERE created_at >= DATE_SUB(NOW(), INTERVAL :since_hours HOUR)
                GROUP BY stage ORDER BY calls DESC
                """
            ),
            {"since_hours": since_hours},
        ).mappings().all()
    return [dict(r) for r in rows]
