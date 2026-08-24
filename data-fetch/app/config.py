from __future__ import annotations

from dataclasses import dataclass
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

    @property
    def db_url(self) -> str:
        return (
            f"mysql+pymysql://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_schema}?charset=utf8mb4"
        )


settings = Settings()
