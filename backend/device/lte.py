"""LTE modem test commands.

Unlike LoRa, an LTE test is a *sequence*, not a single frame. The modem is
powered down at rest and will not accept a test command until it is up:

    MODEM_ON  ->  TEST_RF_CW(START_TX_TEST)  ->  ...  ->
    TEST_RF_CW(ABORT_TEST)  ->  MODEM_OFF

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
