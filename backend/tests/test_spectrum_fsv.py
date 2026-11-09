"""R&S FSV3004 over GPIB: same driver as the FSC3, a VISA link instead of a socket.

The analyzer is on another system, so these pin what decides the link and what
is sent differently, with fake links standing in for VISA and the socket.
"""
from __future__ import annotations

import asyncio

import pytest

from backend.api.instruments import spectrum as routes
from backend.api.instruments._common import DiscoverCandidate
from backend.api.instruments._state import state
from backend.hw.adapters import SpectrumPowerMeter
from backend.spectrum import is_visa_address, make_analyzer
from backend.spectrum.visa_link import VisaScpi
from backend.tests.test_spectrum_fsc3 import FakeFsc3

FSV_IDN = "Rohde&Schwarz,FSV3004,1330.5000K04/101234,1.80"


class FakeFsv(FakeFsc3):
    def query(self, cmd: str, timeout: float = 6.0) -> str:
        if cmd == "*IDN?":
            self.queries.append(cmd)
            return FSV_IDN
        return super().query(cmd, timeout)


@pytest.mark.parametrize("address, visa", [
    ("GPIB0::20::INSTR", True),
    ("TCPIP0::10.0.0.5::inst0::INSTR", True),
    ("172.16.10.1:5555", False),
    ("", False),
])
def test_the_address_picks_the_link(address, visa):
    assert is_visa_address(address) is visa
    an, where = make_analyzer(address)
    assert (an._link is VisaScpi) is visa
    assert where == (address if visa else "172.16.10.1:5555")


def test_fsv_is_told_to_send_traces_as_ascii(monkeypatch):
    monkeypatch.setattr("backend.spectrum.fsc3.time.sleep", lambda s: None)
    from backend.spectrum import Analyzer
    an = Analyzer("GPIB0::20::INSTR", 0, link=FakeFsv)
    an.connect()
    assert "FORM ASC" in an.s.sent
    assert an.read_trace()["values"] == [-80.1, -60.25, -40.5]


def test_fsc3_is_not_sent_form(monkeypatch):
    monkeypatch.setattr("backend.spectrum.fsc3.time.sleep", lambda s: None)
    from backend.spectrum import Analyzer
    an = Analyzer("172.16.10.1", 5555, link=FakeFsc3)
    an.connect()
    assert "FORM ASC" not in an.s.sent


def test_discover_offers_a_gpib_analyzer_first(monkeypatch):
    async def visa():
        return [
            DiscoverCandidate(resource="USB0::0x0957::0x0F07::MY1::INSTR", idn="Agilent,N6705B,MY1,D.01"),
            DiscoverCandidate(resource="GPIB0::20::INSTR", idn=FSV_IDN),
        ]

    monkeypatch.setattr(routes, "discover_visa", visa)
    monkeypatch.setattr(state, "spectrum_resource", None)
    out = asyncio.run(routes.discover())
    assert out.candidates == ["GPIB0::20::INSTR", "172.16.10.1:5555"]


def test_discover_still_offers_lan_without_visa(monkeypatch):
    async def visa():
        raise RuntimeError("pyvisa not installed")

    monkeypatch.setattr(routes, "discover_visa", visa)
    monkeypatch.setattr(state, "spectrum_resource", None)
    assert asyncio.run(routes.discover()).candidates == ["172.16.10.1:5555"]


def test_mode_sweep_opens_the_fsv_by_its_gpib_address(monkeypatch):
    """A sweep with no analyzer connected opens it itself, over VISA."""
    monkeypatch.setattr("backend.spectrum.fsc3.time.sleep", lambda s: None)
    opened: list[str] = []

    class Link(FakeFsv):
        def __init__(self, host: str = "", port: int = 0) -> None:
            super().__init__(host, port)
            opened.append(host)

    monkeypatch.setattr("backend.spectrum.visa_link.VisaScpi", Link)
    pm = SpectrumPowerMeter(object(), address="GPIB0::20::INSTR")
    pm.connect()
    assert opened == ["GPIB0::20::INSTR"]
    assert pm._an.idn == FSV_IDN
