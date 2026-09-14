from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee import Employee
from app.models.product import Product
from app.models.rule_config import ReportRuleMaster
from app.models.user import User
from app.routers.deps import (
    get_db,
    get_house_context,
    has_permission,
    require_house_context,
)
from app.schemas.pagination import PaginatedResponse, PaginationMeta, PaginationParams
from app.services.retailer_marking_service import get_active_markings
from app.services.rule_config_service import (
    CONTEXT_KEYS,
    TARGET_ROLES,
    _set_children,
    deactivate_other_active_rules,
    get_rule_children,
    rule_to_dict,
    soft_delete_rule,
)
from app.utils.access_control import is_admin_user
from app.utils.activity_logger import log_activity

router = APIRouter(prefix="/api/rule-config", tags=["rule-config"])

MODULE = "rule_config"


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class RuleCreate(BaseModel):
    context_key: str = Field(..., max_length=100)
    rule_name: str = Field(..., min_length=1, max_length=200)
    target_role: str = Field(..., max_length=20)
    is_active: bool = True
    excluded_product_codes: list[str] = []
    excluded_retailer_types: list[str] = []
    included_employee_ids: list[int] = []


class RuleUpdate(BaseModel):
    rule_name: Optional[str] = Field(None, min_length=1, max_length=200)
    target_role: Optional[str] = Field(None, max_length=20)
    is_active: Optional[bool] = None
    excluded_product_codes: Optional[list[str]] = None
    excluded_retailer_types: Optional[list[str]] = None
    included_employee_ids: Optional[list[int]] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _validate_constants(context_key: str, target_role: str):
    if context_key not in CONTEXT_KEYS:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid context_key. Allowed: {', '.join(CONTEXT_KEYS)}",
        )
    if target_role not in TARGET_ROLES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid target_role. Allowed: {', '.join(TARGET_ROLES)}",
        )


def _accessible_house_ids(
    current_user: User, house_context: Optional[int]
) -> Optional[list[int]]:
    """Return allowed house IDs, or None for admin (all houses)."""
    if is_admin_user(current_user):
        return None
    ids = [h.id for h in current_user.houses]
    if house_context is not None:
        if house_context not in ids:
            raise HTTPException(status_code=403, detail="Access denied to this house context")
        return [house_context]
    return ids or [-1]


async def _get_accessible_rule(
    db: AsyncSession, rule_id: int, current_user: User, house_context: Optional[int]
) -> ReportRuleMaster:
    rule = await db.get(ReportRuleMaster, rule_id)
    if not rule or rule.is_deleted:
        raise HTTPException(status_code=404, detail="Rule not found")
    allowed = _accessible_house_ids(current_user, house_context)
    if allowed is not None and rule.house_id not in allowed:
        raise HTTPException(status_code=403, detail="Access denied to this rule's house")
    return rule


# ---------------------------------------------------------------------------
# Options
# ---------------------------------------------------------------------------

@router.get("/options")
async def rule_options(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission(f"{MODULE}.view")),
    house_context: Optional[int] = Depends(require_house_context),
):
    products = (
        await db.execute(
            select(Product.product_code, Product.product_name)
            .where(
                Product.status == "Active",
                Product.category == "SIM",
            )
            .order_by(Product.product_name)
        )
    ).all()
    product_codes = [{"code": code, "name": name} for code, name in products]

    markings = await get_active_markings(db)
    retailer_types = [{"name": m.name, "code": m.code} for m in markings]

    employees = (
        await db.execute(
            select(
                Employee.id,
                Employee.user_id,
                Employee.employee_name,
                Employee.employee_type,
                Employee.dms_code,
            )
            .where(
                Employee.house_id == house_context,
                Employee.status == "Active",
            )
            .order_by(Employee.employee_name)
        )
    ).all()
    employee_list = [
        {
            "id": e.id,
            "user_id": e.user_id,
            "name": e.employee_name or e.dms_code,
            "employee_type": e.employee_type,
            "dms_code": e.dms_code,
        }
        for e in employees
    ]

    return {
        "product_codes": product_codes,
        "retailer_types": retailer_types,
        "employees": employee_list,
        "roles": TARGET_ROLES,
        "context_keys": CONTEXT_KEYS,
    }


