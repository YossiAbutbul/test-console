"""Driver exception → HTTP status mapping.

Every router used to spell out its own try/except ladder, and the same
exception mapped to different statuses depending on which router caught it —
`RuntimeError` was a 409 in one file and a 400 in another. Routes now wrap
driver calls in `handle_driver_errors()` so the mapping is stated once.

Drivers stay HTTP-agnostic: they raise plain Python exceptions, and only this
module knows about status codes.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import contextmanager
from typing import Iterator

from fastapi import HTTPException

from ..errors import DriverUnavailable

log = logging.getLogger(__name__)

__all__ = ["DriverUnavailable", "handle_driver_errors"]


@contextmanager
def handle_driver_errors(what: str) -> Iterator[None]:
    """Translate driver exceptions into the HTTP status the client expects.

    - `DriverUnavailable` / `ImportError` → 501, the driver is missing
    - `ValueError`                       → 400, the request itself was wrong
    - `RuntimeError`                     → 409, hardware is in the wrong state
    - `TimeoutError`                     → 504, hardware did not answer
    - anything else                      → 500, with the type name preserved

    `what` names the operation and is prefixed to the detail, so a 409 reads
    "motor move: not connected" rather than a bare "not connected".
    """
    try:
        yield
    except HTTPException:
        # Already carries an intended status — let it through untouched.
        raise
    except (DriverUnavailable, ImportError) as e:
        raise HTTPException(status_code=501, detail=f"{what}: {e}") from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"{what}: {e}") from e
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=f"{what}: {e}") from e
    except (asyncio.TimeoutError, TimeoutError) as e:
        raise HTTPException(status_code=504, detail=f"{what}: timed out") from e
    except Exception as e:
        log.exception("%s failed", what)
        raise HTTPException(
            status_code=500, detail=f"{what}: {type(e).__name__}: {e}"
        ) from e
