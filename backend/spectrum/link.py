"""Which link reaches an analyzer, decided by how its address is written.

  * "172.16.10.1:5555", "host" or blank -- the FSC3 over LAN (raw socket).
  * "GPIB0::20::INSTR" or any other VISA resource (anything with "::") --
    over VISA, e.g. the FSV3004 behind a GPIB-to-USB adapter.

One place, so the Spectrum panel and a Mode Sweep that opens the analyzer
itself cannot disagree about what an address means.
"""

from __future__ import annotations

from .config import DEFAULT_HOST, DEFAULT_PORT
from .fsc3 import Analyzer


def is_visa_address(address: str) -> bool:
    return "::" in (address or "")


def parse_address(address: str) -> tuple[str, int]:
    """'host', 'host:port' or blank -> (host, port)."""
    a = (address or "").strip()
    if not a:
        return DEFAULT_HOST, DEFAULT_PORT
    if a.lower().startswith("tcp://"):
        a = a[6:]
    host, sep, port = a.rpartition(":")
    if not sep:
        return a, DEFAULT_PORT
    try:
        return host, int(port)
    except ValueError:
        raise ValueError(f"not a port number: {port!r}") from None


def make_analyzer(address: str) -> tuple[Analyzer, str]:
    """An unconnected Analyzer for `address`, and the address as recorded."""
    a = (address or "").strip()
    if is_visa_address(a):
        from .visa_link import VisaScpi
        return Analyzer(a, 0, link=VisaScpi), a
    host, port = parse_address(a)
    return Analyzer(host, port), f"{host}:{port}"


def no_answer_hint(address: str) -> str:
    """What to check when the analyzer does not answer, per link."""
    if is_visa_address(address):
        return ("check the GPIB cable and adapter, the analyzer's GPIB address "
                "(Setup > Network + Remote), and that the adapter's driver "
                "(NI-488.2 or Keysight IO Libraries) is installed")
    return ("check the LAN cable and that this PC is on the analyzer's subnet "
            "(172.16.10.x)")
