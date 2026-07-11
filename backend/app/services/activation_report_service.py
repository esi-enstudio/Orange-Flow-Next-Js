import logging
from datetime import date, datetime, timedelta
from calendar import monthrange
from typing import Optional

from sqlalchemy import select, func, and_, false
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.house_target import HouseTarget
from app.models.rso_target import RSOTarget
from app.models.bp_target import BpTarget
from app.models.supervisor_target import SupervisorTarget
from app.models.activation import Activation
from app.models.retailer import Retailer
from app.models.employee import Employee
from app.models.bp_retailer_code import BpRetailerCode
from app.models.user import User
from app.models.role import Role
from app.models.ga_filter import FilterTag, RetailerFilter
from app.models.product_exclusion import ExcludedProductCode

logger = logging.getLogger("app.services.ActivationReport")

class ActivationReportService:
    def __init__(self, db: AsyncSession, house_id: int, month: int, year: int,
                 exclude_tag_names: Optional[list[str]] = None,
                 exclude_product_codes: Optional[set[str]] = None,
                 achieved_exclude_tag_names: Optional[list[str]] = None,
                 market_exclude_tag_names: Optional[list[str]] = None,
                 active_days_threshold: int = 1):
        self.db = db
        self.house_id = house_id
        self.month = month
        self.year = year
        self.exclude_tag_names = exclude_tag_names or []
        self.exclude_product_codes = exclude_product_codes or set()
        self.achieved_exclude_tag_names = achieved_exclude_tag_names or []
        self.market_exclude_tag_names = market_exclude_tag_names or []
        self.active_days_threshold = active_days_threshold
        self._cached_excluded_ids: Optional[set[int]] = None
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

    def _count_fridays_in_range(self, start: date, end: date) -> int:
        count = 0
        d = start
        while d <= end:
            if d.weekday() == 4:
                count += 1
            d += timedelta(days=1)
        return count

    async def _get_excluded_retailer_ids(self) -> set[int]:
        if self._cached_excluded_ids is not None:
            return self._cached_excluded_ids
        if not self.exclude_tag_names:
            self._cached_excluded_ids = set()
            return self._cached_excluded_ids
        q = select(RetailerFilter.retailer_id).join(FilterTag, RetailerFilter.tag_id == FilterTag.id).where(
            FilterTag.name.in_(self.exclude_tag_names),
            RetailerFilter.house_id == self.house_id,
        )
        res = await self.db.execute(q)
        self._cached_excluded_ids = {row[0] for row in res.all()}
        return self._cached_excluded_ids

    async def _get_excluded_retailer_ids_for_tags(self, tag_names: list[str]) -> set[int]:
        if not tag_names:
            return set()
        q = select(RetailerFilter.retailer_id).join(FilterTag, RetailerFilter.tag_id == FilterTag.id).where(
            FilterTag.name.in_(tag_names),
            RetailerFilter.house_id == self.house_id,
        )
        res = await self.db.execute(q)
        return {row[0] for row in res.all()}

    async def _count_activations(
        self,
        retailer_ids: Optional[set[int]] = None,
        retailer_codes: Optional[list[str]] = None,
        exclude_ids: Optional[set[int]] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        exclude_tags: bool = True,
    ) -> int:
        total = 0
        excluded = exclude_ids if exclude_ids is not None else (await self._get_excluded_retailer_ids() if exclude_tags else set())
        excluded_codes = self.exclude_product_codes

        q = select(func.count()).select_from(Activation).where(
            Activation.house_id == self.house_id,
            Activation.activation_date >= (start_date or self.month_start),
            Activation.activation_date <= (end_date or self.month_end),
        )
        if retailer_ids:
            q = q.where(Activation.retailer_id.in_(retailer_ids))
        if retailer_codes:
            q = q.where(Activation.retailer_code.in_(retailer_codes))
        if excluded:
            q = q.where(
                Activation.retailer_id.notin_(excluded),
                Activation.retailer_id != None,
            )
        if excluded_codes:
            q = q.where(Activation.product_code.notin_(excluded_codes))
        res = await self.db.execute(q)
        total = res.scalar() or 0

        return total

    async def _get_house_target(self) -> Optional[HouseTarget]:
        res = await self.db.execute(
            select(HouseTarget).where(
                HouseTarget.house_id == self.house_id,
                HouseTarget.target_date >= self.month_start,
                HouseTarget.target_date <= self.month_end,
            )
        )
        return res.scalar_one_or_none()

    async def _count_activations_for_date(self, target_date: date, retailer_ids: Optional[set[int]] = None, retailer_codes: Optional[list[str]] = None, exclude_ids: Optional[set[int]] = None, exclude_tags: bool = True) -> int:
        excluded = exclude_ids if exclude_ids is not None else (await self._get_excluded_retailer_ids() if exclude_tags else set())
        excluded_codes = self.exclude_product_codes
        q = select(func.count()).select_from(Activation).where(
            Activation.house_id == self.house_id,
            Activation.activation_date == target_date,
        )
        if retailer_ids:
            q = q.where(Activation.retailer_id.in_(retailer_ids))
        if retailer_codes:
            q = q.where(Activation.retailer_code.in_(retailer_codes))
        if excluded and exclude_tags:
            q = q.where(
                Activation.retailer_id.notin_(excluded),
                Activation.retailer_id != None,
            )
        if excluded_codes:
            q = q.where(Activation.product_code.notin_(excluded_codes))
        res = await self.db.execute(q)
        return res.scalar() or 0

    async def _count_active_days(self, retailer_ids: Optional[set[int]] = None, retailer_codes: Optional[list[str]] = None, exclude_tags: bool = True, start_date: Optional[date] = None, end_date: Optional[date] = None, threshold: int = 1) -> int:
        excluded = await self._get_excluded_retailer_ids() if exclude_tags else set()
        excluded_codes = self.exclude_product_codes
        q = select(Activation.activation_date, func.count()).where(
            Activation.house_id == self.house_id,
            Activation.activation_date >= (start_date or self.month_start),
            Activation.activation_date <= (end_date or self.month_end),
        )
        if retailer_ids:
            q = q.where(Activation.retailer_id.in_(retailer_ids))
        if retailer_codes:
            q = q.where(Activation.retailer_code.in_(retailer_codes))
        if excluded and exclude_tags:
            q = q.where(Activation.retailer_id.notin_(excluded))
        if excluded_codes:
            q = q.where(Activation.product_code.notin_(excluded_codes))
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

        achievement = await self._count_activations()
        yesterday_date = self.today - timedelta(days=1)
        yesterday_activation = await self._count_activations_for_date(yesterday_date) if yesterday_date >= self.month_start else 0

        excluded_for_prev = await self._get_excluded_retailer_ids()
        excluded_codes = self.exclude_product_codes
        prev_act_q = select(func.count()).select_from(Activation).where(
            Activation.house_id == self.house_id,
            Activation.activation_date >= prev_start,
            Activation.activation_date <= prev_end,
        )
        if excluded_for_prev:
            prev_act_q = prev_act_q.where(Activation.retailer_id.notin_(excluded_for_prev), Activation.retailer_id != None)
        if excluded_codes:
            prev_act_q = prev_act_q.where(Activation.product_code.notin_(excluded_codes))
        prev_act_res = await self.db.execute(prev_act_q)
        previous_month_achievement = prev_act_res.scalar() or 0

        achievement_pct = round((achievement / monthly_target * 100), 1) if monthly_target else 0
        remaining = max(0, monthly_target - achievement)
        excl_friday_days = max(self._days_remaining - self._remaining_fridays, 1)
        daily_required = round(remaining / excl_friday_days) if self._days_remaining else 0
        daily_required_with_friday = round(remaining / max(self._days_remaining, 1)) if self._days_remaining else 0
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
        achieved_exclude_tag_names: Optional[list[str]] = None,
        market_exclude_tag_names: Optional[list[str]] = None,
        assisted_code_map: Optional[dict[int, Optional[str]]] = None,
    ) -> list[dict]:
        results = []
        yesterday_date = self.today - timedelta(days=1)
        achieved_tag_list = achieved_exclude_tag_names or []
        market_tag_list = market_exclude_tag_names or []
        achieved_excluded_ids = await self._get_excluded_retailer_ids_for_tags(achieved_tag_list) if achieved_tag_list else None
        market_excluded_ids = await self._get_excluded_retailer_ids_for_tags(market_tag_list) if market_tag_list else None

        for emp_id in employee_ids:
            target_val = target_map.get(emp_id, 0)
            retailer_ids = await self._get_retailer_ids_for_employee(emp_id)

            if achieved_excluded_ids is not None:
                achievement = await self._count_activations(retailer_ids=retailer_ids, exclude_ids=achieved_excluded_ids)
            else:
                achievement = await self._count_activations(retailer_ids=retailer_ids)

            if market_excluded_ids is not None:
                if yesterday_date >= self.month_start:
                    market_activation = await self._count_activations(retailer_ids=retailer_ids, exclude_ids=market_excluded_ids, end_date=yesterday_date)
                    market_yesterday = await self._count_activations_for_date(yesterday_date, retailer_ids=retailer_ids, exclude_ids=market_excluded_ids)
                else:
                    market_activation = 0
                    market_yesterday = 0
            else:
                market_activation = achievement
                market_yesterday = await self._count_activations_for_date(yesterday_date, retailer_ids=retailer_ids) if yesterday_date >= self.month_start else 0

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

            assisted_code = assisted_code_map.get(emp_id) if assisted_code_map else None
            if type_label == "rso" and assisted_code and yesterday_date >= self.month_start:
                yesterday_activation = await self._count_activations_for_date(yesterday_date, retailer_codes=[assisted_code], exclude_tags=False)
            elif yesterday_date >= self.month_start:
                yesterday_activation = await self._count_activations_for_date(yesterday_date, retailer_ids=retailer_ids)
            else:
                yesterday_activation = 0

            if type_label == "rso" and assisted_code and yesterday_date >= self.month_start:
                month_total = await self._count_activations(retailer_codes=[assisted_code], end_date=yesterday_date, exclude_tags=False)
            else:
                month_total = achievement
            if type_label == "rso" and assisted_code:
                active_days = await self._count_active_days(retailer_codes=[assisted_code], exclude_tags=False, end_date=yesterday_date, threshold=self.active_days_threshold)
            else:
                active_days = await self._count_active_days(retailer_ids)

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
        if emp.user_id:
            user_res = await self.db.execute(select(User.name).where(User.id == emp.user_id))
            name = user_res.scalar_one_or_none()
            if name:
                return name
        return emp.dms_code or emp.employee_id or f"#{emp.id}"

    async def get_rso_performance(self) -> list[dict]:
        emps = await self.db.execute(
            select(Employee).where(
                Employee.house_id == self.house_id,
                Employee.employee_type == "rso",
                Employee.status == "Active",
            )
        )
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
            achieved_exclude_tag_names=self.achieved_exclude_tag_names,
            market_exclude_tag_names=self.market_exclude_tag_names,
            assisted_code_map=assisted_code_map,
        )
        itop_map = {e.id: e.itop_number for e in employees}
        for r in results:
            r["employee_type"] = "rso"
            r["itop_number"] = itop_map.get(r["id"])
        return results

    async def get_bp_performance(self) -> list[dict]:
        emps = await self.db.execute(
            select(Employee).where(
                Employee.house_id == self.house_id,
                Employee.employee_type == "bp",
                Employee.status == "Active",
            )
        )
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
                excluded = await self._get_excluded_retailer_ids()
                q = select(func.count()).select_from(Activation).where(
                    Activation.house_id == self.house_id,
                    Activation.activation_date >= self.month_start,
                    Activation.activation_date <= yesterday_date,
                    Activation.retailer_code.in_(retailer_codes),
                )
                if excluded:
                    q = q.where(Activation.retailer_id.notin_(excluded), Activation.retailer_id != None)
                if self.exclude_product_codes:
                    q = q.where(Activation.product_code.notin_(self.exclude_product_codes))
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
                yesterday_activation = await self._count_activations_for_date(yesterday_date, retailer_codes=[assisted_code], exclude_tags=False)
            else:
                yesterday_activation = 0

            if assisted_code and yesterday_date >= self.month_start:
                month_total_activation = await self._count_activations(retailer_codes=[assisted_code], end_date=yesterday_date, exclude_tags=False)
            else:
                month_total_activation = achievement

            if assisted_code:
                active_days = await self._count_active_days(retailer_codes=[assisted_code], exclude_tags=False, end_date=yesterday_date, threshold=self.active_days_threshold)
            else:
                active_days = await self._count_active_days(retailer_codes=retailer_codes) if retailer_codes else 0

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
        emps = await self.db.execute(
            select(Employee).where(
                Employee.house_id == self.house_id,
                Employee.employee_type == "supervisor",
                Employee.status == "Active",
            )
        )
        employees = emps.scalars().all()
        if not employees:
            return []

        emp_ids = [e.id for e in employees]
        name_map = {e.id: await self._get_employee_name(e) for e in employees}
        pool_map = {e.id: e.pool_number for e in employees}
        sup_user_map = {e.user_id: e.id for e in employees if e.user_id}

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

        sup_user_ids = list(sup_user_map.keys())
        rso_rows = await self.db.execute(
            select(User).where(
                User.parent_id.in_(sup_user_ids) if sup_user_ids else false(),
            )
        )
        rso_users = rso_rows.scalars().all()

        supervisor_user_to_rso_emps: dict[int, list[Employee]] = {uid: [] for uid in sup_user_map}
        if rso_users:
            rso_user_ids = [u.id for u in rso_users]
            rso_emp_rows = await self.db.execute(
                select(Employee).where(
                    Employee.user_id.in_(rso_user_ids),
                    Employee.house_id == self.house_id,
                    Employee.status == "Active",
                )
            )
            rso_emps = rso_emp_rows.scalars().all()
            rso_emp_by_user = {e.user_id: e for e in rso_emps if e.user_id}

            for u in rso_users:
                rso_emp = rso_emp_by_user.get(u.id)
                if rso_emp:
                    sup_uid = u.parent_id
                    if sup_uid in supervisor_user_to_rso_emps:
                        supervisor_user_to_rso_emps[sup_uid].append(rso_emp)

        yesterday_date = self.today - timedelta(days=1)
        results = []
        for emp in employees:
            emp_id = emp.id
            target_val = target_map.get(emp_id, 0)

            rso_emps_for_sup = supervisor_user_to_rso_emps.get(emp.user_id) or []
            all_rso_retailer_ids: set[int] = set()
            for rso_emp in rso_emps_for_sup:
                rso_retailer_ids = await self._get_retailer_ids_for_employee(rso_emp.id)
                all_rso_retailer_ids.update(rso_retailer_ids)

            achievement = await self._count_activations(retailer_ids=all_rso_retailer_ids) if all_rso_retailer_ids else 0

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
                yesterday_activation = await self._count_activations_for_date(yesterday_date, retailer_ids=all_rso_retailer_ids) if yesterday_date >= self.month_start else 0
                month_total_activation = achievement
                active_days = await self._count_active_days(retailer_ids=all_rso_retailer_ids)
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
            })

        results.sort(key=lambda r: r["percentage"], reverse=True)
        return results

    async def get_cc_performance(self) -> list[dict]:
        cc_users = await self.db.execute(
            select(User).options(selectinload(User.roles)).where(
                User.employee_profile.has(Employee.house_id == self.house_id)
            )
        )
        cc_user_ids = []
        for u in cc_users.unique().scalars().all():
            role_names = [r.name.lower() for r in u.roles]
            if "cc" in role_names:
                cc_user_ids.append(u.id)

        if not cc_user_ids:
            return []

        emps = await self.db.execute(
            select(Employee).where(
                Employee.house_id == self.house_id,
                Employee.user_id.in_(cc_user_ids),
                Employee.status == "Active",
            )
        )
        employees = emps.scalars().all()
        if not employees:
            return []

        emp_ids = [e.id for e in employees]
        name_map = {e.id: await self._get_employee_name(e) for e in employees}

        results = []
        for emp_id in emp_ids:
            retailer_ids = await self._get_retailer_ids_for_employee(emp_id)
            achievement = await self._count_activations(retailer_ids=retailer_ids)
            target_val = 0

            pct = round((achievement / target_val * 100), 1) if target_val else 0
            remaining = max(0, target_val - achievement)
            daily_avg = round(achievement / max(self._days_elapsed, 1))
            projection = round(daily_avg * self._days_in_month, 1)
            status = "on_track" if achievement > 0 else "behind"

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
            })

        results.sort(key=lambda r: r["achievement"], reverse=True)
        return results

    async def get_daily_trend(self) -> list[dict]:
        trend_map: dict[str, int] = {}
        excluded = await self._get_excluded_retailer_ids()
        excluded_codes = self.exclude_product_codes

        q = select(Activation.activation_date, func.count()).where(
            Activation.house_id == self.house_id,
            Activation.activation_date >= self.month_start,
            Activation.activation_date <= self.month_end,
        )
        if excluded:
            q = q.where(
                Activation.retailer_id.notin_(excluded),
                Activation.retailer_id != None,
            )
        if excluded_codes:
            q = q.where(Activation.product_code.notin_(excluded_codes))
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

    async def get_top_performers(self, rso_list: list[dict], bp_list: list[dict], cc_list: list[dict], supervisor_list: Optional[list[dict]] = None) -> dict:
        result = {
            "rso": rso_list[:5] if rso_list else [],
            "bp": bp_list[:5] if bp_list else [],
            "cc": cc_list[:5] if cc_list else [],
        }
        if supervisor_list:
            result["supervisor"] = supervisor_list[:5]
        return result

    async def build_dashboard(self) -> dict:
        summary = await self.get_summary()
        rso = await self.get_rso_performance()
        bp = await self.get_bp_performance()
        cc = await self.get_cc_performance()
        supervisor = await self.get_supervisor_performance()
        daily_trend = await self.get_daily_trend()
        top_performers = await self.get_top_performers(rso, bp, cc, supervisor)

        return {
            "success": True,
            "summary": summary,
            "rso_performance": rso,
            "bp_performance": bp,
            "cc_performance": cc,
            "supervisor_performance": supervisor,
            "daily_trend": daily_trend,
            "top_performers": top_performers,
        }
