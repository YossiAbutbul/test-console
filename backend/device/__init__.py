"""Device-under-test command surface, one module per protocol.

    common.py   frame result type, range checks, shared StopTest opcode
    lora.py     LoRa / FSK test commands
    lte.py      LTE modem test commands
    device.py   the async `Device` class that sends them

Everything public is re-exported here, so callers keep importing from
`backend.device` regardless of which protocol module a name lives in.
"""

from .common import (
    OPCODE_STOP_TEST, POST_STOP_RECOVERY_S, CommandResult,
)
from .device import Device
from .lora import (
    OPCODE_LORA_CW_DEBUG, OPCODE_LORA_MODULATED, OPCODE_LORA_POWER,
    LoraCwParams, LoraModulatedParams, LoraPowerParams, Modem, PaMode,
)
from .lte import (
    MAX_TX_POWER_DBM, MODEM_ON_TIMEOUT_S, OPCODE_LTE_CW, OPCODE_LTE_MODEM_OFF,
    OPCODE_LTE_MODEM_ON, OPCODE_LTE_MODULATED, TX_POWER_SCALE,
    LteCwParams, LteTstrfCmd,
)

__all__ = [
    "CommandResult",
    "Device",
    "LoraCwParams",
    "LoraModulatedParams",
    "LoraPowerParams",
    "LteCwParams",
    "LteTstrfCmd",
    "MAX_TX_POWER_DBM",
    "MODEM_ON_TIMEOUT_S",
    "Modem",
    "OPCODE_LORA_CW_DEBUG",
    "OPCODE_LORA_MODULATED",
    "OPCODE_LORA_POWER",
    "OPCODE_LTE_CW",
    "OPCODE_LTE_MODEM_OFF",
    "OPCODE_LTE_MODEM_ON",
    "OPCODE_LTE_MODULATED",
    "OPCODE_STOP_TEST",
    "POST_STOP_RECOVERY_S",
    "PaMode",
    "TX_POWER_SCALE",
]
