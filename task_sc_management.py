import xlwings as xw
import os
import re
import time
import math
from colorama import Fore, init

init(autoreset=True)

# ফাইলের লোকেশন
SC_FILE_PATH = r"G:\My Drive\BL\RSO\SC Issue (Monthly)\2026\SC Serial List.xlsb"
MAX_ROWS = 800000

def get_excel_connection():
    """সবচেয়ে শক্তিশালী উপায়ে ফাইলের সাথে কানেক্ট করা"""
    abs_path = os.path.abspath(SC_FILE_PATH)
    filename = os.path.basename(abs_path)
    target_book = None
    app_started_by_bot = False

    # ১. সরাসরি বুক নেম দিয়ে চেক করা (ফাইল খোলা থাকলে এটি সবচাইতে ভালো কাজ করে)
    try:
        target_book = xw.Book(filename)
        # নিশ্চিত হওয়া যে এটি সঠিক পাথ (একই নামে অন্য ফাইল থাকতে পারে)
        if os.path.normpath(target_book.fullname).lower() != os.path.normpath(abs_path).lower():
            target_book = None
    except:
        target_book = None

    # ২. যদি না পাওয়া যায়, তবে সব রানিং অ্যাপ স্ক্যান করা
    if not target_book:
        try:
            for app in xw.apps:
                for book in app.books:
                    if os.path.normpath(book.fullname).lower() == os.path.normpath(abs_path).lower():
                        target_book = book
                        break
                if target_book: break
        except: pass

    # ৩. যদি ফাইলটি কোথাও খোলা না থাকে, তবে নতুন করে ওপেন করা
    if not target_book:
        try:
            app = xw.App(visible=False)
            app_started_by_bot = True
            if os.path.exists(abs_path):
                target_book = app.books.open(abs_path)
            else:
                # ফাইল না থাকলে নতুন তৈরি করা
                target_book = app.books.add()
                target_book.sheets[0].name = "Default"
                target_book.save(abs_path)
        except Exception as e:
            print(Fore.RED + f"[Error] ফাইল ওপেন করা যায়নি: {e}")
            return None, False

    return target_book, app_started_by_bot

def get_all_house_sheets():
    wb, bot_opened = get_excel_connection()
    if not wb: return []
    try:
        sheets = [s.name for s in wb.sheets if s.name != "Default"]
        return sheets
    finally:
        if bot_opened: wb.app.quit()

def get_existing_amounts(house_code):
    wb, bot_opened = get_excel_connection()
    if not wb: return []
    amounts = []
    try:
        if house_code in [s.name for s in wb.sheets]:
            sheet = wb.sheets[house_code]
            headers = sheet.range("1:1").value
            if headers:
                for h in headers:
                    if h and "tk" in str(h) and "_Status" not in str(h):
                        match = re.search(r'(\d+)', str(h))
                        if match and match.group(1) not in amounts:
                            amounts.append(match.group(1))
        return amounts
    finally:
        if bot_opened: wb.app.quit()

def create_new_sheet(house_code):
    wb, bot_opened = get_excel_connection()
    if not wb: return False
    try:
        sheet_names = [s.name for s in wb.sheets]
        if len(wb.sheets) == 1 and wb.sheets[0].name == "Default":
            wb.sheets[0].name = house_code
        elif house_code not in sheet_names:
            wb.sheets.add(house_code)
        wb.save()
        return True
    except: return False
    finally:
        if bot_opened: wb.app.quit()

