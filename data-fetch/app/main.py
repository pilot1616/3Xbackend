from __future__ import annotations

from datetime import datetime
import sys
import threading
import time

from fastapi import FastAPI, HTTPException

from .ai_daily_client import AIDailyClient, DEFAULT_MAX_ENTRIES
from .akshare_client import (
    fetch_precious_metal_history,
    fetch_precious_metals,
    fetch_tech_market_history,
    fetch_tech_markets,
)
from .config import settings
from .db import build_engine, insert_record, insert_records_if_absent, upsert_records
from .interrupt import Interrupted, global_interrupt, install_signal_handlers, restore_signal_handlers

AI_DAILY_UPDATE_COLUMNS = (
    "title", "source_url", "published_date", "summary", "read_time",
    "content", "sections_json", "links_json", "meta_json", "fetched_at",
)

sync_lock = threading.Lock()
app = FastAPI(title="3X Data Fetch", version="0.2.0")


class InterruptibleSync:
    """一次可中断的同步任务：汇总各数据源结果，检查点之间软中断。"""

    def __init__(self, interrupt=global_interrupt) -> None:
        self.interrupt = interrupt
        self.stages: list[str] = []
        self.interrupted_at: str = ""

    def _checkpoint(self, where: str) -> None:
        self.interrupt.checkpoint(where)

    def _run_stage(self, name: str, stage_fn) -> dict[str, object]:
        """执行一个数据源阶段；阶段边界与阶段内部都设检查点。"""
        try:
            self._checkpoint(name)
            result = stage_fn()
            self.stages.append(f"{name}:ok")
            return result
        except Interrupted as exc:
            self.interrupted_at = exc.where
            self.stages.append(f"{name}:interrupted")
            raise

    def run_latest(self) -> dict[str, object]:
        engine = build_engine()
        fetched_at = datetime.now()
        result: dict[str, object] = {"mode": "latest", "fetchedAt": fetched_at.isoformat()}

        try:
            metals = self._run_stage(
                "precious_metals", lambda: _sync_metals(engine, fetched_at)
            )
        except Interrupted:
            metals = {"inserted": 0, "failures": ["interrupted"]}
        result["preciousMetals"] = metals["inserted"]
        result["failures"] = list(metals["failures"])

        try:
            tech = self._run_stage("tech_markets", lambda: _sync_tech(engine, fetched_at))
        except Interrupted:
            tech = {"inserted": 0, "failures": ["interrupted"]}
        result["techMarkets"] = tech["inserted"]
        result["failures"] = [*result["failures"], *tech["failures"]]  # type: ignore[list-item]

        try:
            daily = self._run_stage("ai_daily", lambda: _sync_ai_daily(engine))
        except Interrupted:
            daily = {"inserted": 0, "failures": ["interrupted"]}
        result["aiDailies"] = daily["inserted"]
        result["failures"] = [*result["failures"], *daily["failures"]]  # type: ignore[list-item]

        result["stages"] = list(self.stages)
        result["interrupted"] = bool(self.interrupted_at)
        result["interruptedAt"] = self.interrupted_at
        return result

    def run_history(self) -> dict[str, object]:
        engine = build_engine()
        fetched_at = datetime.now()
        result: dict[str, object] = {
            "mode": "history",
            "historyStartYear": settings.history_start_year,
            "fetchedAt": fetched_at.isoformat(),
        }

        try:
            metals = self._run_stage(
                "precious_metals_history",
                lambda: _sync_metals_history(engine, fetched_at),
            )
        except Interrupted:
            metals = {"inserted": 0, "total": 0, "failures": ["interrupted"]}
        result["preciousMetals"] = metals["inserted"]
        result["preciousMetalsTotal"] = metals["total"]
        result["failures"] = list(metals["failures"])

        try:
            tech = self._run_stage(
                "tech_markets_history", lambda: _sync_tech_history(engine, fetched_at)
            )
        except Interrupted:
            tech = {"inserted": 0, "total": 0, "failures": ["interrupted"]}
        result["techMarkets"] = tech["inserted"]
        result["techMarketsTotal"] = tech["total"]
        result["failures"] = [*result["failures"], *tech["failures"]]  # type: ignore[list-item]

        result["stages"] = list(self.stages)
        result["interrupted"] = bool(self.interrupted_at)
        result["interruptedAt"] = self.interrupted_at
        return result


# ---- 数据源阶段（保持与旧版 fetch_* 函数签名兼容，便于测试替换）----


def _sync_metals(engine, fetched_at: datetime) -> dict[str, object]:
    records, failures = fetch_precious_metals(fetched_at)
    inserted = insert_records_if_absent(engine, "precious_metal_snapshots", records, ["source", "symbol", "fetched_at"])
    return {"inserted": inserted, "failures": failures}


def _sync_tech(engine, fetched_at: datetime) -> dict[str, object]:
    records, failures = fetch_tech_markets(fetched_at)
    inserted = insert_records_if_absent(engine, "tech_market_snapshots", records, ["source", "symbol", "fetched_at"])
    return {"inserted": inserted, "failures": failures}


