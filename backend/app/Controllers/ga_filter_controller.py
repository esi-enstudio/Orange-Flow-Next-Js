import logging
from datetime import datetime
from aiogram import Router, F
from aiogram.types import Message, CallbackQuery
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.utils.keyboard import InlineKeyboardBuilder
from sqlalchemy import select, delete, func
from sqlalchemy.orm import selectinload

from app.Models.ga_filter import GAProductFilter, RetailerFilter, FilterTag
from app.Models.user import User
from app.Models.house import House
from app.Models.retailer import Retailer
from app.Services.db_service import async_session
from app.Utils.helpers import bn_num
from config.settings import SUPER_ADMIN_ID

logger = logging.getLogger(__name__)
router = Router()

class FilterStates(StatesGroup):
    waiting_for_product = State()
    waiting_for_retailer_code = State()
    waiting_for_tag_selection = State()
    waiting_for_new_tag_name = State()

# ==========================================
# ১. সেন্ট্রাল হাউজ লজিক (সব সমস্যার সমাধান এখানে) ✅
# ==========================================
async def handle_gaf_house_logic(message: Message, state: FSMContext, user_tg_id: int, is_callback=False):
    async with async_session() as session:
        # সুপার এডমিন চেক
        is_super_admin = (int(user_tg_id) == int(SUPER_ADMIN_ID))
        target_houses = []

        if is_super_admin:
            # সুপার এডমিন হলে ডাটাবেজের সব হাউজ লোড করবে ✅
            res = await session.execute(select(House).where(House.is_active == True, House.subscription_date >= datetime.now()))
            target_houses = res.scalars().all()
        else:
            # সাধারণ ইউজার হলে তার প্রোফাইলের হাউজ লোড করবে
            res = await session.execute(
                select(User).options(selectinload(User.houses)).where(User.telegram_id == user_tg_id)
            )
            user = res.scalar_one_or_none()
            if user:
                target_houses = [h for h in user.houses if h.is_active and h.subscription_date and h.subscription_date >= datetime.now()]

        if not target_houses:
            msg = "❌ বর্তমানে আপনার প্রোফাইলে কোনো হাউজ যুক্ত নেই।"
            return await message.edit_text(msg) if is_callback else await message.answer(msg)

        # ১টি হাউজ থাকলে সরাসরি মেনু দেখাবে
        if len(target_houses) == 1:
            await render_filter_menu(message, target_houses[0].id)
        else:
            # একাধিক হাউজ থাকলে সিলেকশন বাটন
            builder = InlineKeyboardBuilder()
            for h in target_houses:
                builder.button(text=f"🏢 {h.display_name}", callback_data=f"gaf_hsel_{h.id}")
            builder.adjust(1)
            
            text = "⚙️ **জিএ ফিল্টার সেটিংস**\nহাউজ নির্বাচন করুন:"
            if is_callback:
                await message.edit_text(text, reply_markup=builder.as_markup(), parse_mode="Markdown")
            else:
                await message.answer(text, reply_markup=builder.as_markup(), parse_mode="Markdown")


# --- এন্ট্রি পয়েন্ট (Reply Keyboard) ---
@router.message(F.text == "⚙️ GA Filter", flags={"permission": "manage_ga_filter"})
async def ga_filter_start(message: Message, state: FSMContext):
    await state.clear()
    # এখানে message.from_user.id সঠিক ✅
    await handle_gaf_house_logic(message, state, message.from_user.id)

# --- হাউজ সিলেকশন হ্যান্ডেলার ---
@router.callback_query(F.data.startswith("gaf_hsel_"))
async def handle_gaf_house_selection(callback: CallbackQuery, state: FSMContext):
    house_id = int(callback.data.split("_")[2])
    await callback.message.delete()
    await render_filter_menu(callback.message, house_id)
    await callback.answer()

# --- হাউজ পরিবর্তন বাটন ফিক্স ✅ ---
@router.callback_query(F.data == "gaf_change_h")
async def gaf_change_h(callback: CallbackQuery, state: FSMContext):
    # এখানে অবশ্যই callback.from_user.id ব্যবহার করতে হবে ✅
    await handle_gaf_house_logic(callback.message, state, callback.from_user.id, is_callback=True)
    await callback.answer()

