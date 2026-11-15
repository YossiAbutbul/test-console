"""Product reports: create a product, add a run to it, export it as Word.

A report is the runs an operator chose to keep for one product model, from
any number of units; each test page posts its own results table to it with
"Add to report" (see backend/reports/models.py for the entry's shape). Stored
as one JSON file per product under data_root()/reports.
"""

from __future__ import annotations

import re
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse

from ..reports.docx_export import build_docx
from ..reports.models import (
    ApplyTemplate, BlocksIn, Entry, EntryIn, EntryOrder, Product, ProductIn, ProductListItem, ProductPatch,
    ReportStyle, Template, TemplateIn,
)
from ..reports import store as store_mod
from ..reports.store import BadImage, NotFound, image_path, save_image, store

router = APIRouter(prefix="/reports", tags=["reports"])

DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def _get(pid: str) -> Product:
    try:
        return store.get(pid)
    except NotFound:
        raise HTTPException(404, "No such report") from None


@router.get("", response_model=list[ProductListItem])
async def list_reports() -> list[ProductListItem]:
    return store.list()


@router.post("", response_model=Product)
async def create_report(body: ProductIn) -> Product:
    if not body.name.strip():
        raise HTTPException(422, "A report needs a product name")
    try:
        return store.create(body)
    except NotFound:
        raise HTTPException(404, "No such template") from None


# Templates before /{pid}: declared after, "templates" would be read as an id.

@router.get("/templates", response_model=list[Template])
async def list_templates() -> list[Template]:
    return store.list_templates()


@router.post("/templates", response_model=Template)
async def save_template(body: TemplateIn) -> Template:
    if not body.name.strip():
        raise HTTPException(422, "A template needs a name")
    return store.save_template(body)


@router.delete("/templates/{tid}")
async def delete_template(tid: str) -> dict:
    try:
        store.delete_template(tid)
    except NotFound:
        raise HTTPException(404, "No such template") from None
    return {"ok": True}


@router.get("/style", response_model=ReportStyle)
async def get_style() -> ReportStyle:
    return store_mod.store.get_style()


@router.put("/style", response_model=ReportStyle)
async def set_style(body: ReportStyle) -> ReportStyle:
    if body.logo_image_id and image_path(store_mod.store, body.logo_image_id) is None:
        raise HTTPException(404, "No such picture")
    return store_mod.store.set_style(body)


# Pictures. Sent as the raw body, as the workbook import is, so the backend
# needs no multipart dependency.

@router.post("/images")
async def upload_image(request: Request) -> dict:
    data = await request.body()
    try:
        iid = save_image(store_mod.store, data, request.headers.get("content-type", ""))
    except BadImage as e:
        raise HTTPException(415, f"Could not keep the picture: {e}") from None
    return {"id": iid}


@router.get("/images/{iid}")
async def get_image(iid: str) -> FileResponse:
    p = image_path(store_mod.store, iid)
    if p is None:
        raise HTTPException(404, "No such picture")
    return FileResponse(p, headers={"Cache-Control": "max-age=31536000, immutable"})


@router.get("/{pid}", response_model=Product)
async def get_report(pid: str) -> Product:
    return _get(pid)


@router.patch("/{pid}", response_model=Product)
async def update_report(pid: str, patch: ProductPatch) -> Product:
    try:
        return store.update(pid, patch)
    except NotFound:
        raise HTTPException(404, "No such report") from None


@router.delete("/{pid}")
async def delete_report(pid: str) -> dict:
    try:
        store.delete(pid)
    except NotFound:
        raise HTTPException(404, "No such report") from None
    return {"ok": True}


@router.put("/{pid}/blocks", response_model=Product)
async def set_blocks(pid: str, body: BlocksIn) -> Product:
    try:
        return store.set_blocks(pid, body.blocks)
    except NotFound:
        raise HTTPException(404, "No such report") from None


@router.post("/{pid}/apply-template", response_model=Product)
async def apply_template(pid: str, body: ApplyTemplate) -> Product:
    try:
        return store.apply_template(pid, body.template_id)
    except NotFound:
        raise HTTPException(404, "No such report or template") from None


@router.post("/{pid}/entries", response_model=Entry)
async def add_entry(pid: str, body: EntryIn) -> Entry:
    try:
        return store.add_entry(pid, body)
    except NotFound:
        raise HTTPException(404, "No such report") from None


@router.delete("/{pid}/entries/{eid}", response_model=Product)
async def delete_entry(pid: str, eid: str) -> Product:
    try:
        return store.delete_entry(pid, eid)
    except NotFound:
        raise HTTPException(404, "No such report or entry") from None


@router.put("/{pid}/entries/order", response_model=Product)
async def reorder_entries(pid: str, body: EntryOrder) -> Product:
    try:
        return store.reorder(pid, body.ids)
    except NotFound:
        raise HTTPException(404, "No such report") from None


def _slug(name: str) -> str:
    """A product name made safe for a filename: "Sonata 2 IL rev B" ->
    "Sonata-2-IL-rev-B"."""
    s = re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip("-.")
    return s[:60] or "product"


@router.get("/{pid}/export.docx")
async def export_docx(pid: str) -> Response:
    prod = _get(pid)
    # Imported here, not at the top: backend.main imports this router.
    from ..main import APP_VERSION
    st = store_mod.store.get_style()
    data = build_docx(prod, APP_VERSION, lambda iid: image_path(store_mod.store, iid),
                      logo=image_path(store_mod.store, st.logo_image_id) if st.logo_image_id else None)
    ts = datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
    filename = f"{_slug(prod.name)}_report_{ts}.docx"
    return Response(
        content=data,
        media_type=DOCX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
