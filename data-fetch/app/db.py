from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from .config import settings


def build_engine() -> Engine:
    return create_engine(settings.db_url, pool_pre_ping=True)


def insert_record(engine: Engine, table: str, values: Mapping[str, Any]) -> None:
    keys = list(values.keys())
    columns = ", ".join(f"`{key}`" for key in keys)
    placeholders = ", ".join(f":{key}" for key in keys)
    sql = text(f"INSERT INTO `{table}` ({columns}) VALUES ({placeholders})")
    with engine.begin() as conn:
        conn.execute(sql, dict(values))


def _skip_duplicate_clause(dialect_name: str) -> str:
    if dialect_name == "mysql":
        return "ON DUPLICATE KEY UPDATE id = id"
    if dialect_name in {"sqlite", "postgresql"}:
        return "ON CONFLICT DO NOTHING"
    raise ValueError(f"unsupported dialect for batch insert: {dialect_name}")


def _upsert_clause(dialect_name: str, update_columns: Sequence[str]) -> str:
    """冲突时覆盖更新指定列（MySQL 用 VALUES() 引用新值，PG/SQLite 用 excluded）。"""
    if dialect_name == "mysql":
        assignments = ", ".join(f"`{col}` = VALUES(`{col}`)" for col in update_columns)
        return f"ON DUPLICATE KEY UPDATE {assignments}"
    if dialect_name in {"sqlite", "postgresql"}:
        assignments = ", ".join(f"`{col}` = excluded.`{col}`" for col in update_columns)
        return f"ON CONFLICT DO UPDATE SET {assignments}"
    raise ValueError(f"unsupported dialect for upsert: {dialect_name}")


def upsert_records(
    engine: Engine,
    table: str,
    records: Sequence[Mapping[str, Any]],
    update_columns: Sequence[str],
    batch_size: int = 100,
) -> int:
    """冲突时覆盖更新（对齐 Go 端 ai_daily_snapshots 的 source+slug upsert 语义）。"""
    if not records:
        return 0
    keys = list(records[0].keys())
    columns = ", ".join(f"`{key}`" for key in keys)
    placeholders = ", ".join(f":{key}" for key in keys)
    dialect = engine.dialect.name
    sql = text(
        f"INSERT INTO `{table}` ({columns}) VALUES ({placeholders}) "
        f"{_upsert_clause(dialect, update_columns)}"
    )
    affected = 0
    for start in range(0, len(records), batch_size):
        batch = [dict(record) for record in records[start : start + batch_size]]
        with engine.begin() as conn:
            result = conn.execute(sql, batch)
            affected += int(result.rowcount or 0)
    return affected


def insert_records_if_absent(
    engine: Engine,
    table: str,
    records: Sequence[Mapping[str, Any]],
    unique_keys: list[str],
    batch_size: int = 500,
) -> int:
    """Insert rows in batches, skipping rows whose unique keys already exist.

    Relies on a database-level unique index over unique_keys plus a no-op
    conflict clause instead of per-row SELECT probing; the returned count
    reflects rows actually inserted.
    """
    if not records:
        return 0

    keys = list(records[0].keys())
    columns = ", ".join(f"`{key}`" for key in keys)
    placeholders = ", ".join(f":{key}" for key in keys)
    dialect = engine.dialect.name
    sql = text(
        f"INSERT INTO `{table}` ({columns}) VALUES ({placeholders}) "
        f"{_skip_duplicate_clause(dialect)}"
    )
    del unique_keys  # kept in the signature for callers; the unique index lives in the DB

    inserted = 0
    for start in range(0, len(records), batch_size):
        batch = [dict(record) for record in records[start : start + batch_size]]
        with engine.begin() as conn:
            result = conn.execute(sql, batch)
            inserted += int(result.rowcount or 0)
    return inserted
