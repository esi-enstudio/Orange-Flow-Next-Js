import os
import logging
from datetime import datetime
from aiogram import Router, F, types
from aiogram.types import Message, CallbackQuery, InlineKeyboardButton, FSInputFile
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.utils.keyboard import InlineKeyboardBuilder
from sqlalchemy import select, func, or_
from sqlalchemy.orm import selectinload

from app.Models.product import Product
from app.Services.db_service import async_session
from app.Services.Automation.product_excel import process_product_excel, generate_product_sample_excel
from app.Utils.helpers import bn_num

logger = logging.getLogger(__name__)
router = Router()

class ProductStates(StatesGroup):
    waiting_for_excel = State()
    search_query = State()
    edit_value = State()
    # New states for manual add
    add_p_code = State()
    add_p_type = State()
    add_p_mrp = State()
    add_p_dd = State()
    add_p_ret = State()

PAGE_LIMIT = 5

def get_product_detail_text(p: Product):
    return (
        f"📦 **Product Details**\n━━━━━━━━━━━━━━━━━━━━━━━━━\n"
        f"🔹 Code: `{p.product_code}`\n"
        f"🔹 Type: {p.product_type or 'N/A'}\n"
        f"🔹 MRP: {p.mrp} TK\n"
        f"🔹 DD Lifting: {p.dd_lifting_price} TK\n"
        f"🔹 Ret Lifting: {p.ret_lifting_price} TK\n"
        f"━━━━━━━━━━━━━━━━━━━━━━━━━"
    )

@router.message(F.text == "📦 Products", flags={"permission": "view_product"})
async def product_main(event: types.Union[Message, CallbackQuery], state: FSMContext, permissions: list):
    is_callback = isinstance(event, CallbackQuery)
    target = event.message if is_callback else event
    await state.clear()
    
    async with async_session() as session:
        count = await session.scalar(select(func.count(Product.id)))

    builder = InlineKeyboardBuilder()
    
    if count > 0:
        if "view_product" in permissions:
            builder.button(text="📋 List", callback_data="prod_list_0")
            builder.button(text="🔍 Search", callback_data="prod_search_start")
    
    if "create_product" in permissions:
        builder.button(text="➕ Add New", callback_data="prod_add_manual")
        builder.button(text="📤 Upload", callback_data="prod_upload_start")
        builder.button(text="📥 Sample", callback_data="prod_sample_dl")

    text = f"📦 **Product Management**\n📊 Total Products: `{count}`"
    
    if is_callback:
        await event.message.edit_text(text, reply_markup=builder.adjust(2).as_markup(), parse_mode="HTML")
    else:
        await target.answer(text, reply_markup=builder.adjust(2).as_markup(), parse_mode="HTML")

@router.callback_query(F.data == "prod_back_main")
async def prod_back_main(callback: CallbackQuery, state: FSMContext, permissions: list):
    await product_main(callback, state, permissions)

@router.callback_query(F.data.startswith("prod_list_"), flags={"permission": "view_product"})
async def list_products(callback: CallbackQuery, state: FSMContext, permissions: list):
    offset = int(callback.data.split("_")[2])
    
    async with async_session() as session:
        total = await session.scalar(select(func.count(Product.id)))
        res = await session.execute(
            select(Product).order_by(Product.product_code).limit(PAGE_LIMIT).offset(offset)
        )
        products = res.scalars().all()

        builder = InlineKeyboardBuilder()
        for p in products:
            builder.button(text=f"{p.product_code} | {p.product_type or 'N/A'}", callback_data=f"prod_view_{p.id}_{offset}")
        
        builder.adjust(1)
        
        nav = []
        if offset > 0:
            nav.append(InlineKeyboardButton(text="⬅️ Previous", callback_data=f"prod_list_{offset - PAGE_LIMIT}"))
        
        if offset + PAGE_LIMIT < total:
            nav.append(InlineKeyboardButton(text="Next ➡️", callback_data=f"prod_list_{offset + PAGE_LIMIT}"))
        
        if nav:
            builder.row(*nav)

        builder.row(InlineKeyboardButton(text="🔙 Back", callback_data="prod_back_main"))

        await callback.message.edit_text(
            f"📋 **Product List** ({total}):\n(Page: {offset//PAGE_LIMIT + 1})",
            reply_markup=builder.as_markup()
        )

