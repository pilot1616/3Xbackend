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


def insert_record_if_absent(engine: Engine, table: str, values: Mapping[str, Any], unique_keys: list[str]) -> bool:
    where = " AND ".join(f"`{key}` = :{key}" for key in unique_keys)
    exists_sql = text(f"SELECT 1 FROM `{table}` WHERE {where} LIMIT 1")
    keys = list(values.keys())
    columns = ", ".join(f"`{key}`" for key in keys)
    placeholders = ", ".join(f":{key}" for key in keys)
    insert_sql = text(f"INSERT INTO `{table}` ({columns}) VALUES ({placeholders})")
    params = dict(values)
    with engine.begin() as conn:
        exists = conn.execute(exists_sql, {key: params[key] for key in unique_keys}).first()
        if exists:
            return False
        conn.execute(insert_sql, params)
    return True
