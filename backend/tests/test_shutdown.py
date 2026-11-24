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
from backend.api.instruments._bus import bus
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

        import threading

        release = threading.Event()

        class Wedged:
            def close(self) -> None:
                release.wait(30)

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
            # The close now runs on the spectrum bus's one thread: free it, or
            # every later test on that bus sees it busy.
            release.set()
            bus("spectrum").call_sync(lambda: None)

    @sync
    async def test_closes_the_signal_generator(self) -> None:
        """It was missing from the list, so its COM port outlived the process."""
        closed: list[bool] = []

        class Port:
            def close(self) -> None:
                closed.append(True)

        state.signal_generator = Port()
        state.signal_generator_port = "COM7"
        try:
            await close_all()
            assert closed == [True]
            assert state.signal_generator is None
            assert state.signal_generator_port is None
        finally:
            state.signal_generator = None
            state.signal_generator_port = None

    @sync
    async def test_close_runs_on_the_instrument_bus(self) -> None:
        """Closed from another thread, a session went away under a poll's read."""
        import threading

        seen: list[str] = []

        class Session:
            def close(self) -> None:
                seen.append(threading.current_thread().name)

        state.dc_analyzer = Session()
        try:
            await close_all()
            assert seen and seen[0].startswith("instr-dc-analyzer")
        finally:
            state.dc_analyzer = None


class TestFreqAccuracyShutdown:
    @sync
    async def test_shutdown_is_a_step(self) -> None:
        """A run killed mid-point left the DUT keyed."""
        from backend.api import freq_accuracy

        called: list[str] = []
        original = main.freq_accuracy.shutdown

        async def fake() -> None:
            called.append("fa")

        main.freq_accuracy.shutdown = fake  # type: ignore[assignment]
        try:
            await main._release_hardware()
        finally:
            main.freq_accuracy.shutdown = original  # type: ignore[assignment]
        assert called == ["fa"]
        assert freq_accuracy.shutdown is original

    @sync
    async def test_a_test_sequence_is_stopped_first(self) -> None:
        """A sequence keys the DUT on every point: it is let go before the
        links it drives are closed."""
        called: list[str] = []
        original = main.sequence_runner.shutdown

        async def fake() -> None:
            called.append("sequence")

        main.sequence_runner.shutdown = fake  # type: ignore[assignment]
        try:
            await main._release_hardware()
        finally:
            main.sequence_runner.shutdown = original  # type: ignore[assignment]
        assert called == ["sequence"]

    @sync
    async def test_cancels_and_waits_for_a_running_task(self) -> None:
        from backend.api import freq_accuracy as fa

        keyed_down: list[bool] = []

        async def run() -> None:
            try:
                while not fa._run.cancel.is_set():
                    await asyncio.sleep(0.01)
            finally:
                keyed_down.append(True)

        fa._run.cancel.clear()
        fa._run.task = asyncio.create_task(run())
        try:
            await fa.shutdown()
            assert keyed_down == [True]
            assert not fa.running()
        finally:
            fa._run.task = None
            fa._run.cancel.clear()
