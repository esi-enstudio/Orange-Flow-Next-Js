from aiogram import Router, F
from aiogram.types import Message, CallbackQuery, ReplyKeyboardRemove, InlineKeyboardButton
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.utils.keyboard import InlineKeyboardBuilder
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.Models.house import House
from app.Models.role import Role, Permission
from app.Models.user import User
from app.Services.db_service import async_session
from config.settings import SUPER_ADMIN_ID
from app.Services.Automation.field_force_excel import process_field_force_excel
from app.Services.Automation.retailer_excel import process_retailer_excel
from app.Services.Automation.user_excel import process_user_excel
from app.Services.Automation.house_excel import process_house_excel
from seed_db import seed_system_data
from app.Utils.helpers import bn_num
import os
from aiogram.filters import Command

router = Router()

class SetupWizard(StatesGroup):
    welcome = State()
    import_houses = State()
    default_roles = State()
    import_users = State()
    import_field_force = State()
    import_retailer = State()

async def safe_edit_or_send(event: Message | CallbackQuery, text: str, reply_markup=None, parse_mode="HTML"):
    """একই মেসেজ এডিট করার চেষ্টা করবে, না পারলে নতুন পাঠাবে"""
    try:
        if isinstance(event, CallbackQuery):
            return await event.message.edit_text(text, reply_markup=reply_markup, parse_mode=parse_mode)
        else:
            # আগের মেসেজ ডিলিট করার ট্রাই করা যেতে পারে যদি আইডি থাকে
            return await event.answer(text, reply_markup=reply_markup, parse_mode=parse_mode)
    except Exception:
        return await (event.message.answer(text, reply_markup=reply_markup, parse_mode=parse_mode) 
                      if isinstance(event, CallbackQuery) else event.answer(text, reply_markup=reply_markup, parse_mode=parse_mode))

@router.message(Command("setup"))
async def cmd_manual_setup(message: Message, state: FSMContext):
    if int(message.from_user.id) != int(SUPER_ADMIN_ID):
        return
    
    await state.clear()
    builder = InlineKeyboardBuilder()
    builder.button(text="🚀 Start Setup Wizard", callback_data="start_setup_wizard")
    
    msg = await message.answer(
        "👋 **সেটআপ উইজার্ড ম্যানুয়াল ট্রিগার!**\n\n"
        "আপনি চাইলে এখন পুরো সিস্টেম কনফিগার করতে পারেন। শুরু করতে নিচের বাটনে ক্লিক করুন।",
        reply_markup=builder.as_markup(),
        parse_mode="Markdown"
    )
    await state.update_data(wizard_msg_id=msg.message_id)

@router.callback_query(F.data == "start_setup_wizard")
async def start_wizard(callback: CallbackQuery, state: FSMContext):
    await state.set_state(SetupWizard.import_houses)
    await callback.message.edit_text(
        "🚀 **Setup Wizard শুরু হচ্ছে!**\n\n"
        "প্রথমে আপনার **House List** এর Excel ফাইলটি পাঠান।\n"
        "ফাইলটিতে অবশ্যই NAME, CODE, CLUSTER, REGION এবং DMS তথ্যগুলো থাকতে হবে।",
        parse_mode="Markdown"
    )
    await callback.answer()

