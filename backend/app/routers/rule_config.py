from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee import Employee
from app.models.product import Product
from app.models.rule_config import ReportRuleMaster, RuleContext
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
    TARGET_ROLES,
    _set_children,
    context_key_exists,
    context_to_dict,
    deactivate_other_active_rules,
    get_contexts,
    get_rule_children,
    rule_to_dict,
    soft_delete_rule,
)
from app.utils.access_control import is_admin_user
from app.utils.activity_logger import log_activity
from app.utils.timezone import now_naive

router = APIRouter(prefix="/api/rule-config", tags=["rule-config"])

MODULE = "rule_config"


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class RuleCreate(BaseModel):
    context_key: str = Field(..., max_length=100)
    rule_name: str = Field(..., min_length=1, max_length=200)
    target_role: str = Field(..., max_length=20)
    apply_to: str = "all"
    column_key: str = "all"
    is_active: bool = True
    excluded_product_codes: list[str] = []
    excluded_retailer_types: list[str] = []
    included_employee_ids: list[int] = []


class RuleUpdate(BaseModel):
    rule_name: Optional[str] = Field(None, min_length=1, max_length=200)
    target_role: Optional[str] = Field(None, max_length=20)
    apply_to: Optional[str] = Field(None, max_length=50)
    column_key: Optional[str] = Field(None, max_length=50)
    is_active: Optional[bool] = None
    excluded_product_codes: Optional[list[str]] = None
    excluded_retailer_types: Optional[list[str]] = None
    included_employee_ids: Optional[list[int]] = None


class ContextCreate(BaseModel):
    context_key: str = Field(..., min_length=1, max_length=100)
    name_en: str = Field(..., min_length=1, max_length=200)
    name_bn: Optional[str] = Field(None, max_length=200)
    icon: Optional[str] = Field(None, max_length=50)
    sort_order: int = 0
    is_active: bool = True


class ContextUpdate(BaseModel):
    name_en: Optional[str] = Field(None, min_length=1, max_length=200)
    name_bn: Optional[str] = Field(None, max_length=200)
    icon: Optional[str] = Field(None, max_length=50)
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _normalize_context_key(raw: str) -> str:
    """Normalize a context key to lowercase kebab-case."""
    return raw.strip().lower()


def _require_valid_context_key(key: str):
    if not key or len(key) > 100 or not key[0].isalnum():
        raise HTTPException(
            status_code=422,
            detail="context_key must start with a letter/digit (alphanumeric, max 100 chars)",
        )
    if not all(c.isalnum() or c in "_-" for c in key):
        raise HTTPException(
            status_code=422,
            detail="context_key may only contain letters, digits, dashes and underscores",
        )


async def _validate_constants(db: AsyncSession, context_key: str, target_role: str):
    if not await context_key_exists(db, context_key):
        raise HTTPException(
            status_code=422,
            detail=f"Invalid context_key: {context_key}",
        )
    if target_role not in TARGET_ROLES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid target_role. Allowed: {', '.join(TARGET_ROLES)}",
        )


async def _validate_included_employee_ids(
    db: AsyncSession,
    house_id: Optional[int],
    user_ids: list[int],
):
    """Ensure every included user_id maps to an Active employee of the house.

    The rule engine looks up `Employee.user_id IN (included_employee_ids)`
    scoped to the rule's house, so selections outside the house (or inactive)
    would silently count zero. Reject them up front with a structured 422.
    """
    if not user_ids or not house_id:
        return
    unique_ids = sorted({uid for uid in user_ids if uid > 0})
    if not unique_ids:
        return
    res = await db.execute(
        select(Employee.user_id).where(
            Employee.house_id == house_id,
            Employee.status == "Active",
            Employee.user_id.in_(unique_ids),
        )
    )
    valid = {r[0] for r in res.all() if r[0] is not None}
    invalid = [uid for uid in unique_ids if uid not in valid]
    if invalid:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "VALIDATION_ERROR",
                "message": "Some included employees are not active in this house",
                "fields": {
                    "included_employee_ids":
                        f"Not active in this house: {invalid}",
                },
            },
        )


