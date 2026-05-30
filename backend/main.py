import logging
import sys
import asyncio
import os
import shutil
import uuid
import json
from datetime import datetime, timedelta, timezone, date
from logging.handlers import RotatingFileHandler
from typing import List, Optional

# --- Logging Setup ---
if not os.path.exists('logs'): os.makedirs('logs')
log_formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
file_handler = RotatingFileHandler('logs/orange_flow.log', maxBytes=10*1024*1024, backupCount=5, encoding='utf-8')
file_handler.setFormatter(log_formatter)
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setFormatter(log_formatter)
logging.basicConfig(level=logging.INFO, handlers=[file_handler, console_handler])
logger = logging.getLogger(__name__)

# Rate limiter for login
LOGIN_RATE_LIMIT = 5
LOGIN_WINDOW_SECONDS = 300
login_attempts: dict = {}

def check_login_rate_limit(ip: str):
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(seconds=LOGIN_WINDOW_SECONDS)
    if ip in login_attempts:
        login_attempts[ip] = [t for t in login_attempts[ip] if t > window_start]
        if len(login_attempts[ip]) >= LOGIN_RATE_LIMIT:
            raise HTTPException(status_code=429, detail="Too many login attempts. Please try again later.")
    else:
        login_attempts[ip] = []
    login_attempts[ip].append(now)

from fastapi import FastAPI, Depends, HTTPException, Query, status, File, UploadFile, Form, Header, Response, Request
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext
import uvicorn
from pydantic import BaseModel, EmailStr, field_validator, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload
from fastapi.staticfiles import StaticFiles
from PIL import Image
import io

# Project Imports
from config.settings import settings
from app.Services.db_service import init_db, async_session
from app.Models.retailer import Retailer
from app.Models.house import House
from app.Models.bts import BTS
from app.Models.employee import Employee
from app.Models.user import User
from app.Models.role import Role, Permission
from app.Core.automation_engine import engine

# Service & Controller Imports
from app.Services.Automation.Reports.ga_live import run_ga_live_sync, reset_daily_activations
from app.Services.Automation.dms_report_excel import cleanup_old_dms_reports
from app.Services.Automation.dms_sync_service import run_daily_auto_sync
from app.Services.Automation.retailer_excel import process_retailer_excel, export_retailers_excel
from app.Services.Automation.user_excel import process_user_excel, export_users_excel
from app.Services.Automation.employee_excel import process_employee_excel, export_employees_excel
from app.Services.Automation.bts_excel import process_bts_excel, export_bts_excel
from app.Services.Automation.activation_excel import process_activation_excel, export_activations_excel
from app.Services.Automation.dms_report_excel import process_dms_report_excel
from app.Utils.validation import safe_filename, validate_excel, validate_image, MAX_FILE_SIZE
from app.Services.Automation.dms_report_excel import export_itopup_details_excel
from app.Services.Automation.live_activation_excel import process_live_activation_excel, export_live_activations_excel
from app.Services.Automation.issue_reports_excel import process_scratch_card_excel, process_sim_issue_excel, export_scratch_card_excel, export_sim_issue_excel
from app.Services.Automation.target_excel import process_target_excel_unified, export_house_targets_excel, export_supervisor_targets_excel, export_rso_targets_excel
from app.Models.activation import Activation
from app.Models.live_activation import LiveActivation
from app.Models.scratch_card_issue import ScratchCardIssue
from app.Models.sim_issue import SimIssue
from app.Models.ga_filter import FilterTag, RetailerFilter
from app.Models.house_target import HouseTarget
from app.Models.supervisor_target import SupervisorTarget
from app.Models.rso_target import RSOTarget
from app.Models.itopup_detail import ITopUpDetail
from app.Core.session_manager import session_manager
from app.Controllers import (
    admin_controller, admin_setup_controller
)

# ==========================================
# 1. FASTAPI SETUP & SCHEMAS
# ==========================================

app = FastAPI(title="OrangeFlow Management API")

# Ensure uploads directory exists
if not os.path.exists('uploads/profile_pics'):
    os.makedirs('uploads/profile_pics')

# Mount static files to serve images
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

# Register Admin Setup Router to FastAPI
app.include_router(admin_setup_controller.router, prefix="/api")
app.include_router(admin_controller.router, prefix="/api")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    return response

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

class ProfileUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone_number: Optional[str] = None
    telegram_id: Optional[int] = None
    password: Optional[str] = None

class Token(BaseModel):
    access_token: str
    token_type: str

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

class EmployeeSchema(BaseModel):
    id: int
    user_id: Optional[int] = None
    user: Optional[UserSchema] = None
    house_id: int
    house: Optional[HouseSchema] = None
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
    class Config: from_attributes = True

class EmployeeCreate(BaseModel):
    user_id: Optional[int] = None
    house_id: int
    assisted_retailer_code: Optional[str] = None
    agency_id: Optional[str] = None
    dms_code: str = Field(min_length=1)
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

    @field_validator('status')
    @classmethod
    def validate_status(cls, v):
        if v is not None and v not in ("Active", "Resigned", "Suspended"):
            raise ValueError('status must be one of: Active, Resigned, Suspended')
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

class FilterTagSchema(BaseModel):
    id: int
    house_id: int
    name: str
    created_at: Optional[datetime] = None
    class Config: from_attributes = True

class FilterTagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    house_id: Optional[int] = None

class RetailerFilterSchema(BaseModel):
    id: int
    house_id: int
    retailer_id: int
    tag: Optional[str] = None
    created_at: Optional[datetime] = None
    retailer: Optional[dict] = None
    class Config: from_attributes = True

class RetailerFilterCreate(BaseModel):
    retailer_id: int
    tag: Optional[str] = None

class RetailerFilterBulkCreate(BaseModel):
    retailer_ids: List[int]
    tag: Optional[str] = None

class ActivationReportSchema(BaseModel):
    total_activations: int
    excluded_count: int
    filtered_total: int
    data: List[dict]
    excluded_tags: List[str] = []

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

# ==========================================
# 2. AUTH HELPERS & DEPENDENCIES
# ==========================================

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login")

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

async def get_db():
    async with async_session() as session:
        yield session

async def get_current_user(token: str = Depends(oauth2_scheme), db: AsyncSession = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id_str: str = payload.get("sub")
        if user_id_str is None:
            raise credentials_exception
        user_id = int(user_id_str)
    except (JWTError, ValueError):
        raise credentials_exception
    
    # Load user with roles (and their permissions) and houses
    result = await db.execute(
        select(User).options(
            selectinload(User.roles).selectinload(Role.permissions),
            selectinload(User.houses)
        ).where(User.id == user_id)
    )
    user = result.unique().scalar_one_or_none()
    if user is None:
        raise credentials_exception
    return user

async def get_house_context(
    x_house_id: Optional[int] = Header(None, alias="X-House-ID"),
    current_user: User = Depends(get_current_user)
):
    """
    Returns the house ID from headers if valid and accessible by the user.
    Admins/Super Admins see everything by default, but can filter by house if provided.
    """
    is_admin = any(r.name.lower() in ["admin", "super admin", "super_admin", "manager", "house manager", "house_manager"] for r in current_user.roles)

    if not x_house_id:
        return None

    if is_admin:
        return x_house_id

    # Check if user has access to this house
    user_house_ids = [h.id for h in current_user.houses]

    if x_house_id not in user_house_ids:
        raise HTTPException(status_code=403, detail="You do not have access to this house context")

    return x_house_id
def has_any_permission(permissions: List[str]):
    async def permission_dependency(current_user: User = Depends(get_current_user)):
        user_permissions = set()
        for role in current_user.roles:
            if role.name.lower() in ["admin", "super admin", "super_admin", "manager", "house manager", "house_manager"]:
                return current_user
 
            for perm in role.permissions:
                user_permissions.add(perm.name)
        
        if any(p in user_permissions for p in permissions):
            return current_user
            
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="আপনার এই কাজটি করার অনুমতি নেই।"
        )
    return permission_dependency

def has_permission(required_permission: str):
    return has_any_permission([required_permission])

# ==========================================
# 3. API ENDPOINTS
# ==========================================

@app.get("/")
async def root():
    return {"message": "OrangeFlow API is running"}

