from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.utils.keyboard import InlineKeyboardBuilder
from datetime import datetime
import calendar

class MonthYearCalendar:
    @staticmethod
    def get_month_year_keyboard(year: int = None, month: int = None):
        if not year:
            year = datetime.now().year
        if not month:
            month = datetime.now().month

        builder = InlineKeyboardBuilder()

        # Row 1: Month Name and Navigation
        row1 = []
        row1.append(InlineKeyboardButton(text="◀️", callback_data=f"cal_prev_{year}_{month}"))
        row1.append(InlineKeyboardButton(text=f"{calendar.month_name[month]} {year}", callback_data="ignore"))
        row1.append(InlineKeyboardButton(text="▶️", callback_data=f"cal_next_{year}_{month}"))
        builder.row(*row1)

        # Row 2: Select this month button
        builder.row(InlineKeyboardButton(text="✅ Select this month", callback_data=f"cal_select_{year}_{month}"))

        return builder.as_markup()

    @staticmethod
    def process_selection(callback_data: str):
        parts = callback_data.split("_")
        action = parts[1]
        year = int(parts[2])
        month = int(parts[3])

        if action == "prev":
            month -= 1
            if month < 1:
                month = 12
                year -= 1
        elif action == "next":
            month += 1
            if month > 12:
                month = 1
                year += 1
        
        return action, year, month
