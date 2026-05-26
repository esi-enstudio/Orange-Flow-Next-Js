import pandas as pd
import os
from datetime import datetime
from sqlalchemy import select, func, or_
from sqlalchemy.orm import selectinload, joinedload
from app.Models.house import House
from app.Models.employee import Employee
from app.Models.house_target import HouseTarget
from app.Models.supervisor_target import SupervisorTarget
from app.Models.rso_target import RSOTarget
from app.Services.db_service import async_session
from app.Utils.helpers import bn_num

def format_currency(val):
    try:
        return f"{float(val or 0):,.2f}"
    except:
        return "0.00"

async def get_house_target_full_info(month, year, page=1, total_count=None):
    target_date = datetime(year, month, 1)
    async with async_session() as session:
        if total_count is None:
            # Get total count only if not provided
            count_stmt = select(func.count(HouseTarget.id)).where(HouseTarget.target_date == target_date)
            total_res = await session.execute(count_stmt)
            total_count = total_res.scalar()

        if total_count == 0:
            return None, 0, f"No house targets found for {month}/{year}."

        # Get specific house target with joinedload for efficiency
        stmt = select(HouseTarget).options(joinedload(HouseTarget.house))\
            .where(HouseTarget.target_date == target_date)\
            .order_by(HouseTarget.id)\
            .offset(page - 1).limit(1)
        
        result = await session.execute(stmt)
        t = result.scalar_one_or_none()

    if not t:
        return None, total_count, "Target not found."

    h = t.house
    text = (
        f"🏠 **House Target Detail ({month}/{year})**\n"
        f"Page: {page}/{total_count}\n"
        f"━━━━━━━━━━━━━━━━━━━━━\n"
        f"🏘️ **{h.name} ({h.code})**\n"
        f"━━━━━━━━━━━━━━━━━━━━━\n"
        f"📈 **Target Details**\n"
        f"🔹 Recharge Target: {format_currency(t.total_recharge_target)}\n"
        f"🔹 GA Target: {t.total_ga_target} (RSO: {t.rso_ga}, BP: {t.bp_ga})\n"
        f"🔹 EV C2C Target: {format_currency(t.ev_c2c_target)}\n"
        f"🔹 SC Primary: {format_currency(t.sc_primary_target)}\n"
        f"🔹 EV SCR: {format_currency(t.ev_scr)}\n"
        f"🔹 SSO: {t.sso} | LSO: {t.lso}\n"
        f"🔹 BSO: {t.bso} | DDSO: {t.ddso}\n"
    )
    
    if t.extra_targets:
        text += "━━━━━━━━━━━━━━━━━━━━━\n"
        text += "➕ **Extra Targets**\n"
        for key, val in t.extra_targets.items():
            text += f"🔹 {key}: {val}\n"

    text += "━━━━━━━━━━━━━━━━━━━━━"
    
    return t, total_count, text

async def get_supervisor_target_full_info(month, year, page=1, total_count=None):
    target_date = datetime(year, month, 1)
    async with async_session() as session:
        if total_count is None:
            count_stmt = select(func.count(SupervisorTarget.id)).where(SupervisorTarget.target_date == target_date)
            total_res = await session.execute(count_stmt)
            total_count = total_res.scalar()

        if total_count == 0:
            return None, 0, f"No supervisor targets found for {month}/{year}."

        stmt = select(SupervisorTarget).options(
            joinedload(SupervisorTarget.house),
            joinedload(SupervisorTarget.employee)
        ).where(SupervisorTarget.target_date == target_date)\
        .order_by(SupervisorTarget.id)\
        .offset(page - 1).limit(1)
        
        result = await session.execute(stmt)
        t = result.scalar_one_or_none()

    if not t:
        return None, total_count, "Target not found."

    h_name = t.house.name if t.house else "Unknown"
    emp_name = t.employee.name if t.employee else "Unknown"
    emp_msisdn = t.employee.pool_number if t.employee else "Unknown"

    text = (
        f"👨‍💼 **Supervisor Target Detail ({month}/{year})**\n"
        f"Page: {page}/{total_count}\n"
        f"━━━━━━━━━━━━━━━━━━━━━\n"
        f"👤 **{emp_name}**\n"
        f"📱 MSISDN: {emp_msisdn}\n"
        f"🏘️ House: {h_name}\n"
        f"━━━━━━━━━━━━━━━━━━━━━\n"
        f"📈 **Target Details**\n"
        f"🔹 Recharge Target: {format_currency(t.total_recharge)}\n"
        f"🔹 GA Target: {t.total_ga} (RSO: {t.rso_ga}, BP: {t.bp_ga})\n"
        f"🔹 EV Secondary: {format_currency(t.ev_secondary)}\n"
        f"🔹 SC Secondary: {format_currency(t.sc_secondary)}\n"
        f"🔹 SSO: {t.sso} | LSO: {t.lso}\n"
        f"🔹 BSO: {t.bso} | DDSO: {t.ddso}\n"
    )
    
    if t.extra_targets:
        text += "━━━━━━━━━━━━━━━━━━━━━\n"
        text += "➕ **Extra Targets**\n"
        for key, val in t.extra_targets.items():
            text += f"🔹 {key}: {val}\n"

    text += "━━━━━━━━━━━━━━━━━━━━━"
    
    return t, total_count, text

