import pytest
from sqlalchemy import create_engine, text

from app.db import clean_sql, execute_readonly_sql, validate_readonly_sql


def test_clean_sql_removes_markdown_fence_and_trailing_semicolon() -> None:
    assert clean_sql("```sql\nSELECT * FROM users;\n```") == "SELECT * FROM users"


@pytest.mark.parametrize(
    "sql",
    [
        "UPDATE users SET username='x'",
        "DELETE FROM users",
        "SELECT * FROM users; SELECT * FROM posts",
        "",
    ],
)
def test_validate_readonly_sql_rejects_unsafe_statements(sql: str) -> None:
    with pytest.raises(ValueError):
        validate_readonly_sql(sql, {"users"})


def test_validate_readonly_sql_rejects_forbidden_tables() -> None:
    with pytest.raises(ValueError, match="forbidden tables"):
        validate_readonly_sql("SELECT * FROM agent_llm_logs", {"ai_daily_snapshots"})


def test_execute_readonly_sql_wraps_select_with_limit() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE ai_daily_snapshots (id INTEGER PRIMARY KEY, title TEXT)"))
        conn.execute(text("INSERT INTO ai_daily_snapshots (title) VALUES ('a'), ('b'), ('c')"))

    result = execute_readonly_sql(engine, "SELECT id, title FROM ai_daily_snapshots ORDER BY id", limit=2)

    assert result.columns == ["id", "title"]
    assert [row["title"] for row in result.rows] == ["a", "b"]
