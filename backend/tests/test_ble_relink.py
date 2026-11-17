"""`BLEManager.relink` and `release` -- the way back from a deliberate drop.

No radio here: `connect` is replaced with a script of outcomes, which is the
part relink owns -- retrying, insisting on a working transport, and giving up
with a message that says why.
"""

from __future__ import annotations

import asyncio
import importlib

import pytest

from backend.ble.manager import BLEManager
from backend.ble.models import ConnectionStatus

# `backend.ble.manager` the attribute is the singleton; the module is wanted.
mgr_mod = importlib.import_module("backend.ble.manager")

ADDR = "AA:BB:CC:DD:EE:FF"


@pytest.fixture(autouse=True)
def fast(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(mgr_mod, "RELINK_RETRY_S", 0.0)


def _scripted(m: BLEManager, outcomes: list) -> list[float]:
    """Make `m.connect` play `outcomes` in order; returns the timeouts it got."""
    timeouts: list[float] = []

    async def connect(address: str, timeout: float = 15.0) -> ConnectionStatus:
        assert address == ADDR
        timeouts.append(timeout)
        o = outcomes.pop(0)
        if isinstance(o, Exception):
            raise o
        return o

    m.connect = connect  # type: ignore[method-assign]
    return timeouts


def _up(ready: bool = True) -> ConnectionStatus:
    return ConnectionStatus(
        connected=True, address=ADDR, transport_ready=ready,
        transport_error=None if ready else "no notify characteristic",
    )


def test_relink_needs_a_dut_to_go_back_to() -> None:
    with pytest.raises(RuntimeError, match="connect to one first"):
        asyncio.run(BLEManager().relink(timeout=1))


def test_relink_retries_until_the_dut_is_back() -> None:
    m = BLEManager()
    m._last_address = ADDR
    _scripted(m, [RuntimeError("not found"), RuntimeError("not found"), _up()])
    st = asyncio.run(m.relink(timeout=5))
    assert st.connected and st.transport_ready


def test_relink_does_not_hand_back_a_link_without_a_transport() -> None:
    # A DUT still booting can take the connection before its command service
    # is up; returning that would fail the next command instead.
    m = BLEManager()
    m._last_address = ADDR
    released = []

    async def release() -> None:
        released.append(1)

    m.release = release  # type: ignore[method-assign]
    _scripted(m, [_up(ready=False), _up()])
    st = asyncio.run(m.relink(timeout=5))
    assert st.transport_ready and released == [1]


def test_relink_gives_up_with_the_reason() -> None:
    m = BLEManager()
    m._last_address = ADDR

    async def never(address: str, timeout: float = 15.0) -> ConnectionStatus:
        await asyncio.sleep(0.05)
        raise RuntimeError(f"Device {address} not found within {timeout}s")

    m.connect = never  # type: ignore[method-assign]
    with pytest.raises(TimeoutError, match="did not come back.*not found"):
        asyncio.run(m.relink(timeout=0.2))


def test_attempts_are_bounded_by_what_is_left() -> None:
    m = BLEManager()
    m._last_address = ADDR
    timeouts = _scripted(m, [_up()])
    asyncio.run(m.relink(timeout=4))
    assert timeouts and timeouts[0] <= 4


def test_release_keeps_the_address_and_blocks_the_auto_reconnect() -> None:
    m = BLEManager()
    m._last_address = ADDR
    asyncio.run(m.release())
    assert m._last_address == ADDR
    assert m._intentional is True
    assert not m.status().connected
