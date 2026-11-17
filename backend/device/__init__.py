"""Device-under-test command surface, one module per protocol.

    common.py   frame result type, range checks, shared StopTest opcode
    lora.py     LoRa / FSK test commands
    lte.py      LTE modem test commands
    ble.py      BLE radio test commands (tone power, test tone)
    device.py   the async `Device` class that sends them

Everything public is re-exported here, so callers keep importing from
`backend.device` regardless of which protocol module a name lives in.
"""

from .common import (
    OPCODE_STOP_TEST, POST_STOP_RECOVERY_S, CommandResult,
)
from .ble import (
    DURATION_MAX_S as BLE_DURATION_MAX_S, DURATION_MIN_S as BLE_DURATION_MIN_S,
    CHANNEL_MAX as BLE_CHANNEL_MAX, OPCODE_BLE_TONE_START, OPCODE_BLE_TX_POWER_GET,
    OPCODE_BLE_TX_POWER_SET,
    TX_POWER_PARAM_MAX as BLE_TX_POWER_PARAM_MAX,
    TX_POWER_PARAM_MIN as BLE_TX_POWER_PARAM_MIN, BleToneParams, BleTxPowerRead,
    channel_freq_hz as ble_channel_freq_hz,
)
from .device import Device
from .lora import (
    OPCODE_LORA_CW_DEBUG, OPCODE_LORA_MODULATED, OPCODE_LORA_POWER,
    LoraCwParams, LoraModulatedParams, LoraPowerParams, Modem, PaMode,
)
from .lte import (
    MAX_MCS, MAX_TX_POWER_DBM, MODEM_ON_TIMEOUT_S, OPCODE_LTE_CW,
    OPCODE_LTE_MODEM_OFF, OPCODE_LTE_MODEM_ON, OPCODE_LTE_MODULATED,
    RB_COUNT_FOR_BW, TX_POWER_SCALE, LteBandwidth, LteCwParams,
    LteModulatedParams, LteTstrfCmd,
)

__all__ = [
    "BLE_CHANNEL_MAX",
    "BLE_DURATION_MAX_S",
    "BLE_DURATION_MIN_S",
    "BLE_TX_POWER_PARAM_MAX",
    "BLE_TX_POWER_PARAM_MIN",
    "BleToneParams",
    "BleTxPowerRead",
    "OPCODE_BLE_TONE_START",
    "OPCODE_BLE_TX_POWER_GET",
    "OPCODE_BLE_TX_POWER_SET",
    "ble_channel_freq_hz",
    "CommandResult",
    "Device",
    "LoraCwParams",
    "LoraModulatedParams",
    "LoraPowerParams",
    "LteBandwidth",
    "LteCwParams",
    "LteModulatedParams",
    "LteTstrfCmd",
    "MAX_MCS",
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
    "RB_COUNT_FOR_BW",
    "PaMode",
    "TX_POWER_SCALE",
]
