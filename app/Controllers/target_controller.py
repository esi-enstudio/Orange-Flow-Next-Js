import os
import logging
from datetime import datetime
from aiogram import Router, F
from aiogram.types import Message, CallbackQuery, FSInputFile, InlineKeyboardButton
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.utils.keyboard import InlineKeyboardBuilder
from sqlalchemy import select

from app.Models.house import House
from app.Services.db_service import async_session
from app.Services.Automation.target_excel import process_target_excel
from app.Services.Automation.target_view import (
    get_house_target_summary, get_supervisor_target_summary, 
    get_rso_target_summary, export_targets_to_excel
)
from app.Utils.helpers import bn_num

logger = logging.getLogger(__name__)
router = Router()

class TargetStates(StatesGroup):
    mode = State() # 'upload' or 'view'
    target_type = State()
    month = State()
    year = State()
    waiting_for_house = State()
    waiting_for_file = State()

@router.message(F.text == "🎯 Target Management", flags={"permission": "upload_targets"})
async def target_main_menu(message: Message, state: FSMContext):
    await state.clear()
    builder = InlineKeyboardBuilder()
    builder.button(text="📤 আপলোড টার্গেট", callback_data="target_mode_upload")
    builder.button(text="📊 ভিউ টার্গেট", callback_data="target_mode_view")
    builder.adjust(1)
    
    await message.answer(
        "🎯 **টার্গেট ম্যানেজমেন্ট মেনু**\n\nআপনি কি করতে চান?",
        reply_markup=builder.as_markup(),
        parse_mode="Markdown"
    )

@router.callback_query(F.data.startswith("target_mode_"))
async def select_target_type(callback: CallbackQuery, state: FSMContext):
    mode = callback.data.split("_")[2]
    await state.update_data(mode=mode)
    
    builder = InlineKeyboardBuilder()
    builder.button(text="🏠 House Target", callback_data="target_type_house")
    builder.button(text="👨‍💼 Supervisor Target", callback_data="target_type_supervisor")
    builder.button(text="👤 RSO Target", callback_data="target_type_rso")
    builder.button(text="🔙 পিছনে", callback_data="target_back_main")
    builder.adjust(1)
    
    await callback.message.edit_text(
        f"🎯 **টার্গেট টাইপ নির্বাচন করুন ({'আপলোড' if mode == 'upload' else 'ভিউ'}):**",
        reply_markup=builder.as_markup(),
        parse_mode="Markdown"
    )
    await state.set_state(TargetStates.target_type)

@router.callback_query(F.data == "target_back_main")
async def back_to_main(callback: CallbackQuery, state: FSMContext):
    await target_main_menu(callback.message, state)

@router.callback_query(F.data.startswith("target_type_"))
async def start_target_year_selection(callback: CallbackQuery, state: FSMContext):
    target_type = callback.data.split("_")[2]
    await state.update_data(target_type=target_type)
    
    # বছর সিলেকশন কিবোর্ড
    current_year = datetime.now().year
    builder = InlineKeyboardBuilder()
    builder.button(text=str(current_year), callback_data=f"target_year_{current_year}")
    builder.button(text=str(current_year + 1), callback_data=f"target_year_{current_year + 1}")
    builder.adjust(2)
    
    await callback.message.edit_text("📅 **বছর নির্বাচন করুন:**", reply_markup=builder.as_markup(), parse_mode="Markdown")
    await state.set_state(TargetStates.year)

@router.callback_query(F.data.startswith("target_year_"))
async def start_target_month_selection(callback: CallbackQuery, state: FSMContext):
    year = int(callback.data.split("_")[2])
    await state.update_data(year=year)
    
    # মাস সিলেকশন কিবোর্ড
    builder = InlineKeyboardBuilder()
    months = [
        ("জানুয়ারি", 1), ("ফেব্রুয়ারি", 2), ("মার্চ", 3), ("এপ্রিল", 4),
        ("মে", 5), ("জুন", 6), ("জুলাই", 7), ("আগস্ট", 8),
        ("সেপ্টেম্বর", 9), ("অক্টোবর", 10), ("নভেম্বর", 11), ("ডিসেম্বর", 12)
    ]
    for name, val in months:
        builder.button(text=name, callback_data=f"target_month_{val}")
    builder.adjust(3)
    
    await callback.message.edit_text("📅 **মাস নির্বাচন করুন:**", reply_markup=builder.as_markup(), parse_mode="Markdown")
    await state.set_state(TargetStates.month)

@router.callback_query(F.data.startswith("target_month_"))
async def select_house(callback: CallbackQuery, state: FSMContext):
    month = int(callback.data.split("_")[2])
    await state.update_data(month=month)
    
    async with async_session() as session:
        result = await session.execute(select(House).where(House.is_active == True))
        houses = result.scalars().all()
        
    if not houses:
        return await callback.message.answer("❌ কোনো সচল হাউজ পাওয়া যায়নি।")
        
    builder = InlineKeyboardBuilder()
    for h in houses:
        builder.button(text=h.display_name, callback_data=f"target_house_{h.code}")
    builder.adjust(1)
    
    data = await state.get_data()
    builder.row(InlineKeyboardButton(text="🔙 পিছনে", callback_data=f"target_year_{ data.get('year') }"))

    await callback.message.edit_text("🏘️ **হাউজ নির্বাচন করুন:**", reply_markup=builder.as_markup(), parse_mode="Markdown")
    await state.set_state(TargetStates.waiting_for_house)

