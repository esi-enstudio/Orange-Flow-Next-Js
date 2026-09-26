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
        "column_key": rule.column_key or "all",
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
    column_key: str = "all",
) -> int:
    """Ensure only one active rule per (house, context, role, apply_to, column_key)."""
    query = select(ReportRuleMaster).where(
        ReportRuleMaster.house_id == house_id,
        ReportRuleMaster.context_key == context_key,
        ReportRuleMaster.target_role == target_role,
        ReportRuleMaster.apply_to == apply_to,
        ReportRuleMaster.column_key == column_key,
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


def _pick_most_specific_rule(
    role_rules: list, apply_to: Optional[str], column_key: Optional[str]
) -> Optional[ReportRuleMaster]:
    """Pick the most specific active rule for the requested section + column.

    ``role_rules`` is ordered by id DESC (newest first). Specificity beats scope:
    an exact column+section rule (score 3) wins over exact column/global section
    (2), over global column/exact section (1), over global+global (0). Ties go to
    the newest rule (first in the descending list).
    """
    def score(rule: ReportRuleMaster) -> int:
        s = 0
        if column_key and (rule.column_key or "all") == column_key:
            s += 2
        if apply_to and (rule.apply_to or "all") == apply_to:
            s += 1
        return s

    if not role_rules:
        return None
    return max(role_rules, key=score)


async def get_effective_rule_conditions(
    db: AsyncSession,
    house_id: int,
    context_key: str,
    target_role: Optional[str] = None,
    apply_to: Optional[str] = None,
    column_key: Optional[str] = None,
) -> dict:
    """Return effective exclusion/inclusion conditions for a report query.

    A rule applies to a section when its ``apply_to`` is ``"all"`` (global) or
    equals the requested ``apply_to``. Likewise it applies to a metric column
    when its ``column_key`` is ``"all"`` (global) or equals the requested
    ``column_key``. Omitting ``apply_to`` / ``column_key`` consults only the
    legacy global (``"all"``) rules.

    - ``excluded_product_codes`` is the UNION across all applicable active rules
      for the (house_id, context_key) pair.
    - ``excluded_retailer_types`` / ``included_employee_ids`` come from the most
      specific applicable active rule matching ``target_role`` (exact column +
      section wins over global scopes).
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
        if column_key:
            base = base.where(
                or_(
                    ReportRuleMaster.column_key == "all",
                    ReportRuleMaster.column_key == column_key,
                )
            )
        else:
            base = base.where(ReportRuleMaster.column_key == "all")
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

    rule = _pick_most_specific_rule(role_rules, apply_to, column_key)
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


# ---------------------------------------------------------------------------
# Cross-house rule copy
# ---------------------------------------------------------------------------
#
# Rule contexts (``rule_contexts``) are deliberately system-level — the model
# carries no ``house_id`` and ``GET /rule-config/contexts`` ignores the house
# header — so a new house inherits every context automatically and nothing is
# copied. Only ``report_rule_masters`` (which *is* house-scoped) plus its
# configuration child rows are cloned.


def _rule_scope_key(rule: ReportRuleMaster) -> tuple:
    """Identity of a rule's configuration slot, ignoring its name.

    Two rules occupy the same slot when they target the same context + role +
    section + column for a house. A copy collides with a target-house rule on
    the same key.
    """
    return (
        rule.context_key,
        rule.target_role,
        rule.apply_to or "all",
        rule.column_key or "all",
    )


async def get_house_rules(
    db: AsyncSession, house_id: int, include_inactive: bool = True
) -> list[ReportRuleMaster]:
    """All live (non-deleted) rules of one house, oldest first."""
    query = select(ReportRuleMaster).where(
        ReportRuleMaster.house_id == house_id,
        ReportRuleMaster.is_deleted.is_(False),
    )
    if not include_inactive:
        query = query.where(ReportRuleMaster.is_active.is_(True))
    query = query.order_by(ReportRuleMaster.id.asc())
    return list((await db.execute(query)).scalars().all())


async def get_house_rules_children(
    db: AsyncSession, rule_ids: list[int]
) -> dict[int, dict]:
    """Batch-load child selections for many rules at once.

    Avoids the N+1 query storm a per-rule :func:`get_rule_children` would cause
    on a house with hundreds of rules.
    """
    if not rule_ids:
        return {}
    ids = set(rule_ids)

    codes_rows = (
        await db.execute(
            select(RuleExcludedProductCode.rule_id, RuleExcludedProductCode.product_code).where(
                RuleExcludedProductCode.rule_id.in_(ids),
                RuleExcludedProductCode.is_deleted.is_(False),
            )
        )
    ).all()
    types_rows = (
        await db.execute(
            select(RuleExcludedRetailerType.rule_id, RuleExcludedRetailerType.retailer_type).where(
                RuleExcludedRetailerType.rule_id.in_(ids),
                RuleExcludedRetailerType.is_deleted.is_(False),
            )
        )
    ).all()
    emp_rows = (
        await db.execute(
            select(RuleIncludedEmployeeId.rule_id, RuleIncludedEmployeeId.user_id).where(
                RuleIncludedEmployeeId.rule_id.in_(ids),
                RuleIncludedEmployeeId.is_deleted.is_(False),
            )
        )
    ).all()

    out: dict[int, dict] = {
        rid: {
            "excluded_product_codes": [],
            "excluded_retailer_types": [],
            "included_employee_ids": [],
        }
        for rid in ids
    }
    for rid, code in codes_rows:
        out[rid]["excluded_product_codes"].append(code)
    for rid, name in types_rows:
        out[rid]["excluded_retailer_types"].append(name)
    for rid, uid in emp_rows:
        out[rid]["included_employee_ids"].append(uid)
    return out


async def build_copy_plan(
    db: AsyncSession,
    source_house_id: int,
    target_house_id: int,
    include_employee_ids: bool = False,
    include_inactive: bool = True,
    mode: str = "skip",
) -> dict:
    """Diff a source house's rules against the target house. No writes.

    Returns per-rule rows so the UI can show exactly what a copy would create,
    which existing rules it would collide with, and how many employee
    selections it would have to drop because those employees are not active in
    the *target* house.

    ``mode`` must match the mode the copy will be applied with, otherwise the
    preview lies: a collision reported as ``overwrite`` while the apply runs in
    ``skip`` mode reports "will overwrite 4" and then copies nothing. In
    ``skip`` mode every collision is therefore reported as ``skip``.
    """
    if mode not in ("skip", "overwrite"):
        raise ValueError(f"Invalid copy mode: {mode}")

    source_rules = await get_house_rules(db, source_house_id, include_inactive=include_inactive)
    target_rules = await get_house_rules(db, target_house_id, include_inactive=include_inactive)

    all_ids = [r.id for r in source_rules] + [r.id for r in target_rules]
    children = await get_house_rules_children(db, all_ids)

    target_by_scope: dict[tuple, ReportRuleMaster] = {}
    for rule in target_rules:
        target_by_scope.setdefault(_rule_scope_key(rule), rule)

    # Employee selections only survive the copy when the same user_id is an
    # Active employee of the *target* house. Employee.user_id is a global login
    # id, so a user who serves two houses maps across, but a source-house-only
    # employee does not exist in the target house at all.
    emp_ids_in_source: set[int] = set()
    for rule in source_rules:
        for uid in children.get(rule.id, {}).get("included_employee_ids", []):
            if uid:
                emp_ids_in_source.add(int(uid))

    valid_target_emp_ids: set[int] = set()
    if emp_ids_in_source:
        from app.models.employee import Employee  # local import: avoids cycle

        valid_target_emp_rows = (
            await db.execute(
                select(Employee.user_id).where(
                    Employee.house_id == target_house_id,
                    Employee.status == "Active",
                    Employee.user_id.in_(sorted(emp_ids_in_source)),
                )
            )
        ).all()
        valid_target_emp_ids = {r[0] for r in valid_target_emp_rows if r[0] is not None}

    rows: list[dict] = []
    to_create = 0
    to_skip = 0
    to_overwrite = 0
    total_emp_selections = 0
    kept_emp_selections = 0
    dropped_emp_selections = 0
    rules_with_emp_dropped = 0

    for rule in source_rules:
        src_children = children.get(rule.id, {"included_employee_ids": []})
        src_emp = [int(u) for u in src_children.get("included_employee_ids", []) if u]
        src_emp_set = set(src_emp)
        kept_emp = (
            sorted(u for u in src_emp_set if u in valid_target_emp_ids)
            if include_employee_ids
            else []
        )
        kept_set = set(kept_emp)
        dropped_emp = len(src_emp_set - kept_set)

        existing = target_by_scope.get(_rule_scope_key(rule))
        if existing is None:
            # Nothing occupies the slot in the target house.
            action = "create"
        elif existing.is_active and not rule.is_active:
            # Copying an inactive source rule would switch off a target rule
            # that is currently doing the work — never do that implicitly.
            action = "skip"
        elif existing.is_active and rule.is_active:
            # Both sides active on one slot: the target rule must be demoted or
            # replaced, otherwise the partial unique index rejects the insert.
            action = "overwrite"
        else:
            # Target slot only holds a leftover inactive rule, so the slot is
            # effectively free — a fresh active row is the correct outcome.
            # Reporting "skip" here silently dropped the source rule.
            action = "create" if rule.is_active else "overwrite"

        if action == "overwrite" and mode == "skip":
            # The apply will leave colliding target rules untouched, so the
            # preview must not promise an overwrite it will not perform.
            action = "skip"

        if action == "create":
            to_create += 1
        elif action == "overwrite":
            to_overwrite += 1
        else:
            to_skip += 1

        total_emp_selections += len(src_emp_set)
        kept_emp_selections += len(kept_set)
        dropped_emp_selections += dropped_emp
        if dropped_emp:
            rules_with_emp_dropped += 1

        rows.append(
            {
                "source_rule_id": rule.id,
                "context_key": rule.context_key,
                "rule_name": rule.rule_name,
                "target_role": rule.target_role,
                "apply_to": rule.apply_to or "all",
                "column_key": rule.column_key or "all",
                "is_active": rule.is_active,
                "action": action,
                "existing_rule_id": existing.id if existing is not None else None,
                "existing_rule_name": existing.rule_name if existing is not None else None,
                "source_employee_count": len(src_emp_set),
                "kept_employee_count": len(kept_set),
                "dropped_employee_count": dropped_emp,
            }
        )

    return {
        "mode": mode,
        "source_rule_count": len(source_rules),
        "to_create": to_create,
        "to_skip": to_skip,
        "to_overwrite": to_overwrite,
        "rules_with_employee_selection": sum(
            1 for r in source_rules if children.get(r.id, {}).get("included_employee_ids")
        ),
        "total_employee_selections": total_emp_selections,
        "kept_employee_selections": kept_emp_selections,
        "dropped_employee_selections": dropped_emp_selections,
        "valid_target_employee_count": len(valid_target_emp_ids),
        "rows": rows,
    }


async def execute_copy_plan(
    db: AsyncSession,
    plan: dict,
    target_house_id: int,
    user_id: int,
    mode: str,
    include_employee_ids: bool = False,
) -> dict:
    """Apply a copy plan produced by :func:`build_copy_plan`.

    ``mode="skip"`` leaves colliding target rules untouched; ``mode="overwrite"``
    replaces their selection and activation state. Each created active rule first
    demotes any other active rule on the same
    (house, context, role, apply_to, column) slot so the partial unique index
    ``uq_rule_master_active_house_context_role`` holds.
    """
    if mode not in ("skip", "overwrite"):
        raise ValueError(f"Invalid copy mode: {mode}")

    created_ids: list[int] = []
    overwritten_ids: list[int] = []
    skipped = 0

    # Batch-load every source rule's children once — a per-rule fetch would
    # issue 3N queries on a house with many rules.
    source_ids = [
        r["source_rule_id"]
        for r in plan.get("rows", [])
        if r.get("source_rule_id")
        and not (
            r["action"] == "skip"
            or (r["action"] == "overwrite" and mode == "skip")
        )
    ]
    source_children = await get_house_rules_children(db, source_ids)
    # Employee selections survive only when the same login is an Active employee
    # of the target house, so validate the whole batch in one query too.
    all_emp_ids = sorted(
        {
            int(u)
            for c in source_children.values()
            for u in c.get("included_employee_ids", [])
            if u
        }
    )
    valid_emp_ids = set(
        await _valid_target_employee_ids(db, target_house_id, all_emp_ids)
    )

    for row in plan.get("rows", []):
        if row["action"] == "skip":
            skipped += 1
            continue
        if row["action"] == "overwrite" and mode == "skip":
            # The user chose not to touch colliding rules, so a slot that
            # already holds an active target rule stays as-is.
            skipped += 1
            continue

        source_rule = await db.get(ReportRuleMaster, row["source_rule_id"])
        if source_rule is None or source_rule.is_deleted:
            skipped += 1
            continue

        src_children = source_children.get(
            source_rule.id,
            {"excluded_product_codes": [], "excluded_retailer_types": [], "included_employee_ids": []},
        )
        employee_ids = (
            sorted({int(u) for u in src_children["included_employee_ids"] if u} & valid_emp_ids)
            if include_employee_ids
            else []
        )

        if row["action"] == "overwrite" and row.get("existing_rule_id"):
            target_rule = await db.get(ReportRuleMaster, row["existing_rule_id"])
            if target_rule is not None and not target_rule.is_deleted:
                target_rule.rule_name = source_rule.rule_name
                target_rule.is_active = source_rule.is_active
                target_rule.updated_by = user_id
                await db.flush()
                await _set_children(
                    db,
                    target_rule.id,
                    {
                        "excluded_product_codes": src_children["excluded_product_codes"],
                        "excluded_retailer_types": src_children["excluded_retailer_types"],
                        "included_employee_ids": employee_ids,
                    },
                    user_id,
                )
                overwritten_ids.append(target_rule.id)
                continue
            # The colliding target rule was deleted between the plan and the
            # apply — fall through and create a fresh row instead.

        if source_rule.is_active:
            await deactivate_other_active_rules(
                db,
                target_house_id,
                source_rule.context_key,
                source_rule.target_role,
                apply_to=source_rule.apply_to or "all",
                column_key=source_rule.column_key or "all",
            )
            await db.flush()

        new_rule = ReportRuleMaster(
            house_id=target_house_id,
            context_key=source_rule.context_key,
            rule_name=source_rule.rule_name,
            target_role=source_rule.target_role,
            apply_to=source_rule.apply_to or "all",
            column_key=source_rule.column_key or "all",
            is_active=source_rule.is_active,
            created_by=user_id,
            updated_by=user_id,
        )
        db.add(new_rule)
        await db.flush()

        await _set_children(
            db,
            new_rule.id,
            {
                "excluded_product_codes": src_children["excluded_product_codes"],
                "excluded_retailer_types": src_children["excluded_retailer_types"],
                "included_employee_ids": employee_ids,
            },
            user_id,
        )
        created_ids.append(new_rule.id)

    return {
        "created": len(created_ids),
        "overwritten": len(overwritten_ids),
        "skipped": skipped,
        "created_rule_ids": created_ids,
        "overwritten_rule_ids": overwritten_ids,
    }


async def _valid_target_employee_ids(
    db: AsyncSession, house_id: int, user_ids: list[int]
) -> list[int]:
    """Filter employee user_ids down to Active employees of ``house_id``."""
    unique_ids = sorted({int(u) for u in (user_ids or []) if u and int(u) > 0})
    if not unique_ids:
        return []
    from app.models.employee import Employee  # local import: avoids cycle

    rows = (
        await db.execute(
            select(Employee.user_id).where(
                Employee.house_id == house_id,
                Employee.status == "Active",
                Employee.user_id.in_(unique_ids),
            )
        )
    ).all()
    return sorted({r[0] for r in rows if r[0] is not None})