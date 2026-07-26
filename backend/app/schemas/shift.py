from pydantic import BaseModel
from typing import Optional, List
from datetime import date, time, datetime


class ShiftSchema(BaseModel):
    id: int
    house_id: int
    name: str
    name_bn: Optional[str] = None
    start_time: time
    end_time: time
    grace_period_minutes: int = 15
    min_work_hours: int = 8
    is_active: bool = True

    class Config:
        from_attributes = True


class ShiftCreate(BaseModel):
    house_id: int
    name: str
    name_bn: Optional[str] = None
    start_time: time
    end_time: time
    grace_period_minutes: int = 15
    min_work_hours: int = 8


class EmployeeShiftSchema(BaseModel):
    id: int
    employee_id: int
    shift_id: int
    shift_name: Optional[str] = None
    effective_from: date
    effective_to: Optional[date] = None
    is_active: bool = True

    class Config:
        from_attributes = True


class EmployeeShiftCreate(BaseModel):
    employee_id: int
    shift_id: int
    effective_from: date
    effective_to: Optional[date] = None


class MyShiftResponse(BaseModel):
    shift_id: Optional[int] = None
    shift_name: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    grace_period_minutes: int = 15
