"""Register repo-bundled DLL directories so instrument wrappers find them.

Must be imported BEFORE any module that imports an instrument wrapper
(power_sensor, dmx_j_sa, etc.). main.py does this at the very top.

Layout:
    backend/dlls/<device>/*.dll

For each subdirectory we:
  1. Call os.add_dll_directory() so Windows' DLL loader can resolve deps.
  2. Set the wrapper-specific env var when one is known.
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

log = logging.getLogger(__name__)

DLL_ROOT = Path(__file__).resolve().parent / "dlls"

# Wrapper-lib env vars keyed by subdir name.
_ENV_OVERRIDES = {
    "power_sensor": "MCL_PM_DLL_DIR",
}


def register() -> None:
    if sys.platform != "win32":
        return
    if not DLL_ROOT.is_dir():
        return
    add_dll_dir = getattr(os, "add_dll_directory", None)
    for sub in sorted(DLL_ROOT.iterdir()):
        if not sub.is_dir():
            continue
        dlls = list(sub.glob("*.dll"))
        if not dlls:
            continue
        if add_dll_dir is not None:
            try:
                add_dll_dir(str(sub))
            except OSError as e:
                log.warning("add_dll_directory failed for %s: %s", sub, e)
        env = _ENV_OVERRIDES.get(sub.name)
        if env and not os.environ.get(env):
            os.environ[env] = str(sub)
        log.info("DLLs registered: %s (%d dll, env=%s)", sub.name, len(dlls), env or "-")


register()
