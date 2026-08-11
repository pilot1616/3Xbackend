from dataclasses import dataclass
import os


def _env(name: str, default: str = "") -> str:
    value = os.getenv(name, default)
    return value.strip()


def _env_int(name: str, default: int) -> int:
    raw = _env(name, str(default))
    try:
        return int(raw)
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    host: str = _env("AGENT_HOST", "0.0.0.0")
    port: int = _env_int("AGENT_PORT", 8010)
    db_user: str = _env("DATABASE_MYSQL_USER", "root")
    db_password: str = _env("DATABASE_MYSQL_PASSWORD", "root")
    db_host: str = _env("DATABASE_MYSQL_ADDRESS", "127.0.0.1")
    db_port: int = _env_int("DATABASE_MYSQL_PORT", 3306)
    db_schema: str = _env("DATABASE_MYSQL_SCHEMA", "3X")
    llm_base_url: str = _env("LLM_BASE_URL", "https://ai-api-gateway.app.baizhi.cloud/api/openai")
    llm_api_key: str = _env("LLM_API_KEY", "")
    llm_model: str = _env("LLM_MODEL", "dev/gpt-5.5")
    llm_timeout_seconds: int = _env_int("LLM_TIMEOUT_SECONDS", 60)
    allowed_tables: str = _env("AGENT_ALLOWED_TABLES", "")
    sample_row_limit: int = _env_int("AGENT_SAMPLE_ROW_LIMIT", 5)

    @property
    def allowed_table_set(self) -> set[str]:
        if not self.allowed_tables:
            return set()
        return {item.strip() for item in self.allowed_tables.split(",") if item.strip()}

    @property
    def db_url(self) -> str:
        return (
            f"mysql+pymysql://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_schema}?charset=utf8mb4"
        )


settings = Settings()

