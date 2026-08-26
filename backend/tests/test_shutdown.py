"""Releasing hardware at shutdown.

The lifespan hook is the only thing standing between a backend restart and a
round of unplugging instruments, and it runs exactly once in a context where
nobody is watching the logs. So the contract is pinned here: every device gets
a release attempt, and one failing does not strand the others.
"""

from __future__ import annotations

import asyncio
import functools
from typing import Any, Callable

from backend import main
from backend.api.instruments import close_all
from backend.api.instruments._state import state


def sync(fn: Callable[..., Any]) -> Callable[..., Any]:
    @functools.wraps(fn)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        return asyncio.run(fn(*args, **kwargs))
    return wrapper


class TestReleaseHardware:
    @sync
    async def test_runs_clean_with_nothing_connected(self) -> None:
        """The common case: stopping a server that never opened anything."""
        await main._release_hardware()

    @sync
    async def test_one_failing_device_does_not_strand_the_others(self) -> None:
        called: list[str] = []

        async def ok_ble() -> None:
            called.append("ble")

        async def boom_instruments() -> None:
            called.append("instruments")
            raise RuntimeError("VISA session wedged")

        def ok_servo() -> None:
            called.append("servo")

        def ok_motor() -> None:
            called.append("motor")

        originals = (
            main.ble_manager.disconnect,
            main.instruments_close_all,
            main.servo_manager.disconnect,
            main.motor_manager.disconnect,
        )
        main.ble_manager.disconnect = ok_ble           # type: ignore[assignment]
        main.instruments_close_all = boom_instruments  # type: ignore[assignment]
        main.servo_manager.disconnect = ok_servo       # type: ignore[assignment]
        main.motor_manager.disconnect = ok_motor       # type: ignore[assignment]
        try:
            await main._release_hardware()
        finally:
            (
                main.ble_manager.disconnect,
                main.instruments_close_all,
                main.servo_manager.disconnect,
                main.motor_manager.disconnect,
            ) = originals  # type: ignore[assignment]

        # The failure is swallowed and every step after it still ran.
        assert called == ["ble", "instruments", "servo", "motor"]


class TestCloseAll:
    @sync
    async def test_clears_state_even_when_close_raises(self) -> None:
        """A session that refuses to close must still be forgotten.

        Leaving the object in `state` reports the instrument as connected on a
        process that is exiting, and the stale resource string would make the
        next run's discovery skip the very device it is looking for.
        """

        class Stubborn:
            def close(self) -> None:
                raise RuntimeError("nope")

        state.network_analyzer = Stubborn()
        state.network_analyzer_idn = "STUB,1,2,3"
        state.network_analyzer_resource = "USB0::0x0957::INSTR"
        try:
            await close_all()
            assert state.network_analyzer is None
            assert state.network_analyzer_idn is None
            assert state.network_analyzer_resource is None
        finally:
            state.network_analyzer = None
            state.network_analyzer_idn = None
            state.network_analyzer_resource = None

    @sync
    async def test_closes_a_healthy_session(self) -> None:
        closed: list[bool] = []

        class Session:
            def close(self) -> None:
                closed.append(True)

        state.spectrum = Session()
        try:
            await close_all()
            assert closed == [True]
            assert state.spectrum is None
        finally:
            state.spectrum = None

    @sync
    async def test_a_wedged_close_is_bounded(self) -> None:
        """One instrument that never returns must not hold up the rest."""

        class Wedged:
            def close(self) -> None:
                import time
                time.sleep(30)

        state.spectrum = Wedged()
        try:
            start = asyncio.get_running_loop().time()
            await close_all()
            elapsed = asyncio.get_running_loop().time() - start
            # Bounded by CLOSE_TIMEOUT_S, not by the 30 s call behind it.
            assert elapsed < 5, f"close_all waited {elapsed:.1f}s on a wedged instrument"
            assert state.spectrum is None
        finally:
            state.spectrum = None
