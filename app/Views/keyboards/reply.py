from aiogram.types import ReplyKeyboardMarkup, KeyboardButton

def get_admin_main_menu(permissions: list):
    """Generates the main menu based on user permissions."""
    buttons = []
    
    # Row 1: House and User Management
    row1 = []
    if "view_houses" in permissions:
        row1.append(KeyboardButton(text="🏠 House Management"))
    if "view_users" in permissions:
        row1.append(KeyboardButton(text="👤 User Management"))
    if row1:
        buttons.append(row1)

    # Row 2: DMS Tasks and Reports
    row2 = []
    if "dms_access" in permissions: 
        row2.append(KeyboardButton(text="🤖 DMS Tasks"))
    if "report_access" in permissions: 
        row2.append(KeyboardButton(text="📊 Reports"))
    if row2: 
        buttons.append(row2)
    
    # Row 3: Field Force and Retailers
    row3 = []
    ff_perms = ["create_field_force","view_field_force","edit_field_force","delete_field_force", "manage_field_force"]
    if any(p in permissions for p in ff_perms):
        row3.append(KeyboardButton(text="👥 Field Force"))
    
    if "manage_leaves" in permissions or "apply_leave" in permissions:
        row3.append(KeyboardButton(text="📅 Leave Management"))
    
    ret_perms = ["create_retailers","view_retailers","edit_retailers","delete_retailers", "manage_retailers"]
    if any(p in permissions for p in ret_perms):
        row3.append(KeyboardButton(text="🏪 Retailers"))
    
    if row3:
        buttons.append(row3)
    
    # Row 4: Mela and BTS
    row4 = []
    mela_perms = ["create_mela", "view_mela", "edit_mela", "delete_mela"]
    if any(p in permissions for p in mela_perms):
        row4.append(KeyboardButton(text="🎪 Mela Management"))
    
    bts_perms = ["create_bts", "view_bts", "edit_bts", "delete_bts"]
    if any(p in permissions for p in bts_perms):
        row4.append(KeyboardButton(text="📡 BTS List"))
        
    if row4: 
        buttons.append(row4)
    
    # Row 5: Settings
    setting_perms = [
        "create_new_role", "create_new_permission", 
        "manage_role_and_permission_list", "manage_ga_filter", 
        "upload_activation", "manage_mela_settings", "manage_settings"
    ]

    if any(p in permissions for p in setting_perms):
        buttons.append([KeyboardButton(text="⚙️ Settings")])
        
    return ReplyKeyboardMarkup(keyboard=buttons, resize_keyboard=True)

def get_settings_menu(permissions: list):
    """Settings sub-menu based on permissions."""
    buttons = []

    # Row 1: Roles and Permissions
    row1 = []
    if "create_new_role" in permissions: row1.append(KeyboardButton(text="➕ New Role"))
    if "create_new_permission" in permissions: row1.append(KeyboardButton(text="➕ New Permission"))
    if row1: buttons.append(row1)

    # Row 2: Lists and GA Filter
    row2 = []
    if "manage_role_and_permission_list" in permissions: row2.append(KeyboardButton(text="📋 Role & Permission"))
    if "manage_ga_filter" in permissions: row2.append(KeyboardButton(text="⚙️ GA Filter"))
    if row2: buttons.append(row2)

    # Row 3: Data Center and Mela Settings
    row3 = []
    data_center_perms = ["dms_report", "upload_scratch_card", "upload_sim_issue", "upload_activation", "upload_targets"]
    if any(p in permissions for p in data_center_perms):
        row3.append(KeyboardButton(text="💾 Data Center"))
    
    if "manage_mela_settings" in permissions: row3.append(KeyboardButton(text="⚙️ Mela Settings"))
    if row3: buttons.append(row3)

    buttons.append([KeyboardButton(text="🔙 Main Menu")])
    return ReplyKeyboardMarkup(keyboard=buttons, resize_keyboard=True)

