"""Active SSO (Target vs Achievement) report service.

A retailer is considered an "Active SSO" when, within the selected period, it has
at least the configured number of SIM activations (per house + month; default 2).
Only ENABLED ('Yes') retailers with sim_seller = 'Yes' are counted.
"""
import logging
import math
from datetime import date, timedelta
from typing import Dict, List, Optional, Sequence, Tuple

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.active_sso_config import ActiveSsoConfig
from app.models.activation import Activation
from app.models.employee import Employee
from app.models.house import House
from app.models.retailer import Retailer
from app.models.rso_target import RSOTarget
from app.models.user import User
from app.utils.access_control import is_admin_user

from app.services.active_lso_report_service import (
    employee_options,
    employee_name_map,
    supervisor_map,
    subordinate_rso_ids,
    get_employee_profile,
    _house_options,
    _manager_options,
    _employee_ids_by_type,
    status_for_pct,
    _r1,
    ROLE_RSO,
    ROLE_SUPERVISOR,
    VALID_STATUSES,
)

logger = logging.getLogger("app.services.ActiveSsoReport")

DEFAULT_ACTIVE_SSO_ACTIVATIONS = 2


def build_sso_count_keys(activations_threshold: int) -> tuple:
    return tuple(f"day_{i}" for i in range(activations_threshold)) + \
        ("inactive_last_month", "reactivated")


async def get_active_sso_thresholds(db: AsyncSession, house_id: int, month_start: date) -> int:
    if not house_id or not month_start:
        return DEFAULT_ACTIVE_SSO_ACTIVATIONS
    month_start = month_start.replace(day=1)
    res = await db.execute(
        select(ActiveSsoConfig.activations_threshold).where(
            ActiveSsoConfig.house_id == house_id,
            ActiveSsoConfig.target_month == month_start,
        )
    )
    row = res.first()
    if not row:
        return DEFAULT_ACTIVE_SSO_ACTIVATIONS
    return max(1, min(100, int(row[0]) if row[0] is not None else DEFAULT_ACTIVE_SSO_ACTIVATIONS))


async def get_active_sso_filters(db: AsyncSession, current_user: User) -> dict:
    role_names = {r.name.strip().lower() for r in current_user.roles}
    is_rso_mode = ROLE_RSO in role_names
    is_sup_mode = ROLE_SUPERVISOR in role_names and not is_rso_mode
    emp = await get_employee_profile(db, current_user.id)
    mode = "rso" if is_rso_mode else ("supervisor" if is_sup_mode else "admin")

    if is_rso_mode or is_sup_mode:
        if not emp or not emp.house_id or emp.status != "Active":
            return None
        house_id = emp.house_id
        houses = await _house_options(db, [house_id])
        if is_rso_mode:
            if emp.employee_type != ROLE_RSO:
                return None
            sup_map = await supervisor_map(db, [emp.id], date.today())
            sup_id = sup_map.get(emp.id)
            rsos = await employee_options(db, [emp.id])
            sups = await employee_options(db, [sup_id]) if sup_id else []
            defaults = {"house_id": house_id, "manager_id": None,
                        "supervisor_id": sup_id, "rso_id": emp.id}
        else:
            if emp.employee_type != ROLE_SUPERVISOR:
                return None
            sub_ids = await subordinate_rso_ids(db, emp)
            rsos = await employee_options(db, sub_ids) if sub_ids else []
            sups = await employee_options(db, [emp.id])
            defaults = {"house_id": house_id, "manager_id": None,
                        "supervisor_id": emp.id, "rso_id": None}
        return {
            "success": True,
            "role_mode": mode,
            "houses": houses,
            "managers": [],
            "supervisors": sups,
            "rsos": rsos,
            "defaults": defaults,
            "statuses": list(VALID_STATUSES),
        }

    accessible = [h.id for h in current_user.houses]
    if not accessible:
        if is_admin_user(current_user):
            q = select(House.id)
            accessible = [r[0] for r in (await db.execute(q)).all()]
        if not accessible:
            return {
                "success": True,
                "role_mode": mode,
                "houses": [],
                "managers": [],
                "supervisors": [],
                "rsos": [],
                "defaults": {},
                "statuses": list(VALID_STATUSES),
            }
    houses = await _house_options(db, accessible)
    managers = await _manager_options(db, accessible)
    supervisors = await employee_options(db, await _employee_ids_by_type(db, accessible, "supervisor"))
    rsos = await employee_options(db, await _employee_ids_by_type(db, accessible, "rso"))
    return {
        "success": True,
        "role_mode": mode,
        "houses": houses,
        "managers": managers,
        "supervisors": supervisors,
        "rsos": rsos,
        "defaults": {"house_id": accessible[0], "manager_id": None,
                     "supervisor_id": None, "rso_id": None},
        "statuses": list(VALID_STATUSES),
    }


