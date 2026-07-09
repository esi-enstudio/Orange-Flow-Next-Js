import logging
from calendar import monthrange
from datetime import date, datetime, timedelta
from typing import Optional

from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.live_activation import LiveActivation
from app.models.activation import Activation
from app.models.retailer import Retailer
from app.models.employee import Employee
from app.models.user import User
from app.models.role import Role
from app.models.ga_filter import RetailerFilter, FilterTag
from app.models.bp_retailer_code import BpRetailerCode
from app.models.ga_section_config import GaSectionConfig
from app.models.rso_target import RSOTarget
from app.utils.activation_rules import get_excluded_codes, exclude_clause
from app.services.cache_service import cache_service

logger = logging.getLogger("app.services.GaLive")


class GaLiveQueryBuilder:

    def __init__(
        self,
        db: AsyncSession,
        house_id: int,
        start_date: date,
        end_date: date,
    ):
        self.db = db
        self.house_id = house_id
        self.start_date = start_date
        self.end_date = end_date
        self._excluded_codes: set[str] | None = None
        self._excluded_retailers: dict[str, set[int]] = {}
        self._section_configs: dict[str, dict] = {}

    async def _load_section_configs(self):
        result = await self.db.execute(
            select(GaSectionConfig).where(GaSectionConfig.house_id == self.house_id)
        )
        for cfg in result.scalars().all():
            self._section_configs[cfg.section_key] = {
                "exclude_product_codes": cfg.exclude_product_codes or [],
                "exclude_retailer_tags": cfg.exclude_retailer_tags or [],
                "selected_employee_ids": cfg.selected_employee_ids or [],
            }

    async def _get_exclusions(self, section_key: str) -> tuple[list[str], list[str]]:
        cfg = self._section_configs.get(section_key)
        if cfg is None:
            return [], []
        return cfg["exclude_product_codes"], cfg["exclude_retailer_tags"]

    async def _load_excluded_codes(self):
        if self._excluded_codes is None:
            self._excluded_codes = await get_excluded_codes(self.db)

    async def _load_excluded_retailers_by_tag(self, tag_name: str) -> set[int]:
        if tag_name not in self._excluded_retailers:
            result = await self.db.execute(
                select(RetailerFilter.retailer_id)
                .join(FilterTag, RetailerFilter.tag_id == FilterTag.id)
                .where(
                    FilterTag.name == tag_name,
                    RetailerFilter.house_id == self.house_id,
                )
            )
            self._excluded_retailers[tag_name] = {row[0] for row in result.all()}
        return self._excluded_retailers[tag_name]

    async def _build_base_query(self, section_key: str):
        query = select(LiveActivation).where(
            LiveActivation.house_id == self.house_id,
            LiveActivation.activation_date >= self.start_date,
            LiveActivation.activation_date <= self.end_date,
        )

        exclude_product_codes, exclude_retailer_tags = await self._get_exclusions(section_key)

        if exclude_product_codes:
            clause = exclude_clause(LiveActivation, set(exclude_product_codes))
            if clause is not None:
                query = query.where(clause)

        for tag in exclude_retailer_tags:
            excluded_ids = await self._load_excluded_retailers_by_tag(tag)
            if excluded_ids:
                query = query.where(
                    and_(
                        LiveActivation.retailer_id != None,
                        LiveActivation.retailer_id.notin_(excluded_ids),
                    )
                )

        return query

    async def get_total_count(self, section_key: str) -> int:
        query = await self._build_base_query(section_key)
        count_q = select(func.count()).select_from(query.subquery())
        result = await self.db.execute(count_q)
        return result.scalar() or 0

    async def get_yesterday_total_count(self, section_key: str) -> int:
        yesterday_start = self.start_date - timedelta(days=1)
        yesterday_end = self.start_date - timedelta(days=1)

        query = select(Activation).where(
            Activation.house_id == self.house_id,
            Activation.activation_date >= yesterday_start,
            Activation.activation_date <= yesterday_end,
        )

        exclude_product_codes, exclude_retailer_tags = await self._get_exclusions(section_key)

        if exclude_product_codes:
            clause = exclude_clause(Activation, set(exclude_product_codes))
            if clause is not None:
                query = query.where(clause)

        for tag in exclude_retailer_tags:
            excluded_ids = await self._load_excluded_retailers_by_tag(tag)
            if excluded_ids:
                query = query.where(
                    and_(
                        Activation.retailer_id != None,
                        Activation.retailer_id.notin_(excluded_ids),
                    )
                )

        count_q = select(func.count()).select_from(query.subquery())
        result = await self.db.execute(count_q)
        return result.scalar() or 0

    async def get_market_activation_count(self, section_key: str) -> int:
        base = await self._build_base_query(section_key)
        emp_codes = await self.db.execute(
            select(Employee.assisted_retailer_code).where(
                Employee.house_id == self.house_id,
                Employee.assisted_retailer_code != None,
            )
        )
        assisted_codes = [row[0] for row in emp_codes.all() if row[0]]
        if assisted_codes:
            market_q = base.where(
                (LiveActivation.retailer_code == None) |
                (LiveActivation.retailer_code.notin_(assisted_codes))
            )
        else:
            market_q = base
        result = await self.db.execute(select(func.count()).select_from(market_q.subquery()))
        return result.scalar() or 0

    async def get_employee_activation_by_code(self, section_key: str) -> int:
        base = await self._build_base_query(section_key)

        cfg = self._section_configs.get(section_key, {})
        selected_emp_ids: list[int] = cfg.get("selected_employee_ids") or []

        if not selected_emp_ids:
            return 0

        emp_rows = await self.db.execute(
            select(Employee.assisted_retailer_code).where(
                Employee.house_id == self.house_id,
                Employee.id.in_(selected_emp_ids),
                Employee.assisted_retailer_code != None,
            )
        )
        assisted_codes = [row[0] for row in emp_rows.all() if row[0]]
        if not assisted_codes:
            return 0
        emp_q = base.where(
            and_(
                LiveActivation.retailer_code != None,
                LiveActivation.retailer_code.in_(assisted_codes),
            )
        )
        result = await self.db.execute(select(func.count()).select_from(emp_q.subquery()))
        return result.scalar() or 0

    async def get_employee_market_count(self, section_key: str) -> dict:
        base = await self._build_base_query(section_key)

        emp_codes = await self.db.execute(
            select(Employee.assisted_retailer_code).where(
                Employee.house_id == self.house_id,
                Employee.assisted_retailer_code != None,
            )
        )
        assisted_codes = [row[0] for row in emp_codes.all() if row[0]]

        total = (await self.db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0

        emp_count = 0
        if assisted_codes:
            emp_q = base.where(
                and_(
                    LiveActivation.retailer_code != None,
                    LiveActivation.retailer_code.in_(assisted_codes),
                )
            )
            emp_count = (await self.db.execute(select(func.count()).select_from(emp_q.subquery()))).scalar() or 0

        market_count = total - emp_count
        emp_pct = round((emp_count / total * 100), 1) if total else 0
        market_pct = round((market_count / total * 100), 1) if total else 0

        return {
            "employee_activation": emp_count,
            "employee_activation_pct": emp_pct,
            "market_activation": market_count,
            "market_activation_pct": market_pct,
        }

    async def get_employee_breakdown(
        self, section_key: str
    ) -> tuple[list, list, list, list, dict, dict, dict, dict, dict]:
        base_act = await self._build_base_query(section_key)
        base_act_rso = await self._build_base_query("rsos")
        base_act_bps = await self._build_base_query("bps")

        ret_rows = await self.db.execute(
            select(Retailer.id, Retailer.employee_id).where(Retailer.house_id == self.house_id)
        )
        retailer_employee_map = {r.id: r.employee_id for r in ret_rows.all()}

        emp_rows = await self.db.execute(
            select(Employee.id, Employee.user_id, Employee.dms_code, Employee.itop_number, Employee.personal_number, Employee.assisted_retailer_code, Employee.pool_number)
            .where(Employee.house_id == self.house_id)
        )
        employees_raw = emp_rows.all()
        emp_id_to_user = {e.id: (e.user_id, e.dms_code, e.itop_number, e.personal_number, e.assisted_retailer_code, e.pool_number) for e in employees_raw}

        emp_code_rows = await self.db.execute(
            select(Employee.id, Employee.assisted_retailer_code).where(
                Employee.house_id == self.house_id,
                Employee.assisted_retailer_code != None,
            )
        )
        emp_id_to_code = {r.id: r.assisted_retailer_code for r in emp_code_rows.all()}

        user_ids = [u[0] for u in emp_id_to_user.values() if u[0]]
        user_role_map: dict[int, list[str]] = {}
        if user_ids:
            users_res = await self.db.execute(
                select(User).options(selectinload(User.roles)).where(User.id.in_(user_ids))
            )
            for u in users_res.unique().scalars().all():
                user_role_map[u.id] = [r.name.lower() for r in u.roles]

        emp_user_id_to_emp_id = {}
        for eid, (uid, *_) in emp_id_to_user.items():
            if uid:
                emp_user_id_to_emp_id[uid] = eid

        role_uids = {"supervisor": set(), "rso": set(), "bp": set(), "cc": set()}
        for uid, roles in user_role_map.items():
            for role_name in role_uids:
                if role_name in roles:
                    role_uids[role_name].add(uid)

        if not role_uids["bp"]:
            bp_direct = await self.db.execute(
                select(User).options(selectinload(User.roles)).where(User.roles.any(Role.name.ilike("bp")))
            )
            for u in bp_direct.unique().scalars().all():
                role_uids["bp"].add(u.id)

        if not role_uids["bp"]:
            bp_emps = await self.db.execute(
                select(Employee.user_id).where(
                    Employee.house_id == self.house_id,
                    Employee.employee_type == "bp",
                    Employee.user_id != None,
                )
            )
            for (uid,) in bp_emps.all():
                role_uids["bp"].add(uid)

        # ── Load BP retailer codes ──
        bp_code_rows = await self.db.execute(
            select(BpRetailerCode.bp_employee_id, BpRetailerCode.retailer_code).where(
                BpRetailerCode.house_id == self.house_id,
            )
        )
        bp_retailer_code_map: dict[int, list[str]] = {}
        all_bp_codes_for_house: set[str] = set()
        for bp_emp_id, r_code in bp_code_rows.all():
            bp_retailer_code_map.setdefault(bp_emp_id, []).append(r_code)
            all_bp_codes_for_house.add(r_code)

        emp_retailer_ids = {rid for rid, eid in retailer_employee_map.items() if eid and eid in emp_id_to_user}
        active_emp_retailers = set()
        if emp_retailer_ids:
            active_res = await self.db.execute(
                select(LiveActivation.retailer_id).distinct().where(
                    LiveActivation.retailer_id.in_(emp_retailer_ids),
                    LiveActivation.house_id == self.house_id,
                    LiveActivation.activation_date >= self.start_date,
                    LiveActivation.activation_date <= self.end_date,
                )
            )
            active_emp_retailers = {r[0] for r in active_res.all()}

        retailer_to_emp = {rid: eid for rid, eid in retailer_employee_map.items() if eid}
        active_employee_ids = {retailer_to_emp[rid] for rid in active_emp_retailers if rid in retailer_to_emp}
        active_user_ids = set()
        for eid in active_employee_ids:
            info = emp_id_to_user.get(eid)
            if info and info[0]:
                active_user_ids.add(info[0])

        active_counts = {}
        for role_name in role_uids:
            active_counts[role_name] = len([uid for uid in role_uids[role_name] if uid in active_user_ids])

        total_counts = {role_name: len(uids) for role_name, uids in role_uids.items()}

        supervisor_data = []
        for sup_uid in role_uids["supervisor"]:
            sup_user = (await self.db.execute(select(User).where(User.id == sup_uid))).scalar_one_or_none()
            if not sup_user:
                continue
            sup_emp_id = emp_user_id_to_emp_id.get(sup_uid)

            rso_users = (
                await self.db.execute(
                    select(User).options(selectinload(User.roles)).where(User.parent_id == sup_uid)
                )
            ).unique().scalars().all()
            rso_user_ids = [ru.id for ru in rso_users if "rso" in [r.name.lower() for r in ru.roles]]

            sub_employee_ids = set()
            for ruid in rso_user_ids:
                eid = emp_user_id_to_emp_id.get(ruid)
                if eid:
                    sub_employee_ids.add(eid)

            sup_own_retailers = set()
            if sup_emp_id:
                for rid, eid in retailer_employee_map.items():
                    if eid == sup_emp_id:
                        sup_own_retailers.add(rid)

            sub_retailer_ids = set()
            for rid, eid in retailer_employee_map.items():
                if eid in sub_employee_ids:
                    sub_retailer_ids.add(rid)

            all_retailers = sup_own_retailers | sub_retailer_ids

            def _exclude_bp_codes(q):
                if all_bp_codes_for_house:
                    return q.where(LiveActivation.retailer_code.notin_(all_bp_codes_for_house))
                return q

            sup_total = 0
            if all_retailers:
                sup_q = select(func.count()).where(
                    LiveActivation.retailer_id.in_(all_retailers),
                    LiveActivation.house_id == self.house_id,
                    LiveActivation.activation_date >= self.start_date,
                    LiveActivation.activation_date <= self.end_date,
                )
                sup_q = _exclude_bp_codes(sup_q)
                sup_count = await self.db.execute(sup_q)
                sup_total = sup_count.scalar() or 0

            employee_retailers_in_team = sup_own_retailers | sub_retailer_ids
            emp_team_active = set()
            if employee_retailers_in_team:
                team_q = select(LiveActivation.retailer_id).distinct().where(
                    LiveActivation.retailer_id.in_(employee_retailers_in_team),
                    LiveActivation.house_id == self.house_id,
                    LiveActivation.activation_date >= self.start_date,
                    LiveActivation.activation_date <= self.end_date,
                )
                team_q = _exclude_bp_codes(team_q)
                team_res = await self.db.execute(team_q)
                emp_team_active = {r[0] for r in team_res.all()}
            sup_emp = len([r for r in emp_team_active if r in employee_retailers_in_team])
            sup_market = sup_total - sup_emp

            supervisor_data.append({
                "id": sup_uid,
                "name": sup_user.name or f"Supervisor #{sup_uid}",
                "dms_code": emp_id_to_user.get(sup_emp_id, ("", "", "", ""))[1] if sup_emp_id else "",
                "total_activation": sup_total,
                "employee_activation": sup_emp,
                "market_activation": sup_market,
                "contribution": total_counts["supervisor"] and round((sup_total / (sup_total or 1)) * 100, 1) or 0,
                "active_rso": len([u for u in rso_user_ids if u in active_user_ids]),
                "active_bp": 0,
                "active_cc": 0,
            })
        supervisor_data.sort(key=lambda x: x["total_activation"], reverse=True)

        # ── Load RSO targets for current month ──
        today_for_target = self.start_date
        month_start = date(today_for_target.year, today_for_target.month, 1)
        _, last_day = monthrange(today_for_target.year, today_for_target.month)
        month_end = date(today_for_target.year, today_for_target.month, last_day)
        rso_emp_ids_for_target = [
            eid for uid, eid in emp_user_id_to_emp_id.items()
            if uid in role_uids["rso"] and eid
        ]
        rso_target_map: dict[int, int] = {}
        if rso_emp_ids_for_target:
            target_rows = await self.db.execute(
                select(RSOTarget).where(
                    RSOTarget.employee_id.in_(rso_emp_ids_for_target),
                    RSOTarget.target_date >= month_start,
                    RSOTarget.target_date <= month_end,
                )
            )
            for t in target_rows.scalars().all():
                rso_target_map[t.employee_id] = t.ga or 0

        # ── Load month-to-date (MTD) activation counts for RSO remaining ──
        yesterday_for_mtd = self.start_date - timedelta(days=1)
        mtd_retailer_counts: dict[int, int] = {}
        all_rso_retailer_ids: set[int] = set()
        rso_emp_retailer_map: dict[int, set[int]] = {}
        for rso_uid in role_uids["rso"]:
            rso_emp_id = emp_user_id_to_emp_id.get(rso_uid)
            if rso_emp_id:
                ret_ids = {rid for rid, eid in retailer_employee_map.items() if eid == rso_emp_id}
                if ret_ids:
                    rso_emp_retailer_map[rso_emp_id] = ret_ids
                    all_rso_retailer_ids.update(ret_ids)
        if all_rso_retailer_ids and yesterday_for_mtd >= month_start:
            # Apply section exclusions (product codes + retailer tags)
            mtd_exclude_product_codes, mtd_exclude_retailer_tags = await self._get_exclusions("rsos")
            mtd_excluded_retailer_ids: set[int] = set()
            for tag in mtd_exclude_retailer_tags:
                excluded = await self._load_excluded_retailers_by_tag(tag)
                mtd_excluded_retailer_ids.update(excluded)
            mtd_filtered_retailer_ids = [rid for rid in all_rso_retailer_ids if rid not in mtd_excluded_retailer_ids]

            mtd_q = select(Activation.retailer_id, func.count()).where(
                Activation.house_id == self.house_id,
                Activation.activation_date >= month_start,
                Activation.activation_date <= yesterday_for_mtd,
                Activation.retailer_id.in_(mtd_filtered_retailer_ids),
            )
            if mtd_exclude_product_codes:
                mtd_q = mtd_q.where(
                    and_(
                        Activation.product_code != None,
                        Activation.product_code.notin_(mtd_exclude_product_codes),
                    )
                )
            if all_bp_codes_for_house:
                mtd_q = mtd_q.where(Activation.retailer_code.notin_(all_bp_codes_for_house))
            mtd_q = mtd_q.group_by(Activation.retailer_id)
            mtd_rows = await self.db.execute(mtd_q)
            for rid, cnt in mtd_rows.all():
                mtd_retailer_counts[rid] = cnt

        rso_data = []
        for rso_uid in role_uids["rso"]:
            rso_user = (await self.db.execute(select(User).where(User.id == rso_uid))).scalar_one_or_none()
            if not rso_user:
                continue
            rso_emp_id = emp_user_id_to_emp_id.get(rso_uid)
            rso_ret_ids = set()
            if rso_emp_id:
                for rid, eid in retailer_employee_map.items():
                    if eid == rso_emp_id:
                        rso_ret_ids.add(rid)
            rso_code = emp_id_to_code.get(rso_emp_id) if rso_emp_id else None
            rso_own = 0
            rso_total = 0
            if rso_ret_ids:
                total_q = base_act_rso.where(LiveActivation.retailer_id.in_(rso_ret_ids))
                if all_bp_codes_for_house:
                    total_q = total_q.where(LiveActivation.retailer_code.notin_(all_bp_codes_for_house))
                res = await self.db.execute(select(func.count()).select_from(total_q.subquery()))
                rso_total = res.scalar() or 0
                if rso_code:
                    own_q = base_act_rso.where(
                        and_(
                            LiveActivation.retailer_code == rso_code,
                            LiveActivation.retailer_id.in_(rso_ret_ids),
                        )
                    )
                    if all_bp_codes_for_house:
                        own_q = own_q.where(LiveActivation.retailer_code.notin_(all_bp_codes_for_house))
                    res = await self.db.execute(select(func.count()).select_from(own_q.subquery()))
                    rso_own = res.scalar() or 0
            rso_info = emp_id_to_user.get(rso_emp_id) if rso_emp_id else None
            rso_target_val = rso_target_map.get(rso_emp_id, 0) if rso_emp_id else 0
            mtd_achievement = sum(mtd_retailer_counts.get(rid, 0) for rid in rso_emp_retailer_map.get(rso_emp_id, set())) if rso_emp_id else 0
            rso_data.append({
                "id": rso_uid,
                "employee_id": rso_emp_id,
                "name": rso_user.name or f"RSO #{rso_uid}",
                "dms_code": rso_info[1] if rso_info else "",
                "itop_number": rso_info[2] if rso_info else "",
                "assisted_code": rso_info[4] if rso_info else "",
                "total_activation": rso_total,
                "own_activation": rso_own if rso_code else 0,
                "market_activation": (rso_total - rso_own) if rso_code else 0,
                "target": rso_target_val,
                "remaining": max(0, rso_target_val - mtd_achievement),
                "contribution": 0,
            })
        # ── Yesterday RSO breakdown (with same exclusions as base_act_rso) ──
        yesterday = self.start_date - timedelta(days=1)
        yest_retailer_counts: dict[int, int] = {}
        yest_code_counts: dict[str, int] = {}
        if yesterday >= date(2020, 1, 1):
            yest_exclude_product_codes, yest_exclude_retailer_tags = await self._get_exclusions("rsos")
            yest_excluded_retailer_ids: set[int] = set()
            for tag in yest_exclude_retailer_tags:
                excluded = await self._load_excluded_retailers_by_tag(tag)
                yest_excluded_retailer_ids.update(excluded)

            yest_q = select(Activation.retailer_id, Activation.retailer_code).where(
                Activation.house_id == self.house_id,
                Activation.activation_date == yesterday,
            )
            if yest_excluded_retailer_ids:
                yest_q = yest_q.where(
                    Activation.retailer_id.notin_(yest_excluded_retailer_ids)
                )
            if yest_exclude_product_codes:
                yest_q = yest_q.where(
                    and_(
                        Activation.product_code != None,
                        Activation.product_code.notin_(yest_exclude_product_codes),
                    )
                )
            if all_bp_codes_for_house:
                yest_q = yest_q.where(Activation.retailer_code.notin_(all_bp_codes_for_house))

            yest_rows = await self.db.execute(yest_q)
            for rid, rcode in yest_rows.all():
                if rid:
                    yest_retailer_counts[rid] = yest_retailer_counts.get(rid, 0) + 1
                if rcode:
                    yest_code_counts[rcode] = yest_code_counts.get(rcode, 0) + 1

        for r in rso_data:
            emp_id = r["employee_id"]
            ret_ids: set[int] = set()
            if emp_id:
                for rid, eid in retailer_employee_map.items():
                    if eid == emp_id:
                        ret_ids.add(rid)
            y_total = sum(yest_retailer_counts.get(rid, 0) for rid in ret_ids)
            r_code = r.get("assisted_code")
            y_own = yest_code_counts.get(r_code, 0) if r_code else 0
            y_market = y_total - y_own
            r["yesterday_own"] = y_own if r_code else 0
            r["yesterday_market"] = y_market if r_code else 0
            r["yesterday_total"] = y_total
        rso_data.sort(key=lambda x: x["total_activation"], reverse=True)

        bp_data = []
        for bp_uid in role_uids["bp"]:
            bp_user = (await self.db.execute(select(User).where(User.id == bp_uid))).scalar_one_or_none()
            if not bp_user:
                continue
            bp_emp_id = emp_user_id_to_emp_id.get(bp_uid)
            bp_total = 0
            if bp_emp_id:
                bp_codes = bp_retailer_code_map.get(bp_emp_id, [])
                if bp_codes:
                    bp_q = base_act_bps.where(
                        LiveActivation.retailer_code.in_(bp_codes)
                    )
                    res = await self.db.execute(select(func.count()).select_from(bp_q.subquery()))
                    bp_total = res.scalar() or 0
            bp_info = emp_id_to_user.get(bp_emp_id) if bp_emp_id else None
            bp_data.append({
                "id": bp_uid,
                "employee_id": bp_emp_id,
                "name": bp_user.name or f"BP #{bp_uid}",
                "dms_code": bp_info[1] if bp_info else "",
                "assisted_code": bp_info[4] if bp_info else "",
                "pool_number": bp_info[5] if bp_info else "",
                "own_activation": bp_total,
                "contribution": 0,
                "rank": 0,
            })
        bp_data.sort(key=lambda x: x["own_activation"], reverse=True)
        for i, bp in enumerate(bp_data):
            bp["rank"] = i + 1
        # ── Yesterday BP breakdown ──
        for b in bp_data:
            emp_id = b["employee_id"]
            bp_codes = bp_retailer_code_map.get(emp_id, []) if emp_id else []
            b_code = b.get("assisted_code")
            if b_code and b_code not in bp_codes:
                bp_codes.append(b_code)
            y_total = sum(yest_code_counts.get(code, 0) for code in bp_codes)
            b["yesterday_activation"] = y_total

        cc_data = []
        for cc_uid in role_uids["cc"]:
            cc_user = (await self.db.execute(select(User).where(User.id == cc_uid))).scalar_one_or_none()
            if not cc_user:
                continue
            cc_emp_id = emp_user_id_to_emp_id.get(cc_uid)
            cc_ret_ids = set()
            if cc_emp_id:
                for rid, eid in retailer_employee_map.items():
                    if eid == cc_emp_id:
                        cc_ret_ids.add(rid)
            cc_total = 0
            if cc_ret_ids:
                res = await self.db.execute(
                    select(func.count()).where(
                        LiveActivation.retailer_id.in_(cc_ret_ids),
                        LiveActivation.house_id == self.house_id,
                        LiveActivation.activation_date >= self.start_date,
                        LiveActivation.activation_date <= self.end_date,
                    )
                )
                cc_total = res.scalar() or 0
            cc_data.append({
                "id": cc_uid,
                "name": cc_user.name or f"CC #{cc_uid}",
                "dms_code": emp_id_to_user.get(cc_emp_id, ("", "", "", ""))[1] if cc_emp_id else "",
                "own_activation": cc_total,
                "contribution": 0,
            })
        cc_data.sort(key=lambda x: x["own_activation"], reverse=True)

        top_supervisor = supervisor_data[0] if supervisor_data and (len(supervisor_data) == 1 or supervisor_data[0]["total_activation"] != supervisor_data[1]["total_activation"]) else None
        top_rso = rso_data[0] if rso_data and (len(rso_data) == 1 or rso_data[0]["total_activation"] != rso_data[1]["total_activation"]) else None
        top_bp = bp_data[0] if bp_data and (len(bp_data) == 1 or bp_data[0]["own_activation"] != bp_data[1]["own_activation"]) else None
        top_cc = cc_data[0] if cc_data and (len(cc_data) == 1 or cc_data[0]["own_activation"] != cc_data[1]["own_activation"]) else None

        active_sup = len([uid for uid in role_uids["supervisor"] if uid in active_user_ids])
        active_rso = len([uid for uid in role_uids["rso"] if uid in active_user_ids])
        active_bp = len([uid for uid in role_uids["bp"] if uid in active_user_ids])
        active_cc = len([uid for uid in role_uids["cc"] if uid in active_user_ids])

        return (
            supervisor_data,
            rso_data,
            bp_data,
            cc_data,
            top_supervisor,
            top_rso,
            top_bp,
            top_cc,
            {
                "active_supervisors": active_sup,
                "active_rso": active_rso,
                "active_bp": active_bp,
                "active_cc": active_cc,
                "total_supervisors": len(role_uids["supervisor"]),
                "total_rso": len(role_uids["rso"]),
                "total_bp": len(role_uids["bp"]),
                "total_cc": len(role_uids["cc"]),
            },
        )

    async def get_trend(self, section_key: str) -> list[dict]:
        today = self.start_date
        month_start = date(today.year, today.month, 1)
        yesterday = today - timedelta(days=1)

        exclude_product_codes, exclude_retailer_tags = await self._get_exclusions(section_key)
        trend_map: dict[str, int] = {}

        # 1. activations table: 1st of month → yesterday
        if month_start <= yesterday:
            act_q = select(Activation.activation_date, func.count()).where(
                Activation.house_id == self.house_id,
                Activation.activation_date >= month_start,
                Activation.activation_date <= yesterday,
            )
            if exclude_product_codes:
                clause = exclude_clause(Activation, set(exclude_product_codes))
                if clause is not None:
                    act_q = act_q.where(clause)
            for tag in exclude_retailer_tags:
                excluded_ids = await self._load_excluded_retailers_by_tag(tag)
                if excluded_ids:
                    act_q = act_q.where(
                        and_(
                            Activation.retailer_id != None,
                            Activation.retailer_id.notin_(excluded_ids),
                        )
                    )
            act_q = act_q.group_by(Activation.activation_date).order_by(Activation.activation_date)
            for row in (await self.db.execute(act_q)).all():
                d = row.activation_date
                trend_map[d.isoformat() if isinstance(d, date) else str(d)] = row[1]

        # 2. live_activations table: today only
        live_q = select(LiveActivation.activation_date, func.count()).where(
            LiveActivation.house_id == self.house_id,
            LiveActivation.activation_date == today,
        )
        if exclude_product_codes:
            clause = exclude_clause(LiveActivation, set(exclude_product_codes))
            if clause is not None:
                live_q = live_q.where(clause)
        for tag in exclude_retailer_tags:
            excluded_ids = await self._load_excluded_retailers_by_tag(tag)
            if excluded_ids:
                live_q = live_q.where(
                    and_(
                        LiveActivation.retailer_id != None,
                        LiveActivation.retailer_id.notin_(excluded_ids),
                    )
                )
        live_q = live_q.group_by(LiveActivation.activation_date)
        for row in (await self.db.execute(live_q)).all():
            d = row.activation_date
            trend_map[d.isoformat() if isinstance(d, date) else str(d)] = row[1]

        # 3. fill all dates from month_start → today
        result = []
        cursor = month_start
        while cursor <= today:
            result.append({"date": cursor.isoformat(), "count": trend_map.get(cursor.isoformat(), 0)})
            cursor += timedelta(days=1)
        return result

    async def _get_employee_participation_counts(self) -> dict:
        cfg = self._section_configs.get("employee_activation", {})
        emp_ids: list[int] = cfg.get("selected_employee_ids") or []
        if not emp_ids:
            return {"total_selected": 0, "activated_count": 0}

        emp_rows = await self.db.execute(
            select(Employee.id, Employee.assisted_retailer_code).where(
                Employee.house_id == self.house_id,
                Employee.status == "Active",
                Employee.id.in_(emp_ids),
                Employee.assisted_retailer_code != None,
                Employee.assisted_retailer_code != "",
            )
        )
        emp_data = [(r.id, r.assisted_retailer_code) for r in emp_rows.all()]
        if not emp_data:
            return {"total_selected": 0, "activated_count": 0}

        total_selected = len(emp_data)
        codes = [code for _, code in emp_data]

        act_rows = await self.db.execute(
            select(LiveActivation.retailer_code).distinct().where(
                LiveActivation.house_id == self.house_id,
                LiveActivation.activation_date >= self.start_date,
                LiveActivation.activation_date <= self.end_date,
                LiveActivation.retailer_code.in_(codes),
            )
        )
        activated_codes = {r[0] for r in act_rows.all() if r[0]}
        activated_count = sum(1 for _, code in emp_data if code in activated_codes)

        return {"total_selected": total_selected, "activated_count": activated_count}

    async def build_all(self) -> dict:
        await self._load_section_configs()

        total = await self.get_total_count("total_activation")
        yesterday_total = await self.get_yesterday_total_count("total_activation")
        emp_count = await self.get_employee_activation_by_code("employee_activation")
        market_count = await self.get_market_activation_count("market_activation")
        emp_pct = round((emp_count / total * 100), 1) if total else 0
        market_pct = round((market_count / total * 100), 1) if total else 0
        emp_participation = await self._get_employee_participation_counts()

        distribution = await self.get_employee_market_count("distribution")
        (
            supervisors, rsos, bps, ccs,
            top_sup, top_rso, top_bp, top_cc,
            active_counts,
        ) = await self.get_employee_breakdown("supervisors")

        trend = await self.get_trend("total_activation")

        for s in supervisors:
            s["contribution"] = round((s["total_activation"] / total * 100), 1) if total else 0
        for r in rsos:
            r["contribution"] = round((r["total_activation"] / total * 100), 1) if total else 0
        for b in bps:
            b["contribution"] = round((b["own_activation"] / total * 100), 1) if total else 0
        for c in ccs:
            c["contribution"] = round((c["own_activation"] / total * 100), 1) if total else 0

        insights = []
        if top_sup and top_sup["contribution"] >= 10:
            insights.append(f"{top_sup['name']} contributed {top_sup['contribution']}% of total house activation as top supervisor.")
        if top_rso and top_rso["contribution"] >= 5:
            insights.append(f"{top_rso['name']} generated {top_rso['total_activation']} activations as top RSO.")
        if top_bp:
            insights.append(f"{top_bp['name']} achieved {top_bp['own_activation']} personal activations as top BP.")
        if top_cc:
            insights.append(f"{top_cc['name']} achieved {top_cc['own_activation']} personal activations as top CC.")
        if emp_pct > 70:
            insights.append(f"Employee activation dominates at {emp_pct}% of total — strong team execution.")
        elif market_pct > 70:
            insights.append(f"Market activation dominates at {market_pct}% of total — strong open market reach.")

        return {
            "summary": {
                "total_activations": total,
                "yesterday_total": yesterday_total,
                "employee_activation": emp_count,
                "employee_activation_pct": emp_pct,
                "market_activation": market_count,
                "market_activation_pct": market_pct,
                "total_selected_employees": emp_participation["total_selected"],
                "activated_employee_count": emp_participation["activated_count"],
                **active_counts,
            },
            "distribution": distribution,
            "supervisors": supervisors,
            "rsos": rsos,
            "bps": bps,
            "ccs": ccs,
            "top_performers": {
                "supervisor": top_sup,
                "rso": top_rso,
                "bp": top_bp,
                "cc": top_cc,
            },
            "insights": insights,
            "trend": trend,
            "date_range": {
                "start": self.start_date.isoformat(),
                "end": self.end_date.isoformat(),
            },
        }
