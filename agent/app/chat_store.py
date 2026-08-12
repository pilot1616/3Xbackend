from __future__ import annotations

from datetime import datetime
import json
import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.engine import Engine


def ensure_chat_tables(engine: Engine) -> None:
    statements = [
        """
        CREATE TABLE IF NOT EXISTS agent_conversations (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          conversation_id VARCHAR(64) NOT NULL UNIQUE,
          user_id BIGINT NOT NULL,
          username VARCHAR(64) NOT NULL,
          source VARCHAR(64) NOT NULL,
          title VARCHAR(255) NOT NULL,
          created_at DATETIME NOT NULL,
          updated_at DATETIME NOT NULL,
          INDEX idx_agent_conversations_user_updated (user_id, updated_at)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS agent_messages (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          message_id VARCHAR(64) NOT NULL UNIQUE,
          conversation_id VARCHAR(64) NOT NULL,
          user_id BIGINT NOT NULL,
          username VARCHAR(64) NOT NULL,
          role VARCHAR(32) NOT NULL,
          content LONGTEXT NOT NULL,
          created_at DATETIME NOT NULL,
          INDEX idx_agent_messages_conversation_created (conversation_id, created_at),
          INDEX idx_agent_messages_user_created (user_id, created_at)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS agent_runs (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          run_id VARCHAR(64) NOT NULL UNIQUE,
          conversation_id VARCHAR(64) NOT NULL,
          user_message_id VARCHAR(64) NOT NULL,
          assistant_message_id VARCHAR(64),
          status VARCHAR(32) NOT NULL,
          prompt LONGTEXT NOT NULL,
          generated_sql LONGTEXT,
          query_summary LONGTEXT,
          sources_json LONGTEXT,
          error LONGTEXT,
          started_at DATETIME NOT NULL,
          finished_at DATETIME,
          latency_ms BIGINT,
          INDEX idx_agent_runs_conversation_started (conversation_id, started_at)
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS agent_llm_logs (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,
          log_id VARCHAR(64) NOT NULL UNIQUE,
          run_id VARCHAR(64) NOT NULL,
          stage VARCHAR(64) NOT NULL,
          model VARCHAR(128) NOT NULL,
          request_json LONGTEXT NOT NULL,
          response_json LONGTEXT,
          error LONGTEXT,
          latency_ms BIGINT,
          created_at DATETIME NOT NULL,
          INDEX idx_agent_llm_logs_run (run_id)
        )
        """,
    ]
    with engine.begin() as conn:
        for statement in statements:
            conn.execute(text(statement))


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def create_or_touch_conversation(engine: Engine, conversation_id: str | None, user: dict[str, Any], source: str, title: str) -> str:
    now = datetime.now()
    conv_id = conversation_id or new_id("conv")
    with engine.begin() as conn:
        row = conn.execute(
            text("SELECT conversation_id FROM agent_conversations WHERE conversation_id=:conversation_id AND user_id=:user_id LIMIT 1"),
            {"conversation_id": conv_id, "user_id": user["id"]},
        ).first()
        if row:
            conn.execute(text("UPDATE agent_conversations SET updated_at=:updated_at WHERE conversation_id=:conversation_id"), {"updated_at": now, "conversation_id": conv_id})
            return conv_id
        if conversation_id:
            raise PermissionError("conversation not found")
        conn.execute(
            text(
                """
                INSERT INTO agent_conversations (conversation_id, user_id, username, source, title, created_at, updated_at)
                VALUES (:conversation_id, :user_id, :username, :source, :title, :created_at, :updated_at)
                """
            ),
            {
                "conversation_id": conv_id,
                "user_id": user["id"],
                "username": user["username"],
                "source": source,
                "title": title[:255] or "新对话",
                "created_at": now,
                "updated_at": now,
            },
        )
    return conv_id


