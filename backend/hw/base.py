"""Instrument abstractions. Concrete adapters in real.py / mock.py."""

from __future__ import annotations

from abc import ABC, abstractmethod


class MeasurementError(RuntimeError):
    pass


class PowerMeter(ABC):
    @abstractmethod
    def connect(self) -> None: ...

    @abstractmethod
    def disconnect(self) -> None: ...

    @abstractmethod
    def set_frequency_hz(self, freq_hz: int) -> None:
        """Set calibration frequency so reading is accurate."""

    @abstractmethod
    def read_dbm(self) -> float:
        """Read averaged TX power in dBm."""


class CurrentMeter(ABC):
    @abstractmethod
    def connect(self) -> None: ...

    @abstractmethod
    def disconnect(self) -> None: ...

    @abstractmethod
    def read_current_a(self) -> float:
        """Read instantaneous current in Amps."""

    @abstractmethod
    def read_voltage_v(self) -> float:
        """Read instantaneous voltage in Volts (DUT supply)."""
