from dataclasses import dataclass
import os


# 分析与聊天默认只需要这三张数据表；需要扩表时显式配置 AGENT_ALLOWED_TABLES。
DEFAULT_ALLOWED_TABLES = ("ai_daily_snapshots", "precious_metal_snapshots", "tech_market_snapshots")


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
    llm_timeout_seconds: int = _env_int("LLM_TIMEOUT_SECONDS", 35)
    allowed_tables: str = _env("AGENT_ALLOWED_TABLES", "")
    sample_row_limit: int = _env_int("AGENT_SAMPLE_ROW_LIMIT", 5)
    internal_token: str = _env("AGENT_INTERNAL_TOKEN", "")
    cors_allowed_origins: str = _env("CORS_ALLOWED_ORIGINS", "")

    @property
    def allowed_table_set(self) -> set[str]:
        # 空配置不是"允许所有表"，而是回落到分析业务实际需要的三张数据表，
        # 防止忘配 AGENT_ALLOWED_TABLES 时把 users 等业务表暴露给 LLM 生成查询。
        if not self.allowed_tables:
            return set(DEFAULT_ALLOWED_TABLES)
        return {item.strip() for item in self.allowed_tables.split(",") if item.strip()}

    @property
    def cors_origin_list(self) -> list[str]:
        if not self.cors_allowed_origins:
            return []
        return [item.strip() for item in self.cors_allowed_origins.split(",") if item.strip()]

    @property
    def db_url(self) -> str:
        return (
            f"mysql+pymysql://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_schema}?charset=utf8mb4"
        )


settings = Settings()

