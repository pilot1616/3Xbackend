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
