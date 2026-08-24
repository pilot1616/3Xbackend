from app.config import Settings


def test_settings_builds_mysql_url() -> None:
    settings = Settings(
        db_user="u",
        db_password="p",
        db_host="db",
        db_port=3307,
        db_schema="schema",
    )

    assert settings.db_url == "mysql+pymysql://u:p@db:3307/schema?charset=utf8mb4"
