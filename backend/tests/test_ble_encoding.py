"""BLE radio test commands, pinned to the frames they were derived from.

The frames below are exactly the ones supplied with the opcodes. Each field of
the tone command differs between its two frames, so these pin the layout
rather than just a field order -- see `BleToneParams`.

Also covered: the routes' sequencing. Both commands take the DUT off the link,
and what the routes do around that -- reset only after an accepted set,
release the session every time the DUT may be leaving -- is what keeps the
next connect from tripping on a dead session.
"""

from __future__ import annotations

import asyncio

import pytest
from pydantic import ValidationError

from backend.api.device import ble as ble_routes
from backend.device import (
    BLE_DURATION_MAX_S, BLE_TX_POWER_PARAM_MAX, BLE_TX_POWER_PARAM_MIN,
    OPCODE_BLE_TONE_START, OPCODE_BLE_TX_POWER_SET, BleToneParams,
    ble_channel_freq_hz,
)
from backend.device.ble import encode_tx_power_get, encode_tx_power_set
from backend.device.device import Device
from backend.device.info import OPCODE_SAVE_RESET, encode_save_and_reset
from backend.protocol import parse_frame


def _hex(s: str) -> bytes:
    return bytes.fromhex(s.replace(" ", ""))


# --- frames -----------------------------------------------------------------


def test_tx_power_matches_the_supplied_frame() -> None:
    assert encode_tx_power_set(31) == _hex("31 00 01 00 1F")


@pytest.mark.parametrize("param", [BLE_TX_POWER_PARAM_MIN - 1, BLE_TX_POWER_PARAM_MAX + 1, 0, 255])
def test_tx_power_outside_the_firmware_range_never_reaches_the_wire(param: int) -> None:
    with pytest.raises(ValueError):
        encode_tx_power_set(param)


@pytest.mark.parametrize(
    "params, frame",
    [
        (BleToneParams(channel=22, duration_s=10, offset=0), "10 21 04 00 16 00 0A 00"),
        (BleToneParams(channel=0, duration_s=150, offset=5), "10 21 04 00 00 05 96 00"),
    ],
)
def test_tone_matches_the_supplied_frames(params: BleToneParams, frame: str) -> None:
    assert params.encode() == _hex(frame)


def test_tone_opcodes_are_the_named_ones() -> None:
    assert OPCODE_BLE_TONE_START == _hex("10 21")
    assert OPCODE_BLE_TX_POWER_SET == _hex("31 00")


@pytest.mark.parametrize(
    "kwargs",
    [
        {"channel": 40, "duration_s": 10},
        {"channel": -1, "duration_s": 10},
        # A tone cannot be stopped over the air, so one without an end is refused.
        {"channel": 0, "duration_s": 0},
        # Above 255 the two readings of the duration bytes disagree.
        {"channel": 0, "duration_s": BLE_DURATION_MAX_S + 1},
        {"channel": 0, "duration_s": 10, "offset": 256},
    ],
)
def test_tone_out_of_range_is_refused(kwargs: dict) -> None:
    with pytest.raises(ValueError):
        BleToneParams(**kwargs).encode()


@pytest.mark.parametrize("ch, mhz", [(0, 2402), (1, 2404), (22, 2446), (39, 2480)])
def test_channel_frequency(ch: int, mhz: int) -> None:
    assert ble_channel_freq_hz(ch) == mhz * 1_000_000


# --- device: a missing reply is "not acknowledged", not an error --------------


class _Transport:
    """Answers the opcodes in `ok` with status 0, those in `refuse` with 1,
    and times out on anything else -- the shape of a DUT that dropped the link
    before replying."""

    def __init__(self, ok: set[bytes] = frozenset(), refuse: set[bytes] = frozenset()) -> None:
        self.ok, self.refuse = set(ok), set(refuse)
        self.sent: list[bytes] = []

    async def send(self, frame_bytes: bytes, timeout: float = 5.0):
        self.sent.append(frame_bytes)
        op = frame_bytes[0:2]
        if op in self.ok:
            return parse_frame(op + b"\x01\x00\x00")
        if op in self.refuse:
            return parse_frame(op + b"\x01\x00\x01")
        raise TimeoutError("no reply")


def test_tone_without_a_reply_is_unacknowledged_not_raised() -> None:
    dev = Device(_Transport())  # type: ignore[arg-type]
    out = asyncio.run(dev.ble_tone_start(channel=22, duration_s=10))
    assert out.acknowledged is False and out.ok is False
    assert out.tx_hex == "10 21 04 00 16 00 0a 00"
    assert "TimeoutError" in (out.error or "")


def test_tone_with_a_reply_reports_its_status() -> None:
    dev = Device(_Transport(ok={OPCODE_BLE_TONE_START}))  # type: ignore[arg-type]
    out = asyncio.run(dev.ble_tone_start(channel=0, duration_s=150, offset=5))
    assert out.acknowledged and out.ok and out.status == 0