# --- Auth ---
@app.post("/api/auth/register", response_model=UserSchema)
async def register(user_data: UserCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("create_users"))):
    existing_user = (await db.execute(select(User).where((User.username == user_data.username) | (User.email == user_data.email)))).scalar_one_or_none()
    if existing_user:
        raise HTTPException(status_code=400, detail="Username or Email already registered")
    
    new_user = User(
        username=user_data.username,
        hashed_password=get_password_hash(user_data.password),
        name=user_data.name,
        email=user_data.email,
        phone_number=user_data.phone_number,
        telegram_id=user_data.telegram_id,
        parent_id=user_data.parent_id,
        status="Active"
    )
    
    # Assign Roles
    if user_data.role_ids:
        roles_res = await db.execute(select(Role).where(Role.id.in_(user_data.role_ids)))
        new_user.roles = roles_res.scalars().all()
        
    # Assign Houses
    if user_data.house_ids:
        houses_res = await db.execute(select(House).where(House.id.in_(user_data.house_ids)))
        new_user.houses = houses_res.scalars().all()

    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    
    # Auto-create Employee record if user has Supervisor role
    for role in new_user.roles:
        if "supervisor" in role.name.lower():
            existing_emp = (await db.execute(select(Employee).where(Employee.user_id == new_user.id))).scalar_one_or_none()
            if not existing_emp:
                first_house = new_user.houses[0] if new_user.houses else (await db.execute(select(House).limit(1))).scalar_one_or_none()
                if first_house:
                    emp = Employee(
                        user_id=new_user.id,
                        house_id=first_house.id,
                        dms_code=f"SUP-{new_user.id}",
                        type="Supervisor",
                        status="Active"
                    )
                    db.add(emp)
                    await db.commit()
            break
    
    return new_user

@app.post("/api/auth/login", response_model=Token)
async def login(request: Request, form_data: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)):
    client_ip = request.client.host if request.client else "unknown"
    check_login_rate_limit(client_ip)
    result = await db.execute(select(User).where(User.username == form_data.username))
    user = result.scalar_one_or_none()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect username or password")
    
    access_token = create_access_token(data={"sub": str(user.id)})
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/api/auth/me", response_model=UserSchema)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user

@app.put("/api/auth/profile", response_model=UserSchema)
async def update_profile(
    profile_data: ProfileUpdate, 
    db: AsyncSession = Depends(get_db), 
    current_user: User = Depends(get_current_user)
):
    if profile_data.name is not None: current_user.name = profile_data.name
    if profile_data.email is not None: current_user.email = profile_data.email
    if profile_data.phone_number is not None: current_user.phone_number = profile_data.phone_number
    if profile_data.telegram_id is not None: current_user.telegram_id = profile_data.telegram_id
    
    if profile_data.password:
        current_user.hashed_password = get_password_hash(profile_data.password)
        
    await db.commit()
    await db.refresh(current_user)
    return current_user

@app.post("/api/auth/profile-pic")
async def upload_profile_pic(
    file: UploadFile = File(...), 
    db: AsyncSession = Depends(get_db), 
    current_user: User = Depends(get_current_user)
):
    filename = file.filename or "image.jpg"
    if not validate_image(filename):
        raise HTTPException(status_code=400, detail="Invalid file type. Only JPG, JPEG, and PNG files are allowed.")
    
    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large. Maximum size is 50 MB.")
    
    image = Image.open(io.BytesIO(contents))
    
    if image.mode in ("RGBA", "P"):
        image = image.convert("RGB")
    
    max_size = (800, 800)
    image.thumbnail(max_size, Image.Resampling.LANCZOS)
    
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=85, optimize=True)
    
    file_name = f"{uuid.uuid4()}.jpg"
    file_path = f"uploads/profile_pics/{file_name}"
    
    with open(file_path, "wb") as f:
        f.write(buffer.getvalue())
    
    if current_user.profile_pic:
        old_path = current_user.profile_pic
        if old_path.startswith('/'):
            old_path = old_path[1:]
        if os.path.exists(old_path):
            try:
                os.remove(old_path)
            except OSError:
                logger.warning(f"Failed to delete old profile pic: {old_path}")
        
    current_user.profile_pic = f"/uploads/profile_pics/{file_name}"
    await db.commit()
    await db.refresh(current_user)
    
    return {"url": current_user.profile_pic}

# --- Houses ---
@app.get("/api/houses", response_model=List[HouseSchema])
async def list_houses(db: AsyncSession = Depends(get_db), current_user: User = Depends(has_any_permission(["view_houses", "view_users", "edit_users"]))):
    # সুপার এডমিন বা এডমিন হলে সব হাউজ দেখতে পারবে
    is_admin = any(r.name.lower() in ["admin", "super admin", "super_admin", "manager", "house manager", "house_manager"] for r in current_user.roles)
    
    if is_admin:
        result = await db.execute(select(House).order_by(House.name))
        return result.scalars().all()
    
    # সাধারণ ইউজারদের জন্য শুধুমাত্র তাদের অ্যাসাইন করা হাউজগুলো দেখানো হবে
    return current_user.houses

@app.post("/api/houses", response_model=HouseSchema)
async def create_house(house_data: HouseCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("create_houses"))):
    existing = (await db.execute(select(House).where(House.code == house_data.code))).scalar_one_or_none()
    if existing: raise HTTPException(status_code=400, detail="House with this code already exists")
    new_house = House(**house_data.model_dump())
    db.add(new_house)
    await db.commit()
    await db.refresh(new_house)
    return new_house

@app.put("/api/houses/{house_id}", response_model=HouseSchema)
async def update_house(house_id: int, house_data: HouseCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("edit_houses"))):
    result = await db.execute(select(House).where(House.id == house_id))
    house = result.scalar_one_or_none()
    if not house: raise HTTPException(status_code=404, detail="House not found")
    
    # Check access
    is_admin = any(r.name.lower() in ["admin", "super admin", "super_admin", "manager", "house manager", "house_manager"] for r in current_user.roles)
    user_house_ids = [h.id for h in current_user.houses]
    if not is_admin and house_id not in user_house_ids:
        raise HTTPException(status_code=403, detail="You do not have access to edit this house")
        
    for key, value in house_data.model_dump().items():
        setattr(house, key, value)
    await db.commit()
    await db.refresh(house)
    return house

@app.delete("/api/houses/{house_id}")
async def delete_house(house_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("delete_houses"))):
    result = await db.execute(select(House).where(House.id == house_id))
    house = result.scalar_one_or_none()
    if not house: raise HTTPException(status_code=404, detail="House not found")
    await db.delete(house)
    await db.commit()
    return {"message": "House deleted successfully"}

# --- Employees ---
@app.get("/api/employees", response_model=List[EmployeeSchema])
async def list_employees(
    search: Optional[str] = None, 
    db: AsyncSession = Depends(get_db), 
    current_user: User = Depends(has_permission("view_employees")),
    house_id: Optional[int] = Depends(get_house_context)
):
    query = select(Employee).options(joinedload(Employee.house), joinedload(Employee.user).selectinload(User.roles))
    is_admin = any(r.name.lower() in ["admin", "super admin", "super_admin", "manager", "house manager", "house_manager"] for r in current_user.roles)

    if house_id:
        query = query.where(Employee.house_id == house_id)
    elif is_admin:
        pass
    else:
        # Combined view for all assigned houses
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            query = query.where(Employee.house_id.in_(user_house_ids))
        else:
            query = query.where(Employee.house_id == -1)
        
    if search:
        search_pattern = f"%{search}%"
        query = query.where(
            (Employee.dms_code.ilike(search_pattern)) | 
            (Employee.itop_number.ilike(search_pattern))
        )
    result = await db.execute(query.order_by(Employee.id.desc()))
    return result.unique().scalars().all()

@app.post("/api/employees/import")
async def import_employees(
    file: UploadFile = File(...), 
    house_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db), 
    current_user: User = Depends(has_permission("import_employees"))
):
    if not os.path.exists("temp_downloads"): os.makedirs("temp_downloads")
    filename = file.filename or "upload.xlsx"
    if not validate_excel(filename):
        raise HTTPException(status_code=400, detail="Invalid file type. Only .xlsx and .xls files are allowed.")
    file_path = f"temp_downloads/{safe_filename(filename)}"
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        target_house_id = house_id
        
        count, error = await process_employee_excel(file_path, target_house_id)
        if error: raise HTTPException(status_code=400, detail=error)
        return {"message": f"Successfully imported {count} employees", "count": count}
    finally:
        if os.path.exists(file_path): os.remove(file_path)

@app.get("/api/employees/export")
async def export_employees(
    db: AsyncSession = Depends(get_db), 
    current_user: User = Depends(has_permission("export_employees")),
    house_id: Optional[int] = Depends(get_house_context)
):
    query = select(Employee).options(joinedload(Employee.user))
    is_admin = any(r.name.lower() in ["admin", "super admin", "super_admin", "manager", "house manager", "house_manager"] for r in current_user.roles)

    if house_id:
        query = query.where(Employee.house_id == house_id)
    elif not is_admin:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            query = query.where(Employee.house_id.in_(user_house_ids))
        else:
            query = query.where(Employee.house_id == -1)
            
    result = await db.execute(query.order_by(Employee.id.desc()))
    employees = result.unique().scalars().all()
    
    excel_data = await export_employees_excel(employees)
    
    return Response(
        content=excel_data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=employees_export.xlsx"}
    )

