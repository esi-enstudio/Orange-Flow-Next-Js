from pydantic import BaseModel, Field, field_validator
from typing import Optional, List
from datetime import datetime
from app.schemas.user import UserSchema
from app.schemas.house import HouseSchema

class EmployeeSchema(BaseModel):
    id: int
    user_id: Optional[int] = None
    user: Optional[UserSchema] = None
    house_id: int
    house: Optional[HouseSchema] = None
    employee_type: Optional[str] = None
    sr_no: Optional[str] = None
    employee_id: Optional[str] = None
    assisted_retailer_code: Optional[str] = None
    agency_id: Optional[str] = None
    dms_code: Optional[str] = None
    itop_number: Optional[str] = None
    personal_number: Optional[str] = None
    pool_number: Optional[str] = None
    status: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account: Optional[str] = None
    branch_name: Optional[str] = None
    routing_number: Optional[str] = None
    home_town: Optional[str] = None
    emergency_contact_person_name: Optional[str] = None
    emergency_contact_person_number: Optional[str] = None
    emergency_person_relationship: Optional[str] = None
    last_education: Optional[str] = None
    institution_name: Optional[str] = None
    blood_group: Optional[str] = None
    present_address: Optional[str] = None
    permanent_address: Optional[str] = None
    fathers_name: Optional[str] = None
    mothers_name: Optional[str] = None
    religion: Optional[str] = None
    dob: Optional[str] = None
    nid: Optional[str] = None
    previous_company_name: Optional[str] = None
    previous_company_salary: Optional[str] = None
    motor_bike: Optional[str] = None
    bicyle: Optional[str] = None
    driving_license: Optional[str] = None
    joining_date: Optional[str] = None
    resigned_date: Optional[str] = None
    market_type: Optional[str] = None
    salary: Optional[str] = None
    retailer_count: int = 0
    retailer_enabled_count: int = 0
    retailer_disabled_count: int = 0
    class Config: from_attributes = True

class EmployeeCreate(BaseModel):
    user_id: Optional[int] = None
    house_id: int
    employee_type: Optional[str] = None
    sr_no: Optional[str] = None
    assisted_retailer_code: Optional[str] = None
    agency_id: Optional[str] = None
    dms_code: Optional[str] = None
    itop_number: Optional[str] = None
    personal_number: Optional[str] = None
    pool_number: Optional[str] = None
    status: Optional[str] = "Active"
    bank_name: Optional[str] = None
    bank_account: Optional[str] = None
    branch_name: Optional[str] = None
    routing_number: Optional[str] = None
    home_town: Optional[str] = None
    emergency_contact_person_name: Optional[str] = None
    emergency_contact_person_number: Optional[str] = None
    emergency_person_relationship: Optional[str] = None
    last_education: Optional[str] = None
    institution_name: Optional[str] = None
    blood_group: Optional[str] = None
    present_address: Optional[str] = None
    permanent_address: Optional[str] = None
    fathers_name: Optional[str] = None
    mothers_name: Optional[str] = None
    religion: Optional[str] = None
    dob: Optional[str] = None
    nid: Optional[str] = None
    previous_company_name: Optional[str] = None
    previous_company_salary: Optional[str] = None
    motor_bike: Optional[str] = None
    bicyle: Optional[str] = None
    driving_license: Optional[str] = None
    joining_date: Optional[str] = None
    resigned_date: Optional[str] = None
    market_type: Optional[str] = None
    salary: Optional[str] = None

    @field_validator('employee_type')
    @classmethod
    def validate_employee_type(cls, v):
        if v is not None and v not in ("rso", "manager", "supervisor", "bp", "bsp", "rbsp", "cc", "unknown"):
            raise ValueError('employee_type must be one of: rso, manager, supervisor, bp, bsp, rbsp, cc')
        return v

    @field_validator('status')
    @classmethod
    def validate_status(cls, v):
        if v is not None and v not in ("Active", "Resigned", "Suspended", "Inactive"):
            raise ValueError('status must be one of: Active, Resigned, Suspended, Inactive')
        return v

    @field_validator('market_type')
    @classmethod
    def validate_market_type(cls, v):
        if v is not None and v not in ("Urban", "Rural"):
            raise ValueError('market_type must be one of: Urban, Rural')
        return v

    @field_validator('motor_bike', 'bicyle', 'driving_license')
    @classmethod
    def validate_yes_no(cls, v, info):
        if v is not None and v not in ("Yes", "No"):
            raise ValueError(f'{info.field_name} must be one of: Yes, No')
        return v

    @field_validator('dob', 'joining_date', 'resigned_date')
    @classmethod
    def validate_date(cls, v):
        if v:
            try:
                datetime.strptime(v, '%Y-%m-%d')
            except ValueError:
                raise ValueError('Invalid date format, expected YYYY-MM-DD')
        return v

    @field_validator('personal_number', 'itop_number', 'pool_number', 'emergency_contact_person_number')
    @classmethod
    def validate_phone(cls, v):
        if v:
            cleaned = v.strip()
            if len(cleaned) < 3:
                raise ValueError('Phone number must have at least 3 characters')
        return v

class EmployeeSelfUpdate(BaseModel):
    assisted_retailer_code: Optional[str] = None
    agency_id: Optional[str] = None
    itop_number: Optional[str] = None
    personal_number: Optional[str] = None
    pool_number: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account: Optional[str] = None
    branch_name: Optional[str] = None
    routing_number: Optional[str] = None
    home_town: Optional[str] = None
    emergency_contact_person_name: Optional[str] = None
    emergency_contact_person_number: Optional[str] = None
    emergency_person_relationship: Optional[str] = None
    last_education: Optional[str] = None
    institution_name: Optional[str] = None
    blood_group: Optional[str] = None
    present_address: Optional[str] = None
    permanent_address: Optional[str] = None
    fathers_name: Optional[str] = None
    mothers_name: Optional[str] = None
    religion: Optional[str] = None
    dob: Optional[str] = None
    nid: Optional[str] = None
    previous_company_name: Optional[str] = None
    previous_company_salary: Optional[str] = None
    motor_bike: Optional[str] = None
    bicyle: Optional[str] = None
    driving_license: Optional[str] = None
    joining_date: Optional[str] = None
    resigned_date: Optional[str] = None
    market_type: Optional[str] = None
    salary: Optional[str] = None
    sr_no: Optional[str] = None

    @field_validator('market_type')
    @classmethod
    def validate_market_type(cls, v):
        if v is not None and v not in ("Urban", "Rural"):
            raise ValueError('market_type must be one of: Urban, Rural')
        return v

    @field_validator('motor_bike', 'bicyle', 'driving_license')
    @classmethod
    def validate_yes_no(cls, v, info):
        if v is not None and v not in ("Yes", "No"):
            raise ValueError(f'{info.field_name} must be one of: Yes, No')
        return v

    @field_validator('dob', 'joining_date', 'resigned_date')
    @classmethod
    def validate_date(cls, v):
        if v:
            try:
                datetime.strptime(v, '%Y-%m-%d')
            except ValueError:
                raise ValueError('Invalid date format, expected YYYY-MM-DD')
        return v

    @field_validator('personal_number', 'itop_number', 'pool_number', 'emergency_contact_person_number')
    @classmethod
    def validate_phone(cls, v):
        if v:
            cleaned = v.strip()
            if len(cleaned) < 3:
                raise ValueError('Phone number must have at least 3 characters')
        return v

    @field_validator('salary', 'previous_company_salary')
    @classmethod
    def validate_numeric_string(cls, v):
        if v:
            try:
                float(v)
            except ValueError:
                raise ValueError('Field must be a numeric value')
        return v
