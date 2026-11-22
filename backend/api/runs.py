"""One run at a time across every test that drives the rig from the backend.

Mode Sweep, Load Pull and Frequency Accuracy each refused a second start of
*their own* kind, but nothing stopped one of each: all three key the same DUT
and two of them read the same analyzer, so a second page's run would retune
the carrier under the first one's measurement.

Every start route calls `refuse_if_running` before touching hardware. The
runners are imported lazily: they import the routers' modules indirectly, and
this module is imported by those routers.
"""

from __future__ import annotations

from fastapi import HTTPException


def active_run() -> str | None:
    """The name of the run currently in flight, or None."""
    from ..loadpull.runner import runner as load_pull_runner
    from ..sweep import runner as sweep_runner
    from ..sweep.models import RunState
    from . import freq_accuracy

    if sweep_runner.status().state == RunState.RUNNING:
        return "Mode Sweep"
    if load_pull_runner.status().state == RunState.RUNNING:
        return "Load Pull"
    if freq_accuracy.running():
        return "Frequency Accuracy"
    return None


def refuse_if_running(starting: str) -> None:
    """409 when any run is in flight. A start of the same kind gets the same
    answer its own runner would give; another kind is named, so the operator
    knows which page to stop."""
    other = active_run()
    if other is None:
        return
    if other == starting:
        raise HTTPException(409, f"A {other} run is already in progress")
    raise HTTPException(409, f"{other} is running; stop it before starting {starting}")