@app.post("/api/employees", response_model=EmployeeSchema)
async def create_employee(emp_data: EmployeeCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("create_employees"))):
    # Validate house exists
    house = await db.get(House, emp_data.house_id)
    if not house:
        raise HTTPException(status_code=422, detail=[{"loc": ["body", "house_id"], "msg": "House not found", "type": "value_error"}])
    if emp_data.dms_code:
        existing = (await db.execute(select(Employee).where(Employee.dms_code == emp_data.dms_code))).scalar_one_or_none()
        if existing: raise HTTPException(status_code=422, detail=[{"loc": ["body", "dms_code"], "msg": "Employee with this DMS code already exists", "type": "value_error"}])
    if emp_data.user_id:
        user = await db.get(User, emp_data.user_id)
        if not user:
            raise HTTPException(status_code=422, detail=[{"loc": ["body", "user_id"], "msg": "User not found", "type": "value_error"}])
    new_emp = Employee(**emp_data.model_dump())
    db.add(new_emp)
    await db.commit()
    await db.refresh(new_emp)
    result = await db.execute(
        select(Employee)
        .options(joinedload(Employee.house), joinedload(Employee.user).selectinload(User.roles))
        .where(Employee.id == new_emp.id)
    )
    return result.unique().scalar_one()

@app.get("/api/employees/me", response_model=EmployeeSchema)
async def get_my_employee_profile(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(
        select(Employee)
        .options(joinedload(Employee.house), joinedload(Employee.user).selectinload(User.roles))
        .where(Employee.user_id == current_user.id)
    )
    emp = result.unique().scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=404, detail="No employee profile found")
    return emp

@app.put("/api/employees/me", response_model=EmployeeSchema)
async def update_my_employee_profile(emp_data: EmployeeSelfUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(
        select(Employee)
        .options(joinedload(Employee.house), joinedload(Employee.user).selectinload(User.roles))
        .where(Employee.user_id == current_user.id)
    )
    emp = result.unique().scalar_one_or_none()
    if not emp:
        raise HTTPException(status_code=404, detail="No employee profile found")
    for key, value in emp_data.model_dump(exclude_unset=True).items():
        setattr(emp, key, value)
    await db.commit()
    await db.refresh(emp)
    result = await db.execute(
        select(Employee)
        .options(joinedload(Employee.house), joinedload(Employee.user).selectinload(User.roles))
        .where(Employee.id == emp.id)
    )
    return result.unique().scalar_one()

@app.put("/api/employees/{emp_id}", response_model=EmployeeSchema)
async def update_employee(emp_id: int, emp_data: EmployeeCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("edit_employees"))):
    result = await db.execute(select(Employee).where(Employee.id == emp_id))
    emp = result.scalar_one_or_none()
    if not emp: raise HTTPException(status_code=404, detail="Employee not found")
    # Validate house exists
    house = await db.get(House, emp_data.house_id)
    if not house:
        raise HTTPException(status_code=422, detail=[{"loc": ["body", "house_id"], "msg": "House not found", "type": "value_error"}])
    if emp_data.dms_code != emp.dms_code:
        existing = (await db.execute(select(Employee).where(Employee.dms_code == emp_data.dms_code))).scalar_one_or_none()
        if existing: raise HTTPException(status_code=422, detail=[{"loc": ["body", "dms_code"], "msg": "DMS code already in use by another employee", "type": "value_error"}])
    if emp_data.user_id:
        user = await db.get(User, emp_data.user_id)
        if not user:
            raise HTTPException(status_code=422, detail=[{"loc": ["body", "user_id"], "msg": "User not found", "type": "value_error"}])
    for key, value in emp_data.model_dump().items():
        setattr(emp, key, value)
    await db.commit()
    await db.refresh(emp)
    result = await db.execute(
        select(Employee)
        .options(joinedload(Employee.house), joinedload(Employee.user).selectinload(User.roles))
        .where(Employee.id == emp.id)
    )
    return result.unique().scalar_one()

@app.delete("/api/employees/{emp_id}")
async def delete_employee(emp_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("delete_employees"))):
    result = await db.execute(select(Employee).where(Employee.id == emp_id))
    emp = result.scalar_one_or_none()
    if not emp: raise HTTPException(status_code=404, detail="Employee member not found")
    await db.delete(emp)
    await db.commit()
    return {"message": "Employee member deleted successfully"}

# --- User API Endpoints ---
@app.post("/api/users/import")
async def import_users(file: UploadFile = File(...), db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("import_users"))):
    if not os.path.exists("temp_downloads"): os.makedirs("temp_downloads")
    filename = file.filename or "upload.xlsx"
    if not validate_excel(filename):
        raise HTTPException(status_code=400, detail="Invalid file type. Only .xlsx and .xls files are allowed.")
    file_path = f"temp_downloads/{safe_filename(filename)}"
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        success, errors, error_msg = await process_user_excel(file_path)
        if error_msg: raise HTTPException(status_code=400, detail=error_msg)
        return {
            "message": f"Successfully imported {success} users. Failed: {errors}",
            "success_count": success,
            "error_count": errors
        }
    finally:
        if os.path.exists(file_path): os.remove(file_path)

@app.get("/api/users", response_model=List[UserSchema])
async def list_users(
    db: AsyncSession = Depends(get_db), 
    current_user: User = Depends(has_permission("view_users")),
    house_id: Optional[int] = Depends(get_house_context),
    unassigned: bool = False
):
    query = select(User).options(joinedload(User.roles), joinedload(User.houses))
    
    # সুপার এডমিন বা এডমিন হলে সব ইউজার দেখতে পারবে
    is_admin = any(r.name.lower() in ["admin", "super admin", "super_admin", "manager", "house manager", "house_manager"] for r in current_user.roles)
    
    if house_id:
        # নির্দিষ্ট হাউজের মেম্বারদের দেখানো হবে
        query = query.join(User.houses).where(House.id == house_id)
    elif is_admin:
        pass
    else:
        # Combined view for all assigned houses
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            query = query.join(User.houses).where(House.id.in_(user_house_ids))
        else:
            query = query.join(User.houses).where(House.id == -1)
    
    if unassigned:
        subq = select(Employee.user_id).where(Employee.user_id.isnot(None))
        query = query.where(~User.id.in_(subq))
        
    result = await db.execute(query.order_by(User.id.desc()))
    return result.unique().scalars().all()

from fastapi.staticfiles import StaticFiles
from PIL import Image
import io

# ... existing imports ...

@app.get("/api/users/export")
async def export_users(db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("export_users"))):
    query = select(User).options(joinedload(User.roles), joinedload(User.houses))
    result = await db.execute(query.order_by(User.id.desc()))
    users = result.unique().scalars().all()
    
    excel_data = await export_users_excel(users)
    
    return Response(
        content=excel_data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=users_export.xlsx"}
    )

@app.put("/api/users/{user_id}", response_model=UserSchema)
async def update_user(
    user_id: int, 
    user_data: UserUpdate, 
    db: AsyncSession = Depends(get_db), 
    current_user: User = Depends(has_permission("edit_users"))
):
    result = await db.execute(
        select(User).options(selectinload(User.roles), selectinload(User.houses))
        .where(User.id == user_id)
    )
    user = result.unique().scalar_one_or_none()
    if not user: raise HTTPException(status_code=404, detail="User not found")
    
    # Update basic fields
    if user_data.username is not None and user_data.username != user.username:
        # Check if new username is already taken
        existing = await db.execute(select(User).where(User.username == user_data.username))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Username already taken")
        user.username = user_data.username

    if user_data.name is not None: user.name = user_data.name
    if user_data.email is not None: user.email = user_data.email
    if user_data.phone_number is not None: user.phone_number = user_data.phone_number
    if user_data.telegram_id is not None: user.telegram_id = user_data.telegram_id
    if user_data.status is not None: user.status = user_data.status
    if user_data.parent_id is not None: user.parent_id = user_data.parent_id
    
    # Update password if provided
    if user_data.password:
        user.hashed_password = get_password_hash(user_data.password)
        
    # Update roles
    if user_data.role_ids is not None:
        roles_result = await db.execute(select(Role).where(Role.id.in_(user_data.role_ids)))
        user.roles = list(roles_result.scalars().all())
        
    # Update houses
    if user_data.house_ids is not None:
        houses_result = await db.execute(select(House).where(House.id.in_(user_data.house_ids)))
        user.houses = list(houses_result.scalars().all())
        
    await db.commit()
    await db.refresh(user)
    
    # Auto-create Employee record if user has Supervisor role
    for role in user.roles:
        if "supervisor" in role.name.lower():
            existing_emp = (await db.execute(select(Employee).where(Employee.user_id == user.id))).scalar_one_or_none()
            if not existing_emp:
                first_house = user.houses[0] if user.houses else (await db.execute(select(House).limit(1))).scalar_one_or_none()
                if first_house:
                    emp = Employee(
                        user_id=user.id,
                        house_id=first_house.id,
                        dms_code=f"SUP-{user.id}",
                        type="Supervisor",
                        status="Active"
                    )
                    db.add(emp)
                    await db.commit()
            break
    
    return user

