from __future__ import annotations

from datetime import datetime
import sys
import threading
import time

from fastapi import FastAPI

from .akshare_client import fetch_precious_metal_history, fetch_precious_metals, fetch_tech_market_history, fetch_tech_markets
from .config import settings
from .db import build_engine, insert_record, insert_record_if_absent


sync_lock = threading.Lock()
app = FastAPI(title="3X Data Fetch", version="0.1.0")


def sync_once_result() -> dict[str, object]:
    engine = build_engine()
    fetched_at = datetime.now()

    metal_records, metal_failures = fetch_precious_metals(fetched_at)
    tech_records, tech_failures = fetch_tech_markets(fetched_at)

    for record in metal_records:
        insert_record(engine, "precious_metal_snapshots", record)
    for record in tech_records:
        insert_record(engine, "tech_market_snapshots", record)

    failures = [*metal_failures, *tech_failures]
    return {
        "mode": "latest",
        "preciousMetals": len(metal_records),
        "techMarkets": len(tech_records),
        "failures": failures,
        "fetchedAt": fetched_at.isoformat(),
    }


def sync_once() -> int:
    result = sync_once_result()
    print(
        "data fetch finished: "
        f"precious_metals={result['preciousMetals']}, tech_markets={result['techMarkets']}, "
        f"failures={len(result['failures'])}"
    )
    for failure in result["failures"]:
        print(f"failure: {failure}")
    return 0 if int(result["preciousMetals"]) or int(result["techMarkets"]) else 1


def sync_history_result() -> dict[str, object]:
    engine = build_engine()
    fetched_at = datetime.now()

    metal_records, metal_failures = fetch_precious_metal_history(settings.history_start_year)
    tech_records, tech_failures = fetch_tech_market_history(settings.history_start_year)

    inserted_metals = 0
    inserted_tech = 0
    for record in metal_records:
        if insert_record_if_absent(engine, "precious_metal_snapshots", record, ["source", "symbol", "fetched_at"]):
            inserted_metals += 1
    for record in tech_records:
        if insert_record_if_absent(engine, "tech_market_snapshots", record, ["source", "symbol", "fetched_at"]):
            inserted_tech += 1

    failures = [*metal_failures, *tech_failures]
    return {
        "mode": "history",
        "historyStartYear": settings.history_start_year,
        "preciousMetals": inserted_metals,
        "preciousMetalsTotal": len(metal_records),
        "techMarkets": inserted_tech,
        "techMarketsTotal": len(tech_records),
        "failures": failures,
        "fetchedAt": fetched_at.isoformat(),
    }


def sync_history() -> int:
    result = sync_history_result()
    print(
        "historical data fetch finished: "
        f"precious_metals={result['preciousMetals']}/{result['preciousMetalsTotal']}, "
        f"tech_markets={result['techMarkets']}/{result['techMarketsTotal']}, "
        f"failures={len(result['failures'])}, "
        f"start_year={settings.history_start_year}"
    )
    for failure in result["failures"]:
        print(f"failure: {failure}")

    return 0 if int(result["preciousMetals"]) or int(result["techMarkets"]) or int(result["preciousMetalsTotal"]) or int(result["techMarketsTotal"]) else 1


def sync_loop() -> None:
    while True:
        with sync_lock:
            sync_once()
        time.sleep(max(60, settings.interval_seconds))


def start_loop_thread() -> None:
    if not settings.run_loop:
        return
    thread = threading.Thread(target=sync_loop, daemon=True)
    thread.start()


@app.on_event("startup")
def on_startup() -> None:
    start_loop_thread()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/sync/latest")
def sync_latest_api() -> dict[str, object]:
    with sync_lock:
        return sync_once_result()


@app.post("/sync/history")
def sync_history_api() -> dict[str, object]:
    with sync_lock:
        return sync_history_result()


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "once"
    if mode == "history":
        raise SystemExit(sync_history())
    if mode == "loop":
        sync_loop()
        return
    raise SystemExit(sync_once())


if __name__ == "__main__":
    main()
