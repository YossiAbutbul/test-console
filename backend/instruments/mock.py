import random

from .base import CurrentMeter, PowerMeter


class MockPowerMeter(PowerMeter):
    def __init__(self) -> None:
        self._freq_hz: int = 0
        self._connected = False

    def connect(self) -> None:
        self._connected = True

    def disconnect(self) -> None:
        self._connected = False

    def set_frequency_hz(self, freq_hz: int) -> None:
        self._freq_hz = freq_hz

    def read_dbm(self) -> float:
        # Fake roughly-realistic CW power around 14 dBm with small noise.
        return round(14.0 + random.uniform(-0.5, 0.5), 2)


class MockCurrentMeter(CurrentMeter):
    def __init__(self, voltage_v: float = 3.3) -> None:
        self._connected = False
        self._voltage_v = voltage_v

    def connect(self) -> None:
        self._connected = True

    def disconnect(self) -> None:
        self._connected = False

    def read_current_a(self) -> float:
        return round(0.08 + random.uniform(-0.005, 0.005), 4)

    def read_voltage_v(self) -> float:
        return self._voltage_v