@app.delete("/api/users/{user_id}")
async def delete_user(user_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("delete_users"))):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user: raise HTTPException(status_code=404, detail="User not found")
    await db.delete(user)
    await db.commit()
    return {"message": "User deleted successfully"}

# --- Roles & Permissions ---
@app.get("/api/permissions", response_model=List[PermissionSchema])
async def list_permissions(db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("view_permissions"))):
    result = await db.execute(select(Permission).order_by(Permission.name))
    return result.scalars().all()

@app.post("/api/permissions", response_model=PermissionSchema)
async def create_permission(perm_data: PermissionCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("create_permissions"))):
    existing = (await db.execute(select(Permission).where(Permission.name == perm_data.name))).scalar_one_or_none()
    if existing: raise HTTPException(status_code=400, detail="Permission already exists")
    new_perm = Permission(name=perm_data.name)
    db.add(new_perm)
    await db.commit()
    await db.refresh(new_perm)
    return new_perm

@app.delete("/api/permissions/{perm_id}")
async def delete_permission(perm_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("delete_permissions"))):
    result = await db.execute(select(Permission).where(Permission.id == perm_id))
    perm = result.scalar_one_or_none()
    if not perm: raise HTTPException(status_code=404, detail="Permission not found")
    await db.delete(perm)
    await db.commit()
    return {"message": "Permission deleted successfully"}

@app.get("/api/roles", response_model=List[RoleSchema])
async def list_roles(db: AsyncSession = Depends(get_db), current_user: User = Depends(has_any_permission(["view_roles", "view_users", "edit_users"]))):
    result = await db.execute(select(Role).order_by(Role.id))
    return result.scalars().all()

@app.post("/api/roles", response_model=RoleSchema)
async def create_role(role_data: RoleCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("create_roles"))):
    existing = (await db.execute(select(Role).where(Role.name == role_data.name))).scalar_one_or_none()
    if existing: raise HTTPException(status_code=400, detail="Role already exists")
    new_role = Role(name=role_data.name)
    if role_data.permissions:
        perms = await db.execute(select(Permission).where(Permission.id.in_(role_data.permissions)))
        new_role.permissions = perms.scalars().all()
    db.add(new_role)
    await db.commit()
    await db.refresh(new_role)
    return new_role

@app.put("/api/roles/{role_id}", response_model=RoleSchema)
async def update_role(role_id: int, role_data: RoleCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("edit_roles"))):
    result = await db.execute(select(Role).where(Role.id == role_id))
    role = result.scalar_one_or_none()
    if not role: raise HTTPException(status_code=404, detail="Role not found")
    role.name = role_data.name
    perms = await db.execute(select(Permission).where(Permission.id.in_(role_data.permissions)))
    role.permissions = perms.scalars().all()
    await db.commit()
    await db.refresh(role)
    return role

@app.delete("/api/roles/{role_id}")
async def delete_role(role_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("delete_roles"))):
    result = await db.execute(select(Role).where(Role.id == role_id))
    role = result.scalar_one_or_none()
    if not role: raise HTTPException(status_code=404, detail="Role not found")
    
    # সুপার এডমিন রোল ডিলিট করা যাবে না
    if role.name.lower() == "super admin":
        raise HTTPException(status_code=400, detail="Super Admin role cannot be deleted")
        
    await db.delete(role)
    await db.commit()
    return {"message": "Role deleted successfully"}

# --- Stats, Retailers & BTS ---
@app.get("/api/stats")
async def get_stats(
    db: AsyncSession = Depends(get_db), 
    current_user: User = Depends(has_permission("view_reports")),
    house_id: Optional[int] = Depends(get_house_context)
):
    retailer_query = select(func.count()).select_from(Retailer)
    house_query = select(func.count()).select_from(House)
    bts_query = select(func.count()).select_from(BTS)
    emp_query = select(func.count()).select_from(Employee)
    
    is_admin = any(r.name.lower() in ["admin", "super admin", "super_admin", "manager", "house manager", "house_manager"] for r in current_user.roles)
    
    if house_id:
        retailer_query = retailer_query.where(Retailer.house_id == house_id)
        emp_query = emp_query.where(Employee.house_id == house_id)
        house_query = house_query.where(House.id == house_id)
        bts_query = bts_query.where(BTS.house_id == house_id)
    elif is_admin:
        pass
    else:
        # Combined view for all assigned houses
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            retailer_query = retailer_query.where(Retailer.house_id.in_(user_house_ids))
            emp_query = emp_query.where(Employee.house_id.in_(user_house_ids))
            house_query = house_query.where(House.id.in_(user_house_ids))
            bts_query = bts_query.where(BTS.house_id.in_(user_house_ids))
        else:
            retailer_query = retailer_query.where(Retailer.house_id == -1)
            emp_query = emp_query.where(Employee.house_id == -1)
            house_query = house_query.where(House.id == -1)
            bts_query = bts_query.where(BTS.house_id == -1)
    
    retailer_count = (await db.execute(retailer_query)).scalar()
    house_count = (await db.execute(house_query)).scalar()
    bts_count = (await db.execute(bts_query)).scalar()
    emp_count = (await db.execute(emp_query)).scalar()
    
    return {
        "total_retailers": retailer_count,
        "total_houses": house_count,
        "total_bts": bts_count,
        "total_employees": emp_count,
        "active_users": 12, # Placeholder
        "today_activations": 45, # Placeholder
    }

@app.post("/api/retailers/import")
async def import_retailers(file: UploadFile = File(...), db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("import_retailers"))):
    if not os.path.exists("temp_downloads"): os.makedirs("temp_downloads")
    filename = file.filename or "upload.xlsx"
    if not validate_excel(filename):
        raise HTTPException(status_code=400, detail="Invalid file type. Only .xlsx and .xls files are allowed.")
    file_path = f"temp_downloads/{safe_filename(filename)}"
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        count, error = await process_retailer_excel(file_path)
        if error: raise HTTPException(status_code=400, detail=error)
        return {"message": f"Successfully imported {count} retailers", "count": count}
    finally:
        if os.path.exists(file_path): os.remove(file_path)

@app.get("/api/retailers/export")
async def export_retailers(
    db: AsyncSession = Depends(get_db), 
    current_user: User = Depends(has_permission("export_retailers")),
    house_id: Optional[int] = Depends(get_house_context)
):
    query = select(Retailer).options(
        joinedload(Retailer.house), 
        joinedload(Retailer.employee).selectinload(Employee.user)
    )
    is_admin = any(r.name.lower() in ["admin", "super admin", "super_admin", "manager", "house manager", "house_manager"] for r in current_user.roles)

    if house_id:
        query = query.where(Retailer.house_id == house_id)
    elif not is_admin:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            query = query.where(Retailer.house_id.in_(user_house_ids))
        else:
            query = query.where(Retailer.house_id == -1)
            
    result = await db.execute(query.order_by(Retailer.id.desc()))
    retailers = result.unique().scalars().all()
    
    excel_data = await export_retailers_excel(retailers)
    
    return Response(
        content=excel_data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=retailers_export.xlsx"}
    )

@app.get("/api/retailers")
async def get_retailers(
    search: Optional[str] = None, 
    skip: int = 0, 
    limit: int = 5000, 
    db: AsyncSession = Depends(get_db), 
    current_user: User = Depends(has_permission("view_retailers")),
    house_id: Optional[int] = Depends(get_house_context)
):
    # Fetch retailers with relations
    query = select(Retailer).options(
        joinedload(Retailer.house), 
        joinedload(Retailer.employee).selectinload(Employee.user)
    )
    
    # Apply multi-tenant filtering
    is_admin = any(r.name.lower() in ["admin", "super admin", "super_admin", "manager", "house manager", "house_manager"] for r in current_user.roles)
    
    if house_id:
        query = query.where(Retailer.house_id == house_id)
    elif is_admin:
        # Admin can see everything if no house context
        pass
    else:
        # Combined view for all assigned houses
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            query = query.where(Retailer.house_id.in_(user_house_ids))
        else:
            query = query.where(Retailer.house_id == -1)
    
    # Search by Name, Retailer Code, or iTop Number
    if search:
        search_pattern = f"%{search}%"
        query = query.where(
            (Retailer.name.ilike(search_pattern)) | 
            (Retailer.retailer_code.ilike(search_pattern)) | 
            (Retailer.itop_number.ilike(search_pattern))
        )
    
    result = await db.execute(query.offset(skip).limit(limit).order_by(Retailer.id.desc()))
    retailers = result.scalars().unique().all()
    
    output = []
    for r in retailers:
        # Convert to dictionary for precise control
        item = {
            "id": r.id,
            "house_id": r.house_id,
            "retailer_code": r.retailer_code,
            "name": r.name,
            "type": r.type,
            "enabled": r.enabled,
            "sim_seller": r.sim_seller,
            "tran_mobile_no": r.tran_mobile_no,
            "itop_sr_number": r.itop_sr_number,
            "itop_number": r.itop_number,
            "service_point": r.service_point,
            "category": r.category,
            "owner_name": r.owner_name,
            "contact_no": r.contact_no,
            "district": r.district,
            "thana": r.thana,
            "address": r.address,
            "nid": r.nid,
            "bp_code": r.bp_code,
            "bp_number": r.bp_number,
            "dob": r.dob,
            "route": r.route,
            "house": None,
            "employee": None
        }
        
        # Link House
        if r.house:
            item["house"] = {
                "id": r.house.id,
                "name": r.house.name,
                "code": r.house.code
            }
            
        # Link Employee (RSO)
        if r.employee:
            item["employee"] = {
                "id": r.employee.id,
                "name": r.employee.user.name if r.employee.user else r.employee.dms_code,
                "itop_number": r.employee.itop_number
            }
            
        output.append(item)
    return output