@router.callback_query(F.data.startswith("prod_view_"), flags={"permission": "view_product"})
async def view_product(callback: CallbackQuery, permissions: list):
    parts = callback.data.split("_")
    prod_id = int(parts[2])
    back_offset = parts[3] if len(parts) > 3 else "0"
    
    async with async_session() as session:
        p = await session.get(Product, prod_id)
        if not p: return await callback.answer("❌ প্রোডাক্ট পাওয়া যায়নি।", show_alert=True)

        builder = InlineKeyboardBuilder()
        if "update_product" in permissions:
            builder.button(text="✏️ Edit", callback_data=f"prod_edit_menu_{p.id}_{back_offset}")
        if "delete_product" in permissions:
            builder.button(text="🗑 Delete", callback_data=f"prod_conf_del_{p.id}_{back_offset}")
        
        builder.button(text="🔙 List", callback_data=f"prod_list_{back_offset}")
        builder.button(text="🏠 Menu", callback_data="prod_back_main")
        builder.adjust(2)

        await callback.message.edit_text(
            get_product_detail_text(p),
            reply_markup=builder.as_markup(),
            parse_mode="HTML"
        )

@router.callback_query(F.data.startswith("prod_edit_menu_"), flags={"permission": "update_product"})
async def prod_edit_menu(callback: CallbackQuery):
    parts = callback.data.split("_")
    prod_id = int(parts[3])
    back_offset = parts[4] if len(parts) > 4 else "0"
    
    builder = InlineKeyboardBuilder()
    fields = [
        ("Type", "product_type"), ("MRP", "mrp"), 
        ("DD Lifting", "dd_lifting_price"), ("Ret Lifting", "ret_lifting_price")
    ]
    for label, field in fields:
        builder.button(text=label, callback_data=f"prodedit:{field}:{prod_id}:{back_offset}")
    builder.button(text="🔙 Profile", callback_data=f"prod_view_{prod_id}_{back_offset}")
    await callback.message.edit_text("Select field to edit:", reply_markup=builder.adjust(2).as_markup())

@router.callback_query(F.data.startswith("prodedit:"), flags={"permission": "update_product"})
async def prod_edit_input(callback: CallbackQuery, state: FSMContext):
    parts = callback.data.split(":")
    field, prod_id, back_offset = parts[1], int(parts[2]), parts[3]
    async with async_session() as session:
        p = await session.get(Product, prod_id)
        curr = getattr(p, field) or "N/A"
        await state.update_data(edit_prod_id=prod_id, edit_field=field, back_offset=back_offset, msg_id=callback.message.message_id)
        
        await callback.message.edit_text(
            f"📝 Edit **{field.upper()}**\nCurrent: `{curr}`\n\nEnter new value (or /cancel):",
            reply_markup=InlineKeyboardBuilder().button(text="❌ Cancel", callback_data=f"prod_view_{prod_id}_{back_offset}").as_markup(),
            parse_mode="HTML"
        )
        await state.set_state(ProductStates.edit_value)

