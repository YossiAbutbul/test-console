"""Per-instrument call isolation.

Vendor VISA/USB calls can block indefinitely — a powered-down instrument that
still enumerates, a wedged USBTMC session — and a blocked call cannot be
cancelled from Python. Routed through `asyncio.to_thread`, each stuck call
permanently consumes a worker from the *shared* default executor. After enough
of them the pool is exhausted and every endpoint stalls, including the status
polls: the server accepts connections but answers nothing, which reads as "the
app stopped working after a few minutes".

Each instrument therefore gets its own single-thread executor. A wedged
instrument can then only ever cost its own thread, and:

  - callers stop waiting after `timeout` and get a 504 instead of hanging;
  - while a call is still stuck, further calls to that instrument fail fast
    rather than queueing behind it;
  - every other instrument, and the rest of the API, keeps working.
"""

from __future__ import annotations

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable, TypeVar

log = logging.getLogger(__name__)

T = TypeVar("T")

#: Long enough for the slowest legitimate read, short enough that the UI is not
#: left guessing whether the request is alive.
#:
#: The power-sensor read alone can spend ~1.5 s retrying a sentinel plus a dozen
#: averaged reads; at 10 s that sat right on the boundary, and tripping it left
#: the instrument marked busy so every following point failed too.
DEFAULT_TIMEOUT_S = 25.0


class InstrumentBusy(RuntimeError):
    """A previous call to this instrument has not returned yet."""


class InstrumentBus:
    """Serialises access to one instrument and bounds how long callers wait."""

    def __init__(self, name: str) -> None:
        self._name = name
        # max_workers=1 both serialises access (vendor layers are rarely
        # thread-safe) and caps the damage a wedged call can do to one thread.
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix=f"instr-{name}")
        # The last dispatched call. "Busy" means this one is still unfinished —
        # which is only possible after a timeout, since a completed await
        # guarantees the future is done.
        self._pending: asyncio.Future[Any] | None = None

    async def call(
        self,
        fn: Callable[..., T],
        *args: Any,
        timeout: float = DEFAULT_TIMEOUT_S,
    ) -> T:
        """Run `fn` on this instrument's thread.

        Raises `InstrumentBusy` if a previous call is still stuck, or
        `TimeoutError` if this one outlives `timeout`.
        """
        # Read the future's own state rather than a flag cleared by a done
        # callback: those callbacks run on a later loop iteration, so back-to-back
        # calls — exactly what a sweep does — saw a stale "busy" and failed a
        # point for no reason.
        pending = self._pending
        if pending is not None and not pending.done():
            raise InstrumentBusy(
                f"{self._name} is not responding to a previous command; "
                "disconnect and reconnect it"
            )

        loop = asyncio.get_running_loop()
        future = loop.run_in_executor(self._pool, lambda: fn(*args))
        self._pending = future

        try:
            # shield: a timeout must not cancel the executor job — the thread is
            # uninterruptible anyway, and letting it finish is what allows the
            # instrument to become usable again without a restart.
            return await asyncio.wait_for(asyncio.shield(future), timeout=timeout)
        except asyncio.TimeoutError:
            log.warning("%s: no response after %.0fs; call left running", self._name, timeout)
            raise TimeoutError(f"{self._name} did not respond within {timeout:.0f}s") from None


#: One bus per instrument. Keyed by the same ids the routes use.
BUSES: dict[str, InstrumentBus] = {
    "power-sensor": InstrumentBus("power-sensor"),
    "dc-analyzer": InstrumentBus("dc-analyzer"),
    "spectrum": InstrumentBus("spectrum"),
    "network-analyzer": InstrumentBus("network-analyzer"),
}


def bus(name: str) -> InstrumentBus:
    return BUSES[name]