@app.get("/api/bts", response_model=List[BTSSchema])
async def get_bts(
    search: Optional[str] = None, 
    skip: int = 0, 
    limit: int = 20, 
    thana: Optional[str] = None,
    filter_house_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db), 
    current_user: User = Depends(has_permission("view_bts")),
    house_id: Optional[int] = Depends(get_house_context)
):
    effective_house_id = filter_house_id or house_id
    query = select(BTS)
    is_admin = any(r.name.lower() in ["admin", "super admin", "super_admin", "manager", "house manager", "house_manager"] for r in current_user.roles)

    if effective_house_id:
        query = query.where(BTS.house_id == effective_house_id)
    elif is_admin:
        pass
    else:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            query = query.where(BTS.house_id.in_(user_house_ids))
        else:
            query = query.where(BTS.house_id == -1)

    if thana:
        query = query.where(BTS.thana.ilike(f"%{thana}%"))
        
    if search:
        search_pattern = f"%{search}%"
        query = query.where(
            (BTS.site_id.ilike(search_pattern)) | 
            (BTS.bts_code.ilike(search_pattern)) |
            (BTS.address.ilike(search_pattern))
        )
    result = await db.execute(query.offset(skip).limit(limit).order_by(BTS.site_id))
    return result.scalars().all()

@app.post("/api/bts/import")
async def import_bts(file: UploadFile = File(...), db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("import_bts"))):
    if not os.path.exists("temp_downloads"): os.makedirs("temp_downloads")
    filename = file.filename or "upload.xlsx"
    if not validate_excel(filename):
        raise HTTPException(status_code=400, detail="Invalid file type. Only .xlsx and .xls files are allowed.")
    file_path = f"temp_downloads/{safe_filename(filename)}"
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        async def progress(msg: str):
            logger.info(f"BTS Import: {msg}")
        
        count, error = await process_bts_excel(file_path, progress)
        if error: raise HTTPException(status_code=400, detail=error)
        return {"message": f"Successfully imported {count} BTS stations", "count": count}
    finally:
        if os.path.exists(file_path): os.remove(file_path)

@app.get("/api/bts/export")
async def export_bts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("export_bts")),
    house_id: Optional[int] = Depends(get_house_context)
):
    query = select(BTS)
    is_admin = any(r.name.lower() in ["admin", "super admin", "super_admin", "manager", "house manager", "house_manager"] for r in current_user.roles)

    if house_id:
        query = query.where(BTS.house_id == house_id)
    elif not is_admin:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            query = query.where(BTS.house_id.in_(user_house_ids))
        else:
            query = query.where(BTS.house_id == -1)

    result = await db.execute(query.order_by(BTS.site_id))
    bts_list = result.scalars().all()

    excel_data = await export_bts_excel(bts_list)
    return Response(
        content=excel_data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=bts_export.xlsx"}
    )

@app.get("/api/bts/filters")
async def get_bts_filters(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("view_bts")),
    filter_house_id: Optional[int] = Query(None),
    house_id: Optional[int] = Depends(get_house_context)
):
    effective_house_id = filter_house_id or house_id
    query = select(BTS.thana).distinct()
    is_admin = any(r.name.lower() in ["admin", "super admin", "super_admin", "manager", "house manager", "house_manager"] for r in current_user.roles)
    if effective_house_id:
        query = query.where(BTS.house_id == effective_house_id)
    elif not is_admin:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            query = query.where(BTS.house_id.in_(user_house_ids))
        else:
            query = query.where(BTS.house_id == -1)
    result = await db.execute(query.order_by(BTS.thana))
    thanas = [row[0] for row in result.all() if row[0]]
    return {"thanas": thanas}


# ==========================================
# 4. GENERIC IMPORT/EXPORT ENDPOINTS (SSE Streaming)
# ==========================================

async def _import_file_stream(file: UploadFile, processor, permission: str, current_user: User, **kwargs):
    if not os.path.exists("temp_downloads"): os.makedirs("temp_downloads")
    filename = file.filename or "upload.xlsx"
    if not validate_excel(filename):
        yield f"data: {json.dumps({'type': 'error', 'message': 'Invalid file type. Only .xlsx and .xls files are allowed.'})}\n\n"
        return
    safe_name = safe_filename(filename)
    file_path = f"temp_downloads/{safe_name}"
    total_bytes = 0
    try:
        with open(file_path, "wb") as buffer:
            while chunk := await file.read(1024 * 1024):
                total_bytes += len(chunk)
                if total_bytes > MAX_FILE_SIZE:
                    yield f"data: {json.dumps({'type': 'error', 'message': 'File too large. Maximum size is 50 MB.'})}\n\n"
                    return
                buffer.write(chunk)

        progress_queue = asyncio.Queue()

        async def progress(msg: str):
            await progress_queue.put(msg)

        async def run_processor():
            try:
                count, error = await processor(file_path, progress_callback=progress, **kwargs)
                await progress_queue.put(("__result__", count, error))
            except Exception as e:
                await progress_queue.put(("__result__", 0, str(e)))

        task = asyncio.create_task(run_processor())

        while True:
            item = await progress_queue.get()
            if isinstance(item, tuple) and item[0] == "__result__":
                _, count, error = item
                if error:
                    yield f"data: {json.dumps({'type': 'error', 'message': error})}\n\n"
                else:
                    yield f"data: {json.dumps({'type': 'complete', 'message': f'সফলভাবে {count} টি রেকর্ড ইম্পোর্ট করা হয়েছে।', 'count': count})}\n\n"
                break
            else:
                yield f"data: {json.dumps({'type': 'progress', 'message': item})}\n\n"

        await task
    finally:
        if os.path.exists(file_path): os.remove(file_path)

# --- Activations ---
@app.post("/api/activations/import")
async def import_activations(file: UploadFile = File(...), current_user: User = Depends(has_permission("import_activations")), house_id: Optional[int] = Depends(get_house_context)):
    effective_house = house_id or 1
    return StreamingResponse(_import_file_stream(file, process_activation_excel, "import_activations", current_user, house_id=effective_house), media_type="text/event-stream")

@app.get("/api/activations/export")
async def export_activations(start_date: Optional[str] = None, end_date: Optional[str] = None, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("export_activations")), house_id: Optional[int] = Depends(get_house_context)):
    query = select(Activation).options(joinedload(Activation.house))
    if house_id: query = query.where(Activation.house_id == house_id)
    if start_date:
        try: sd = datetime.strptime(start_date, "%Y-%m-%d").date()
        except: return Response("Invalid start_date format", status_code=400)
        query = query.where(Activation.activation_date >= sd)
    if end_date:
        try: ed = datetime.strptime(end_date, "%Y-%m-%d").date()
        except: return Response("Invalid end_date format", status_code=400)
        query = query.where(Activation.activation_date <= ed)
    result = await db.execute(query.order_by(Activation.id.desc()))
    records = result.scalars().all()
    excel_data = await export_activations_excel(records)
    return Response(content=excel_data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": "attachment; filename=activations.xlsx"})

@app.get("/api/activations")
async def get_activations(search: Optional[str] = None, skip: int = 0, limit: int = 100, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("view_activations")), house_id: Optional[int] = Depends(get_house_context)):
    query = select(Activation).options(joinedload(Activation.house))
    if house_id: query = query.where(Activation.house_id == house_id)
    if search:
        p = f"%{search}%"
        query = query.where((Activation.sim_no.ilike(p)) | (Activation.retailer_code.ilike(p)) | (Activation.retailer_name.ilike(p)) | (Activation.msisdn.ilike(p)))
    count_query = select(func.count()).select_from(query.subquery())
    total = await db.execute(count_query)
    total_count = total.scalar()
    result = await db.execute(query.offset(skip).limit(limit).order_by(Activation.id.desc()))
    records = result.scalars().all()
    return {"total": total_count, "data": records}

