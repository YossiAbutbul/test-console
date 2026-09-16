# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller recipe for the DUT-only desktop bundle.

Built by scripts/build-app.ps1, which is the supported way in: it makes the
build venv from requirements-desktop.txt first, and this file assumes that
venv. Running `pyinstaller TestConsole.spec` from the rig venv instead would
produce a bundle carrying pyvisa and the vendor wrappers, which would then
report instrument support it cannot deliver.

One-folder, not one-file. One-file unpacks itself into a temp directory on
every launch, which costs several seconds of apparent hang before the browser
opens and leaves nowhere stable for the app to write.
"""

from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules

SPECPATH = Path(SPECPATH)  # noqa: F821  (injected by PyInstaller)

# The built SPA, shipped as data. Built by the same script just before this
# runs -- a stale dist here is the one failure mode that produces a bundle
# which starts fine and serves last week's UI.
FRONTEND_DIST = SPECPATH / "frontend" / "dist"
if not (FRONTEND_DIST / "index.html").is_file():
    raise SystemExit(
        "frontend/dist/index.html is missing -- run `npm run build` in "
        "frontend/, or use scripts/build-app.ps1 which does it for you."
    )

hiddenimports = [
    # The routers are reached through backend.api's re-exports, which the
    # analyser does follow -- but a route module that is only ever imported
    # dynamically would be missed, and missing one shows up as a 404 on one
    # endpoint rather than as a build error. Cheap insurance.
    *collect_submodules("backend"),
    # bleak picks its backend at runtime from the platform, so the analyser
    # sees no import to follow and the bundle would raise ImportError on the
    # first scan -- the one call every user of this build makes first.
    *collect_submodules("bleak.backends.winrt"),
    # Same story for uvicorn: the protocol and lifespan implementations are
    # resolved from config strings.
    *collect_submodules("uvicorn.protocols"),
    *collect_submodules("uvicorn.lifespan"),
    *collect_submodules("uvicorn.loops"),
]

# Belt and braces. The build venv should not contain any of these, so none of
# them should be found -- but an exclude costs nothing and a rig venv used by
# mistake would otherwise silently produce a bundle claiming instrument
# support. See backend/capabilities.py for what that claim drives.
excludes = [
    "pyvisa", "pyvisa_py", "rf_instruments", "power_sensor",
    "dc_power_analyzer", "network_analyzer", "signal_generator",
    "dmx_j_sa", "clr", "pythonnet", "numpy", "serial",
    # Never imported by this app; PyInstaller otherwise drags them in through
    # optional imports in the stdlib and third-party packages.
    "tkinter", "matplotlib", "PIL", "pytest",
]

a = Analysis(  # noqa: F821
    ["backend/desktop.py"],
    pathex=[str(SPECPATH)],
    binaries=[],
    datas=[(str(FRONTEND_DIST), "frontend/dist")],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    noarchive=False,
)

pyz = PYZ(a.pure)  # noqa: F821

exe = EXE(  # noqa: F821
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="TestConsole",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    # Console, not windowed: this window is the app's only visible sign of
    # life and its stop button. Closing it stops the server gracefully, which
    # is what lets main.py's lifespan hook drop the BLE link on the way out.
    console=True,
    icon=str(SPECPATH / "frontend" / "public" / "favicon.ico")
    if (SPECPATH / "frontend" / "public" / "favicon.ico").is_file()
    else None,
)

coll = COLLECT(  # noqa: F821
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="TestConsole",
)