@router.message(SetupWizard.import_houses, F.document)
async def process_house_excel_step(message: Message, state: FSMContext):
    data = await state.get_data()
    old_msg_id = data.get('wizard_msg_id')
    
    # আগের মেসেজ ডিলিট করা (ক্লিন রাখার জন্য)
    if old_msg_id:
        try: await message.bot.delete_message(message.chat.id, old_msg_id)
        except: pass

    msg = await message.answer("⏳ হাউজ ডাটা প্রসেসিং শুরু হচ্ছে...")
    await state.update_data(wizard_msg_id=msg.message_id)
    
    local_path = f"temp_downloads/house_setup.xlsx"
    os.makedirs("temp_downloads", exist_ok=True)
    
    file_id = message.document.file_id
    file = await message.bot.get_file(file_id)
    await message.bot.download_file(file.file_path, local_path)
    
    async def progress_update(text):
        try: await msg.edit_text(text, parse_mode="HTML")
        except: pass

    count, house_ids, error = await process_house_excel(local_path, progress_update)
    
    if error:
        return await msg.edit_text(f"❌ এরর: {error}")
    
    # সুপার এডমিনকে লিঙ্ক করা
    async with async_session() as session:
        res = await session.execute(
            select(User).options(selectinload(User.houses)).where(User.telegram_id == int(SUPER_ADMIN_ID))
        )
        admin_user = res.scalar_one_or_none()
        if not admin_user:
            admin_user = User(telegram_id=int(SUPER_ADMIN_ID), name="Super Admin", status="Active")
            session.add(admin_user)
            await session.flush()
        
        await session.refresh(admin_user, ["houses"])
        all_imported_houses = await session.execute(select(House).where(House.id.in_(house_ids)))
        for h in all_imported_houses.scalars().all():
            if h not in admin_user.houses:
                admin_user.houses.append(h)
        
        await session.commit()
        await state.update_data(house_id=house_ids[0])

    builder = InlineKeyboardBuilder()
    builder.button(text="✅ হ্যাঁ, তৈরি করুন", callback_data="setup_create_roles")
    builder.button(text="❌ না, পরে করব", callback_data="setup_skip_roles")
    
    await msg.edit_text(
        f"✅ সফলভাবে <b>{bn_num(count)}</b> টি হাউজ যুক্ত করা হয়েছে।\n\n"
        "এখন কি আপনি ডিফল্ট রোলগুলো (Admin, Manager, SR, BP) তৈরি করতে চান?",
        reply_markup=builder.as_markup(),
        parse_mode="HTML"
    )
    await state.set_state(SetupWizard.default_roles)

@router.callback_query(F.data == "setup_create_roles", SetupWizard.default_roles)
async def create_default_roles(callback: CallbackQuery, state: FSMContext):
    await callback.message.edit_text("⏳ ডিফল্ট ডাটা সিড হচ্ছে...")
    async with async_session() as session:
        await seed_system_data(session)
        admin_role_res = await session.execute(select(Role).where(Role.name == "Admin"))
        admin_role = admin_role_res.scalar_one_or_none()
        if admin_role:
            admin_user_res = await session.execute(
                select(User).options(selectinload(User.roles)).where(User.telegram_id == int(SUPER_ADMIN_ID))
            )
            admin_user = admin_user_res.scalar_one_or_none()
            if admin_user and admin_role not in admin_user.roles:
                admin_user.roles.append(admin_role)
                await session.commit()
    
    await proceed_to_user_import(callback, state, "✅ রোল ও পারমিশন তৈরি হয়েছে।")
    await callback.answer()

@router.callback_query(F.data == "setup_skip_roles", SetupWizard.default_roles)
async def skip_roles(callback: CallbackQuery, state: FSMContext):
    await proceed_to_user_import(callback, state)
    await callback.answer()

async def proceed_to_user_import(event: Message | CallbackQuery, state: FSMContext, prefix=""):
    builder = InlineKeyboardBuilder()
    builder.button(text="📤 Excel আপলোড করুন", callback_data="setup_upload_users")
    builder.button(text="⏭ স্কিপ করুন", callback_data="setup_skip_users")
    
    text = (f"{prefix}\n\n" if prefix else "") + "👤 এখন আপনি **User List** এর Excel ফাইলটি পাঠান।"
    
    if isinstance(event, CallbackQuery):
        await event.message.edit_text(text, reply_markup=builder.as_markup(), parse_mode="Markdown")
    else:
        msg = await event.answer(text, reply_markup=builder.as_markup(), parse_mode="Markdown")
        await state.update_data(wizard_msg_id=msg.message_id)
        
    await state.set_state(SetupWizard.import_users)

