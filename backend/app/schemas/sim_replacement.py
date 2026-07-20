from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


class SimReplacementCreate(BaseModel):
    house_id: int = Field(..., ge=1)
    retailer_id: Optional[int] = Field(None, ge=1)
    retailer_code: Optional[str] = Field(None, max_length=50)
    retailer_name: Optional[str] = Field(None, max_length=200)
    replacement_reason: str = Field(..., pattern=r"^(Lost|Damaged|Stolen|Network_Issue|Other)$")
    reason_details: Optional[str] = None
    ev_swap_serial: Optional[str] = Field(None, max_length=100)
    priority: Optional[str] = Field("normal", pattern=r"^(low|normal|high|urgent)$")
    notes: Optional[str] = None
    remarks: Optional[str] = None


class SimReplacementBulkItem(BaseModel):
    retailer_id: int = Field(..., ge=1)
    replacement_reason: str = Field(..., pattern=r"^(Lost|Damaged|Stolen|Network_Issue|Other)$")
    reason_details: Optional[str] = None
    ev_swap_serial: Optional[str] = Field(None, max_length=100)
    priority: Optional[str] = Field("normal", pattern=r"^(low|normal|high|urgent)$")
    notes: Optional[str] = None
    remarks: Optional[str] = None


class SimReplacementBulkCreate(BaseModel):
    house_id: int = Field(..., ge=1)
    items: List[SimReplacementBulkItem] = Field(..., min_length=1)


class SimReplacementUpdate(BaseModel):
    replacement_reason: Optional[str] = Field(None, pattern=r"^(Lost|Damaged|Stolen|Network_Issue|Other)$")
    reason_details: Optional[str] = None
    ev_swap_serial: Optional[str] = Field(None, max_length=100)
    priority: Optional[str] = Field(None, pattern=r"^(low|normal|high|urgent)$")
    notes: Optional[str] = None
    remarks: Optional[str] = None


class SimReplacementApprove(BaseModel):
    approval_notes: Optional[str] = None


class SimReplacementIssue(BaseModel):
    new_sim_number: str = Field(..., min_length=1, max_length=100)
    new_msisdn: Optional[str] = Field(None, max_length=20)
    sim_inventory_id: Optional[int] = Field(None, ge=1)
    ev_kit_id: Optional[int] = Field(None, ge=1)


class SimReplacementActivate(BaseModel):
    new_msisdn: Optional[str] = Field(None, max_length=20)


class SimReplacementSchema(BaseModel):
    id: int
    house_id: int
    request_number: str
    retailer_id: Optional[int] = None
    retailer_code: Optional[str] = None
    retailer_name: Optional[str] = None
    retailer_itop: Optional[str] = None
    new_sim_number: Optional[str] = None
    new_msisdn: Optional[str] = None
    replacement_reason: Optional[str] = None
    reason_details: Optional[str] = None
    sim_inventory_id: Optional[int] = None
    ev_kit_id: Optional[int] = None
    request_status: str
    requested_by: int
    requester_name: Optional[str] = None
    requested_at: Optional[datetime] = None
    approved_by: Optional[int] = None
    approver_name: Optional[str] = None
    approved_at: Optional[datetime] = None
    approval_notes: Optional[str] = None
    issued_by: Optional[int] = None
    issuer_name: Optional[str] = None
    issued_at: Optional[datetime] = None
    activated_by: Optional[int] = None
    activator_name: Optional[str] = None
    activated_at: Optional[datetime] = None
    closed_by: Optional[int] = None
    closer_name: Optional[str] = None
    closed_at: Optional[datetime] = None
    old_sim_deactivated: Optional[bool] = False
    old_sim_deactivated_at: Optional[datetime] = None
    ev_kit_returned: Optional[bool] = False
    ev_kit_returned_at: Optional[datetime] = None
    ev_swap_serial: Optional[str] = None
    priority: Optional[str] = "normal"
    notes: Optional[str] = None
    remarks: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class SimReplacementLogSchema(BaseModel):
    id: int
    request_id: int
    action: str
    old_status: Optional[str] = None
    new_status: Optional[str] = None
    performed_by: Optional[int] = None
    performed_by_name: Optional[str] = None
    notes: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True
