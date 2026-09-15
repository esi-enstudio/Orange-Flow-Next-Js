from typing import Optional

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.rule_config import (
    RuleContext,
    ReportRuleMaster,
    RuleExcludedProductCode,
    RuleExcludedRetailerType,
    RuleIncludedEmployeeId,
)
from app.utils.timezone import now_naive

TARGET_ROLES = ["HOUSE", "SUPERVISOR", "RSO", "BP"]


def context_to_dict(ctx: RuleContext) -> dict:
    return {
        "id": ctx.id,
        "context_key": ctx.context_key,
        "name_en": ctx.name_en,
        "name_bn": ctx.name_bn,
        "icon": ctx.icon,
        "sort_order": ctx.sort_order,
        "is_active": ctx.is_active,
        "is_system": ctx.is_system,
        "created_at": ctx.created_at.isoformat() if ctx.created_at else None,
        "updated_at": ctx.updated_at.isoformat() if ctx.updated_at else None,
    }


async def get_contexts(
    db: AsyncSession, include_inactive: bool = False
) -> list[dict]:
    """Return rule contexts ordered by sort_order. Excludes soft-deleted rows."""
    query = (
        select(RuleContext)
        .where(RuleContext.is_deleted.is_(False))
        .order_by(RuleContext.sort_order.asc(), RuleContext.context_key.asc())
    )
    if not include_inactive:
        query = query.where(RuleContext.is_active.is_(True))
    rows = (await db.execute(query)).scalars().all()
    return [context_to_dict(r) for r in rows]


async def get_context_keys(db: AsyncSession) -> list[str]:
    return [c["context_key"] for c in await get_contexts(db)]


async def context_key_exists(db: AsyncSession, context_key: str) -> bool:
    row = (
        await db.execute(
            select(RuleContext.id).where(
                RuleContext.context_key == context_key,
                RuleContext.is_deleted.is_(False),
            )
        )
    ).scalar_one_or_none()
    return row is not None


async def _set_children(
    db: AsyncSession, rule_id: int, data: dict, user_id: int
):
    """Replace a rule's child rows with the given selections.

    Children are configuration references, not business records — replaced
    wholesale on save (hard delete + re-insert). Uses explicit awaited
    statements instead of lazy-loading the ORM relationship, which is not
    allowed in async sessions (MissingGreenlet).
    """
    await db.execute(
        delete(RuleExcludedProductCode).where(
            RuleExcludedProductCode.rule_id == rule_id
        )
    )
    await db.execute(
        delete(RuleExcludedRetailerType).where(
            RuleExcludedRetailerType.rule_id == rule_id
        )
    )
    await db.execute(
        delete(RuleIncludedEmployeeId).where(
            RuleIncludedEmployeeId.rule_id == rule_id
        )
    )

    for code in sorted(
        {str(c).strip() for c in (data.get("excluded_product_codes") or []) if str(c).strip()}
    ):
        db.add(RuleExcludedProductCode(product_code=code, rule_id=rule_id, created_by=user_id))
    for name in sorted(
        {str(t).strip() for t in (data.get("excluded_retailer_types") or []) if str(t).strip()}
    ):
        db.add(RuleExcludedRetailerType(retailer_type=name, rule_id=rule_id, created_by=user_id))
    for eid in sorted(
        {int(i) for i in (data.get("included_employee_ids") or []) if int(i) > 0}
    ):
        db.add(RuleIncludedEmployeeId(user_id=eid, rule_id=rule_id, created_by=user_id))


async def get_rule_children(db: AsyncSession, rule_id: int) -> dict:
    codes = (
        await db.execute(
            select(RuleExcludedProductCode.product_code).where(
                RuleExcludedProductCode.rule_id == rule_id,
                RuleExcludedProductCode.is_deleted.is_(False),
            )
        )
    ).scalars().all()
    types = (
        await db.execute(
            select(RuleExcludedRetailerType.retailer_type).where(
                RuleExcludedRetailerType.rule_id == rule_id,
                RuleExcludedRetailerType.is_deleted.is_(False),
            )
        )
    ).scalars().all()
    emp_ids = (
        await db.execute(
            select(RuleIncludedEmployeeId.user_id).where(
                RuleIncludedEmployeeId.rule_id == rule_id,
                RuleIncludedEmployeeId.is_deleted.is_(False),
            )
        )
    ).scalars().all()
    return {
        "excluded_product_codes": list(codes),
        "excluded_retailer_types": list(types),
        "included_employee_ids": list(emp_ids),
    }


