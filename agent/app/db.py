from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine

from .config import settings


@dataclass
class TableSample:
    table: str
    columns: list[str]
    rows: list[dict[str, Any]]


@dataclass
class QueryResult:
    sql: str
    columns: list[str]
    rows: list[dict[str, Any]]


blocked_sql_tokens = {
    "alter",
    "create",
    "delete",
    "drop",
    "grant",
    "insert",
    "load",
    "replace",
    "revoke",
    "set",
    "truncate",
    "update",
}


def build_engine() -> Engine:
    return create_engine(settings.db_url, pool_pre_ping=True)


def list_tables(engine: Engine) -> list[str]:
    inspector = inspect(engine)
    tables = inspector.get_table_names()
    if settings.allowed_table_set:
        tables = [name for name in tables if name in settings.allowed_table_set]
    return sorted(tables)


def table_fingerprint(engine: Engine, table_name: str) -> str:
    inspector = inspect(engine)
    columns = inspector.get_columns(table_name)
    column_names = [col["name"] for col in columns]
    return f"{table_name} " + " ".join(column_names)


def schema_summary(engine: Engine, tables: list[str] | None = None) -> str:
    selected = tables or list_tables(engine)
    lines: list[str] = []
    inspector = inspect(engine)
    for table in selected[:8]:
        try:
            columns = inspector.get_columns(table)
        except Exception:
            continue
        column_parts = [f"{col['name']}:{col.get('type')}" for col in columns]
        lines.append(f"{table}({', '.join(column_parts)})")
    return "\n".join(lines)


def describe_table(engine: Engine, table_name: str) -> tuple[list[str], list[dict[str, Any]]]:
    inspector = inspect(engine)
    columns = [col["name"] for col in inspector.get_columns(table_name)]
    return columns, sample_table_rows(engine, table_name, settings.sample_row_limit)


def sample_table_rows(engine: Engine, table_name: str, limit: int) -> list[dict[str, Any]]:
    safe_limit = max(1, min(limit, 20))
    with engine.connect() as conn:
        result = conn.execute(text(f"SELECT * FROM `{table_name}` LIMIT {safe_limit}"))
        return [dict(row._mapping) for row in result.fetchall()]


def collect_scope(engine: Engine, scope: str | None = None) -> list[TableSample]:
    tables = [scope] if scope else list_tables(engine)[:3]
    samples: list[TableSample] = []
    for table in tables[:5]:
        try:
            columns, rows = describe_table(engine, table)
        except Exception:
            continue
        samples.append(TableSample(table=table, columns=columns, rows=rows))
    return samples


def clean_sql(raw_sql: str) -> str:
    sql = raw_sql.strip()
    if sql.startswith("```"):
        sql = re.sub(r"^```(?:sql)?", "", sql, flags=re.IGNORECASE).strip()
        sql = re.sub(r"```$", "", sql).strip()
    return sql.rstrip(";").strip()


def validate_readonly_sql(sql: str, allowed_tables: set[str]) -> None:
    normalized = clean_sql(sql)
    lowered = normalized.lower()
    if not normalized:
        raise ValueError("SQL is empty")
    if ";" in normalized:
        raise ValueError("Only one SQL statement is allowed")
    if not lowered.startswith(("select ", "with ", "show ", "describe ", "desc ", "explain ")):
        raise ValueError("Only readonly SQL is allowed")
    tokens = set(re.findall(r"[a-z_]+", lowered))
    blocked = sorted(tokens.intersection(blocked_sql_tokens))
    if blocked:
        raise ValueError(f"Blocked SQL token: {', '.join(blocked)}")

    if allowed_tables:
        referenced_tables = set(re.findall(r"(?:from|join)\s+`?([a-zA-Z0-9_]+)`?", normalized, flags=re.IGNORECASE))
        forbidden = sorted(table for table in referenced_tables if table not in allowed_tables)
        if forbidden:
            raise ValueError(f"SQL references forbidden tables: {', '.join(forbidden)}")


def execute_readonly_sql(engine: Engine, raw_sql: str, limit: int = 50) -> QueryResult:
    sql = clean_sql(raw_sql)
    validate_readonly_sql(sql, settings.allowed_table_set)
    safe_limit = max(1, min(limit, 100))
    lowered = sql.lower()
    if lowered.startswith(("select ", "with ")):
        run_sql = f"SELECT * FROM ({sql}) AS agent_result LIMIT {safe_limit}"
    else:
        run_sql = sql
    with engine.connect() as conn:
        result = conn.execute(text(run_sql))
        rows = [dict(row._mapping) for row in result.fetchall()]
        columns = list(result.keys())
    return QueryResult(sql=sql, columns=columns, rows=rows)
