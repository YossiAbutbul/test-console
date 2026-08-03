"""VISA discovery must not disturb sessions that are already open.

Two separate hazards, both of which showed up as the same symptom — a
connected DC analyzer answering every later read with "InvalidSession: Invalid
session handle. The resource might be closed.":

  1. Discovery closed the `ResourceManager` when it finished. That object is a
     process-wide singleton in pyvisa, so it is the *same* manager every
     connected driver is holding: closing it ended the shared VISA session and
     invalidated every open instrument at once.

  2. The guard that skips resources we already hold compared address strings
     literally, so an address entered in a form VISA accepts but does not
     report back (`…MY123::INSTR` vs the listed `…MY123::0::INSTR`) missed, and
     discovery re-opened the live instrument.

Both are invisible until hardware is attached and are easy to reintroduce —
closing a resource you opened looks like tidy cleanup — so they are pinned
here with a fake pyvisa rather than a real instrument.
"""

from __future__ import annotations

import sys
import types
from typing import Any

import pytest

from backend.api.instruments import _common
from backend.api.instruments._common import bound_resource, list_visa_resources_idn, visa_key
from backend.api.instruments._state import state


CANON = "USB0::0x0957::0x0F07::MY50000200::0::INSTR"
ALIAS = "USB0::0x0957::0x0F07::MY50000200::INSTR"


class FakeResource:
    def __init__(self, name: str, manager: "FakeResourceManager") -> None:
        self.resource_name = name
        self._manager = manager
        self.timeout = 0
        self.closed = False

    def query(self, _cmd: str) -> str:
        if self._manager.closed:
            raise RuntimeError("InvalidSession: the manager was closed")
        return f"ACME,{self.resource_name},1.0"

    def close(self) -> None:
        self.closed = True


class FakeResourceManager:
    """Stands in for the pyvisa singleton and records what was done to it."""

    def __init__(self, resources: tuple[str, ...]) -> None:
        self._resources = resources
        self.closed = False
        self.opened: list[str] = []

    def list_resources(self) -> tuple[str, ...]:
        return self._resources

    def open_resource(self, name: str, **_kw: Any) -> FakeResource:
        self.opened.append(name)
        return FakeResource(name, self)

    def close(self) -> None:
        self.closed = True


@pytest.fixture
def fake_visa(monkeypatch: pytest.MonkeyPatch):
    """Install a fake `pyvisa` whose ResourceManager is a singleton, as the real
    one is — the singleton behaviour is the whole point of the first test."""
    def _install(resources: tuple[str, ...] = (CANON,)) -> FakeResourceManager:
        manager = FakeResourceManager(resources)
        module = types.ModuleType("pyvisa")
        module.ResourceManager = lambda *a, **k: manager  # type: ignore[attr-defined]
        monkeypatch.setitem(sys.modules, "pyvisa", module)
        return manager

    return _install


@pytest.fixture(autouse=True)
def clean_state():
    """Discovery reads process-wide session state; keep tests independent."""
    fields = (
        "dc_analyzer_resource", "spectrum_resource", "network_analyzer_resource",
        "dc_analyzer_idn", "spectrum_idn", "network_analyzer_idn",
    )
    saved = {f: getattr(state, f) for f in fields}
    for f in fields:
        setattr(state, f, None)
    yield
    for f, v in saved.items():
        setattr(state, f, v)


class TestResourceManagerLifetime:
    def test_discovery_leaves_the_shared_manager_open(self, fake_visa) -> None:
        """Closing it would invalidate every connected instrument at once."""
        manager = fake_visa()

        list_visa_resources_idn()

        assert not manager.closed, (
            "discovery closed the shared ResourceManager; every open instrument "
            "session in the process is now invalid"
        )

    def test_repeated_scans_still_leave_it_open(self, fake_visa) -> None:
        manager = fake_visa()

        for _ in range(3):
            list_visa_resources_idn()

        assert not manager.closed


class TestHeldResourcesAreNotReopened:
    def test_held_resource_is_not_opened(self, fake_visa) -> None:
        manager = fake_visa()
        state.dc_analyzer_resource = CANON
        state.dc_analyzer_idn = "Agilent,N6705B,MY50000200,D.02.08"

        out = list_visa_resources_idn()

        assert manager.opened == [], "re-opened an instrument we already hold"
        assert [c.idn for c in out] == [state.dc_analyzer_idn], (
            "a held resource should report its cached IDN, not a fresh probe"
        )

    def test_alias_form_still_matches_the_listed_address(self, fake_visa) -> None:
        """The stored address may omit the interface index the listing carries."""
        manager = fake_visa()
        state.dc_analyzer_resource = ALIAS
        state.dc_analyzer_idn = "Agilent,N6705B,MY50000200,D.02.08"

        list_visa_resources_idn()

        assert manager.opened == [], (
            "an address equivalent to the listed one was treated as a different "
            "instrument and re-opened"
        )

    def test_unheld_resource_is_still_probed(self, fake_visa) -> None:
        """The guard must not make discovery useless for what we don't hold."""
        manager = fake_visa()

        out = list_visa_resources_idn()

        assert manager.opened == [CANON]
        assert out[0].idn is not None


class TestVisaKey:
    def test_alias_and_canonical_agree(self) -> None:
        assert visa_key(ALIAS) == visa_key(CANON)

    def test_distinct_instruments_stay_distinct(self) -> None:
        other = "USB0::0x0957::0x1309::MY49102148::0::INSTR"
        assert visa_key(other) != visa_key(CANON)

    def test_case_and_padding_are_ignored(self) -> None:
        assert visa_key(f"  {CANON.lower()}  ") == visa_key(CANON)

    def test_non_usb_addresses_are_left_alone(self) -> None:
        """`inst0` is not an interface index — stripping it would merge devices."""
        assert visa_key("TCPIP0::192.168.1.5::inst0::INSTR") == (
            "TCPIP0::192.168.1.5::INST0::INSTR"
        )


class TestBoundResource:
    def test_prefers_what_visa_actually_resolved(self) -> None:
        """A blank or aliased address must not be what we record."""
        driver = types.SimpleNamespace(_dev=types.SimpleNamespace(resource_name=CANON))

        assert bound_resource(driver, ALIAS) == CANON

    def test_accepts_a_bare_resource_object(self) -> None:
        """The spectrum route stores the pyvisa resource itself, not a wrapper."""
        assert bound_resource(types.SimpleNamespace(resource_name=CANON), "") == CANON

    def test_falls_back_to_the_configured_string(self) -> None:
        """No live handle yet — the driver's own address is the best we have."""
        driver = types.SimpleNamespace(_dev=None, _resource_str=CANON)

        assert bound_resource(driver, "") == CANON

    def test_blank_connect_does_not_record_nothing(self) -> None:
        driver = types.SimpleNamespace(_dev=None, _resource_str=CANON)

        assert bound_resource(driver, "") is not None
