import logging
from datetime import date, datetime, timedelta
from calendar import monthrange
from typing import Optional

from sqlalchemy import select, func, false
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.house_target import HouseTarget
from app.models.rso_target import RSOTarget
from app.models.supervisor_target import SupervisorTarget
from app.models.itopup_detail import ITopUpDetail
from app.models.retailer import Retailer
from app.models.employee import Employee
from app.models.user import User
from app.models.house import House

logger = logging.getLogger("app.services.RechargeReport")

class RechargeReportService:
    def __init__(self, db: AsyncSession, house_id: int, month: int, year: int, report_type: str = "recharge"):
        self.db = db
        self.house_id = house_id
        self.month = month
        self.year = year
        self.report_type = report_type if report_type in ("recharge", "ev_secondary") else "recharge"
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
        self._working_days_remaining = max(0, self._days_remaining - self._remaining_fridays)
        elapsed_fridays = self._count_fridays_in_range(self.month_start, self.today - timedelta(days=1))
        self._working_days_elapsed = max(0, self._days_elapsed - elapsed_fridays)
        self._month_fridays = self._count_fridays_in_range(self.month_start, self.month_end)
        self._working_days_in_month = max(0, self._days_in_month - self._month_fridays)

    def _count_fridays_in_range(self, start: date, end: date) -> int:
        count = 0
        d = start
        while d <= end:
            if d.weekday() == 4:
                count += 1
            d += timedelta(days=1)
        return count

    async def _get_house_target(self) -> Optional[HouseTarget]:
        res = await self.db.execute(
            select(HouseTarget).where(
                HouseTarget.house_id == self.house_id,
                HouseTarget.target_date >= self.month_start,
                HouseTarget.target_date <= self.month_end,
            )
        )
        return res.scalar_one_or_none()

    def _primary_target(self, target: Optional[HouseTarget]) -> float:
        if not target:
            return 0
        if self.report_type == "ev_secondary":
            return target.ev_c2c_target or 0
        return target.total_recharge_target or 0

    async def _get_recharge_sum(
        self,
        retailer_ids: Optional[set[int]] = None,
        retailer_codes: Optional[list[str]] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> float:
        q = select(func.coalesce(func.sum(ITopUpDetail.daily_value), 0)).where(
            ITopUpDetail.house_id == self.house_id,
            ITopUpDetail.report_type == "C2C",
            ITopUpDetail.report_date >= (start_date or self.month_start),
            ITopUpDetail.report_date <= (end_date or self.month_end),
        )
        if retailer_ids:
            q = q.where(ITopUpDetail.retailer_id.in_(retailer_ids))
        if retailer_codes:
            q = q.where(ITopUpDetail.retailer_code.in_(retailer_codes))
        res = await self.db.execute(q)
        return float(res.scalar() or 0)

    async def _get_recharge_sum_for_date(
        self,
        target_date: date,
        retailer_ids: Optional[set[int]] = None,
        retailer_codes: Optional[list[str]] = None,
    ) -> float:
        q = select(func.coalesce(func.sum(ITopUpDetail.daily_value), 0)).where(
            ITopUpDetail.house_id == self.house_id,
            ITopUpDetail.report_type == "C2C",
            ITopUpDetail.report_date == target_date,
        )
        if retailer_ids:
            q = q.where(ITopUpDetail.retailer_id.in_(retailer_ids))
        if retailer_codes:
            q = q.where(ITopUpDetail.retailer_code.in_(retailer_codes))
        res = await self.db.execute(q)
        return float(res.scalar() or 0)

    async def get_summary(self) -> dict:
        target = await self._get_house_target()
        monthly_target = self._primary_target(target)
        ev_c2c_target = target.ev_c2c_target or 0 if target else 0
        sc_primary_target = target.sc_primary_target or 0 if target else 0

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
        previous_month_target = self._primary_target(prev_target)

        achievement = await self._get_recharge_sum()
        yesterday_date = self.today - timedelta(days=1)
        yesterday_achievement = await self._get_recharge_sum_for_date(yesterday_date) if yesterday_date >= self.month_start else 0

        prev_achievement = await self._get_recharge_sum(start_date=prev_start, end_date=prev_end)

        achievement_pct = round((achievement / monthly_target * 100), 1) if monthly_target else 0
        remaining = max(0, monthly_target - achievement)
        excl_friday_days = max(self._working_days_remaining, 1)
        daily_required = round(remaining / excl_friday_days, 1) if self._days_remaining else 0
        daily_required_with_friday = round(remaining / max(self._days_remaining, 1), 1) if self._days_remaining else 0
        daily_avg = round(achievement / max(self._working_days_elapsed, 1), 1) if self._working_days_elapsed else 0
        projection = round((achievement / max(self._working_days_elapsed, 1)) * self._working_days_in_month, 1)
        expected_pct = round((projection / monthly_target * 100), 1) if monthly_target else 0

        return {
            "monthly_target": monthly_target,
            "ev_c2c_target": ev_c2c_target,
            "sc_primary_target": sc_primary_target,
            "achievement": achievement,
            "achievement_percentage": achievement_pct,
            "remaining": remaining,
            "daily_required": daily_required,
            "daily_required_with_friday": daily_required_with_friday,
            "remaining_fridays": self._remaining_fridays,
            "daily_average": daily_avg,
            "projection": projection,
            "expected_percentage": expected_pct,
            "days_elapsed": self._working_days_elapsed,
            "days_remaining": self._working_days_remaining,
            "total_days": self._working_days_in_month,
            "yesterday_achievement": yesterday_achievement,
            "previous_month_target": previous_month_target,
            "previous_month_achievement": prev_achievement,
        }

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
        itop_map = {e.id: e.itop_number for e in employees}

        target_rows = await self.db.execute(
            select(RSOTarget).where(
                RSOTarget.employee_id.in_(emp_ids),
                RSOTarget.target_date >= self.month_start,
                RSOTarget.target_date <= self.month_end,
            )
        )
        target_map = {}
        ev_target_map = {}
        sc_target_map = {}
        for t in target_rows.scalars().all():
            target_map[t.employee_id] = t.total_recharge or 0
            ev_target_map[t.employee_id] = t.ev_secondary or 0
            sc_target_map[t.employee_id] = t.sc_secondary or 0

        results = []
        yesterday_date = self.today - timedelta(days=1)
        for emp_id in emp_ids:
            target_val = target_map.get(emp_id, 0)
            ev_target_val = ev_target_map.get(emp_id, 0)
            sc_target_val = sc_target_map.get(emp_id, 0)
            if self.report_type == "ev_secondary":
                target_val = ev_target_val
                sc_target_val = 0
            retailer_ids = await self._get_retailer_ids_for_employee(emp_id)
            achievement = await self._get_recharge_sum(retailer_ids=retailer_ids) if retailer_ids else 0

            pct = round((achievement / target_val * 100), 1) if target_val else 0
            remaining = max(0, target_val - achievement)
            daily_avg = round(achievement / max(self._working_days_elapsed, 1), 1)
            projection = round((achievement / max(self._working_days_elapsed, 1)) * self._working_days_in_month, 1)

            if pct >= 100:
                status = "achieved"
            elif pct >= 70:
                status = "on_track"
            elif pct >= 40:
                status = "needs_attention"
            else:
                status = "behind"

            yesterday_val = await self._get_recharge_sum_for_date(yesterday_date, retailer_ids=retailer_ids) if retailer_ids and yesterday_date >= self.month_start else 0

            results.append({
                "id": emp_id,
                "name": name_map.get(emp_id, f"#{emp_id}"),
                "target": target_val,
                "ev_target": ev_target_val,
                "sc_target": sc_target_val,
                "achievement": achievement,
                "percentage": pct,
                "remaining": remaining,
                "daily_average": daily_avg,
                "projection": projection,
                "status": status,
                "employee_type": "rso",
                "itop_number": itop_map.get(emp_id),
                "yesterday_achievement": yesterday_val,
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
        ev_target_map = {}
        sc_target_map = {}
        for t in target_rows.scalars().all():
            target_map[t.employee_id] = t.total_recharge or 0
            ev_target_map[t.employee_id] = t.ev_secondary or 0
            sc_target_map[t.employee_id] = t.sc_secondary or 0

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
            ev_target_val = ev_target_map.get(emp_id, 0)
            sc_target_val = sc_target_map.get(emp_id, 0)
            if self.report_type == "ev_secondary":
                target_val = ev_target_val
                sc_target_val = 0

            rso_emps_for_sup = supervisor_user_to_rso_emps.get(emp.user_id) or []
            all_rso_retailer_ids: set[int] = set()
            for rso_emp in rso_emps_for_sup:
                rso_retailer_ids = await self._get_retailer_ids_for_employee(rso_emp.id)
                all_rso_retailer_ids.update(rso_retailer_ids)

            achievement = await self._get_recharge_sum(retailer_ids=all_rso_retailer_ids) if all_rso_retailer_ids else 0

            pct = round((achievement / target_val * 100), 1) if target_val else 0
            remaining = max(0, target_val - achievement)
            daily_avg = round(achievement / max(self._working_days_elapsed, 1), 1)
            projection = round((achievement / max(self._working_days_elapsed, 1)) * self._working_days_in_month, 1)

            if pct >= 100:
                status = "achieved"
            elif pct >= 70:
                status = "on_track"
            elif pct >= 40:
                status = "needs_attention"
            else:
                status = "behind"

            yesterday_val = await self._get_recharge_sum_for_date(yesterday_date, retailer_ids=all_rso_retailer_ids) if all_rso_retailer_ids and yesterday_date >= self.month_start else 0

            results.append({
                "id": emp_id,
                "name": name_map.get(emp_id, f"#{emp_id}"),
                "pool_number": pool_map.get(emp_id),
                "target": target_val,
                "ev_target": ev_target_val,
                "sc_target": sc_target_val,
                "achievement": achievement,
                "percentage": pct,
                "remaining": remaining,
                "daily_average": daily_avg,
                "projection": projection,
                "status": status,
                "employee_type": "supervisor",
                "yesterday_achievement": yesterday_val,
            })

        results.sort(key=lambda r: r["percentage"], reverse=True)
        return results

    async def get_daily_trend(self) -> list[dict]:
        trend_map: dict[str, float] = {}
        q = select(ITopUpDetail.report_date, func.coalesce(func.sum(ITopUpDetail.daily_value), 0)).where(
            ITopUpDetail.house_id == self.house_id,
            ITopUpDetail.report_type == "C2C",
            ITopUpDetail.report_date >= self.month_start,
            ITopUpDetail.report_date <= self.month_end,
        )
        q = q.group_by(ITopUpDetail.report_date).order_by(ITopUpDetail.report_date)
        for row in (await self.db.execute(q)).all():
            d = row.report_date
            trend_map[d.isoformat() if isinstance(d, date) else str(d)] = float(row[1])

        target = await self._get_house_target()
        monthly_target = self._primary_target(target)
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

    async def get_top_performers(self, rso_list: list[dict], supervisor_list: Optional[list[dict]] = None) -> dict:
        result = {
            "rso": rso_list[:5] if rso_list else [],
        }
        if supervisor_list:
            result["supervisor"] = supervisor_list[:5]
        return result