def get_data_center_menu(permissions: list):
    """Data Center sub-menu for excel uploads."""
    buttons = []
    
    # Row 1: Activation and DMS Report
    row1 = []
    if "upload_activation" in permissions:
         row1.append(KeyboardButton(text="📈 Activation"))
         
    if "dms_report" in permissions:
         row1.append(KeyboardButton(text="📊 DMS Report"))
    if row1: buttons.append(row1)

    # Row 2: Scratch Card and SIM Issue
    row2 = []
    if "upload_scratch_card" in permissions:
        row2.append(KeyboardButton(text="🎫 Scratch Card Issue"))
    if "upload_sim_issue" in permissions:
        row2.append(KeyboardButton(text="📲 SIM Issue"))
    if row2: buttons.append(row2)

    # Row 3: Target Management
    if "upload_targets" in permissions:
        buttons.append([KeyboardButton(text="🎯 Target Management")])
    
    # Back button
    buttons.append([KeyboardButton(text="🔙 Back")])
    return ReplyKeyboardMarkup(keyboard=buttons, resize_keyboard=True)

def get_reports_mgmt_menu(permissions: list):
    """Reports sub-menu."""
    buttons = []
    row = []
    if "view_ga_live" in permissions:
        row.append(KeyboardButton(text="📡 GA Live"))
    if row:
        buttons.append(row)
    buttons.append([KeyboardButton(text="🔙 Main Menu")])
    return ReplyKeyboardMarkup(keyboard=buttons, resize_keyboard=True)

def get_house_mgmt_menu(permissions: list):
    """House Management sub-menu."""
    buttons = []
    row1 = []
    if "create_house" in permissions:
        row1.append(KeyboardButton(text="➕ Create House"))
    if "view_houses" in permissions:
        row1.append(KeyboardButton(text="📋 House List"))
    if row1: buttons.append(row1)
    buttons.append([KeyboardButton(text="🔙 Main Menu")])
    return ReplyKeyboardMarkup(keyboard=buttons, resize_keyboard=True)

def get_user_mgmt_menu(permissions: list):
    """User Management sub-menu."""
    buttons = []
    row1 = []
    if "create_user" in permissions:
        row1.append(KeyboardButton(text="➕ Create User"))
    if "view_users" in permissions:
        row1.append(KeyboardButton(text="📋 User List"))
    if row1: buttons.append(row1)

    # Row 2: Excel Upload
    row2 = []
    if "create_user" in permissions: # একই পারমিশন ব্যবহার করছি
        row2.append(KeyboardButton(text="📤 Excel Upload"))
    if row2: buttons.append(row2)

    buttons.append([KeyboardButton(text="🔙 Main Menu")])
    return ReplyKeyboardMarkup(keyboard=buttons, resize_keyboard=True)

def get_ff_mgmt_menu(permissions: list):
    """Field Force management sub-menu."""
    buttons = []
    row = []
    if "create_field_force" in permissions:
        row.append(KeyboardButton(text="➕ New Member"))
    if "view_field_force" in permissions:
        row.append(KeyboardButton(text="📋 Member List"))
    if row: buttons.append(row)
    buttons.append([KeyboardButton(text="🔙 Main Menu")])
    return ReplyKeyboardMarkup(keyboard=buttons, resize_keyboard=True)

def get_retailer_mgmt_menu(permissions: list):
    """Retailer management sub-menu."""
    buttons = []
    row = []
    if "search_retailer" in permissions:
        row.append(KeyboardButton(text="🔍 Retailer Search"))
    if "view_retailers" in permissions:
        row.append(KeyboardButton(text="📋 Retailer List"))
    if row: buttons.append(row)
    buttons.append([KeyboardButton(text="🔙 Main Menu")])
    return ReplyKeyboardMarkup(keyboard=buttons, resize_keyboard=True)

def get_mela_settings_menu(permissions: list):
    """Mela settings sub-menu."""
    buttons = []
    if "manage_mela_settings" in permissions:
        buttons.append([
            KeyboardButton(text="➕ New Mela Type"),
            KeyboardButton(text="➕ New Activity")
        ])
        buttons.append([
            KeyboardButton(text="📤 Upload Eligible BTS")
        ])
    buttons.append([KeyboardButton(text="🔙 Main Menu")])
    return ReplyKeyboardMarkup(keyboard=buttons, resize_keyboard=True)
