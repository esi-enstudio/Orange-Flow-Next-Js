import pandas as pd
import os
import asyncio
import logging
from tqdm import tqdm
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload, joinedload

from app.models.employee import Employee
from app.models.user import User         
from app.models.house import House
from app.models.bp_retailer_code import BpRetailerCode
from app.services.db_service import async_session

logger = logging.getLogger(__name__)

# Column list (USERNAME added)
EMP_COLUMNS = [
    'NAME', 'USERNAME', 'DD_CODE', 'DMS_CODE', 'AGENCY_ID', 'ITOP_NUMBER', 'PERSONAL_NUMBER', 
    'POOL_NUMBER', 'ASSISTED_RETAILER_CODE', 'SR_NO', 'SALARY', 'MARKET_TYPE', 
    'JOINING_DATE', 'RESIGNED_DATE', 'RELIGION', 'DOB', 'NID',
    'BANK_NAME', 'BANK_ACCOUNT', 'BRANCH_NAME', 'ROUTING_NUMBER', 'HOME_TOWN',
    'EMERGENCY_CONTACT_PERSON_NAME', 'EMERGENCY_CONTACT_PERSON_NUMBER', 'RELATIONSHIP',
    'LAST_EDUCATION', 'INSTITUTION_NAME', 'BLOOD_GROUP', 'PRESENT_ADDRESS', 
    'PERMANENT_ADDRESS', 'FATHERS_NAME', 'MOTHERS_NAME', 'PREVIOUS_COMPANY_NAME', 
    'PREVIOUS_COMPANY_SALARY', 'MOTOR_BIKE', 'BICYCLE', 'DRIVING_LICENSE', 'STATUS'
]

async def generate_emp_sample(file_path):
    """Generate sample Excel file"""
    df = pd.DataFrame(columns=EMP_COLUMNS)
    df.to_excel(file_path, index=False)
    return file_path

async def export_employees_excel(employees):
    """Create Excel file for export"""
    data = []
    for emp in employees:
        data.append({
            'NAME': emp.employee_name,
            'USERNAME': emp.user.username if emp.user else "",
            'DD_CODE': emp.house.code if emp.house else "", # House code (DD Code)
            'DMS_CODE': emp.dms_code,
            'AGENCY_ID': emp.agency_id,
            'ITOP_NUMBER': emp.itop_number,
            'PERSONAL_NUMBER': emp.personal_number,
            'POOL_NUMBER': emp.pool_number,
            'ASSISTED_RETAILER_CODE': emp.assisted_retailer_code,
            'SR_NO': emp.sr_no,
            'SALARY': emp.salary,
            'MARKET_TYPE': emp.market_type,
            'JOINING_DATE': emp.joining_date,
            'RESIGNED_DATE': emp.resigned_date,
            'RELIGION': emp.religion,
            'DOB': emp.dob,
            'NID': emp.nid,
            'BANK_NAME': emp.bank_name,
            'BANK_ACCOUNT': emp.bank_account,
            'BRANCH_NAME': emp.branch_name,
            'ROUTING_NUMBER': emp.routing_number,
            'HOME_TOWN': emp.home_town,
            'EMERGENCY_CONTACT_PERSON_NAME': emp.emergency_contact_person_name,
            'EMERGENCY_CONTACT_PERSON_NUMBER': emp.emergency_contact_person_number,
            'RELATIONSHIP': emp.emergency_person_relationship,
            'LAST_EDUCATION': emp.last_education,
            'INSTITUTION_NAME': emp.institution_name,
            'BLOOD_GROUP': emp.blood_group,
            'PRESENT_ADDRESS': emp.present_address,
            'PERMANENT_ADDRESS': emp.permanent_address,
            'FATHERS_NAME': emp.fathers_name,
            'MOTHERS_NAME': emp.mothers_name,
            'PREVIOUS_COMPANY_NAME': emp.previous_company_name,
            'PREVIOUS_COMPANY_SALARY': emp.previous_company_salary,
            'MOTOR_BIKE': emp.motor_bike,
            'BICYCLE': emp.bicyle,
            'DRIVING_LICENSE': emp.driving_license,
            'STATUS': emp.status
        })
    
    df = pd.DataFrame(data)
    import io
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='Employees')
    return output.getvalue()