def _normalize_apply_to(raw: Optional[str]) -> str:
    """Normalize a rule's page-section scope; empty/missing means 'all'."""
    v = (raw or "all").strip().lower() or "all"
    if len(v) > 50 or not all(c.isalnum() or c in "_-" for c in v):
        raise HTTPException(
            status_code=422,
            detail="apply_to may only contain letters, digits, dashes and underscores (max 50 chars)",
        )
    return v


def _normalize_column_key(raw: Optional[str]) -> str:
    """Normalize a rule's metric-column scope; empty/missing means 'all'."""
    v = (raw or "all").strip().lower() or "all"
    if len(v) > 50 or not all(c.isalnum() or c in "_-" for c in v):
        raise HTTPException(
            status_code=422,
            detail="column_key may only contain letters, digits, dashes and underscores (max 50 chars)",
        )
    return v


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
        "contexts": await get_contexts(db),
        "context_keys": [c["context_key"] for c in await get_contexts(db)],
    }


# ---------------------------------------------------------------------------
# Contexts (dynamic report contexts)
# ---------------------------------------------------------------------------
# NOTE: These must stay declared BEFORE GET /{rule_id} — an integer path param
# would otherwise capture /contexts and fail type validation.

async def _get_accessible_context(
    db: AsyncSession, context_id: int, current_user: User
) -> RuleContext:
    if not is_admin_user(current_user):
        raise HTTPException(
            status_code=403,
            detail="Only admins can manage rule contexts",
        )
    ctx = await db.get(RuleContext, context_id)
    if not ctx or ctx.is_deleted:
        raise HTTPException(status_code=404, detail="Context not found")
    return ctx


@router.get("/contexts")
async def list_contexts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission(f"{MODULE}.view")),
    house_context: Optional[int] = Depends(get_house_context),
):
    return {
        "success": True,
        "data": await get_contexts(db, include_inactive=True),
    }


@router.post("/contexts", status_code=201)
async def create_context(
    data: ContextCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission(f"{MODULE}.manage_contexts")),
    house_context: Optional[int] = Depends(get_house_context),
):
    if not is_admin_user(current_user):
        raise HTTPException(
            status_code=403,
            detail="Only admins can manage rule contexts",
        )
    key = _normalize_context_key(data.context_key)
    _require_valid_context_key(key)

    if await context_key_exists(db, key):
        raise HTTPException(
            status_code=409,
            detail=f"Context '{key}' already exists",
        )

    ctx = RuleContext(
        context_key=key,
        name_en=data.name_en.strip(),
        name_bn=data.name_bn.strip() if data.name_bn and data.name_bn.strip() else None,
        icon=data.icon.strip().lower() if data.icon and data.icon.strip() else None,
        sort_order=data.sort_order,
        is_active=data.is_active,
        is_system=False,
        created_by=current_user.id,
        updated_by=current_user.id,
    )
    db.add(ctx)
    await db.commit()
    await db.refresh(ctx)

    await log_activity(
        db, current_user.id, current_user.name, MODULE, "create",
        record_id=ctx.id, record_identifier=ctx.context_key,
        new_values=context_to_dict(ctx),
        request=request, status_code=201,
    )
    return context_to_dict(ctx)


@router.patch("/contexts/{context_id}")
async def update_context(
    context_id: int,
    data: ContextUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission(f"{MODULE}.manage_contexts")),
    house_context: Optional[int] = Depends(get_house_context),
):
    ctx = await _get_accessible_context(db, context_id, current_user)
    old = context_to_dict(ctx)

    if data.name_en is not None and data.name_en.strip():
        ctx.name_en = data.name_en.strip()
    if data.name_bn is not None:
        ctx.name_bn = data.name_bn.strip() if data.name_bn.strip() else None
    if data.icon is not None:
        ctx.icon = data.icon.strip().lower() if data.icon.strip() else None
    if data.sort_order is not None:
        ctx.sort_order = data.sort_order
    if data.is_active is not None:
        ctx.is_active = data.is_active

    ctx.updated_by = current_user.id
    await db.commit()
    await db.refresh(ctx)

    await log_activity(
        db, current_user.id, current_user.name, MODULE, "edit",
        record_id=ctx.id, record_identifier=ctx.context_key,
        old_values=old, new_values=context_to_dict(ctx),
        request=request, status_code=200,
    )
    return context_to_dict(ctx)


