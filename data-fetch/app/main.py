from __future__ import annotations

from datetime import datetime
import sys
import time

from .akshare_client import fetch_precious_metal_history, fetch_precious_metals, fetch_tech_market_history, fetch_tech_markets
from .config import settings
from .db import build_engine, insert_record, insert_record_if_absent


def sync_once() -> int:
    engine = build_engine()
    fetched_at = datetime.now()

    metal_records, metal_failures = fetch_precious_metals(fetched_at)
    tech_records, tech_failures = fetch_tech_markets(fetched_at)

    for record in metal_records:
        insert_record(engine, "precious_metal_snapshots", record)
    for record in tech_records:
        insert_record(engine, "tech_market_snapshots", record)

    print(
        "data fetch finished: "
        f"precious_metals={len(metal_records)}, tech_markets={len(tech_records)}, "
        f"failures={len(metal_failures) + len(tech_failures)}"
    )
    for failure in [*metal_failures, *tech_failures]:
        print(f"failure: {failure}")

    return 0 if metal_records or tech_records else 1


def sync_history() -> int:
    engine = build_engine()

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

    print(
        "historical data fetch finished: "
        f"precious_metals={inserted_metals}/{len(metal_records)}, "
        f"tech_markets={inserted_tech}/{len(tech_records)}, "
        f"failures={len(metal_failures) + len(tech_failures)}, "
        f"start_year={settings.history_start_year}"
    )
    for failure in [*metal_failures, *tech_failures]:
        print(f"failure: {failure}")

    return 0 if inserted_metals or inserted_tech or metal_records or tech_records else 1


def sync_loop() -> None:
    while True:
        sync_once()
        time.sleep(max(60, settings.interval_seconds))


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
