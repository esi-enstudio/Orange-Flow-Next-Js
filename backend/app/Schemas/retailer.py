from pydantic import BaseModel
from typing import Optional, List
from app.Schemas.house import HouseSchema

class RetailerSchema(BaseModel):
    id: int
    house_id: int
    retailer_code: Optional[str]
    name: str
    type: Optional[str]
    enabled: Optional[str]
    sim_seller: Optional[str]
    tran_mobile_no: Optional[str]
    itop_sr_number: Optional[str]
    itop_number: Optional[str]
    service_point: Optional[str]
    category: Optional[str]
    owner_name: Optional[str]
    contact_no: Optional[str]
    district: Optional[str]
    thana: Optional[str]
    address: Optional[str]
    nid: Optional[str]
    bp_code: Optional[str]
    bp_number: Optional[str]
    dob: Optional[str]
    route: Optional[str]
    house: Optional[HouseSchema] = None
    employee: Optional[dict] = None
    class Config: from_attributes = True

class RetailerCreate(BaseModel):
    house_id: int
    retailer_code: str
    name: str
    type: Optional[str] = None
    enabled: Optional[str] = "Yes"
    sim_seller: Optional[str] = None
    tran_mobile_no: Optional[str] = None
    itop_sr_number: Optional[str] = None
    itop_number: Optional[str] = None
    service_point: Optional[str] = None
    category: Optional[str] = None
    owner_name: Optional[str] = None
    contact_no: Optional[str] = None
    district: Optional[str] = None
    thana: Optional[str] = None
    address: Optional[str] = None
    nid: Optional[str] = None
    bp_code: Optional[str] = None
    bp_number: Optional[str] = None
    dob: Optional[str] = None
    route: Optional[str] = None
