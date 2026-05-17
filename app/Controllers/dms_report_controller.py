import os
import logging
from datetime import datetime
from aiogram import Router, F
from aiogram.filters import StateFilter
from aiogram.types import Message, CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.utils.keyboard import InlineKeyboardBuilder

from app.Services.Automation.dms_report_excel import process_dms_report_excel
from app.Utils.helpers import bn_num
from app.Services.db_service import async_session
from app.Models.house import House
from app.Models.subscription import HouseSubscription
from config.settings import SUPER_ADMIN_ID
from sqlalchemy import select, and_

logger = logging.getLogger(__name__)
router = Router()

class DMSReportStates(StatesGroup):
    waiting_for_house = State()
    waiting_for_type = State()
    waiting_for_file = State()

# ==========================================
# ১. হাউজ সিলেকশন (মেইন এন্ট্রি)
# ==========================================
@router.message(F.text == "📊 DMS Report", flags={"permission": "dms_report"})
async def start_dms_report_upload(message: Message, state: FSMContext):
    """ইউজার যখন '📊 DMS Report' চাপ দিবে"""
    await state.clear()
    await show_house_selection(message, state)

async def show_house_selection(message_or_callback, state: FSMContext):
    """হাউজ সিলেকশন মেনু দেখানোর কমন ফাংশন"""
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
        builder.button(text=house.display_name, callback_data=f"dms_house_{house.id}")
    builder.adjust(2)
    
    text = (
        "🏘️ <b>হাউজ নির্বাচন করুন</b>\n\n"
        "কোন হাউজের জন্য DMS রিপোর্ট আপলোড করতে চান? নিচে থেকে সিলেক্ট করুন:"
    )
    
    if isinstance(message_or_callback, Message):
        await message_or_callback.answer(text, reply_markup=builder.as_markup(), parse_mode="HTML")
    else:
        await message_or_callback.message.edit_text(text, reply_markup=builder.as_markup(), parse_mode="HTML")
    
    await state.set_state(DMSReportStates.waiting_for_house)

@router.callback_query(F.data == "dms_change_house")
async def handle_change_house(callback: CallbackQuery, state: FSMContext):
    """হাউজ পরিবর্তন বাটনের হ্যান্ডেলার"""
    await state.clear()
    await show_house_selection(callback, state)
    await callback.answer()

# ==========================================
# ২. হাউজ হ্যান্ডেলার ও রিপোর্ট টাইপ সিলেকশন
# ==========================================
@router.callback_query(F.data.startswith("dms_house_"), StateFilter(DMSReportStates.waiting_for_house, DMSReportStates.waiting_for_file))
async def handle_house_selection(callback: CallbackQuery, state: FSMContext):
    house_id = int(callback.data.split("_")[2])
    
    async with async_session() as session:
        house = await session.get(House, house_id)
        if not house:
            return await callback.answer("❌ হাউজ পাওয়া যায়নি।", show_alert=True)
        house_name = house.display_name

    await state.update_data(house_id=house_id, house_name=house_name)
    await show_report_type_menu(callback.message, house_name)
    await state.set_state(DMSReportStates.waiting_for_type)
    await callback.answer()

async def show_report_type_menu(message: Message, house_name: str, edit: bool = True, extra_text: str = ""):
    """রিপোর্ট টাইপ মেনু দেখানোর কমন ফাংশন"""
    builder = InlineKeyboardBuilder()
    builder.row(
        InlineKeyboardButton(text="📥 C2C রিপোর্ট", callback_data="dms_type_C2C"),
        InlineKeyboardButton(text="📥 C2S রিপোর্ট", callback_data="dms_type_C2S")
    )
    builder.row(
        InlineKeyboardButton(text="📥 Balance রিপোর্ট", callback_data="dms_type_Balance"),
        InlineKeyboardButton(text="🔄 হাউজ পরিবর্তন", callback_data="dms_change_house")
    )

    text = (
        f"{extra_text}\n" if extra_text else ""
    ) + (
        f"🏘️ হাউজ: <b>{house_name}</b>\n\n"
        f"এখন এই হাউজের জন্য কোন ধরনের রিপোর্ট আপলোড করতে চান?"
    )

    if edit:
        await message.edit_text(text, reply_markup=builder.as_markup(), parse_mode="HTML")
    else:
        await message.answer(text, reply_markup=builder.as_markup(), parse_mode="HTML")

