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
    OPCODE_LTE_MODULATED,
    LteBandwidth,
    LteCwParams,
    LteModulatedParams,
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


class TestLteModulatedParams:
    # (label, captured frame, kwargs) — straight from the firmware captures.
    CAPTURES = [
        (
            "start_bw1_4_zero_power",
            "23 50 12 00 03 D4 49 00 00 40 0D 03 00 00 00 00 00 00 05 06 00 00",
            dict(
                earfcn=18900, time_ms=200000, tx_power=0,
                bandwidth=LteBandwidth.BW_1_4_MHZ, mcs=5, rb_count=6,
                rb_start=0, nb_index=0,
                tstrf_cmd=LteTstrfCmd.START_TX_TEST,
            ),
        ),
        (
            "abort_bw5_23dbm",
            "23 50 12 00 01 CF 4E 00 00 F0 49 02 00 FC 08 00 00 02 05 06 00 00",
            dict(
                earfcn=20175, time_ms=150000, tx_power=2300,
                bandwidth=LteBandwidth.BW_5_MHZ, mcs=5, rb_count=6,
                rb_start=0, nb_index=0,
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
        assert _hex(LteModulatedParams(**kwargs).encode()) == expected

    def test_payload_is_18_bytes(self) -> None:
        frame = parse_frame(
            LteModulatedParams(earfcn=18900, time_ms=200000, tx_power=0).encode()
        )
        assert frame.opcode == OPCODE_LTE_MODULATED
        assert len(frame.payload) == 18

    def test_shares_the_cw_header(self) -> None:
        """The first 13 payload bytes are the CW layout exactly.

        Worth pinning: it is the reason the two captures could be decoded at
        all, and a change to either encoder that broke it would mean one of the
        two layouts had been guessed wrong.
        """
        common = dict(earfcn=20175, time_ms=150000, tx_power=2300)
        cw = parse_frame(LteCwParams(**common, offset_hz=0).encode()).payload
        mod = parse_frame(LteModulatedParams(**common).encode()).payload
        assert cw[:13] == mod[:13]

    def test_field_offsets(self) -> None:
        """Each field alone, so a mis-ordered pair can't cancel out."""
        p = parse_frame(
            LteModulatedParams(
                earfcn=0x11223344,
                time_ms=0x55667788,
                tx_power=0x0099AABB,
                bandwidth=LteBandwidth.BW_20_MHZ,
                mcs=17,
                rb_count=40,
                rb_start=11,
                nb_index=3,
                tstrf_cmd=LteTstrfCmd.START_TX_TEST,
            ).encode()
        ).payload
        assert p[0] == int(LteTstrfCmd.START_TX_TEST)
        assert int.from_bytes(p[1:5], "little") == 0x11223344
        assert int.from_bytes(p[5:9], "little") == 0x55667788
        assert int.from_bytes(p[9:13], "little") == 0x0099AABB
        assert p[13] == int(LteBandwidth.BW_20_MHZ)
        assert p[14] == 17
        assert p[15] == 40
        assert p[16] == 11
        assert p[17] == 3

    def test_bandwidth_codes(self) -> None:
        """Only two are pinned by capture; the rest follow the 3GPP ordering."""
        assert int(LteBandwidth.BW_1_4_MHZ) == 0
        assert int(LteBandwidth.BW_5_MHZ) == 2
        assert [int(b) for b in LteBandwidth] == [0, 1, 2, 3, 4, 5]

    def test_start_and_abort_differ_only_in_first_byte(self) -> None:
        common = dict(
            earfcn=20175, time_ms=150000, tx_power=2300,
            bandwidth=LteBandwidth.BW_5_MHZ, mcs=5, rb_count=6,
        )
        start = LteModulatedParams(
            **common, tstrf_cmd=LteTstrfCmd.START_TX_TEST
        ).encode()
        abort = LteModulatedParams(
            **common, tstrf_cmd=LteTstrfCmd.ABORT_TEST
        ).encode()
        assert start[5:] == abort[5:]
        assert start[4] == 3 and abort[4] == 1

    @pytest.mark.parametrize(
        "bandwidth,rb",
        [
            (LteBandwidth.BW_1_4_MHZ, 6),
            (LteBandwidth.BW_3_MHZ, 15),
            (LteBandwidth.BW_5_MHZ, 25),
            (LteBandwidth.BW_10_MHZ, 50),
            (LteBandwidth.BW_15_MHZ, 75),
            (LteBandwidth.BW_20_MHZ, 100),
        ],
    )
    def test_full_channel_allocation_is_allowed(
        self, bandwidth: LteBandwidth, rb: int
    ) -> None:
        """Every bandwidth must accept its own full width."""
        p = parse_frame(
            LteModulatedParams(
                earfcn=18900, time_ms=1000, tx_power=0,
                bandwidth=bandwidth, mcs=5, rb_count=rb,
            ).encode()
        ).payload
        assert p[15] == rb

    @pytest.mark.parametrize(
        "kwargs,message",
        [
            (dict(mcs=29), "mcs"),
            (dict(bandwidth=LteBandwidth.BW_1_4_MHZ, rb_count=7), "rb_count"),
            (dict(rb_count=0), "rb_count"),
            # Fits on its own, but not starting where it was asked to.
            (
                dict(bandwidth=LteBandwidth.BW_5_MHZ, rb_count=20, rb_start=10),
                "runs past",
            ),
            (dict(bandwidth=6), "bandwidth"),
        ],
    )
    def test_out_of_range_is_rejected(self, kwargs: dict, message: str) -> None:
        base = dict(
            earfcn=18900, time_ms=1000, tx_power=0,
            bandwidth=LteBandwidth.BW_5_MHZ, mcs=5, rb_count=6,
        )
        with pytest.raises(ValueError, match=message):
            LteModulatedParams(**{**base, **kwargs}).encode()
