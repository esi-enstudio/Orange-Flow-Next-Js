import logging
from datetime import date, datetime
from typing import Optional, Sequence

from sqlalchemy import select, func, and_, or_, cast, String
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.models.itopup_detail import ITopUpDetail
from app.models.retailer import Retailer
from app.models.employee import Employee
from app.models.house import House
from app.models.user import User

logger = logging.getLogger("app.services.TransactionReport")

VALID_REPORT_TYPES = ("C2C", "C2S", "Balance")


def parse_date(value: Optional[str], field: str) -> Optional[date]:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        raise ValueError(f"Invalid {field} format (use YYYY-MM-DD)")


class TransactionReportService:
    def __init__(
        self,
        db: AsyncSession,
        house_id: Optional[int],
        report_type: Optional[str] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        rso_id: Optional[int] = None,
        retailer_id: Optional[int] = None,
    ):
        self.db = db
        self.house_id = house_id
        self.report_type = report_type if report_type in VALID_REPORT_TYPES else None
        self.start_date = start_date
        self.end_date = end_date
        self.rso_id = rso_id
        self.retailer_id = retailer_id

    def _build_filters(self) -> list:
        conditions = []
        if self.house_id:
            conditions.append(ITopUpDetail.house_id == self.house_id)
        if self.report_type:
            conditions.append(ITopUpDetail.report_type == self.report_type)
        if self.start_date:
            conditions.append(ITopUpDetail.report_date >= self.start_date)
        if self.end_date:
            conditions.append(ITopUpDetail.report_date <= self.end_date)
        if self.retailer_id:
            conditions.append(ITopUpDetail.retailer_id == self.retailer_id)
        elif self.rso_id:
            conditions.append(ITopUpDetail.retailer.has(Retailer.employee_id == self.rso_id))
        return conditions

    async def get_summary(self) -> dict:
        conditions = self._build_filters()
        base = select(
            func.coalesce(func.sum(ITopUpDetail.daily_value), 0),
            func.count(ITopUpDetail.id),
            func.count(func.distinct(ITopUpDetail.retailer_id)),
            func.count(func.distinct(ITopUpDetail.report_date)),
        ).select_from(ITopUpDetail)
        if conditions:
            base = base.where(and_(*conditions))
        res = await self.db.execute(base)
        total_value, total_records, active_retailers, active_days = res.one()

        total_value = float(total_value or 0)
        total_records = int(total_records or 0)
        active_retailers = int(active_retailers or 0)
        active_days = int(active_days or 0)

        daily_average = round(total_value / active_days, 2) if active_days else 0
        return {
            "total_value": total_value,
            "total_records": total_records,
            "active_days": active_days,
            "active_retailers": active_retailers,
            "daily_average": daily_average,
        }

    async def get_daily_groups(
        self, page: int = 1, per_page: int = 20
    ) -> tuple[list[dict], int]:
        conditions = self._build_filters()

        count_query = select(func.count(func.distinct(ITopUpDetail.report_date))).select_from(ITopUpDetail)
        if conditions:
            count_query = count_query.where(and_(*conditions))
        count_res = await self.db.execute(count_query)
        total = int(count_res.scalar() or 0)

        rows_query = (
            select(
                ITopUpDetail.report_date,
                func.coalesce(func.sum(ITopUpDetail.daily_value), 0),
                func.count(ITopUpDetail.id),
                func.count(func.distinct(ITopUpDetail.retailer_id)),
            )
            .select_from(ITopUpDetail)
            .group_by(ITopUpDetail.report_date)
            .order_by(ITopUpDetail.report_date.desc())
        )
        if conditions:
            rows_query = rows_query.where(and_(*conditions))

        offset = (page - 1) * per_page
        rows_result = await self.db.execute(rows_query.offset(offset).limit(per_page))
        rows = rows_result.all()

        groups: list[dict] = []
        if rows:
            date_list = [r[0] for r in rows]
            detail_query = (
                select(
                    ITopUpDetail.report_date,
                    ITopUpDetail.retailer_id,
                    Retailer.retailer_code,
                    Retailer.name,
                    ITopUpDetail.daily_value,
                )
                .join(Retailer, ITopUpDetail.retailer_id == Retailer.id)
                .where(ITopUpDetail.report_date.in_(date_list))
                .order_by(ITopUpDetail.report_date.desc(), Retailer.name.asc())
            )
            if self.house_id:
                detail_query = detail_query.where(ITopUpDetail.house_id == self.house_id)
            if self.report_type:
                detail_query = detail_query.where(ITopUpDetail.report_type == self.report_type)
            if self.retailer_id:
                detail_query = detail_query.where(ITopUpDetail.retailer_id == self.retailer_id)
            elif self.rso_id:
                detail_query = detail_query.where(Retailer.employee_id == self.rso_id)
            detail_res = await self.db.execute(detail_query)
            detail_rows = detail_res.all()

            detail_map: dict = {}
            for d_date, r_id, r_code, r_name, value in detail_rows:
                key = d_date.isoformat()
                detail_map.setdefault(key, []).append(
                    {
                        "retailer_id": r_id,
                        "retailer_code": r_code or "",
                        "retailer_name": r_name or "",
                        "value": float(value or 0),
                    }
                )

            for r_date, total_value, record_count, retailer_count in rows:
                key = r_date.isoformat()
                groups.append(
                    {
                        "date": key,
                        "total_value": float(total_value or 0),
                        "record_count": int(record_count or 0),
                        "retailer_count": int(retailer_count or 0),
                        "retailers": detail_map.get(key, []),
                    }
                )

        return groups, total

    async def get_daily_trend(self) -> list[dict]:
        conditions = self._build_filters()
        query = (
            select(
                ITopUpDetail.report_date,
                func.coalesce(func.sum(ITopUpDetail.daily_value), 0),
                func.count(ITopUpDetail.id),
            )
            .select_from(ITopUpDetail)
            .group_by(ITopUpDetail.report_date)
            .order_by(ITopUpDetail.report_date.asc())
        )
        if conditions:
            query = query.where(and_(*conditions))
        res = await self.db.execute(query)
        return [
            {
                "date": r[0].isoformat(),
                "value": float(r[1] or 0),
                "count": int(r[2] or 0),
            }
            for r in res.all()
        ]

    async def get_entities(self, entity_type: str, search: Optional[str], limit: int = 50) -> list[dict]:
        p = f"%{search}%" if search else None
        if entity_type == "retailer":
            query = select(Retailer).options(joinedload(Retailer.employee)).where(Retailer.house_id == self.house_id)
            if p:
                query = query.where(
                    or_(
                        Retailer.retailer_code.ilike(p),
                        Retailer.name.ilike(p),
                    )
                )
            res = await self.db.execute(query.order_by(Retailer.name.asc()).limit(limit))
            retailers = res.scalars().all()
            return [
                {
                    "id": r.id,
                    "code": r.retailer_code,
                    "name": r.name,
                    "rso_name": r.employee.user.name if r.employee and r.employee.user else (r.employee.dms_code if r.employee else ""),
                }
                for r in retailers
            ]
        query = select(Employee).options(joinedload(Employee.user)).where(
            Employee.employee_type == "rso",
            Employee.status == "Active",
        )
        if self.house_id:
            query = query.where(Employee.house_id == self.house_id)
        if p:
            query = query.where(
                or_(
                    Employee.dms_code.ilike(p),
                    Employee.itop_number.ilike(p),
                    Employee.user.has(User.name.ilike(p)),
                )
            )
        res = await self.db.execute(query.order_by(Employee.dms_code.asc()).limit(limit))
        employees = res.scalars().all()
        return [
            {
                "id": e.id,
                "code": e.dms_code or "",
                "name": e.user.name if e.user else (e.dms_code or f"#{e.id}"),
                "itop_number": e.itop_number or "",
            }
            for e in employees
        ]

    async def get_export_rows(self, limit: int = 20000) -> list[dict]:
        conditions = self._build_filters()
        query = (
            select(
                House.code,
                ITopUpDetail.report_date,
                User.name.label("rso_name"),
                Employee.dms_code,
                Employee.itop_number,
                Retailer.retailer_code,
                Retailer.itop_number,
                Retailer.name,
                ITopUpDetail.daily_value,
                ITopUpDetail.report_type,
            )
            .join(House, ITopUpDetail.house_id == House.id)
            .outerjoin(Retailer, ITopUpDetail.retailer_id == Retailer.id)
            .outerjoin(Employee, Retailer.employee_id == Employee.id)
            .outerjoin(User, Employee.user_id == User.id)
            .order_by(ITopUpDetail.report_date.desc(), Retailer.name.asc())
        )
        if conditions:
            query = query.where(and_(*conditions))
        res = await self.db.execute(query.limit(limit))
        return [
            {
                "house_code": r[0] or "",
                "date": r[1].strftime("%d %b %Y") if r[1] else "",
                "rso_name": r[2] or "",
                "rso_dms_code": r[3] or "",
                "rso_itop_number": r[4] or "",
                "retailer_code": r[5] or "",
                "retailer_itop_number": r[6] or "",
                "retailer_name": r[7] or "",
                "amount": float(r[8] or 0),
                "report_type": r[9] or "",
            }
            for r in res.all()
        ]