class ActiveSsoReportService:
    def __init__(
        self,
        db: AsyncSession,
        house_id: int,
        start_date: date,
        end_date: date,
        supervisor_id: Optional[int] = None,
        rso_id: Optional[int] = None,
        status_filter: Optional[str] = None,
    ):
        self.db = db
        self.house_id = house_id
        self.start_date = start_date
        self.end_date = end_date
        self.supervisor_id = supervisor_id
        self.rso_id = rso_id
        self.status_filter = status_filter

        self.today = date.today()
        self.total_days = (end_date - start_date).days + 1
        if end_date < self.today:
            self.days_elapsed = self.total_days
            self.days_remaining = 0
        elif start_date > self.today:
            self.days_elapsed = 0
            self.days_remaining = self.total_days
        else:
            self.days_elapsed = (self.today - start_date).days + 1
            self.days_remaining = (end_date - self.today).days

        prev_month_last = date(start_date.year, start_date.month, 1) - timedelta(days=1)
        self.prev_month_start = prev_month_last.replace(day=1)
        self.prev_month_end = prev_month_last

        self.activations_threshold = DEFAULT_ACTIVE_SSO_ACTIVATIONS
        self.prev_activations_threshold = DEFAULT_ACTIVE_SSO_ACTIVATIONS
        self.count_keys = build_sso_count_keys(DEFAULT_ACTIVE_SSO_ACTIVATIONS)

    async def _load_thresholds(self) -> None:
        target_month = date(self.start_date.year, self.start_date.month, 1)
        self.activations_threshold = await get_active_sso_thresholds(
            self.db, self.house_id, target_month
        )
        self.prev_activations_threshold = await get_active_sso_thresholds(
            self.db, self.house_id, self.prev_month_start
        )
        self.count_keys = build_sso_count_keys(self.activations_threshold)

    async def build_dashboard(self) -> dict:
        await self._load_thresholds()
        emps = await self._get_rso_employees()
        if not emps:
            return self._empty_result()

        emp_ids = [e.id for e in emps]
        target_date = date(self.start_date.year, self.start_date.month, 1)
        target_map = await self._get_target_map(emp_ids, target_date)
        sup_map = await supervisor_map(self.db, emp_ids, target_date)

        if self.supervisor_id:
            emp_ids = [eid for eid in emp_ids if sup_map.get(eid) == self.supervisor_id]
            if not emp_ids:
                return self._empty_result()
            emps = [e for e in emps if e.id in set(emp_ids)]

        name_map = await employee_name_map(self.db, emp_ids)
        sup_ids = list({sid for sid in sup_map.values() if sid})
        sup_names = await employee_name_map(self.db, sup_ids)

        retailer_map = await self._get_retailer_emp_map(emp_ids)
        all_retailer_ids = list(retailer_map.keys())
        cur_map = await self._get_activation_map(all_retailer_ids, self.start_date, self.end_date)
        prev_map = await self._get_activation_map(all_retailer_ids, self.prev_month_start, self.prev_month_end)

        rows = []
        for emp in emps:
            rid_list = [rid for rid, eid in retailer_map.items() if eid == emp.id]
            counts = self._compute_retailer_counts(rid_list, cur_map, prev_map)
            row = self._make_row(emp, name_map, sup_map, sup_names, target_map, counts)
            rows.append(row)

        if self.status_filter:
            rows = [r for r in rows if r["status"] == self.status_filter]

        rows.sort(key=lambda r: (r["supervisor_name"] or "zzz", r["name"] or ""))

        return {
            "success": True,
            "period": self._period_info(),
            "count_keys": list(self.count_keys),
            "rows": rows,
            "summary": self._aggregate(rows),
            "supervisor_summary": self._supervisor_summary(rows),
        }

    async def _get_rso_employees(self) -> List[Employee]:
        q = select(Employee).where(
            Employee.house_id == self.house_id,
            Employee.employee_type == ROLE_RSO,
            Employee.status == "Active",
        )
        if self.rso_id:
            q = q.where(Employee.id == self.rso_id)
        q = q.order_by(Employee.employee_id)
        res = await self.db.execute(q)
        return list(res.scalars().all())

    async def _get_target_map(self, emp_ids: Sequence[int], target_date: date) -> Dict[int, int]:
        target_map: Dict[int, int] = {}
        if not emp_ids:
            return target_map
        q = (
            select(RSOTarget.employee_id, RSOTarget.sso_target_modified, RSOTarget.sso)
            .where(RSOTarget.employee_id.in_(list(set(emp_ids))), RSOTarget.target_date == target_date)
        )
        for eid, modified, base in (await self.db.execute(q)).all():
            modified = int(modified or 0)
            base = int(base or 0)
            target_map[eid] = modified if modified > 0 else base
        return target_map

    async def _get_retailer_emp_map(self, emp_ids: Sequence[int]) -> Dict[int, int]:
        if not emp_ids:
            return {}
        emp_set = set(emp_ids)

        rso_rows = (
            await self.db.execute(
                select(Employee.id, Employee.itop_number).where(Employee.id.in_(emp_set))
            )
        ).all()
        sr_to_rso = {sr: eid for eid, sr in rso_rows if sr}

        sr_conditions = (
            or_(
                Retailer.employee_id.in_(emp_set),
                Retailer.itop_sr_number.in_(list(sr_to_rso)),
            )
            if sr_to_rso
            else Retailer.employee_id.in_(emp_set)
        )
        q = (
            select(Retailer.id, Retailer.employee_id, Employee.employee_type, Retailer.itop_sr_number)
            .join(Employee, Employee.id == Retailer.employee_id)
            .where(
                Retailer.house_id == self.house_id,
                Retailer.enabled.ilike("y%"),
                Retailer.sim_seller.ilike("y%"),
                sr_conditions,
            )
        )
        mapping: Dict[int, int] = {}
        for rid, eid, etype, sr in (await self.db.execute(q)).all():
            if eid in emp_set and etype == ROLE_RSO:
                mapping[rid] = eid
            elif etype != ROLE_RSO and sr and sr in sr_to_rso:
                mapping[rid] = sr_to_rso[sr]
        return mapping

    async def _get_activation_map(self, retailer_ids: Sequence[int], start: date, end: date) -> Dict[int, int]:
        if not retailer_ids:
            return {}
        q = (
            select(
                Activation.retailer_id,
                func.count(Activation.id).label("activation_count"),
            )
            .where(
                Activation.house_id == self.house_id,
                Activation.retailer_id.in_(list(set(retailer_ids))),
                Activation.activation_date >= start,
                Activation.activation_date <= end,
            )
            .group_by(Activation.retailer_id)
        )
        rows = (await self.db.execute(q)).all()
        return {r[0]: int(r[1] or 0) for r in rows}

    def _compute_retailer_counts(self, rid_list: Sequence[int], cur_map: Dict[int, int],
                                  prev_map: Dict[int, int]) -> dict:
        counts = {k: 0 for k in self.count_keys}
        counts["active"] = 0
        counts["retailer_count"] = len(rid_list)
        for rid in rid_list:
            cur_count = cur_map.get(rid, 0)
            prev_count = prev_map.get(rid, 0)

            is_active = cur_count >= self.activations_threshold
            if is_active:
                counts["active"] += 1
            else:
                bucket = min(cur_count, self.activations_threshold - 1)
                counts[f"day_{bucket}"] += 1

            prev_active = prev_count >= self.prev_activations_threshold
            if not prev_active:
                counts["inactive_last_month"] += 1
                if is_active:
                    counts["reactivated"] += 1
        return counts

    def _make_row(self, emp: Employee, name_map: Dict[int, str],
                  sup_map: Dict[int, int], sup_names: Dict[int, str],
                  target_map: Dict[int, int], counts: dict) -> dict:
        sup_id = sup_map.get(emp.id)
        target = target_map.get(emp.id, 0)
        achieved = counts.get("active", 0)
        ach_pct = _r1(achieved / target * 100) if target else 0.0
        remaining = max(0, target - achieved)
        daily_avg = _r1(achieved / self.days_elapsed) if self.days_elapsed else 0.0
        projection = _r1(daily_avg * self.total_days)
        drr = math.ceil(remaining / self.days_remaining) if self.days_remaining else 0

        return {
            "employee_id": emp.id,
            "employee_code": emp.employee_id or emp.dms_code,
            "name": name_map.get(emp.id, f"EMP-{emp.id}"),
            "dms_code": emp.dms_code,
            "itop_number": emp.itop_number,
            "supervisor_id": sup_id,
            "supervisor_name": sup_names.get(sup_id) if sup_id else None,
            "target": target,
            "achieved": achieved,
            "ach_pct": ach_pct,
            "remaining": remaining,
            "daily_avg": daily_avg,
            "projection": projection,
            "drr": drr,
            "status": status_for_pct(ach_pct),
            "retailer_count": counts["retailer_count"],
            "retailer_counts": {k: counts[k] for k in self.count_keys},
        }

    def _aggregate(self, rows: List[dict]) -> dict:
        ag = self._blank_aggregate()
        ag["rso_count"] = len(rows)
        for r in rows:
            ag["retailer_count"] += r["retailer_count"]
            ag["target"] += r["target"]
            ag["achieved"] += r["achieved"]
            ag["remaining"] += r["remaining"]
            rc = r["retailer_counts"]
            for k in ag["retailer_counts"]:
                ag["retailer_counts"][k] += rc[k]
        ag["ach_pct"] = _r1(ag["achieved"] / ag["target"] * 100) if ag["target"] else 0.0
        ag["status"] = status_for_pct(ag["ach_pct"])
        ag["daily_avg"] = _r1(ag["achieved"] / self.days_elapsed) if self.days_elapsed else 0.0
        ag["projection"] = _r1(ag["daily_avg"] * self.total_days)
        ag["drr"] = math.ceil(ag["remaining"] / self.days_remaining) if self.days_remaining else 0
        return ag

    def _supervisor_summary(self, rows: List[dict]) -> List[dict]:
        groups: Dict[int, List[dict]] = {}
        for r in rows:
            groups.setdefault(r["supervisor_id"], []).append(r)
        result = []
        for sid in sorted(groups, key=lambda s: (groups[s][0]["supervisor_name"] or "zzz")):
            ag = self._aggregate(groups[sid])
            ag["supervisor_id"] = sid
            ag["supervisor_name"] = groups[sid][0]["supervisor_name"] or f"Supervisor #{sid}"
            result.append(ag)
        return result

    def _blank_aggregate(self) -> dict:
        return {
            "rso_count": 0,
            "retailer_count": 0,
            "target": 0,
            "achieved": 0,
            "ach_pct": 0.0,
            "remaining": 0,
            "daily_avg": 0.0,
            "projection": 0.0,
            "drr": 0,
            "status": "behind",
            "retailer_counts": {k: 0 for k in self.count_keys},
        }

    def _period_info(self) -> dict:
        return {
            "start_date": self.start_date.isoformat(),
            "end_date": self.end_date.isoformat(),
            "total_days": self.total_days,
            "days_elapsed": self.days_elapsed,
            "days_remaining": self.days_remaining,
            "today": self.today.isoformat(),
            "target_month": self.start_date.strftime("%Y-%m"),
            "prev_month_start": self.prev_month_start.isoformat(),
            "prev_month_end": self.prev_month_end.isoformat(),
            "activations_threshold": self.activations_threshold,
        }

    async def get_inactive_retailers(self, employee_id: int) -> List[dict]:
        await self._load_thresholds()
        emp = (await self.db.execute(
            select(Employee).where(Employee.id == employee_id)
        )).scalars().first()
        if not emp:
            return []

        retailer_map = await self._get_retailer_emp_map([emp.id])
        rids = [rid for rid, eid in retailer_map.items() if eid == emp.id]
        if not rids:
            return []

        cur_map = await self._get_activation_map(rids, self.start_date, self.end_date)
        prev_map = await self._get_activation_map(rids, self.prev_month_start, self.prev_month_end)

        retailer_info = {}
        q = (
            select(
                Retailer.id, Retailer.retailer_code, Retailer.name,
                Retailer.itop_number,
                House.code.label("house_code"),
            )
            .join(House, House.id == Retailer.house_id)
            .where(Retailer.id.in_(rids))
        )
        for r in (await self.db.execute(q)).all():
            retailer_info[r[0]] = {
                "retailer_code": r[1], "name": r[2],
                "itop_number": r[3] or "", "house_code": r[4],
            }

        selling_days_left = self.days_remaining + 1
        min_activations_needed = max(0, self.activations_threshold - selling_days_left)

        result = []
        for rid in rids:
            cur_count = cur_map.get(rid, 0)
            prev_count = prev_map.get(rid, 0)
            is_active = cur_count >= self.activations_threshold
            if is_active:
                continue
            if cur_count < min_activations_needed:
                continue
            prev_active = prev_count >= self.prev_activations_threshold
            info = retailer_info.get(rid, {})
            result.append({
                "retailer_code": info.get("retailer_code", ""),
                "name": info.get("name", ""),
                "itop_number": info.get("itop_number", ""),
                "house_code": info.get("house_code", ""),
                "activations_done": cur_count,
                "required_activations": self.activations_threshold,
                "inactive_last_month": "" if prev_active else "Y",
            })

        result.sort(key=lambda x: x["activations_done"])
        return result

    async def get_all_inactive_retailers_grouped(self) -> List[dict]:
        await self._load_thresholds()
        emps = await self._get_rso_employees()
        if not emps:
            return []

        emp_ids = [e.id for e in emps]
        target_date = date(self.start_date.year, self.start_date.month, 1)
        target_map = await self._get_target_map(emp_ids, target_date)
        sup_map = await supervisor_map(self.db, emp_ids, target_date)

        if self.supervisor_id:
            emp_ids = [eid for eid in emp_ids if sup_map.get(eid) == self.supervisor_id]
            if not emp_ids:
                return []
            emps = [e for e in emps if e.id in set(emp_ids)]

        name_map = await employee_name_map(self.db, emp_ids)
        sup_ids = list({sid for sid in sup_map.values() if sid})
        sup_names = await employee_name_map(self.db, sup_ids)

        retailer_map = await self._get_retailer_emp_map(emp_ids)
        all_retailer_ids = list(retailer_map.keys())
        cur_map = await self._get_activation_map(all_retailer_ids, self.start_date, self.end_date)
        prev_map = await self._get_activation_map(all_retailer_ids, self.prev_month_start, self.prev_month_end)

        all_rids = list(retailer_map.keys())
        retailer_info = {}
        if all_rids:
            q = (
                select(
                    Retailer.id, Retailer.retailer_code, Retailer.name,
                    Retailer.itop_number,
                    House.code.label("house_code"),
                )
                .join(House, House.id == Retailer.house_id)
                .where(Retailer.id.in_(all_rids))
            )
            for r in (await self.db.execute(q)).all():
                retailer_info[r[0]] = {
                    "retailer_code": r[1], "name": r[2],
                    "itop_number": r[3] or "", "house_code": r[4],
                }

        selling_days_left = self.days_remaining + 1
        min_activations_needed = max(0, self.activations_threshold - selling_days_left)

        groups = []
        for emp in emps:
            rso_name = name_map.get(emp.id, f"EMP-{emp.id}")
            sup_id = sup_map.get(emp.id)
            sup_name = sup_names.get(sup_id) if sup_id else ""

            rids = [rid for rid, eid in retailer_map.items() if eid == emp.id]
            rows = []
            for rid in rids:
                cur_count = cur_map.get(rid, 0)
                prev_count = prev_map.get(rid, 0)
                is_active = cur_count >= self.activations_threshold
                if is_active:
                    continue
                if cur_count < min_activations_needed:
                    continue
                prev_active = prev_count >= self.prev_activations_threshold
                info = retailer_info.get(rid, {})
                rows.append({
                    "retailer_code": info.get("retailer_code", ""),
                    "name": info.get("name", ""),
                    "itop_number": info.get("itop_number", ""),
                    "house_code": info.get("house_code", ""),
                    "activations_done": cur_count,
                    "required_activations": self.activations_threshold,
                    "inactive_last_month": "" if prev_active else "Y",
                })
            rows.sort(key=lambda x: x["activations_done"])
            if rows:
                groups.append({
                    "rso_name": rso_name,
                    "dms_code": emp.dms_code or "",
                    "itop_number": emp.itop_number or "",
                    "supervisor_name": sup_name,
                    "retailers": rows,
                })
        return groups

    def _empty_result(self) -> dict:
        return {
            "success": True,
            "period": self._period_info(),
            "count_keys": list(self.count_keys),
            "rows": [],
            "summary": self._blank_aggregate(),
            "supervisor_summary": [],
        }
