import json
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.Routers.deps import get_db, has_permission, get_house_context, get_current_user
from app.Schemas.report_rule import ReportRuleSchema, ReportRuleCreate, ReportRuleUpdate
from app.Models.report_rule import ReportRule
from app.Models.house import House
from app.Models.user import User
from app.Utils.access_control import is_admin_user

router = APIRouter(prefix="/api/report-rules", tags=["report-rules"])


def serialize_config(config):
    if config is None:
        return None
    if isinstance(config, str):
        return config
    return json.dumps(config, default=str)


def deserialize_config(config_str):
    if config_str is None:
        return None
    try:
        return json.loads(config_str)
    except (json.JSONDecodeError, TypeError):
        return config_str


def serialize_report_types(types):
    if types is None:
        return None
    return json.dumps(types)


def deserialize_report_types(types_str):
    if types_str is None:
        return None
    try:
        return json.loads(types_str)
    except (json.JSONDecodeError, TypeError):
        return types_str


@router.get("", response_model=List[ReportRuleSchema])
async def list_report_rules(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("view_reports")),
    house_id: Optional[int] = Query(None, alias="house_id"),
    rule_type: Optional[str] = Query(None, alias="rule_type"),
    is_active: Optional[bool] = Query(None, alias="is_active"),
):
    query = select(ReportRule)
    is_admin = is_admin_user(current_user)

    if house_id:
        query = query.where(ReportRule.house_id == house_id)
    elif not is_admin:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            query = query.where(ReportRule.house_id.in_(user_house_ids))
        else:
            query = query.where(ReportRule.house_id == -1)

    if rule_type:
        query = query.where(ReportRule.rule_type == rule_type)
    if is_active is not None:
        query = query.where(ReportRule.is_active == is_active)

    result = await db.execute(query.order_by(ReportRule.created_at.desc()))
    rules = result.scalars().all()
    for r in rules:
        r.config = deserialize_config(r.config)
        r.report_types = deserialize_report_types(r.report_types)
    return rules


@router.post("", response_model=ReportRuleSchema, status_code=201)
async def create_report_rule(
    rule_data: ReportRuleCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("edit_reports")),
    x_house_id: Optional[int] = Depends(get_house_context),
):
    target_house_id = rule_data.house_id or x_house_id
    if not target_house_id:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            target_house_id = user_house_ids[0]
        else:
            first_house = (await db.execute(select(House).limit(1))).scalar_one_or_none()
            if first_house:
                target_house_id = first_house.id
            else:
                raise HTTPException(status_code=400, detail="No house found. Please create a house first or specify house_id.")

    new_rule = ReportRule(
        house_id=target_house_id,
        name=rule_data.name,
        description=rule_data.description,
        rule_type=rule_data.rule_type,
        config=serialize_config(rule_data.config),
        report_types=serialize_report_types(rule_data.report_types),
        is_active=rule_data.is_active,
        valid_from=rule_data.valid_from,
        valid_to=rule_data.valid_to,
    )
    db.add(new_rule)
    await db.commit()
    await db.refresh(new_rule)
    new_rule.config = deserialize_config(new_rule.config)
    new_rule.report_types = deserialize_report_types(new_rule.report_types)
    return new_rule


@router.get("/{rule_id}", response_model=ReportRuleSchema)
async def get_report_rule(
    rule_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("view_reports")),
):
    result = await db.execute(select(ReportRule).where(ReportRule.id == rule_id))
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Report rule not found")
    rule.config = deserialize_config(rule.config)
    rule.report_types = deserialize_report_types(rule.report_types)
    return rule


@router.put("/{rule_id}", response_model=ReportRuleSchema)
async def update_report_rule(
    rule_id: int,
    rule_data: ReportRuleUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("edit_reports")),
):
    result = await db.execute(select(ReportRule).where(ReportRule.id == rule_id))
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Report rule not found")

    update_data = rule_data.model_dump(exclude_unset=True)
    if "config" in update_data:
        update_data["config"] = serialize_config(update_data["config"])
    if "report_types" in update_data:
        update_data["report_types"] = serialize_report_types(update_data["report_types"])

    for key, value in update_data.items():
        setattr(rule, key, value)

    await db.commit()
    await db.refresh(rule)
    rule.config = deserialize_config(rule.config)
    rule.report_types = deserialize_report_types(rule.report_types)
    return rule


@router.delete("/{rule_id}")
async def delete_report_rule(
    rule_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("edit_reports")),
):
    result = await db.execute(select(ReportRule).where(ReportRule.id == rule_id))
    rule = result.scalar_one_or_none()
    if not rule:
        raise HTTPException(status_code=404, detail="Report rule not found")
    await db.delete(rule)
    await db.commit()
    return {"message": "Report rule deleted successfully"}
