from sqlalchemy import create_engine, text

from app.db import insert_records_if_absent


def _make_engine() -> object:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE snapshots ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "source TEXT, symbol TEXT, fetched_at TEXT, price TEXT, "
                "UNIQUE(source, symbol, fetched_at))"
            )
        )
    return engine


def test_insert_records_if_absent_is_idempotent() -> None:
    engine = _make_engine()
    row = {
        "source": "akshare",
        "symbol": "XAU",
        "fetched_at": "2026-08-24T10:00:00",
        "price": "100",
    }

    assert insert_records_if_absent(engine, "snapshots", [row], ["source", "symbol", "fetched_at"]) == 1
    assert insert_records_if_absent(engine, "snapshots", [row], ["source", "symbol", "fetched_at"]) == 0

    with engine.connect() as conn:
        count = conn.execute(text("SELECT COUNT(*) FROM snapshots")).scalar_one()

    assert count == 1


def test_insert_records_if_absent_skips_only_existing_rows() -> None:
    engine = _make_engine()
    existing = {"source": "akshare", "symbol": "XAU", "fetched_at": "2026-08-24T10:00:00", "price": "100"}
    fresh = {"source": "akshare", "symbol": "XAU", "fetched_at": "2026-08-25T10:00:00", "price": "101"}

    assert insert_records_if_absent(engine, "snapshots", [existing], ["source", "symbol", "fetched_at"]) == 1
    assert insert_records_if_absent(engine, "snapshots", [existing, fresh], ["source", "symbol", "fetched_at"]) == 1

    with engine.connect() as conn:
        count = conn.execute(text("SELECT COUNT(*) FROM snapshots")).scalar_one()

    assert count == 2


def test_insert_records_if_absent_handles_empty_input() -> None:
    engine = _make_engine()

    assert insert_records_if_absent(engine, "snapshots", [], ["source", "symbol", "fetched_at"]) == 0
