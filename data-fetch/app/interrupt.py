# -*- coding: utf-8 -*-
"""协作式中断控制：让长时间同步任务能被 Ctrl+C / SIGTERM / API 安全打断。

设计原则：
- 软中断：在数据源之间、标的之间设检查点（checkpoint），收到中断后完成
  当前单元并落库再退出，绝不丢弃已抓到的数据。
- 中断原因可观测：记录是谁发起的中断（signal/api），写进返回结果。
- sync_lock 持有者退出时释放，下轮循环可正常重新开始。
"""
from __future__ import annotations

import signal
import threading
from dataclasses import dataclass, field
from typing import Literal


@dataclass
class InterruptEvent:
    """线程安全的中断信号；可全局注册，被所有 sync 任务共享。"""

    _flag: threading.Event = field(default_factory=threading.Event, init=False)
    _reason: str = ""
    _source: Literal["signal", "api", "test", ""] = ""

    @property
    def requested(self) -> bool:
        return self._flag.is_set()

    @property
    def reason(self) -> str:
        return self._reason

    @property
    def source(self) -> str:
        return self._source

    def request(self, reason: str = "", source: Literal["signal", "api", "test"] = "api") -> None:
        """请求中断；已置位时保留第一次的原因（先到的优先）。"""
        if self._flag.is_set():
            return
        self._reason = reason or "no reason given"
        self._source = source
        self._flag.set()

    def reset(self) -> None:
        """清空中断状态。每个 sync 任务开始前调用，防止上一轮残留。"""
        self._flag.clear()
        self._reason = ""
        self._source = ""

    def checkpoint(self, where: str) -> None:
        """同步任务检查点：中断已请求时抛出 Interrupted，由任务边界捕获。

        传 where 是为了在日志/结果里说清中断发生在哪个阶段。
        """
        if self._flag.is_set():
            raise Interrupted(where, self._reason, self._source)


class Interrupted(Exception):
    """检查点检测到中断请求时抛出；携带中断位置与原因。"""

    def __init__(self, where: str, reason: str, source: str) -> None:
        super().__init__(f"interrupted at {where}: {reason} (source={source})")
        self.where = where
        self.reason = reason
        self.source = source


# 进程级全局中断事件：SIGINT/SIGTERM 与 API /sync/stop 共用。
global_interrupt = InterruptEvent()

_previous_handlers: dict[int, object] = {}


def install_signal_handlers(event: InterruptEvent, on_interrupt=None) -> None:
    """把 SIGINT/SIGTERM 转成软中断请求。首次 Ctrl+C 立即触发软中断，
    任务在下一个检查点退出；连续两次 Ctrl+C 恢复默认行为强制退出。"""

    def handler(signum, frame):
        event.request(reason=f"received signal {signum}", source="signal")
        if on_interrupt:
            try:
                on_interrupt(signum)
            except Exception:
                pass
        if _handler_count(event) >= 2:
            # 第二次信号：调用方明显不想等了，恢复默认处理强制退出。
            signal.signal(signum, signal.SIG_DFL)
            signal.raise_signal(signum)

    def _handler_count(_event: InterruptEvent) -> int:
        # 同一信号第二次到达时 event 已置位，用 reason 未变 + 计数器判断。
        return signal_count[0]

    signal_count = [0]
    original_handler = event  # 占位避免闭包混淆

    def handler_with_count(signum, frame):
        signal_count[0] += 1
        handler(signum, frame)

    for sig in (signal.SIGINT, signal.SIGTERM):
        _previous_handlers[sig] = signal.getsignal(sig)
        signal.signal(sig, handler_with_count)


def restore_signal_handlers() -> None:
    for sig, handler in _previous_handlers.items():
        try:
            signal.signal(sig, handler)
        except (ValueError, OSError):
            pass  # 非主线程里无法恢复，忽略
    _previous_handlers.clear()
