"""R&S FSC3 (LAN) and FSV3000 (GPIB via VISA) spectrum analyzers.

Ported from the FSC3 control panel in github.com/YossiAbutbul/current-logger
(`fscapp/scpi.py`, `panelapp/analyzer.py`, `panelapp/config.py` at 519c009),
where every command was verified against the real analyzer. The instrument
quirks recorded there are kept with the code they shaped.
"""
from .fsc3 import Analyzer
from .link import is_visa_address, make_analyzer, no_answer_hint, parse_address
from .config import (
    DEFAULT_HOST, DEFAULT_PORT, DETECTORS, DETECTOR_NAMES, MARKERS,
    TRACE_MODES, TRACE_MODE_NAMES,
)

__all__ = [
    "Analyzer", "is_visa_address", "make_analyzer", "no_answer_hint", "parse_address",
    "DEFAULT_HOST", "DEFAULT_PORT", "DETECTORS", "DETECTOR_NAMES",
    "MARKERS", "TRACE_MODES", "TRACE_MODE_NAMES",
]