def add_sc_serials(house_code, amount, serials):
    """সরাসরি সিরিয়াল এন্ট্রি এবং স্মার্ট কলাম সিলেকশন"""

    wb, bot_opened = get_excel_connection()
    if not wb: return False, "কানেকশন এরর"
    
    try:
        sheet = wb.sheets[house_code]
        header_name = f"{amount}tk"

        # ১. সঠিক কলাম খুঁজে বের করা
        col_idx = 1
        found_col = None
        while True:
            current_header = sheet.range((1, col_idx)).value

            # যদি কলামটি খালি হয়, তবে নতুন হেডার তৈরি করবে
            if not current_header:
                found_col = col_idx
                sheet.range((1, col_idx)).value = header_name
                sheet.range((1, col_idx + 1)).value = f"{header_name}_Status"
                break
            
            # যদি বিদ্যমান হেডার মিলে যায় (যেমন 19tk বা 19tk_1)
            if str(current_header) == header_name or str(current_header).startswith(f"{header_name}_"):

                # কলামের শেষ রো চেক করা
                last_row = sheet.range((sheet.cells.last_cell.row, col_idx)).end('up').row
                if last_row == 1 and not sheet.range((2, col_idx)).value: last_row = 1
                
                # যদি জায়গা থাকে তবে এই কলামটি ব্যবহার করবে
                if len(serials) <= (MAX_ROWS - last_row):
                    found_col = col_idx
                    break
                else:
                    # জায়গা না থাকলে পরের কলাম সেটে যাবে এবং সাফিক্স বাড়াবে
                    col_idx += 2
                    if "_" in header_name:
                        parts = header_name.split("_")
                        header_name = f"{parts[0]}_{int(parts[1]) + 1}"
                    else:
                        header_name = f"{header_name}_1"
            else:
                # অন্য টাকার কার্ডের কলাম হলে ডানে সরে যাবে
                col_idx += 2

        # ২. কলাম ফরম্যাটিং (নিশ্চিত করা)
        # খোলা ফাইলে এটি অনেক সময় এরর দেয়, তাই আমরা ট্রাই-ব্লকে রাখছি
        try:
            sheet.range((2, found_col), (MAX_ROWS + 1, found_col)).number_format = '0'
        except: pass

        # ৩. ডাটা রাইট করা
        last_row_actual = sheet.range((sheet.cells.last_cell.row, found_col)).end('up').row
        start_row = last_row_actual + 1
        if start_row == 2 and not sheet.range((2, found_col)).value: start_row = 2
        
        # সিরিয়ালগুলোকে লিস্ট ফরম্যাটে সাজানো
        data_to_write = [[s] for s in serials]
        sheet.range((start_row, found_col)).value = data_to_write
        
        # ৪. সেভ করা
        wb.save()

        # মেইন বট এখন ২টি রিটার্ন ভ্যালু আশা করছে (Success, Result Name)
        return True, sheet.range((1, found_col)).value
        
    except Exception as e:
        print(f"Error: {e}")
        return False, str(e), 0, 0
    finally:
        if bot_opened: wb.app.quit()

