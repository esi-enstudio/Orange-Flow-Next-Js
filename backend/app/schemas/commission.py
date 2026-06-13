from decimal import Decimal
from datetime import date, datetime
from typing import Optional, List
from pydantic import BaseModel, Field


class CampaignTypeBase(BaseModel):
    category: str
    campaign_name: str = Field(..., max_length=255)
    description: Optional[str] = None
    is_active: bool = True
    valid_from: Optional[date] = None
    valid_to: Optional[date] = None

class CampaignTypeCreate(CampaignTypeBase):
    pass

class CampaignTypeSchema(CampaignTypeBase):
    id: int
    created_at: datetime
    transaction_count: Optional[int] = None

    class Config:
        from_attributes = True


class StatementBatchBase(BaseModel):
    statement_date: date
    house_id: int
    batch_reference: str = Field(..., max_length=100)

class StatementBatchCreate(StatementBatchBase):
    pass

class StatementBatchSchema(StatementBatchBase):
    id: int
    total_records: Optional[int] = 0
    processed_records: Optional[int] = 0
    failed_records: Optional[int] = 0
    status: str
    error_log: Optional[str] = None
    uploaded_by: Optional[int] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class CampaignTransactionBase(BaseModel):
    campaign_type_id: int
    participant_type: str
    participant_ref: str = Field(..., max_length=100)
    participant_name: Optional[str] = None
    purpose: Optional[str] = None
    amount: Decimal = Field(..., ge=0)
    extra_data: Optional[dict] = {}

class CampaignTransactionCreate(CampaignTransactionBase):
    pass

class CampaignTransactionUpdate(BaseModel):
    campaign_type_id: Optional[int] = None
    participant_type: Optional[str] = None
    participant_ref: Optional[str] = Field(None, max_length=100)
    participant_name: Optional[str] = None
    purpose: Optional[str] = None
    amount: Optional[Decimal] = Field(None, ge=0)
    extra_data: Optional[dict] = None

class CampaignTransactionSchema(CampaignTransactionBase):
    id: int
    statement_batch_id: int
    house_id: int
    created_at: datetime
    campaign_type: Optional[CampaignTypeSchema] = None

    class Config:
        from_attributes = True


class DateFilter(BaseModel):
    exact: Optional[date] = None
    from_date: Optional[date] = Field(None, alias="from")
    to_date: Optional[date] = Field(None, alias="to")
    month: Optional[int] = Field(None, ge=1, le=12)
    year: Optional[int] = None

class CommissionFilterRequest(BaseModel):
    date: Optional[DateFilter] = None
    house_ids: Optional[List[int]] = None
    campaign_type_ids: Optional[List[int]] = None
    campaign_category: Optional[str] = None
    participant_type: Optional[str] = None
    search: Optional[str] = Field(None, max_length=200)
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=50, ge=1, le=500)
    sort_by: Optional[str] = "created_at"
    sort_order: Optional[str] = "desc"


class CommissionSummary(BaseModel):
    total_campaign_amount: Decimal = Decimal("0.00")
    transaction_count: int = 0
    house_count: int = 0


class CampaignPerformance(BaseModel):
    campaign_type_id: int
    campaign_name: str
    category: str
    total_amount: Decimal
    transaction_count: int
    house_count: int


class HousePerformance(BaseModel):
    house_id: int
    house_code: str
    house_name: str
    total_amount: Decimal
    transaction_count: int


class PaginatedResponse(BaseModel):
    items: List
    total: int
    page: int
    page_size: int
    total_pages: int
    summary: Optional[CommissionSummary] = None


class CommissionImportResponse(BaseModel):
    batch_reference: str
    total_rows: int
    valid_rows: int
    failed_rows: int
    errors: Optional[List[dict]] = None


class DashboardAnalytics(BaseModel):
    summary: CommissionSummary
    campaign_performance: List[CampaignPerformance]
    house_performance: List[HousePerformance]
    monthly_trend: Optional[List[dict]] = None