# ==========================================
# ২. ফিল্টার ড্যাশবোর্ড রেন্ডার
# ==========================================
async def render_filter_menu(message: Message, house_id: int):
    async with async_session() as session:
        # হাউজের তথ্য এবং কাউন্ট সংগ্রহ
        house = await session.get(House, house_id)
        if not house: return

        from app.Utils.helpers import bn_num # বাংলা সংখ্যা হেল্পার
        
        p_count = await session.scalar(select(func.count(GAProductFilter.id)).where(GAProductFilter.house_id == house_id))
        r_count = await session.scalar(select(func.count(RetailerFilter.id)).where(RetailerFilter.house_id == house_id))
        t_count = await session.scalar(select(func.count(FilterTag.id)).where(FilterTag.house_id == house_id))

        text = (
            f"🛠 **রিটেইলার ফিল্টার সেটিংস**\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"🏢 হাউজ: **{house.name}**\n\n"
            f"🚫 প্রোডাক্ট ফিল্টার: `{bn_num(p_count) or bn_num(0)}` টি\n"
            f"🔍 রিটেইলার ফিল্টার: `{bn_num(r_count) or bn_num(0)}` টি\n"
            f"🏷 ফিল্টার ট্যাগ: `{bn_num(t_count) or bn_num(0)}` টি\n\n"
            f"তালিকাসমূহ দেখতে বা নতুন ফিল্টার যোগ করতে নিচের বাটনগুলো ব্যবহার করুন:"
        )
        
        builder = InlineKeyboardBuilder()
        builder.button(text="📋 প্রোডাক্ট ফিল্টার তালিকা", callback_data=f"gaf_plist_{house_id}")
        builder.button(text="📋 রিটেইলার ফিল্টার তালিকা", callback_data=f"gaf_rlist_{house_id}")
        builder.button(text="🏷 ফিল্টার ট্যাগ ম্যানেজমেন্ট", callback_data=f"gaf_tlist_{house_id}")
        builder.button(text="🔄 হাউজ পরিবর্তন করুন", callback_data="gaf_change_h")
        builder.adjust(1)
        
        try:
            # কলব্যাক থেকে আসলে মেসেজ এডিট করবে
            if hasattr(message, "edit_text"):
                await message.edit_text(text, reply_markup=builder.as_markup(), parse_mode="Markdown")
            else:
                await message.answer(text, reply_markup=builder.as_markup(), parse_mode="Markdown")
        except Exception:
            await message.answer(text, reply_markup=builder.as_markup(), parse_mode="Markdown")


# --- লিস্ট থেকে এই সামারি পেজে ফেরত আসার জন্য ✅ ---
@router.callback_query(F.data.startswith("gaf_main_"))
async def handle_back_to_filter_main(callback: CallbackQuery):
    house_id = int(callback.data.split("_")[2])
    await render_filter_menu(callback.message, house_id)
    await callback.answer()


@router.callback_query(F.data == "gaf_change_h")
async def gaf_change_h(callback: CallbackQuery, state: FSMContext):
    await ga_filter_start(callback.message, state)
    await callback.answer()

# ==========================================
# ৩. প্রোডাক্ট ফিল্টার লজিক
# ==========================================
@router.callback_query(F.data.startswith("gaf_plist_"))
async def list_product_filters(event, house_id: int = None):
    # ইভেন্টের ধরন অনুযায়ী হাউজ আইডি ও মেসেজ অবজেক্ট নির্ধারণ
    if isinstance(event, CallbackQuery):
        house_id = int(event.data.split("_")[2])
        msg_obj = event.message
    else:
        # সরাসরি মেসেজ (যেমন সেভ করার পর কল করলে)
        msg_obj = event

    async with async_session() as session:
        res = await session.execute(select(GAProductFilter).where(GAProductFilter.house_id == house_id))
        filters = res.scalars().all()
        
        text = "🚫 **বাদ দেওয়া প্রোডাক্ট কোডসমূহ:**\n(ডিলিট করতে বাটনে ক্লিক করুন)\n"
        if not filters: text += "\n_বর্তমানে কোনো ফিল্টার নেই।_"

        builder = InlineKeyboardBuilder()
        for f in filters:
            builder.button(text=f"❌ {f.product_code}", callback_data=f"gaf_pdel_{f.id}_{house_id}")
        
        builder.button(text="➕ নতুন কোড যোগ করুন", callback_data=f"gaf_padd_{house_id}")
        # এটি আপনাকে মেইন ফিল্টার সামারিতে নিয়ে যাবে (হাউজ সিলেকশনে নয়)
        builder.button(text="🔙 ব্যাকে যান", callback_data=f"gaf_main_{house_id}")
        builder.adjust(2)

        if isinstance(event, CallbackQuery):
            await msg_obj.edit_text(text, reply_markup=builder.as_markup(), parse_mode="Markdown")
            await event.answer()
        else:
            await msg_obj.answer(text, reply_markup=builder.as_markup(), parse_mode="Markdown")

