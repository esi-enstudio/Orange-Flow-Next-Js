import logging
import math
from datetime import date, timedelta
from calendar import monthrange
from typing import Optional

from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.house_target import HouseTarget
from app.models.rso_target import RSOTarget
from app.models.bp_target import BpTarget
from app.models.supervisor_target import SupervisorTarget
from app.models.supervisor_assignment import SupervisorRSOAssignment
from app.models.activation import Activation
from app.models.retailer import Retailer
from app.models.employee import Employee
from app.models.bp_retailer_code import BpRetailerCode
from app.models.user import User
from app.services.retailer_marking_service import (
    get_active_retailer_ids_for_marking,
    get_employee_owned_retailer_ids,
)
from app.services.rule_config_service import get_effective_rule_conditions
from app.utils.activation_rules import exclude_clause

logger = logging.getLogger("app.services.ActivationReport")

class ActivationReportService:
    def __init__(self, db: AsyncSession, house_id: int, month: int, year: int, target_role: Optional[str] = None):
        self.db = db
        self.house_id = house_id
        self.month = month
        self.year = year
        self.target_role = target_role
        self.month_start = date(year, month, 1)
        _, last_day = monthrange(year, month)
        self.month_end = date(year, month, last_day)
        self.today = date.today()
        self._days_in_month = last_day
        completed_days = (self.today - self.month_start).days
        self._days_elapsed = min(completed_days, self._days_in_month)
        if self._days_elapsed < 0:
            self._days_elapsed = 0
        self._days_remaining = max(0, self._days_in_month - self._days_elapsed)
        self._remaining_fridays = self._count_fridays_in_range(self.today, self.month_end) if self._days_remaining > 0 else 0
        self._rule_conditions: dict[str, tuple] = {}

    # Role of a rule owns the retailers of that employee type; those must never
    # be excluded from that role's own section (mirrors GA Live SECTION_EMPLOYEE_ROLES).
    ROLE_OWNED_TYPES = {
        "HOUSE": [],
        "SUPERVISOR": ["supervisor"],
        "RSO": ["rso"],
        "BP": ["bp"],
    }

    async def _load_rule_conditions(
        self, role: Optional[str] = None, apply_to: Optional[str] = None
    ) -> tuple[list[str], set[int], list[int]]:
        """Effective activation_report rule conditions for this house.

        ``apply_to`` selects the page section (summary/rso/bp/supervisor) whose
        rules apply, so each report section can be governed independently.
        Product codes = union across all active rules applicable to the section;
        retailer-type exclusions resolved to retailer IDs (the rule's own role
        employees' retailers are exempt, matching GA Live semantics); HOUSE has
        no exemption. `role` defaults to ``self.target_role``.
        """
        key = f"{role or self.target_role}:{apply_to or 'all'}"
        if key in self._rule_conditions:
            return self._rule_conditions[key]
        cond = await get_effective_rule_conditions(
            self.db, self.house_id, "activation_report", role or self.target_role, apply_to=apply_to
        )
        excluded_product_codes = cond.get("excluded_product_codes") or []
        included_user_ids: list[int] = cond.get("included_employee_ids") or []
        excluded_retailer_ids: set[int] = set()
        for tag in cond.get("excluded_retailer_types") or []:
            excluded_retailer_ids |= await get_active_retailer_ids_for_marking(
                self.db, self.house_id, tag
            )
        owned_roles = self.ROLE_OWNED_TYPES.get(key or "", [])
        if owned_roles and excluded_retailer_ids:
            try:
                owned = await get_employee_owned_retailer_ids(
                    self.db, self.house_id, owned_roles
                )
                excluded_retailer_ids -= owned
            except Exception:
                pass
        self._rule_conditions[key] = (excluded_product_codes, excluded_retailer_ids, included_user_ids)
        return self._rule_conditions[key]

    async def _apply_rule_filters(self, q, model, role: Optional[str] = None, apply_to: Optional[str] = None):
        product_codes, excluded_retailer_ids, _ = await self._load_rule_conditions(role, apply_to)
        if product_codes:
            clause = exclude_clause(model, set(product_codes))
            if clause is not None:
                q = q.where(clause)
        if excluded_retailer_ids:
            q = q.where(
                and_(
                    model.retailer_id != None,
                    model.retailer_id.notin_(excluded_retailer_ids),
                )
            )
        return q

    def _count_fridays_in_range(self, start: date, end: date) -> int:
        count = 0
        d = start
        while d <= end:
            if d.weekday() == 4:
                count += 1
            d += timedelta(days=1)
        return count

    async def _count_activations(
        self,
        retailer_ids: Optional[set[int]] = None,
        retailer_codes: Optional[list[str]] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        role: Optional[str] = None,
        apply_to: Optional[str] = None,
    ) -> int:
        q = select(func.count()).select_from(Activation).where(
            Activation.house_id == self.house_id,
            Activation.activation_date >= (start_date or self.month_start),
            Activation.activation_date <= (end_date or self.month_end),
        )
        q = await self._apply_rule_filters(q, Activation, role, apply_to)
        if retailer_ids:
            q = q.where(Activation.retailer_id.in_(retailer_ids))
        if retailer_codes:
            q = q.where(Activation.retailer_code.in_(retailer_codes))
        res = await self.db.execute(q)
        return res.scalar() or 0

    async def _get_house_target(self) -> Optional[HouseTarget]:
        res = await self.db.execute(
            select(HouseTarget).where(
                HouseTarget.house_id == self.house_id,
                HouseTarget.target_date >= self.month_start,
                HouseTarget.target_date <= self.month_end,
            )
        )
        return res.scalar_one_or_none()

    async def _count_activations_for_date(self, target_date: date, retailer_ids: Optional[set[int]] = None, retailer_codes: Optional[list[str]] = None, role: Optional[str] = None, apply_to: Optional[str] = None) -> int:
        q = select(func.count()).select_from(Activation).where(
            Activation.house_id == self.house_id,
            Activation.activation_date == target_date,
        )
        q = await self._apply_rule_filters(q, Activation, role, apply_to)
        if retailer_ids:
            q = q.where(Activation.retailer_id.in_(retailer_ids))
        if retailer_codes:
            q = q.where(Activation.retailer_code.in_(retailer_codes))
        res = await self.db.execute(q)
        return res.scalar() or 0

    async def _count_active_days(self, retailer_ids: Optional[set[int]] = None, retailer_codes: Optional[list[str]] = None, start_date: Optional[date] = None, end_date: Optional[date] = None, threshold: int = 1, role: Optional[str] = None, apply_to: Optional[str] = None) -> int:
        q = select(Activation.activation_date, func.count()).where(
            Activation.house_id == self.house_id,
            Activation.activation_date >= (start_date or self.month_start),
            Activation.activation_date <= (end_date or self.month_end),
        )
        q = await self._apply_rule_filters(q, Activation, role, apply_to)
        if retailer_ids:
            q = q.where(Activation.retailer_id.in_(retailer_ids))
        if retailer_codes:
            q = q.where(Activation.retailer_code.in_(retailer_codes))
        q = q.group_by(Activation.activation_date)
        if threshold > 1:
            q = q.having(func.count() >= threshold)
        res = await self.db.execute(q)
        return len(res.all())

    async def get_summary(self) -> dict:
        target = await self._get_house_target()
        monthly_target = target.total_ga_target or 0 if target else 0

        prev_month = self.month - 1 or 12
        prev_year = self.year - 1 if self.month == 1 else self.year
        prev_start = date(prev_year, prev_month, 1)
        _, prev_last_day = monthrange(prev_year, prev_month)
        prev_end = date(prev_year, prev_month, prev_last_day)
        prev_target_row = await self.db.execute(
            select(HouseTarget).where(
                HouseTarget.house_id == self.house_id,
                HouseTarget.target_date >= prev_start,
                HouseTarget.target_date <= prev_end,
            )
        )
        prev_target = prev_target_row.scalar_one_or_none()
        previous_month_target = prev_target.total_ga_target or 0 if prev_target else 0

        achievement = await self._count_activations(role="HOUSE", apply_to="summary")
        yesterday_date = self.today - timedelta(days=1)
        yesterday_activation = await self._count_activations_for_date(yesterday_date, role="HOUSE", apply_to="summary") if yesterday_date >= self.month_start else 0

        prev_act_q = select(func.count()).select_from(Activation).where(
            Activation.house_id == self.house_id,
            Activation.activation_date >= prev_start,
            Activation.activation_date <= prev_end,
        )
        prev_act_q = await self._apply_rule_filters(prev_act_q, Activation, role="HOUSE", apply_to="summary")
        prev_act_res = await self.db.execute(prev_act_q)
        previous_month_achievement = prev_act_res.scalar() or 0

        achievement_pct = round((achievement / monthly_target * 100), 1) if monthly_target else 0
        remaining = max(0, monthly_target - achievement)
        excl_friday_days = max(self._days_remaining - self._remaining_fridays, 1)
        daily_required = math.ceil(remaining / excl_friday_days) if self._days_remaining else 0
        daily_required_with_friday = math.ceil(remaining / max(self._days_remaining, 1)) if self._days_remaining else 0
        daily_avg = round(achievement / max(self._days_elapsed, 1)) if self._days_elapsed else 0
        projection = round(daily_avg * self._days_in_month, 1)
        expected_pct = round((projection / monthly_target * 100), 1) if monthly_target else 0

        return {
            "monthly_target": monthly_target,
            "achievement": achievement,
            "achievement_percentage": achievement_pct,
            "remaining": remaining,
            "daily_required": daily_required,
            "daily_required_with_friday": daily_required_with_friday,
            "remaining_fridays": self._remaining_fridays,
            "daily_average": daily_avg,
            "projection": projection,
            "expected_percentage": expected_pct,
            "days_elapsed": self._days_elapsed,
            "days_remaining": self._days_remaining,
            "total_days": self._days_in_month,
            "yesterday_activation": yesterday_activation,
            "previous_month_target": previous_month_target,
            "previous_month_achievement": previous_month_achievement,
        }

    async def _get_employee_performance(
        self,
        employee_ids: list[int],
        target_map: dict,
        name_map: dict[int, str],
        type_label: str,
        assisted_code_map: Optional[dict[int, Optional[str]]] = None,
        role: str = "RSO",
        apply_to: Optional[str] = None,
    ) -> list[dict]:
        results = []
        yesterday_date = self.today - timedelta(days=1)
        for emp_id in employee_ids:
            target_val = target_map.get(emp_id, 0)
            retailer_ids = await self._get_retailer_ids_for_employee(emp_id)

            achievement = await self._count_activations(retailer_ids=retailer_ids, role=role, apply_to=apply_to)
            market_activation = achievement
            market_yesterday = await self._count_activations_for_date(yesterday_date, retailer_ids=retailer_ids, role=role, apply_to=apply_to) if yesterday_date >= self.month_start else 0

            pct = round((achievement / target_val * 100), 1) if target_val else 0
            remaining = max(0, target_val - achievement)
            daily_avg = round(achievement / max(self._days_elapsed, 1))
            projection = round(daily_avg * self._days_in_month, 1)

            if pct >= 100:
                status = "achieved"
            elif pct >= 70:
                status = "on_track"
            elif pct >= 40:
                status = "needs_attention"
            else:
                status = "behind"

            # Own Activation (yesterday, MTD total, active days) comes ONLY from
            # the assisted retailer code. RSOs without an assisted code show zero.
            assisted_code = assisted_code_map.get(emp_id) if assisted_code_map else None
            if type_label == "rso" and assisted_code and yesterday_date >= self.month_start:
                yesterday_activation = await self._count_activations_for_date(yesterday_date, retailer_codes=[assisted_code], role=role, apply_to=apply_to)
            else:
                yesterday_activation = 0

            if type_label == "rso" and assisted_code and yesterday_date >= self.month_start:
                month_total = await self._count_activations(retailer_codes=[assisted_code], end_date=yesterday_date, role=role, apply_to=apply_to)
            else:
                month_total = 0
            if type_label == "rso" and assisted_code:
                active_days = await self._count_active_days(retailer_codes=[assisted_code], end_date=yesterday_date, role=role, apply_to=apply_to)
            else:
                active_days = 0

            results.append({
                "id": emp_id,
                "name": name_map.get(emp_id, f"#{emp_id}"),
                "target": target_val,
                "achievement": achievement,
                "percentage": pct,
                "remaining": remaining,
                "daily_average": daily_avg,
                "projection": projection,
                "status": status,
                "market_activation": market_activation,
                "market_yesterday": market_yesterday,
                "yesterday_activation": yesterday_activation,
                "month_total_activation": month_total,
                "active_days": active_days,
            })

        results.sort(key=lambda r: r["percentage"], reverse=True)
        return results

    async def _get_retailer_ids_for_employee(self, employee_id: int) -> set[int]:
        res = await self.db.execute(
            select(Retailer.id).where(
                Retailer.employee_id == employee_id,
                Retailer.house_id == self.house_id,
            )
        )
        return {r[0] for r in res.all()}

    async def _get_employee_name(self, emp: Employee) -> str:
        if emp.employee_name:
            return emp.employee_name
        if emp.user_id:
            user_res = await self.db.execute(select(User.name).where(User.id == emp.user_id))
            name = user_res.scalar_one_or_none()
            if name:
                return name
        return emp.dms_code or emp.employee_id or f"#{emp.id}"

    async def get_rso_performance(self) -> list[dict]:
        _, _, included_user_ids = await self._load_rule_conditions("RSO", apply_to="rso")
        emp_q = select(Employee).where(
            Employee.house_id == self.house_id,
            Employee.employee_type == "rso",
            Employee.status == "Active",
        )
        if included_user_ids:
            emp_q = emp_q.where(Employee.user_id.in_(included_user_ids))
        emps = await self.db.execute(emp_q)
        employees = emps.scalars().all()
        if not employees:
            return []

        emp_ids = [e.id for e in employees]
        name_map = {e.id: await self._get_employee_name(e) for e in employees}

        target_rows = await self.db.execute(
            select(RSOTarget).where(
                RSOTarget.employee_id.in_(emp_ids),
                RSOTarget.target_date >= self.month_start,
                RSOTarget.target_date <= self.month_end,
            )
        )
        target_map = {}
        for t in target_rows.scalars().all():
            target_map[t.employee_id] = t.ga or 0

        assisted_code_map = {e.id: e.assisted_retailer_code for e in employees}
        results = await self._get_employee_performance(
            emp_ids, target_map, name_map, "rso",
            assisted_code_map=assisted_code_map,
            role="RSO",
            apply_to="rso",
        )
        itop_map = {e.id: e.itop_number for e in employees}
        dms_map = {e.id: e.dms_code for e in employees}
        for r in results:
            r["employee_type"] = "rso"
            r["itop_number"] = itop_map.get(r["id"])
            r["dms_code"] = dms_map.get(r["id"])
        return results

    async def get_bp_performance(self) -> list[dict]:
        _, _, included_user_ids = await self._load_rule_conditions("BP", apply_to="bp")
        emp_q = select(Employee).where(
            Employee.house_id == self.house_id,
            Employee.employee_type == "bp",
            Employee.status == "Active",
        )
        if included_user_ids:
            emp_q = emp_q.where(Employee.user_id.in_(included_user_ids))
        emps = await self.db.execute(emp_q)
        employees = emps.scalars().all()
        if not employees:
            return []

        emp_ids = [e.id for e in employees]
        name_map = {e.id: await self._get_employee_name(e) for e in employees}

        target_rows = await self.db.execute(
            select(BpTarget).where(
                BpTarget.employee_id.in_(emp_ids),
                BpTarget.target_date >= self.month_start,
                BpTarget.target_date <= self.month_end,
            )
        )
        target_map = {}
        for t in target_rows.scalars().all():
            target_map[t.employee_id] = t.ga_target or 0

        pool_map = {e.id: e.pool_number for e in employees}
        assisted_code_map = {e.id: e.assisted_retailer_code for e in employees}
        yesterday_date = self.today - timedelta(days=1)
        results = []
        for emp_id in emp_ids:
            target_val = target_map.get(emp_id, 0)
            bp_code_rows = await self.db.execute(
                select(BpRetailerCode.retailer_code).where(
                    BpRetailerCode.bp_employee_id == emp_id,
                    BpRetailerCode.house_id == self.house_id,
                )
            )
            retailer_codes = [row[0] for row in bp_code_rows.all() if row[0]]
            achievement = 0
            if retailer_codes:
                q = select(func.count()).select_from(Activation).where(
                    Activation.house_id == self.house_id,
                    Activation.activation_date >= self.month_start,
                    Activation.activation_date <= yesterday_date,
                    Activation.retailer_code.in_(retailer_codes),
                )
                q = await self._apply_rule_filters(q, Activation, role="BP", apply_to="bp")
                res = await self.db.execute(q)
                achievement = res.scalar() or 0

            pct = round((achievement / target_val * 100), 1) if target_val else 0
            remaining = max(0, target_val - achievement)
            daily_avg = round(achievement / max(self._days_elapsed, 1))
            projection = round(daily_avg * self._days_in_month, 1)

            if pct >= 100:
                status = "achieved"
            elif pct >= 70:
                status = "on_track"
            elif pct >= 40:
                status = "needs_attention"
            else:
                status = "behind"

            # ── Yesterday, Total GA, Day Count via assisted code ──
            assisted_code = assisted_code_map.get(emp_id)
            if assisted_code and yesterday_date >= self.month_start:
                yesterday_activation = await self._count_activations_for_date(yesterday_date, retailer_codes=[assisted_code], role="BP", apply_to="bp")
            else:
                yesterday_activation = 0

            if assisted_code and yesterday_date >= self.month_start:
                month_total_activation = await self._count_activations(retailer_codes=[assisted_code], end_date=yesterday_date, role="BP", apply_to="bp")
            else:
                month_total_activation = achievement

            if assisted_code:
                active_days = await self._count_active_days(retailer_codes=[assisted_code], end_date=yesterday_date, role="BP", apply_to="bp")
            else:
                active_days = await self._count_active_days(retailer_codes=retailer_codes, role="BP", apply_to="bp") if retailer_codes else 0

            results.append({
                "id": emp_id,
                "name": name_map.get(emp_id, f"#{emp_id}"),
                "target": target_val,
                "achievement": achievement,
                "percentage": pct,
                "remaining": remaining,
                "daily_average": daily_avg,
                "projection": projection,
                "status": status,
                "employee_type": "bp",
                "pool_number": pool_map.get(emp_id),
                "yesterday_activation": yesterday_activation,
                "month_total_activation": month_total_activation,
                "active_days": active_days,
            })

        results.sort(key=lambda r: r["percentage"], reverse=True)
        return results

    async def get_supervisor_performance(self) -> list[dict]:
        _, _, included_user_ids = await self._load_rule_conditions("SUPERVISOR", apply_to="supervisor")
        emp_q = select(Employee).where(
            Employee.house_id == self.house_id,
            Employee.employee_type == "supervisor",
            Employee.status == "Active",
        )
        if included_user_ids:
            emp_q = emp_q.where(Employee.user_id.in_(included_user_ids))
        emps = await self.db.execute(emp_q)
        employees = emps.scalars().all()
        if not employees:
            return []

        emp_ids = [e.id for e in employees]
        name_map = {e.id: await self._get_employee_name(e) for e in employees}
        pool_map = {e.id: e.pool_number for e in employees}

        target_rows = await self.db.execute(
            select(SupervisorTarget).where(
                SupervisorTarget.employee_id.in_(emp_ids),
                SupervisorTarget.target_date >= self.month_start,
                SupervisorTarget.target_date <= self.month_end,
            )
        )
        target_map = {}
        for t in target_rows.scalars().all():
            target_map[t.employee_id] = t.total_ga or 0

        assignment_rows = await self.db.execute(
            select(SupervisorRSOAssignment)
            .join(Employee, Employee.id == SupervisorRSOAssignment.member_employee_id)
            .where(
                SupervisorRSOAssignment.supervisor_employee_id.in_(emp_ids),
                Employee.house_id == self.house_id,
                Employee.status == "Active",
            )
        )
        assignments = assignment_rows.scalars().all()

        sup_emp_to_rso_emps: dict[int, list[Employee]] = {eid: [] for eid in emp_ids}
        rso_emp_name_map: dict[int, str] = {}
        if assignments:
            member_ids = [a.member_employee_id for a in assignments]
            rso_emp_rows = await self.db.execute(
                select(Employee).where(
                    Employee.id.in_(member_ids),
                    Employee.house_id == self.house_id,
                    Employee.status == "Active",
                )
            )
            rso_emps = rso_emp_rows.scalars().all()
            rso_emp_by_id = {e.id: e for e in rso_emps}

            for a in assignments:
                member = rso_emp_by_id.get(a.member_employee_id)
                if member:
                    sup_emp_to_rso_emps.setdefault(a.supervisor_employee_id, []).append(member)
                    if member.id not in rso_emp_name_map:
                        rso_emp_name_map[member.id] = await self._get_employee_name(member)

        yesterday_date = self.today - timedelta(days=1)
        results = []
        for emp in employees:
            emp_id = emp.id
            target_val = target_map.get(emp_id, 0)

            rso_emps_for_sup = sup_emp_to_rso_emps.get(emp_id) or []
            team = [{
                "employee_id": m.id,
                "name": rso_emp_name_map.get(m.id, f"#{m.id}"),
                "employee_type": m.employee_type,
                "dms_code": m.dms_code,
                "itop_number": m.itop_number,
                "pool_number": m.pool_number,
            } for m in rso_emps_for_sup]

            all_rso_retailer_ids: set[int] = set()
            for rso_emp in rso_emps_for_sup:
                rso_retailer_ids = await self._get_retailer_ids_for_employee(rso_emp.id)
                all_rso_retailer_ids.update(rso_retailer_ids)

            achievement = await self._count_activations(
                retailer_ids=all_rso_retailer_ids,
                role="SUPERVISOR",
                apply_to="supervisor",
            ) if all_rso_retailer_ids else 0

            pct = round((achievement / target_val * 100), 1) if target_val else 0
            remaining = max(0, target_val - achievement)
            daily_avg = round(achievement / max(self._days_elapsed, 1))
            projection = round(daily_avg * self._days_in_month, 1)

            if pct >= 100:
                status = "achieved"
            elif pct >= 70:
                status = "on_track"
            elif pct >= 40:
                status = "needs_attention"
            else:
                status = "behind"

            if all_rso_retailer_ids:
                yesterday_activation = await self._count_activations_for_date(
                    yesterday_date,
                    retailer_ids=all_rso_retailer_ids,
                    role="SUPERVISOR",
                    apply_to="supervisor",
                ) if yesterday_date >= self.month_start else 0
                month_total_activation = achievement
                active_days = await self._count_active_days(
                    retailer_ids=all_rso_retailer_ids,
                    role="SUPERVISOR",
                    apply_to="supervisor",
                )
            else:
                yesterday_activation = 0
                month_total_activation = 0
                active_days = 0

            results.append({
                "id": emp_id,
                "name": name_map.get(emp_id, f"#{emp_id}"),
                "pool_number": pool_map.get(emp_id),
                "target": target_val,
                "achievement": achievement,
                "percentage": pct,
                "remaining": remaining,
                "daily_average": daily_avg,
                "projection": projection,
                "status": status,
                "employee_type": "supervisor",
                "yesterday_activation": yesterday_activation,
                "month_total_activation": month_total_activation,
                "active_days": active_days,
                "team": team,
            })

        results.sort(key=lambda r: r["percentage"], reverse=True)
        return results

    async def get_daily_trend(self) -> list[dict]:
        trend_map: dict[str, int] = {}
        q = select(Activation.activation_date, func.count()).where(
            Activation.house_id == self.house_id,
            Activation.activation_date >= self.month_start,
            Activation.activation_date <= self.month_end,
        )
        q = await self._apply_rule_filters(q, Activation, role="HOUSE", apply_to="summary")
        q = q.group_by(Activation.activation_date).order_by(Activation.activation_date)
        for row in (await self.db.execute(q)).all():
            d = row.activation_date
            trend_map[d.isoformat() if isinstance(d, date) else str(d)] = row[1]

        target = await self._get_house_target()
        monthly_target = target.total_ga_target or 0 if target else 0
        daily_target = round(monthly_target / self._days_in_month, 1) if self._days_in_month else 0

        result = []
        d = self.month_start
        while d <= self.month_end:
            ds = d.isoformat()
            is_future = d > self.today
            result.append({
                "date": ds,
                "actual": trend_map.get(ds, 0) if not is_future else None,
                "target": daily_target,
                "is_future": is_future,
            })
            d += timedelta(days=1)
        return result

    async def get_top_performers(self, rso_list: list[dict], bp_list: list[dict], supervisor_list: Optional[list[dict]] = None) -> dict:
        result = {
            "rso": rso_list[:5] if rso_list else [],
            "bp": bp_list[:5] if bp_list else [],
        }
        if supervisor_list:
            result["supervisor"] = supervisor_list[:5]
        return result

    async def build_dashboard(self) -> dict:
        summary = await self.get_summary()
        rso = await self.get_rso_performance()
        bp = await self.get_bp_performance()
        supervisor = await self.get_supervisor_performance()
        daily_trend = await self.get_daily_trend()
        top_performers = await self.get_top_performers(rso, bp, supervisor)

        return {
            "success": True,
            "summary": summary,
            "rso_performance": rso,
            "bp_performance": bp,
            "supervisor_performance": supervisor,
            "daily_trend": daily_trend,
            "top_performers": top_performers,
        }