# --- iTopUp Details ---
@app.get("/api/itopup-details/export")
async def export_itopup_details(db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("export_itopup")), house_id: Optional[int] = Depends(get_house_context)):
    query = select(ITopUpDetail).options(joinedload(ITopUpDetail.house), joinedload(ITopUpDetail.retailer))
    if house_id: query = query.where(ITopUpDetail.house_id == house_id)
    result = await db.execute(query.order_by(ITopUpDetail.id.desc()))
    records = result.scalars().all()
    excel_data = await export_itopup_details_excel(records)
    return Response(content=excel_data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": "attachment; filename=itopup_details.xlsx"})

@app.get("/api/itopup-details")
async def get_itopup_details(search: Optional[str] = None, report_type: Optional[str] = None, skip: int = 0, limit: int = 100, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("view_itopup")), house_id: Optional[int] = Depends(get_house_context)):
    query = select(ITopUpDetail).options(joinedload(ITopUpDetail.house), joinedload(ITopUpDetail.retailer))
    if house_id: query = query.where(ITopUpDetail.house_id == house_id)
    if report_type: query = query.where(ITopUpDetail.report_type == report_type)
    if search:
        p = f"%{search}%"
        query = query.where((ITopUpDetail.report_type.ilike(p)))
    count_query = select(func.count()).select_from(query.subquery())
    total = await db.execute(count_query)
    total_count = total.scalar()
    result = await db.execute(query.offset(skip).limit(limit).order_by(ITopUpDetail.id.desc()))
    records = result.scalars().all()
    return {"total": total_count, "data": records}

@app.post("/api/itopup-details/import")
async def import_itopup_details(file: UploadFile = File(...), report_type: str = Form("C2C"), current_user: User = Depends(has_permission("import_itopup")), house_id: Optional[int] = Depends(get_house_context)):
    return StreamingResponse(_import_file_stream(file, process_dms_report_excel, "import_itopup", current_user, report_type=report_type, target_house_id=house_id), media_type="text/event-stream")

# --- Live Activations ---
@app.post("/api/live-activations/import")
async def import_live_activations(file: UploadFile = File(...), current_user: User = Depends(has_permission("import_live_activations"))):
    return StreamingResponse(_import_file_stream(file, process_live_activation_excel, "import_live_activations", current_user), media_type="text/event-stream")

@app.get("/api/live-activations/export")
async def export_live_activations(db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("export_live_activations")), house_id: Optional[int] = Depends(get_house_context)):
    query = select(LiveActivation).options(joinedload(LiveActivation.house))
    if house_id: query = query.where(LiveActivation.house_id == house_id)
    result = await db.execute(query.order_by(LiveActivation.id.desc()))
    records = result.scalars().all()
    excel_data = await export_live_activations_excel(records)
    return Response(content=excel_data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": "attachment; filename=live_activations.xlsx"})

@app.get("/api/live-activations")
async def get_live_activations(search: Optional[str] = None, skip: int = 0, limit: int = 100, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("view_live_activations")), house_id: Optional[int] = Depends(get_house_context)):
    query = select(LiveActivation).options(joinedload(LiveActivation.house))
    if house_id: query = query.where(LiveActivation.house_id == house_id)
    if search:
        p = f"%{search}%"
        query = query.where((LiveActivation.sim_no.ilike(p)) | (LiveActivation.retailer_code.ilike(p)) | (LiveActivation.retailer_name.ilike(p)) | (LiveActivation.msisdn.ilike(p)))
    count_query = select(func.count()).select_from(query.subquery())
    total = await db.execute(count_query)
    total_count = total.scalar()
    result = await db.execute(query.offset(skip).limit(limit).order_by(LiveActivation.id.desc()))
    records = result.scalars().all()
    return {"total": total_count, "data": records}

# --- Scratch Card ---
@app.post("/api/scratch-card/import")
async def import_scratch_card(file: UploadFile = File(...), current_user: User = Depends(has_permission("import_scratch_card"))):
    return StreamingResponse(_import_file_stream(file, process_scratch_card_excel, "import_scratch_card", current_user), media_type="text/event-stream")

@app.get("/api/scratch-card/export")
async def export_scratch_card(db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("export_scratch_card")), house_id: Optional[int] = Depends(get_house_context)):
    query = select(ScratchCardIssue)
    if house_id: query = query.where(ScratchCardIssue.house_id == house_id)
    result = await db.execute(query.order_by(ScratchCardIssue.id.desc()))
    records = result.scalars().all()
    excel_data = await export_scratch_card_excel(records)
    return Response(content=excel_data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": "attachment; filename=scratch_card.xlsx"})

@app.get("/api/scratch-card")
async def get_scratch_card(search: Optional[str] = None, skip: int = 0, limit: int = 100, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("view_scratch_card")), house_id: Optional[int] = Depends(get_house_context)):
    query = select(ScratchCardIssue)
    if house_id: query = query.where(ScratchCardIssue.house_id == house_id)
    if search:
        p = f"%{search}%"
        query = query.where((ScratchCardIssue.distributor_code.ilike(p)) | (ScratchCardIssue.retailer_code.ilike(p)) | (ScratchCardIssue.retailer_name.ilike(p)) | (ScratchCardIssue.product_name.ilike(p)))
    count_query = select(func.count()).select_from(query.subquery())
    total = await db.execute(count_query)
    total_count = total.scalar()
    result = await db.execute(query.offset(skip).limit(limit).order_by(ScratchCardIssue.id.desc()))
    records = result.scalars().all()
    return {"total": total_count, "data": records}

# --- SIM Issues ---
@app.post("/api/sim-issues/import")
async def import_sim_issues(file: UploadFile = File(...), current_user: User = Depends(has_permission("import_sim_issues"))):
    return StreamingResponse(_import_file_stream(file, process_sim_issue_excel, "import_sim_issues", current_user), media_type="text/event-stream")

@app.get("/api/sim-issues/export")
async def export_sim_issues(db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("export_sim_issues")), house_id: Optional[int] = Depends(get_house_context)):
    query = select(SimIssue)
    if house_id: query = query.where(SimIssue.house_id == house_id)
    result = await db.execute(query.order_by(SimIssue.id.desc()))
    records = result.scalars().all()
    excel_data = await export_sim_issue_excel(records)
    return Response(content=excel_data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": "attachment; filename=sim_issues.xlsx"})

@app.get("/api/sim-issues")
async def get_sim_issues(search: Optional[str] = None, skip: int = 0, limit: int = 100, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("view_sim_issues")), house_id: Optional[int] = Depends(get_house_context)):
    query = select(SimIssue)
    if house_id: query = query.where(SimIssue.house_id == house_id)
    if search:
        p = f"%{search}%"
        query = query.where((SimIssue.sim_no.ilike(p)) | (SimIssue.distributor_code.ilike(p)) | (SimIssue.retailer_code.ilike(p)) | (SimIssue.retailer_name.ilike(p)) | (SimIssue.product_name.ilike(p)))
    count_query = select(func.count()).select_from(query.subquery())
    total = await db.execute(count_query)
    total_count = total.scalar()
    result = await db.execute(query.offset(skip).limit(limit).order_by(SimIssue.id.desc()))
    records = result.scalars().all()
    return {"total": total_count, "data": records}

# --- House Targets ---
@app.post("/api/house-targets/import")
async def import_house_targets(file: UploadFile = File(...), current_user: User = Depends(has_permission("import_targets"))):
    from datetime import datetime
    target_date = datetime.now()
    return StreamingResponse(_import_file_stream(file, process_target_excel_unified, "import_targets", current_user, target_date=target_date), media_type="text/event-stream")

@app.get("/api/house-targets/export")
async def export_house_targets(db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("export_targets")), house_id: Optional[int] = Depends(get_house_context)):
    query = select(HouseTarget).options(joinedload(HouseTarget.house))
    if house_id: query = query.where(HouseTarget.house_id == house_id)
    result = await db.execute(query.order_by(HouseTarget.id.desc()))
    records = result.scalars().all()
    excel_data = await export_house_targets_excel(records)
    return Response(content=excel_data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": "attachment; filename=house_targets.xlsx"})

@app.get("/api/house-targets")
async def get_house_targets(search: Optional[str] = None, target_date: Optional[str] = None, skip: int = 0, limit: int = 100, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("view_targets")), house_id: Optional[int] = Depends(get_house_context)):
    query = select(HouseTarget).options(joinedload(HouseTarget.house))
    if house_id: query = query.where(HouseTarget.house_id == house_id)
    if target_date:
        from datetime import date
        query = query.where(HouseTarget.target_date == date.fromisoformat(target_date))
    count_query = select(func.count()).select_from(query.subquery())
    total = await db.execute(count_query)
    total_count = total.scalar()
    result = await db.execute(query.offset(skip).limit(limit).order_by(HouseTarget.id.desc()))
    records = result.scalars().all()
    return {"total": total_count, "data": records}