async def get_rso_target_full_info(month, year, page=1, total_count=None):
    target_date = datetime(year, month, 1)
    async with async_session() as session:
        if total_count is None:
            count_stmt = select(func.count(RSOTarget.id)).where(RSOTarget.target_date == target_date)
            total_res = await session.execute(count_stmt)
            total_count = total_res.scalar()

        if total_count == 0:
            return None, 0, f"No RSO targets found for {month}/{year}."

        stmt = select(RSOTarget).options(
            joinedload(RSOTarget.house),
            joinedload(RSOTarget.employee)
        ).where(RSOTarget.target_date == target_date)\
        .order_by(RSOTarget.id)\
        .offset(page - 1).limit(1)
        
        result = await session.execute(stmt)
        t = result.scalar_one_or_none()

    if not t:
        return None, total_count, "Target not found."

    h_name = t.house.name if t.house else "Unknown"
    emp_name = t.employee.name if t.employee else "Unknown"
    emp_msisdn = t.employee.itop_number if t.employee else "Unknown"
    emp_code = t.employee.dms_code if t.employee else "Unknown"

    text = (
        f"👤 **RSO Target Detail ({month}/{year})**\n"
        f"Page: {page}/{total_count}\n"
        f"━━━━━━━━━━━━━━━━━━━━━\n"
        f"📱 **{emp_name}** ({emp_code})\n"
        f"📞 MSISDN: {emp_msisdn}\n"
        f"🏘️ House: {h_name}\n"
        f"━━━━━━━━━━━━━━━━━━━━━\n"
        f"📊 **Original Targets**\n"
        f"🔹 Recharge: {format_currency(t.total_recharge)}\n"
        f"🔹 GA: {t.ga}\n"
        f"🔹 EV Secondary: {format_currency(t.ev_secondary)}\n"
        f"🔹 SC Secondary: {format_currency(t.sc_secondary)}\n"
        f"🔹 SSO: {t.sso} | LSO: {t.lso}\n"
        f"🔹 BSO: {t.bso} | DDSO: {t.ddso}\n"
        f"━━━━━━━━━━━━━━━━━━━━━\n"
        f"📈 **Modified Targets**\n"
        f"🔸 Recharge: {format_currency(t.recharge_target_modified)}\n"
        f"🔸 GA: {t.ga_target_modified}\n"
        f"🔸 EV Secondary: {format_currency(t.ev_secondary_modified)}\n"
        f"🔸 SC Secondary: {format_currency(t.sc_secondary_modified)}\n"
        f"🔸 SSO: {t.sso_target_modified} | LSO: {t.lso_target_modified}\n"
        f"🔸 BSO: {t.bso_target_modified} | DDSO: {t.daily_dso_target_modified}\n"
    )
    
    if t.extra_targets:
        text += "━━━━━━━━━━━━━━━━━━━━━\n"
        text += "➕ **Extra Targets**\n"
        for key, val in t.extra_targets.items():
            text += f"🔹 {key}: {val}\n"

    text += "━━━━━━━━━━━━━━━━━━━━━"
    
    return t, total_count, text

async def get_rso_target_by_query(month, year, query):
    target_date = datetime(year, month, 1)
    async with async_session() as session:
        # Search for Employee first
        emp_stmt = select(Employee).where(
            (Employee.dms_code == query) | 
            (Employee.itop_number == query) | 
            (Employee.pool_number == query) |
            (Employee.personal_number == query)
        )
        emp_res = await session.execute(emp_stmt)
        emp = emp_res.scalar_one_or_none()
        
        if not emp:
            return None, "Employee not found with this Code/MSISDN."
            
        # Get target
        stmt = select(RSOTarget).options(
            joinedload(RSOTarget.house),
            joinedload(RSOTarget.employee)
        ).where(
            (RSOTarget.target_date == target_date) & 
            (RSOTarget.employee_id == emp.id)
        )
        
        result = await session.execute(stmt)
        t = result.scalar_one_or_none()
        
    if not t:
        return None, f"No targets found for {emp.name} in {month}/{year}."
        
    # We use page=1 and total_count=1 as it's a specific search
    return await format_rso_target_text(t, month, year, 1, 1)

