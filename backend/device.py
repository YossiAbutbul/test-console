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
OPCODE_LORA_POWER = b"\x17\x50"
OPCODE_LORA_MODULATED = b"\x19\x50"


class PaMode(IntEnum):
    AUTO = 0x02


class Modem(IntEnum):
    FSK = 0
    LORA = 1


@dataclass
class LoraModulatedParams:
    bandwidth: int          # uint8: 0=125k, 1=250k, 2=500k (FSK must be 0)
    freq_hz: int            # uint32 LE
    power_dbm: int          # uint8
    modem: Modem            # uint32 LE
    datarate: int           # uint32 LE: 6..12 for LoRa SF; bps for FSK

    def encode(self) -> bytes:
        _check_u8("bandwidth", self.bandwidth)
        _check_u32("freq_hz", self.freq_hz)
        _check_u8("power_dbm", self.power_dbm)
        _check_u32("datarate", self.datarate)
        payload = (
            bytes([self.bandwidth])
            + self.freq_hz.to_bytes(4, "little")
            + bytes([self.power_dbm])
            + int(self.modem).to_bytes(4, "little")
            + self.datarate.to_bytes(4, "little")
        )
        return pack_frame(OPCODE_LORA_MODULATED, payload)


@dataclass
class LoraPowerParams:
    freq_hz: int            # uint32 LE, Hz
    power_dbm: int          # uint8, positive dBm
    pa_mode: PaMode = PaMode.AUTO

    def encode(self) -> bytes:
        _check_u32("freq_hz", self.freq_hz)
        _check_u8("power_dbm", self.power_dbm)
        payload = (
            self.freq_hz.to_bytes(4, "little")
            + bytes([self.power_dbm, int(self.pa_mode)])
        )
        return pack_frame(OPCODE_LORA_POWER, payload)


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
        pa_mode: PaMode = PaMode.AUTO,
        timeout: float = 5.0,
    ) -> CommandResult:
        params = LoraPowerParams(
            freq_hz=freq_hz, power_dbm=power_dbm, pa_mode=pa_mode,
        )
        tx = params.encode()
        reply = await self._t.send(tx, timeout=timeout)
        return _make_result(tx, reply, expected_opcode=OPCODE_LORA_POWER)

    async def lora_modulated(
        self,
        bandwidth: int,
        freq_hz: int,
        power_dbm: int,
        modem: Modem,
        datarate: int,
        timeout: float = 5.0,
    ) -> CommandResult:
        params = LoraModulatedParams(
            bandwidth=bandwidth,
            freq_hz=freq_hz,
            power_dbm=power_dbm,
            modem=modem,
            datarate=datarate,
        )
        tx = params.encode()
        reply = await self._t.send(tx, timeout=timeout)
        return _make_result(tx, reply, expected_opcode=OPCODE_LORA_MODULATED)

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
