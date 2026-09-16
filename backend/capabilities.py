"""What this build of the app can actually talk to.

There are two ways this backend gets run:

  * On the rig, from the venv, with every vendor package installed. Everything
    is available.
  * As the frozen desktop bundle on someone else's PC, built DUT-only. The
    instrument packages (pyvisa, the rf-instruments wrappers, the Arcus motor
    wrapper) are deliberately left out of that bundle -- they are useless
    without the hardware and its drivers, and they triple the download.

The instrument routes already fail honestly in the second case: every vendor
import is deferred to call time and raises `DriverUnavailable`, which the
routes map to 501. But a 501 arrives only *after* the operator has picked a
test, set it up and pressed Run. This module is how the UI knows up front, so
it can grey the page out and say why instead.

Detection is by what is importable rather than by a build-time flag baked into
the bundle. A flag can disagree with reality -- a bundle built DUT-only but
flagged otherwise, or a venv missing a package it thinks it has -- and the
failure that follows is the confusing kind. What is importable is the same
question the route itself will ask at connect time, so the badge in the UI and
the behaviour of the button cannot drift apart.
"""

from __future__ import annotations

import importlib.util
import os
from functools import lru_cache

#: Vendor packages the rig pages need, mapped to what the operator would call
#: the thing. Keys are import names; `pyvisa` covers the spectrum analyser, the
#: network analyser and the DC analyser, which all go over VISA.
_RIG_MODULES: dict[str, str] = {
    "pyvisa": "VISA instruments",
    "power_sensor": "Mini-Circuits power sensor",
    "dc_power_analyzer": "DC power analyser",
    "dmx_j_sa": "Arcus trombone motor",
}

_TRUE = {"1", "true", "yes", "on"}
_FALSE = {"0", "false", "no", "off"}


def _importable(name: str) -> bool:
    """Whether `name` could be imported, without importing it.

    Not a plain `find_spec` call: `find_spec` imports the *parent* package of a
    dotted name, and raises rather than returning None when a package is
    installed but broken. Neither should look like anything other than "not
    available" here, since the point is to answer without side effects.
    """
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


@lru_cache(maxsize=1)
def _probe() -> tuple[bool, tuple[str, ...]]:
    missing = tuple(
        label for name, label in _RIG_MODULES.items() if not _importable(name)
    )
    return (not missing, missing)


def instruments() -> tuple[bool, list[str]]:
    """`(available, missing)` for the rig hardware as a whole.

    All-or-nothing on purpose. The two builds that exist are "everything" and
    "nothing", and a half-built bundle is a mistake rather than a mode worth
    modelling in the UI. `missing` is still itemised so the message can say
    which packages were looked for.

    INSTRUMENTS_ENABLED overrides the probe in both directions, which is what
    makes the DUT-only UI reachable from the rig venv for a look without
    building a bundle.
    """
    override = os.getenv("INSTRUMENTS_ENABLED", "").strip().lower()
    available, missing = _probe()
    if override in _TRUE:
        return True, []
    if override in _FALSE:
        return False, list(missing) or ["disabled by INSTRUMENTS_ENABLED"]
    return available, list(missing)
