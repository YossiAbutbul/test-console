"""High-level CATM2 device commands.

Frame layout (both directions):
    [opcode:2][len:2 LE][payload:len]
Reply payload byte 0 = status (0 = OK).
"""

from dataclasses import dataclass
from enum import IntEnum

from .protocol import Frame, Transport, pack_frame


# --- Opcodes (raw 2-byte, as seen on wire) ---
OPCODE_LORA_CW_DEBUG = b"\x28\x50"
OPCODE_STOP_TEST = b"\x18\x50"
OPCODE_LORA_POWER = b"\x00\x00"  # TODO placeholder — set real opcode


class PaMode(IntEnum):
    AUTO = 0x02


@dataclass
class LoraCwParams:
    freq_hz: int            # uint32 LE, Hz
    power_dbm: int          # uint8, positive dBm
    pa_duty_cycle: int      # uint8
    hp_max: int             # uint8
    pa_mode: PaMode = PaMode.AUTO

    def encode(self) -> bytes:
        _check_u32("freq_hz", self.freq_hz)
        _check_u8("power_dbm", self.power_dbm)
        _check_u8("pa_duty_cycle", self.pa_duty_cycle)
        _check_u8("hp_max", self.hp_max)
        payload = (
            self.freq_hz.to_bytes(4, "little")
            + bytes(
                [int(self.pa_mode), self.power_dbm, self.pa_duty_cycle, self.hp_max]
            )
        )
        return pack_frame(OPCODE_LORA_CW_DEBUG, payload)


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


class Device:
    """CATM2 command surface bound to an active Transport."""

    def __init__(self, transport: Transport) -> None:
        self._t = transport

    async def lora_cw(
        self,
        freq_hz: int,
        power_dbm: int,
        pa_duty_cycle: int,
        hp_max: int,
        pa_mode: PaMode = PaMode.AUTO,
        timeout: float = 5.0,
    ) -> CommandResult:
        params = LoraCwParams(
            freq_hz=freq_hz,
            power_dbm=power_dbm,
            pa_duty_cycle=pa_duty_cycle,
            hp_max=hp_max,
            pa_mode=pa_mode,
        )
        tx = params.encode()
        reply = await self._t.send(tx, timeout=timeout)
        return _make_result(tx, reply, expected_opcode=OPCODE_LORA_CW_DEBUG)

    async def lora_power(
        self,
        freq_hz: int,
        power_dbm: int,
        pa_duty_cycle: int,
        hp_max: int,
        pa_mode: PaMode = PaMode.AUTO,
        timeout: float = 5.0,
    ) -> CommandResult:
        # TODO placeholder — payload + opcode TBD
        _check_u32("freq_hz", freq_hz)
        _check_u8("power_dbm", power_dbm)
        _check_u8("pa_duty_cycle", pa_duty_cycle)
        _check_u8("hp_max", hp_max)
        payload = (
            freq_hz.to_bytes(4, "little")
            + bytes([int(pa_mode), power_dbm, pa_duty_cycle, hp_max])
        )
        tx = pack_frame(OPCODE_LORA_POWER, payload)
        reply = await self._t.send(tx, timeout=timeout)
        return _make_result(tx, reply, expected_opcode=OPCODE_LORA_POWER)

    async def stop_test(self, timeout: float = 5.0) -> CommandResult:
        tx = pack_frame(OPCODE_STOP_TEST, b"")
        reply = await self._t.send(tx, timeout=timeout)
        return _make_result(tx, reply, expected_opcode=OPCODE_STOP_TEST)


# --- helpers ---

def _check_u8(name: str, val: int) -> None:
    if not (0 <= val <= 0xFF):
        raise ValueError(f"{name} out of uint8 range: {val}")


def _check_u32(name: str, val: int) -> None:
    if not (0 <= val <= 0xFFFFFFFF):
        raise ValueError(f"{name} out of uint32 range: {val}")


def _make_result(tx: bytes, reply: Frame, expected_opcode: bytes) -> CommandResult:
    if reply.opcode != expected_opcode:
        raise RuntimeError(
            f"Unexpected reply opcode: got {reply.opcode.hex(' ')} "
            f"expected {expected_opcode.hex(' ')}"
        )
    status = reply.payload[0] if reply.payload else 0
    return CommandResult(ok=(status == 0), status=status, tx=tx, reply=reply)