@router.callback_query(F.data.startswith("gaf_padd_"))
async def add_product_filter_start(callback: CallbackQuery, state: FSMContext):
    house_id = int(callback.data.split("_")[2])
    await state.update_data(f_house_id=house_id)
    await callback.message.answer("প্রোডাক্ট কোডটি লিখুন (উদা: SIMSWAP):")
    await state.set_state(FilterStates.waiting_for_product)
    await callback.answer()

@router.message(FilterStates.waiting_for_product)
async def save_product_filter(message: Message, state: FSMContext):
    data = await state.get_data()
    house_id = data.get('f_house_id')
    code = message.text.upper().strip()
    
    async with async_session() as session:
        existing = await session.execute(
            select(GAProductFilter).where(GAProductFilter.house_id == house_id, GAProductFilter.product_code == code)
        )
        if existing.scalar_one_or_none():
            await message.answer(f"⚠️ `{code}` ইতিপূবেই তালিকায় আছে।")
        else:
            session.add(GAProductFilter(house_id=house_id, product_code=code))
            await session.commit()
            await message.answer(f"✅ প্রোডাক্ট `{code}` যুক্ত হয়েছে।")
    
    await state.clear()
    # ম্যানুয়াল অবজেক্টের বদলে সরাসরি বর্তমান মেসেজটি পাঠিয়ে দিন ✅
    await list_product_filters(message, house_id=house_id)

# ==========================================
# ৪. রিটেইলার ফিল্টার লজিক
# ==========================================
@router.callback_query(F.data.startswith("gaf_rlist_"))
async def list_retailer_filters(event, house_id: int = None):
    if isinstance(event, CallbackQuery):
        house_id = int(event.data.split("_")[2])
        msg_obj = event.message
    else:
        msg_obj = event

    async with async_session() as session:
        # রিটেইলার ডাটা সহ ফিল্টার লোড করা ✅
        res = await session.execute(
            select(RetailerFilter).options(selectinload(RetailerFilter.retailer))
            .where(RetailerFilter.house_id == house_id)
        )
        filters = res.scalars().all()
        
        text = "🔍 **বাদ দেওয়া রিটেইলারসমূহ:**\n(ডিলিট করতে বাটনে ক্লিক করুন)\n"
        if not filters: text += "\n_বর্তমানে কোনো ফিল্টার নেই।_"

        builder = InlineKeyboardBuilder()
        for f in filters:
            r_info = f"{f.retailer.retailer_code} - {f.retailer.name}" if f.retailer else f"ID: {f.retailer_id}"
            label = f"❌ {r_info}"
            if f.tag: label += f" ({f.tag})"
            builder.button(text=label, callback_data=f"gaf_rdel_{f.id}_{house_id}")
        
        builder.button(text="➕ নতুন রিটেইলার যোগ", callback_data=f"gaf_radd_{house_id}")
        builder.button(text="🔙 ব্যাকে যান", callback_data=f"gaf_main_{house_id}")
        builder.adjust(1)

        if isinstance(event, CallbackQuery):
            await msg_obj.edit_text(text, reply_markup=builder.as_markup(), parse_mode="Markdown")
            await event.answer()
        else:
            await msg_obj.answer(text, reply_markup=builder.as_markup(), parse_mode="Markdown")

