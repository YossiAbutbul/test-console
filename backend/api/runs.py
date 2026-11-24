"""One run at a time across every test that drives the rig from the backend.

Mode Sweep, Load Pull and Frequency Accuracy each refused a second start of
*their own* kind, but nothing stopped one of each: all three key the same DUT
and two of them read the same analyzer, so a second page's run would retune
the carrier under the first one's measurement.

Every start route calls `refuse_if_running` before touching hardware. The
runners are imported lazily: they import the routers' modules indirectly, and
this module is imported by those routers.

A run also holds the DUT: the device routes that would key it or change its
setup call `refuse_if_rig_busy`, so a manual Send or a Debug command cannot
land in the middle of a run's point. The ways out stay open -- stop, an LTE
abort, modem off, a power read.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/runs", tags=["runs"])


def active_run() -> str | None:
    """The name of the run currently in flight, or None."""
    from ..loadpull.runner import runner as load_pull_runner
    from ..sweep import runner as sweep_runner
    from ..sweep.models import RunState
    from ..sequence import runner as sequence_runner
    from . import freq_accuracy

    if sequence_runner.running():
        return sequence_runner.name()
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


def refuse_if_rig_busy() -> None:
    """409 when a run holds the rig, for a manual command that would key the
    DUT or change its setup mid-run. Not for stop, abort or modem off."""
    other = active_run()
    if other is not None:
        raise HTTPException(409, f"{other} is running; stop it before sending commands to the DUT")


@router.get("/active")
def get_active() -> dict:
    """The run holding the rig, if any -- for pages to disable Run and Send."""
    return {"run": active_run()}
