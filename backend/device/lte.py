"""LTE modem test commands.

Unlike LoRa, an LTE test is a *sequence*, not a single frame. The modem is
powered down at rest and will not accept a test command until it is up:

    MODEM_ON  ->  TEST_RF_x(START_TX_TEST)  ->  ...  ->
    TEST_RF_x(ABORT_TEST)  ->  MODEM_OFF

where TEST_RF_x is CW or MODULATED. The two carry the same first 13
payload bytes and differ only in what follows them.

Both ends matter. Skipping MODEM_OFF leaves the modem powered and the DUT
drawing current with a transmitter enabled, so callers must send it even when
the test command itself failed — see `Device.lte_cw_stop`.

Payload layouts below were decoded from captured frames. They are the contract
with the firmware: a field in the wrong order or endianness fails silently as a
transmission on the wrong channel, so `backend/tests/test_lte_encoding.py`
pins them byte-for-byte against those captures.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum

from ..protocol import pack_frame
from .common import check_i32, check_u32, check_u8

OPCODE_LTE_MODEM_ON = b"\x2b\x50"
OPCODE_LTE_MODEM_OFF = b"\x2c\x50"
OPCODE_LTE_CW = b"\x24\x50"
# Decoded but not wired up yet — the modulated page is still to come.
OPCODE_LTE_MODULATED = b"\x23\x50"

# Powering the modem up is slow: it is a full radio boot, not a register write.
# The 5 s default used for LoRa commands is not enough and times out on a cold
# modem, so every caller of modem_on wants this instead.
MODEM_ON_TIMEOUT_S = 10.0

# 0.01 dBm per count: the captured 23 dBm frame carries 2300, confirmed against
# the firmware. Kept named because the UI works in dBm and only the wire uses
# centi-dBm.
TX_POWER_SCALE = 100

# The modem's ceiling. Above this the firmware is being asked for power it
# cannot produce, so it is rejected at the edge rather than clamped silently.
MAX_TX_POWER_DBM = 23


class LteTstrfCmd(IntEnum):
    """`Tstrf_cmd` — what the test command should do.

    Only the two values seen in captures are named. The field is a uint8 and
    the firmware presumably defines more (RX test, and whatever 0 and 2 are);
    add them here as they turn up rather than guessing now.
    """

    ABORT_TEST = 1
    START_TX_TEST = 3


@dataclass
class LteCwParams:
    """HWTP_MODEM_TEST_RF_CW — opcode 24 50, 17-byte payload.

        off  size     field
          0  u8       tstrf_cmd
          1  u32 LE   earfcn
          5  u32 LE   time_ms            (milliseconds)
          9  u32 LE   tx_power           (0.01 dBm)
         13  i32 LE   offset_hz          (Hz, signed)

    Verified against both captured frames:

        24 50 11 00 | 03 D4 49 00 00 40 0D 03 00 00 00 00 00 00 00 00 00
          earfcn=18900 time=200000ms tx_power=0 offset=0Hz START_TX_TEST

        24 50 11 00 | 01 CF 4E 00 00 F0 49 02 00 FC 08 00 00 64 00 00 00
          earfcn=20175 time=150000ms tx_power=2300 offset=100Hz ABORT_TEST

    Every field differs between the two, so the mapping is uniquely determined
    rather than inferred from field ordering.
    """

    earfcn: int
    time_ms: int
    tx_power: int    # 0.01 dBm units — 2300 == 23.00 dBm
    offset_hz: int   # Hz, signed — offset from the channel centre
    tstrf_cmd: LteTstrfCmd = LteTstrfCmd.START_TX_TEST

    def encode(self) -> bytes:
        check_u8("tstrf_cmd", int(self.tstrf_cmd))
        check_u32("earfcn", self.earfcn)
        check_u32("time_ms", self.time_ms)
        check_u32("tx_power", self.tx_power)
        check_i32("offset_hz", self.offset_hz)
        payload = (
            bytes([int(self.tstrf_cmd)])
            + self.earfcn.to_bytes(4, "little")
            + self.time_ms.to_bytes(4, "little")
            + self.tx_power.to_bytes(4, "little")
            + self.offset_hz.to_bytes(4, "little", signed=True)
        )
        return pack_frame(OPCODE_LTE_CW, payload)


class LteBandwidth(IntEnum):
    """Channel bandwidth, as the modem numbers them.

    Two captures pin the ends of this: `BW_1_4_MHZ` is 0 and `BW_5_MHZ` is 2.
    That spacing only works if the values run in the order 3GPP lists the
    E-UTRA channel bandwidths, so the rest follow from it.
    """

    BW_1_4_MHZ = 0
    BW_3_MHZ = 1
    BW_5_MHZ = 2
    BW_10_MHZ = 3
    BW_15_MHZ = 4
    BW_20_MHZ = 5


# Resource blocks a bandwidth has to allocate from — 3GPP TS 36.101 table
# 5.6-1. Needed here rather than only in the UI because an allocation wider
# than the channel is a request the modem cannot honour, and it is better
# rejected at the edge than transmitted as something else.
RB_COUNT_FOR_BW = {
    LteBandwidth.BW_1_4_MHZ: 6,
    LteBandwidth.BW_3_MHZ: 15,
    LteBandwidth.BW_5_MHZ: 25,
    LteBandwidth.BW_10_MHZ: 50,
    LteBandwidth.BW_15_MHZ: 75,
    LteBandwidth.BW_20_MHZ: 100,
}

# I_MCS for PUSCH runs 0..28; 29-31 are reserved for retransmissions and are
# not a thing a test command asks for.
MAX_MCS = 28


@dataclass
class LteModulatedParams:
    """HWTP_MODEM_TEST_RF_MODULATED — opcode 23 50, 18-byte payload.

        off  size     field
          0  u8       tstrf_cmd
          1  u32 LE   earfcn
          5  u32 LE   time_ms            (milliseconds)
          9  u32 LE   tx_power           (0.01 dBm)
         13  u8       bandwidth          (LteBandwidth)
         14  u8       mcs
         15  u8       rb_count           Number_of_rb_allocation
         16  u8       rb_start           Position_of_rb_allocation
         17  u8       nb_index           Nb_index

    Verified against both captured frames:

        23 50 12 00 | 03 D4 49 00 00 40 0D 03 00 00 00 00 00 00 05 06 00 00
          earfcn=18900 time=200000ms tx_power=0 BW_1_4_MHZ
          mcs=5 rb_count=6 rb_start=0 nb_index=0 START_TX_TEST

        23 50 12 00 | 01 CF 4E 00 00 F0 49 02 00 FC 08 00 00 02 05 06 00 00
          earfcn=20175 time=150000ms tx_power=2300 BW_5_MHZ
          mcs=5 rb_count=6 rb_start=0 nb_index=0 ABORT_TEST

    The first 13 bytes are the CW layout exactly, and bandwidth is pinned by
    the two frames differing there (0 for BW_1_4_MHZ, 2 for BW_5_MHZ). `mcs`
    and `rb_count` are pinned by their values, 5 and 6, each appearing once.

    **`rb_start` and `nb_index` are an assumption.** Both captures carry 0 in
    both, so nothing distinguishes byte 16 from byte 17; the order here follows
    the order the other fields appear in. Anything other than 0 in either is
    therefore unverified — which is why the automation leaves both at 0 and
    only the manual tab exposes `rb_start`. A capture with one of them set
    would settle it.
    """

    earfcn: int
    time_ms: int
    tx_power: int    # 0.01 dBm units — 2300 == 23.00 dBm
    bandwidth: LteBandwidth = LteBandwidth.BW_5_MHZ
    mcs: int = 5
    rb_count: int = 6
    rb_start: int = 0
    nb_index: int = 0
    tstrf_cmd: LteTstrfCmd = LteTstrfCmd.START_TX_TEST

    def encode(self) -> bytes:
        check_u8("tstrf_cmd", int(self.tstrf_cmd))
        check_u32("earfcn", self.earfcn)
        check_u32("time_ms", self.time_ms)
        check_u32("tx_power", self.tx_power)
        check_u8("bandwidth", int(self.bandwidth))
        check_u8("mcs", self.mcs)
        check_u8("rb_count", self.rb_count)
        check_u8("rb_start", self.rb_start)
        check_u8("nb_index", self.nb_index)

        if int(self.bandwidth) not in {int(b) for b in LteBandwidth}:
            raise ValueError(f"bandwidth {self.bandwidth} is not a known channel bandwidth")
        if self.mcs > MAX_MCS:
            raise ValueError(f"mcs {self.mcs} is out of range (0-{MAX_MCS})")
        # An allocation that runs past the end of the channel is not something
        # the modem can transmit, so it is refused rather than sent and
        # silently reinterpreted.
        available = RB_COUNT_FOR_BW[LteBandwidth(self.bandwidth)]
        if self.rb_count < 1 or self.rb_count > available:
            raise ValueError(
                f"rb_count {self.rb_count} is out of range "
                f"(1-{available} for {LteBandwidth(self.bandwidth).name})"
            )
        if self.rb_start + self.rb_count > available:
            raise ValueError(
                f"rb_start {self.rb_start} + rb_count {self.rb_count} runs past "
                f"the {available} resource blocks in {LteBandwidth(self.bandwidth).name}"
            )

        payload = (
            bytes([int(self.tstrf_cmd)])
            + self.earfcn.to_bytes(4, "little")
            + self.time_ms.to_bytes(4, "little")
            + self.tx_power.to_bytes(4, "little")
            + bytes([
                int(self.bandwidth),
                self.mcs,
                self.rb_count,
                self.rb_start,
                self.nb_index,
            ])
        )
        return pack_frame(OPCODE_LTE_MODULATED, payload)
