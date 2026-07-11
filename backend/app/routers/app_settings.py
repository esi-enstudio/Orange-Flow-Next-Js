import os, shutil, logging
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional
from app.routers.deps import get_db, has_permission, get_current_user, get_house_context
from app.models.app_setting import AppSetting
from app.models.house import House

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings", tags=["App Settings"])

UPLOAD_DIR = "uploads/brand"

class AppSettingUpdate(BaseModel):
    app_name: Optional[str] = None

class DailySyncToggle(BaseModel):
    enabled: bool

@router.get("/brand")
async def get_brand_settings(
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user),
):
    result = await db.execute(select(AppSetting).where(AppSetting.id == 1))
    setting = result.scalar_one_or_none()
    if not setting:
        setting = AppSetting(id=1, app_name="OrangeFlow")
        db.add(setting)
        await db.commit()
        await db.refresh(setting)
    return {
        "app_name": setting.app_name,
        "logo": f"/uploads/brand/{setting.logo}" if setting.logo else None,
        "is_daily_sync_enabled": bool(setting.is_daily_sync_enabled),
    }

@router.put("/brand")
async def update_brand_settings(
    data: AppSettingUpdate,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(has_permission("app_settings.manage")),
):
    result = await db.execute(select(AppSetting).where(AppSetting.id == 1))
    setting = result.scalar_one_or_none()
    if not setting:
        setting = AppSetting(id=1)
        db.add(setting)
    if data.app_name is not None:
        setting.app_name = data.app_name
    await db.commit()
    await db.refresh(setting)
    return {
        "app_name": setting.app_name,
        "logo": f"/uploads/brand/{setting.logo}" if setting.logo else None,
        "is_daily_sync_enabled": bool(setting.is_daily_sync_enabled),
    }

@router.get("/daily-sync")
async def get_daily_sync_status(
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user),
):
    result = await db.execute(select(AppSetting).where(AppSetting.id == 1))
    setting = result.scalar_one_or_none()
    if not setting:
        return {"enabled": True}
    return {"enabled": bool(setting.is_daily_sync_enabled)}

@router.put("/daily-sync")
async def toggle_daily_sync(
    data: DailySyncToggle,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(has_permission("app_settings.manage")),
):
    result = await db.execute(select(AppSetting).where(AppSetting.id == 1))
    setting = result.scalar_one_or_none()
    if not setting:
        setting = AppSetting(id=1)
        db.add(setting)
    setting.is_daily_sync_enabled = 1 if data.enabled else 0
    await db.commit()
    await db.refresh(setting)
    status = "🟢 ON" if data.enabled else "🔴 OFF"
    logger.info(f"Daily sync {status}")
    return {"enabled": bool(setting.is_daily_sync_enabled)}

@router.get("/live-sync")
async def get_live_sync_status(
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user),
    house_context: Optional[int] = Depends(get_house_context),
):
    if house_context:
        result = await db.execute(select(House.is_live_sync_enabled).where(House.id == house_context))
        enabled = result.scalar()
        if enabled is None:
            return {"enabled": True}
        return {"enabled": bool(enabled)}
    result = await db.execute(select(AppSetting).where(AppSetting.id == 1))
    setting = result.scalar_one_or_none()
    if not setting:
        return {"enabled": True}
    return {"enabled": bool(setting.is_live_sync_enabled)}

@router.put("/live-sync")
async def toggle_live_sync(
    data: DailySyncToggle,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(has_permission("app_settings.manage")),
    house_context: Optional[int] = Depends(get_house_context),
):
    if house_context:
        result = await db.execute(select(House).where(House.id == house_context))
        house = result.scalar_one_or_none()
        if not house:
            raise HTTPException(status_code=404, detail="House not found")
        house.is_live_sync_enabled = data.enabled
        await db.commit()
        await db.refresh(house)
        status = "🟢 ON" if data.enabled else "🔴 OFF"
        logger.info(f"Live sync {status} for house {house.name} ({house_context})")
        return {"enabled": bool(house.is_live_sync_enabled)}
    result = await db.execute(select(AppSetting).where(AppSetting.id == 1))
    setting = result.scalar_one_or_none()
    if not setting:
        setting = AppSetting(id=1)
        db.add(setting)
    setting.is_live_sync_enabled = 1 if data.enabled else 0
    await db.commit()
    await db.refresh(setting)
    status = "🟢 ON" if data.enabled else "🔴 OFF"
    logger.info(f"Live sync {status} (global)")
    return {"enabled": bool(setting.is_live_sync_enabled)}

@router.post("/brand/logo")
async def upload_logo(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user = Depends(has_permission("app_settings.manage")),
):
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    ext = os.path.splitext(file.filename)[1] if file.filename else ".png"
    filename = f"logo{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    with open(filepath, "wb") as f:
        content = await file.read()
        f.write(content)
    result = await db.execute(select(AppSetting).where(AppSetting.id == 1))
    setting = result.scalar_one_or_none()
    if not setting:
        setting = AppSetting(id=1)
        db.add(setting)
    setting.logo = filename
    await db.commit()
    return {"logo": f"/uploads/brand/{filename}"}
