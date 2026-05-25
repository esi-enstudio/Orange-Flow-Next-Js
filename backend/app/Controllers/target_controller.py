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
from app.Services.Automation.target_excel import process_target_excel_unified
from app.Services.Automation.target_view import (
    get_rso_target_full_info, export_targets_to_excel,
    get_house_target_full_info, get_supervisor_target_full_info,
    get_rso_target_by_query
)
from app.Utils.helpers import bn_num
from app.Utils.calendar_util import MonthYearCalendar

logger = logging.getLogger(__name__)
router = Router()

class TargetStates(StatesGroup):
    mode = State() # 'upload' or 'view'
    target_type = State()
    selecting_date = State()
    waiting_for_house = State()
    waiting_for_file = State()
    waiting_for_rso_query = State()

async def target_main_menu_helper(message: Message, state: FSMContext, edit=False):
    await state.clear()
    builder = InlineKeyboardBuilder()
    builder.button(text="🏠 House Summary", callback_data="target_view_house")
    builder.button(text="👨‍💼 Supervisor Summary", callback_data="target_view_supervisor")
    builder.button(text="👤 RSO Summary", callback_data="target_view_rso")
    builder.button(text="📤 Upload New Target", callback_data="target_mode_upload")
    builder.adjust(1)

    text = (
        "🎯 **টার্গেট ম্যানেজমেন্ট মেনু**\n\n"
        "নিচের অপশনগুলো থেকে আপনার প্রয়োজনীয় কাজটি নির্বাচন করুন:"
    )

    if edit:
        await message.edit_text(text, reply_markup=builder.as_markup(), parse_mode="Markdown")
    else:
        await message.answer(text, reply_markup=builder.as_markup(), parse_mode="Markdown")

@router.message(F.text == "🎯 Target Management", flags={"permission": "upload_targets"})
async def target_main_menu(message: Message, state: FSMContext):
    await target_main_menu_helper(message, state)

@router.callback_query(F.data == "target_back_main")
async def back_to_main(callback: CallbackQuery, state: FSMContext):
    await target_main_menu_helper(callback.message, state, edit=True)

@router.callback_query(F.data.startswith("target_view_"))
async def start_view_target(callback: CallbackQuery, state: FSMContext):
    target_type = callback.data.split("_")[2]
    await state.update_data(mode="view", target_type=target_type)
    await state.set_state(TargetStates.selecting_date)
    await callback.message.edit_text(
        f"📅 **{target_type.capitalize()} Target** দেখার জন্য মাস নির্বাচন করুন:",
        reply_markup=MonthYearCalendar.get_month_year_keyboard(),
        parse_mode="Markdown"
    )

@router.callback_query(F.data == "target_mode_upload")
async def start_upload_target(callback: CallbackQuery, state: FSMContext):
    await state.update_data(mode="upload")
    await state.set_state(TargetStates.selecting_date)
    await callback.message.edit_text(
        "📅 **টার্গেট আপলোড করার জন্য মাস নির্বাচন করুন:**",
        reply_markup=MonthYearCalendar.get_month_year_keyboard(),
        parse_mode="Markdown"
    )

@router.callback_query(F.data.startswith("cal_"), TargetStates.selecting_date)
async def process_calendar(callback: CallbackQuery, state: FSMContext):
    action, year, month = MonthYearCalendar.process_selection(callback.data)

    if action in ["prev", "next"]:
        await callback.message.edit_reply_markup(
            reply_markup=MonthYearCalendar.get_month_year_keyboard(year, month)
        )
    elif action == "select":
        data = await state.get_data()
        mode = data.get('mode')
        target_date = datetime(year, month, 1)
        await state.update_data(target_date=target_date, month=month, year=year)
        
        if mode == "upload":
            await callback.message.edit_text(
                f"✅ নির্বাচিত মাস: **{month}/{year}**\n\n"
                "📤 এখন আপনার **Target Excel** ফাইলটি পাঠান।\n"
                "(বট অটোমেটিক House, Supervisor এবং RSO শিটগুলো খুঁজে নিবে)",
                parse_mode="Markdown"
            )
            await state.set_state(TargetStates.waiting_for_file)
        else:
            # View mode
            target_type = data.get('target_type')
            await show_target_summary(callback, target_type, month, year)

