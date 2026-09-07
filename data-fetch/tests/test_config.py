from pathlib import Path

from app.config import Settings, load_market_targets, settings


def test_settings_builds_mysql_url() -> None:
    settings = Settings(
        db_user="u",
        db_password="p",
        db_host="db",
        db_port=3307,
        db_schema="schema",
    )

    assert settings.db_url == "mysql+pymysql://u:p@db:3307/schema?charset=utf8mb4"


def test_load_market_targets(tmp_path: Path) -> None:
    config_path = tmp_path / "market_targets.json"
    config_path.write_text(
        """
        {
          "precious_metals": [{"symbol": "XAU", "name": "Gold", "source_symbol": "GC"}],
          "tech_markets": [{"symbol": "NDX", "name": "Nasdaq 100", "source_symbol": ".NDX", "category": "index"}]
        }
        """.strip(),
        encoding="utf-8",
    )

    original_path = settings.config_path
    try:
        object.__setattr__(settings, "config_path", str(config_path))
        metals, tech = load_market_targets()
    finally:
        object.__setattr__(settings, "config_path", original_path)

    assert [item.symbol for item in metals] == ["XAU"]
    assert [item.symbol for item in tech] == ["NDX"]