async def format_rso_target_text(t, month, year, page, total_count):
    h_name = t.house.name if t.house else "Unknown"
    emp_name = t.employee.name if t.employee else "Unknown"
    emp_msisdn = t.employee.itop_number if t.employee else "Unknown"
    emp_code = t.employee.dms_code if t.employee else "Unknown"

    text = (
        f"👤 **RSO Target Detail ({month}/{year})**\n"
        f"Page: {page}/{total_count}\n"
        f"━━━━━━━━━━━━━━━━━━━━━\n"
        f"📱 **{emp_name}** ({emp_code})\n"
        f"📞 MSISDN: {emp_msisdn}\n"
        f"🏘️ House: {h_name}\n"
        f"━━━━━━━━━━━━━━━━━━━━━\n"
        f"📊 **Original Targets**\n"
        f"🔹 Recharge: {format_currency(t.total_recharge)}\n"
        f"🔹 GA: {t.ga}\n"
        f"🔹 EV Secondary: {format_currency(t.ev_secondary)}\n"
        f"🔹 SC Secondary: {format_currency(t.sc_secondary)}\n"
        f"🔹 SSO: {t.sso} | LSO: {t.lso}\n"
        f"🔹 BSO: {t.bso} | DDSO: {t.ddso}\n"
        f"━━━━━━━━━━━━━━━━━━━━━\n"
        f"📈 **Modified Targets**\n"
        f"🔸 Recharge: {format_currency(t.recharge_target_modified)}\n"
        f"🔸 GA: {t.ga_target_modified}\n"
        f"🔸 EV Secondary: {format_currency(t.ev_secondary_modified)}\n"
        f"🔸 SC Secondary: {format_currency(t.sc_secondary_modified)}\n"
        f"🔸 SSO: {t.sso_target_modified} | LSO: {t.lso_target_modified}\n"
        f"🔸 BSO: {t.bso_target_modified} | DDSO: {t.daily_dso_target_modified}\n"
    )
    
    if t.extra_targets:
        text += "━━━━━━━━━━━━━━━━━━━━━\n"
        text += "➕ **Extra Targets**\n"
        for key, val in t.extra_targets.items():
            text += f"🔹 {key}: {val}\n"

    text += "━━━━━━━━━━━━━━━━━━━━━"
    return t, total_count, text

async def get_house_target_summary(month, year, house_code=None):
    target_date = datetime(year, month, 1)
    async with async_session() as session:
        stmt = select(HouseTarget).options(selectinload(HouseTarget.house)).where(HouseTarget.target_date == target_date)
        if house_code:
            h_res = await session.execute(select(House).where(House.code == house_code))
            house = h_res.scalar_one_or_none()
            if not house: return None, "হাউজ পাওয়া যায়নি।"
            stmt = stmt.where(HouseTarget.house_id == house.id)
            
        result = await session.execute(stmt)
        targets = result.scalars().all()
        
    if not targets:
        return None, f"{month}/{year} মাসের জন্য কোনো হাউজ টার্গেট পাওয়া যায়নি।"
    
    text = f"🏠 **House Target Summary ({month}/{year})**\n━━━━━━━━━━━━━━━━━━━━━\n"
    for t in targets:
        text += (
            f"🏘️ **{t.house.name}**\n"
            f"🔹 Recharge: {format_currency(t.total_recharge_target)}\n"
            f"🔹 GA: {bn_num(t.total_ga_target)} (RSO: {bn_num(t.rso_ga)}, BP: {bn_num(t.bp_ga)})\n"
            f"🔹 SSO: {bn_num(t.sso)} | ALSO: {bn_num(t.lso)}\n"
            f"━━━━━━━━━━━━━━━━━━━━━\n"
        )
    return targets, text

async def get_supervisor_target_summary(month, year, house_code=None):
    target_date = datetime(year, month, 1)
    async with async_session() as session:
        stmt = select(SupervisorTarget).options(
            selectinload(SupervisorTarget.house),
            selectinload(SupervisorTarget.employee)
        ).where(SupervisorTarget.target_date == target_date)
        
        if house_code:
            h_res = await session.execute(select(House).where(House.code == house_code))
            house = h_res.scalar_one_or_none()
            if house:
                stmt = stmt.where(SupervisorTarget.house_id == house.id)
        
        result = await session.execute(stmt)
        targets = result.scalars().all()
        
    if not targets:
        return None, f"{month}/{year} মাসের জন্য কোনো সুপারভাইজার টার্গেট পাওয়া যায়নি।"
    
    text = f"👨‍💼 **Supervisor Target Summary ({month}/{year})**\n━━━━━━━━━━━━━━━━━━━━━\n"
    for t in targets:
        name = t.employee.name if t.employee else "Unknown"
        h_name = t.house.name if t.house else "Unknown"
        text += (
            f"👤 **{name}** ({h_name})\n"
            f"🔹 Recharge: {format_currency(t.total_recharge)}\n"
            f"🔹 GA: {bn_num(t.total_ga)} (RSO: {bn_num(t.rso_ga)}, BP: {bn_num(t.bp_ga)})\n"
            f"🔹 BSO: {bn_num(t.bso)} | DDSO: {bn_num(t.ddso)}\n"
            f"━━━━━━━━━━━━━━━━━━━━━\n"
        )
    return targets, text

