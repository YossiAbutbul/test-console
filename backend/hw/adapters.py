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
        session: object | None = None,
    ) -> None:
        """`session` borrows an already-open PowerSensor instead of opening one.

        Re-opening a USB power sensor that another part of the process already
        holds invalidates the live handle, so a sweep must reuse the session
        from `/instruments` when one exists rather than opening a second.
        """
        self._serial = serial
        self._sensor = session
        self._owned = session is None
        self._average_count = average_count
        self._averaging_enabled = averaging_enabled
        self._use_immediate = use_immediate

    def connect(self) -> None:
        if self._sensor is not None:
            return  # borrowed: already open, and not ours to configure
        try:
            from power_sensor import PowerSensor  # type: ignore
        except ImportError as e:
            raise MeasurementError(
                "power_sensor package not installed"
            ) from e
        s = PowerSensor()
        sn = (self._serial or "").strip()
        # lib's connect(serial) dispatches to usb_pm.Connect_By_SN which is
        # missing on some driver builds — fall back to no-arg connect.
        if sn:
            try:
                s.connect(sn)
            except AttributeError:
                s.connect()
        else:
            s.connect()
        if self._averaging_enabled is not None:
            s.averaging_enabled = self._averaging_enabled
        if self._average_count is not None:
            s.average_count = self._average_count
        self._sensor = s

    def disconnect(self) -> None:
        if not self._owned:
            self._sensor = None  # the owner closes it
            return
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
        session: object | None = None,
    ) -> None:
        """`session` borrows an already-open analyzer — see MiniCircuitsPowerMeter."""
        self._resource = resource
        self._channel = channel
        self._analyzer = session
        self._owned = session is None

    def connect(self) -> None:
        if self._analyzer is not None:
            return  # borrowed: already open
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
        if not self._owned:
            self._analyzer = None  # the owner closes it
            return
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


class SpectrumPowerMeter(PowerMeter):
    """TX power read off the R&S FSC3 instead of the USB power sensor.

    Each read arms one sweep and takes the peak marker, so the figure belongs
    to the setting the DUT was just given -- reading the free-running trace
    could return a sweep that started before the CW command landed.

    `call` runs each analyzer operation; the sweep passes the spectrum bus's
    `call_sync` so a read can never interleave with the Spectrum page on the
    one SCPI stream. `analyzer` borrows the session `/instruments` holds.
    """

    #: One sweep at a narrow RBW can take a few seconds on the FSC3.
    SWEEP_TIMEOUT_S = 15.0

    def __init__(
        self,
        settings: object,
        analyzer: object | None = None,
        host: Optional[str] = None,
        port: Optional[int] = None,
        call=None,
    ) -> None:
        self._settings = settings
        self._an = analyzer
        self._owned = analyzer is None
        self._host, self._port = host, port
        self._call = call or (lambda fn, *a: fn(*a))

    def connect(self) -> None:
        if self._an is not None:
            return  # borrowed: already open
        from ..spectrum import DEFAULT_HOST, DEFAULT_PORT, Analyzer

        host, port = self._host or DEFAULT_HOST, self._port or DEFAULT_PORT
        an = Analyzer(host, port)
        try:
            self._call(an.connect)
        except OSError as e:
            # Says which link, as the Instruments panel's connect does: a bare
            # socket "timed out" reads as the DUT or the sensor.
            raise TimeoutError(
                f"spectrum analyzer: no SCPI answer from {host}:{port} "
                f"({type(e).__name__}: {e})"
            ) from None
        self._an = an

    def disconnect(self) -> None:
        an, self._an = self._an, None
        if an is None:
            return
        if self._owned:
            self._call(an.close)
            return

        # Borrowed: hand it back free-running, as close() would, and refresh
        # the state the Spectrum page shows -- the sweep changed it.
        def release() -> None:
            an.set_continuous(True)
            an.read_state()

        self._call(release)

    def set_frequency_hz(self, freq_hz: int) -> None:
        """Set the analyzer up for the run. Called once, before the first step."""
        an = self._an
        if an is None:
            raise MeasurementError("spectrum analyzer not connected")
        s = self._settings

        def configure() -> list[str]:
            problems = an.set_ref_offset(0)  # see SpectrumSettings: path loss is applied in software
            problems += an.set_frequency(center_hz=freq_hz, span_hz=s.span_hz)
            problems += an.set_rbw(s.rbw_hz)
            problems += an.set_vbw(s.vbw_hz)
            problems += an.set_detector(s.detector)
            problems += an.set_trace_mode("WRIT")  # a held trace would not follow the steps
            problems += an.set_marker_count(1)
            return problems

        problems = self._call(configure)
        if problems:
            # Refused before the first step: a sweep measured at settings the
            # operator did not ask for is worse than no sweep.
            raise MeasurementError("spectrum analyzer refused: " + "; ".join(problems))

    def read_dbm(self) -> float:
        an = self._an
        if an is None:
            raise MeasurementError("spectrum analyzer not connected")

        def read() -> float:
            if not an.sweep_once(timeout_s=self.SWEEP_TIMEOUT_S):
                raise MeasurementError("spectrum sweep did not finish")
            problems = an.marker_action(1, "peak")
            if problems:
                raise MeasurementError("peak search refused: " + "; ".join(problems))
            raw = an.q("CALC:MARK1:Y?")
            try:
                v = float(raw)
            except (TypeError, ValueError):
                raise MeasurementError(f"unreadable marker level {raw!r}") from None
            if abs(v) >= 1e30:  # the FSC3's 9.91e37 "no reading" sentinel
                raise MeasurementError("no marker reading")
            return v

        return self._call(read)
