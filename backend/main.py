import logging
import sys
import asyncio
import os
import shutil
import uuid
from datetime import datetime, timedelta, timezone
from logging.handlers import RotatingFileHandler
from typing import List, Optional

from aiogram import Bot, Dispatcher
from fastapi import FastAPI, Depends, HTTPException, Query, status, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext
import uvicorn
from pydantic import BaseModel, EmailStr
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

# Project Imports
from config.settings import BOT_TOKEN, settings
from app.Services.db_service import init_db, async_session
from app.Models.retailer import Retailer
from app.Models.house import House
from app.Models.bts import BTS
from app.Models.field_force import FieldForce
from app.Models.user import User
from app.Models.role import Role, Permission
from app.Middleware.access_control import ACLMiddleware
from app.Core.webhook_server import start_webhook_server
from app.Core.automation_engine import engine

# Service & Controller Imports
from app.Services.Automation.Reports.ga_live import run_ga_live_sync, reset_daily_activations
from app.Services.Automation.dms_report_excel import cleanup_old_dms_reports
from app.Services.Automation.dms_sync_service import run_daily_auto_sync
from app.Services.Automation.retailer_excel import process_retailer_excel
from app.Controllers import (
    activation_controller, admin_controller, house_controller, user_controller,
    role_controller, automation_controller, sim_status_controller,
    sim_return_controller, sim_issue_controller, ga_live_controller,
    field_force_controller, retailer_controller, ga_filter_controller,
    bts_controller, mela_config_controller, mela_controller, dms_report_controller,
    issue_report_controller, target_controller, leave_controller, setup_wizard_controller,
    product_controller
)

# ==========================================
# 1. FASTAPI SETUP & SCHEMAS
# ==========================================

app = FastAPI(title="OrangeFlow Management API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

class PermissionSchema(BaseModel):
    id: int
    name: str
    class Config: from_attributes = True

class RoleSchema(BaseModel):
    id: int
    name: str
    permissions: List[PermissionSchema] = []
    class Config: from_attributes = True

class RoleCreate(BaseModel):
    name: str
    permissions: List[int] = []

class UserSchema(BaseModel):
    id: int
    username: Optional[str]
    name: Optional[str]
    email: Optional[str]
    status: str
    roles: List[RoleSchema] = []
    class Config: from_attributes = True

class UserCreate(BaseModel):
    username: str
    password: str
    name: str
    email: Optional[EmailStr] = None

class Token(BaseModel):
    access_token: str
    token_type: str

class BTSSchema(BaseModel):
    id: int
    bts_code: str
    site_id: str
    thana: Optional[str]
    site_type: Optional[str]
    class Config: from_attributes = True

class FieldForceSchema(BaseModel):
    id: int
    house_id: int
    user_id: Optional[int] = None
    assisted_retailer_code: Optional[str] = None
    agency_id: Optional[str] = None
    dms_code: Optional[str] = None
    name: str
    itop_number: Optional[str] = None
    personal_number: Optional[str] = None
    pool_number: Optional[str] = None
    type: Optional[str] = None
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
    supervisor_id: Optional[int] = None
    class Config: from_attributes = True

class FieldForceCreate(BaseModel):
    house_id: int
    user_id: Optional[int] = None
    assisted_retailer_code: Optional[str] = None
    agency_id: Optional[str] = None
    dms_code: Optional[str] = None
    name: str
    itop_number: Optional[str] = None
    personal_number: Optional[str] = None
    pool_number: Optional[str] = None
    type: Optional[str] = None
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
    supervisor_id: Optional[int] = None

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
    field_force: Optional[dict] = None
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
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    
    result = await db.execute(select(User).where(User.username == username))
    user = result.scalar_one_or_none()
    if user is None:
        raise credentials_exception
    return user

def has_permission(required_permission: str):
    async def permission_dependency(current_user: User = Depends(get_current_user)):
        # ১. সুপার এডমিন চেক (যদি 'Admin' বা 'Super Admin' রোল থাকে তবে সব এলাউড)
        user_permissions = set()
        for role in current_user.roles:
            if role.name.lower() in ["admin", "super admin", "super_admin"]:
                return current_user 
            for perm in role.permissions:
                user_permissions.add(perm.name)
        
        # ২. নির্দিষ্ট পারমিশন চেক
        if required_permission not in user_permissions:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"আপনার এই কাজটি করার অনুমতি নেই: {required_permission}"
            )
        return current_user
    return permission_dependency

# ==========================================
# 3. API ENDPOINTS
# ==========================================

@app.get("/")
async def root():
    return {"message": "OrangeFlow Bot & API is running"}

