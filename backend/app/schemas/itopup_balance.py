from typing import Optional
from pydantic import BaseModel, Field, field_validator


class ITopUpTransferCreate(BaseModel):
    from_employee_id: Optional[int] = None  # NULL = mother SIM
    to_employee_id: Optional[int] = None    # NULL = mother SIM
    amount: float = Field(..., gt=0)
    movement: str = Field("other", pattern="^(morning|evening|other)$")
    notes: Optional[str] = None


class StockFromLiftingCreate(BaseModel):
    lifting_ids: list[int] = Field(..., min_length=1)
