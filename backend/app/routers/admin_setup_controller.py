import json
import os
import asyncio
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.services.db_service import async_session
from app.utils.validation import safe_filename, validate_excel, MAX_FILE_SIZE
from seed_db import seed_system_data
from seed_admin import seed_super_admin
import logging

router = APIRouter(prefix="/admin/setup", tags=["Admin Setup"])
logger = logging.getLogger(__name__)

async def get_db():
    async with async_session() as session:
        yield session

async def _require_uninitialized(db: AsyncSession):
    from app.models.user import User
    result = await db.execute(select(func.count()).select_from(User))
    if result.scalar() > 0:
        raise HTTPException(status_code=400, detail="System already initialized")

async def _setup_import_stream(
    file: UploadFile,
    processor,
    label: str,
    content: Optional[bytes] = None,
):
    if not os.path.exists("temp_downloads"):
        os.makedirs("temp_downloads")
    filename = file.filename or "upload.xlsx"
    if not validate_excel(filename):
        yield f"data: {json.dumps({'type': 'error', 'message': 'Invalid file type. Only .xlsx files are allowed.'})}\n\n"
        return
    safe_name = safe_filename(filename)
    file_path = f"temp_downloads/{safe_name}"
    try:
        if content is None:
            raise RuntimeError("Upload content must be read before streaming")
        if len(content) > MAX_FILE_SIZE:
            yield f"data: {json.dumps({'type': 'error', 'message': 'File too large. Max 50 MB.'})}\n\n"
            return
        with open(file_path, "wb") as buffer:
            buffer.write(content)
        progress_queue = asyncio.Queue()
        async def progress(msg: str):
            await progress_queue.put(msg)
        async def run_processor():
            try:
                result = await processor(file_path, progress_callback=progress)
                if isinstance(result, tuple) and len(result) >= 3:
                    count, ids, error = result[0], result[1], result[2]
                elif isinstance(result, tuple) and len(result) == 2:
                    count, error = result
                    ids = []
                else:
                    count, error = 0, str(result)
                    ids = []
                await progress_queue.put(("__result__", count, ids, error))
            except Exception as e:
                await progress_queue.put(("__result__", 0, [], str(e)))
        task = asyncio.create_task(run_processor())
        while True:
            item = await progress_queue.get()
            if isinstance(item, tuple) and item[0] == "__result__":
                _, count, ids, error = item
                if error:
                    yield f"data: {json.dumps({'type': 'error', 'message': str(error)})}\n\n"
                else:
                    yield f"data: {json.dumps({'type': 'complete', 'message': f'Successfully imported {count} records.', 'count': count})}\n\n"
                break
            else:
                yield f"data: {json.dumps({'type': 'progress', 'message': item})}\n\n"
        await task
    finally:
        if os.path.exists(file_path):
            os.remove(file_path)

@router.get("/status")
async def get_system_status(db: AsyncSession = Depends(get_db)):
    from app.models.user import User
    result = await db.execute(select(func.count()).select_from(User))
    user_count = result.scalar()
    return {"initialized": user_count > 0, "user_count": user_count}

@router.post("/initialize-system")
async def initialize_system(db: AsyncSession = Depends(get_db)):
    try:
        await seed_system_data(db)
        await seed_super_admin()
        return {"message": "System initialized successfully with permissions, roles, and super admin."}
    except Exception as e:
        logger.error(f"Initialization Error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"System initialization failed: {str(e)}")

@router.post("/import/houses")
async def setup_import_houses(file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    from app.services.Automation.house_excel import process_house_excel
    content = await file.read(MAX_FILE_SIZE + 1)
    return StreamingResponse(_setup_import_stream(file, process_house_excel, "🏠 Houses", content), media_type="text/event-stream")

@router.post("/import/bts")
async def setup_import_bts(file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    from app.services.Automation.bts_excel import process_bts_excel
    content = await file.read(MAX_FILE_SIZE + 1)
    return StreamingResponse(_setup_import_stream(file, process_bts_excel, "📡 BTS", content), media_type="text/event-stream")

@router.post("/import/employees")
async def setup_import_employees(file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    from app.services.Automation.employee_excel import process_employee_excel
    content = await file.read(MAX_FILE_SIZE + 1)
    return StreamingResponse(_setup_import_stream(file, process_employee_excel, "👤 Employees", content), media_type="text/event-stream")

@router.post("/import/users")
async def setup_import_users(file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    from app.services.Automation.user_excel import process_user_excel
    content = await file.read(MAX_FILE_SIZE + 1)
    return StreamingResponse(_setup_import_stream(file, process_user_excel, "👥 Users", content), media_type="text/event-stream")

@router.post("/import/retailers")
async def setup_import_retailers(file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    from app.services.Automation.retailer_excel import process_retailer_excel
    content = await file.read(MAX_FILE_SIZE + 1)
    return StreamingResponse(_setup_import_stream(file, process_retailer_excel, "🏪 Retailers", content), media_type="text/event-stream")

@router.post("/import/routes")
async def setup_import_routes(
    request: Request,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    from app.models.role import Role
    from app.models.user import User
    from app.services.route_list_excel import import_route_list
    from app.utils.activity_logger import log_activity

    super_admin = (
        await db.execute(
            select(User)
            .join(User.roles)
            .where(
                User.status == "Active",
                func.lower(Role.name).in_(("super admin", "super_admin")),
            )
            .options(selectinload(User.roles))
            .order_by(User.id)
        )
    ).scalars().first()
    if super_admin is None:
        raise HTTPException(status_code=400, detail="System is not initialized")

    async def process_route_list(file_path: str, progress_callback=None):
        try:
            content = await asyncio.to_thread(Path(file_path).read_bytes)
            report = await import_route_list(db, content, super_admin)
            await log_activity(
                db,
                super_admin.id,
                super_admin.name,
                "routes",
                "import",
                new_values=report,
                request=request,
                status_code=200,
                commit=False,
            )
            await db.commit()
        except Exception:
            await db.rollback()
            raise

        imported_count = sum(
            report[key] for key in ("created", "updated", "unchanged")
        )
        return imported_count, None

    return StreamingResponse(
        _setup_import_stream(
            file,
            process_route_list,
            "Routes",
            await file.read(MAX_FILE_SIZE + 1),
        ),
        media_type="text/event-stream",
    )
