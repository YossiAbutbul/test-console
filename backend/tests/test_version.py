"""The release version is written in three places; they have to agree.

VERSION at the repo root is the source, scripts/release.ps1 copies it into the
backend (shown at /docs) and frontend/package.json. A hand edit to one of them
would ship a build that names a different release than its tag.
"""
from __future__ import annotations

import json
from pathlib import Path

from backend.main import APP_VERSION

ROOT = Path(__file__).resolve().parents[2]


def _version_file() -> str:
    return (ROOT / "VERSION").read_text(encoding="utf-8").strip()


def test_backend_matches_version_file():
    assert APP_VERSION == _version_file()


def test_frontend_matches_version_file():
    pkg = json.loads((ROOT / "frontend" / "package.json").read_text(encoding="utf-8"))
    assert pkg["version"] == _version_file()
