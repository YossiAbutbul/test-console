"""LoRa / FSK test commands.

One frame per command: the DUT's LoRa radio is always available, so a test is
started by sending the command and stopped with StopTest. Contrast `lte.py`,
where the modem has to be powered up and down around the test.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum

from ..protocol import pack_frame
from .common import check_u8, check_u32

OPCODE_LORA_CW_DEBUG = b"\x28\x50"
OPCODE_LORA_POWER = b"\x17\x50"
OPCODE_LORA_MODULATED = b"\x19\x50"


class PaMode(IntEnum):
    OFF = 0x00
    ON = 0x01
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
        check_u8("bandwidth", self.bandwidth)
        check_u32("freq_hz", self.freq_hz)
        check_u8("power_dbm", self.power_dbm)
        check_u32("datarate", self.datarate)
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
        check_u32("freq_hz", self.freq_hz)
        check_u8("power_dbm", self.power_dbm)
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
        check_u32("freq_hz", self.freq_hz)
        check_u8("power_dbm", self.power_dbm)
        check_u8("pa_duty_cycle", self.pa_duty_cycle)
        check_u8("hp_max", self.hp_max)
        payload = (
            self.freq_hz.to_bytes(4, "little")
            + bytes(
                [int(self.pa_mode), self.power_dbm, self.pa_duty_cycle, self.hp_max]
            )
        )
        return pack_frame(OPCODE_LORA_CW_DEBUG, payload)