from app.Models.user import User
from app.Utils.access_control import AccessControl
from sqlalchemy.orm import selectinload

@router.callback_query(F.data.startswith("target_house_"))
async def handle_house_selection(callback: CallbackQuery, state: FSMContext):
    house_code = callback.data.split("_")[2]
    await state.update_data(house_code=house_code)
    
    data = await state.get_data()
    mode = data.get('mode')
    t_type = data.get('target_type')
    month = data.get('month')
    year = data.get('year')
    
    if mode == 'upload':
        await callback.message.edit_text(
            f"📁 **{t_type.capitalize()} Target** এর জন্য এক্সেল ফাইলটি পাঠান।\n"
            f"🏘️ হাউজ: `{house_code}`\n\n"
            f"*(সিস্টেম শুধুমাত্র এই হাউজের ডাটাই প্রসেস করবে)*",
            parse_mode="Markdown"
        )
        await state.set_state(TargetStates.waiting_for_file)
    else:
        # View Mode
        wait_msg = await callback.message.edit_text("⏳ ডাটা লোড হচ্ছে...")
        
        async with async_session() as session:
            # Load user with roles and profile for access control
            user_res = await session.execute(
                select(User).options(
                    selectinload(User.roles),
                    selectinload(User.houses),
                    selectinload(User.field_force_profile)
                ).where(User.telegram_id == callback.from_user.id)
            )
            user = user_res.scalar_one_or_none()
            
            if not user:
                return await wait_msg.edit_text("❌ ইউজার প্রোফাইল পাওয়া যায়নি।")

            ac = AccessControl(user, session)
            
            summary_func = {
                'house': get_house_target_summary,
                'supervisor': get_supervisor_target_summary,
                'rso': get_rso_target_summary
            }.get(t_type)
            
            # Additional filtering for Supervisor and RSO
            supervisor_msisdn = None
            if t_type == 'rso' and user.field_force_profile and user.field_force_profile.type == 'Supervisor':
                supervisor_msisdn = user.field_force_profile.itop_number

            targets, text = await summary_func(month, year, house_code=house_code, supervisor_msisdn=supervisor_msisdn)
        
        if not targets:
            await wait_msg.edit_text(f"❌ {text}")
            return

        builder = InlineKeyboardBuilder()
        builder.button(text="📥 এক্সেল ডাউনলোড", callback_data=f"target_export_{t_type}_{month}_{year}_{house_code}")
        builder.button(text="🔙 মেইন মেনু", callback_data="target_back_main")
        builder.adjust(1)
        
        await wait_msg.edit_text(text, reply_markup=builder.as_markup(), parse_mode="Markdown")

@router.callback_query(F.data.startswith("target_export_"))
async def handle_target_export(callback: CallbackQuery):
    parts = callback.data.split("_")
    t_type = parts[2]
    month = int(parts[3])
    year = int(parts[4])
    house_code = parts[5] if len(parts) > 5 else None
    
    await callback.answer("⏳ এক্সেল ফাইল জেনারেট হচ্ছে...")
    file_path = await export_targets_to_excel(month, year, t_type, house_code=house_code)
    
    if not file_path:
        return await callback.message.answer("❌ কোনো ডাটা পাওয়া যায়নি।")
        
    try:
        await callback.message.answer_document(
            FSInputFile(file_path),
            caption=f"📊 **{t_type.capitalize()} Target ({month}/{year})**\n🏘️ House: `{house_code}`"
        )
    finally:
        if os.path.exists(file_path): os.remove(file_path)

@router.message(TargetStates.waiting_for_file, F.document)
async def handle_target_file(message: Message, state: FSMContext):
    data = await state.get_data()
    t_type = data.get('target_type')
    month = data.get('month')
    year = data.get('year')
    house_code = data.get('house_code')
    
    file_path = f"temp_target_{message.from_user.id}.xlsx"
    wait_msg = await message.answer("⏳ ফাইলটি ডাউনলোড ও প্রসেসিং শুরু হচ্ছে...")

    try:
        await message.bot.download(message.document, destination=file_path)

        async def update_telegram_progress(text):
            try: await wait_msg.edit_text(text, parse_mode="HTML")
            except: pass

        count, err = await process_target_excel(file_path, t_type, month, year, target_house_code=house_code, progress_callback=update_telegram_progress)
        
        if err:
            await wait_msg.edit_text(f"❌ এরর: {err}")
        else:
            await wait_msg.edit_text(f"✅ সফল! {t_type.capitalize()} এর মোট `{bn_num(count)}`টি টার্গেট আপডেট করা হয়েছে।\n🏘️ হাউজ: `{house_code}`", parse_mode="Markdown")
    
    except Exception as e:
        await wait_msg.edit_text(f"❌ এরর: {str(e)}")
    finally:
        if os.path.exists(file_path): os.remove(file_path)
        await state.clear()