@router.message(ProductStates.edit_value, flags={"permission": "update_product"})
async def prod_save_edit(message: Message, state: FSMContext, permissions: list):
    data = await state.get_data()
    prod_id = data.get('edit_prod_id')
    field_name = data.get('edit_field')
    back_offset = data.get('back_offset')
    msg_id = data.get('msg_id')
    new_val = message.text.strip()

    try: await message.delete()
    except: pass

    async with async_session() as session:
        p = await session.get(Product, prod_id)
        if not p: return await message.answer("❌ প্রোডাক্ট পাওয়া যায়নি।")
        
        if field_name in ['mrp', 'dd_lifting_price', 'ret_lifting_price']:
            try: new_val = float(new_val)
            except: 
                return await message.bot.edit_message_text(
                    chat_id=message.chat.id, message_id=msg_id,
                    text=f"❌ বৈধ সংখ্যা দিন।\n\n📝 Edit **{field_name.upper()}**\nEnter new value:",
                    reply_markup=InlineKeyboardBuilder().button(text="❌ Cancel", callback_data=f"prod_view_{prod_id}_{back_offset}").as_markup(),
                    parse_mode="HTML"
                )
        
        setattr(p, field_name, new_val)
        await session.commit()
        
        builder = InlineKeyboardBuilder()
        if "update_product" in permissions:
            builder.button(text="✏️ Edit", callback_data=f"prod_edit_menu_{p.id}_{back_offset}")
        builder.button(text="🔙 List", callback_data=f"prod_list_{back_offset}")
        builder.button(text="🏠 Menu", callback_data="prod_back_main")
        
        await message.bot.edit_message_text(
            chat_id=message.chat.id, message_id=msg_id,
            text=f"✅ Update Successful!\n\n" + get_product_detail_text(p),
            reply_markup=builder.adjust(2).as_markup(),
            parse_mode="HTML"
        )
    
    await state.set_state(None)

@router.callback_query(F.data == "prod_search_start", flags={"permission": "view_product"})
async def prod_search_start(callback: CallbackQuery, state: FSMContext):
    await callback.message.edit_text(
        "🔍 Enter Product **Code** or **Type**:",
        reply_markup=InlineKeyboardBuilder().button(text="❌ Cancel", callback_data="prod_back_main").as_markup(),
        parse_mode="HTML"
    )
    await state.set_state(ProductStates.search_query)
    await state.update_data(msg_id=callback.message.message_id)

@router.message(ProductStates.search_query, flags={"permission": "view_product"})
async def prod_process_search(message: Message, state: FSMContext, permissions: list):
    query = message.text.strip()
    data = await state.get_data()
    msg_id = data.get('msg_id')
    
    try: await message.delete()
    except: pass

    async with async_session() as session:
        res = await session.execute(
            select(Product).where(
                or_(Product.product_code.ilike(f"%{query}%"), Product.product_type.ilike(f"%{query}%"))
            ).limit(10)
        )
        products = res.scalars().all()
        
        builder = InlineKeyboardBuilder()
        if not products:
            text = f"❌ '{query}' নামে কোনো প্রোডাক্ট পাওয়া যায়নি।"
            builder.button(text="🔄 Try Again", callback_data="prod_search_start")
        else:
            text = f"✅ Search Results:"
            for p in products:
                builder.button(text=f"📦 {p.product_code}", callback_data=f"prod_view_{p.id}")
            builder.button(text="🔍 New Search", callback_data="prod_search_start")
        
        builder.button(text="🏠 Menu", callback_data="prod_back_main")
        builder.adjust(1)

        await message.bot.edit_message_text(
            chat_id=message.chat.id, message_id=msg_id,
            text=text, reply_markup=builder.as_markup()
        )
    await state.set_state(None)

@router.callback_query(F.data == "prod_upload_start", flags={"permission": "create_product"})
async def prod_upload_start(callback: CallbackQuery, state: FSMContext):
    await callback.message.edit_text(
        "📁 Please send the Product Excel file.",
        reply_markup=InlineKeyboardBuilder().button(text="❌ Cancel", callback_data="prod_back_main").as_markup()
    )
    await state.set_state(ProductStates.waiting_for_excel)
    await state.update_data(msg_id=callback.message.message_id)