def rule_to_dict(rule: ReportRuleMaster, children: dict) -> dict:
    return {
        "id": rule.id,
        "house_id": rule.house_id,
        "context_key": rule.context_key,
        "rule_name": rule.rule_name,
        "target_role": rule.target_role,
        "apply_to": rule.apply_to or "all",
        "is_active": rule.is_active,
        "created_by": rule.created_by,
        "created_at": rule.created_at.isoformat() if rule.created_at else None,
        "updated_at": rule.updated_at.isoformat() if rule.updated_at else None,
        "excluded_product_codes": children["excluded_product_codes"],
        "excluded_retailer_types": children["excluded_retailer_types"],
        "included_employee_ids": children["included_employee_ids"],
    }


async def deactivate_other_active_rules(
    db: AsyncSession,
    house_id: int,
    context_key: str,
    target_role: str,
    except_rule_id: Optional[int] = None,
    apply_to: str = "all",
) -> int:
    """Ensure only one active rule per (house_id, context_key, target_role, apply_to)."""
    query = select(ReportRuleMaster).where(
        ReportRuleMaster.house_id == house_id,
        ReportRuleMaster.context_key == context_key,
        ReportRuleMaster.target_role == target_role,
        ReportRuleMaster.apply_to == apply_to,
        ReportRuleMaster.is_active.is_(True),
        ReportRuleMaster.is_deleted.is_(False),
    )
    if except_rule_id is not None:
        query = query.where(ReportRuleMaster.id != except_rule_id)
    rows = (await db.execute(query)).scalars().all()
    count = 0
    for row in rows:
        row.is_active = False
        count += 1
    return count


async def get_effective_rule_conditions(
    db: AsyncSession,
    house_id: int,
    context_key: str,
    target_role: Optional[str] = None,
    apply_to: Optional[str] = None,
) -> dict:
    """Return effective exclusion/inclusion conditions for a report query.

    A rule applies to a section when its ``apply_to`` is ``"all"`` (global) or
    equals the requested ``apply_to``. This keeps section-scoped rules isolated
    from each other while preserving the legacy global behavior when
    ``apply_to`` is omitted (only ``"all"`` rules are consulted).

    - ``excluded_product_codes`` is the UNION across all applicable active rules
      for the (house_id, context_key) pair.
    - ``excluded_retailer_types`` / ``included_employee_ids`` come from the most
      specific applicable active rule matching ``target_role`` (a rule scoped to
      the requested section wins over a ``"all"`` rule).
    """
    async def applicable_rules() -> list:
        base = (
            select(ReportRuleMaster)
            .where(
                ReportRuleMaster.house_id == house_id,
                ReportRuleMaster.context_key == context_key,
                ReportRuleMaster.is_active.is_(True),
                ReportRuleMaster.is_deleted.is_(False),
            )
            .order_by(ReportRuleMaster.id.desc())
        )
        if apply_to:
            base = base.where(
                or_(
                    ReportRuleMaster.apply_to == "all",
                    ReportRuleMaster.apply_to == apply_to,
                )
            )
        else:
            base = base.where(ReportRuleMaster.apply_to == "all")
        rows = (await db.execute(base)).scalars().all()
        return list(rows)

    matched = await applicable_rules()

    union_codes = set()
    for rule in matched:
        children = await get_rule_children(db, rule.id)
        union_codes.update(children["excluded_product_codes"])

    conditions = {
        "excluded_product_codes": union_codes,
        "excluded_retailer_types": [],
        "included_employee_ids": [],
    }

    if not target_role:
        return conditions

    role_rules = [r for r in matched if r.target_role == target_role]
    if not role_rules:
        return conditions

    if apply_to:
        rule = next((r for r in role_rules if r.apply_to == apply_to), None) \
            or next((r for r in role_rules if r.apply_to == "all"), None)
    else:
        rule = next((r for r in role_rules if r.apply_to == "all"), None)
    if rule is None:
        return conditions

    children = await get_rule_children(db, rule.id)
    conditions["excluded_retailer_types"] = children["excluded_retailer_types"]
    conditions["included_employee_ids"] = children["included_employee_ids"]
    return conditions


async def soft_delete_rule(db: AsyncSession, rule: ReportRuleMaster, user_id: int) -> None:
    rule.is_deleted = True
    rule.is_active = False
    rule.deleted_by = user_id
    rule.deleted_at = now_naive()