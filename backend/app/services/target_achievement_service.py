import logging
from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.house_target import HouseTarget
from app.models.supervisor_target import SupervisorTarget
from app.models.rso_target import RSOTarget
from app.models.live_activation import LiveActivation
from app.models.activation import Activation
from app.models.itopup_detail import ITopUpDetail
from app.models.scratch_card_issue import ScratchCardIssue
from app.models.retailer import Retailer
from app.models.employee import Employee
from app.models.user import User
from app.models.role import Role
from app.services.retailer_marking_service import get_active_retailer_ids_for_marking
from app.utils.activation_rules import get_excluded_codes

logger = logging.getLogger("app.services.TargetAchievement")

TARGET_CATEGORIES = [
    {"key": "ga", "label_en": "GA", "label_bn": "GA", "target_field": "ga"},
    {"key": "ev_recharge", "label_en": "EV Recharge", "label_bn": "ইভি রিচার্জ", "target_field": "ev_recharge"},
    {"key": "scratch_card", "label_en": "Scratch Card", "label_bn": "স্ক্র্যাচ কার্ড", "target_field": "sc"},
    {"key": "total_recharge", "label_en": "Total Recharge", "label_bn": "মোট রিচার্জ", "target_field": "recharge"},
    {"key": "sso", "label_en": "SSO", "label_bn": "এসএসও", "target_field": "sso"},
    {"key": "lso", "label_en": "LSO", "label_bn": "এলএসও", "target_field": "lso"},
    {"key": "bso", "label_en": "BSO", "label_bn": "বিএসও", "target_field": "bso"},
    {"key": "ddso", "label_en": "DDSO", "label_bn": "ডিডিএসও", "target_field": "ddso"},
    {"key": "dsso", "label_en": "DSSO", "label_bn": "ডিএসএসও", "target_field": "dsso"},
    {"key": "dso", "label_en": "DSO", "label_bn": "ডিএসও", "target_field": "dso"},
    {"key": "dlso", "label_en": "DLSO", "label_bn": "ডিএলএসও", "target_field": "dlso"},
]