@router.message(ProductStates.waiting_for_excel, F.document, flags={"permission": "create_product"})
async def prod_handle_file(message: Message, state: FSMContext):
    data = await state.get_data()
    msg_id = data.get('msg_id')
    file_path = f"temp_prod_{message.from_user.id}.xlsx"
    
    try: await message.delete()
    except: pass

    await message.bot.edit_message_text(chat_id=message.chat.id, message_id=msg_id, text="⏳ Processing...")

    try:
        await message.bot.download(message.document, destination=file_path)
        
        async def update_tg(text):
            try: await message.bot.edit_message_text(chat_id=message.chat.id, message_id=msg_id, text=text, parse_mode="HTML")
            except: pass

        count, err = await process_product_excel(file_path, update_tg)
        
        builder = InlineKeyboardBuilder().button(text="🏠 Menu", callback_data="prod_back_main")
        if err: 
            await update_tg(f"❌ এরর: {err}")
        else: 
            await message.bot.edit_message_text(
                chat_id=message.chat.id, message_id=msg_id,
                text=f"✅ Successful! Total `{count}` products updated.",
                reply_markup=builder.as_markup()
            )
    except Exception as e:
        await message.bot.edit_message_text(chat_id=message.chat.id, message_id=msg_id, text=f"❌ এরর: {str(e)}")
    finally:
        if os.path.exists(file_path): os.remove(file_path)
        await state.set_state(None)

@router.callback_query(F.data == "prod_add_manual", flags={"permission": "create_product"})
async def prod_add_manual_start(callback: CallbackQuery, state: FSMContext):
    await callback.message.edit_text(
        "📝 Enter Product **Code** (e.g., P001):",
        reply_markup=InlineKeyboardBuilder().button(text="❌ Cancel", callback_data="prod_back_main").as_markup(),
        parse_mode="HTML"
    )
    await state.set_state(ProductStates.add_p_code)
    await state.update_data(msg_id=callback.message.message_id)

@router.message(ProductStates.add_p_code)
async def prod_add_p_code(message: Message, state: FSMContext):
    data = await state.get_data()
    msg_id = data.get('msg_id')
    try: await message.delete()
    except: pass
    
    p_code = message.text.strip()
    
    async with async_session() as session:
        existing = await session.execute(select(Product).where(Product.product_code == p_code))
        if existing.scalar_one_or_none():
            return await message.bot.edit_message_text(
                chat_id=message.chat.id, message_id=msg_id,
                text=f"❌ এরর: সম্ভবত কোডটি বিদ্যমান।\n\n📝 Enter Product **Code**:",
                reply_markup=InlineKeyboardBuilder().button(text="❌ Cancel", callback_data="prod_back_main").as_markup(),
                parse_mode="HTML"
            )

    await state.update_data(add_p_code=p_code)
    await message.bot.edit_message_text(
        chat_id=message.chat.id, message_id=msg_id,
        text="📝 Enter Product **Type** (e.g., Voice/Data):",
        reply_markup=InlineKeyboardBuilder().button(text="❌ Cancel", callback_data="prod_back_main").as_markup()
    )
    await state.set_state(ProductStates.add_p_type)

@router.message(ProductStates.add_p_type)
async def prod_add_p_type(message: Message, state: FSMContext):
    data = await state.get_data()
    msg_id = data.get('msg_id')
    try: await message.delete()
    except: pass
    
    await state.update_data(add_p_type=message.text.strip())
    await message.bot.edit_message_text(
        chat_id=message.chat.id, message_id=msg_id,
        text="💰 Enter **MRP** (e.g., 100):",
        reply_markup=InlineKeyboardBuilder().button(text="❌ Cancel", callback_data="prod_back_main").as_markup()
    )
    await state.set_state(ProductStates.add_p_mrp)

@router.message(ProductStates.add_p_mrp)
async def prod_add_p_mrp(message: Message, state: FSMContext):
    data = await state.get_data()
    msg_id = data.get('msg_id')
    try: await message.delete()
    except: pass
    
    try: val = float(message.text.strip())
    except: return await message.bot.edit_message_text(chat_id=message.chat.id, message_id=msg_id, text="❌ বৈধ সংখ্যা দিন। 💰 Enter **MRP**:")
    
    await state.update_data(add_p_mrp=val)
    await message.bot.edit_message_text(
        chat_id=message.chat.id, message_id=msg_id,
        text="💰 Enter **DD Lifting Price**:",
        reply_markup=InlineKeyboardBuilder().button(text="❌ Cancel", callback_data="prod_back_main").as_markup()
    )
    await state.set_state(ProductStates.add_p_dd)

