from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, date
from decimal import Decimal


class LiftingProductItem(BaseModel):
    product_id: int
    quantity: int = Field(..., ge=1)
    unit_price: float = Field(..., ge=0)


class LiftingProductCreate(BaseModel):
    product_id: int
    quantity: int = Field(..., ge=1)


class LiftingProductSchema(BaseModel):
    id: int
    lifting_record_id: int
    product_id: int
    product_code: str
    product_name: str
    quantity: int
    unit_price: float
    total_price: float
    product: Optional["ProductSchema"] = None

    class Config:
        from_attributes = True


class LiftingRecordBase(BaseModel):
    house_id: int
    lifting_date: date
    payment_method: str = Field(..., pattern="^(Cash|Credit)$")
    total_bank_deposit: float = Field(..., ge=0)
    notes: Optional[str] = None
    deposit_slip: Optional[str] = None
    bank_id: Optional[int] = Field(None, ge=1, le=10)


class LiftingRecordCreate(LiftingRecordBase):
    products: List[LiftingProductCreate] = Field(default_factory=list)


class LiftingRecordUpdate(BaseModel):
    house_id: Optional[int] = None
    lifting_date: Optional[date] = None
    payment_method: Optional[str] = Field(None, pattern="^(Cash|Credit)$")
    total_bank_deposit: Optional[float] = Field(None, ge=0)
    notes: Optional[str] = None
    status: Optional[str] = Field(None, pattern="^(Draft|Confirmed|Approved|Cancelled)$")
    deposit_slip: Optional[str] = None
    bank_id: Optional[int] = Field(None, ge=1, le=10)
    products: Optional[List[LiftingProductCreate]] = None


class LiftingRecordSchema(LiftingRecordBase):
    id: int
    total_lifting_amount: float
    remaining_amount: float
    itopup_amount: float
    status: str
    deposit_slip: Optional[str] = None
    bank_name: Optional[str] = None
    pull_status: Optional[str] = None
    pull_rf_code: Optional[str] = None
    pull_message: Optional[str] = None
    pull_requested_at: Optional[datetime] = None
    pull_completed_at: Optional[datetime] = None
    pull_requested_by: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    house: Optional["HouseSchema"] = None
    products: List[LiftingProductSchema] = []

    class Config:
        from_attributes = True


class LiftingPreviewResponse(BaseModel):
    total_lifting_amount: float
    remaining_amount: float
    itopup_amount: float
    products: List[dict]


class LiftingPullRequest(BaseModel):
    dry_run: bool = False


class LiftingPullStartResponse(BaseModel):
    success: bool = True
    job_id: str
    status: str = "started"
    message: str


class LiftingPullStatusResponse(BaseModel):
    status: str = Field(..., description="running | complete | error | not_found")
    events: List[dict] = Field(default_factory=list)
    message: Optional[str] = None
    result: Optional[dict] = None


class LiftingPullResult(BaseModel):
    outcome: str  # created | blocked_pending | blocked_rejected | dry_run_ok | failed
    message: str
    rf_code: Optional[str] = None
    rf_date: Optional[str] = None
    rf_status: Optional[str] = None
    total_price: Optional[float] = None
    requisition_sum: Optional[float] = None
    dry_run: bool = False


class HouseSchema(BaseModel):
    id: int
    name: str
    code: str
    display_name: str
    show_pull_button: bool = False

    class Config:
        from_attributes = True


class ProductSchema(BaseModel):
    id: int
    product_code: str
    category: str
    subcategory: Optional[str] = None
    product_name: str
    mrp: float
    dd_lifting_price: float
    ret_lifting_price: float
    status: str

    class Config:
        from_attributes = True


LiftingProductSchema.model_rebuild()
LiftingRecordSchema.model_rebuild()