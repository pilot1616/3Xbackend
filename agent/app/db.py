from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine

from .config import settings


@dataclass
class TableSample:
    table: str
    columns: list[str]
    rows: list[dict[str, Any]]


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