async def process_employee_excel(file_path, house_id=None, progress_callback=None):
    """Advanced bulk processing with user mapping logic ✅"""
    try:
        # 1. Data load
        df = pd.read_excel(file_path, dtype=str)
        df.columns = [c.strip().upper().replace(" ", "_") for c in df.columns]
        
        total_rows = len(df)
        if total_rows == 0: return 0, "No data found in file."

        # 2. Clean function
        def clean_val(val, col_name=None):
            if pd.isna(val):
                return None
            v = str(val).strip()
            if v == "" or v.lower() in ["nan", "none", "null"]:
                return None

            # Keep only date part for date columns (remove time)
            if col_name in ['JOINING_DATE', 'RESIGNED_DATE', 'DOB']:
                if ' ' in v and ':' in v:
                    v = v.split(' ')[0]  # "2024-08-01 00:00:00" -> "2024-08-01"

            return v

        async with async_session() as session:
            # Get current max numbers for each prefix
            max_nums = {}
            for employee_type, prefix in [
                ("rso", "RSO"), ("manager", "MGR"), ("supervisor", "SUP"),
                ("bp", "BP"), ("bsp", "BSP"), ("rbsp", "RBSP"), ("unknown", "EMP")
            ]:
                res = await session.execute(
                    select(Employee.employee_id)
                    .where(Employee.employee_id.like(f"{prefix}-%"))
                    .order_by(Employee.employee_id.desc())
                    .limit(1)
                )
                last_id = res.scalar_one_or_none()
                if last_id:
                    try:
                        max_nums[prefix] = int(last_id.split("-")[1])
                    except (IndexError, ValueError):
                        max_nums[prefix] = 0
                else:
                    max_nums[prefix] = 0

            # Performance optimization: load all users and houses in memory ✅
            logger.info("⏳ Building map...")
            user_res = await session.execute(
                select(User).options(selectinload(User.roles))
            )
            user_all = user_res.scalars().all()
            user_username_map = {u.username.upper(): u for u in user_all if u.username}

            house_res = await session.execute(select(House.code, House.id))
            house_map = {h.code.upper(): h.id for h in house_res.all() if h.code}

            count = 0
            batch_size = 50
            batch_data = []
            
            # tqdm progress bar (terminal)
            pbar = tqdm(total=total_rows, desc="📤 Employee Uploading", unit="row")

            for index, row in df.iterrows():
                dms_code_val = clean_val(row.get('DMS_CODE'))
                
                if not dms_code_val:
                    pbar.update(1)
                    continue

                # 2.5 Get house ID ✅
                # Required: get house from DD Code in Excel for multi-tenant app.
                dd_code_val = clean_val(row.get('DD_CODE'))
                target_house_id = None
                
                if dd_code_val:
                    target_house_id = house_map.get(dd_code_val.upper())
                
                # If no DD Code in Excel, use house ID from parameter.
                if not target_house_id:
                    target_house_id = house_id

                # Skip row if no house ID found (multi-tenant safety).
                if not target_house_id:
                    logger.warning(f"⚠️ Row {index}: No House ID found for DD_CODE: {dd_code_val}. Skipping.")
                    pbar.update(1)
                    continue

                # 3. User mapping ✅ (match by username only)
                username_val = clean_val(row.get('USERNAME'))
                target_user = None
                
                if username_val:
                    target_user = user_username_map.get(username_val.upper())

                target_user_id = target_user.id if target_user else None

                # Determine employee type and generate unique employee ID
                employee_type = "unknown"
                if target_user and target_user.roles:
                    user_roles = [r.name.lower() for r in target_user.roles]
                    valid_types = {"rso", "manager", "supervisor", "bp", "bsp", "rbsp"}
                    matched_role = next((r for r in user_roles if r in valid_types), None)
                    if matched_role:
                        employee_type = matched_role

                # Check if there is an explicit EMPLOYEE_TYPE column in the row
                excel_type = clean_val(row.get('EMPLOYEE_TYPE') or row.get('TYPE'))
                if excel_type and excel_type.lower() in ["rso", "manager", "supervisor", "bp", "bsp", "rbsp", "unknown"]:
                    employee_type = excel_type.lower()

                PREFIX_MAP = {
                    "rso": "RSO", "manager": "MGR", "supervisor": "SUP",
                    "bp": "BP", "bsp": "BSP", "rbsp": "RBSP", "unknown": "EMP",
                }
                prefix = PREFIX_MAP.get(employee_type, "EMP")
                max_nums[prefix] += 1
                employee_id = f"{prefix}-{max_nums[prefix]:04d}"

                # 4. Data mapping
                data_map = {
                    "user_id": target_user_id,
                    "house_id": target_house_id,
                    "dms_code": dms_code_val,
                    "employee_name": clean_val(row.get('NAME') or row.get('EMPLOYEE_NAME') or row.get('FULL_NAME')),
                    "employee_type": employee_type,
                    "employee_id": employee_id,
                    "sr_no": clean_val(row.get('SR_NO')),
                    "assisted_retailer_code": clean_val(row.get('ASSISTED_RETAILER_CODE')),
                    "agency_id": clean_val(row.get('AGENCY_ID')),
                    "itop_number": clean_val(row.get('ITOP_NUMBER')),
                    "personal_number": clean_val(row.get('PERSONAL_NUMBER')),
                    "pool_number": clean_val(row.get('POOL_NUMBER')),
                    # "type" column removed
                    "status": clean_val(row.get('STATUS')) or "Active",
                    "bank_name": clean_val(row.get('BANK_NAME')),
                    "bank_account": clean_val(row.get('BANK_ACCOUNT')),
                    "branch_name": clean_val(row.get('BRANCH_NAME')),
                    "routing_number": clean_val(row.get('ROUTING_NUMBER')),
                    "home_town": clean_val(row.get('HOME_TOWN')),
                    "emergency_contact_person_name": clean_val(row.get('EMERGENCY_CONTACT_PERSON_NAME')),
                    "emergency_contact_person_number": clean_val(row.get('EMERGENCY_CONTACT_PERSON_NUMBER')),
                    "emergency_person_relationship": clean_val(row.get('RELATIONSHIP')),
                    "last_education": clean_val(row.get('LAST_EDUCATION')),
                    "institution_name": clean_val(row.get('INSTITUTION_NAME')),
                    "blood_group": clean_val(row.get('BLOOD_GROUP')),
                    "present_address": clean_val(row.get('PRESENT_ADDRESS')),
                    "permanent_address": clean_val(row.get('PERMANENT_ADDRESS')),
                    "fathers_name": clean_val(row.get('FATHERS_NAME')),
                    "mothers_name": clean_val(row.get('MOTHERS_NAME')),
                    "religion": clean_val(row.get('RELIGION')),
                    "dob": clean_val(row.get('DOB'), 'DOB'),
                    "nid": clean_val(row.get('NID')),
                    "previous_company_name": clean_val(row.get('PREVIOUS_COMPANY_NAME')),
                    "previous_company_salary": clean_val(row.get('PREVIOUS_COMPANY_SALARY')),
                    "motor_bike": clean_val(row.get('MOTOR_BIKE')),
                    "bicyle": clean_val(row.get('BICYCLE')),
                    "driving_license": clean_val(row.get('DRIVING_LICENSE')),
                    "joining_date": clean_val(row.get('JOINING_DATE'), 'JOINING_DATE'),
                    "resigned_date": clean_val(row.get('RESIGNED_DATE'), 'RESIGNED_DATE'),
                    "market_type": clean_val(row.get('MARKET_TYPE')),
                    "salary": clean_val(row.get('SALARY')),
                }

                batch_data.append(data_map)

                # 5. Batch upsert ✅
                if len(batch_data) >= batch_size:
                    await do_bulk_upsert_emp(session, batch_data)
                    count += len(batch_data)
                    pbar.update(len(batch_data)) # Terminal update
                    batch_data = []
                    if progress_callback:
                        await update_progress_emp(count, total_rows, progress_callback)

            # Remaining data
            if batch_data:
                await do_bulk_upsert_emp(session, batch_data)
                count += len(batch_data)
                pbar.update(len(batch_data)) # Terminal update
                if progress_callback:
                    await update_progress_emp(count, total_rows, progress_callback)

            pbar.close() # Close progress bar
            await session.commit()

            # Auto-sync BP employees' assisted_retailer_code to bp_retailer_codes
            bp_emps = await session.execute(
                select(Employee).where(
                    Employee.employee_type == "bp",
                    Employee.assisted_retailer_code != None,
                    Employee.assisted_retailer_code != "",
                )
            )
            for emp in bp_emps.scalars().all():
                existing = await session.execute(
                    select(BpRetailerCode).where(
                        BpRetailerCode.bp_employee_id == emp.id,
                        BpRetailerCode.retailer_code == emp.assisted_retailer_code,
                    )
                )
                if not existing.scalar_one_or_none():
                    session.add(BpRetailerCode(
                        bp_employee_id=emp.id,
                        retailer_code=emp.assisted_retailer_code,
                        house_id=emp.house_id,
                    ))
            await session.commit()

            return count, None

    except Exception as e:
        logger.error(f"❌ Excel Processing Error: {str(e)}")
        return 0, f"Processing error: {str(e)}"

async def do_bulk_upsert_emp(session, batch_data):
    """Bulk upsert logic for employees"""
    stmt = insert(Employee).values(batch_data)
    
    # Which fields to update on conflict
    excluded = stmt.excluded
    # All fields except dms_code, employee_id, and employee_type will be updated
    update_cols = {
        col: getattr(excluded, col) 
        for col in batch_data[0].keys() 
        if col not in ['dms_code', 'employee_id', 'employee_type']
    }
    update_cols['updated_at'] = func.now()

    stmt = stmt.on_conflict_do_update(
        index_elements=['dms_code'],
        set_=update_cols
    )
    await session.execute(stmt)

async def update_progress_emp(count, total_rows, progress_callback):
    percent = round((count / total_rows) * 100)
    await progress_callback(
        f"Employees — {percent}%  ({count} / {total_rows})"
    )