# --- Supervisor Targets ---
@app.post("/api/supervisor-targets/import")
async def import_supervisor_targets(file: UploadFile = File(...), current_user: User = Depends(has_permission("import_targets"))):
    from datetime import datetime
    return StreamingResponse(_import_file_stream(file, process_target_excel_unified, "import_targets", current_user, target_date=datetime.now()), media_type="text/event-stream")

@app.get("/api/supervisor-targets/export")
async def export_supervisor_targets(db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("export_targets")), house_id: Optional[int] = Depends(get_house_context)):
    query = select(SupervisorTarget).options(joinedload(SupervisorTarget.house))
    if house_id: query = query.where(SupervisorTarget.house_id == house_id)
    result = await db.execute(query.order_by(SupervisorTarget.id.desc()))
    records = result.scalars().all()
    excel_data = await export_supervisor_targets_excel(records)
    return Response(content=excel_data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": "attachment; filename=supervisor_targets.xlsx"})

@app.get("/api/supervisor-targets")
async def get_supervisor_targets(search: Optional[str] = None, target_date: Optional[str] = None, skip: int = 0, limit: int = 100, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("view_targets")), house_id: Optional[int] = Depends(get_house_context)):
    query = select(SupervisorTarget).options(joinedload(SupervisorTarget.house))
    if house_id: query = query.where(SupervisorTarget.house_id == house_id)
    if target_date:
        from datetime import date
        query = query.where(SupervisorTarget.target_date == date.fromisoformat(target_date))
    count_query = select(func.count()).select_from(query.subquery())
    total = await db.execute(count_query)
    total_count = total.scalar()
    result = await db.execute(query.offset(skip).limit(limit).order_by(SupervisorTarget.id.desc()))
    records = result.scalars().all()
    return {"total": total_count, "data": records}

# --- RSO Targets ---
@app.post("/api/rso-targets/import")
async def import_rso_targets(file: UploadFile = File(...), current_user: User = Depends(has_permission("import_targets"))):
    from datetime import datetime
    return StreamingResponse(_import_file_stream(file, process_target_excel_unified, "import_targets", current_user, target_date=datetime.now()), media_type="text/event-stream")

@app.get("/api/rso-targets/export")
async def export_rso_targets(db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("export_targets")), house_id: Optional[int] = Depends(get_house_context)):
    query = select(RSOTarget).options(joinedload(RSOTarget.house))
    if house_id: query = query.where(RSOTarget.house_id == house_id)
    result = await db.execute(query.order_by(RSOTarget.id.desc()))
    records = result.scalars().all()
    excel_data = await export_rso_targets_excel(records)
    return Response(content=excel_data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": "attachment; filename=rso_targets.xlsx"})

@app.get("/api/rso-targets")
async def get_rso_targets(search: Optional[str] = None, target_date: Optional[str] = None, skip: int = 0, limit: int = 100, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("view_targets")), house_id: Optional[int] = Depends(get_house_context)):
    query = select(RSOTarget).options(joinedload(RSOTarget.house))
    if house_id: query = query.where(RSOTarget.house_id == house_id)
    if target_date:
        from datetime import date
        query = query.where(RSOTarget.target_date == date.fromisoformat(target_date))
    count_query = select(func.count()).select_from(query.subquery())
    total = await db.execute(count_query)
    total_count = total.scalar()
    result = await db.execute(query.offset(skip).limit(limit).order_by(RSOTarget.id.desc()))
    records = result.scalars().all()
    return {"total": total_count, "data": records}


# --- Filter Tags (DRC, RSP, BSP, ইত্যাদি) ---
@app.get("/api/filter-tags", response_model=List[FilterTagSchema])
async def list_filter_tags(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("view_retailers")),
    house_id: Optional[int] = Depends(get_house_context)
):
    query = select(FilterTag)
    is_admin = any(r.name.lower() in ["admin", "super admin", "super_admin", "manager", "house manager", "house_manager"] for r in current_user.roles)
    if house_id:
        query = query.where(FilterTag.house_id == house_id)
    elif not is_admin:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            query = query.where(FilterTag.house_id.in_(user_house_ids))
        else:
            query = query.where(FilterTag.house_id == -1)
    result = await db.execute(query.order_by(FilterTag.name))
    return result.scalars().all()

@app.post("/api/filter-tags", response_model=FilterTagSchema)
async def create_filter_tag(
    tag_data: FilterTagCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("edit_retailers")),
    x_house_id: Optional[int] = Header(None, alias="X-House-ID")
):
    target_house_id = tag_data.house_id or x_house_id
    if not target_house_id:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            target_house_id = user_house_ids[0]
        else:
            first_house = (await db.execute(select(House).limit(1))).scalar_one_or_none()
            if first_house:
                target_house_id = first_house.id
            else:
                raise HTTPException(status_code=400, detail="No house found. Please create a house first or specify house_id.")
    existing = (await db.execute(select(FilterTag).where(FilterTag.house_id == target_house_id, FilterTag.name == tag_data.name))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail=f"Tag '{tag_data.name}' already exists in this house")
    new_tag = FilterTag(house_id=target_house_id, name=tag_data.name)
    db.add(new_tag)
    await db.commit()
    await db.refresh(new_tag)
    return new_tag

@app.delete("/api/filter-tags/{tag_id}")
async def delete_filter_tag(
    tag_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("edit_retailers"))
):
    result = await db.execute(select(FilterTag).where(FilterTag.id == tag_id))
    tag = result.scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    # Cascade delete related retailer_filters
    await db.execute(RetailerFilter.__table__.delete().where(RetailerFilter.tag == tag.name, RetailerFilter.house_id == tag.house_id))
    await db.delete(tag)
    await db.commit()
    return {"message": "Tag deleted successfully"}

# --- Retailer Filters (Marking) ---
@app.get("/api/retailer-filters")
async def list_retailer_filters(
    tag: Optional[str] = None,
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("view_retailers")),
    house_id: Optional[int] = Depends(get_house_context)
):
    query = select(RetailerFilter).options(
        joinedload(RetailerFilter.retailer).joinedload(Retailer.employee).selectinload(Employee.user)
    )
    is_admin = any(r.name.lower() in ["admin", "super admin", "super_admin", "manager", "house manager", "house_manager"] for r in current_user.roles)
    if house_id:
        query = query.where(RetailerFilter.house_id == house_id)
    elif not is_admin:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            query = query.where(RetailerFilter.house_id.in_(user_house_ids))
        else:
            query = query.where(RetailerFilter.house_id == -1)
    if tag:
        query = query.where(RetailerFilter.tag == tag)
    if search:
        pattern = f"%{search}%"
        query = query.where(RetailerFilter.retailer.has(Retailer.name.ilike(pattern)) | RetailerFilter.retailer.has(Retailer.retailer_code.ilike(pattern)))
    result = await db.execute(query.order_by(RetailerFilter.id.desc()))
    filters = result.unique().scalars().all()
    output = []
    for f in filters:
        item = {
            "id": f.id,
            "house_id": f.house_id,
            "retailer_id": f.retailer_id,
            "tag": f.tag,
            "created_at": f.created_at.isoformat() if f.created_at else None,
            "retailer": None
        }
        if f.retailer:
            emp = f.retailer.employee
            item["retailer"] = {
                "id": f.retailer.id,
                "name": f.retailer.name,
                "retailer_code": f.retailer.retailer_code,
                "itop_number": f.retailer.itop_number,
                "thana": f.retailer.thana,
                "type": f.retailer.type,
                "employee": {
                    "name": emp.user.name if emp and emp.user else (emp.dms_code if emp else None),
                    "itop_number": emp.itop_number if emp else None
                } if emp else None
            }
        output.append(item)
    return output

@app.post("/api/retailer-filters")
async def create_retailer_filter(
    filter_data: RetailerFilterCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("edit_retailers"))
):
    retailer = await db.get(Retailer, filter_data.retailer_id)
    if not retailer:
        raise HTTPException(status_code=404, detail="Retailer not found")
    existing = (await db.execute(select(RetailerFilter).where(RetailerFilter.house_id == retailer.house_id, RetailerFilter.retailer_id == filter_data.retailer_id, RetailerFilter.tag == filter_data.tag))).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=400, detail="Retailer already has this tag")
    new_filter = RetailerFilter(house_id=retailer.house_id, retailer_id=filter_data.retailer_id, tag=filter_data.tag)
    db.add(new_filter)
    await db.commit()
    await db.refresh(new_filter)
    return {"id": new_filter.id, "house_id": new_filter.house_id, "retailer_id": new_filter.retailer_id, "tag": new_filter.tag, "message": "Retailer tagged successfully"}