# ---------------------------------------------------------------------------
# List / get
# ---------------------------------------------------------------------------

@router.get("")
async def list_rules(
    pagination: PaginationParams = Depends(),
    context_key: Optional[str] = Query(None),
    target_role: Optional[str] = Query(None, pattern="^(HOUSE|SUPERVISOR|RSO|BP)$"),
    active_only: Optional[bool] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission(f"{MODULE}.view")),
    house_context: Optional[int] = Depends(get_house_context),
):
    allowed = _accessible_house_ids(current_user, house_context)
    query = select(ReportRuleMaster).where(ReportRuleMaster.is_deleted.is_(False))
    if allowed is not None:
        query = query.where(ReportRuleMaster.house_id.in_(allowed))
    if house_context is not None:
        query = query.where(ReportRuleMaster.house_id == house_context)
    if context_key:
        query = query.where(ReportRuleMaster.context_key == context_key)
    if target_role:
        query = query.where(ReportRuleMaster.target_role == target_role)
    if active_only is not None:
        query = query.where(ReportRuleMaster.is_active.is_(active_only))
    if pagination.search:
        p = f"%{pagination.search}%"
        query = query.where(ReportRuleMaster.rule_name.ilike(p))

    total = (
        await db.execute(select(func.count()).select_from(query.subquery()))
    ).scalar() or 0
    sort_col = {
        "rule_name": ReportRuleMaster.rule_name,
        "context_key": ReportRuleMaster.context_key,
        "target_role": ReportRuleMaster.target_role,
        "is_active": ReportRuleMaster.is_active,
        "created_at": ReportRuleMaster.created_at,
        "updated_at": ReportRuleMaster.updated_at,
    }.get(pagination.sort_by, ReportRuleMaster.id)
    order = sort_col.asc() if pagination.sort_order == "asc" else sort_col.desc()
    offset = (pagination.page - 1) * pagination.per_page
    rules = (
        await db.execute(
            query.offset(offset).limit(pagination.per_page).order_by(order)
        )
    ).scalars().unique().all()

    data = []
    for rule in rules:
        children = await get_rule_children(db, rule.id)
        data.append(rule_to_dict(rule, children))

    total_pages = max(1, -(-total // pagination.per_page))
    return PaginatedResponse(
        success=True,
        data=data,
        pagination=PaginationMeta(
            page=pagination.page,
            per_page=pagination.per_page,
            total=total,
            total_pages=total_pages,
            has_next=pagination.page < total_pages,
            has_prev=pagination.page > 1,
        ),
    )


@router.get("/{rule_id}")
async def get_rule(
    rule_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission(f"{MODULE}.view")),
    house_context: Optional[int] = Depends(get_house_context),
):
    rule = await _get_accessible_rule(db, rule_id, current_user, house_context)
    children = await get_rule_children(db, rule.id)
    return rule_to_dict(rule, children)


# ---------------------------------------------------------------------------
# Create / update / delete
# ---------------------------------------------------------------------------

@router.post("", status_code=201)
async def create_rule(
    data: RuleCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission(f"{MODULE}.create")),
    house_context: Optional[int] = Depends(require_house_context),
):
    _validate_constants(data.context_key, data.target_role)

    rule = ReportRuleMaster(
        house_id=house_context,
        context_key=data.context_key,
        rule_name=data.rule_name.strip(),
        target_role=data.target_role,
        is_active=data.is_active,
        created_by=current_user.id,
        updated_by=current_user.id,
    )

    if data.is_active:
        # Deactivate any currently-active rule for this role and flush BEFORE
        # inserting the new active rule, so the partial unique index
        # (uq_rule_master_active_house_context_role) is not violated.
        await deactivate_other_active_rules(
            db, rule.house_id, rule.context_key, rule.target_role
        )
        await db.flush()

    db.add(rule)
    await db.flush()

    await _set_children(
        db,
        rule.id,
        {
            "excluded_product_codes": data.excluded_product_codes,
            "excluded_retailer_types": data.excluded_retailer_types,
            "included_employee_ids": data.included_employee_ids,
        },
        current_user.id,
    )

    await db.commit()
    await db.refresh(rule)
    children = await get_rule_children(db, rule.id)

    await log_activity(
        db, current_user.id, current_user.name, MODULE, "create",
        record_id=rule.id, record_identifier=rule.rule_name,
        new_values=rule_to_dict(rule, children),
        request=request, status_code=201,
    )
    return rule_to_dict(rule, children)


