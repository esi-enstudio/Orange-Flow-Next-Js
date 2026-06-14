from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.routers.deps import get_db, has_permission
from app.models.user import User
from app.models.house import House
from app.models.ga_section_config import GaSectionConfig
from app.utils.access_control import is_admin_user

router = APIRouter(prefix="/api/live-activations/section-configs", tags=["live-activations"])


class SectionConfigUpdate(BaseModel):
    exclude_product_codes: list[str] = []
    exclude_retailer_tags: list[str] = []
    selected_employee_ids: Optional[list[int]] = None


def get_section_keys():
    return [
        "total_activation",
        "employee_activation",
        "market_activation",
        "distribution",
        "supervisors",
        "rsos",
        "bps",
        "ccs",
        "insights",
        "trend",
    ]


@router.get("")
async def list_section_configs(
    house_id: int = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("view_live_activations")),
):
    house = await db.get(House, house_id)
    if not house:
        raise HTTPException(status_code=404, detail="House not found")

    is_admin = is_admin_user(current_user)
    if not is_admin:
        user_house_ids = [h.id for h in current_user.houses]
        if house_id not in user_house_ids:
            raise HTTPException(status_code=403, detail="Access denied")

    result = await db.execute(
        select(GaSectionConfig).where(GaSectionConfig.house_id == house_id)
    )
    configs = {c.section_key: c for c in result.scalars().all()}

    sections = []
    for key in get_section_keys():
        cfg = configs.get(key)
        sections.append({
            "section_key": key,
            "exclude_product_codes": cfg.exclude_product_codes if cfg else [],
            "exclude_retailer_tags": cfg.exclude_retailer_tags if cfg else [],
            "selected_employee_ids": cfg.selected_employee_ids if cfg else [],
            "is_active": cfg.is_active if cfg else True,
        })

    return {"sections": sections}


@router.put("/{section_key}")
async def update_section_config(
    section_key: str,
    data: SectionConfigUpdate,
    house_id: int = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("edit_reports")),
):
    if section_key not in get_section_keys():
        raise HTTPException(status_code=400, detail=f"Invalid section_key: {section_key}")

    house = await db.get(House, house_id)
    if not house:
        raise HTTPException(status_code=404, detail="House not found")

    is_admin = is_admin_user(current_user)
    if not is_admin:
        user_house_ids = [h.id for h in current_user.houses]
        if house_id not in user_house_ids:
            raise HTTPException(status_code=403, detail="Access denied")

    result = await db.execute(
        select(GaSectionConfig).where(
            and_(
                GaSectionConfig.house_id == house_id,
                GaSectionConfig.section_key == section_key,
            )
        )
    )
    cfg = result.scalar_one_or_none()

    if not cfg:
        cfg = GaSectionConfig(
            house_id=house_id,
            section_key=section_key,
        )
        db.add(cfg)

    cfg.exclude_product_codes = data.exclude_product_codes
    cfg.exclude_retailer_tags = data.exclude_retailer_tags
    if data.selected_employee_ids is not None:
        cfg.selected_employee_ids = data.selected_employee_ids
    cfg.updated_by = current_user.id
    await db.commit()
    await db.refresh(cfg)

    return {
        "section_key": cfg.section_key,
        "exclude_product_codes": cfg.exclude_product_codes,
        "exclude_retailer_tags": cfg.exclude_retailer_tags,
        "selected_employee_ids": cfg.selected_employee_ids or [],
        "is_active": cfg.is_active,
    }
