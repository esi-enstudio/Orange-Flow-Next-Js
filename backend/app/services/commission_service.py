import logging
from decimal import Decimal
from datetime import date, datetime
from typing import Optional, List, Tuple

from sqlalchemy import select, func, and_, or_, case, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload, joinedload

from app.models.commission import (
    StatementBatch, CampaignType, CampaignTransaction,
    CommissionStaging, CommissionAuditLog,
)
from app.models.house import House
from app.models.employee import Employee
from app.schemas.commission import (
    CommissionFilterRequest, DateFilter,
    CommissionSummary, CampaignPerformance, HousePerformance,
    PaginatedResponse
)

logger = logging.getLogger(__name__)


class CommissionQueryBuilder:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def build_filtered_query(self, filters: CommissionFilterRequest):
        conditions = []

        if filters.date:
            date_conditions = self._build_date_filter(filters.date)
            if date_conditions is not None:
                conditions.append(date_conditions)

        if filters.house_ids:
            conditions.append(CampaignTransaction.house_id.in_(filters.house_ids))

        if filters.campaign_type_ids:
            conditions.append(CampaignTransaction.campaign_type_id.in_(filters.campaign_type_ids))

        if filters.campaign_category:
            conditions.append(CampaignType.category == filters.campaign_category)

        if filters.participant_type:
            conditions.append(CampaignTransaction.participant_type == filters.participant_type)

        if filters.search:
            search_pattern = f"%{filters.search}%"
            conditions.append(
                or_(
                    CampaignType.campaign_name.ilike(search_pattern),
                    House.name.ilike(search_pattern),
                    House.code.ilike(search_pattern),
                    CampaignTransaction.participant_name.ilike(search_pattern),
                    CampaignTransaction.participant_ref.ilike(search_pattern),
                )
            )

        return and_(*conditions) if conditions else True

    def _build_date_filter(self, date_filter: DateFilter):
        if date_filter.exact:
            return func.date(StatementBatch.statement_date) == date_filter.exact
        conditions = []
        if date_filter.from_date:
            conditions.append(StatementBatch.statement_date >= date_filter.from_date)
        if date_filter.to_date:
            conditions.append(StatementBatch.statement_date <= date_filter.to_date)
        if date_filter.month:
            conditions.append(func.extract("month", StatementBatch.statement_date) == date_filter.month)
        if date_filter.year:
            conditions.append(func.extract("year", StatementBatch.statement_date) == date_filter.year)
        return and_(*conditions) if conditions else None

    def _build_order_by(self, filters: CommissionFilterRequest):
        sort_map = {
            "created_at": CampaignTransaction.created_at,
            "amount": CampaignTransaction.amount,
            "participant_ref": CampaignTransaction.participant_ref,
            "campaign_name": CampaignType.campaign_name,
            "house_code": House.code,
            "house_name": House.name,
            "statement_date": StatementBatch.statement_date,
        }
        sort_col = sort_map.get(filters.sort_by, CampaignTransaction.created_at)
        return sort_col.desc() if filters.sort_order == "desc" else sort_col.asc()

    async def query_transactions(self, filters: CommissionFilterRequest) -> Tuple[List, int, CommissionSummary]:
        base_condition = await self.build_filtered_query(filters)

        count_query = select(func.count(CampaignTransaction.id)).select_from(CampaignTransaction).join(
            StatementBatch, CampaignTransaction.statement_batch_id == StatementBatch.id
        ).join(
            House, CampaignTransaction.house_id == House.id
        ).join(
            CampaignType, CampaignTransaction.campaign_type_id == CampaignType.id
        ).where(base_condition)

        total_result = await self.session.execute(count_query)
        total = total_result.scalar() or 0

        order_by = self._build_order_by(filters)
        offset = (filters.page - 1) * filters.page_size

        items_query = select(CampaignTransaction).options(
            selectinload(CampaignTransaction.statement_batch),
            selectinload(CampaignTransaction.house),
            selectinload(CampaignTransaction.campaign_type),
            selectinload(CampaignTransaction.employee).joinedload(Employee.user),
        ).join(
            StatementBatch, CampaignTransaction.statement_batch_id == StatementBatch.id
        ).join(
            House, CampaignTransaction.house_id == House.id
        ).join(
            CampaignType, CampaignTransaction.campaign_type_id == CampaignType.id
        ).where(base_condition).order_by(order_by).offset(offset).limit(filters.page_size)

        items_result = await self.session.execute(items_query)
        items = list({row[0].id: row[0] for row in items_result.unique().all()}.values())

        summary = await self._compute_summary(base_condition)

        return items, total, summary

    async def _compute_summary(self, base_condition) -> CommissionSummary:
        summary_query = select(
            func.coalesce(func.sum(CampaignTransaction.amount), 0).label("total_campaign"),
            func.count(CampaignTransaction.id.distinct()).label("txn_count"),
            func.count(House.id.distinct()).label("house_count"),
        ).select_from(CampaignTransaction).join(
            StatementBatch, CampaignTransaction.statement_batch_id == StatementBatch.id
        ).join(
            House, CampaignTransaction.house_id == House.id
        ).join(
            CampaignType, CampaignTransaction.campaign_type_id == CampaignType.id
        ).where(base_condition)

        result = await self.session.execute(summary_query)
        row = result.one()

        return CommissionSummary(
            total_campaign_amount=Decimal(str(row.total_campaign)),
            transaction_count=row.txn_count,
            house_count=row.house_count,
        )

    async def get_campaign_performance(self, filters: CommissionFilterRequest) -> List[CampaignPerformance]:
        base_condition = await self.build_filtered_query(filters)

        query = select(
            CampaignType.id,
            CampaignType.campaign_name,
            CampaignType.category,
            func.coalesce(func.sum(CampaignTransaction.amount), 0).label("total_amount"),
            func.count(CampaignTransaction.id).label("txn_count"),
            func.count(House.id.distinct()).label("house_count"),
        ).select_from(CampaignTransaction).join(
            StatementBatch, CampaignTransaction.statement_batch_id == StatementBatch.id
        ).join(
            House, CampaignTransaction.house_id == House.id
        ).join(
            CampaignType, CampaignTransaction.campaign_type_id == CampaignType.id
        ).where(base_condition).group_by(
            CampaignType.id, CampaignType.campaign_name, CampaignType.category
        ).order_by(func.sum(CampaignTransaction.amount).desc())

        result = await self.session.execute(query)
        return [
            CampaignPerformance(
                campaign_type_id=row.id,
                campaign_name=row.campaign_name,
                category=row.category,
                total_amount=Decimal(str(row.total_amount)),
                transaction_count=row.txn_count,
                house_count=row.house_count,
            )
            for row in result
        ]

    async def get_house_performance(self, filters: CommissionFilterRequest) -> List[HousePerformance]:
        base_condition = await self.build_filtered_query(filters)

        query = select(
            House.id,
            House.code,
            House.name,
            func.coalesce(func.sum(CampaignTransaction.amount), 0).label("total_amount"),
            func.count(CampaignTransaction.id).label("txn_count"),
        ).select_from(CampaignTransaction).join(
            StatementBatch, CampaignTransaction.statement_batch_id == StatementBatch.id
        ).join(
            House, CampaignTransaction.house_id == House.id
        ).where(base_condition).group_by(
            House.id, House.code, House.name
        ).order_by(func.sum(CampaignTransaction.amount).desc())

        result = await self.session.execute(query)
        return [
            HousePerformance(
                house_id=row.id,
                house_code=row.code,
                house_name=row.name,
                total_amount=Decimal(str(row.total_amount)),
                transaction_count=row.txn_count,
            )
            for row in result
        ]

    async def get_monthly_trend(self, filters: CommissionFilterRequest, months: int = 12) -> List[dict]:
        from sqlalchemy import extract

        base_condition = await self.build_filtered_query(filters)

        trend_query = select(
            extract("year", StatementBatch.statement_date).label("year"),
            extract("month", StatementBatch.statement_date).label("month"),
            func.coalesce(func.sum(CampaignTransaction.amount), 0).label("campaign_total"),
        ).select_from(CampaignTransaction).join(
            StatementBatch, CampaignTransaction.statement_batch_id == StatementBatch.id
        ).where(base_condition).group_by(
            extract("year", StatementBatch.statement_date),
            extract("month", StatementBatch.statement_date),
        ).order_by(
            extract("year", StatementBatch.statement_date).desc(),
            extract("month", StatementBatch.statement_date).desc(),
        ).limit(months)

        result = await self.session.execute(trend_query)
        return [
            {
                "year": int(row.year),
                "month": int(row.month),
                "campaign_total": str(row.campaign_total),
            }
            for row in result
        ]

    async def get_filter_options(self) -> dict:
        houses_query = select(House.id, House.code, House.name).where(
            House.is_active == True
        ).order_by(House.code)
        house_result = await self.session.execute(houses_query)
        houses = [{"id": r.id, "code": r.code, "name": r.name} for r in house_result]

        campaigns_query = select(CampaignType.id, CampaignType.campaign_name, CampaignType.category).where(
            CampaignType.is_active == True
        ).order_by(CampaignType.category, CampaignType.campaign_name)
        camp_result = await self.session.execute(campaigns_query)
        campaigns = [{"id": r.id, "name": r.campaign_name, "category": r.category} for r in camp_result]

        dates_query = select(
            func.date_trunc("month", StatementBatch.statement_date).label("month")
        ).distinct().order_by(text("month DESC")).limit(24)
        dates_result = await self.session.execute(dates_query)
        available_months = [str(r.month) for r in dates_result if r.month]

        participant_types_query = select(
            CampaignTransaction.participant_type
        ).distinct().where(
            CampaignTransaction.participant_type.isnot(None)
        ).order_by(CampaignTransaction.participant_type)
        pt_result = await self.session.execute(participant_types_query)
        participant_types = [r[0] for r in pt_result]

        return {
            "houses": houses,
            "campaigns": campaigns,
            "available_months": available_months,
            "categories": [
                "distributor_campaign", "rso_campaign",
                "management_incentive", "operations_reimbursement",
            ],
            "participant_types": participant_types or [
                "distributor", "manager", "supervisor", "rso", "bp", "bsp", "rbsp",
            ],
        }


