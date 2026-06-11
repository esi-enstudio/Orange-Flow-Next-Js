import pandas as pd
import logging
from sqlalchemy import select, func
from sqlalchemy.dialects.postgresql import insert
from passlib.context import CryptContext

from app.models.user import User, user_roles, user_houses
from app.models.role import Role
from app.models.house import House
from app.services.db_service import async_session

logger = logging.getLogger(__name__)
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def get_password_hash(password):
    return pwd_context.hash(password)

async def process_user_excel(file_path, progress_callback=None):
    """Process Excel for bulk User Import"""
    try:
        df = pd.read_excel(file_path, dtype=str)
        df.columns = [c.strip().upper().replace(" ", "_") for c in df.columns]
        
        total_rows = len(df)
        if total_rows == 0:
            return 0, 0, "No data found in file."

        def clean(val):
            v = str(val).strip()
            if v == "" or v.lower() in ["nan", "none", "null", "0"]:
                return None
            return v

        async with async_session() as session:
            # Load Roles and Houses for mapping
            roles_res = await session.execute(select(Role))
            roles_map = {r.name.lower(): r.id for r in roles_res.scalars().all()}
            
            houses_res = await session.execute(select(House))
            houses_map = {h.code.upper(): h.id for h in houses_res.scalars().all()}

            success_count = 0
            error_count = 0
            
            for index, row in df.iterrows():
                username = clean(row.get('USERNAME'))
                if not username:
                    error_count += 1
                    continue
                
                try:
                    # Check if user exists
                    res = await session.execute(select(User).where(User.username == username))
                    user = res.scalar_one_or_none()
                    
                    telegram_id = clean(row.get('TELEGRAM_ID'))
                    if telegram_id:
                        telegram_id = int(float(telegram_id))

                    if not user:
                        password = clean(row.get('PASSWORD')) or "User#1234"
                        user = User(
                            username=username,
                            hashed_password=get_password_hash(password),
                            name=clean(row.get('NAME')),
                            email=clean(row.get('EMAIL')),
                            phone_number=clean(row.get('PHONE_NUMBER')),
                            telegram_id=telegram_id,
                            status=clean(row.get('STATUS')) or "Active"
                        )
                        session.add(user)
                        await session.flush() # Get user ID
                    else:
                        user.name = clean(row.get('NAME')) or user.name
                        user.email = clean(row.get('EMAIL')) or user.email
                        user.phone_number = clean(row.get('PHONE_NUMBER')) or user.phone_number
                        user.telegram_id = telegram_id or user.telegram_id
                        user.status = clean(row.get('STATUS')) or user.status
                    
                    # Process Roles (from "ROLE" column)
                    role_names = clean(row.get('ROLE'))
                    if role_names:
                        names = [n.strip().lower() for n in role_names.split(',')]
                        role_ids = [roles_map[n] for n in names if n in roles_map]
                        if role_ids:
                            await session.execute(user_roles.delete().where(user_roles.c.user_id == user.id))
                            for rid in role_ids:
                                await session.execute(user_roles.insert().values(user_id=user.id, role_id=rid))

                    # Process Houses (from "HOUSE_CODE" column)
                    house_codes = clean(row.get('HOUSE_CODE'))
                    if house_codes:
                        codes = [c.strip().upper() for c in house_codes.split(',')]
                        house_ids = [houses_map[c] for c in codes if c in houses_map]
                        if house_ids:
                            await session.execute(user_houses.delete().where(user_houses.c.user_id == user.id))
                            for hid in house_ids:
                                await session.execute(user_houses.insert().values(user_id=user.id, house_id=hid))

                    success_count += 1
                except Exception as e:
                    logger.error(f"Row {index} error: {e}")
                    error_count += 1

                if progress_callback and (index + 1) % 5 == 0:
                    pct = min(int((index + 1) / total_rows * 100), 100)
                    await progress_callback(f"{pct}% — {index + 1}/{total_rows} users")

            await session.commit()
            return success_count, error_count, None

    except Exception as e:
        logger.error(f"User Excel Error: {e}")
        return 0, 0, str(e)

async def export_users_excel(users):
    """Export list of users to Excel"""
    data = []
    for u in users:
        data.append({
            'USERNAME': u.username,
            'NAME': u.name,
            'EMAIL': u.email,
            'PHONE_NUMBER': u.phone_number,
            'STATUS': u.status,
            'ROLES': ", ".join([r.name for r in u.roles]),
            'HOUSES': ", ".join([h.code for h in u.houses]),
            'CREATED_AT': u.created_at.strftime("%Y-%m-%d %H:%M") if u.created_at else ""
        })
    
    df = pd.DataFrame(data)
    import io
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        df.to_excel(writer, index=False, sheet_name='Users')
    return output.getvalue()
