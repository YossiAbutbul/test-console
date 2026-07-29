"""Per-instrument call isolation.

The first implementation cleared its busy flag from a done callback, which runs
on a later event-loop iteration than the awaiting caller. Back-to-back calls —
what a sweep does on every point — therefore saw a stale "busy" and failed for
no reason. These pin the behaviour that matters.
"""

from __future__ import annotations

import asyncio
import functools
import time
from typing import Any, Callable

import pytest

from backend.api.instruments._bus import InstrumentBus, InstrumentBusy


def sync(fn: Callable[..., Any]) -> Callable[..., Any]:
    @functools.wraps(fn)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        return asyncio.run(fn(*args, **kwargs))
    return wrapper


class TestInstrumentBus:
    @sync
    async def test_back_to_back_calls_are_not_reported_busy(self) -> None:
        bus = InstrumentBus("test")
        # The regression: the second call must not see the first as in flight.
        for i in range(25):
            assert await bus.call(lambda n=i: n * 2) == i * 2

    @sync
    async def test_returns_the_value_from_the_worker_thread(self) -> None:
        bus = InstrumentBus("test")
        assert await bus.call(lambda a, b: a + b, 2, 40) == 42

    @sync
    async def test_an_exception_propagates_and_frees_the_bus(self) -> None:
        bus = InstrumentBus("test")

        def boom() -> None:
            raise ValueError("sensor said no")

        with pytest.raises(ValueError, match="sensor said no"):
            await bus.call(boom)
        # A failure is not a wedge — the next call must go through.
        assert await bus.call(lambda: "ok") == "ok"

    @sync
    async def test_a_slow_call_times_out_without_cancelling_the_work(self) -> None:
        bus = InstrumentBus("test")
        finished: list[str] = []

        def slow() -> str:
            time.sleep(0.4)
            finished.append("done")
            return "late"

        with pytest.raises(TimeoutError, match="did not respond"):
            await bus.call(slow, timeout=0.05)

        # While it is still running the instrument reports busy rather than
        # queueing a second command behind it.
        with pytest.raises(InstrumentBusy):
            await bus.call(lambda: "second")

        await asyncio.sleep(0.6)
        assert finished == ["done"], "the abandoned call must be left to finish"

    @sync
    async def test_recovers_once_the_stuck_call_finishes(self) -> None:
        bus = InstrumentBus("test")

        with pytest.raises(TimeoutError):
            await bus.call(lambda: time.sleep(0.3), timeout=0.05)
        await asyncio.sleep(0.5)

        # No restart, no reconnect: the bus frees itself.
        assert await bus.call(lambda: "back") == "back"

    @sync
    async def test_calls_are_serialised_onto_one_thread(self) -> None:
        bus = InstrumentBus("test")
        threads: set[int] = set()

        def note() -> None:
            import threading
            threads.add(threading.get_ident())

        for _ in range(5):
            await bus.call(note)
        assert len(threads) == 1, "vendor layers are not thread-safe"