# --- routes: what happens around the drop -------------------------------------


class _Manager:
    def __init__(self) -> None:
        self.released = 0

    async def release(self) -> None:
        self.released += 1


@pytest.fixture
def rig(monkeypatch: pytest.MonkeyPatch):
    def make(transport: _Transport) -> _Manager:
        m = _Manager()
        dev = Device(transport)  # type: ignore[arg-type]
        monkeypatch.setattr(ble_routes, "manager", m)
        monkeypatch.setattr(ble_routes, "get_device", lambda: dev)
        return m
    return make


def test_power_change_sets_then_resets_then_releases(rig) -> None:
    t = _Transport(ok={OPCODE_BLE_TX_POWER_SET, OPCODE_SAVE_RESET})
    m = rig(t)
    out = asyncio.run(ble_routes.ble_tx_power(ble_routes.BleTxPowerRequest(param=20)))
    assert t.sent == [encode_tx_power_set(20), encode_save_and_reset()]
    assert out.set.ok and out.reset is not None and out.reset.ok
    assert out.released and m.released == 1


def test_refused_power_is_not_reset(rig) -> None:
    # Resetting after a refused set would reboot the DUT onto the old power
    # and report a change that never happened.
    t = _Transport(refuse={OPCODE_BLE_TX_POWER_SET})
    m = rig(t)
    out = asyncio.run(ble_routes.ble_tx_power(ble_routes.BleTxPowerRequest(param=20)))
    assert t.sent == [encode_tx_power_set(20)]
    assert out.reset is None and not out.released and m.released == 0


def test_unanswered_reset_still_releases(rig) -> None:
    t = _Transport(ok={OPCODE_BLE_TX_POWER_SET})
    m = rig(t)
    out = asyncio.run(ble_routes.ble_tx_power(ble_routes.BleTxPowerRequest(param=6)))
    assert out.reset is not None and not out.reset.acknowledged
    assert out.released and m.released == 1


def test_tone_releases_whether_or_not_it_was_answered(rig) -> None:
    for t in (_Transport(), _Transport(ok={OPCODE_BLE_TONE_START})):
        m = rig(t)
        out = asyncio.run(ble_routes.ble_tone(ble_routes.BleToneRequest(channel=22, duration_s=10)))
        assert out.released and m.released == 1
        assert out.freq_hz == 2_446_000_000 and out.duration_s == 10


@pytest.mark.parametrize(
    "kwargs",
    [{"channel": 40, "duration_s": 10}, {"channel": 0, "duration_s": 0},
     {"channel": 0, "duration_s": 256}],
)
def test_tone_request_bounds_are_a_422(kwargs: dict) -> None:
    with pytest.raises(ValidationError):
        ble_routes.BleToneRequest(**kwargs)


@pytest.mark.parametrize("param", [5, 32])
def test_power_request_bounds_are_a_422(param: int) -> None:
    with pytest.raises(ValidationError):
        ble_routes.BleTxPowerRequest(param=param)


# --- power read-back -----------------------------------------------------------


class _Reply:
    """Answers the read with one fixed reply."""

    def __init__(self, reply: str) -> None:
        self.reply = _hex(reply)

    async def send(self, frame_bytes: bytes, timeout: float = 5.0):
        assert frame_bytes == _hex("30 00 00 00")
        return parse_frame(self.reply)


def _read(reply: str):
    return asyncio.run(Device(_Reply(reply)).ble_tx_power_get())  # type: ignore[arg-type]


def test_power_get_matches_the_supplied_frame() -> None:
    assert encode_tx_power_get() == _hex("30 00 00 00")


def test_power_get_reads_status_then_param() -> None:
    out = _read("30 00 02 00 00 1F")
    assert out.ok and out.param == 31 and out.data_hex == "1F"


def test_power_get_reads_a_value_sent_past_the_declared_length() -> None:
    # The DUT sometimes declares only the status and sends the value after it
    # (see parse_frame); the read must not depend on which.
    assert _read("30 00 01 00 00 14").param == 20


@pytest.mark.parametrize(
    "reply, why",
    [
        ("30 00 01 00 01", "refused"),
        ("30 00 01 00 00", "no value"),
        ("30 00 02 00 00 05", "not a param"),
        ("31 00 02 00 00 1F", "unexpected reply opcode"),
    ],
)
def test_power_get_does_not_believe_what_it_cannot_decode(reply: str, why: str) -> None:
    out = _read(reply)
    assert out.param is None and not out.ok
    assert why in (out.error or "")


def test_power_get_without_a_reply_is_reported_not_raised() -> None:
    out = asyncio.run(Device(_Transport()).ble_tx_power_get())  # type: ignore[arg-type]
    assert out.param is None and out.status == -1 and "TimeoutError" in (out.error or "")
