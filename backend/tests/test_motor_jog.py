"""The continuous jog's safety stops, against a fake motor.

A jog is the one motion that runs until something stops it, so what stops it
is pinned here: the deadman when the page's keepalives stop, and the soft
limit.
"""
from __future__ import annotations

import time

import pytest

from backend.motor import manager


class FakeMotor:
    def __init__(self) -> None:
        self.position = 0
        self.jogging = 0
        self.stops = 0
        self.high_speed = 5000

    def is_moving(self) -> bool:
        return self.jogging != 0

    def jog_positive(self) -> None:
        self.jogging = 1

    def jog_negative(self) -> None:
        self.jogging = -1

    def stop(self) -> None:
        self.jogging = 0
        self.stops += 1


@pytest.fixture
def motor(monkeypatch):
    m = FakeMotor()
    monkeypatch.setattr(manager.state, "motor", m)
    monkeypatch.setattr(manager.state, "soft_min", None)
    monkeypatch.setattr(manager.state, "soft_max", None)
    monkeypatch.setattr(manager, "JOG_DEADMAN_S", 0.15)
    yield m
    manager.jog_stop()


def wait_until(cond, timeout=1.0) -> bool:
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        if cond():
            return True
        time.sleep(0.01)
    return False


def test_a_jog_with_no_keepalive_stops_itself(motor) -> None:
    manager.jog_start(True)
    assert motor.jogging == 1
    assert wait_until(lambda: motor.jogging == 0), "the deadman never stopped the jog"


def test_keepalives_hold_the_jog(motor) -> None:
    manager.jog_start(True)
    for _ in range(6):
        time.sleep(0.05)
        manager.jog_keepalive()
    assert motor.jogging == 1
    assert wait_until(lambda: motor.jogging == 0)


def test_the_soft_limit_still_stops_it(monkeypatch, motor) -> None:
    monkeypatch.setattr(manager.state, "soft_max", 100)
    monkeypatch.setattr(manager, "JOG_DEADMAN_S", 5.0)
    manager.jog_start(True)
    motor.position = 150
    assert wait_until(lambda: motor.jogging == 0)
