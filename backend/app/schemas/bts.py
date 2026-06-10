from pydantic import BaseModel
from typing import Optional

class BTSSchema(BaseModel):
    id: int
    house_id: int
    site_id: str
    bts_code: str
    site_type: Optional[str]
    thana: Optional[str]
    thana_bn: Optional[str]
    district: Optional[str]
    district_bn: Optional[str]
    division: Optional[str]
    division_bn: Optional[str]
    cluster: Optional[str]
    cluster_bn: Optional[str]
    region: Optional[str]
    region_bn: Optional[str]
    network_mode: Optional[str]
    address: Optional[str]
    address_bn: Optional[str]
    short_address: Optional[str]
    short_address_bn: Optional[str]
    longitude: Optional[str]
    latitude: Optional[str]
    archetype: Optional[str]
    market: Optional[str]
    distributor_code: Optional[str]
    onair_date_2g: Optional[str]
    onair_date_3g: Optional[str]
    onair_date_4g: Optional[str]
    urban_rural: Optional[str]
    priority: Optional[str]
    class Config: from_attributes = True
