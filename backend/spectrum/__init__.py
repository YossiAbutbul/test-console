"""R&S FSC3 spectrum analyzer over LAN.

Ported from the FSC3 control panel in github.com/YossiAbutbul/current-logger
(`fscapp/scpi.py`, `panelapp/analyzer.py`, `panelapp/config.py` at 519c009),
where every command was verified against the real analyzer. The instrument
quirks recorded there are kept with the code they shaped.
"""
from .fsc3 import Analyzer
from .config import (
    DEFAULT_HOST, DEFAULT_PORT, DETECTORS, DETECTOR_NAMES, MARKERS,
    TRACE_MODES, TRACE_MODE_NAMES,
)

__all__ = [
    "Analyzer", "DEFAULT_HOST", "DEFAULT_PORT", "DETECTORS", "DETECTOR_NAMES",
    "MARKERS", "TRACE_MODES", "TRACE_MODE_NAMES",
]