@router.message(ProductStates.add_p_dd)
async def prod_add_p_dd(message: Message, state: FSMContext):
    data = await state.get_data()
    msg_id = data.get('msg_id')
    try: await message.delete()
    except: pass
    
    try: val = float(message.text.strip())
    except: return await message.bot.edit_message_text(chat_id=message.chat.id, message_id=msg_id, text="❌ বৈধ সংখ্যা দিন। 💰 Enter **DD Lifting Price**:")
    
    await state.update_data(add_p_dd=val)
    await message.bot.edit_message_text(
        chat_id=message.chat.id, message_id=msg_id,
        text="💰 Enter **Retailer Lifting Price**:",
        reply_markup=InlineKeyboardBuilder().button(text="❌ Cancel", callback_data="prod_back_main").as_markup()
    )
    await state.set_state(ProductStates.add_p_ret)

@router.message(ProductStates.add_p_ret)
async def prod_add_p_ret(message: Message, state: FSMContext, permissions: list):
    data = await state.get_data()
    msg_id = data.get('msg_id')
    try: await message.delete()
    except: pass
    
    try: val = float(message.text.strip())
    except: return await message.bot.edit_message_text(chat_id=message.chat.id, message_id=msg_id, text="❌ বৈধ সংখ্যা দিন। 💰 Enter **Retailer Lifting Price**:")
    
    async with async_session() as session:
        new_p = Product(
            product_code=data['add_p_code'],
            product_type=data['add_p_type'],
            mrp=data['add_p_mrp'],
            dd_lifting_price=data['add_p_dd'],
            ret_lifting_price=val
        )
        session.add(new_p)
        try:
            await session.commit()
            builder = InlineKeyboardBuilder()
            builder.button(text="🏠 Menu", callback_data="prod_back_main")
            await message.bot.edit_message_text(
                chat_id=message.chat.id, message_id=msg_id,
                text="✅ Successful!\n\n" + get_product_detail_text(new_p),
                reply_markup=builder.as_markup(),
                parse_mode="HTML"
            )
        except Exception as e:
            await session.rollback()
            await message.bot.edit_message_text(chat_id=message.chat.id, message_id=msg_id, text=f"❌ এরর: সম্ভবত কোডটি বিদ্যমান।")
    
    await state.set_state(None)

@router.callback_query(F.data.startswith("prod_conf_del_"), flags={"permission": "delete_product"})
async def prod_conf_del(callback: CallbackQuery):
    parts = callback.data.split("_")
    prod_id = int(parts[3])
    back_offset = parts[4] if len(parts) > 4 else "0"
    
    builder = InlineKeyboardBuilder()
    builder.button(text="✅ Confirm Delete", callback_data=f"prod_fdel_{prod_id}_{back_offset}")
    builder.button(text="❌ Cancel", callback_data=f"prod_view_{prod_id}_{back_offset}")
    await callback.message.edit_text("⚠️ Are you sure you want to delete?", reply_markup=builder.as_markup())

@router.callback_query(F.data.startswith("prod_fdel_"), flags={"permission": "delete_product"})
async def prod_fdel(callback: CallbackQuery, state: FSMContext, permissions: list):
    parts = callback.data.split("_")
    prod_id = int(parts[2])
    back_offset = int(parts[3]) if len(parts) > 3 else 0
    
    async with async_session() as session:
        p = await session.get(Product, prod_id)
        if p: await session.delete(p); await session.commit()
    
    await callback.answer("🗑 Deleted successfully.")
    # Redirect to list with the same offset
    callback.data = f"prod_list_{back_offset}"
    await list_products(callback, state, permissions)
