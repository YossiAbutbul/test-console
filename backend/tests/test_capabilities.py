"""What a build says it can drive has to match what it can actually import.

This is the switch the desktop bundle hangs on: the UI greys out every rig page
when it reports False, so a wrong answer here is either a rig with half its
pages disabled or a bundle offering pages that fail at connect time.

The routes are called as functions rather than over HTTP, for the reason given
in test_chat_switch.py -- FastAPI's TestClient needs httpx, which this backend
does not otherwise require.
"""
from __future__ import annotations

import asyncio

from backend import capabilities
from backend.main import get_capabilities


def _fresh():
    """Drop the probe cache so a monkeypatched import map is actually seen."""
    capabilities._probe.cache_clear()


def test_available_when_every_vendor_package_imports(monkeypatch):
    _fresh()
    monkeypatch.delenv("INSTRUMENTS_ENABLED", raising=False)
    monkeypatch.setattr(capabilities, "_importable", lambda name: True)
    _fresh()
    assert capabilities.instruments() == (True, [])


def test_unavailable_names_what_is_missing(monkeypatch):
    _fresh()
    monkeypatch.delenv("INSTRUMENTS_ENABLED", raising=False)
    monkeypatch.setattr(capabilities, "_importable", lambda name: name != "pyvisa")
    _fresh()
    available, missing = capabilities.instruments()
    assert available is False
    # The label, not the import name: this reaches the operator in a tooltip.
    assert missing == ["VISA instruments"]


def test_one_missing_package_disables_the_lot(monkeypatch):
    """All-or-nothing on purpose -- see `instruments`."""
    _fresh()
    monkeypatch.delenv("INSTRUMENTS_ENABLED", raising=False)
    monkeypatch.setattr(capabilities, "_importable", lambda name: name != "dmx_j_sa")
    _fresh()
    assert capabilities.instruments()[0] is False


def test_env_override_both_ways(monkeypatch):
    _fresh()
    monkeypatch.setattr(capabilities, "_importable", lambda name: False)
    _fresh()
    for value in ("1", "true", "yes", "on", "ON"):
        monkeypatch.setenv("INSTRUMENTS_ENABLED", value)
        assert capabilities.instruments() == (True, []), value

    monkeypatch.setattr(capabilities, "_importable", lambda name: True)
    _fresh()
    for value in ("0", "false", "no", "off"):
        monkeypatch.setenv("INSTRUMENTS_ENABLED", value)
        assert capabilities.instruments()[0] is False, value

    # Anything else is not an override, it is noise; the probe decides.
    monkeypatch.setenv("INSTRUMENTS_ENABLED", "maybe")
    assert capabilities.instruments()[0] is True


def test_a_broken_package_reads_as_missing(monkeypatch):
    """`find_spec` raises rather than returning None for some broken installs.

    That has to look like "not available" and not like a 500 from the route --
    the whole point of this module is to answer without side effects.
    """
    _fresh()
    monkeypatch.delenv("INSTRUMENTS_ENABLED", raising=False)

    def boom(name, package=None):
        raise ValueError("__spec__ is not set")

    monkeypatch.setattr(capabilities.importlib.util, "find_spec", boom)
    _fresh()
    assert capabilities.instruments()[0] is False


def test_route_shape(monkeypatch):
    """The UI destructures these two keys; renaming one silently breaks it."""
    _fresh()
    monkeypatch.delenv("INSTRUMENTS_ENABLED", raising=False)
    monkeypatch.setattr(capabilities, "_importable", lambda name: True)
    _fresh()
    body = asyncio.run(get_capabilities())
    assert body == {"instruments": True, "missing": []}
