from aiogram import Router, F
from aiogram.types import Message, CallbackQuery, InlineKeyboardButton
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.utils.keyboard import InlineKeyboardBuilder
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload
from datetime import datetime

from app.Models.leave_management import LeaveRequest, LeaveStatus
from app.Models.field_force import FieldForce
from app.Models.user import User
from app.Services.db_service import async_session
from app.Views.keyboards.leave_keyboard import get_leave_mgmt_menu
from app.Views.keyboards.reply import get_admin_main_menu

router = Router()

class LeaveApplyForm(StatesGroup):
    field_force_id = State()
    leave_type = State()
    start_date = State()
    end_date = State()
    reason = State()

class LeaveActionForm(StatesGroup):
    leave_id = State()
    remarks = State()

# ==========================================
# 0. MAIN GATEWAY
# ==========================================

@router.message(F.text == "📅 Leave Management")
async def show_leave_main_menu(message: Message, permissions: list):
    """লিভ ম্যানেজমেন্টের মেইন মেনু (পারমিশন অনুযায়ী)"""
    if not any(p in permissions for p in ["apply_leave", "manage_leaves"]):
        return await message.answer("🚫 আপনার এই মেনুতে প্রবেশের অনুমতি নেই।")
        
    await message.answer(
        "📅 <b>লিভ ম্যানেজমেন্ট মেনু</b>\n\nনিচের অপশনগুলো থেকে নির্বাচন করুন:",
        reply_markup=get_leave_mgmt_menu(permissions),
        parse_mode="HTML"
    )

@router.message(F.text == "🔙 প্রধান মেনু")
async def back_from_leave(message: Message, permissions: list):
    """প্রধান মেনুতে ফিরে যাওয়া"""
    await message.answer(
        "আপনি প্রধান মেনুতে ফিরে এসেছেন।",
        reply_markup=get_admin_main_menu(permissions)
    )

# ==========================================
# 1. LEAVE APPLICATION (For Field Force/Admin)
# ==========================================

@router.message(F.text == "📅 Apply Leave", flags={"permission": "apply_leave"})
async def start_leave_apply(message: Message, state: FSMContext):
    await state.clear()
    async with async_session() as session:
        # ইউজারের সাথে যুক্ত ফিল্ড ফোর্স প্রোফাইল চেক
        result = await session.execute(
            select(User).where(User.telegram_id == message.from_user.id).options(selectinload(User.field_force_profile))
        )
        user = result.scalar_one_or_none()
        
        if not user or not user.field_force_profile:
            return await message.answer("❌ আপনার কোনো ফিল্ড ফোর্স প্রোফাইল নেই। এডমিনের সাথে যোগাযোগ করুন।")
        
        await state.update_data(field_force_id=user.field_force_profile.id, house_id=user.field_force_profile.house_id)
        
        builder = InlineKeyboardBuilder()
        types = ["Sick Leave", "Casual Leave", "Emergency Leave", "Official Duty"]
        for t in types:
            builder.button(text=t, callback_data=f"leave_type_{t}")
        builder.adjust(2)
        
        await message.answer("ছুটির ধরন সিলেক্ট করুন:", reply_markup=builder.as_markup())
        await state.set_state(LeaveApplyForm.leave_type)

@router.callback_query(LeaveApplyForm.leave_type, F.data.startswith("leave_type_"))
async def process_leave_type(callback: CallbackQuery, state: FSMContext):
    leave_type = callback.data.replace("leave_type_", "")
    await state.update_data(leave_type=leave_type)
    await callback.message.edit_text(f"টাইপ: {leave_type}\n\nছুটি শুরুর তারিখ লিখুন (YYYY-MM-DD):")
    await state.set_state(LeaveApplyForm.start_date)

@router.message(LeaveApplyForm.start_date)
async def process_start_date(message: Message, state: FSMContext):
    try:
        date = datetime.strptime(message.text, "%Y-%m-%d").date()
        await state.update_data(start_date=date)
        await message.answer("ছুটি শেষ হওয়ার তারিখ লিখুন (YYYY-MM-DD):")
        await state.set_state(LeaveApplyForm.end_date)
    except ValueError:
        await message.answer("ভুল ফরম্যাট! অনুগ্রহ করে YYYY-MM-DD (যেমন: 2024-05-20) এভাবে লিখুন।")

@router.message(LeaveApplyForm.end_date)
async def process_end_date(message: Message, state: FSMContext):
    try:
        end_date = datetime.strptime(message.text, "%Y-%m-%d").date()
        data = await state.get_data()
        start_date = data['start_date']
        
        if end_date < start_date:
            return await message.answer("⚠️ শেষ তারিখ শুরু তারিখের আগে হতে পারে না!")
            
        total_days = (end_date - start_date).days + 1
        await state.update_data(end_date=end_date, total_days=total_days)
        await message.answer(f"মোট {total_days} দিন। ছুটির কারণটি সংক্ষেপে লিখুন:")
        await state.set_state(LeaveApplyForm.reason)
    except ValueError:
        await message.answer("ভুল ফরম্যাট! অনুগ্রহ করে YYYY-MM-DD এভাবে লিখুন।")

