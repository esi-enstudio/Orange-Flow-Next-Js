import os
import logging
from datetime import datetime
from aiogram import Router, F
from aiogram.filters import StateFilter
from aiogram.types import Message, CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.utils.keyboard import InlineKeyboardBuilder
from sqlalchemy import select, and_

from app.Services.Automation.issue_reports_excel import process_scratch_card_excel, process_sim_issue_excel
from app.Utils.helpers import bn_num
from app.Services.db_service import async_session
from app.Models.house import House

logger = logging.getLogger(__name__)
router = Router()

class IssueReportStates(StatesGroup):
    waiting_for_house = State()
    waiting_for_type = State()
    waiting_for_file = State()

# ==========================================
# ১. এন্ট্রি পয়েন্ট (Scratch Card বা SIM Issue)
# ==========================================
@router.message(F.text.in_(["🎫 Scratch Card Issue", "📲 SIM Issue"]))
async def start_issue_report_upload(message: Message, state: FSMContext, permissions: list):
    """ইউজার যখন ইস্যু রিপোর্ট আপলোড করতে চাবে"""
    # পারমিশন চেক
    required_perm = "upload_scratch_card" if message.text == "🎫 Scratch Card Issue" else "upload_sim_issue"
    if required_perm not in permissions:
        return await message.answer("❌ আপনার এই রিপোর্ট আপলোড করার অনুমতি নেই।")

    await state.clear()
    await state.update_data(entry_type=message.text)
    await show_house_selection(message, state)

async def show_house_selection(message_or_callback, state: FSMContext):
    """হাউজ সিলেকশন মেনু"""
    async with async_session() as session:
        stmt = select(House).where(
            and_(
                House.is_active == True,
                House.subscription_date >= datetime.now()
            )
        )
        result = await session.execute(stmt)
        houses = result.scalars().all()

    if not houses:
        text = "❌ কোনো একটিভ হাউজ বা মেয়াদ থাকা সাবস্ক্রিপশন পাওয়া যায়নি।"
        if isinstance(message_or_callback, Message):
            return await message_or_callback.answer(text)
        else:
            return await message_or_callback.message.edit_text(text)

    builder = InlineKeyboardBuilder()
    for house in houses:
        builder.button(text=house.display_name, callback_data=f"issue_house_{house.id}")
    builder.adjust(2)
    
    text = (
        "🏘️ <b>হাউজ নির্বাচন করুন</b>\n\n"
        "কোন হাউজের জন্য রিপোর্ট আপলোড করতে চান? নিচে থেকে সিলেক্ট করুন:"
    )
    
    if isinstance(message_or_callback, Message):
        await message_or_callback.answer(text, reply_markup=builder.as_markup(), parse_mode="HTML")
    else:
        await message_or_callback.message.edit_text(text, reply_markup=builder.as_markup(), parse_mode="HTML")
    
    await state.set_state(IssueReportStates.waiting_for_house)

@router.callback_query(F.data == "issue_change_house")
async def handle_change_house(callback: CallbackQuery, state: FSMContext):
    """হাউজ পরিবর্তন বাটনের হ্যান্ডেলার"""
    data = await state.get_data()
    entry_type = data.get('entry_type')
    await state.clear()
    await state.update_data(entry_type=entry_type)
    await show_house_selection(callback, state)
    await callback.answer()

# ==========================================
# ২. হাউজ হ্যান্ডেলার ও ফাইল রিকোয়েস্ট
# ==========================================
@router.callback_query(F.data.startswith("issue_house_"), StateFilter(IssueReportStates.waiting_for_house, IssueReportStates.waiting_for_file))
async def handle_house_selection(callback: CallbackQuery, state: FSMContext):
    house_id = int(callback.data.split("_")[2])
    
    async with async_session() as session:
        house = await session.get(House, house_id)
        if not house:
            return await callback.answer("❌ হাউজ পাওয়া যায়নি।", show_alert=True)
        house_name = house.display_name

    await state.update_data(house_id=house_id, house_name=house_name)
    data = await state.get_data()
    entry_type = data.get('entry_type')

    await show_upload_prompt(callback.message, house_name, entry_type)
    await state.set_state(IssueReportStates.waiting_for_file)
    await callback.answer()