@router.callback_query(F.data.startswith("gaf_radd_"))
async def add_retailer_filter_start(callback: CallbackQuery, state: FSMContext):
    house_id = int(callback.data.split("_")[2])
    await state.update_data(f_house_id=house_id)
    await callback.message.answer("রিটেইলার কোডটি লিখুন (উদা: R1010):")
    await state.set_state(FilterStates.waiting_for_retailer_code)
    await callback.answer()

@router.message(FilterStates.waiting_for_retailer_code)
async def process_retailer_code_input(message: Message, state: FSMContext):
    code = message.text.upper().strip()
    data = await state.get_data()
    house_id = data.get('f_house_id')

    async with async_session() as session:
        # রিটেইলার এবং তার আরএসও (FieldForce) এর তথ্য লোড করা ✅
        res = await session.execute(
            select(Retailer).options(selectinload(Retailer.field_force))
            .where(Retailer.house_id == house_id, Retailer.retailer_code == code)
        )
        retailer = res.scalar_one_or_none()
        
        if not retailer:
            return await message.answer(f"❌ এরর: হাউজ আইডি {house_id} এ `{code}` কোডের কোনো রিটেইলার পাওয়া যায়নি। আগে রিটেইলারটি আপলোড করুন।")

        # আরএসও এর আইটপ নাম্বারের শেষ ৩ সংখ্যা বের করা
        rso_suffix = ""
        if retailer.field_force and retailer.field_force.itop_number:
            rso_suffix = f" ({str(retailer.field_force.itop_number)[-3:]})"

        retailer_itop = retailer.itop_number if retailer.itop_number else "N/A"
        
        await state.update_data(f_retailer_id=retailer.id, f_retailer_code=code)

        # ট্যাগগুলো লোড করা
        res = await session.execute(select(FilterTag).where(FilterTag.house_id == house_id))
        tags = res.scalars().all()
        
        builder = InlineKeyboardBuilder()
        for t in tags:
            builder.button(text=t.name, callback_data=f"gaf_rtsel_{t.name}")
        
        builder.button(text="➕ নতুন ট্যাগ তৈরি করুন", callback_data="gaf_rtnew")
        builder.button(text="⏩ ট্যাগ ছাড়াই সেভ করুন", callback_data="gaf_rtskip")
        builder.adjust(2)
        
        confirm_text = (
            f"<b>{retailer.name}{rso_suffix}</b>\n"
            f"<code>{code}</code>\n"
            f"<code>{retailer_itop}</code>\n\n"
            f"এর জন্য একটি ট্যাগ নির্বাচন করুন:"
        )
        
        await message.answer(confirm_text, reply_markup=builder.as_markup(), parse_mode="HTML")
        await state.set_state(FilterStates.waiting_for_tag_selection)

@router.callback_query(F.data.startswith("gaf_rtsel_"), FilterStates.waiting_for_tag_selection)
async def handle_tag_selection(callback: CallbackQuery, state: FSMContext):
    tag_name = callback.data.split("_")[2]
    await save_retailer_filter_with_tag(callback.message, state, tag_name)
    await callback.answer()

@router.callback_query(F.data == "gaf_rtskip", FilterStates.waiting_for_tag_selection)
async def handle_tag_skip(callback: CallbackQuery, state: FSMContext):
    await save_retailer_filter_with_tag(callback.message, state, None)
    await callback.answer()

@router.callback_query(F.data == "gaf_rtnew", FilterStates.waiting_for_tag_selection)
async def handle_new_tag_request(callback: CallbackQuery, state: FSMContext):
    await callback.message.answer("নতুন ট্যাগের নাম লিখুন (উদা: DRC, Staff, BP):")
    await state.set_state(FilterStates.waiting_for_new_tag_name)
    await callback.answer()

@router.message(FilterStates.waiting_for_new_tag_name)
async def process_new_tag_input(message: Message, state: FSMContext):
    tag_name = message.text.strip()
    if not tag_name:
        return await message.answer("❌ ট্যাগের নাম খালি হতে পারে না।")
    
    data = await state.get_data()
    house_id = data.get('f_house_id')

    async with async_session() as session:
        # ট্যাগটি আগে থেকেই আছে কিনা চেক
        existing = await session.execute(
            select(FilterTag).where(FilterTag.house_id == house_id, FilterTag.name == tag_name)
        )
        if not existing.scalar_one_or_none():
            session.add(FilterTag(house_id=house_id, name=tag_name))
            await session.commit()
    
    await save_retailer_filter_with_tag(message, state, tag_name)