def get_available_slots(house_code, request_amount):
    """স্টক এনালাইসিসসহ সিরিয়াল সংগ্রহ করা (পারফরম্যান্স অপ্টিমাইজড)"""
    wb, bot_opened = get_excel_connection()
    final_report = [] 
    remaining_money = request_amount
    actual_fulfilled_total = 0
    
    current_stock_info = [] # বর্তমান স্টকের তথ্য
    future_stock_info = []  # কাজ শেষে স্টকের তথ্য
    
    try:
        if house_code not in [s.name for s in wb.sheets]:
            return False, "❌ এই হাউসের শিট নেই", 0, 0, [], []
            
        sheet = wb.sheets[house_code]
        headers = sheet.range("1:1").value
        
        amount_columns = []
        for i, h in enumerate(headers):
            if h and "tk" in str(h) and "_Status" not in str(h):
                amt = int(re.search(r'(\d+)', str(h)).group(1))
                amount_columns.append({'amt': amt, 'col': i + 1, 'name': str(h)})
        amount_columns.sort(key=lambda x: x['amt'])

        for item in amount_columns:
            amt_val = item['amt']
            col_idx = item['col']
            status_col_idx = col_idx + 1
            
            # পুরো কলামের স্ট্যাটাস একবারে মেমোরিতে নেওয়া (Speed Boost)
            last_row = sheet.range(sheet.cells(sheet.cells.last_cell.row, col_idx).address).end('up').row
            if last_row < 2:
                current_stock_info.append({'amt': amt_val, 'qty': 0, 'val': 0})
                future_stock_info.append({'amt': amt_val, 'qty': 0, 'val': 0})
                continue
            
            status_list = sheet.range((2, status_col_idx), (last_row, status_col_idx)).value
            if not isinstance(status_list, list): status_list = [status_list]
            
            # বর্তমান অব্যবহৃত স্টক হিসাব করা
            unused_indices = [idx for idx, val in enumerate(status_list) if val is None or str(val).strip() == ""]
            current_qty = len(unused_indices)
            current_stock_info.append({'amt': amt_val, 'qty': current_qty, 'val': current_qty * amt_val})

            # এই রিকোয়েস্টের জন্য সিরিয়াল দরকার কি না
            cards_taken = 0
            if remaining_money > 0:
                needed_cards = math.ceil(remaining_money / amt_val)
                take_indices = unused_indices[:needed_cards]
                cards_taken = len(take_indices)
                
                if cards_taken > 0:
                    serials_list = sheet.range((2, col_idx), (last_row, col_idx)).value
                    if not isinstance(serials_list, list): serials_list = [serials_list]
                    
                    # স্লট ডিটেকশন
                    temp_start_idx = take_indices[0]
                    for i in range(1, len(take_indices)):
                        if int(serials_list[take_indices[i]]) != int(serials_list[take_indices[i-1]]) + 1:
                            final_report.append({
                                'type': item['name'], 'start': int(serials_list[temp_start_idx]), 
                                'end': int(serials_list[take_indices[i-1]]), 
                                'count': take_indices[i-1]-temp_start_idx+1, 
                                'status_col': status_col_idx, 
                                'rows': [temp_start_idx+2, take_indices[i-1]+2]
                            })
                            temp_start_idx = take_indices[i]
                    
                    final_report.append({
                        'type': item['name'], 'start': int(serials_list[temp_start_idx]), 
                        'end': int(serials_list[take_indices[-1]]), 
                        'count': take_indices[-1]-temp_start_idx+1, 
                        'status_col': status_col_idx, 
                        'rows': [temp_start_idx+2, take_indices[-1]+2]
                    })
                    
                    actual_fulfilled_total += (cards_taken * amt_val)
                    remaining_money -= (cards_taken * amt_val)

            # কাজ শেষে কত স্টক বাকি থাকবে
            remaining_qty = current_qty - cards_taken
            future_stock_info.append({'amt': amt_val, 'qty': remaining_qty, 'val': remaining_qty * amt_val})

        return True, final_report, max(0, remaining_money), actual_fulfilled_total, current_stock_info, future_stock_info
        
    except Exception as e:
        return False, str(e), 0, 0, [], []
    finally:
        if bot_opened: wb.app.quit()

# def get_available_slots(house_code, request_amount):
#     """স্টক এনালাইসিসসহ সিরিয়াল সংগ্রহ করা (পারফরম্যান্স অপ্টিমাইজড)"""
#     wb, bot_opened = get_excel_connection()
#     final_report = [] 
#     original_request = request_amount
#     remaining_money = request_amount
#     actual_fulfilled_total = 0 # এটি প্রকৃত টাকার অংক ট্র্যাক করবে
    
#     try:
#         if house_code not in [s.name for s in wb.sheets]:
#             return False, "❌ এই হাউসের শিট নেই", original_request, 0
            
#         sheet = wb.sheets[house_code]
#         headers = sheet.range("1:1").value
#         amount_columns = []

#         for i, h in enumerate(headers):
#             if h and "tk" in str(h) and "_Status" not in str(h):
#                 amt = int(re.search(r'(\d+)', str(h)).group(1))
#                 amount_columns.append({'amt': amt, 'col': i + 1, 'name': str(h)})
#         amount_columns.sort(key=lambda x: x['amt'])

#         for item in amount_columns:
#             if remaining_money <= 0: break
#             amt_val = item['amt']
#             col_idx = item['col']
#             status_col_idx = col_idx + 1

#             # সমান বা বেশির জন্য math.ceil ব্যবহার
#             needed_cards = math.ceil(remaining_money / amt_val)

#             last_row = sheet.range(sheet.cells(sheet.cells.last_cell.row, col_idx).address).end('up').row
#             if last_row < 2: continue
            
#             serials_list = sheet.range((2, col_idx), (last_row, col_idx)).value
#             status_list = sheet.range((2, status_col_idx), (last_row, status_col_idx)).value
#             if not isinstance(serials_list, list): serials_list = [serials_list]
#             if not isinstance(status_list, list): status_list = [status_list]

