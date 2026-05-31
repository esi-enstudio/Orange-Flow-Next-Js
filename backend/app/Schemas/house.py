from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class HouseSchema(BaseModel):
    id: int
    name: str
    code: str
    cluster: Optional[str]
    region: Optional[str]
    wh_region: Optional[str]
    district: Optional[str]
    email: Optional[str]
    address: Optional[str]
    proprietor_name: Optional[str]
    proprietor_contact: Optional[str]
    poc_name: Optional[str]
    poc_mobile: Optional[str]
    lifting_date: Optional[str]
    latitude: Optional[str]
    longitude: Optional[str]
    bts_id: Optional[str]
    dms_user: Optional[str]
    dms_pass: Optional[str]
    dms_house_id: Optional[str]
    is_active: bool
    class Config: from_attributes = True

class HouseCreate(BaseModel):
    name: str
    code: str
    cluster: Optional[str] = None
    region: Optional[str] = None
    wh_region: Optional[str] = None
    district: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    proprietor_name: Optional[str] = None
    proprietor_contact: Optional[str] = None
    poc_name: Optional[str] = None
    poc_mobile: Optional[str] = None
    lifting_date: Optional[str] = None
    latitude: Optional[str] = None
    longitude: Optional[str] = None
    bts_id: Optional[str] = None
    dms_user: Optional[str] = None
    dms_pass: Optional[str] = None
    dms_house_id: Optional[str] = None
    is_active: bool = True