async def save_retailer_filter_with_tag(message: Message, state: FSMContext, tag_name: str):
    data = await state.get_data()
    house_id = data.get('f_house_id')
    retailer_id = data.get('f_retailer_id')
    code = data.get('f_retailer_code')
    
    async with async_session() as session:
        existing = await session.execute(
            select(RetailerFilter).where(RetailerFilter.house_id == house_id, RetailerFilter.retailer_id == retailer_id)
        )
        if existing.scalar_one_or_none():
            await message.answer(f"⚠️ `{code}` ইতিপূবেই তালিকায় আছে।")
        else:
            session.add(RetailerFilter(house_id=house_id, retailer_id=retailer_id, tag=tag_name))
            await session.commit()
            tag_str = f" ({tag_name})" if tag_name else ""
            await message.answer(f"✅ রিটেইলার `{code}`{tag_str} যুক্ত হয়েছে।")
    
    await state.clear()
    await list_retailer_filters(message, house_id=house_id)

# ==========================================
# ৫. ফিল্টার ট্যাগ ম্যানেজমেন্ট
# ==========================================
@router.callback_query(F.data.startswith("gaf_tlist_"))
async def list_filter_tags(callback: CallbackQuery):
    house_id = int(callback.data.split("_")[2])
    
    async with async_session() as session:
        res = await session.execute(select(FilterTag).where(FilterTag.house_id == house_id))
        tags = res.scalars().all()
        
        text = "🏷 **ফিল্টার ট্যাগসমূহ:**\n(ডিলিট করলে ওই ট্যাগের রিটেইলারদের ট্যাগ মুছে যাবে)\n"
        if not tags: text += "\n_বর্তমানে কোনো ট্যাগ নেই।_"

        builder = InlineKeyboardBuilder()
        for t in tags:
            builder.button(text=f"❌ {t.name}", callback_data=f"gaf_tdel_{t.id}_{house_id}")
        
        builder.button(text="🔙 ব্যাকে যান", callback_data=f"gaf_main_{house_id}")
        builder.adjust(2)

        await callback.message.edit_text(text, reply_markup=builder.as_markup(), parse_mode="Markdown")
        await callback.answer()

@router.callback_query(F.data.startswith("gaf_tdel_"))
async def delete_filter_tag(callback: CallbackQuery):
    parts = callback.data.split("_")
    tag_id = int(parts[2])
    house_id = int(parts[3])
    
    async with async_session() as session:
        tag = await session.get(FilterTag, tag_id)
        if tag:
            # ওই ট্যাগের সব ফিল্টার থেকে ট্যাগ সরিয়ে দেওয়া
            from sqlalchemy import update
            await session.execute(
                update(RetailerFilter).where(RetailerFilter.house_id == house_id, RetailerFilter.tag == tag.name).values(tag=None)
            )
            await session.delete(tag)
            await session.commit()
    
    await callback.answer("🗑 ট্যাগটি মুছে ফেলা হয়েছে।")
    await list_filter_tags(callback)

# ==========================================
# ৬. ডিলিট হ্যান্ডেলার (Product & Retailer)
# ==========================================
@router.callback_query(F.data.startswith(("gaf_pdel_", "gaf_rdel_")))
async def delete_ga_filter(callback: CallbackQuery):
    parts = callback.data.split("_")
    is_prod = "pdel" in parts[1]
    filter_id = int(parts[2])
    house_id = int(parts[3])
    
    async with async_session() as session:
        model = GAProductFilter if is_prod else RetailerFilter
        await session.execute(delete(model).where(model.id == filter_id))
        await session.commit()
    
    await callback.answer("🗑 ফিল্টারটি মুছে ফেলা হয়েছে।")
    if is_prod:
        await list_product_filters(callback)
    else:
        await list_retailer_filters(callback)