async def get_rso_target_summary(month, year, supervisor_msisdn=None, house_code=None):
    target_date = datetime(year, month, 1)
    async with async_session() as session:
        stmt = select(RSOTarget).options(
            selectinload(RSOTarget.house),
            selectinload(RSOTarget.employee)
        ).where(RSOTarget.target_date == target_date)
        
        if house_code:
            h_res = await session.execute(select(House).where(House.code == house_code))
            house = h_res.scalar_one_or_none()
            if not house: return None, "হাউজ পাওয়া যায়নি।"
            stmt = stmt.where(RSOTarget.house_id == house.id)
            
        # Limit text summary to top 10 for RSO to avoid long messages
        result = await session.execute(stmt.limit(10))
        targets = result.scalars().all()
        
    if not targets:
        return None, f"{month}/{year} মাসের জন্য কোনো RSO টার্গেট পাওয়া যায়নি।"
    
    text = f"👤 **RSO Target Summary ({month}/{year})**\n"
    text += "━━━━━━━━━━━━━━━━━━━━━\n"
    
    for t in targets:
        text += (
            f"📱 **{t.employee.name}** ({t.employee.dms_code})\n"
            f"🔹 Recharge: {format_currency(t.total_recharge)}\n"
            f"🔹 GA: {bn_num(t.ga)}\n"
            f"🔹 APP GA: {bn_num(t.ga_target_modified)}\n"
            f"━━━━━━━━━━━━━━━━━━━━━\n"
        )
    if len(targets) == 10:
        text += "*(শুধু প্রথম ১০ জনের তথ্য দেখানো হয়েছে, সম্পূর্ণ দেখতে এক্সেল ডাউনলোড করুন)*"
    
    return targets, text

async def export_targets_to_excel(month, year, target_type, house_code=None):
    target_date = datetime(year, month, 1)
    async with async_session() as session:
        house_id = None
        if house_code:
            h_res = await session.execute(select(House).where(House.code == house_code))
            house = h_res.scalar_one_or_none()
            if house: house_id = house.id

        if target_type == 'house':
            stmt = select(HouseTarget).options(selectinload(HouseTarget.house)).where(HouseTarget.target_date == target_date)
            if house_id: stmt = stmt.where(HouseTarget.house_id == house_id)
            model = HouseTarget
        elif target_type == 'supervisor':
            stmt = select(SupervisorTarget).options(selectinload(SupervisorTarget.house), selectinload(SupervisorTarget.employee)).where(SupervisorTarget.target_date == target_date)
            if house_id: stmt = stmt.where(SupervisorTarget.house_id == house_id)
            model = SupervisorTarget
        elif target_type == 'rso':
            stmt = select(RSOTarget).options(
                selectinload(RSOTarget.house),
                selectinload(RSOTarget.employee)
            ).where(RSOTarget.target_date == target_date)
            if house_id: stmt = stmt.where(RSOTarget.house_id == house_id)
            model = RSOTarget
        else:
            return None
            
        result = await session.execute(stmt)
        targets = result.scalars().all()
        
    if not targets:
        return None
    
    data = []
    for t in targets:
        d = {c.name: getattr(t, c.name) for c in model.__table__.columns}
        
        if target_type == 'house':
            d['house_code'] = t.house.code if t.house else ""
            d['house_name'] = t.house.name if t.house else ""
        elif target_type == 'supervisor':
            d['house_code'] = t.house.code if t.house else ""
            d['supervisor_name'] = t.employee.name if t.employee else ""
            d['supervisor_msisdn'] = t.employee.itop_number if t.employee else ""
        elif target_type == 'rso':
            d['house_code'] = t.house.code if t.house else ""
            d['rso_code'] = t.employee.dms_code if t.employee else ""
            d['rso_name'] = t.employee.name if t.employee else ""
            d['rso_msisdn'] = t.employee.itop_number if t.employee else ""
            
        d.pop('id', None)
        d.pop('created_at', None)
        d.pop('updated_at', None)
        d.pop('house_id', None)
        d.pop('employee_id', None)
        d.pop('supervisor_id', None)
        data.append(d)
        
    df = pd.DataFrame(data)
    file_path = f"temp_export_{target_type}_{month}_{year}.xlsx"
    df.to_excel(file_path, index=False)
    return file_path
