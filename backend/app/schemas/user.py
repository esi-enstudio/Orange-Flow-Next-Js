from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import date
from app.schemas.role import RoleSchema
from app.schemas.house import HouseSchema

class UserSchema(BaseModel):
    id: int
    username: Optional[str]
    name: Optional[str]
    email: Optional[str]
    phone_number: Optional[str] = None
    telegram_id: Optional[int] = None
    profile_pic: Optional[str] = None
    status: str
    roles: List[RoleSchema] = []
    houses: List[HouseSchema] = []
    parent_id: Optional[int] = None
    class Config: from_attributes = True

class UserCreate(BaseModel):
    username: str
    password: str
    name: str
    email: Optional[EmailStr] = None
    phone_number: Optional[str] = None
    telegram_id: Optional[int] = None
    role_ids: List[int] = []
    house_ids: List[int] = []
    parent_id: Optional[int] = None

class UserUpdate(BaseModel):
    username: Optional[str] = None
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    phone_number: Optional[str] = None
    telegram_id: Optional[int] = None
    status: Optional[str] = None
    role_ids: Optional[List[int]] = None
    house_ids: Optional[List[int]] = None
    parent_id: Optional[int] = None

class UserFilterParams(BaseModel):
    search: Optional[str] = None
    status: Optional[str] = None
    role_ids: Optional[List[int]] = None
    house_ids: Optional[List[int]] = None
    parent_id: Optional[int] = None
    phone_number: Optional[str] = None
    telegram_id: Optional[str] = None
    has_employee_profile: Optional[bool] = None
    created_from: Optional[date] = None
    created_to: Optional[date] = None
    updated_from: Optional[date] = None
    updated_to: Optional[date] = None
