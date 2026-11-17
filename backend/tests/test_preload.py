"""Startup preload of the instrument runtimes (`backend/hw/preload.py`).

It exists to stop two first-time loads racing on two instrument threads, so
what it must guarantee is order and that it never stops the server starting.
"""

from __future__ import annotations

import pytest

from backend.hw import preload as mod


def test_loads_visa_before_dotnet(monkeypatch: pytest.MonkeyPatch) -> None:
    order: list[str] = []
    monkeypatch.setattr(mod, "_visa", lambda: order.append("visa") or "v")
    monkeypatch.setattr(mod, "_dotnet", lambda: order.append("dotnet") or "d")
    mod.preload()
    assert order == ["visa", "dotnet"]


@pytest.mark.parametrize("exc", [ImportError("no pyvisa"), OSError("VI_ERROR_LIBRARY_NFOUND")])
def test_a_runtime_that_will_not_load_does_not_stop_startup(
    monkeypatch: pytest.MonkeyPatch, exc: Exception,
) -> None:
    def fail() -> str:
        raise exc

    loaded: list[str] = []
    monkeypatch.setattr(mod, "_visa", fail)
    monkeypatch.setattr(mod, "_dotnet", lambda: loaded.append("dotnet") or "d")
    mod.preload()  # must not raise
    assert loaded == ["dotnet"]  # and the next runtime is still tried


def test_main_preloads_on_startup() -> None:
    import inspect

    from backend import main

    assert "preload" in inspect.getsource(main.lifespan)