@router.callback_query(F.data == "setup_upload_users", SetupWizard.import_users)
async def request_user_excel(callback: CallbackQuery, state: FSMContext):
    await callback.message.edit_text("দয়া করে User List এর Excel ফাইলটি পাঠান।")
    await callback.answer()

@router.message(SetupWizard.import_users, F.document)
async def process_user_excel_step(message: Message, state: FSMContext):
    data = await state.get_data()
    house_id = data['house_id']
    old_msg_id = data.get('wizard_msg_id')
    
    if old_msg_id:
        try: await message.bot.delete_message(message.chat.id, old_msg_id)
        except: pass

    msg = await message.answer("⏳ ইউজার ডাটা প্রসেসিং শুরু হচ্ছে...")
    await state.update_data(wizard_msg_id=msg.message_id)
    
    file_id = message.document.file_id
    file = await message.bot.get_file(file_id)
    local_path = f"temp_downloads/user_setup_{house_id}.xlsx"
    await message.bot.download_file(file.file_path, local_path)
    
    async def progress_update(text):
        try: await msg.edit_text(text, parse_mode="HTML")
        except: pass

    count, error = await process_user_excel(local_path, house_id, progress_update)
    
    if error:
        return await msg.edit_text(f"❌ এরর: {error}")
    
    await proceed_to_ff_import(msg, state, f"✅ সফলভাবে <b>{bn_num(count)}</b> জন ইউজার যুক্ত হয়েছে।")

@router.callback_query(F.data == "setup_skip_users", SetupWizard.import_users)
async def skip_users(callback: CallbackQuery, state: FSMContext):
    await proceed_to_ff_import(callback, state)
    await callback.answer()

async def proceed_to_ff_import(event: Message | CallbackQuery, state: FSMContext, prefix=""):
    builder = InlineKeyboardBuilder()
    builder.button(text="📤 Excel আপলোড করুন", callback_data="setup_upload_ff")
    builder.button(text="⏭ স্কিপ করুন", callback_data="setup_skip_ff")
    
    text = (f"{prefix}\n\n" if prefix else "") + "📊 এখন আপনি **Field Force (SR/BP)** এর Excel ফাইলটি পাঠান।"
    
    if isinstance(event, CallbackQuery):
        await event.message.edit_text(text, reply_markup=builder.as_markup(), parse_mode="HTML" if prefix else "Markdown")
    else:
        # Message অবজেক্ট (প্রসেসিং শেষ হওয়ার পর)
        await event.edit_text(text, reply_markup=builder.as_markup(), parse_mode="HTML" if prefix else "Markdown")
        
    await state.set_state(SetupWizard.import_field_force)

@router.callback_query(F.data == "setup_upload_ff", SetupWizard.import_field_force)
async def request_ff_excel(callback: CallbackQuery, state: FSMContext):
    await callback.message.edit_text("দয়া করে Field Force এর Excel ফাইলটি পাঠান।")
    await callback.answer()

@router.message(SetupWizard.import_field_force, F.document)
async def process_ff_excel_step(message: Message, state: FSMContext):
    data = await state.get_data()
    house_id = data['house_id']
    old_msg_id = data.get('wizard_msg_id')
    
    if old_msg_id:
        try: await message.bot.delete_message(message.chat.id, old_msg_id)
        except: pass

    msg = await message.answer("⏳ ফিল্ড ফোর্স ডাটা প্রসেসিং শুরু হচ্ছে...")
    await state.update_data(wizard_msg_id=msg.message_id)
    
    file_id = message.document.file_id
    file = await message.bot.get_file(file_id)
    local_path = f"temp_downloads/ff_setup_{house_id}.xlsx"
    await message.bot.download_file(file.file_path, local_path)
    
    async def progress_update(text):
        try: await msg.edit_text(text, parse_mode="HTML")
        except: pass

    count, error = await process_field_force_excel(local_path, house_id, progress_update)
    
    if error:
        return await msg.edit_text(f"❌ এরর: {error}")
        
    await proceed_to_retailer_import(msg, state, f"✅ সফলভাবে <b>{bn_num(count)}</b> জন ফিল্ড ফোর্স সদস্য যুক্ত হয়েছে।")

