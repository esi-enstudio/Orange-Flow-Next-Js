from typing import Optional

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.rule_config import (
    ReportRuleMaster,
    RuleExcludedProductCode,
    RuleExcludedRetailerType,
    RuleIncludedEmployeeId,
)
from app.utils.timezone import now_naive

CONTEXT_KEYS = ["ga_live", "activation_report"]
TARGET_ROLES = ["HOUSE", "SUPERVISOR", "RSO", "BP"]


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
) -> int:
    """Ensure only one active rule per (house_id, context_key, target_role)."""
    query = select(ReportRuleMaster).where(
        ReportRuleMaster.house_id == house_id,
        ReportRuleMaster.context_key == context_key,
        ReportRuleMaster.target_role == target_role,
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
) -> dict:
    """Return effective exclusion/inclusion conditions for a report query.

    - ``excluded_product_codes`` is the UNION across ALL active rules for the
      (house_id, context_key) pair — product exclusions are global.
    - ``excluded_retailer_types`` / ``included_employee_ids`` come only from the
      active rule matching ``target_role``.
    """
    union_codes = (
        await db.execute(
            select(RuleExcludedProductCode.product_code)
            .join(ReportRuleMaster, ReportRuleMaster.id == RuleExcludedProductCode.rule_id)
            .where(
                ReportRuleMaster.house_id == house_id,
                ReportRuleMaster.context_key == context_key,
                ReportRuleMaster.is_active.is_(True),
                ReportRuleMaster.is_deleted.is_(False),
                RuleExcludedProductCode.is_deleted.is_(False),
            )
        )
    ).scalars().all()

    conditions = {
        "excluded_product_codes": set(union_codes),
        "excluded_retailer_types": [],
        "included_employee_ids": [],
    }

    if not target_role:
        return conditions

    rule = (
        await db.execute(
            select(ReportRuleMaster).where(
                ReportRuleMaster.house_id == house_id,
                ReportRuleMaster.context_key == context_key,
                ReportRuleMaster.target_role == target_role,
                ReportRuleMaster.is_active.is_(True),
                ReportRuleMaster.is_deleted.is_(False),
            )
        )
    ).scalar_one_or_none()
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