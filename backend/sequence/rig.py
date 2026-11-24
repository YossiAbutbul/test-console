"""Everything a sequence step touches, behind one interface.

As Load Pull's `Rig` (loadpull/runner.py): the run is testable without
hardware, and the live rig (api/sequence.py) calls the very functions the
device and instrument routes do -- through the same instrument buses, and
looking the DUT up per command, since a reconnect builds a new Device.

Methods raise on a failure to talk to the DUT or an instrument. A command the
DUT answered with a refusal is a result (`ok` False), not an exception.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional, Protocol

from .models import PowerSource


@dataclass
class TxResult:
    ok: bool
    status: int


@dataclass
class BleWrite:
    """A BLE write and whether the DUT answered it before the link went."""

    acknowledged: bool
    ok: bool
    status: Optional[int] = None
    error: Optional[str] = None


@dataclass
class BlePowerSet:
    set: BleWrite
    #: The save-and-reset, when the set was accepted and it was sent.
    reset: Optional[BleWrite]
    #: The link was let go for the reboot; False when the set was refused.
    released: bool


@dataclass
class Reading:
    power_dbm: Optional[float]
    current_a: Optional[float]
    voltage_v: Optional[float]
    error: Optional[str]


class Rig(Protocol):
    # LoRa
    async def lora_power(self, freq_hz: int, power_dbm: int, pa_mode: int) -> TxResult: ...
    async def lora_modulated(
        self, bandwidth: int, freq_hz: int, power_dbm: int, modem: int, datarate: int,
    ) -> TxResult: ...
    async def stop(self) -> None: ...

    # LTE
    async def lte_modem_off(self) -> TxResult: ...
    async def lte_modem_on(self) -> TxResult: ...
    async def lte_cw(self, earfcn: int, power_dbm: float, start: bool, hold: bool = False) -> TxResult:
        """`hold`: a test long enough to outlast a frequency zoom (minutes,
        aborted once measured) rather than a power read's."""
        ...
    async def lte_modulated(
        self, earfcn: int, power_dbm: float, bandwidth: int, mcs: int, rb_count: int, start: bool,
    ) -> TxResult: ...

    # BLE -- the radio under test is the one carrying the commands
    async def ble_tone(self, channel: int, duration_s: int) -> BleWrite: ...
    async def ble_power_get(self) -> Optional[int]: ...
    async def ble_power_set(self, param: int) -> BlePowerSet: ...
    async def ble_relink(self) -> None: ...

    # Instruments
    async def measure(
        self, freq_hz: int, power: PowerSource, expected_dbm: Optional[float],
    ) -> Reading: ...

    # The analyzer's frequency zoom (backend/freqacc/zoom.py), on its bus.
    async def zoom_begin(self) -> None:
        """Before a step's first point: the analyzer is there, and settings a
        power read left on it are not trusted afterwards."""
        ...
    async def zoom_prepare(self, ref_level_dbm: float) -> None: ...
    async def zoom_setup(self, n: int, stage: Any, center_hz: Optional[float]) -> None: ...
    async def zoom_measure(self, n: int, center_hz: float, stage: Any) -> dict:
        """A stage's peak: `marker_hz`, `level_dbm`, ..., and `warning` when
        it sat near the span's edge."""
        ...
    async def zoom_end(self) -> None:
        """The analyzer back to sweeping, for the Spectrum page."""
        ...