#             unused_indices = []
#             for idx, val in enumerate(status_list):
#                 if val is None or str(val).strip() == "":
#                     unused_indices.append(idx)
#                     if len(unused_indices) >= needed_cards: break

#             if not unused_indices: continue

#             # --- প্রকৃত টাকার হিসাব ---
#             # কতগুলো কার্ড নেওয়া হলো তা গুন করা হচ্ছে কার্ডের মূল্য দিয়ে
#             cards_taken = len(unused_indices)
#             actual_fulfilled_total += (cards_taken * amt_val)
#             # ---------------------------------------

#             # স্লট শনাক্তকরণ
#             temp_start_idx = unused_indices[0]
#             for i in range(1, len(unused_indices)):
#                 if int(serials_list[unused_indices[i]]) != int(serials_list[unused_indices[i-1]]) + 1:
#                     final_report.append({
#                         'type': item['name'], 'start': int(serials_list[temp_start_idx]), 
#                         'end': int(serials_list[unused_indices[i-1]]), 
#                         'count': unused_indices[i-1]-temp_start_idx+1, 
#                         'col': col_idx, 'status_col': status_col_idx, 
#                         'rows': [temp_start_idx+2, unused_indices[i-1]+2]
#                     })
#                     temp_start_idx = unused_indices[i]
            
#             final_report.append({
#                 'type': item['name'], 'start': int(serials_list[temp_start_idx]), 
#                 'end': int(serials_list[unused_indices[-1]]), 
#                 'count': unused_indices[-1]-temp_start_idx+1, 
#                 'col': col_idx, 'status_col': status_col_idx, 
#                 'rows': [temp_start_idx+2, unused_indices[-1]+2]
#             })

#             # রিমেইনিং মানি আপডেট (যাতে অন্য ডিনোমিনেশন থেকে আর না নেয় যদি টাকা কভার হয়ে যায়)
#             remaining_money -= (len(unused_indices) * amt_val)

#         # ৪টি ভ্যালু রিটার্ন নিশ্চিত করা হলো: Success, Report, Remaining, Fulfilled
#         return True, final_report, max(0, remaining_money), actual_fulfilled_total
        
#     except Exception as e:
#         print(f"Error in get_available_slots: {e}")
#         return False, str(e), original_request, 0
#     finally:
#         if bot_opened: wb.app.quit()

def mark_as_used(house_code, slots):
    """সফল কাজ শেষে এক্সেলে Used মার্ক করা"""
    wb, bot_opened = get_excel_connection()
    try:
        # এক্সেলের অটো-ক্যালকুলেশন সাময়িকভাবে বন্ধ করা (স্পিড বাড়ানোর জন্য)
        wb.app.screen_updating = False
        wb.app.calculation = 'manual'

        sheet = wb.sheets[house_code]
        for slot in slots:
            # স্লটের শুরু এবং শেষ রো অনুযায়ী একবারে "Used" লিখবে
            start_row, end_row = slot['rows']
            status_col = slot['status_col']

            # বাল্ক ডাটা তৈরি
            used_data = [["Used"]] * (end_row - start_row + 1)
           
            # একবারে সব লিখে ফেলা
            sheet.range((start_row, status_col), (end_row, status_col)).value = used_data
        wb.save()

        # ক্যালকুলেশন আবার অন করে দেওয়া
        wb.app.calculation = 'automatic'
        wb.app.screen_updating = True
        
        return True
    except: return False
    finally:
        if bot_opened: wb.app.quit()