# ==========================================
# ৩. টাইপ হ্যান্ডেলার ও ফাইল রিকোয়েস্ট
# ==========================================
@router.callback_query(F.data.startswith("dms_type_"), DMSReportStates.waiting_for_type)
async def handle_dms_type_selection(callback: CallbackQuery, state: FSMContext):
    report_type = callback.data.split("_")[2]
    data = await state.get_data()
    house_name = data.get('house_name', 'Unknown')
    
    await state.update_data(report_type=report_type)
    
    type_name = {
        "C2C": "C2C (Stock Transfer)",
        "C2S": "C2S (Sales/Recharge)",
        "Balance": "Balance (Closing Balance)"
    }.get(report_type, report_type)

    builder = InlineKeyboardBuilder()
    builder.button(text="🔙 পিছনে", callback_data=f"dms_house_{data.get('house_id')}")

    await callback.message.edit_text(
        f"🏘️ হাউজ: <b>{house_name}</b>\n"
        f"📂 টাইপ: <b>{type_name}</b>\n\n"
        f"এখন এই রিপোর্টের <b>Excel (.xlsx)</b> ফাইলটি পাঠান।\n"
        f"<i>মনে রাখবেন: ফাইলটিতে অবশ্যই DISTRIBUTORCODE এবং তারিখ কলাম থাকতে হবে।</i>",
        reply_markup=builder.as_markup(),
        parse_mode="HTML"
    )
    await state.set_state(DMSReportStates.waiting_for_file)
    await callback.answer()

# ==========================================
# ৪. ফাইল রিসিভ এবং প্রসেসিং
# ==========================================
@router.message(DMSReportStates.waiting_for_file, F.document)
async def handle_dms_report_file(message: Message, state: FSMContext):
    file_name = message.document.file_name.lower()
    if not (file_name.endswith('.xlsx') or file_name.endswith('.xls')):
        return await message.answer("❌ ভুল ফাইল! শুধু .xlsx অথবা .xls এক্সেল ফাইল পাঠান।")
    
    data = await state.get_data()
    report_type = data.get('report_type')
    house_id = data.get('house_id')
    house_name = data.get('house_name', 'Unknown')

    file_path = f"temp_dms_{message.from_user.id}.xlsx"
    wait_msg = await message.answer(f"⏳ <b>{house_name}</b> এর <b>{report_type}</b> রিপোর্ট প্রসেসিং শুরু হচ্ছে...", parse_mode="HTML")

    try:
        # ফাইল ডাউনলোড
        await message.bot.download(message.document, destination=file_path)
        
        # প্রগ্রেস আপডেট ফাংশন
        async def progress(text):
            try: await wait_msg.edit_text(text, parse_mode="HTML")
            except: pass

        # প্রসেসিং শুরু
        count, err = await process_dms_report_excel(file_path, report_type, house_id, progress)
        
        if err:
            await show_report_type_menu(
                wait_msg, house_name, 
                extra_text=f"❌ <b>প্রসেসিং ব্যর্থ!</b>\nহাউজ: {house_name}\nএরর: `{err}`\n"
            )
        else:
            success_text = (
                f"✅ <b>DMS রিপোর্ট আপলোড সম্পন্ন!</b>\n\n"
                f"🏘️ হাউজ: <b>{house_name}</b>\n"
                f"📊 টাইপ: <b>{report_type}</b>\n"
                f"📈 মোট ডাটা পয়েন্ট সেভ হয়েছে: <code>{bn_num(count)}</code> টি\n"
                f"🕒 সময়: {datetime.now().strftime('%I:%M %p')}\n"
            )
            await show_report_type_menu(wait_msg, house_name, extra_text=success_text)
            
        await state.set_state(DMSReportStates.waiting_for_type)

    except Exception as e:
        logger.error(f"DMS Report Controller Error: {str(e)}")
        await message.answer(f"❌ একটি সিস্টেম এরর হয়েছে: {str(e)}")
    finally:
        if os.path.exists(file_path): os.remove(file_path)
