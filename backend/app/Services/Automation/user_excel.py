import pandas as pd
import os
import asyncio
import logging
from tqdm import tqdm
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload

from app.Models.user import User
from app.Models.role import Role, Permission
from app.Models.house import House
from app.Services.db_service import async_session
from app.Utils.helpers import bn_num

logger = logging.getLogger(__name__)

USER_COLUMNS = ['TELEGRAM_ID', 'NAME', 'PHONE_NUMBER', 'ROLE', 'DD_CODE', 'STATUS']

async def process_user_excel(file_path, house_id, progress_callback=None):
    """উন্নত বাল্ক ইউজার প্রসেসিং (ব্যাচ লোডিং এবং এসিঙ্ক সেফ রিলেশনশিপসহ) ✅"""
    try:
        df = pd.read_excel(file_path, dtype=str)
        df.columns = [c.strip().upper().replace(" ", "_") for c in df.columns]
        
        total_rows = len(df)
        if total_rows == 0: return 0, "ফাইলটিতে কোনো ডাটা পাওয়া যায়নি।"

        def clean(val):
            if pd.isna(val): return None
            v = str(val).strip()
            if v == "" or v.lower() in ["nan", "none", "null"]:
                return None
            return v

        async with async_session() as session:
            # ১. প্রয়োজনীয় রেফারেন্স ডাটা একবারে লোড করা
            all_perms_res = await session.execute(select(Permission))
            all_perms = all_perms_res.scalars().all()
            
            roles_res = await session.execute(select(Role).options(selectinload(Role.permissions)))
            role_map = {r.name.upper(): r for r in roles_res.scalars().all() if r.name}
            
            houses_res = await session.execute(select(House))
            house_map = {h.code.upper(): h for h in houses_res.scalars().all() if h.code}
            
            manual_selected_house = await session.get(House, house_id)

            # ২. এক্সেলের সব টেলিগ্রাম আইডি সংগ্রহ করা (ব্যাচ কুয়েরির জন্য)
            tg_ids = []
            valid_rows = []
            for index, row in df.iterrows():
                tg_id_raw = clean(row.get('TELEGRAM_ID'))
                if tg_id_raw:
                    try:
                        tid = int(float(tg_id_raw))
                        tg_ids.append(tid)
                        valid_rows.append((tid, row))
                    except: continue
            
            if not tg_ids: return 0, "ফাইলে কোনো সঠিক টেলিগ্রাম আইডি পাওয়া যায়নি।"

            # ৩. ডাটাবেজ থেকে বিদ্যমান ইউজারদের একবারে লোড করা (ইগার লোডিংসহ)
            existing_users_res = await session.execute(
                select(User)
                .options(selectinload(User.roles), selectinload(User.houses))
                .where(User.telegram_id.in_(tg_ids))
            )
            user_cache = {u.telegram_id: u for u in existing_users_res.scalars().all()}

            count = 0
            pbar = tqdm(total=total_rows, desc="👤 User Uploading", unit="row")

            for tg_id, row in valid_rows:
                name = clean(row.get('NAME'))
                phone = clean(row.get('PHONE_NUMBER'))
                role_names_raw = clean(row.get('ROLE'))
                dd_codes_raw = clean(row.get('DD_CODE')) or clean(row.get('HOUSE_CODE'))
                
                if not name or not role_names_raw:
                    pbar.update(1)
                    continue
                
                # ৪. রোল প্রসেসিং
                role_names = [rn.strip() for rn in role_names_raw.split(',')]
                target_roles = []
                for rn in role_names:
                    rn_upper = rn.upper()
                    r_obj = role_map.get(rn_upper)
                    if not r_obj:
                        r_obj = Role(name=rn.title())
                        session.add(r_obj)
                        await session.flush()
                        if rn.title() in ["Admin", "Manager"]:
                            r_obj.permissions = all_perms
                        role_map[rn_upper] = r_obj
                    target_roles.append(r_obj)
                
                # ৫. হাউজ প্রসেসিং
                target_houses = []
                if dd_codes_raw:
                    d_codes = [hc.strip().upper() for hc in dd_codes_raw.split(',')]
                    for hc in d_codes:
                        h_obj = house_map.get(hc)
                        if h_obj: target_houses.append(h_obj)
                
                if not target_houses and manual_selected_house:
                    target_houses.append(manual_selected_house)

                # ৬. ফোন নাম্বার ফরম্যাটিং
                if phone:
                    phone = phone.replace(".0", "")
                    if not phone.startswith('0'): phone = f"0{phone}"

                # ৭. ইউজার ক্রিয়েশন বা আপডেট
                user = user_cache.get(tg_id)
                is_new_user = False
                if not user:
                    user = User(
                        telegram_id=tg_id,
                        name=name,
                        phone_number=phone,
                        status=clean(row.get('STATUS')) or "Active"
                    )
                    session.add(user)
                    is_new_user = True
                    # রিলেশনশিপ সেট করার আগে এটি এনশিওর করা যে কালেকশনগুলো ইনিশিয়ালাইজড
                    user.roles = target_roles
                    user.houses = target_houses
                else:
                    user.name = name
                    user.phone_number = phone
                    user.status = clean(row.get('STATUS')) or "Active"
                    
                    # বিদ্যমান রিলেশনশিপ আপডেট (Lazy Load এড়াতে আইডি দিয়ে চেক)
                    curr_role_ids = {r.id for r in user.roles}
                    for r_obj in target_roles:
                        if r_obj.id not in curr_role_ids:
                            user.roles.append(r_obj)
                    
                    curr_house_ids = {h.id for h in user.houses}
                    for h_obj in target_houses:
                        if h_obj.id not in curr_house_ids:
                            user.houses.append(h_obj)

                # ৮. অটো-লিঙ্ক লজিক (Employee এর সাথে) ✅
                if phone:
                    await session.flush() # ইউজার আইডি জেনারেট করার জন্য
                    clean_phone_tail = phone[-10:]
                    
                    # ডাটাবেজে এই ফোন নাম্বারের কোনো এমপ্লয়ী আছে কি না চেক করা
                    from app.Models.employee import Employee
                    from sqlalchemy import or_
                    
                    emp_res = await session.execute(
                        select(Employee).where(
                            or_(
                                Employee.personal_number.like(f"%{clean_phone_tail}"),
                                Employee.itop_number.like(f"%{clean_phone_tail}")
                            ),
                            Employee.user_id == None # যদি আগে লিঙ্ক না থাকে
                        )
                    )
                    emp_member = emp_res.scalar_one_or_none()
                    if emp_member:
                        emp_member.user_id = user.id
                        logger.info(f"🔗 Auto-linked User {user.name} to Employee {emp_member.name}")

                count += 1
                pbar.update(1)
                if progress_callback and (count % 10 == 0 or count == total_rows):
                    await update_progress_user(count, total_rows, progress_callback)

            pbar.close()
            await session.commit()
            return count, None

    except Exception as e:
        logger.error(f"❌ User Excel Processing Error: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return 0, f"প্রসেসিং এরর: {str(e)}"

async def update_progress_user(count, total_rows, progress_callback):
    percent = round((count / total_rows) * 100)
    await progress_callback(
        f"📊 <b>ইউজার আপলোড প্রগ্রেস:</b> {bn_num(percent)}%\n"
        f"📈 প্রসেস হয়েছে: <code>{bn_num(count)}</code> / <code>{bn_num(total_rows)}</code>"
    )