# def get_serials_by_amount(house_code, request_amount):
    """বড় ডাটার ক্ষেত্রেও ইনস্ট্যান্ট রেজাল্ট দেওয়ার জন্য অপ্টিমাইজড লজিক, টাকার হিসেবে স্টক থেকে স্লট ভিত্তিক সিরিয়াল তোলা এবং Used মার্ক করা (অতিরিক্ত ৫টি বাদ, সমান বা বেশি লজিক)"""
    
    wb, bot_opened = get_excel_connection()
    final_report = [] 
    original_request = request_amount
    remaining_money = request_amount
    total_fulfilled_money = 0 # কত টাকার কার্ড দিতে পারল
    
    try:
        if house_code not in [s.name for s in wb.sheets]:
            return "❌ এই হাউসের কোনো শিট পাওয়া যায়নি।", [], request_amount, 0
        
        sheet = wb.sheets[house_code]
        headers = sheet.range("1:1").value
        
        # কার্ড ডিনোমিনেশনগুলো নিয়ে আসা
        amount_columns = []
        for i, h in enumerate(headers):
            if h and "tk" in str(h) and "_Status" not in str(h):
                amt = int(re.search(r'(\d+)', str(h)).group(1))
                amount_columns.append({'amt': amt, 'col': i + 1, 'name': str(h)})

        # ছোট থেকে বড় কার্ডের এমাউন্ট অনুযায়ী সর্ট করা
        amount_columns.sort(key=lambda x: x['amt'])

        for item in amount_columns:
            if remaining_money <= 0: break
            
            amt_val = item['amt']
            col_idx = item['col']
            status_col_idx = col_idx + 1
            
            # এই কার্ড দিয়ে কয়টা সিরিয়াল লাগবে (সমান বা বেশি লজিক)
            needed_cards = math.ceil(remaining_money / amt_val)

            last_row = sheet.range(sheet.cells(sheet.cells.last_cell.row, col_idx).address).end('up').row
            if last_row < 2: continue

            # কলামের ডাটা ও স্ট্যাটাস একবারে রিড করা
            serials_list = sheet.range((2, col_idx), (last_row, col_idx)).value
            status_list = sheet.range((2, status_col_idx), (last_row, status_col_idx)).value
            
            if not isinstance(serials_list, list): serials_list = [serials_list]
            if not isinstance(status_list, list): status_list = [status_list]

            # ১. অব্যবহৃত সিরিয়ালগুলো খুঁজে বের করা
            unused_indices = []
            for idx, val in enumerate(status_list):
                if val is None or str(val).strip() == "":
                    unused_indices.append(idx)
                    if len(unused_indices) >= needed_cards:
                        break
            
            if not unused_indices: continue

            # ২. স্লট শনাক্তকরণ লজিক (গ্যাপ ডিটেকশন)
            current_slots = []
            temp_start_idx = unused_indices[0]
            temp_last_idx = unused_indices[0]
            
            for i in range(1, len(unused_indices)):
                curr_idx = unused_indices[i]
                prev_idx = unused_indices[i-1]
                
                if int(serials_list[curr_idx]) == int(serials_list[prev_idx]) + 1:
                    temp_last_idx = curr_idx
                else:
                    current_slots.append({
                        'start': int(serials_list[temp_start_idx]),
                        'end': int(serials_list[temp_last_idx]),
                        'count': (temp_last_idx - temp_start_idx + 1),
                        'rows': list(range(temp_start_idx + 2, temp_last_idx + 3))
                    })
                    temp_start_idx = curr_idx
                    temp_last_idx = curr_idx
            
            # শেষ স্লটটি যোগ করা
            current_slots.append({
                'start': int(serials_list[temp_start_idx]),
                'end': int(serials_list[temp_last_idx]),
                'count': (temp_last_idx - temp_start_idx + 1),
                'rows': list(range(temp_start_idx + 2, temp_last_idx + 3))
            })

            # ৩. এক্সেলে Used মার্ক করা এবং রিপোর্ট তৈরি
            cards_taken_from_this_denomination = 0
            for slot in current_slots:
                used_values = [["Used"]] * len(slot['rows'])
                sheet.range((slot['rows'][0], status_col_idx), (slot['rows'][-1], status_col_idx)).value = used_values
                
                final_report.append({
                    'type': item['name'],
                    'start': slot['start'],
                    'end': slot['end'],
                    'count': slot['count']
                })
                cards_taken_from_this_denomination += slot['count']
            
            # ৪. হিসাব সমন্বয়
            total_fulfilled_money += (cards_taken_from_this_denomination * amt_val)
            remaining_money -= (cards_taken_from_this_denomination * amt_val)

        wb.save()
        # রেজাল্ট, রিপোর্ট লিস্ট, অবশিষ্ট টাকা (যদি স্টক না থাকে), কত টাকার সিম দেওয়া হলো
        return True, final_report, max(0, remaining_money), total_fulfilled_money
    except Exception as e:
        print(f"Error: {e}")
        return False, str(e), original_request, 0
    finally:
        if bot_opened: wb.app.quit()