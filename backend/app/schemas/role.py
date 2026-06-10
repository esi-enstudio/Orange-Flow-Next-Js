from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class PermissionSchema(BaseModel):
    id: int
    name: str
    created_at: Optional[datetime] = None
    class Config: from_attributes = True

class PermissionCreate(BaseModel):
    name: str

class RoleSchema(BaseModel):
    id: int
    name: str
    permissions: List[PermissionSchema] = []
    class Config: from_attributes = True

class RoleCreate(BaseModel):
    name: str
    permissions: List[int] = []
