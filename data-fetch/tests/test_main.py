from fastapi.testclient import TestClient

from app import main


def test_health() -> None:
    client = TestClient(main.app)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_sync_latest_uses_fetchers_and_db(monkeypatch) -> None:
    inserted: list[tuple[str, dict[str, object]]] = []

    monkeypatch.setattr(main, "build_engine", lambda: object())
    monkeypatch.setattr(
        main,
        "fetch_precious_metals",
        lambda fetched_at: ([{"symbol": "XAU", "price": "100", "fetched_at": fetched_at}], []),
    )
    monkeypatch.setattr(
        main,
        "fetch_tech_markets",
        lambda fetched_at: ([{"symbol": "NDX", "price": "200", "fetched_at": fetched_at}], ["QQQ: failed"]),
    )
    monkeypatch.setattr(main, "insert_record", lambda engine, table, record: inserted.append((table, record)))

    result = main.sync_once_result()

    assert result["mode"] == "latest"
    assert result["preciousMetals"] == 1
    assert result["techMarkets"] == 1
    assert result["failures"] == ["QQQ: failed"]
    assert [item[0] for item in inserted] == ["precious_metal_snapshots", "tech_market_snapshots"]


def test_sync_history_is_idempotent(monkeypatch) -> None:
    calls: list[str] = []

    monkeypatch.setattr(main, "build_engine", lambda: object())
    monkeypatch.setattr(
        main,
        "fetch_precious_metal_history",
        lambda start_year: ([{"source": "akshare", "symbol": "XAU", "fetched_at": "2026-08-24"}], []),
    )
    monkeypatch.setattr(
        main,
        "fetch_tech_market_history",
        lambda start_year: ([{"source": "akshare", "symbol": "NDX", "fetched_at": "2026-08-24"}], []),
    )

    def insert_if_absent(engine, table, record, unique_keys):
        calls.append(table)
        return table == "precious_metal_snapshots"

    monkeypatch.setattr(main, "insert_record_if_absent", insert_if_absent)

    result = main.sync_history_result()

    assert result["mode"] == "history"
    assert result["preciousMetals"] == 1
    assert result["techMarkets"] == 0
    assert calls == ["precious_metal_snapshots", "tech_market_snapshots"]
