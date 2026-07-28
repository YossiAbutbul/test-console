"""Exception types shared between the driver layer and the API layer.

Drivers raise these; `api/errors.py` maps them to HTTP statuses. Keeping them
here means a driver never has to import anything HTTP-aware to report a
condition precisely.
"""

from __future__ import annotations


class DriverUnavailable(RuntimeError):
    """The vendor library or driver for this instrument is not installed.

    Distinct from a hardware failure: nothing the user does at runtime will fix
    it, so the API surfaces it as 501 rather than 409/500.
    """
