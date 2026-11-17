"""BLE radio test commands -- the DUT's own BLE radio, not the link to it.

The awkward part is that the radio under test is also the one carrying our
commands. Both commands here end with the DUT off the link:

    TX_POWER_SET(param)  ->  SAVE_AND_RESET          the reset drops the link
    TEST_TONE_START(ch, duration, offset)            the tone drops the link
    TX_POWER_GET                                     a plain read

so a test is a sequence with a reconnect after each of them, and a tone cannot
be stopped early: there is no link to send a stop over, and the DUT does not
take a connection while it transmits. It ends when its duration runs out, and
the DUT goes back to advertising. See `BLEManager.relink` and the BLE CW page.

Payload layouts below come from frames the operator supplied. They are pinned
byte-for-byte in `backend/tests/test_ble_encoding.py`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from ..protocol import pack_frame
from .common import check_u8

OPCODE_BLE_TX_POWER_SET = b"\x31\x00"     # HWTP_SI_BLE_TX_POWER_SET
OPCODE_BLE_TX_POWER_GET = b"\x30\x00"     # its read-back
OPCODE_BLE_TONE_START = b"\x10\x21"       # HWTP_EX_BLE_TEST_TONE_START

# The tone power is a firmware parameter, not dBm, and this is the range it
# takes. Kept as the raw param end to end: the operator works in it too, and a
# dBm conversion here would be a guess.
#
# Mirrored, with the other limits here, in frontend/src/tests/ble/radio.ts.
TX_POWER_PARAM_MIN = 6
TX_POWER_PARAM_MAX = 31

# BLE RF channels 0..39 at 2402 + 2*ch MHz.
CHANNEL_MAX = 39
CHANNEL_BASE_MHZ = 2402
CHANNEL_SPACING_MHZ = 2

# Seconds. 0 is refused: whatever the firmware does with it -- no tone, or one
# that never ends -- the second is a DUT we cannot reach until it is
# power-cycled, because a running tone cannot be stopped over the air.
#
# The ceiling is 255, not 65535, on purpose. Both supplied frames carry the
# duration as `0A 00` and `96 00`, which reads equally well as a u16 LE or as a
# u8 followed by a zero byte. Up to 255 the two encodings are the same bytes;
# above it they differ, and getting it wrong would set a byte nobody has seen
# used. A frame with a duration over 255 s would settle it.
DURATION_MIN_S = 1
DURATION_MAX_S = 255


def channel_freq_hz(channel: int) -> int:
    return (CHANNEL_BASE_MHZ + CHANNEL_SPACING_MHZ * channel) * 1_000_000


def encode_tx_power_set(param: int) -> bytes:
    """``31 00 01 00 <param>`` -- e.g. ``31 00 01 00 1F`` for 31.

    Stages the power only; it takes on the save-and-reset that follows.
    """
    if not (TX_POWER_PARAM_MIN <= param <= TX_POWER_PARAM_MAX):
        raise ValueError(
            f"tone power param {param} out of range "
            f"({TX_POWER_PARAM_MIN}-{TX_POWER_PARAM_MAX})"
        )
    return pack_frame(OPCODE_BLE_TX_POWER_SET, bytes([param]))


def encode_tx_power_get() -> bytes:
    """``30 00 00 00`` -- read the tone power back."""
    return pack_frame(OPCODE_BLE_TX_POWER_GET, b"")


def decode_tx_power(data: bytes) -> int:
    """The tone power param from a ``30 00`` reply's data (after the status).

    The layout follows the DUT's read convention -- status byte, then the
    value, as every Meter Info read is -- and the value is the one-byte param
    the set takes. No reply to this opcode has been captured yet, so a value
    outside the param range is refused rather than believed: a misread here
    would let a run skip a reset and measure at the wrong power.
    """
    if not data:
        raise ValueError("tone power reply carries no value")
    v = data[0]
    if not (TX_POWER_PARAM_MIN <= v <= TX_POWER_PARAM_MAX):
        raise ValueError(
            f"tone power reply {data.hex(' ').upper()} is not a param "
            f"({TX_POWER_PARAM_MIN}-{TX_POWER_PARAM_MAX})"
        )
    return v


@dataclass
class BleTxPowerRead:
    """The read-back, decoded or not.

    `param` is None whenever the value cannot be trusted -- no reply, a
    refusal, or bytes that do not decode -- and `error` says which. The raw
    data travels either way: a layout taken from convention rather than a
    capture is exactly what needs looking at when it does not fit.
    """

    ok: bool
    status: int
    param: Optional[int]
    tx_hex: str
    rx_hex: str
    data_hex: str = ""
    error: Optional[str] = None


@dataclass
class BleToneParams:
    """HWTP_EX_BLE_TEST_TONE_START -- opcode 10 21, 4-byte payload.

        off  size     field
          0  u8       channel            (0..39, 2402 + 2*ch MHz)
          1  u8       offset             (from centre; units not stated)
          2  u16 LE   duration_s         (see DURATION_MAX_S on byte 3)

    Verified against both supplied frames:

        10 21 04 00 | 16 00 0A 00     channel=22 offset=0 duration=10 s
        10 21 04 00 | 00 05 96 00     channel=0  offset=5 duration=150 s

    Channel, offset and duration differ between the two, so their positions
    are pinned. Offset is passed through raw: its unit was not given, and the
    automation leaves it at 0.
    """

    channel: int
    duration_s: int
    offset: int = 0

    def encode(self) -> bytes:
        check_u8("channel", self.channel)
        check_u8("offset", self.offset)
        if self.channel > CHANNEL_MAX:
            raise ValueError(f"channel {self.channel} out of range (0-{CHANNEL_MAX})")
        if not (DURATION_MIN_S <= self.duration_s <= DURATION_MAX_S):
            raise ValueError(
                f"duration {self.duration_s} s out of range "
                f"({DURATION_MIN_S}-{DURATION_MAX_S} s)"
            )
        payload = (
            bytes([self.channel, self.offset])
            + self.duration_s.to_bytes(2, "little")
        )
        return pack_frame(OPCODE_BLE_TONE_START, payload)
