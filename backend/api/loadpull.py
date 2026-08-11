"""Load Pull export.

Filed under `/test` so it shares the frontend's existing dev-server proxy, but
kept in its own module: unlike the sweep, this test's loop runs in the browser,
so there is no run state here to export from. The rows come up with the request.
"""
from __future__ import annotations

import asyncio
import logging
import time

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

from ..loadpull import (
    LoadPullExportRequest, LoadPullRow, build_workbook, parse_workbook,
)
from .errors import handle_driver_errors

log = logging.getLogger(__name__)

router = APIRouter(prefix="/test/load-pull", tags=["load-pull"])

XLSX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
)

#: A load pull is positions x frequencies x powers; tens of thousands of rows
#: would already be an unusable spreadsheet.
MAX_ROWS = 100_000


@router.post("/export")
async def export(req: LoadPullExportRequest) -> Response:
    if not req.rows:
        raise HTTPException(status_code=400, detail="No results to export")
    if len(req.rows) > MAX_ROWS:
        raise HTTPException(status_code=413, detail=f"Too many rows (max {MAX_ROWS})")

    with handle_driver_errors("load pull export"):
        # openpyxl rendering is CPU-bound and grows with the row count.
        data = await asyncio.to_thread(build_workbook, req.rows, req.meta)

    filename = time.strftime("load_pull_%Y%m%d_%H%M%S.xlsx")
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
