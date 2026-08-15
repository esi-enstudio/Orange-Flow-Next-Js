"""Active LSO (Target vs Achievement) report service.

A retailer is considered an "Active LSO" when, within the selected period, it has
at least ACTIVE_LSO_DAYS distinct C2S report dates AND a cumulative C2S amount of
at least ACTIVE_LSO_AMOUNT. Achieved = count of such active retailers per RSO.

Retailer attribution is based solely on `retailers.employee_id` (the RSO the
retailer is linked to). BP/CC assisted codes are never auto-assigned to RSOs here.
"""
import logging
import math
from datetime import date, timedelta
from typing import Dict, List, Optional, Sequence, Tuple

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee import Employee
from app.models.house import House
from app.models.itopup_detail import ITopUpDetail
from app.models.retailer import Retailer
from app.models.rso_target import RSOTarget
from app.models.user import User
from app.utils.access_control import is_admin_user

logger = logging.getLogger("app.services.ActiveLsoReport")

ACTIVE_LSO_DAYS = 7
ACTIVE_LSO_AMOUNT = 500.0
REPORT_TYPE_C2S = "C2S"

VALID_STATUSES = ("achieved", "on_track", "needs_attention", "behind")

ROLE_RSO = "rso"
ROLE_SUPERVISOR = "supervisor"

COUNT_KEYS = ("day_0", "day_1", "day_2", "day_3", "day_4", "day_5", "day_6",
              "days_no_sales", "inactive_last_month", "reactivated")


def status_for_pct(pct: float) -> str:
    if pct >= 100:
        return "achieved"
    if pct >= 70:
        return "on_track"
    if pct >= 40:
        return "needs_attention"
    return "behind"


def _r1(value) -> float:
    return round(float(value or 0), 1)


async def employee_options(db: AsyncSession, emp_ids: Sequence[int]) -> List[dict]:
    if not emp_ids:
        return []
    q = (
        select(Employee.id, User.name, Employee.dms_code, Employee.employee_id)
        .outerjoin(User, User.id == Employee.user_id)
        .where(Employee.id.in_(list(set(emp_ids))))
        .order_by(Employee.employee_id)
    )
    rows = (await db.execute(q)).all()
    return [
        {"id": r[0], "name": r[1] or r[2] or r[3] or f"EMP-{r[0]}", "code": r[3] or r[2]}
        for r in rows
    ]


async def employee_name_map(db: AsyncSession, emp_ids: Sequence[int]) -> Dict[int, str]:
    opts = await employee_options(db, emp_ids)
    return {o["id"]: o["name"] for o in opts}


async def supervisor_map(db: AsyncSession, emp_ids: Sequence[int], target_date: date) -> Dict[int, int]:
    """Map rso employee_id -> supervisor employee_id.

    Priority: rso_targets.supervisor_id for the target month, then fallback to the
    user parent chain (rso.user.parent -> supervisor employee).
    """
    sup_map: Dict[int, int] = {}
    if not emp_ids:
        return sup_map

    q = (
        select(RSOTarget.employee_id, RSOTarget.supervisor_id)
        .where(
            RSOTarget.employee_id.in_(list(set(emp_ids))),
            RSOTarget.target_date == target_date,
            RSOTarget.supervisor_id.is_not(None),
        )
    )
    for eid, sid in (await db.execute(q)).all():
        sup_map[eid] = sid

    missing = [eid for eid in emp_ids if eid not in sup_map]
    if missing:
        q = select(Employee.id, Employee.user_id).where(Employee.id.in_(missing))
        emp_user = {eid: uid for eid, uid in (await db.execute(q)).all() if uid}
        user_ids = list(emp_user.values())
        if user_ids:
            q = select(User.id, User.parent_id).where(
                User.id.in_(user_ids), User.parent_id.is_not(None)
            )
            parent_by_user = {uid: pid for uid, pid in (await db.execute(q)).all()}
            parent_ids = list(parent_by_user.values())
            if parent_ids:
                q = select(Employee.id, Employee.user_id).where(
                    Employee.user_id.in_(parent_ids),
                    Employee.employee_type == ROLE_SUPERVISOR,
                    Employee.status == "Active",
                )
                sup_emp_by_user = {uid: eid for eid, uid in (await db.execute(q)).all()}
                for eid, uid in emp_user.items():
                    pid = parent_by_user.get(uid)
                    if pid and pid in sup_emp_by_user:
                        sup_map[eid] = sup_emp_by_user[pid]
    return sup_map


