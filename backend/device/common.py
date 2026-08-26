"""Pieces every protocol's commands share: the result type and range checks.

Frame layout (both directions):
    [opcode:2][len:2 LE][payload:len]
Reply payload byte 0 = status (0 = OK).
"""

from __future__ import annotations

from dataclasses import dataclass

from ..protocol import Frame

# HWTP StopTest. Protocol-agnostic on the wire, but in practice only the LoRa
# pages use it: an LTE test is aborted by re-sending its own test command with
# tstrf_cmd=ABORT_TEST, then powering the modem down. See `lte.py`.
OPCODE_STOP_TEST = b"\x18\x50"

# The DUT needs a moment after StopTest before it will accept another test
# command. Without it, a sweep that switches TX off between points stops
# answering after two or three points and then drops the BLE link entirely.
# Measured: 0 s wedges reliably, 1.5 s runs clean.
POST_STOP_RECOVERY_S = 1.5


@dataclass
class CommandResult:
    ok: bool
    status: int
    tx: bytes
    reply: Frame

    @property
    def rx(self) -> bytes:
        return (
            self.reply.opcode
            + len(self.reply.payload).to_bytes(2, "little")
            + self.reply.payload
        )


def check_u8(name: str, val: int) -> None:
    if not (0 <= val <= 0xFF):
        raise ValueError(f"{name} out of uint8 range: {val}")


def check_u32(name: str, val: int) -> None:
    if not (0 <= val <= 0xFFFFFFFF):
        raise ValueError(f"{name} out of uint32 range: {val}")


def check_i32(name: str, val: int) -> None:
    if not (-0x8000_0000 <= val <= 0x7FFF_FFFF):
        raise ValueError(f"{name} out of int32 range: {val}")


def make_result(tx: bytes, reply: Frame, expected_opcode: bytes) -> CommandResult:
    if reply.opcode != expected_opcode:
        raise RuntimeError(
            f"Unexpected reply opcode: got {reply.opcode.hex(' ')} "
            f"expected {expected_opcode.hex(' ')}"
        )
    status = reply.payload[0] if reply.payload else 0
    return CommandResult(ok=(status == 0), status=status, tx=tx, reply=reply)