class TargetAchievementService:

    def __init__(self, db: AsyncSession, house_id: int, target_date: date):
        self.db = db
        self.house_id = house_id
        self.target_date = target_date
        self.month_start = target_date
        days_in_month = (
            (date(target_date.year, target_date.month % 12 + 1, 1) - timedelta(days=1)).day
            if target_date.month < 12
            else (date(target_date.year + 1, 1, 1) - timedelta(days=1)).day
        )
        self.month_end = date(target_date.year, target_date.month, days_in_month)
        self.today = date.today()

    async def _get_activation_count(
        self,
        retailer_ids: Optional[set[int]] = None,
        house_id_filter: Optional[int] = None,
        retailer_codes: Optional[list[str]] = None,
    ) -> int:
        excluded_codes = await get_excluded_codes(self.db)

        excluded_retailer_ids: set[int] = set()
        if house_id_filter:
            excluded_retailer_ids = await get_active_retailer_ids_for_marking(
                self.db, house_id_filter, "DRC"
            )

        q = select(func.count()).select_from(Activation).where(
            Activation.activation_date >= self.month_start,
            Activation.activation_date <= self.month_end,
        )
        if house_id_filter:
            q = q.where(Activation.house_id == house_id_filter)
        if retailer_ids:
            q = q.where(Activation.retailer_id.in_(retailer_ids))
        if retailer_codes:
            q = q.where(Activation.retailer_code.in_(retailer_codes))
        if excluded_retailer_ids:
            q = q.where(
                and_(
                    Activation.retailer_id != None,
                    Activation.retailer_id.notin_(excluded_retailer_ids),
                )
            )
        if excluded_codes:
            q = q.where(Activation.product_code.notin_(excluded_codes))

        res = await self.db.execute(q)
        return res.scalar() or 0

    async def _get_itopup_total(
        self,
        retailer_ids: Optional[set[int]] = None,
        report_type: Optional[str] = None,
        retailer_codes: Optional[list[str]] = None,
    ) -> float:
        q = select(func.coalesce(func.sum(ITopUpDetail.daily_value), 0)).where(
            ITopUpDetail.house_id == self.house_id,
            ITopUpDetail.report_date >= self.month_start,
            ITopUpDetail.report_date <= self.month_end,
        )
        if report_type:
            q = q.where(ITopUpDetail.report_type == report_type)
        if retailer_ids:
            q = q.where(ITopUpDetail.retailer_id.in_(retailer_ids))
        res = await self.db.execute(q)
        return float(res.scalar() or 0)

    async def _get_scratch_card_total(
        self,
        retailer_codes: Optional[list[str]] = None,
    ) -> int:
        q = select(func.coalesce(func.sum(ScratchCardIssue.quantity), 0)).where(
            ScratchCardIssue.house_id == self.house_id,
            ScratchCardIssue.issue_date >= self.month_start,
            ScratchCardIssue.issue_date <= self.month_end,
        )
        if retailer_codes:
            q = q.where(ScratchCardIssue.retailer_code.in_(retailer_codes))
        res = await self.db.execute(q)
        return int(res.scalar() or 0)

    async def _get_retailer_ids_for_employee(self, employee_id: int) -> set[int]:
        res = await self.db.execute(
            select(Retailer.id).where(
                Retailer.employee_id == employee_id,
                Retailer.house_id == self.house_id,
            )
        )
        return {r[0] for r in res.all()}

    async def _get_rso_user_ids_for_supervisor(self, supervisor_user_id: int) -> list[int]:
        rso_users = (
            await self.db.execute(
                select(User).options(selectinload(User.roles)).where(User.parent_id == supervisor_user_id)
            )
        ).unique().scalars().all()
        return [ru.id for ru in rso_users if "rso" in [r.name.lower() for r in ru.roles]]

    async def _get_employee_ids_for_user_ids(self, user_ids: list[int]) -> set[int]:
        if not user_ids:
            return set()
        res = await self.db.execute(
            select(Employee.id).where(
                Employee.user_id.in_(user_ids),
                Employee.house_id == self.house_id,
            )
        )
        return {e[0] for e in res.all()}

    async def _get_retailer_ids_for_employees(self, employee_ids: set[int]) -> set[int]:
        if not employee_ids:
            return set()
        res = await self.db.execute(
            select(Retailer.id).where(
                Retailer.employee_id.in_(employee_ids),
                Retailer.house_id == self.house_id,
            )
        )
        return {r[0] for r in res.all()}

    def _build_categories(self, target_map: dict, actual_map: dict) -> list[dict]:
        categories = []
        for cat in TARGET_CATEGORIES:
            key = cat["key"]
            target_val = target_map.get(key, 0)
            actual_val = actual_map.get(key, 0)

            if isinstance(target_val, float) or isinstance(actual_val, float):
                target_f = float(target_val or 0)
                actual_f = float(actual_val or 0)
                remaining = round(target_f - actual_f, 2)
                pct = round((actual_f / target_f * 100), 1) if target_f else 0
                projected = round((actual_f / max(self._days_elapsed(), 1)) * self._days_in_month(), 1)
            else:
                target_f = int(target_val or 0)
                actual_f = int(actual_val or 0)
                remaining = target_f - actual_f
                pct = round((actual_f / target_f * 100), 1) if target_f else 0
                projected = round((actual_f / max(self._days_elapsed(), 1)) * self._days_in_month(), 1)

            if pct >= 100:
                status = "achieved"
            elif pct >= 70:
                status = "on_track"
            elif pct >= 40:
                status = "needs_attention"
            else:
                status = "behind"

            categories.append({
                "key": key,
                "label_en": cat["label_en"],
                "label_bn": cat["label_bn"],
                "target": target_f,
                "achieved": actual_f,
                "percentage": pct,
                "remaining": max(remaining, 0),
                "projected": projected,
                "status": status,
            })
        return categories

    def _days_elapsed(self) -> int:
        end = min(self.today, self.month_end)
        return (end - self.month_start).days + 1

    def _days_in_month(self) -> int:
        return (self.month_end - self.month_start).days + 1

    async def _build_daily_trend(
        self,
        retailer_ids: Optional[set[int]] = None,
        house_id_filter: Optional[int] = None,
    ) -> list[dict]:
        trend_map: dict[str, int] = {}

        end_hist = min(self.today - timedelta(days=1), self.month_end)
        if self.month_start <= end_hist:
            q = select(Activation.activation_date, func.count()).where(
                Activation.activation_date >= self.month_start,
                Activation.activation_date <= end_hist,
            ).group_by(Activation.activation_date).order_by(Activation.activation_date)
            if house_id_filter:
                q = q.where(Activation.house_id == house_id_filter)
            if retailer_ids:
                q = q.where(Activation.retailer_id.in_(retailer_ids))
            for row in (await self.db.execute(q)).all():
                d = row.activation_date
                trend_map[d.isoformat() if isinstance(d, date) else str(d)] = row[1]

        if self.month_start <= self.today <= self.month_end:
            q = select(LiveActivation.activation_date, func.count()).where(
                LiveActivation.activation_date == self.today,
            ).group_by(LiveActivation.activation_date)
            if house_id_filter:
                q = q.where(LiveActivation.house_id == house_id_filter)
            if retailer_ids:
                q = q.where(LiveActivation.retailer_id.in_(retailer_ids))
            for row in (await self.db.execute(q)).all():
                d = row.activation_date
                trend_map[d.isoformat() if isinstance(d, date) else str(d)] = row[1]

        result = []
        d = self.month_start
        daily_target = 0
        dim = self._days_in_month()
        while d <= self.month_end:
            ds = d.isoformat()
            result.append({"date": ds, "actual": trend_map.get(ds, 0)})
            d += timedelta(days=1)
        target_val = 0
        return result

    async def get_house_progress(self) -> dict:
        res = await self.db.execute(
            select(HouseTarget).where(
                HouseTarget.house_id == self.house_id,
                HouseTarget.target_date == self.target_date,
            )
        )
        target = res.scalar_one_or_none()
        if not target:
            return {"error": "No target found for this house and month"}

        target_map = {
            "ga": target.total_ga_target or 0,
            "ev_recharge": target.ev_c2c_target or 0,
            "sc": target.sc_primary_target or 0,
            "recharge": target.total_recharge_target or 0,
            "sso": target.sso or 0,
            "lso": target.lso or 0,
            "bso": target.bso or 0,
            "ddso": target.ddso or 0,
            "dsso": target.dsso or 0,
            "dso": target.dso or 0,
            "dlso": target.dlso or 0,
            "bp_ga": target.bp_ga or 0,
            "rso_ga": target.rso_ga or 0,
        }

        ga_actual = await self._get_activation_count(house_id_filter=self.house_id)
        ev_actual = await self._get_itopup_total(report_type="C2C")
        sc_actual = await self._get_scratch_card_total()
        recharge_actual = await self._get_itopup_total()

        actual_map = {
            "ga": ga_actual,
            "ev_recharge": ev_actual,
            "sc": sc_actual,
            "recharge": recharge_actual,
            "sso": 0,
            "lso": 0,
            "bso": 0,
            "ddso": 0,
            "dsso": 0,
            "dso": 0,
            "dlso": 0,
        }

        categories = self._build_categories(target_map, actual_map)
        total_target = sum(
            v for k, v in target_map.items() if k in ["ga", "ev_recharge", "sc", "recharge"]
        )
        total_actual = sum(
            v for k, v in actual_map.items() if k in ["ga", "ev_recharge", "sc", "recharge"]
        )
        overall_pct = round((total_actual / total_target * 100), 1) if total_target else 0
        projected_pct = round(
            (total_actual / max(self._days_elapsed(), 1)) * self._days_in_month() / max(total_target, 1) * 100, 1
        ) if total_target else 0

        trend = await self._build_daily_trend(house_id_filter=self.house_id)

        return {
            "level": "house",
            "house_id": self.house_id,
            "target_date": self.target_date.isoformat(),
            "days_elapsed": self._days_elapsed(),
            "days_remaining": max(0, self._days_in_month() - self._days_elapsed()),
            "categories": categories,
            "daily_trend": trend,
            "summary": {
                "total_target": total_target,
                "total_achieved": total_actual,
                "overall_percentage": overall_pct,
                "projected_percentage": projected_pct,
            },
        }

    async def get_supervisor_progress(self, supervisor_employee_id: int) -> dict:
        res = await self.db.execute(
            select(SupervisorTarget).where(
                SupervisorTarget.employee_id == supervisor_employee_id,
                SupervisorTarget.target_date == self.target_date,
            )
        )
        target = res.scalar_one_or_none()
        if not target:
            return {"error": "No target found for this supervisor and month"}

        emp = await self.db.execute(
            select(Employee).where(Employee.id == supervisor_employee_id)
        )
        emp_row = emp.scalar_one_or_none()
        sup_user_id = emp_row.user_id if emp_row else None

        rso_user_ids = await self._get_rso_user_ids_for_supervisor(sup_user_id) if sup_user_id else []
        rso_emp_ids = await self._get_employee_ids_for_user_ids(rso_user_ids)
        retailer_ids = await self._get_retailer_ids_for_employees(rso_emp_ids)

        target_map = {
            "ga": target.total_ga or 0,
            "ev_recharge": target.ev_secondary or 0,
            "sc": target.sc_secondary or 0,
            "recharge": target.total_recharge or 0,
            "sso": target.sso or 0,
            "lso": target.lso or 0,
            "bso": target.bso or 0,
            "ddso": target.ddso or 0,
            "dsso": target.dsso or 0,
            "dso": target.dso or 0,
            "dlso": target.dlso or 0,
            "bp_ga": target.bp_ga or 0,
            "rso_ga": target.rso_ga or 0,
        }

        ga_actual = await self._get_activation_count(retailer_ids=retailer_ids)
        ev_actual = await self._get_itopup_total(retailer_ids=retailer_ids, report_type="C2C")
        sc_actual = await self._get_scratch_card_total()
        recharge_actual = await self._get_itopup_total(retailer_ids=retailer_ids)

        actual_map = {
            "ga": ga_actual,
            "ev_recharge": ev_actual,
            "sc": sc_actual,
            "recharge": recharge_actual,
            "sso": 0,
            "lso": 0,
            "bso": 0,
            "ddso": 0,
            "dsso": 0,
            "dso": 0,
            "dlso": 0,
        }

        categories = self._build_categories(target_map, actual_map)
        total_target = sum(
            v for k, v in target_map.items() if k in ["ga", "ev_recharge", "sc", "recharge"]
        )
        total_actual = sum(
            v for k, v in actual_map.items() if k in ["ga", "ev_recharge", "sc", "recharge"]
        )
        overall_pct = round((total_actual / total_target * 100), 1) if total_target else 0
        projected_pct = round(
            (total_actual / max(self._days_elapsed(), 1)) * self._days_in_month() / max(total_target, 1) * 100, 1
        ) if total_target else 0

        trend = await self._build_daily_trend(retailer_ids=retailer_ids)

        rso_progress_list = []
        for rso_uid in rso_user_ids:
            rso_emp_ids_sub = await self._get_employee_ids_for_user_ids([rso_uid])
            if not rso_emp_ids_sub:
                continue
            rso_emp_id = list(rso_emp_ids_sub)[0]
            rso_prog = await self.get_rso_progress(rso_emp_id)
            if "error" not in rso_prog:
                rso_progress_list.append(rso_prog)

        return {
            "level": "supervisor",
            "supervisor_employee_id": supervisor_employee_id,
            "target_date": self.target_date.isoformat(),
            "days_elapsed": self._days_elapsed(),
            "days_remaining": max(0, self._days_in_month() - self._days_elapsed()),
            "categories": categories,
            "daily_trend": trend,
            "rso_breakdown": rso_progress_list,
            "summary": {
                "total_target": total_target,
                "total_achieved": total_actual,
                "overall_percentage": overall_pct,
                "projected_percentage": projected_pct,
                "active_rso_count": len(rso_progress_list),
            },
        }

    async def get_rso_progress(self, rso_employee_id: int) -> dict:
        res = await self.db.execute(
            select(RSOTarget).where(
                RSOTarget.employee_id == rso_employee_id,
                RSOTarget.target_date == self.target_date,
            )
        )
        target = res.scalar_one_or_none()
        if not target:
            return {"error": "No target found for this RSO and month"}

        retailer_ids = await self._get_retailer_ids_for_employee(rso_employee_id)

        target_map = {
            "ga": target.ga or 0,
            "ev_recharge": target.ev_secondary or 0,
            "sc": target.sc_secondary or 0,
            "recharge": target.total_recharge or 0,
            "sso": target.sso or 0,
            "lso": target.lso or 0,
            "bso": target.bso or 0,
            "ddso": target.ddso or 0,
            "dsso": target.dsso or 0,
            "dso": target.dso or 0,
            "dlso": target.dlso or 0,
        }

        ga_actual = await self._get_activation_count(retailer_ids=retailer_ids)
        ev_actual = await self._get_itopup_total(retailer_ids=retailer_ids, report_type="C2C")
        sc_actual = await self._get_scratch_card_total()
        recharge_actual = await self._get_itopup_total(retailer_ids=retailer_ids)

        actual_map = {
            "ga": ga_actual,
            "ev_recharge": ev_actual,
            "sc": sc_actual,
            "recharge": recharge_actual,
            "sso": 0,
            "lso": 0,
            "bso": 0,
            "ddso": 0,
            "dsso": 0,
            "dso": 0,
            "dlso": 0,
        }

        categories = self._build_categories(target_map, actual_map)
        total_target = sum(
            v for k, v in target_map.items() if k in ["ga", "ev_recharge", "sc", "recharge"]
        )
        total_actual = sum(
            v for k, v in actual_map.items() if k in ["ga", "ev_recharge", "sc", "recharge"]
        )
        overall_pct = round((total_actual / total_target * 100), 1) if total_target else 0
        projected_pct = round(
            (total_actual / max(self._days_elapsed(), 1)) * self._days_in_month() / max(total_target, 1) * 100, 1
        ) if total_target else 0

        emp = await self.db.execute(
            select(Employee).where(Employee.id == rso_employee_id)
        )
        emp_row = emp.scalar_one_or_none()
        rso_name = ""
        if emp_row and emp_row.user_id:
            user_res = await self.db.execute(select(User).where(User.id == emp_row.user_id))
            user_row = user_res.scalar_one_or_none()
            if user_row:
                rso_name = user_row.name or ""

        trend = await self._build_daily_trend(retailer_ids=retailer_ids)

        return {
            "level": "rso",
            "rso_employee_id": rso_employee_id,
            "rso_name": rso_name,
            "target_date": self.target_date.isoformat(),
            "days_elapsed": self._days_elapsed(),
            "days_remaining": max(0, self._days_in_month() - self._days_elapsed()),
            "categories": categories,
            "daily_trend": trend,
            "summary": {
                "total_target": total_target,
                "total_achieved": total_actual,
                "overall_percentage": overall_pct,
                "projected_percentage": projected_pct,
            },
        }