async def subordinate_rso_ids(db: AsyncSession, supervisor_emp: Optional[Employee]) -> set:
    """All RSO employee ids under a supervisor.

    Combines two sources so incomplete user-parent chains do not hide RSOs:
    1. users.parent_id chain (rso user -> supervisor user)
    2. rso_targets.supervisor_id for the latest target month (authoritative)
    """
    if not supervisor_emp:
        return set()
    ids: set = set()
    if supervisor_emp.user_id:
        q = select(User.id).where(User.parent_id == supervisor_emp.user_id)
        user_ids = [r[0] for r in (await db.execute(q)).all()]
        if user_ids:
            q = select(Employee.id).where(
                Employee.user_id.in_(user_ids),
                Employee.employee_type == ROLE_RSO,
                Employee.status == "Active",
            )
            ids |= {r[0] for r in (await db.execute(q)).all()}
    latest = (
        select(func.max(RSOTarget.target_date))
        .where(RSOTarget.supervisor_id == supervisor_emp.id)
        .scalar_subquery()
    )
    q = select(RSOTarget.employee_id).where(
        RSOTarget.supervisor_id == supervisor_emp.id,
        RSOTarget.target_date == latest,
    )
    ids |= {r[0] for r in (await db.execute(q)).all()}
    return ids


async def get_employee_profile(db: AsyncSession, user_id: int) -> Optional[Employee]:
    q = (
        select(Employee)
        .where(Employee.user_id == user_id)
        .order_by(Employee.id)
        .limit(1)
    )
    res = await db.execute(q)
    return res.scalars().first()


async def get_active_lso_filters(db: AsyncSession, current_user: User) -> dict:
    """Role-aware filter options for the Active LSO report."""
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


async def _house_options(db: AsyncSession, house_ids: Sequence[int]) -> List[dict]:
    if not house_ids:
        return []
    q = (
        select(House.id, House.name, House.code)
        .where(House.id.in_(list(set(house_ids))))
        .order_by(House.name)
    )
    rows = (await db.execute(q)).all()
    return [{"id": r[0], "name": r[1], "code": r[2]} for r in rows]


async def _manager_options(db: AsyncSession, house_ids: Sequence[int]) -> List[dict]:
    if not house_ids:
        return []
    q = (
        select(Employee.id, User.name, Employee.dms_code, Employee.employee_id, Employee.house_id)
        .outerjoin(User, User.id == Employee.user_id)
        .where(
            Employee.house_id.in_(list(house_ids)),
            Employee.employee_type == "manager",
            Employee.status == "Active",
        )
        .order_by(Employee.employee_id)
    )
    rows = (await db.execute(q)).all()
    return [
        {"id": r[0], "name": r[1] or r[2] or r[3] or f"EMP-{r[0]}", "code": r[3] or r[2], "house_id": r[4]}
        for r in rows
    ]


async def _employee_ids_by_type(db: AsyncSession, house_ids: Sequence[int], etype: str) -> List[int]:
    if not house_ids:
        return []
    q = select(Employee.id).where(
        Employee.house_id.in_(list(house_ids)),
        Employee.employee_type == etype,
        Employee.status == "Active",
    )
    return [r[0] for r in (await db.execute(q)).all()]


