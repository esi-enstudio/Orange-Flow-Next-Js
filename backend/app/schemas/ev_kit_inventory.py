from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class EvKitCreate(BaseModel):
    kit_serial: str = Field(..., min_length=1, max_length=100)
    kit_type: str = Field(..., min_length=1, max_length=50)
    notes: Optional[str] = None


class EvKitUpdate(BaseModel):
    kit_type: Optional[str] = Field(None, min_length=1, max_length=50)
    status: Optional[str] = Field(None, pattern=r"^(available|allocated|used|damaged|lost)$")
    notes: Optional[str] = None


class EvKitAllocate(BaseModel):
    request_id: int = Field(..., ge=1)


class EvKitSchema(BaseModel):
    id: int
    house_id: int
    kit_serial: str
    kit_type: str
    status: str
    allocated_to: Optional[int] = None
    allocated_at: Optional[datetime] = None
    allocated_by: Optional[int] = None
    allocator_name: Optional[str] = None
    request_number: Optional[str] = None
    notes: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
