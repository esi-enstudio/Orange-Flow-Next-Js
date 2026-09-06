from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field

from app.schemas.pagination import PaginatedResponse


class RetailerMarkingSchema(BaseModel):
    id: int
    name: str
    code: str
    description: Optional[str] = None
    status: str
    created_by: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class RetailerMarkingCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    code: str = Field(min_length=1, max_length=50)
    description: Optional[str] = Field(None, max_length=1000)


class RetailerMarkingUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    code: Optional[str] = Field(None, min_length=1, max_length=50)
    description: Optional[str] = Field(None, max_length=1000)
    status: Optional[str] = Field(None, pattern="^(active|inactive)$")


class AssignmentSchema(BaseModel):
    id: int
    retailer_id: int
    marking_id: int
    marking_name: Optional[str] = None
    marking_code: Optional[str] = None
    status: str
    effective_from: Optional[datetime] = None
    effective_to: Optional[datetime] = None
    assigned_by: Optional[int] = None
    assigned_by_name: Optional[str] = None
    removed_by: Optional[int] = None
    removed_by_name: Optional[str] = None
    assigned_at: Optional[datetime] = None
    removed_at: Optional[datetime] = None
    remarks: Optional[str] = None
    created_at: Optional[datetime] = None
    retailer: Optional[dict] = None

    class Config:
        from_attributes = True


class AssignmentCreate(BaseModel):
    marking_id: int
    retailer_ids: List[int] = Field(min_length=1, max_length=1000)
    remarks: Optional[str] = Field(None, max_length=1000)


class UnassignRequest(BaseModel):
    retailer_ids: List[int] = Field(min_length=1, max_length=1000)
    remarks: Optional[str] = Field(None, max_length=1000)


class HistoryFilterParams:
    def __init__(
        self,
        marking_id: Optional[int] = None,
        retailer_id: Optional[int] = None,
        status: Optional[str] = None,
        search: Optional[str] = None,
        from_date: Optional[datetime] = None,
        to_date: Optional[datetime] = None,
    ):
        self.marking_id = marking_id
        self.retailer_id = retailer_id
        self.status = status
        self.search = search
        self.from_date = from_date
        self.to_date = to_date


class ImportPreviewRow(BaseModel):
    line: int
    retailer_number: str
    retailer_name: str
    marking_name: str
    retailer_id: Optional[int] = None
    valid: bool
    error: Optional[str] = None


class ImportPreviewResponse(BaseModel):
    success: bool = True
    batch_reference: str
    total: int
    valid_count: int
    invalid_count: int
    errors: List[ImportPreviewRow]
    rows: List[ImportPreviewRow]
    new_markings: List[str]


class ImportConfirmRequest(BaseModel):
    batch_reference: str
    remarks: Optional[str] = Field(None, max_length=1000)


class MarkingRetailersResponse(PaginatedResponse):
    pass