@router.delete("/contexts/{context_id}")
async def delete_context(
    context_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission(f"{MODULE}.manage_contexts")),
    house_context: Optional[int] = Depends(get_house_context),
):
    ctx = await _get_accessible_context(db, context_id, current_user)
    old = context_to_dict(ctx)

    if ctx.is_system:
        raise HTTPException(
            status_code=409,
            detail="System contexts cannot be deleted",
        )

    rule_count = (
        await db.execute(
            select(func.count())
            .select_from(ReportRuleMaster)
            .where(
                ReportRuleMaster.context_key == ctx.context_key,
                ReportRuleMaster.is_deleted.is_(False),
            )
        )
    ).scalar() or 0
    if rule_count > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Context still has {rule_count} rule(s). Delete or reassign them first.",
        )

    ctx.is_deleted = True
    ctx.is_active = False
    ctx.deleted_at = now_naive()
    ctx.deleted_by = current_user.id
    ctx.updated_by = current_user.id
    await db.commit()

    await log_activity(
        db, current_user.id, current_user.name, MODULE, "delete",
        record_id=ctx.id, record_identifier=ctx.context_key,
        old_values=old, new_values=None,
        request=request, status_code=200,
    )
    return {"message": "Context deleted successfully"}


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
    await _validate_constants(db, data.context_key, data.target_role)
    await _validate_included_employee_ids(db, house_context, data.included_employee_ids)
    apply_to = _normalize_apply_to(data.apply_to)
    column_key = _normalize_column_key(data.column_key)

    rule = ReportRuleMaster(
        house_id=house_context,
        context_key=data.context_key,
        rule_name=data.rule_name.strip(),
        target_role=data.target_role,
        apply_to=apply_to,
        column_key=column_key,
        is_active=data.is_active,
        created_by=current_user.id,
        updated_by=current_user.id,
    )

    if data.is_active:
        # Deactivate any currently-active rule for this role + section + column
        # and flush BEFORE inserting the new active rule, so the partial unique
        # index (uq_rule_master_active_house_context_role) is not violated.
        await deactivate_other_active_rules(
            db, rule.house_id, rule.context_key, rule.target_role,
            apply_to=apply_to, column_key=column_key,
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

    if data.included_employee_ids is not None:
        emp_house_id = rule.house_id or house_context
        await _validate_included_employee_ids(db, emp_house_id, data.included_employee_ids)

    children = await get_rule_children(db, rule.id)
    old = rule_to_dict(rule, children)
    updates = {}

    if data.rule_name is not None and data.rule_name.strip() != rule.rule_name:
        rule.rule_name = data.rule_name.strip()
        updates["rule_name"] = rule.rule_name
    if data.target_role is not None:
        await _validate_constants(db, rule.context_key, data.target_role)
        if data.target_role != rule.target_role:
            rule.target_role = data.target_role
            updates["target_role"] = rule.target_role

    if data.apply_to is not None:
        new_apply = _normalize_apply_to(data.apply_to)
        if new_apply != rule.apply_to:
            rule.apply_to = new_apply
            updates["apply_to"] = new_apply

    if data.column_key is not None:
        new_column = _normalize_column_key(data.column_key)
        if new_column != (rule.column_key or "all"):
            rule.column_key = new_column
            updates["column_key"] = new_column

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
                db, rule.house_id, rule.context_key, rule.target_role,
                except_rule_id=rule.id, apply_to=rule.apply_to,
                column_key=rule.column_key or "all",
            )
            await db.flush()
        rule.is_active = data.is_active
    elif ("apply_to" in updates or "column_key" in updates) and rule.is_active:
        # Section/column changed while staying active — the new slot may already
        # be occupied by another active rule, so deactivate it first.
        await deactivate_other_active_rules(
            db, rule.house_id, rule.context_key, rule.target_role,
            except_rule_id=rule.id, apply_to=rule.apply_to,
            column_key=rule.column_key or "all",
        )
        await db.flush()

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