# --- Auth ---
@app.post("/api/auth/register", response_model=UserSchema)
async def register(user_data: UserCreate, db: AsyncSession = Depends(get_db)):
    existing_user = (await db.execute(select(User).where((User.username == user_data.username) | (User.email == user_data.email)))).scalar_one_or_none()
    if existing_user:
        raise HTTPException(status_code=400, detail="Username or Email already registered")
    
    new_user = User(
        username=user_data.username,
        hashed_password=get_password_hash(user_data.password),
        name=user_data.name,
        email=user_data.email,
        status="Active"
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    return new_user

@app.post("/api/auth/login", response_model=Token)
async def login(form_data: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == form_data.username))
    user = result.scalar_one_or_none()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect username or password")
    
    access_token = create_access_token(data={"sub": user.username})
    return {"access_token": access_token, "token_type": "bearer"}

@app.get("/api/auth/me", response_model=UserSchema)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user

# --- Houses ---
@app.get("/api/houses", response_model=List[HouseSchema])
async def list_houses(db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("view_houses"))):
    result = await db.execute(select(House).order_by(House.name))
    return result.scalars().all()

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

# --- Field Force ---
@app.get("/api/field-force", response_model=List[FieldForceSchema])
async def list_field_force(search: Optional[str] = None, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("view_field_force"))):
    query = select(FieldForce)
    if search:
        search_pattern = f"%{search}%"
        query = query.where(
            (FieldForce.name.ilike(search_pattern)) | 
            (FieldForce.dms_code.ilike(search_pattern)) | 
            (FieldForce.itop_number.ilike(search_pattern))
        )
    result = await db.execute(query.order_by(FieldForce.id.desc()))
    return result.scalars().all()

@app.post("/api/field-force", response_model=FieldForceSchema)
async def create_field_force(ff_data: FieldForceCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("create_field_force"))):
    if ff_data.dms_code:
        existing = (await db.execute(select(FieldForce).where(FieldForce.dms_code == ff_data.dms_code))).scalar_one_or_none()
        if existing: raise HTTPException(status_code=400, detail="Member with this DMS code already exists")
    new_ff = FieldForce(**ff_data.model_dump())
    db.add(new_ff)
    await db.commit()
    await db.refresh(new_ff)
    return new_ff

@app.put("/api/field-force/{ff_id}", response_model=FieldForceSchema)
async def update_field_force(ff_id: int, ff_data: FieldForceCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("edit_field_force"))):
    result = await db.execute(select(FieldForce).where(FieldForce.id == ff_id))
    ff = result.scalar_one_or_none()
    if not ff: raise HTTPException(status_code=404, detail="Field force member not found")
    for key, value in ff_data.model_dump().items():
        setattr(ff, key, value)
    await db.commit()
    await db.refresh(ff)
    return ff

@app.delete("/api/field-force/{ff_id}")
async def delete_field_force(ff_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("delete_field_force"))):
    result = await db.execute(select(FieldForce).where(FieldForce.id == ff_id))
    ff = result.scalar_one_or_none()
    if not ff: raise HTTPException(status_code=404, detail="Field force member not found")
    await db.delete(ff)
    await db.commit()
    return {"message": "Field force member deleted successfully"}

# --- Users ---
@app.get("/api/users", response_model=List[UserSchema])
async def list_users(db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("view_users"))):
    result = await db.execute(select(User).order_by(User.id.desc()))
    return result.scalars().all()

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
async def list_roles(db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("view_roles"))):
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

# --- Stats, Retailers & BTS ---
@app.get("/api/stats")
async def get_stats(db: AsyncSession = Depends(get_db)):
    retailer_count = (await db.execute(select(func.count()).select_from(Retailer))).scalar()
    house_count = (await db.execute(select(func.count()).select_from(House))).scalar()
    bts_count = (await db.execute(select(func.count()).select_from(BTS))).scalar()
    ff_count = (await db.execute(select(func.count()).select_from(FieldForce))).scalar()
    return {
        "total_retailers": retailer_count,
        "total_houses": house_count,
        "total_bts": bts_count,
        "total_field_force": ff_count,
        "active_users": 12,
        "today_activations": 45,
    }

@app.get("/api/retailers")
async def get_retailers(search: Optional[str] = None, skip: int = 0, limit: int = 5000, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("view_retailers"))):
    # Fetch retailers with relations
    query = select(Retailer).options(
        joinedload(Retailer.house), 
        joinedload(Retailer.field_force)
    )
    
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
            "field_force": None
        }
        
        # Link House
        if r.house:
            item["house"] = {
                "id": r.house.id,
                "name": r.house.name,
                "code": r.house.code
            }
            
        # Link Field Force (RSO)
        if r.field_force:
            item["field_force"] = {
                "id": r.field_force.id,
                "name": r.field_force.name,
                "itop_number": r.field_force.itop_number
            }
            
        output.append(item)
    return output

