"""Load the instrument runtimes once, in order, before any route can.

Two native runtimes sit under the instrument drivers:

  - VISA (NI-VISA / Keysight IO Libraries), loaded by the first
    `pyvisa.ResourceManager()`: the DC analyzer, the network analyzer, a
    GPIB spectrum analyzer, VISA discovery.
  - The .NET runtime plus Mini-Circuits' assembly, loaded by pythonnet on the
    power sensor's first use.

Left to the routes, each loads on its instrument's first connect, and every
instrument has its own worker thread (`api/instruments/_bus.py`). The
frontend connects them together on page load, so the two loads ran at the
same moment on two threads -- and VISA intermittently failed with
`VI_ERROR_LIBRARY_NFOUND` in the same second the power sensor connected. The
failure is sticky: pyvisa keeps the broken library for the life of the
process, which is why a restart, sometimes two, was the only way back.

Loading both here, one after the other on one thread and before the server
answers its first request, leaves the routes only opening sessions. VISA goes
first: it is the one that failed, and nothing it loads depends on .NET.

Neither is required. A build or a PC without one logs it and carries on, and
the instrument's own connect reports the problem as it always did.
"""

from __future__ import annotations

import logging
import time

log = logging.getLogger(__name__)


def _visa() -> str:
    import pyvisa  # noqa: PLC0415 -- optional dependency

    # Not closed: `ResourceManager()` is a process-wide singleton, and this is
    # the instance every VISA driver will be handed. See the note in
    # api/instruments/_common.py.
    rm = pyvisa.ResourceManager()
    return str(rm.visalib)


def _dotnet() -> str:
    from power_sensor._clr_loader import load_usb_pm  # noqa: PLC0415 -- optional

    load_usb_pm()
    return "mcl_pm_NET45"


def preload() -> None:
    """Load each runtime, logging what loaded and what did not. Never raises."""
    for name, load in (("VISA", _visa), (".NET power sensor", _dotnet)):
        t0 = time.perf_counter()
        try:
            what = load()
        except ImportError as e:
            log.info("%s runtime not preloaded: %s (not installed)", name, e)
        except Exception as e:
            # Logged loudly: if VISA cannot load here, alone and first, it is a
            # setup problem (the wrong interpreter -- see CLAUDE.md on
            # --reload -- or no VISA installed), not the race this prevents.
            log.warning("%s runtime failed to preload: %s: %s", name, type(e).__name__, e)
        else:
            log.info("%s runtime preloaded (%s) in %.0f ms", name, what, (time.perf_counter() - t0) * 1000)
