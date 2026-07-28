"""Command payload encoding.

These byte layouts are the contract with the DUT firmware: a field in the wrong
order or endianness fails silently as a wrong-frequency transmission, so they
are pinned here explicitly rather than derived.
"""

from __future__ import annotations

import pytest

from backend.device import (
    OPCODE_LORA_CW_DEBUG,
    OPCODE_LORA_MODULATED,
    OPCODE_LORA_POWER,
    LoraCwParams,
    LoraModulatedParams,
    LoraPowerParams,
    Modem,
    PaMode,
)
from backend.protocol.frame import parse_frame

FREQ_902_3_MHZ = 902_300_000        # 0x35C80160
FREQ_902_3_LE = b"\x60\x01\xc8\x35"


class TestLoraCwParams:
    def test_payload_layout(self) -> None:
        frame = parse_frame(
            LoraCwParams(
                freq_hz=FREQ_902_3_MHZ,
                power_dbm=14,
                pa_duty_cycle=2,
                hp_max=7,
                pa_mode=PaMode.AUTO,
            ).encode()
        )
        assert frame.opcode == OPCODE_LORA_CW_DEBUG
        # freq(4 LE) then pa_mode, power, duty, hp — note pa_mode leads here but
        # trails in LoraPowerParams; the firmware genuinely differs.
        assert frame.payload == FREQ_902_3_LE + bytes([0x02, 14, 2, 7])

    @pytest.mark.parametrize(
        ("field", "value"),
        [("power_dbm", 256), ("pa_duty_cycle", -1), ("hp_max", 999)],
    )
    def test_rejects_out_of_range_uint8(self, field: str, value: int) -> None:
        kwargs = {"freq_hz": FREQ_902_3_MHZ, "power_dbm": 14, "pa_duty_cycle": 2, "hp_max": 7}
        kwargs[field] = value
        with pytest.raises(ValueError, match="uint8 range"):
            LoraCwParams(**kwargs).encode()

    def test_rejects_out_of_range_frequency(self) -> None:
        with pytest.raises(ValueError, match="uint32 range"):
            LoraCwParams(
                freq_hz=0x1_0000_0000, power_dbm=14, pa_duty_cycle=2, hp_max=7
            ).encode()


class TestLoraPowerParams:
    def test_payload_layout(self) -> None:
        frame = parse_frame(
            LoraPowerParams(
                freq_hz=FREQ_902_3_MHZ, power_dbm=20, pa_mode=PaMode.ON
            ).encode()
        )
        assert frame.opcode == OPCODE_LORA_POWER
        assert frame.payload == FREQ_902_3_LE + bytes([20, 0x01])

    def test_defaults_to_auto_pa_mode(self) -> None:
        frame = parse_frame(LoraPowerParams(freq_hz=FREQ_902_3_MHZ, power_dbm=20).encode())
        assert frame.payload[-1] == PaMode.AUTO


class TestLoraModulatedParams:
    def test_payload_layout(self) -> None:
        frame = parse_frame(
            LoraModulatedParams(
                bandwidth=1,
                freq_hz=FREQ_902_3_MHZ,
                power_dbm=14,
                modem=Modem.LORA,
                datarate=7,
            ).encode()
        )
        assert frame.opcode == OPCODE_LORA_MODULATED
        assert frame.payload == (
            bytes([1])
            + FREQ_902_3_LE
            + bytes([14])
            + (1).to_bytes(4, "little")   # modem is uint32, not uint8
            + (7).to_bytes(4, "little")
        )

    def test_rejects_out_of_range_datarate(self) -> None:
        with pytest.raises(ValueError, match="uint32 range"):
            LoraModulatedParams(
                bandwidth=0,
                freq_hz=FREQ_902_3_MHZ,
                power_dbm=14,
                modem=Modem.FSK,
                datarate=-1,
            ).encode()
