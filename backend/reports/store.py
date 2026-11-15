"""Product reports on disk: one JSON file per product under data_root()/reports.

Files rather than a database: a report is small, read whole and written whole,
and a folder of JSON is something an operator can copy, back up or hand over
without the app. Writes go through a temp file and a rename, so a crash or a
full disk mid-write leaves the previous report rather than half of one.
"""

from __future__ import annotations

import os
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from ..paths import data_root
from .models import (
    Block, Entry, EntryIn, EntrySummary, Product, ProductIn, ProductListItem, ProductPatch, ReportStyle,
    Template, TemplateIn, default_blocks,
)

_lock = threading.Lock()


class NotFound(Exception):
    pass


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


class ReportStore:
    def __init__(self, root: Optional[Path] = None) -> None:
        self._root = root

    @property
    def root(self) -> Path:
        # Resolved per call, not at import: tests point it at a temp dir.
        d = self._root or (data_root() / "reports")
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _path(self, pid: str) -> Path:
        # Ids are ours (hex); anything else is not a report of ours.
        if not pid or not all(c in "0123456789abcdef" for c in pid):
            raise NotFound(pid)
        return self.root / f"{pid}.json"

    def _read(self, pid: str) -> Product:
        p = self._path(pid)
        if not p.is_file():
            raise NotFound(pid)
        return Product.model_validate_json(p.read_text(encoding="utf-8"))

    def _write(self, prod: Product) -> None:
        p = self._path(prod.id)
        tmp = p.with_suffix(".json.tmp")
        tmp.write_text(prod.model_dump_json(indent=1), encoding="utf-8")
        os.replace(tmp, p)

    # --- products --------------------------------------------------------

    def list(self) -> list[ProductListItem]:
        out = []
        with _lock:
            for f in self.root.glob("*.json"):
                if f.name == "style.json":
                    continue
                try:
                    prod = Product.model_validate_json(f.read_text(encoding="utf-8"))
                except Exception:  # noqa: BLE001 -- one unreadable file must not hide the rest
                    continue
                out.append(ProductListItem(
                    id=prod.id, name=prod.name, notes=prod.notes,
                    created_at=prod.created_at, updated_at=prod.updated_at,
                    entry_count=len(prod.entries),
                    units=len({e.dut.mac for e in prod.entries if e.dut.mac}),
                ))
        return sorted(out, key=lambda p: p.updated_at, reverse=True)

    def create(self, body: ProductIn) -> Product:
        now = _now()
        blocks = default_blocks()
        if body.template_id:
            blocks = _fresh_ids(self.get_template(body.template_id).blocks)
        prod = Product(id=uuid.uuid4().hex[:12], name=body.name.strip(), notes=body.notes,
                       created_at=now, updated_at=now, blocks=blocks)
        with _lock:
            self._write(prod)
        return prod

    def get(self, pid: str) -> Product:
        with _lock:
            return self._read(pid)

    def update(self, pid: str, patch: ProductPatch) -> Product:
        with _lock:
            prod = self._read(pid)
            if patch.name is not None:
                prod.name = patch.name.strip()
            if patch.notes is not None:
                prod.notes = patch.notes
            prod.updated_at = _now()
            self._write(prod)
            return prod

    def delete(self, pid: str) -> None:
        with _lock:
            p = self._path(pid)
            if not p.is_file():
                raise NotFound(pid)
            p.unlink()

    # --- entries ---------------------------------------------------------

    def add_entry(self, pid: str, body: EntryIn) -> Entry:
        entry = Entry(**body.model_dump(), id=uuid.uuid4().hex[:12], added_at=_now(),
                      summary=summarize(body.columns, body.rows))
        with _lock:
            prod = self._read(pid)
            prod.entries.append(entry)
            # A layout with an "All runs" block lists the new run there;
            # one without gets the run as a block of its own at the end, so
            # an added run is never missing from the document.
            if not any(b.type == "all_entries" for b in prod.blocks):
                prod.blocks.append(Block(id=_bid(), type="entry", entry_id=entry.id))
            prod.updated_at = entry.added_at
            self._write(prod)
        return entry

    def delete_entry(self, pid: str, eid: str) -> Product:
        with _lock:
            prod = self._read(pid)
            kept = [e for e in prod.entries if e.id != eid]
            if len(kept) == len(prod.entries):
                raise NotFound(eid)
            prod.entries = kept
            # A run's own block goes with it; a chart of it stays, empty, to be
            # pointed at another run.
            prod.blocks = [
                b.model_copy(update={"entry_id": None, "image_id": None}) if b.type == "chart" and b.entry_id == eid else b
                for b in prod.blocks if not (b.type == "entry" and b.entry_id == eid)
            ]
            prod.updated_at = _now()
            self._write(prod)
            return prod

    def reorder(self, pid: str, ids: list[str]) -> Product:
        """Entries in the order given; any not named keep their order after
        them, so a stale list from another window cannot drop an entry."""
        with _lock:
            prod = self._read(pid)
            by_id = {e.id: e for e in prod.entries}
            first = [by_id.pop(i) for i in ids if i in by_id]
            prod.entries = first + [e for e in prod.entries if e.id in by_id]
            prod.updated_at = _now()
            self._write(prod)
            return prod


    # --- layout ----------------------------------------------------------

    def set_blocks(self, pid: str, blocks: list[Block]) -> Product:
        with _lock:
            prod = self._read(pid)
            known = {e.id for e in prod.entries}
            # A block for a run that is gone (removed in another window) is
            # dropped rather than printed as a hole.
            prod.blocks = [
                b.model_copy(update={"entry_id": None}) if b.type == "chart" and b.entry_id not in known else b
                for b in blocks if b.type != "entry" or b.entry_id in known
            ]
            prod.updated_at = _now()
            self._write(prod)
            return prod

    def apply_template(self, pid: str, tid: str) -> Product:
        t = self.get_template(tid)
        with _lock:
            prod = self._read(pid)
            prod.blocks = _fresh_ids(t.blocks)
            prod.updated_at = _now()
            self._write(prod)
            return prod

    # --- style -----------------------------------------------------------

    def get_style(self) -> ReportStyle:
        p = self.root / "style.json"
        try:
            return ReportStyle.model_validate_json(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return ReportStyle()

    def set_style(self, style: ReportStyle) -> ReportStyle:
        with _lock:
            p = self.root / "style.json"
            tmp = p.with_suffix(".json.tmp")
            tmp.write_text(style.model_dump_json(indent=1), encoding="utf-8")
            os.replace(tmp, p)
        return style

    # --- templates -------------------------------------------------------

    @property
    def _tdir(self) -> Path:
        d = self.root / "templates"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _tpath(self, tid: str) -> Path:
        if not tid or not all(c in "0123456789abcdef" for c in tid):
            raise NotFound(tid)
        return self._tdir / f"{tid}.json"

    def list_templates(self) -> list[Template]:
        out = []
        with _lock:
            for f in self._tdir.glob("*.json"):
                try:
                    out.append(Template.model_validate_json(f.read_text(encoding="utf-8")))
                except Exception:  # noqa: BLE001
                    continue
        return sorted(out, key=lambda t: t.name.lower())

    def save_template(self, body: TemplateIn) -> Template:
        """A layout without its runs: a template is for products it has not
        met, so a block naming one run would print nothing there. A layout
        that showed runs one by one gets an "All runs" block in their place."""
        blocks: list[Block] = []
        for b in body.blocks:
            if b.type == "entry":
                if not any(x.type == "all_entries" for x in blocks):
                    blocks.append(Block(id=_bid(), type="all_entries"))
                continue
            if b.type == "chart":
                # The chart's form (which columns, what kind) is kept; the run
                # it plotted and its picture belong to that product.
                b = b.model_copy(update={"entry_id": None, "image_id": None})
            blocks.append(b)
        t = Template(id=uuid.uuid4().hex[:12], name=body.name.strip(), blocks=blocks, created_at=_now())
        with _lock:
            p = self._tpath(t.id)
            p.write_text(t.model_dump_json(indent=1), encoding="utf-8")
        return t

    def get_template(self, tid: str) -> Template:
        p = self._tpath(tid)
        if not p.is_file():
            raise NotFound(tid)
        return Template.model_validate_json(p.read_text(encoding="utf-8"))

    def delete_template(self, tid: str) -> None:
        with _lock:
            p = self._tpath(tid)
            if not p.is_file():
                raise NotFound(tid)
            p.unlink()


IMAGE_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/bmp": ".bmp"}
MAX_IMAGE_BYTES = 15 * 1024 * 1024


class BadImage(Exception):
    pass


def _images_dir(store: "ReportStore") -> Path:
    d = store.root / "images"
    d.mkdir(parents=True, exist_ok=True)
    return d


def save_image(store: "ReportStore", data: bytes, content_type: str) -> str:
    """Keep a picture for a report and return its id. Shared by id rather
    than owned by a product, so a template's logo needs no copying. Only the
    formats Word embeds; the page converts anything else to PNG first."""
    ext = IMAGE_TYPES.get(content_type.split(";")[0].strip().lower())
    if not ext:
        raise BadImage(f"not a picture Word can embed ({content_type or 'no type'})")
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise BadImage("empty, or larger than 15 MB")
    iid = uuid.uuid4().hex[:16]
    (_images_dir(store) / f"{iid}{ext}").write_bytes(data)
    return iid


def image_path(store: "ReportStore", iid: str) -> Optional[Path]:
    if not iid or not all(c in "0123456789abcdef" for c in iid):
        return None
    for f in _images_dir(store).glob(f"{iid}.*"):
        return f
    return None


def _bid() -> str:
    return uuid.uuid4().hex[:10]


def _fresh_ids(blocks: list[Block]) -> list[Block]:
    """A template's blocks with ids of their own, so two reports made from
    one template never share a block id."""
    return [b.model_copy(update={"id": _bid()}) for b in blocks]


def summarize(columns: list[str], rows: list[list]) -> EntrySummary:
    """Points, and pass/fail from the table's Verdict column when it has one
    (every exported results table does; its cells read "pass" or "fail")."""
    idx = next((i for i, c in enumerate(columns) if c.strip().lower() == "verdict"), None)
    passed = failed = 0
    if idx is not None:
        for r in rows:
            v = str(r[idx]).strip().lower() if idx < len(r) and r[idx] is not None else ""
            if v.startswith("pass"):
                passed += 1
            elif v.startswith("fail"):
                failed += 1
    return EntrySummary(points=len(rows), passed=passed, failed=failed)


store = ReportStore()