@app.post("/api/retailer-filters/bulk")
async def bulk_create_retailer_filters(
    bulk_data: RetailerFilterBulkCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("edit_retailers"))
):
    count = 0
    errors = []
    for retailer_id in bulk_data.retailer_ids:
        retailer = await db.get(Retailer, retailer_id)
        if not retailer:
            errors.append(f"Retailer {retailer_id} not found")
            continue
        existing = (await db.execute(select(RetailerFilter).where(RetailerFilter.house_id == retailer.house_id, RetailerFilter.retailer_id == retailer_id, RetailerFilter.tag == bulk_data.tag))).scalar_one_or_none()
        if existing:
            continue
        new_filter = RetailerFilter(house_id=retailer.house_id, retailer_id=retailer_id, tag=bulk_data.tag)
        db.add(new_filter)
        count += 1
    await db.commit()
    return {"message": f"{count} retailers tagged successfully", "count": count, "errors": errors}

@app.delete("/api/retailer-filters/{filter_id}")
async def delete_retailer_filter(
    filter_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("edit_retailers"))
):
    result = await db.execute(select(RetailerFilter).where(RetailerFilter.id == filter_id))
    rf = result.scalar_one_or_none()
    if not rf:
        raise HTTPException(status_code=404, detail="Retailer filter not found")
    await db.delete(rf)
    await db.commit()
    return {"message": "Retailer tag removed successfully"}

# --- Activation Report with Exclusion ---
@app.get("/api/activations/report")
async def get_activation_report(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    exclude_tags: Optional[str] = Query(None, description="Comma-separated tag names to exclude (e.g. DRC,RSP,BSP)"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("view_reports")),
    house_id: Optional[int] = Depends(get_house_context)
):
    query = select(Activation).options(joinedload(Activation.house), joinedload(Activation.retailer))
    count_query = select(func.count()).select_from(Activation)

    is_admin = any(r.name.lower() in ["admin", "super admin", "super_admin", "manager", "house manager", "house_manager"] for r in current_user.roles)
    effective_house_id = house_id
    if not effective_house_id and not is_admin:
        user_house_ids = [h.id for h in current_user.houses]
        if user_house_ids:
            query = query.where(Activation.house_id.in_(user_house_ids))
            count_query = count_query.where(Activation.house_id.in_(user_house_ids))
    elif effective_house_id:
        query = query.where(Activation.house_id == effective_house_id)
        count_query = count_query.where(Activation.house_id == effective_house_id)

    if start_date:
        try: sd = datetime.strptime(start_date, "%Y-%m-%d").date()
        except: raise HTTPException(status_code=400, detail="Invalid start_date format, use YYYY-MM-DD")
        query = query.where(Activation.activation_date >= sd)
        count_query = count_query.where(Activation.activation_date >= sd)
    if end_date:
        try: ed = datetime.strptime(end_date, "%Y-%m-%d").date()
        except: raise HTTPException(status_code=400, detail="Invalid end_date format, use YYYY-MM-DD")
        query = query.where(Activation.activation_date <= ed)
        count_query = count_query.where(Activation.activation_date <= ed)

    if search:
        p = f"%{search}%"
        query = query.where((Activation.sim_no.ilike(p)) | (Activation.retailer_code.ilike(p)) | (Activation.retailer_name.ilike(p)) | (Activation.msisdn.ilike(p)))
        count_query = count_query.where((Activation.sim_no.ilike(p)) | (Activation.retailer_code.ilike(p)) | (Activation.retailer_name.ilike(p)) | (Activation.msisdn.ilike(p)))

    total_result = await db.execute(count_query)
    total_count = total_result.scalar()

    # Exclusion logic
    excluded_tags_list = []
    excluded_count = 0
    if exclude_tags:
        excluded_tags_list = [t.strip() for t in exclude_tags.split(",") if t.strip()]
        if excluded_tags_list and (effective_house_id or user_house_ids):
            house_ids_for_exclusion = [effective_house_id] if effective_house_id else (user_house_ids if not is_admin else None)
            excl_query = select(RetailerFilter.retailer_id).where(RetailerFilter.tag.in_(excluded_tags_list))
            if house_ids_for_exclusion:
                excl_query = excl_query.where(RetailerFilter.house_id.in_(house_ids_for_exclusion))
            excluded_ids_result = await db.execute(excl_query)
            excluded_retailer_ids = [row[0] for row in excluded_ids_result.all()]
            if excluded_retailer_ids:
                query = query.where(Activation.retailer_id.notin_(excluded_retailer_ids))
                # Calculate excluded count
                excl_count_query = select(func.count()).select_from(Activation).where(Activation.retailer_id.in_(excluded_retailer_ids))
                if effective_house_id:
                    excl_count_query = excl_count_query.where(Activation.house_id == effective_house_id)
                if start_date:
                    excl_count_query = excl_count_query.where(Activation.activation_date >= sd)
                if end_date:
                    excl_count_query = excl_count_query.where(Activation.activation_date <= ed)
                excl_total = await db.execute(excl_count_query)
                excluded_count = excl_total.scalar()

    offset = (page - 1) * page_size
    result = await db.execute(query.offset(offset).limit(page_size).order_by(Activation.id.desc()))
    records = result.unique().scalars().all()

    data = []
    for r in records:
        item = {
            "id": r.id,
            "house_id": r.house_id,
            "retailer_id": r.retailer_id,
            "activation_date": r.activation_date.isoformat() if r.activation_date else None,
            "retailer_code": r.retailer_code,
            "retailer_name": r.retailer_name,
            "sim_no": r.sim_no,
            "msisdn": r.msisdn,
            "product_name": r.product_name,
            "selling_price": r.selling_price,
            "thana": r.thana,
            "house": {"id": r.house.id, "name": r.house.name} if r.house else None
        }
        data.append(item)

    return {
        "total_activations": total_count,
        "excluded_count": excluded_count,
        "filtered_total": total_count - excluded_count,
        "excluded_tags": excluded_tags_list,
        "page": page,
        "page_size": page_size,
        "data": data
    }

# ==========================================
# 5. SCHEDULER
# ==========================================

async def master_automation_scheduler():
    if getattr(settings, "DISABLE_SCHEDULER", False): return
    logger.info("🚀 Master Automation Scheduler শুরু হয়েছে...")
    await asyncio.sleep(20)
    last_auto_sync_date = None
    while True:
        try:
            now = datetime.now()
            today_date = now.date()
            hour = now.hour
            if hour == 0 and now.minute < 5:
                await reset_daily_activations()
                await cleanup_old_dms_reports()
                await asyncio.sleep(300)
                continue
            if 8 <= hour < 24:
                await run_ga_live_sync()
                if last_auto_sync_date != today_date:
                    await run_daily_auto_sync()
                    last_auto_sync_date = today_date
                await asyncio.sleep(300)
            else:
                await asyncio.sleep(600)
        except Exception as e:
            logger.error(f"❌ [Scheduler Error] {str(e)}")
            await asyncio.sleep(60)

# ==========================================
# 6. MAIN ENTRY POINT
# ==========================================

async def main():
    # Retry DB connection
    max_retries = 10
    retry_delay = 5
    
    for i in range(max_retries):
        try:
            await init_db()
            logger.info("✅ DB Connected Successfully!")
            break
        except Exception as e:
            logger.error(f"❌ DB Connection Attempt {i+1} failed: {e}")
            if i < max_retries - 1:
                await asyncio.sleep(retry_delay)
            else:
                logger.error("❌ Max DB retries reached. Exiting.")
                return

    try:
        await engine.start()
    except Exception as e:
        logger.error(f"❌ Failed to start automation engine: {e}")
        return
    
    background_tasks = []
    try:
        # Note: reload=True requires app as an import string, e.g., "main:app"
        config = uvicorn.Config(app, host="0.0.0.0", port=8000, log_level="info", reload=False)
        server = uvicorn.Server(config)
        background_tasks.append(asyncio.create_task(server.serve()))
        
        if settings.ENABLE_GA_SYNC:
            background_tasks.append(asyncio.create_task(master_automation_scheduler()))
            
        logger.info(f"🚀 OrangeFlow API is Live on port 8000")
        
        # Keep the main loop running
        while True:
            await asyncio.sleep(3600)
            
    except (KeyboardInterrupt, asyncio.CancelledError): pass
    finally:
        for task in background_tasks:
            if not task.done(): task.cancel()
        await engine.stop()
        logger.info("✅ System closed successfully.")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit): sys.exit(0)