@app.post("/api/retailers", response_model=RetailerSchema)
async def create_retailer(retailer_data: RetailerCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("create_retailers"))):
    existing = (await db.execute(select(Retailer).where(Retailer.retailer_code == retailer_data.retailer_code))).scalar_one_or_none()
    if existing: raise HTTPException(status_code=400, detail="Retailer with this code already exists")
    new_retailer = Retailer(**retailer_data.model_dump())
    db.add(new_retailer)
    await db.commit()
    await db.refresh(new_retailer)
    return new_retailer

@app.put("/api/retailers/{retailer_id}", response_model=RetailerSchema)
async def update_retailer(retailer_id: int, retailer_data: RetailerCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("edit_retailers"))):
    result = await db.execute(select(Retailer).where(Retailer.id == retailer_id))
    retailer = result.scalar_one_or_none()
    if not retailer: raise HTTPException(status_code=404, detail="Retailer not found")
    for key, value in retailer_data.model_dump().items():
        setattr(retailer, key, value)
    await db.commit()
    await db.refresh(retailer)
    return retailer

@app.delete("/api/retailers/{retailer_id}")
async def delete_retailer(retailer_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("delete_retailers"))):
    result = await db.execute(select(Retailer).where(Retailer.id == retailer_id))
    retailer = result.scalar_one_or_none()
    if not retailer: raise HTTPException(status_code=404, detail="Retailer not found")
    await db.delete(retailer)
    await db.commit()
    return {"message": "Retailer deleted successfully"}

@app.post("/api/retailers/import")
async def import_retailers(file: UploadFile = File(...), house_id: int = Query(...), db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("import_retailers"))):
    if not os.path.exists("temp_downloads"): os.makedirs("temp_downloads")
    file_path = f"temp_downloads/{uuid.uuid4()}_{file.filename}"
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        
        count, error = await process_retailer_excel(file_path, house_id)
        if error: raise HTTPException(status_code=400, detail=error)
        return {"message": f"Successfully imported {count} retailers", "count": count}
    finally:
        if os.path.exists(file_path): os.remove(file_path)

@app.get("/api/bts", response_model=List[BTSSchema])
async def get_bts(search: Optional[str] = None, skip: int = 0, limit: int = 20, db: AsyncSession = Depends(get_db), current_user: User = Depends(has_permission("view_bts"))):
    query = select(BTS)
    if search:
        search_pattern = f"%{search}%"
        query = query.where((BTS.site_id.ilike(search_pattern)) | (BTS.bts_code.ilike(search_pattern)))
    result = await db.execute(query.offset(skip).limit(limit).order_by(BTS.site_id))
    return result.scalars().all()

# ==========================================
# 4. LOGGING & SCHEDULER
# ==========================================

if not os.path.exists('logs'): os.makedirs('logs')
log_formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
file_handler = RotatingFileHandler('logs/orange_flow.log', maxBytes=10*1024*1024, backupCount=5, encoding='utf-8')
file_handler.setFormatter(log_formatter)
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setFormatter(log_formatter)
logging.basicConfig(level=logging.INFO, handlers=[file_handler, console_handler])
logging.getLogger("aiogram").setLevel(logging.ERROR)
logger = logging.getLogger(__name__)

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
# 5. MAIN ENTRY POINT
# ==========================================

async def main():
    try:
        await init_db()
        print("✅ DB Connected Successfully!")
    except Exception as e:
        print(f"❌ DB Connection Error: {e}"); return

    await engine.start()
    bot = Bot(token=BOT_TOKEN)
    dp = Dispatcher()
    dp.message.middleware(ACLMiddleware())
    dp.callback_query.middleware(ACLMiddleware())
    dp.include_routers(
        admin_controller.router, setup_wizard_controller.router, house_controller.router,
        user_controller.router, role_controller.router, automation_controller.router, 
        sim_status_controller.router, sim_return_controller.router, sim_issue_controller.router,
        ga_live_controller.router, field_force_controller.router, retailer_controller.router, 
        ga_filter_controller.router, bts_controller.router, mela_config_controller.router,
        activation_controller.router, mela_controller.router, dms_report_controller.router,
        issue_report_controller.router, target_controller.router, leave_controller.router,
        product_controller.router
    )
    await bot.delete_webhook(drop_pending_updates=True)
    background_tasks = []
    try:
        config = uvicorn.Config(app, host="0.0.0.0", port=8000, log_level="error")
        server = uvicorn.Server(config)
        background_tasks.append(asyncio.create_task(server.serve()))
        background_tasks.append(asyncio.create_task(start_webhook_server(settings.WEBHOOK_PORT)))
        if settings.ENABLE_GA_SYNC:
            background_tasks.append(asyncio.create_task(master_automation_scheduler()))
        logger.info(f"🤖 Bot is Live! API on port 8000")
        await dp.start_polling(bot)
    except (KeyboardInterrupt, asyncio.CancelledError): pass
    finally:
        for task in background_tasks:
            if not task.done(): task.cancel()
        await engine.stop()
        await bot.session.close()
        logger.info("✅ System closed successfully.")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit): sys.exit(0)