async def show_upload_prompt(message: Message, house_name: str, entry_type: str, edit: bool = True, extra_text: str = ""):
    """ফাইল আপলোড প্রম্পট দেখানোর ফাংশন"""
    builder = InlineKeyboardBuilder()
    builder.button(text="🔄 হাউজ পরিবর্তন", callback_data="issue_change_house")
    
    text = (
        f"{extra_text}\n" if extra_text else ""
    ) + (
        f"🏘️ হাউজ: <b>{house_name}</b>\n"
        f"📂 রিপোর্ট: <b>{entry_type}</b>\n\n"
        f"এখন এই রিপোর্টের <b>Excel (.xlsx)</b> ফাইলটি পাঠান।"
    )

    if edit:
        await message.edit_text(text, reply_markup=builder.as_markup(), parse_mode="HTML")
    else:
        await message.answer(text, reply_markup=builder.as_markup(), parse_mode="HTML")

@router.message(F.text == "🔙 Back")
async def back_to_data_center(message: Message, state: FSMContext, permissions: list):
    """ডাটা সেন্টার মেনুতে ফিরে যাওয়া"""
    await state.clear()
    from app.Views.keyboards.reply import get_data_center_menu
    await message.answer(
        "💾 <b>ডাটা সেন্টার ম্যানেজমেন্ট</b>",
        reply_markup=get_data_center_menu(permissions),
        parse_mode="HTML"
    )

# ==========================================
# ৩. ফাইল রিসিভ এবং প্রসেসিং
# ==========================================
@router.message(IssueReportStates.waiting_for_file, F.document)
async def handle_issue_file(message: Message, state: FSMContext):
    file_name = message.document.file_name.lower()
    if not (file_name.endswith('.xlsx') or file_name.endswith('.xls')):
        return await message.answer("❌ ভুল ফাইল! শুধু .xlsx অথবা .xls এক্সেল ফাইল পাঠান।")
    
    data = await state.get_data()
    entry_type = data.get('entry_type')
    house_id = data.get('house_id')
    house_name = data.get('house_name', 'Unknown')

    file_path = f"temp_issue_{message.from_user.id}.xlsx"
    wait_msg = await message.answer(f"⏳ <b>{house_name}</b> এর <b>{entry_type}</b> প্রসেসিং শুরু হচ্ছে...", parse_mode="HTML")

    try:
        await message.bot.download(message.document, destination=file_path)
        
        async def progress(text):
            try: await wait_msg.edit_text(text, parse_mode="HTML")
            except: pass

        if entry_type == "🎫 Scratch Card Issue":
            count, err = await process_scratch_card_excel(file_path, house_id, progress)
        else:
            count, err = await process_sim_issue_excel(file_path, house_id, progress)
        
        if err:
            # এরর মেসেজ ট্রানকেট করা (টেলিগ্রাম লিমিট এড়াতে)
            truncated_err = (err[:1000] + '...') if len(str(err)) > 1000 else err
            await show_upload_prompt(wait_msg, house_name, entry_type, extra_text=f"❌ <b>প্রসেসিং ব্যর্থ!</b>\nএরর: `{truncated_err}`\n")
        else:
            success_text = (
                f"✅ <b>রিপোর্ট আপলোড সম্পন্ন!</b>\n\n"
                f"🏘️ হাউজ: <b>{house_name}</b>\n"
                f"📂 টাইপ: <b>{entry_type}</b>\n"
                f"📈 মোট ডাটা সেভ হয়েছে: <code>{bn_num(count)}</code> টি\n"
            )
            await show_upload_prompt(wait_msg, house_name, entry_type, extra_text=success_text)
            
    except Exception as e:
        logger.error(f"Issue Report Controller Error: {str(e)}")
        # জেনারেল এক্সেপশন মেসেজও ট্রানকেট করা
        err_msg = str(e)
        if len(err_msg) > 3000: err_msg = err_msg[:3000] + "..."
        await message.answer(f"❌ একটি সিস্টেম এরর হয়েছে: {err_msg}")
    finally:
        if os.path.exists(file_path): os.remove(file_path)