class CommissionImportService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.errors = []

    async def stage_upload(self, rows: List[dict], batch_reference: str) -> CommissionStaging:
        staged = []
        for i, row in enumerate(rows, 1):
            # Build JSON-safe raw_data (date objects not serializable)
            raw = {k: v for k, v in row.items()}
            if "statement_date" in raw and hasattr(raw["statement_date"], "isoformat"):
                raw["statement_date"] = raw["statement_date"].isoformat()

            entry = CommissionStaging(
                batch_reference=batch_reference,
                row_number=i,
                raw_data=raw,
                house_code=row.get("house_code", "") or row.get("dd_code", ""),
                house_name=row.get("house_name") or row.get("distributor_name"),
                statement_date=row.get("statement_date"),
                campaign_name=row.get("campaign_name", ""),
                campaign_category=row.get("campaign_category"),
                participant_type=row.get("participant_type"),
                participant_ref=row.get("participant_ref"),
                participant_name=row.get("participant_name"),
                purpose=row.get("purpose"),
                amount=row.get("amount", 0),
            )
            self.session.add(entry)
            staged.append(entry)

        await self.session.flush()
        return staged

    async def validate_staging(self, batch_reference: str) -> Tuple[int, int]:
        result = await self.session.execute(
            select(CommissionStaging).where(
                CommissionStaging.batch_reference == batch_reference
            ).order_by(CommissionStaging.row_number)
        )
        rows = result.scalars().all()

        valid = 0
        failed = 0

        for row in rows:
            row_errors = []

            if not row.house_code:
                row_errors.append("house_code is required")
            if not row.campaign_name:
                row_errors.append("campaign_name is required")
            if not row.statement_date:
                row_errors.append("statement_date is required")
            if row.amount is None or row.amount < 0:
                row_errors.append("amount must be >= 0")

            existing = await self.session.execute(
                select(CommissionStaging).where(
                    CommissionStaging.batch_reference == batch_reference,
                    CommissionStaging.house_code == row.house_code,
                    CommissionStaging.campaign_name == row.campaign_name,
                    CommissionStaging.statement_date == row.statement_date,
                    CommissionStaging.amount == row.amount,
                    CommissionStaging.id != row.id,
                ).limit(1)
            )
            if existing.scalar_one_or_none():
                row.is_duplicate = True
                row_errors.append("duplicate entry in same batch")

            if row_errors:
                row.validation_status = "failed"
                row.validation_errors = row_errors
                failed += 1
            else:
                row.validation_status = "valid"
                valid += 1

        await self.session.flush()
        return valid, failed

    async def process_to_production(self, batch_reference: str, uploaded_by: int) -> int:
        result = await self.session.execute(
            select(CommissionStaging).where(
                CommissionStaging.batch_reference == batch_reference,
                CommissionStaging.validation_status == "valid",
            ).order_by(CommissionStaging.row_number)
        )
        rows = result.scalars().all()
        if not rows:
            return 0

        processed = 0
        first_date = rows[0].statement_date

        for row in rows:
            house = await self._get_house(row.house_code, row.house_name)
            campaign_type = await self._get_or_create_campaign_type(row.campaign_name, row.campaign_category)

            batch = await self._get_or_create_batch(first_date, house.id, batch_reference, uploaded_by)

            employee = None
            if row.participant_type and row.participant_type != "distributor" and row.participant_ref:
                emp_result = await self.session.execute(
                    select(Employee)
                    .options(joinedload(Employee.user))
                    .where(Employee.employee_id == row.participant_ref)
                    .limit(1)
                )
                employee = emp_result.scalar_one_or_none()

            user_name = employee.user.name if (employee and employee.user) else None
            txn = CampaignTransaction(
                statement_batch_id=batch.id,
                house_id=house.id,
                campaign_type_id=campaign_type.id,
                participant_type=row.participant_type or "distributor",
                participant_ref=row.participant_ref or row.house_code,
                participant_name=row.participant_name or user_name or row.house_name,
                employee_id=employee.id if employee else None,
                purpose=row.purpose,
                amount=row.amount,
                extra_data=row.raw_data,
            )
            self.session.add(txn)
            await self.session.flush()

            processed += 1

        await self.session.flush()

        batch_update = await self.session.get(StatementBatch, batch.id)
        if batch_update:
            batch_update.processed_records = (batch_update.processed_records or 0) + processed
            batch_update.status = "completed"

        await self.refresh_materialized_views()

        return processed

    async def _get_house(self, code: str, name: Optional[str]) -> House:
        result = await self.session.execute(
            select(House).where(House.code == code)
        )
        house = result.scalar_one_or_none()
        if not house:
            house = House(
                code=code,
                name=name or code,
            )
            self.session.add(house)
            await self.session.flush()
        return house

    async def _get_or_create_campaign_type(self, campaign_name: str, category: Optional[str]) -> CampaignType:
        result = await self.session.execute(
            select(CampaignType).where(
                CampaignType.campaign_name == campaign_name,
                CampaignType.category == (category or "distributor_campaign"),
            )
        )
        campaign_type = result.scalar_one_or_none()
        if not campaign_type:
            campaign_type = CampaignType(
                category=category or "distributor_campaign",
                campaign_name=campaign_name,
            )
            self.session.add(campaign_type)
            await self.session.flush()
        return campaign_type

    async def _get_or_create_batch(
        self, statement_date: date, house_id: int, batch_reference: str, uploaded_by: int
    ) -> StatementBatch:
        result = await self.session.execute(
            select(StatementBatch).where(
                StatementBatch.batch_reference == batch_reference
            )
        )
        batch = result.scalar_one_or_none()
        if not batch:
            batch = StatementBatch(
                statement_date=statement_date,
                house_id=house_id,
                batch_reference=batch_reference,
                uploaded_by=uploaded_by,
                total_records=0,
            )
            self.session.add(batch)
            await self.session.flush()
        return batch

    async def refresh_materialized_views(self):
        logger.info("Materialized views not recreated yet")

    async def get_import_report(self, batch_reference: str) -> dict:
        result = await self.session.execute(
            select(CommissionStaging).where(
                CommissionStaging.batch_reference == batch_reference
            ).order_by(CommissionStaging.row_number)
        )
        rows = result.scalars().all()

        return {
            "batch_reference": batch_reference,
            "total_rows": len(rows),
            "valid_rows": sum(1 for r in rows if r.validation_status == "valid"),
            "failed_rows": sum(1 for r in rows if r.validation_status == "failed"),
            "errors": [
                {"row": r.row_number, "errors": r.validation_errors}
                for r in rows if r.validation_errors
            ],
        }
