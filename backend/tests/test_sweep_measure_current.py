"""Mode Sweep with "Measure CC" off never touches the DC analyzer.

A power-only sweep has to run on a bench with no analyzer attached. If the
route still opened one, the run would fail at instrument init for a reading
nobody asked for.
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from backend.api import test as sweep_api
from backend.sweep import SweepConfig


class FakeMeter:
    def __init__(self) -> None:
        self.connected = False

    def connect(self) -> None:
        self.connected = True

    def disconnect(self) -> None:
        self.connected = False


@pytest.fixture
def route(monkeypatch):
    started: dict = {}
    built = {"cm": 0}

    def build_cm(req):
        built["cm"] += 1
        return FakeMeter()

    async def start(config, device, pm, cm, on_finish=None, relink=None):
        started.update(config=config, pm=pm, cm=cm)
        return "status"

    fake_manager = SimpleNamespace(
        device=object(),
        status=lambda: SimpleNamespace(address=None, name=None),
        wait_for_device=lambda stale: None,
    )
    monkeypatch.setattr(sweep_api, "manager", fake_manager)
    monkeypatch.setattr(sweep_api, "_build_power_meter", lambda req: FakeMeter())
    monkeypatch.setattr(sweep_api, "_build_current_meter", build_cm)
    monkeypatch.setattr(sweep_api.runner, "start", start)
    # The route sets this module global; restored so no other test sees it.
    monkeypatch.setattr(sweep_api, "_last_rig", None)
    return started, built


def _req(measure_current: bool) -> sweep_api.StartRequest:
    cfg = SweepConfig(freq_hz=902_300_000, measure_current=measure_current)
    return sweep_api.StartRequest(config=cfg)


def test_cc_off_never_builds_the_analyzer(route):
    started, built = route
    asyncio.run(sweep_api.start(_req(False)))
    assert built["cm"] == 0
    assert started["cm"] is None
    assert started["pm"].connected


def test_cc_off_rig_names_no_analyzer(route):
    asyncio.run(sweep_api.start(_req(False)))
    rig = sweep_api._last_rig
    assert rig is not None
    assert rig.dc_analyzer_address is None and rig.dc_channel is None


def test_cc_on_by_default(route):
    started, built = route
    assert SweepConfig(freq_hz=1).measure_current is True
    asyncio.run(sweep_api.start(_req(True)))
    assert built["cm"] == 1
    assert started["cm"].connected
