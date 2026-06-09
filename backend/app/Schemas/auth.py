from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import datetime
from app.schemas.role import RoleSchema
from app.schemas.house import HouseSchema

class Token(BaseModel):
    access_token: str
    token_type: str

class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone_number: Optional[str] = None
    telegram_id: Optional[int] = None
    password: Optional[str] = None
