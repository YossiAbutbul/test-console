"""Load Pull export.

Filed under `/test` so it shares the frontend's existing dev-server proxy, but
kept in its own module: unlike the sweep, this test's loop runs in the browser,
so there is no run state here to export from. The rows come up with the request.
"""
from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

from ..ble import manager
from ..loadpull import (
    LoadPullExportRequest, LoadPullMeta, LoadPullRow, build_workbook, parse_workbook,
)
from ..workbook import export_filename
from .errors import handle_driver_errors
from .instruments._state import state

log = logging.getLogger(__name__)

router = APIRouter(prefix="/test/load-pull", tags=["load-pull"])

XLSX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)

#: A load pull is positions x frequencies x powers; tens of thousands of rows
#: would already be an unusable spreadsheet.
MAX_ROWS = 100_000


#: The test slug in export filenames -- see `export_filename`.
EXPORT_SLUG = "load-pull"


def _with_rig(meta: LoadPullMeta | None) -> LoadPullMeta:
    """Fill in the bench from what this process holds, where the client left it.

    The run loop is in the browser, but the instrument sessions it measured
    through are the ones `/instruments` keeps here, so the backend is the side
    that can name them. Read from the holder only -- no instrument is queried.
    Anything the client did send wins: it was there for the run.
    """
    meta = meta or LoadPullMeta()
    ble = manager.status()
    # The connected device's name only describes the file's DUT if it *is* that
    # DUT -- the operator may have moved on to the next board before exporting.
    same_dut = meta.dut_mac is None or (ble.address or "").lower() == meta.dut_mac.lower()
    fill = {
        "dut_mac": ble.address,
        "dut_name": ble.name if same_dut else None,
        "power_sensor_idn": state.power_sensor_idn if state.power_sensor is not None else None,
        "dc_analyzer_idn": state.dc_analyzer_idn if state.dc_analyzer is not None else None,
        "dc_analyzer_address": state.dc_analyzer_resource if state.dc_analyzer is not None else None,
        "dc_channel": state.dc_analyzer_channel if state.dc_analyzer is not None else None,
    }
    return meta.model_copy(update={
        k: v for k, v in fill.items() if getattr(meta, k) is None and v is not None
    })


@router.post("/export")
async def export(req: LoadPullExportRequest) -> Response:
    if not req.rows:
        raise HTTPException(status_code=400, detail="No results to export")
    if len(req.rows) > MAX_ROWS:
        raise HTTPException(status_code=413, detail=f"Too many rows (max {MAX_ROWS})")

    # A request without meta still gets no Run sheet, as before: it is the
    # client saying it has nothing to record, not an invitation to invent one.
    meta = _with_rig(req.meta) if req.meta is not None else None

    with handle_driver_errors("load pull export"):
        # openpyxl rendering is CPU-bound and grows with the row count.
        data = await asyncio.to_thread(build_workbook, req.rows, meta)

    filename = export_filename(meta.dut_mac if meta else manager.status().address, EXPORT_SLUG, "xlsx")
    return Response(
        content=data,
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


#: A Load Pull workbook is a few thousand rows at most.
MAX_IMPORT_BYTES = 25 * 1024 * 1024


@router.post("/import", response_model=list[LoadPullRow])
async def import_xlsx(request: Request) -> list[LoadPullRow]:
    """Read a previously exported workbook back into rows.

    Raw body rather than a multipart upload: that needs no `python-multipart`
    dependency, and the client has a single file to send.
    """
    data = await request.body()
    if not data:
        raise HTTPException(status_code=400, detail="No file received")
    if len(data) > MAX_IMPORT_BYTES:
        raise HTTPException(status_code=413, detail="File too large")

    try:
        return await asyncio.to_thread(parse_workbook, data)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Could not read the workbook: {e}") from e