@router.message(LeaveApplyForm.reason)
async def process_leave_reason(message: Message, state: FSMContext):
    data = await state.get_data()
    async with async_session() as session:
        new_leave = LeaveRequest(
            house_id=data['house_id'],
            field_force_id=data['field_force_id'],
            leave_type=data['leave_type'],
            start_date=data['start_date'],
            end_date=data['end_date'],
            total_days=data['total_days'],
            reason=message.text,
            status="Pending"
        )
        session.add(new_leave)
        await session.commit()
        
    await state.clear()
    await message.answer("✅ আপনার ছুটির আবেদন সফলভাবে জমা হয়েছে এবং অনুমোদনের জন্য অপেক্ষমান।")

# ==========================================
# 2. LEAVE MANAGEMENT (For Managers/Admins)
# ==========================================

@router.message(F.text == "📋 Pending Leaves", flags={"permission": "manage_leaves"})
async def list_pending_leaves(message: Message):
    async with async_session() as session:
        # ইউজারের হাউজ চেক (ম্যানেজার শুধু তার হাউজের পেন্ডিং লিস্ট দেখবেন)
        res = await session.execute(select(User).where(User.telegram_id == message.from_user.id).options(selectinload(User.houses)))
        user = res.scalar_one_or_none()
        house_ids = [h.id for h in user.houses] if user else []

        stmt = select(LeaveRequest).where(
            LeaveRequest.status == "Pending",
            LeaveRequest.house_id.in_(house_ids)
        ).options(selectinload(LeaveRequest.field_force))
        
        result = await session.execute(stmt)
        leaves = result.scalars().all()
        
        if not leaves:
            return await message.answer("🙌 কোনো পেন্ডিং ছুটির আবেদন নেই।")
            
        for leave in leaves:
            text = (
                f"📅 **ছুটির আবেদন**\n"
                f"👤 নাম: {leave.field_force.name}\n"
                f"🛠 টাইপ: {leave.leave_type}\n"
                f"⏱ সময়: {leave.duration_display}\n"
                f"📝 কারণ: {leave.reason}\n"
            )
            
            builder = InlineKeyboardBuilder()
            builder.button(text="✅ Approve", callback_data=f"leave_approve_{leave.id}")
            builder.button(text="❌ Reject", callback_data=f"leave_reject_{leave.id}")
            builder.adjust(2)
            
            await message.answer(text, reply_markup=builder.as_markup(), parse_mode="Markdown")

@router.callback_query(F.data.startswith("leave_approve_"), flags={"permission": "manage_leaves"})
async def approve_leave(callback: CallbackQuery):
    leave_id = int(callback.data.split("_")[2])
    async with async_session() as session:
        # এপ্রুভারের আইডি খুঁজে বের করা
        res = await session.execute(select(User).where(User.telegram_id == callback.from_user.id))
        admin = res.scalar_one_or_none()
        
        leave = await session.get(LeaveRequest, leave_id)
        if leave:
            leave.status = "Approved"
            leave.approved_by = admin.id if admin else None
            await session.commit()
            await callback.message.edit_text(callback.message.text + "\n\n✅ **Approved**", parse_mode="Markdown")
            await callback.answer("ছুটি অনুমোদিত হয়েছে।")

@router.callback_query(F.data.startswith("leave_reject_"), flags={"permission": "manage_leaves"})
async def start_reject_leave(callback: CallbackQuery, state: FSMContext):
    leave_id = int(callback.data.split("_")[2])
    await state.update_data(reject_leave_id=leave_id)
    await callback.message.answer("রিজেক্ট করার কারণ বা মন্তব্য লিখুন:")
    await state.set_state(LeaveActionForm.remarks)
    await callback.answer()

@router.message(LeaveActionForm.remarks)
async def finalize_reject_leave(message: Message, state: FSMContext):
    data = await state.get_data()
    leave_id = data['reject_leave_id']
    
    async with async_session() as session:
        res = await session.execute(select(User).where(User.telegram_id == message.from_user.id))
        admin = res.scalar_one_or_none()
        
        leave = await session.get(LeaveRequest, leave_id)
        if leave:
            leave.status = "Rejected"
            leave.admin_remarks = message.text
            leave.approved_by = admin.id if admin else None
            await session.commit()
            
    await state.clear()
    await message.answer("❌ আবেদনটি রিজেক্ট করা হয়েছে।")
