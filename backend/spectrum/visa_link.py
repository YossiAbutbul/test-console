"""SCPI over VISA, for an analyzer on GPIB (or any VISA resource).

The R&S FSV3004 on the second system is reached through a GPIB-to-USB
adapter, so it is a VISA resource ("GPIB0::20::INSTR") rather than a socket.
The command set is the same R&S SCPI the FSC3 module already speaks; only the
transport differs. This class gives `Analyzer` the same four calls `Scpi`
does -- write, query, error, close -- so nothing above the link changes.

A GPIB adapter needs its own driver on the PC (NI-488.2 for an NI GPIB-USB-HS,
Keysight IO Libraries for an 82357B) before VISA can list GPIB0 at all.
"""

from __future__ import annotations

import threading
from typing import Any


class VisaScpi:
    def __init__(self, resource: str, port: int | None = None, timeout: float = 6.0) -> None:
        del port  # the socket link's signature; a VISA resource carries its own address
        import pyvisa  # type: ignore

        # The process-wide manager every VISA driver here shares: never close
        # it (see list_visa_resources_idn in backend/api/instruments/_common.py).
        rm = pyvisa.ResourceManager()
        self.inst: Any = rm.open_resource(resource, open_timeout=int(timeout * 1000))
        self.inst.timeout = int(timeout * 1000)
        # The FSV ends every response with LF (and EOI on GPIB); without the
        # read termination a query would wait for the timeout instead.
        self.inst.read_termination = "\n"
        self.inst.write_termination = "\n"
        # TRAC:DATA? is ~1000 values of ~14 characters: well over the default
        # 20 kB chunk is not needed, but a larger chunk saves round trips.
        self.inst.chunk_size = 256 * 1024
        self.lock = threading.Lock()
        self.host, self.port = resource, 0

    def write(self, cmd: str) -> None:
        with self.lock:
            self.inst.write(cmd)

    def query(self, cmd: str, timeout: float = 6.0) -> str:
        with self.lock:
            self.inst.timeout = int(timeout * 1000)
            return str(self.inst.query(cmd)).strip()

    def error(self) -> str | None:
        """Return an error string, or None when the error queue is clean."""
        e = self.query("SYST:ERR?")
        return None if e.startswith("0,") or e.startswith("+0,") else e

    def close(self) -> None:
        # Hand the front panel back: GPIB leaves the analyzer in remote, its
        # keys locked, until something sends go-to-local.
        try:
            import pyvisa  # type: ignore
            self.inst.control_ren(pyvisa.constants.RENLineOperation.address_gtl)
        except Exception:  # noqa: BLE001 -- not every interface supports it
            pass
        try:
            self.inst.close()
        except Exception:  # noqa: BLE001 -- the link is going either way
            pass
