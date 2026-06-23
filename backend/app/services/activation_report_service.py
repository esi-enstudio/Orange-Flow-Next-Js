import logging
from datetime import date, datetime, timedelta
from calendar import monthrange
from typing import Optional

from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.house_target import HouseTarget
from app.models.rso_target import RSOTarget
from app.models.bp_target import BpTarget
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
    def __init__(self, db: AsyncSession, house_id: int, month: int, year: int, exclude_tag_names: Optional[list[str]] = None, exclude_product_codes: Optional[set[str]] = None):
        self.db = db
        self.house_id = house_id
        self.month = month
        self.year = year
        self.exclude_tag_names = exclude_tag_names or []
        self.exclude_product_codes = exclude_product_codes or set()
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

    async def _count_activations(
        self,
        retailer_ids: Optional[set[int]] = None,
        retailer_codes: Optional[list[str]] = None,
        exclude_ids: Optional[set[int]] = None,
    ) -> int:
        total = 0
        excluded = exclude_ids or await self._get_excluded_retailer_ids()
        excluded_codes = self.exclude_product_codes

        q = select(func.count()).select_from(Activation).where(
            Activation.house_id == self.house_id,
            Activation.activation_date >= self.month_start,
            Activation.activation_date <= self.month_end,
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

    async def get_summary(self) -> dict:
        target = await self._get_house_target()
        monthly_target = target.total_ga_target or 0 if target else 0
        achievement = await self._count_activations()

        achievement_pct = round((achievement / monthly_target * 100), 1) if monthly_target else 0
        remaining = max(0, monthly_target - achievement)
        excl_friday_days = max(self._days_remaining - self._remaining_fridays, 1)
        daily_required = int(remaining / excl_friday_days) if self._days_remaining else 0
        daily_required_with_friday = int(remaining / max(self._days_remaining, 1)) if self._days_remaining else 0
        daily_avg = round(achievement / max(self._days_elapsed, 1), 1) if self._days_elapsed else 0
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
        }

    async def _get_employee_performance(
        self,
        employee_ids: list[int],
        target_map: dict,
        name_map: dict[int, str],
        type_label: str,
    ) -> list[dict]:
        results = []
        for emp_id in employee_ids:
            target_val = target_map.get(emp_id, 0)
            retailer_ids = await self._get_retailer_ids_for_employee(emp_id)
            achievement = await self._count_activations(retailer_ids=retailer_ids)

            pct = round((achievement / target_val * 100), 1) if target_val else 0
            remaining = max(0, target_val - achievement)
            daily_avg = round(achievement / max(self._days_elapsed, 1), 1)
            projection = round(daily_avg * self._days_in_month, 1)

            if pct >= 100:
                status = "achieved"
            elif pct >= 70:
                status = "on_track"
            elif pct >= 40:
                status = "needs_attention"
            else:
                status = "behind"

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

        return await self._get_employee_performance(emp_ids, target_map, name_map, "rso")

    async def get_bp_performance(self) -> list[dict]:
        emps = await self.db.execute(
            select(Employee).where(
                Employee.house_id == self.house_id,
                Employee.employee_type == "bp",
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
            achievement = await self._count_activations(retailer_codes=retailer_codes)

            pct = round((achievement / target_val * 100), 1) if target_val else 0
            remaining = max(0, target_val - achievement)
            daily_avg = round(achievement / max(self._days_elapsed, 1), 1)
            projection = round(daily_avg * self._days_in_month, 1)

            if pct >= 100:
                status = "achieved"
            elif pct >= 70:
                status = "on_track"
            elif pct >= 40:
                status = "needs_attention"
            else:
                status = "behind"

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
            daily_avg = round(achievement / max(self._days_elapsed, 1), 1)
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

    async def get_top_performers(self, rso_list: list[dict], bp_list: list[dict], cc_list: list[dict]) -> dict:
        return {
            "rso": rso_list[:5] if rso_list else [],
            "bp": bp_list[:5] if bp_list else [],
            "cc": cc_list[:5] if cc_list else [],
        }

    async def build_dashboard(self) -> dict:
        summary = await self.get_summary()
        rso = await self.get_rso_performance()
        bp = await self.get_bp_performance()
        cc = await self.get_cc_performance()
        daily_trend = await self.get_daily_trend()
        top_performers = await self.get_top_performers(rso, bp, cc)

        return {
            "success": True,
            "summary": summary,
            "rso_performance": rso,
            "bp_performance": bp,
            "cc_performance": cc,
            "daily_trend": daily_trend,
            "top_performers": top_performers,
        }
