from aiogram import Router, F
from aiogram.types import ReplyKeyboardMarkup, KeyboardButton

def get_leave_mgmt_menu(permissions: list):
    buttons = []
    
    row1 = []
    if "apply_leave" in permissions:
        row1.append(KeyboardButton(text="📅 Apply Leave"))
    if "manage_leaves" in permissions:
        row1.append(KeyboardButton(text="📋 Pending Leaves"))
    
    if row1:
        buttons.append(row1)
        
    buttons.append([KeyboardButton(text="🔙 প্রধান মেনু")])
    
    return ReplyKeyboardMarkup(keyboard=buttons, resize_keyboard=True)
