import pandas as pd
import os
from sqlalchemy import select
from app.Models.house_target import HouseTarget
from app.Models.supervisor_target import SupervisorTarget
from app.Models.rso_target import RSOTarget
from app.Services.db_service import async_session
from app.Utils.helpers import bn_num

def format_currency(val):
    return f"{float(val):,.2f}"

from sqlalchemy.orm import selectinload
from app.Models.house import House
from app.Models.field_force import FieldForce

async def get_house_target_summary(month, year, house_code=None):
    async with async_session() as session:
        stmt = select(HouseTarget).options(selectinload(HouseTarget.house)).where(HouseTarget.month == month, HouseTarget.year == year)
        if house_code:
            # First find house id
            h_res = await session.execute(select(House).where(House.code == house_code))
            house = h_res.scalar_one_or_none()
            if not house: return None, "হাউজ পাওয়া যায়নি।"
            stmt = stmt.where(HouseTarget.house_id == house.id)
            
        result = await session.execute(stmt)
        targets = result.scalars().all()
        
    if not targets:
        return None, "এই মাসের জন্য কোনো হাউজ টার্গেট পাওয়া যায়নি।"
    
    text = f"🏠 **House Target Summary ({month}/{year})**\n━━━━━━━━━━━━━━━━━━━━━\n"
    for t in targets:
        text += (
            f"🏘️ **{t.house.name}**\n"
            f"🔹 Recharge: {format_currency(t.total_recharge_target)}\n"
            f"🔹 GA: {bn_num(t.total_ga_target)} (RSO: {bn_num(t.rso_ga)}, BP: {bn_num(t.bp_ga)})\n"
            f"🔹 SSO: {bn_num(t.sso)} | ALSO: {bn_num(t.also)}\n"
            f"━━━━━━━━━━━━━━━━━━━━━\n"
        )
    return targets, text

async def get_supervisor_target_summary(month, year, house_code=None):
    async with async_session() as session:
        stmt = select(SupervisorTarget).where(SupervisorTarget.month == month, SupervisorTarget.year == year)
        if house_code:
            stmt = stmt.where(SupervisorTarget.house_code == house_code)
        result = await session.execute(stmt)
        targets = result.scalars().all()
        
    if not targets:
        return None, "এই মাসের জন্য কোনো সুপারভাইজার টার্গেট পাওয়া যায়নি।"
    
    text = f"👨‍💼 **Supervisor Target Summary ({month}/{year})**\n━━━━━━━━━━━━━━━━━━━━━\n"
    for t in targets:
        # Note: SupervisorTarget schema was not changed yet by user request
        text += (
            f"👤 **{t.supervisor_name}** ({t.house_name})\n"
            f"🔹 Recharge: {format_currency(t.total_recharge)}\n"
            f"🔹 GA: {bn_num(t.total_ga)} (RSO: {bn_num(t.ga_rso)}, BP: {bn_num(t.bp_ga)})\n"
            f"🔹 BSO: {bn_num(t.bso)} | DDSO: {bn_num(t.ddso)}\n"
            f"━━━━━━━━━━━━━━━━━━━━━\n"
        )
    return targets, text

async def get_rso_target_summary(month, year, supervisor_msisdn=None, house_code=None):
    async with async_session() as session:
        stmt = select(RSOTarget).options(
            selectinload(RSOTarget.house),
            selectinload(RSOTarget.field_force)
        ).where(RSOTarget.month == month, RSOTarget.year == year)
        
        if supervisor_msisdn:
            stmt = stmt.where(RSOTarget.supervisor_msisdn == supervisor_msisdn)
        
        if house_code:
            h_res = await session.execute(select(House).where(House.code == house_code))
            house = h_res.scalar_one_or_none()
            if not house: return None, "হাউজ পাওয়া যায়নি।"
            stmt = stmt.where(RSOTarget.house_id == house.id)
            
        # Limit text summary to top 10 for RSO to avoid long messages
        result = await session.execute(stmt.limit(10))
        targets = result.scalars().all()
        
    if not targets:
        return None, "এই মাসের জন্য কোনো RSO টার্গেট পাওয়া যায়নি।"
    
    text = f"👤 **RSO Target Summary ({month}/{year})**\n"
    if supervisor_msisdn:
        text += f"Supervisor MSISDN: {supervisor_msisdn}\n"
    text += "━━━━━━━━━━━━━━━━━━━━━\n"
    
    for t in targets:
        text += (
            f"📱 **{t.field_force.name}** ({t.field_force.dms_code})\n"
            f"🔹 Recharge: {format_currency(t.total_recharge)}\n"
            f"🔹 GA: {bn_num(t.ga_rso)}\n"
            f"🔹 APP GA: {bn_num(t.ga_target_app)}\n"
            f"━━━━━━━━━━━━━━━━━━━━━\n"
        )
    if len(targets) == 10:
        text += "*(শুধু প্রথম ১০ জনের তথ্য দেখানো হয়েছে, সম্পূর্ণ দেখতে এক্সেল ডাউনলোড করুন)*"
    
    return targets, text

async def export_targets_to_excel(month, year, target_type, house_code=None):
    async with async_session() as session:
        house_id = None
        if house_code:
            h_res = await session.execute(select(House).where(House.code == house_code))
            house = h_res.scalar_one_or_none()
            if house: house_id = house.id

        if target_type == 'house':
            stmt = select(HouseTarget).options(selectinload(HouseTarget.house)).where(HouseTarget.month == month, HouseTarget.year == year)
            if house_id: stmt = stmt.where(HouseTarget.house_id == house_id)
            model = HouseTarget
        elif target_type == 'supervisor':
            stmt = select(SupervisorTarget).where(SupervisorTarget.month == month, SupervisorTarget.year == year)
            if house_code: stmt = stmt.where(SupervisorTarget.house_code == house_code)
            model = SupervisorTarget
        elif target_type == 'rso':
            stmt = select(RSOTarget).options(
                selectinload(RSOTarget.house),
                selectinload(RSOTarget.field_force)
            ).where(RSOTarget.month == month, RSOTarget.year == year)
            if house_id: stmt = stmt.where(RSOTarget.house_id == house_id)
            model = RSOTarget
        else:
            return None
            
        result = await session.execute(stmt)
        targets = result.scalars().all()
        
    if not targets:
        return None
    
    # Convert SQLAlchemy objects to list of dicts for pandas
    data = []
    for t in targets:
        d = {c.name: getattr(t, c.name) for c in model.__table__.columns}
        
        # Add descriptive columns back for the Excel report
        if target_type == 'house':
            d['house_code'] = t.house.code
            d['house_name'] = t.house.name
            d['cluster'] = t.house.cluster
            d['region'] = t.house.region
        elif target_type == 'rso':
            d['house_code'] = t.house.code
            d['house_name'] = t.house.name
            d['rso_code'] = t.field_force.dms_code
            d['rso_name'] = t.field_force.name
            d['rso_msisdn'] = t.field_force.itop_number
            
        # Remove internal columns
        d.pop('id', None)
        d.pop('created_at', None)
        d.pop('updated_at', None)
        d.pop('house_id', None)
        d.pop('field_force_id', None)
        data.append(d)
        
    df = pd.DataFrame(data)
    file_path = f"temp_export_{target_type}_{month}_{year}.xlsx"
    df.to_excel(file_path, index=False)
    return file_path
