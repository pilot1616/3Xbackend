from __future__ import annotations

from collections.abc import Mapping
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

