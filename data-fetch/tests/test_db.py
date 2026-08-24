from sqlalchemy import create_engine, text

from app.db import insert_record_if_absent


def test_insert_record_if_absent_is_idempotent() -> None:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE snapshots (source TEXT, symbol TEXT, fetched_at TEXT, price TEXT)"))

    row = {
        "source": "akshare",
        "symbol": "XAU",
        "fetched_at": "2026-08-24T10:00:00",
        "price": "100",
    }

    assert insert_record_if_absent(engine, "snapshots", row, ["source", "symbol", "fetched_at"]) is True
    assert insert_record_if_absent(engine, "snapshots", row, ["source", "symbol", "fetched_at"]) is False

    with engine.connect() as conn:
        count = conn.execute(text("SELECT COUNT(*) FROM snapshots")).scalar_one()

    assert count == 1
