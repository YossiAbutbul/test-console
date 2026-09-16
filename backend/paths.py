"""Where things live, under both ways of running this.

From the repo, every path is relative to the checkout and the checkout is
writable. Frozen into the desktop bundle, neither holds: the code and the built
SPA are read-only files inside the bundle directory (which may sit in Program
Files), and anything the app writes has to go somewhere else entirely.

Nothing here decides *whether* the app is frozen beyond `sys.frozen`, which
PyInstaller sets on the interpreter it builds. Keep it that way -- a second
signal for the same fact is a second thing to get out of step.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

#: True when running from the PyInstaller bundle rather than the repo.
FROZEN = getattr(sys, "frozen", False)

#: Root of the *source* tree. Meaningless when frozen -- use the named paths
#: below instead, which is why this is private.
_REPO_ROOT = Path(__file__).resolve().parent.parent


def _bundle_root() -> Path:
    """The directory PyInstaller unpacked the bundled data into."""
    # _MEIPASS is the one-file temp dir; under one-folder it is the app dir.
    # Both are what `datas` entries in the spec resolve against.
    return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))


def asset_root() -> Path:
    """Where read-only files that ship with the app are."""
    return _bundle_root() if FROZEN else _REPO_ROOT


def frontend_dist() -> Path:
    """The built SPA. Served by main.py; absent in a source checkout that has
    not run `npm run build`, which the caller is expected to tolerate."""
    return asset_root() / "frontend" / "dist"


def data_root() -> Path:
    """Where the app may write.

    In the repo that is the checkout, so a quota file or a saved workbook lands
    where the operator can see it and git ignores it. Frozen, the bundle
    directory is the wrong answer twice over -- it can be read-only, and under
    one-file it is a temp dir that evaporates on exit -- so writes go to the
    per-user application data directory, which is the one place a Windows app
    can always write without asking for anything.
    """
    if not FROZEN:
        return _REPO_ROOT
    base = os.getenv("LOCALAPPDATA") or os.getenv("APPDATA")
    root = Path(base) / "TestConsole" if base else Path.home() / ".test-console"
    root.mkdir(parents=True, exist_ok=True)
    return root