def add_message(engine: Engine, conversation_id: str, user: dict[str, Any], role: str, content: str) -> str:
    message_id = new_id("msg")
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO agent_messages (message_id, conversation_id, user_id, username, role, content, created_at)
                VALUES (:message_id, :conversation_id, :user_id, :username, :role, :content, :created_at)
                """
            ),
            {
                "message_id": message_id,
                "conversation_id": conversation_id,
                "user_id": user["id"],
                "username": user["username"],
                "role": role,
                "content": content,
                "created_at": datetime.now(),
            },
        )
        conn.execute(text("UPDATE agent_conversations SET updated_at=:updated_at WHERE conversation_id=:conversation_id"), {"updated_at": datetime.now(), "conversation_id": conversation_id})
    return message_id


def recent_messages(engine: Engine, conversation_id: str, user_id: int, limit: int = 6) -> list[dict[str, Any]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT message_id, role, content, created_at
                FROM agent_messages
                WHERE conversation_id=:conversation_id AND user_id=:user_id
                ORDER BY created_at DESC, id DESC
                LIMIT :limit
                """
            ),
            {"conversation_id": conversation_id, "user_id": user_id, "limit": limit},
        ).mappings().all()
    return [dict(row) for row in reversed(rows)]


def list_conversations(engine: Engine, user_id: int) -> list[dict[str, Any]]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                """
                SELECT conversation_id, source, title, created_at, updated_at
                FROM agent_conversations
                WHERE user_id=:user_id
                ORDER BY updated_at DESC
                LIMIT 30
                """
            ),
            {"user_id": user_id},
        ).mappings().all()
    return [dict(row) for row in rows]


def list_messages(engine: Engine, conversation_id: str, user_id: int) -> list[dict[str, Any]]:
    with engine.connect() as conn:
        owner = conn.execute(text("SELECT 1 FROM agent_conversations WHERE conversation_id=:conversation_id AND user_id=:user_id"), {"conversation_id": conversation_id, "user_id": user_id}).first()
        if not owner:
            raise PermissionError("conversation not found")
        rows = conn.execute(
            text(
                """
                SELECT m.message_id, m.role, m.content, m.created_at, r.run_id, r.query_summary
                FROM agent_messages m
                LEFT JOIN agent_runs r ON r.assistant_message_id = m.message_id
                WHERE m.conversation_id=:conversation_id AND m.user_id=:user_id
                ORDER BY m.created_at ASC, m.id ASC
                """
            ),
            {"conversation_id": conversation_id, "user_id": user_id},
        ).mappings().all()
    return [dict(row) for row in rows]


def create_run(engine: Engine, conversation_id: str, user_message_id: str, prompt: str) -> str:
    run_id = new_id("run")
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO agent_runs (run_id, conversation_id, user_message_id, status, prompt, started_at)
                VALUES (:run_id, :conversation_id, :user_message_id, 'running', :prompt, :started_at)
                """
            ),
            {"run_id": run_id, "conversation_id": conversation_id, "user_message_id": user_message_id, "prompt": prompt, "started_at": datetime.now()},
        )
    return run_id


def finish_run(engine: Engine, run_id: str, status: str, **values: Any) -> None:
    values = {**values, "run_id": run_id, "status": status, "finished_at": datetime.now()}
    assignments = ["status=:status", "finished_at=:finished_at"]
    for key in ["assistant_message_id", "generated_sql", "query_summary", "sources_json", "error", "latency_ms"]:
        if key in values:
            assignments.append(f"{key}=:{key}")
    with engine.begin() as conn:
        conn.execute(text(f"UPDATE agent_runs SET {', '.join(assignments)} WHERE run_id=:run_id"), values)


def log_llm(engine: Engine, run_id: str, stage: str, model: str, request_json: dict[str, Any], response_json: dict[str, Any] | None, error: str = "", latency_ms: int | None = None) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO agent_llm_logs (log_id, run_id, stage, model, request_json, response_json, error, latency_ms, created_at)
                VALUES (:log_id, :run_id, :stage, :model, :request_json, :response_json, :error, :latency_ms, :created_at)
                """
            ),
            {
                "log_id": new_id("llm"),
                "run_id": run_id,
                "stage": stage,
                "model": model,
                "request_json": json.dumps(request_json, ensure_ascii=False),
                "response_json": json.dumps(response_json, ensure_ascii=False) if response_json is not None else "",
                "error": error,
                "latency_ms": latency_ms,
                "created_at": datetime.now(),
            },
        )
