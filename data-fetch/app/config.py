from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import json
import os

from dotenv import load_dotenv


load_dotenv()


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _env_int(name: str, default: int) -> int:
    try:
        return int(_env(name, str(default)))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    db_user: str = _env("DATABASE_MYSQL_USER", "root")
    db_password: str = _env("DATABASE_MYSQL_PASSWORD", "root")
    db_host: str = _env("DATABASE_MYSQL_ADDRESS", "127.0.0.1")
    db_port: int = _env_int("DATABASE_MYSQL_PORT", 3306)
    db_schema: str = _env("DATABASE_MYSQL_SCHEMA", "3X")
    interval_seconds: int = _env_int("DATA_FETCH_INTERVAL_SECONDS", 3600)
    history_start_year: int = _env_int("DATA_FETCH_HISTORY_START_YEAR", 2018)
    host: str = _env("DATA_FETCH_HOST", "0.0.0.0")
    port: int = _env_int("DATA_FETCH_PORT", 8020)
    run_loop: bool = _env("DATA_FETCH_RUN_LOOP", "true").lower() in {"1", "true", "yes", "on"}
    config_path: str = _env("DATA_FETCH_CONFIG_PATH", str(Path(__file__).resolve().parents[2] / "config" / "market_targets.json"))

    @property
    def db_url(self) -> str:
        return (
            f"mysql+pymysql://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_schema}?charset=utf8mb4"
        )


@dataclass(frozen=True)
class MarketTarget:
    symbol: str
    name: str
    source_symbol: str
    category: str = ""


def _load_json_settings(path: str) -> dict[str, object]:
    config_file = Path(path)
    if not config_file.is_file():
        return {}
    with config_file.open("r", encoding="utf-8") as handle:
        data = json.load(handle) or {}
    return data if isinstance(data, dict) else {}


def load_market_targets() -> tuple[list[MarketTarget], list[MarketTarget]]:
    data = _load_json_settings(settings.config_path)
    markets = data.get("markets", {})
    if not isinstance(markets, dict):
        markets = {}

    def build_targets(raw_items: object) -> list[MarketTarget]:
        if not isinstance(raw_items, list):
            return []
        targets: list[MarketTarget] = []
        for item in raw_items:
            if not isinstance(item, dict):
                continue
            symbol = str(item.get("symbol", "")).strip()
            name = str(item.get("name", "")).strip()
            source_symbol = str(item.get("source_symbol", "")).strip()
            category = str(item.get("category", "")).strip()
            if not symbol or not name or not source_symbol:
                continue
            targets.append(MarketTarget(symbol=symbol, name=name, source_symbol=source_symbol, category=category))
        return targets

    return build_targets(markets.get("precious_metals")), build_targets(markets.get("tech_markets"))


settings = Settings()
