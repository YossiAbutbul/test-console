"""Adapters for the rf-instrument-wrappers package.

Imported lazily so backend runs without the library installed.
Install: pip install git+https://github.com/YossiAbutbul/rf-instrument-wrappers
"""

from __future__ import annotations

from typing import Optional

from .base import CurrentMeter, MeasurementError, PowerMeter


class MiniCircuitsPowerMeter(PowerMeter):
    def __init__(
        self,
        serial: Optional[str] = None,
        average_count: Optional[int] = 2,
        averaging_enabled: Optional[bool] = True,
        use_immediate: bool = False,
    ) -> None:
        self._serial = serial
        self._sensor = None
        self._average_count = average_count
        self._averaging_enabled = averaging_enabled
        self._use_immediate = use_immediate

    def connect(self) -> None:
        try:
            from power_sensor import PowerSensor  # type: ignore
        except ImportError as e:
            raise MeasurementError(
                "power_sensor package not installed"
            ) from e
        s = PowerSensor()
        s.connect(self._serial)
        if self._averaging_enabled is not None:
            s.averaging_enabled = self._averaging_enabled
        if self._average_count is not None:
            s.average_count = self._average_count
        self._sensor = s

    def disconnect(self) -> None:
        if self._sensor is not None:
            try:
                self._sensor.disconnect()
            finally:
                self._sensor = None

    def set_frequency_hz(self, freq_hz: int) -> None:
        if self._sensor is None:
            raise MeasurementError("not connected")
        self._sensor.frequency_mhz = freq_hz / 1e6

    def read_dbm(self) -> float:
        if self._sensor is None:
            raise MeasurementError("not connected")
        reader = (
            self._sensor.read_immediate_power
            if self._use_immediate
            else self._sensor.read_power
        )
        # Retry briefly on sentinel; accept if DUT genuinely silent.
        import time as _t
        last = -999.0
        for _ in range(5):
            v = float(reader("dBm"))
            last = v
            if v > -100.0:
                return v
            _t.sleep(0.1)
        return last


class KeysightDCPowerAnalyzer(CurrentMeter):
    """Adapter for dc_power_analyzer.DCPowerAnalyzer.

    Assumes output already enabled and voltage set by user. We only measure.
    """

    def __init__(
        self,
        resource: Optional[str] = None,
        channel: int = 1,
    ) -> None:
        self._resource = resource
        self._channel = channel
        self._analyzer = None

    def connect(self) -> None:
        try:
            from dc_power_analyzer import DCPowerAnalyzer  # type: ignore
        except ImportError as e:
            raise MeasurementError(
                "dc_power_analyzer package not installed"
            ) from e
        a = DCPowerAnalyzer(resource=self._resource) if self._resource else DCPowerAnalyzer()
        a.connect()
        self._analyzer = a

    def disconnect(self) -> None:
        if self._analyzer is not None:
            try:
                self._analyzer.disconnect()
            finally:
                self._analyzer = None

    def read_current_a(self) -> float:
        if self._analyzer is None:
            raise MeasurementError("not connected")
        return float(self._analyzer.measure_current(self._channel))

    def read_voltage_v(self) -> float:
        if self._analyzer is None:
            raise MeasurementError("not connected")
        return float(self._analyzer.measure_voltage(self._channel))