class ActiveLsoReportService:
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

    # ------------------------------------------------------------------ #
    async def build_dashboard(self) -> dict:
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
        cur_map = await self._get_c2s_map(all_retailer_ids, self.start_date, self.end_date)
        prev_map = await self._get_c2s_map(all_retailer_ids, self.prev_month_start, self.prev_month_end)

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
            "rows": rows,
            "summary": self._aggregate(rows),
            "supervisor_summary": self._supervisor_summary(rows),
        }

    # ------------------------------------------------------------------ #
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
            select(RSOTarget.employee_id, RSOTarget.lso_target_modified, RSOTarget.lso)
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
        q = select(Retailer.id, Retailer.employee_id).where(
            Retailer.house_id == self.house_id,
            Retailer.employee_id.in_(list(set(emp_ids))),
        )
        return {rid: eid for rid, eid in (await self.db.execute(q)).all()}

    async def _get_c2s_map(self, retailer_ids: Sequence[int], start: date, end: date) -> Dict[int, Tuple[int, float]]:
        if not retailer_ids:
            return {}
        q = (
            select(
                ITopUpDetail.retailer_id,
                func.count(func.distinct(ITopUpDetail.report_date)).label("days"),
                func.coalesce(func.sum(ITopUpDetail.daily_value), 0.0).label("amount"),
            )
            .where(
                ITopUpDetail.house_id == self.house_id,
                ITopUpDetail.report_type == REPORT_TYPE_C2S,
                ITopUpDetail.retailer_id.in_(list(set(retailer_ids))),
                ITopUpDetail.report_date >= start,
                ITopUpDetail.report_date <= end,
            )
            .group_by(ITopUpDetail.retailer_id)
        )
        rows = (await self.db.execute(q)).all()
        return {r[0]: (int(r[1] or 0), float(r[2] or 0.0)) for r in rows}

    # ------------------------------------------------------------------ #
    @staticmethod
    def _compute_retailer_counts(rid_list: Sequence[int], cur_map: Dict[int, Tuple[int, float]],
                                  prev_map: Dict[int, Tuple[int, float]]) -> dict:
        counts = {k: 0 for k in COUNT_KEYS}
        counts["active"] = 0
        counts["retailer_count"] = len(rid_list)
        for rid in rid_list:
            cd, ca = cur_map.get(rid, (0, 0.0))
            pd, pa = prev_map.get(rid, (0, 0.0))

            if cd == 0:
                counts["day_0"] += 1
            elif cd == 1:
                counts["day_1"] += 1
            elif cd == 2:
                counts["day_2"] += 1
            elif cd == 3:
                counts["day_3"] += 1
            elif cd == 4:
                counts["day_4"] += 1
            elif cd == 5:
                counts["day_5"] += 1
            elif cd == 6:
                counts["day_6"] += 1
            elif ca < ACTIVE_LSO_AMOUNT:
                counts["days_no_sales"] += 1
            else:
                counts["active"] += 1

            prev_active = pd >= ACTIVE_LSO_DAYS and pa >= ACTIVE_LSO_AMOUNT
            if not prev_active:
                counts["inactive_last_month"] += 1
                if cd >= ACTIVE_LSO_DAYS and ca >= ACTIVE_LSO_AMOUNT:
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
            "retailer_counts": {k: counts[k] for k in COUNT_KEYS if k != "retailer_count"},
        }

    # ------------------------------------------------------------------ #
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

    @staticmethod
    def _blank_aggregate() -> dict:
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
            "retailer_counts": {k: 0 for k in COUNT_KEYS},
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
            "active_threshold_days": ACTIVE_LSO_DAYS,
            "active_threshold_amount": ACTIVE_LSO_AMOUNT,
        }

    def _empty_result(self) -> dict:
        return {
            "success": True,
            "period": self._period_info(),
            "rows": [],
            "summary": self._blank_aggregate(),
            "supervisor_summary": [],
        }
