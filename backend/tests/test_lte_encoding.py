"""LTE command payload encoding.

The layouts here were reverse-engineered from frames captured off the wire, so
unlike a spec-derived encoder there is no document to check them against — the
captures *are* the specification. Both are pinned byte-for-byte: a field that
drifts in order or endianness would otherwise fail silently, as a transmission
on the wrong channel at the wrong power.
"""

from __future__ import annotations

import pytest

from backend.device import (
    OPCODE_LTE_CW,
    OPCODE_LTE_MODEM_OFF,
    OPCODE_LTE_MODEM_ON,
    LteCwParams,
    LteTstrfCmd,
)
from backend.protocol.frame import pack_frame, parse_frame


def _hex(b: bytes) -> str:
    return b.hex(" ").upper()


class TestModemPower:
    """The two power frames carry no payload at all."""

    def test_modem_on(self) -> None:
        assert _hex(pack_frame(OPCODE_LTE_MODEM_ON, b"")) == "2B 50 00 00"

    def test_modem_off(self) -> None:
        assert _hex(pack_frame(OPCODE_LTE_MODEM_OFF, b"")) == "2C 50 00 00"


class TestLteCwParams:
    # (label, captured frame, kwargs) — straight from the firmware captures.
    CAPTURES = [
        (
            "start_tx_zero_power",
            "24 50 11 00 03 D4 49 00 00 40 0D 03 00 00 00 00 00 00 00 00 00",
            dict(
                earfcn=18900, time_ms=200000, tx_power=0, offset_hz=0,
                tstrf_cmd=LteTstrfCmd.START_TX_TEST,
            ),
        ),
        (
            "abort_23dbm_offset",
            "24 50 11 00 01 CF 4E 00 00 F0 49 02 00 FC 08 00 00 64 00 00 00",
            dict(
                earfcn=20175, time_ms=150000, tx_power=2300, offset_hz=100,
                tstrf_cmd=LteTstrfCmd.ABORT_TEST,
            ),
        ),
    ]

    @pytest.mark.parametrize(
        "label,expected,kwargs",
        CAPTURES,
        ids=[c[0] for c in CAPTURES],
    )
    def test_reproduces_capture(
        self, label: str, expected: str, kwargs: dict
    ) -> None:
        assert _hex(LteCwParams(**kwargs).encode()) == expected

    def test_payload_is_17_bytes(self) -> None:
        frame = parse_frame(
            LteCwParams(
                earfcn=18900, time_ms=200000, tx_power=0, offset_hz=0,
            ).encode()
        )
        assert frame.opcode == OPCODE_LTE_CW
        assert len(frame.payload) == 17

    def test_field_offsets(self) -> None:
        """Each field alone, so a mis-ordered pair can't cancel out."""
        p = parse_frame(
            LteCwParams(
                earfcn=0x11223344,
                time_ms=0x55667788,
                tx_power=0x0099AABB,
                offset_hz=0x0CCDDEEF,
                tstrf_cmd=LteTstrfCmd.START_TX_TEST,
            ).encode()
        ).payload
        assert p[0] == int(LteTstrfCmd.START_TX_TEST)
        assert int.from_bytes(p[1:5], "little") == 0x11223344
        assert int.from_bytes(p[5:9], "little") == 0x55667788
        assert int.from_bytes(p[9:13], "little") == 0x0099AABB
        assert int.from_bytes(p[13:17], "little", signed=True) == 0x0CCDDEEF

    def test_offset_is_signed(self) -> None:
        """Below the centre is a real case, so the field must not wrap."""
        p = parse_frame(
            LteCwParams(
                earfcn=18900, time_ms=200000, tx_power=0, offset_hz=-100,
            ).encode()
        ).payload
        assert p[13:17] == b"\x9c\xff\xff\xff"
        assert int.from_bytes(p[13:17], "little", signed=True) == -100

    def test_start_and_abort_differ_only_in_first_byte(self) -> None:
        common = dict(
            earfcn=20175, time_ms=150000, tx_power=2300, offset_hz=100,
        )
        start = LteCwParams(**common, tstrf_cmd=LteTstrfCmd.START_TX_TEST).encode()
        abort = LteCwParams(**common, tstrf_cmd=LteTstrfCmd.ABORT_TEST).encode()
        assert start[5:] == abort[5:]
        assert start[4] == 3 and abort[4] == 1

    @pytest.mark.parametrize(
        "kwargs,field",
        [
            (dict(earfcn=-1, time_ms=0, tx_power=0, offset_hz=0), "earfcn"),
            (dict(earfcn=0, time_ms=1 << 32, tx_power=0, offset_hz=0), "time_ms"),
            (dict(earfcn=0, time_ms=0, tx_power=-1, offset_hz=0), "tx_power"),
            (
                dict(earfcn=0, time_ms=0, tx_power=0, offset_hz=1 << 31),
                "offset_hz",
            ),
        ],
    )
    def test_out_of_range_is_rejected(self, kwargs: dict, field: str) -> None:
        with pytest.raises(ValueError, match=field):
            LteCwParams(**kwargs).encode()
