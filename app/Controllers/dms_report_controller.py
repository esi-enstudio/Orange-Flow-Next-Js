import os
import logging
from datetime import datetime
from aiogram import Router, F
from aiogram.types import Message, CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.utils.keyboard import InlineKeyboardBuilder

from app.Services.Automation.dms_report_excel import process_dms_report_excel
from app.Utils.helpers import bn_num
from app.Services.db_service import async_session
from config.settings import SUPER_ADMIN_ID

logger = logging.getLogger(__name__)
router = Router()

class DMSReportStates(StatesGroup):
    waiting_for_type = State()
    waiting_for_file = State()

# ==========================================
# ১. রিপোর্ট টাইপ সিলেকশন (মেইন এন্ট্রি)
# ==========================================
@router.message(F.text == "📊 DMS রিপোর্ট", flags={"permission": "manage_data_center"})
async def start_dms_report_upload(message: Message, state: FSMContext):
    """ইউজার যখন '📊 DMS রিপোর্ট' চাপ দিবে"""
    await state.clear()
    
    builder = InlineKeyboardBuilder()
    builder.row(
        InlineKeyboardButton(text="📥 C2C রিপোর্ট", callback_data="dms_type_C2C"),
        InlineKeyboardButton(text="📥 C2S রিপোর্ট", callback_data="dms_type_C2S")
    )
    builder.row(
        InlineKeyboardButton(text="📥 Balance রিপোর্ট", callback_data="dms_type_Balance")
    )
    
    await message.answer(
        "📊 <b>DMS রিপোর্ট আপলোড</b>\n\n"
        "আপনি কোন ধরনের রিপোর্ট আপলোড করতে চান? নিচের বাটন থেকে নির্বাচন করুন:",
        reply_markup=builder.as_markup(),
        parse_mode="HTML"
    )
    await state.set_state(DMSReportStates.waiting_for_type)

# ==========================================
# ২. টাইপ হ্যান্ডেলার ও ফাইল রিকোয়েস্ট
# ==========================================
@router.callback_query(F.data.startswith("dms_type_"), DMSReportStates.waiting_for_type)
async def handle_dms_type_selection(callback: CallbackQuery, state: FSMContext):
    report_type = callback.data.split("_")[2]
    await state.update_data(report_type=report_type)
    
    type_name = {
        "C2C": "C2C (Stock Transfer)",
        "C2S": "C2S (Sales/Recharge)",
        "Balance": "Balance (Closing Balance)"
    }.get(report_type, report_type)

    await callback.message.edit_text(
        f"📂 টাইপ: <b>{type_name}</b>\n\n"
        f"এখন এই রিপোর্টের <b>Excel (.xlsx)</b> ফাইলটি পাঠান।\n"
        f"<i>মনে রাখবেন: ফাইলটিতে অবশ্যই DISTRIBUTORCODE এবং তারিখ কলাম থাকতে হবে।</i>",
        parse_mode="HTML"
    )
    await state.set_state(DMSReportStates.waiting_for_file)
    await callback.answer()

# ==========================================
# ৩. ফাইল রিসিভ এবং প্রসেসিং
# ==========================================
@router.message(DMSReportStates.waiting_for_file, F.document)
async def handle_dms_report_file(message: Message, state: FSMContext):
    file_name = message.document.file_name.lower()
    if not (file_name.endswith('.xlsx') or file_name.endswith('.xls')):
        return await message.answer("❌ ভুল ফাইল! শুধু .xlsx অথবা .xls এক্সেল ফাইল পাঠান।")
    
    data = await state.get_data()
    report_type = data.get('report_type')

    file_path = f"temp_dms_{message.from_user.id}.xlsx"
    wait_msg = await message.answer(f"⏳ <b>{report_type}</b> রিপোর্ট প্রসেসিং শুরু হচ্ছে...", parse_mode="HTML")

    try:
        # ফাইল ডাউনলোড
        await message.bot.download(message.document, destination=file_path)
        
        # প্রগ্রেস আপডেট ফাংশন
        async def progress(text):
            try: await wait_msg.edit_text(text, parse_mode="HTML")
            except: pass

        # প্রসেসিং শুরু
        count, err = await process_dms_report_excel(file_path, report_type, progress)
        
        if err:
            await wait_msg.edit_text(f"❌ <b>প্রসেসিং ব্যর্থ!</b>\nএরর: `{err}`", parse_mode="HTML")
        else:
            await wait_msg.edit_text(
                f"✅ <b>DMS রিপোর্ট আপলোড সম্পন্ন!</b>\n\n"
                f"📊 টাইপ: <b>{report_type}</b>\n"
                f"📈 মোট ডাটা পয়েন্ট সেভ হয়েছে: <code>{bn_num(count)}</code> টি\n"
                f"🕒 সময়: {datetime.now().strftime('%I:%M %p')}",
                parse_mode="HTML"
            )
    except Exception as e:
        logger.error(f"DMS Report Controller Error: {str(e)}")
        await wait_msg.edit_text(f"❌ একটি সিস্টেম এরর হয়েছে: {str(e)}")
    finally:
        if os.path.exists(file_path): os.remove(file_path)
        await state.clear()