@router.callback_query(F.data == "setup_skip_ff", SetupWizard.import_field_force)
async def skip_ff(callback: CallbackQuery, state: FSMContext):
    await proceed_to_retailer_import(callback, state)
    await callback.answer()

async def proceed_to_retailer_import(event: Message | CallbackQuery, state: FSMContext, prefix=""):
    builder = InlineKeyboardBuilder()
    builder.button(text="📤 Excel আপলোড করুন", callback_data="setup_upload_retailer")
    builder.button(text="⏭ স্কিপ করুন", callback_data="setup_skip_retailer")
    
    text = (f"{prefix}\n\n" if prefix else "") + "🏪 এখন আপনি **Retailer** এর Excel ফাইলটি পাঠান।"
    
    if isinstance(event, CallbackQuery):
        await event.message.edit_text(text, reply_markup=builder.as_markup(), parse_mode="HTML" if prefix else "Markdown")
    else:
        await event.edit_text(text, reply_markup=builder.as_markup(), parse_mode="HTML" if prefix else "Markdown")
        
    await state.set_state(SetupWizard.import_retailer)

@router.callback_query(F.data == "setup_upload_retailer", SetupWizard.import_retailer)
async def request_retailer_excel(callback: CallbackQuery, state: FSMContext):
    await callback.message.edit_text("দয়া করে Retailer এর Excel ফাইলটি পাঠান।")
    await callback.answer()

@router.message(SetupWizard.import_retailer, F.document)
async def process_retailer_excel_step(message: Message, state: FSMContext):
    data = await state.get_data()
    house_id = data['house_id']
    old_msg_id = data.get('wizard_msg_id')
    
    if old_msg_id:
        try: await message.bot.delete_message(message.chat.id, old_msg_id)
        except: pass

    msg = await message.answer("⏳ রিটেইলার ডাটা প্রসেসিং শুরু হচ্ছে...")
    await state.update_data(wizard_msg_id=msg.message_id)
    
    file_id = message.document.file_id
    file = await message.bot.get_file(file_id)
    local_path = f"temp_downloads/ret_setup_{house_id}.xlsx"
    await message.bot.download_file(file.file_path, local_path)
    
    async def progress_update(text):
        try: await msg.edit_text(text, parse_mode="HTML")
        except: pass

    count, error = await process_retailer_excel(local_path, house_id, progress_update)
    
    if error:
        return await msg.edit_text(f"❌ এরর: {error}")
    
    await finish_wizard(msg, state, f"✅ সফলভাবে <b>{bn_num(count)}</b> জন রিটেইলার যুক্ত হয়েছে।")

@router.callback_query(F.data == "setup_skip_retailer", SetupWizard.import_retailer)
async def skip_retailer(callback: CallbackQuery, state: FSMContext):
    await finish_wizard(callback, state)
    await callback.answer()

async def finish_wizard(event: Message | CallbackQuery, state: FSMContext, prefix=""):
    async with async_session() as session:
        all_perms_res = await session.execute(select(Permission.name))
        user_permissions = [p[0] for p in all_perms_res.all()]
        
    await state.clear()
    from app.Views.keyboards.reply import get_admin_main_menu
    
    text = (f"{prefix}\n\n" if prefix else "") + "🎉 **অভিনন্দন! Setup সম্পন্ন হয়েছে।**\n\nএখন আপনি বটটি ব্যবহার করতে পারবেন।"
    
    if isinstance(event, CallbackQuery):
        await event.message.edit_text(text, parse_mode="HTML" if prefix else "Markdown")
        await event.message.answer("মেইন মেনু ওপেন হচ্ছে...", reply_markup=get_admin_main_menu(user_permissions))
    else:
        await event.edit_text(text, parse_mode="HTML" if prefix else "Markdown")
        await event.answer("মেইন মেনু ওপেন হচ্ছে...", reply_markup=get_admin_main_menu(user_permissions))