def _sync_metals_history(engine, fetched_at: datetime) -> dict[str, object]:
    records, failures = fetch_precious_metal_history(settings.history_start_year)
    inserted = insert_records_if_absent(engine, "precious_metal_snapshots", records, ["source", "symbol", "fetched_at"])
    return {"inserted": inserted, "total": len(records), "failures": failures}


def _sync_tech_history(engine, fetched_at: datetime) -> dict[str, object]:
    records, failures = fetch_tech_market_history(settings.history_start_year)
    inserted = insert_records_if_absent(engine, "tech_market_snapshots", records, ["source", "symbol", "fetched_at"])
    return {"inserted": inserted, "total": len(records), "failures": failures}


def _sync_ai_daily(engine) -> dict[str, object]:
    client = AIDailyClient(interrupt=global_interrupt)
    records, failures = client.fetch_latest(DEFAULT_MAX_ENTRIES)
    inserted = upsert_records(engine, "ai_daily_snapshots", records, AI_DAILY_UPDATE_COLUMNS)
    return {"inserted": inserted, "failures": failures}


def _print_failures(failures: list[str]) -> None:
    for failure in failures:
        print(f"failure: {failure}")


def sync_once_result() -> dict[str, object]:
    return InterruptibleSync().run_latest()


def sync_once() -> int:
    result = sync_once_result()
    print(
        "data fetch finished: "
        f"precious_metals={result['preciousMetals']}, tech_markets={result['techMarkets']}, "
        f"ai_dailies={result['aiDailies']}, failures={len(result['failures'])}, "
        f"interrupted={result['interrupted']}"
    )
    _print_failures(result["failures"])  # type: ignore[arg-type]
    return 0 if (int(result["preciousMetals"]) or int(result["techMarkets"]) or int(result["aiDailies"])) else 1


def sync_history_result() -> dict[str, object]:
    return InterruptibleSync().run_history()


def sync_history() -> int:
    result = sync_history_result()
    print(
        "historical data fetch finished: "
        f"precious_metals={result['preciousMetals']}/{result['preciousMetalsTotal']}, "
        f"tech_markets={result['techMarkets']}/{result['techMarketsTotal']}, "
        f"failures={len(result['failures'])}, "
        f"interrupted={result['interrupted']}, "
        f"start_year={settings.history_start_year}"
    )
    _print_failures(result["failures"])  # type: ignore[arg-type]
    return 0 if int(result["preciousMetals"]) or int(result["techMarkets"]) else 1


def sync_loop() -> None:
    """持续轮询；每轮开始前清空中断状态，收到中断则本轮尽快退出、下轮照常。"""
    while True:
        try:
            with sync_lock:
                global_interrupt.reset()
                sync_once()
        except Interrupted as exc:
            print(f"loop iteration interrupted: {exc}")
        # 睡眠期间也响应中断：分片睡眠，收到信号立即醒来进入下一轮判断。
        for _ in range(max(1, settings.interval_seconds // 5)):
            if global_interrupt.requested:
                break
            time.sleep(5)


def start_loop_thread() -> None:
    if not settings.run_loop:
        return
    thread = threading.Thread(target=sync_loop, daemon=True)
    thread.start()


@app.on_event("startup")
def on_startup() -> None:
    install_signal_handlers(global_interrupt, on_interrupt=lambda sig: print(f"interrupt requested: signal {sig}"))
    start_loop_thread()


@app.on_event("shutdown")
def on_shutdown() -> None:
    restore_signal_handlers()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/sync/latest")
def sync_latest_api() -> dict[str, object]:
    with sync_lock:
        global_interrupt.reset()
        return sync_once_result()


@app.post("/sync/history")
def sync_history_api() -> dict[str, object]:
    with sync_lock:
        global_interrupt.reset()
        return sync_history_result()


@app.post("/sync/stop")
def sync_stop_api() -> dict[str, object]:
    """请求正在执行的同步任务在下一个检查点退出；返回当前是否确有任务在跑。"""
    running = sync_lock.locked()
    global_interrupt.request(reason="stop requested via API", source="api")
    return {"requested": True, "wasRunning": running}


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "once"
    if mode == "history":
        install_signal_handlers(global_interrupt)
        try:
            raise SystemExit(sync_history())
        except Interrupted as exc:
            print(f"interrupted: {exc}")
            raise SystemExit(130) from None
        finally:
            restore_signal_handlers()
    if mode == "loop":
        install_signal_handlers(global_interrupt)
        try:
            sync_loop()
            return
        except KeyboardInterrupt:
            print("loop stopped")
            return
        finally:
            restore_signal_handlers()
    # once
    install_signal_handlers(global_interrupt)
    try:
        raise SystemExit(sync_once())
    except Interrupted as exc:
        print(f"interrupted: {exc}")
        raise SystemExit(130) from None
    finally:
        restore_signal_handlers()


if __name__ == "__main__":
    main()