@router.patch("/{rule_id}")
async def update_rule(
    rule_id: int,
    data: RuleUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission(f"{MODULE}.edit")),
    house_context: Optional[int] = Depends(get_house_context),
):
    rule = await _get_accessible_rule(db, rule_id, current_user, house_context)

    children = await get_rule_children(db, rule.id)
    old = rule_to_dict(rule, children)
    updates = {}

    if data.rule_name is not None and data.rule_name.strip() != rule.rule_name:
        rule.rule_name = data.rule_name.strip()
        updates["rule_name"] = rule.rule_name
    if data.target_role is not None:
        _validate_constants(rule.context_key, data.target_role)
        if data.target_role != rule.target_role:
            rule.target_role = data.target_role
            updates["target_role"] = rule.target_role

    any_children = any(
        [
            data.excluded_product_codes is not None,
            data.excluded_retailer_types is not None,
            data.included_employee_ids is not None,
        ]
    )
    if any_children:
        await _set_children(
            db,
            rule.id,
            {
                "excluded_product_codes": data.excluded_product_codes
                if data.excluded_product_codes is not None
                else children["excluded_product_codes"],
                "excluded_retailer_types": data.excluded_retailer_types
                if data.excluded_retailer_types is not None
                else children["excluded_retailer_types"],
                "included_employee_ids": data.included_employee_ids
                if data.included_employee_ids is not None
                else children["included_employee_ids"],
            },
            current_user.id,
        )
        updates["children_replaced"] = True

    if data.is_active is not None and data.is_active != rule.is_active:
        updates["is_active"] = data.is_active
        if data.is_active:
            # Deactivate competing active rules and persist first, so the
            # partial unique index is not violated when this rule flushes active.
            await deactivate_other_active_rules(
                db, rule.house_id, rule.context_key, rule.target_role, except_rule_id=rule.id
            )
            await db.flush()
        rule.is_active = data.is_active

    rule.updated_by = current_user.id
    await db.commit()
    await db.refresh(rule)
    new_children = await get_rule_children(db, rule.id)

    await log_activity(
        db, current_user.id, current_user.name, MODULE, "edit",
        record_id=rule.id, record_identifier=rule.rule_name,
        old_values=old, new_values=rule_to_dict(rule, new_children),
        request=request, status_code=200,
    )
    return rule_to_dict(rule, new_children)


@router.delete("/{rule_id}")
async def delete_rule(
    rule_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission(f"{MODULE}.delete")),
    house_context: Optional[int] = Depends(get_house_context),
):
    rule = await _get_accessible_rule(db, rule_id, current_user, house_context)
    children = await get_rule_children(db, rule.id)
    old = rule_to_dict(rule, children)

    await soft_delete_rule(db, rule, current_user.id)
    await db.commit()

    await log_activity(
        db, current_user.id, current_user.name, MODULE, "delete",
        record_id=rule.id, record_identifier=rule.rule_name,
        old_values=old, new_values=None,
        request=request, status_code=200,
    )
    return {"message": "Rule deleted successfully"}