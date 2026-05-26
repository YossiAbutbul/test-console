"""Process-wide instrument holder shared across instrument route modules."""
from __future__ import annotations


class _Holder:
    power_sensor: object | None = None
    dc_analyzer: object | None = None
    spectrum: object | None = None
    network_analyzer: object | None = None
    power_sensor_idn: str | None = None
    dc_analyzer_idn: str | None = None
    spectrum_idn: str | None = None
    network_analyzer_idn: str | None = None
    # Track the VISA resource string each session was opened with so the
    # IDN-probe path in discovery can skip resources we already hold — opening
    # the same resource twice corrupts the live handle (VI_ERROR_INV_JOB_ID).
    dc_analyzer_resource: str | None = None
    spectrum_resource: str | None = None
    network_analyzer_resource: str | None = None
    dc_analyzer_channel: int = 1
    # Host-side marker frequencies (Hz). Measurements interpolate the swept
    # S-parameter array at these points so we get values regardless of the
    # instrument's display marker state.
    network_analyzer_markers: list[float] | None = None


state = _Holder()

# Hardware doubles the programmed voltage at the output. Halve on write,
# double on read so the API exposes the actual DUT-side volts.
DC_VOLTAGE_SCALE = 2.0
