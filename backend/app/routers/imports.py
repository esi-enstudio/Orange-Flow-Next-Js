import os
import json
import asyncio
import shutil
from typing import Optional

from fastapi import APIRouter, Depends, File, UploadFile, Form, Query, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.routers.deps import get_db, has_permission, get_house_context, get_current_user
from app.models.user import User
from app.utils.validation import safe_filename, validate_excel, MAX_FILE_SIZE
from app.services.Automation.activation_excel import process_activation_excel
from app.services.Automation.live_activation_excel import process_live_activation_excel
from app.services.Automation.issue_reports_excel import process_scratch_card_excel, process_sim_issue_excel
from app.services.Automation.target_excel import process_target_excel_unified
from app.services.Automation.dms_report_excel import process_dms_report_excel
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["imports (SSE streaming)"])

async def _import_file_stream(file: UploadFile, processor, permission: str, current_user: User, **kwargs):
    if not os.path.exists("temp_downloads"): os.makedirs("temp_downloads")
    filename = file.filename or "upload.xlsx"
    if not validate_excel(filename):
        yield f"data: {json.dumps({'type': 'error', 'message': 'Invalid file type. Only .xlsx and .xls files are allowed.'})}\n\n"
        return
    safe_name = safe_filename(filename)
    file_path = f"temp_downloads/{safe_name}"
    total_bytes = 0
    try:
        with open(file_path, "wb") as buffer:
            while chunk := await file.read(1024 * 1024):
                total_bytes += len(chunk)
                if total_bytes > MAX_FILE_SIZE:
                    yield f"data: {json.dumps({'type': 'error', 'message': 'File too large. Maximum size is 50 MB.'})}\n\n"
                    return
                buffer.write(chunk)
        progress_queue = asyncio.Queue()
        async def progress(msg: str):
            await progress_queue.put(msg)
        async def run_processor():
            try:
                count, error = await processor(file_path, progress_callback=progress, **kwargs)
                await progress_queue.put(("__result__", count, error))
            except Exception as e:
                await progress_queue.put(("__result__", 0, str(e)))
        task = asyncio.create_task(run_processor())
        while True:
            item = await progress_queue.get()
            if isinstance(item, tuple) and item[0] == "__result__":
                _, count, error = item
                if error:
                    yield f"data: {json.dumps({'type': 'error', 'message': error})}\n\n"
                else:
                    yield f"data: {json.dumps({'type': 'complete', 'message': f'Successfully imported {count} records.', 'count': count})}\n\n"
                break
            else:
                yield f"data: {json.dumps({'type': 'progress', 'message': item})}\n\n"
        await task
    finally:
        if os.path.exists(file_path): os.remove(file_path)

@router.post("/activations/import")
async def import_activations(file: UploadFile = File(...), current_user: User = Depends(has_permission("activations.import")), house_id: Optional[int] = Depends(get_house_context)):
    if not house_id:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            house_id = user_house_ids[0]
    return StreamingResponse(_import_file_stream(file, process_activation_excel, "activations.import", current_user, house_id=house_id), media_type="text/event-stream")

@router.post("/itopup-details/import")
async def import_itopup_details(file: UploadFile = File(...), report_type: str = Form("C2C"), current_user: User = Depends(has_permission("itopup.import")), house_id: Optional[int] = Depends(get_house_context)):
    return StreamingResponse(_import_file_stream(file, process_dms_report_excel, "itopup.import", current_user, report_type=report_type, target_house_id=house_id), media_type="text/event-stream")

@router.post("/live-activations/import")
async def import_live_activations(file: UploadFile = File(...), current_user: User = Depends(has_permission("live_activations.import"))):
    return StreamingResponse(_import_file_stream(file, process_live_activation_excel, "live_activations.import", current_user), media_type="text/event-stream")

@router.post("/scratch-card/import")
async def import_scratch_card(file: UploadFile = File(...), current_user: User = Depends(has_permission("scratch_card.import"))):
    return StreamingResponse(_import_file_stream(file, process_scratch_card_excel, "scratch_card.import", current_user), media_type="text/event-stream")

@router.post("/sim-issues/import")
async def import_sim_issues(file: UploadFile = File(...), current_user: User = Depends(has_permission("sim_issues.import"))):
    return StreamingResponse(_import_file_stream(file, process_sim_issue_excel, "sim_issues.import", current_user), media_type="text/event-stream")

@router.post("/house-targets/import")
async def import_house_targets(file: UploadFile = File(...), current_user: User = Depends(has_permission("targets.import"))):
    from datetime import datetime
    return StreamingResponse(_import_file_stream(file, process_target_excel_unified, "targets.import", current_user, target_date=datetime.now()), media_type="text/event-stream")

@router.post("/supervisor-targets/import")
async def import_supervisor_targets(file: UploadFile = File(...), current_user: User = Depends(has_permission("targets.import"))):
    from datetime import datetime
    return StreamingResponse(_import_file_stream(file, process_target_excel_unified, "targets.import", current_user, target_date=datetime.now()), media_type="text/event-stream")

@router.post("/rso-targets/import")
async def import_rso_targets(file: UploadFile = File(...), current_user: User = Depends(has_permission("targets.import"))):
    from datetime import datetime
    return StreamingResponse(_import_file_stream(file, process_target_excel_unified, "targets.import", current_user, target_date=datetime.now()), media_type="text/event-stream")