async def show_target_summary(callback: CallbackQuery, target_type, month, year, page=1, total_count=None):
    targets, summary_text = None, ""
    total_pages = total_count if total_count else 1
    
    try:
        if target_type == 'house':
            target, total_pages, summary_text = await get_house_target_full_info(month, year, page=page, total_count=total_count)
            targets = [target] if target else None
        elif target_type == 'supervisor':
            target, total_pages, summary_text = await get_supervisor_target_full_info(month, year, page=page, total_count=total_count)
            targets = [target] if target else None
        elif target_type == 'rso':
            target, total_pages, summary_text = await get_rso_target_full_info(month, year, page=page, total_count=total_count)
            targets = [target] if target else None
    except Exception as e:
        logger.error(f"Error getting target summary: {e}")
        await callback.answer("❌ তথ্য লোড করতে সমস্যা হয়েছে।", show_alert=True)
        return

    if not targets:
        builder = InlineKeyboardBuilder()
        builder.button(text="🔙 পিছনে", callback_data="target_back_main")
        await callback.message.edit_text(
            f"❌ {summary_text}",
            reply_markup=builder.as_markup(),
            parse_mode="Markdown"
        )
        return

    builder = InlineKeyboardBuilder()
    
    if target_type in ['house', 'supervisor', 'rso'] and total_pages > 1:
        prefix = f"target_{target_type}_page"
        if page > 1:
            builder.button(text="◀️ Previous", callback_data=f"{prefix}_{page-1}_{month}_{year}_{total_pages}")
        if page < total_pages:
            builder.button(text="Next ▶️", callback_data=f"{prefix}_{page+1}_{month}_{year}_{total_pages}")
        builder.adjust(2)

    if target_type == 'rso':
        builder.row(InlineKeyboardButton(text="🔍 Search RSO", callback_data=f"target_search_rso_{month}_{year}"))

    builder.row(InlineKeyboardButton(text="📥 Export to Excel", callback_data=f"target_export_{target_type}_{month}_{year}"))
    builder.row(InlineKeyboardButton(text="🔙 পিছনে", callback_data="target_back_main"))

    # If text is too long, truncate it
    if len(summary_text) > 4000:
        summary_text = summary_text[:3900] + "\n\n...(অতিরিক্ত তথ্য এক্সেল ফাইলে দেখুন)"

    try:
        await callback.message.edit_text(
            summary_text,
            reply_markup=builder.as_markup(),
            parse_mode="Markdown"
        )
    except Exception as e:
        if "message is not modified" not in str(e).lower():
            logger.error(f"Error editing message: {e}")

@router.callback_query(F.data.startswith("target_house_page_"))
async def handle_house_target_pagination(callback: CallbackQuery):
    await callback.answer()
    parts = callback.data.split("_")
    try:
        page = int(parts[3])
        month = int(parts[4])
        year = int(parts[5])
        total_count = int(parts[6]) if len(parts) > 6 else None
        await show_target_summary(callback, 'house', month, year, page=page, total_count=total_count)
    except (IndexError, ValueError) as e:
        logger.error(f"Pagination error: {e}")
        await callback.answer("❌ পেজ লোড করতে সমস্যা হয়েছে।", show_alert=True)

@router.callback_query(F.data.startswith("target_supervisor_page_"))
async def handle_supervisor_target_pagination(callback: CallbackQuery):
    await callback.answer()
    parts = callback.data.split("_")
    try:
        page = int(parts[3])
        month = int(parts[4])
        year = int(parts[5])
        total_count = int(parts[6]) if len(parts) > 6 else None
        await show_target_summary(callback, 'supervisor', month, year, page=page, total_count=total_count)
    except (IndexError, ValueError) as e:
        logger.error(f"Pagination error: {e}")
        await callback.answer("❌ পেজ লোড করতে সমস্যা হয়েছে।", show_alert=True)

