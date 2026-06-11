from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.models.user import User
from app.models.house import House
from app.services.db_service import async_session

async def get_dms_credentials(house_id: int):
    """Common function to get DMS credentials by house ID"""
    async with async_session() as session:
        # Fetching data directly from house table by ID
        house = await session.get(House, house_id)
        
        if not house:
            return None, "❌ House not found."

        # Check required DMS information
        if not all([house.dms_user, house.dms_pass, house.dms_house_id]):
            return None, f"❌ DMS Credentials not set for house '{house.name}'."

        return {
            "user": house.dms_user,
            "pass": house.dms_pass,
            "house_id": house.dms_house_id,
            "house_name": house.name,
            "code": house.code
        }, None

async def get_user_houses(telegram_id: int):
    """Function to get all houses linked to user"""
    async with async_session() as session:
        result = await session.execute(
            select(User).options(selectinload(User.houses)).where(User.telegram_id == telegram_id)
        )
        user = result.scalar_one_or_none()
        
        if not user:
            return [], "❌ User not found."
        
        if not user.houses:
            return [], "❌ No houses linked to your account."

        return user.houses, None
    
def bn_num(number):
    """Convert number to string"""
    return str(number)





def get_employee_full_profile_text(m):
    """Format employee detailed profile in HTML"""
    def clean(val):
        return str(val) if val and str(val).lower() != 'nan' else "N/A"
    
    return (
        f"👥 **Employee Profile Details**\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"<b>🆔 Basic Info:</b>\n"
        f"🔹 Name: {m.user.name if m.user else m.dms_code}\n"
        f"🔹 DMS Code: `{m.dms_code}`\n"
        f"🔹 Own Code: `{clean(m.assisted_retailer_code)}`\n"
        f"🔹 ITop Number: {clean(m.itop_number)}\n"
        f"🔹 Personal No: {clean(m.personal_number)}\n"
        f"🔹 Pool Number: {clean(m.pool_number)}\n"
        f"🔹 Status: {m.status}\n\n"
        
        f"<b>🏦 Bank Details:</b>\n"
        f"🔹 Bank: {clean(m.bank_name)}\n"
        f"🔹 Account: {clean(m.bank_account)}\n"
        f"🔹 Branch: {clean(m.branch_name)}\n"
        f"🔹 Routing No: {clean(m.routing_number)}\n\n"
        
        f"<b>👤 Personal Info:</b>\n"
        f"🔹 Father's Name: {clean(m.fathers_name)}\n"
        f"🔹 Mother's Name: {clean(m.mothers_name)}\n"
        f"🔹 Blood Group: {clean(m.blood_group)}\n"
        f"🔹 Religion: {clean(m.religion)} | NID: {clean(m.nid)}\n"
        f"🔹 Date of Birth: {clean(m.dob)}\n"
        f"🔹 Home Town: {clean(m.home_town)}\n\n"
        
        f"<b>🎓 Education & Experience:</b>\n"
        f"🔹 Last Education: {clean(m.last_education)}\n"
        f"🔹 Institution: {clean(m.institution_name)}\n"
        f"🔹 Previous Company: {clean(m.previous_company_name)}\n"
        f"🔹 Previous Salary: {clean(m.previous_company_salary)}\n\n"
        
        f"<b>🛠 Official & Others:</b>\n"
        f"🔹 Joining: {clean(m.joining_date)}\n"
        f"🔹 Salary: {clean(m.salary)}\n"
        f"🔹 Market Type: {clean(m.market_type)}\n"
        f"🔹 Bike: {clean(m.motor_bike)} | Cycle: {clean(m.bicyle)}\n"
        f"🔹 License: {clean(m.driving_license)}\n"
        f"🔹 Address: {clean(m.present_address)}\n"
        f"━━━━━━━━━━━━━━━━━━━━"
    )


def get_retailer_full_profile_text(r):
    """Format all retailer data in employee style"""
    def clean(val):
        return str(val) if val and str(val).lower() != 'nan' else "N/A"
    
    # Get RSO (SR) name (if linked)
    sr_name = r.employee.user.name if r.employee and r.employee.user else (r.employee.dms_code if r.employee else "Not Assigned")

    return (
        f"🏪 **Retailer Profile Details**\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"<b>🆔 Basic Info:</b>\n"
        f"🔹 Name: {r.name}\n"
        f"🔹 Code: `{r.retailer_code}`\n"
        f"🔹 Assigned SR: <b>{sr_name}</b>\n"
        f"🔹 Retailer Type: {clean(r.type)}\n"
        f"🔹 Active: {clean(r.enabled)}\n\n"
        
        f"<b>📞 Contact & Mobile:</b>\n"
        f"🔹 Phone No: {clean(r.contact_no)}\n"
        f"🔹 iTop Number: {clean(r.itop_number)}\n"
        f"🔹 iTop SR No: {clean(r.itop_sr_number)}\n"
        f"🔹 Tran Mobile: {clean(r.tran_mobile_no)}\n\n"
        
        f"<b>📍 Address & Location:</b>\n"
        f"🔹 Thana: {clean(r.thana)}\n"
        f"🔹 District: {clean(r.district)}\n"
        f"🔹 Route: {clean(r.route)}\n"
        f"🔹 Full Address: {clean(r.address)}\n\n"
        
        f"<b>💼 Business & Personal:</b>\n"
        f"🔹 Owner's Name: {clean(r.owner_name)}\n"
        f"🔹 NID: {clean(r.nid)}\n"
        f"🔹 Date of Birth: {clean(r.dob)}\n"
        f"🔹 Category: {clean(r.category)}\n"
        f"🔹 Service Point: {clean(r.service_point)}\n"
        f"🔹 SIM Seller: {clean(r.sim_seller)}\n\n"
        
        f"<b>👷‍♂️ BP Connection:</b>\n"
        f"🔹 BP Code: {clean(r.bp_code)}\n"
        f"🔹 BP Number: {clean(r.bp_number)}\n"
        f"━━━━━━━━━━━━━━━━━━━━"
    )
    
    
def get_house_full_profile_text(h):
    """Format all house data in retailer & field force style"""
    def clean(val):
        return str(val) if val and str(val).lower() != 'nan' else "N/A"
    
    # Status and subscription date formatting
    status = "Active ✅" if h.is_active else "Deactive ❌"
    sub_date = h.subscription_date.strftime('%d-%m-%Y') if h.subscription_date else "N/A"

    return (
        f"🏢 <b>House Profile Details</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"<b>🆔 Basic Info:</b>\n"
        f"🔹 Name: {h.name}\n"
        f"🔹 Code: <code>{h.code}</code>\n"
        f"🔹 Status: {status}\n\n"
        
        f"<b>📍 Location & Cluster:</b>\n"
        f"🔹 Cluster: {clean(h.cluster)}\n"
        f"🔹 Region: {clean(h.region)}\n\n"
        
        f"<b>📞 Contact & Address:</b>\n"
        f"🔹 Contact No: {clean(h.contact)}\n"
        f"🔹 Email: {clean(h.email)}\n"
        f"🔹 Address: {clean(h.address)}\n\n"
        
        f"<b>🔐 DMS Credentials:</b>\n"
        f"🔹 Username: <code>{clean(h.dms_user)}</code>\n"
        f"🔹 Password: <code>{clean(h.dms_pass)}</code>\n"
        f"🔹 House ID: <code>{clean(h.dms_house_id)}</code>\n\n"
        
        f"<b>📅 Subscription:</b>\n"
        f"🔹 Expiry: <b>{sub_date}</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━"
    )