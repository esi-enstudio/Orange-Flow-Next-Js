import logging
from datetime import datetime
from aiogram import BaseMiddleware
from aiogram.types import Message, CallbackQuery
from aiogram.dispatcher.flags import get_flag
from typing import Any, Callable, Dict, Awaitable
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.Services.db_service import async_session
from app.Models.user import User
from app.Models.role import Role, Permission
from config.settings import SUPER_ADMIN_ID

logger = logging.getLogger(__name__)

class ACLMiddleware(BaseMiddleware):
    async def __call__(
        self,
        handler: Callable[[Message, Dict[str, Any]], Awaitable[Any]],
        event: Message | CallbackQuery,
        data: Dict[str, Any]
    ) -> Any:
        user_tg_id = event.from_user.id
        required_permission = get_flag(data, "permission")
        today = datetime.now().date()
        
        # ১. সুপার এডমিন কি না তা নির্ধারণ ✅
        is_super_admin = (int(user_tg_id) == int(SUPER_ADMIN_ID))

        async with async_session() as session:
            # ২. ডাটাবেজ থেকে ইউজার প্রোফাইল লোড করা
            result = await session.execute(
                select(User)
                .options(
                    selectinload(User.roles).selectinload(Role.permissions),
                    selectinload(User.houses)
                )
                .where(User.telegram_id == user_tg_id)
            )
            user = result.scalar_one_or_none()

            # ৩. পারমিশন লিস্ট প্রিপারেশন
            user_permissions = []
            if is_super_admin:
                # সুপার এডমিনের জন্য সকল পারমিশন ডাটাবেজ থেকে নেওয়া
                all_perms_res = await session.execute(select(Permission.name))
                user_permissions = [p[0] for p in all_perms_res.all()]
            elif user:
                for role in user.roles:
                    for perm in role.permissions:
                        user_permissions.append(perm.name)
            
            # মেমোরিতে পারমিশন পাস করা (যাতে বাটন জেনারেট হতে পারে)
            data["permissions"] = list(set(user_permissions))

            # ৪. সুপার এডমিন বাইপাস লজিক (সবচেয়ে গুরুত্বপূর্ণ) ✅
            # যদি ইউজার সুপার এডমিন হয়, তবে নিচের সকল চেক (Status, Perm, Sub) স্কিপ করে সরাসরি হ্যান্ডলারে যাবে।
            if is_super_admin:
                return await handler(event, data)

            # ৫. সাধারণ ইউজারদের জন্য সিকিউরিটি চেক
            
            # ক. রেজিস্ট্রেশন চেক
            event_text = event.text if isinstance(event, Message) else None
            if not user:
                if event_text == "/start": 
                    return await handler(event, data)
                return await event.answer("🚫 আপনি নিবন্ধিত ইউজার নন। এডমিনের সাথে যোগাযোগ করুন।")
            
            # খ. একাউন্ট স্ট্যাটাস চেক (case-insensitive)
            if hasattr(user, 'status') and user.status and user.status.lower() != "active":
                return await event.answer("🚫 আপনার অ্যাকাউন্টটি বর্তমানে স্থগিত (Inactive) আছে। অ্যাডমিনের সাথে যোগাযোগ করুন।")

            # গ. রিকোয়ার্ড পারমিশন চেক (Flags)
            if required_permission:
                if required_permission not in user_permissions:
                    return await event.answer(f"❌ আপনার এই কাজটি করার অনুমতি নেই।")

                # ঘ. সাবস্ক্রিপশন এবং হাউজ স্ট্যাটাস চেক
                active_valid_houses = [
                    h for h in user.houses
                    if h.is_active and h.subscription_date and h.subscription_date >= datetime.now()
                ]
                
                if not active_valid_houses:
                    return await event.answer(
                        "⚠️ আপনার হাউজের সাবস্ক্রিপশনের মেয়াদ শেষ হয়ে গেছে অথবা হাউজটি বন্ধ আছে।"
                    )

        # সব বাধা পার হলে হ্যান্ডলার এক্সিকিউট করা
        return await handler(event, data)