@router.callback_query(F.data.startswith("target_rso_page_"))
async def handle_rso_target_pagination(callback: CallbackQuery):
    await callback.answer()
    parts = callback.data.split("_")
    try:
        page = int(parts[3])
        month = int(parts[4])
        year = int(parts[5])
        total_count = int(parts[6]) if len(parts) > 6 else None
        await show_target_summary(callback, 'rso', month, year, page=page, total_count=total_count)
    except (IndexError, ValueError) as e:
        logger.error(f"Pagination error: {e}")
        await callback.answer("❌ পেজ লোড করতে সমস্যা হয়েছে।", show_alert=True)

@router.callback_query(F.data.startswith("target_search_rso_"))
async def start_rso_search(callback: CallbackQuery, state: FSMContext):
    parts = callback.data.split("_")
    month = int(parts[3])
    year = int(parts[4])
    await state.update_data(month=month, year=year)
    await state.set_state(TargetStates.waiting_for_rso_query)
    await callback.message.answer(
        "🔍 **RSO টার্গেট সার্চ করুন**\n\n"
        "আরএসও-র **DMS Code** অথবা **MSISDN** (itop/pool/personal number) লিখে পাঠান:",
        parse_mode="Markdown"
    )
    await callback.answer()

@router.message(TargetStates.waiting_for_rso_query)
async def process_rso_search(message: Message, state: FSMContext):
    query = message.text.strip()
    data = await state.get_data()
    month = data.get('month')
    year = data.get('year')
    
    status_msg = await message.answer("⏳ তথ্য খোঁজা হচ্ছে...")
    target, total_pages, summary_text = await get_rso_target_by_query(month, year, query)
    
    if not target:
        await status_msg.edit_text(f"❌ {summary_text}")
        return
        
    builder = InlineKeyboardBuilder()
    builder.button(text="📥 Export to Excel", callback_data=f"target_export_rso_{month}_{year}")
    builder.button(text="🔙 পিছনে", callback_data="target_back_main")
    builder.adjust(1)
    
    await status_msg.edit_text(
        summary_text,
        reply_markup=builder.as_markup(),
        parse_mode="Markdown"
    )
    await state.clear()

@router.callback_query(F.data.startswith("target_export_"))
async def handle_export_target(callback: CallbackQuery):
    parts = callback.data.split("_")
    target_type = parts[2]
    month = int(parts[3])
    year = int(parts[4])
    
    await callback.answer("⏳ ফাইল জেনারেট হচ্ছে...")
    file_path = await export_targets_to_excel(month, year, target_type)
    
    if file_path and os.path.exists(file_path):
        await callback.message.answer_document(
            FSInputFile(file_path),
            caption=f"📊 {target_type.capitalize()} Target ({month}/{year})"
        )
        os.remove(file_path)
    else:
        await callback.answer("❌ ফাইল জেনারেট করা সম্ভব হয়নি।", show_alert=True)

@router.message(TargetStates.waiting_for_file, F.document)
async def process_upload(message: Message, state: FSMContext):
    data = await state.get_data()
    target_date = data.get('target_date')

    file_id = message.document.file_id
    file = await message.bot.get_file(file_id)
    file_path = file.file_path
    
    local_path = f"temp_downloads/{message.document.file_name}"
    os.makedirs("temp_downloads", exist_ok=True)
    await message.bot.download_file(file_path, local_path)

    status_msg = await message.answer("⏳ প্রসেসিং শুরু হচ্ছে...")

    async def progress_update(text):
        try:
            await status_msg.edit_text(text)
        except: pass

    total_count, summary = await process_target_excel_unified(
        local_path, target_date, progress_callback=progress_update
    )

    if total_count == 0 and "Error" in summary:
        await status_msg.edit_text(f"❌ এরর: {summary}")
    else:
        await status_msg.edit_text(
            f"📊 **টার্গেট আপলোড সামারি:**\n\n"
            f"{summary}\n\n"
            f"📈 মোট প্রসেস হয়েছে: **{bn_num(total_count)}** টি রেকর্ড।"
        )
    
    if os.path.exists(local_path):
        os.remove(local_path)
    await state.clear()
