"""Banglalink DMS constants shared by the PreRF automation.

Keep the bank IDs and names identical to the DMS ``BankId`` dropdown; the
PreRF form is filled by matching the stored bank name first and the id second.
"""

DMS_BASE_URL = "https://blkdms.banglalink.net"
DMS_PRERF_URL = f"{DMS_BASE_URL}/PreRF"
DMS_PRERF_CREATE_URL = f"{DMS_BASE_URL}/PreRF/Create"

# The warehouse requested for PreRF lifting requests.
DMS_PRERF_WAREHOUSE_ID = 66
DMS_PRERF_WAREHOUSE_NAME = "Banglalink Brahmanbaria Warehouse"

# DMS product id for the "i'top up" product on the PreRF create page.
DMS_PRERF_ITOPUP_PRODUCT_ID = 35
DMS_PRERF_ITOPUP_PRODUCT_NAME = "i'top up"

DMS_BANKS = [
    {"id": 1, "name": "BRAC Bank Ltd"},
    {"id": 2, "name": "Dutch Bangla Bank Ltd"},
    {"id": 3, "name": "Dhaka Bank Ltd"},
    {"id": 4, "name": "Islami Bank Bangladesh Ltd"},
    {"id": 5, "name": "Pubali Bank Ltd"},
    {"id": 6, "name": "The City Bank Ltd"},
    {"id": 7, "name": "Eastern bank Ltd"},
    {"id": 8, "name": "United Commercial Bank Ltd"},
    {"id": 9, "name": "Southeast Bank Ltd"},
    {"id": 10, "name": "Sonali Bank Ltd"},
]

DMS_BANK_BY_ID = {bank["id"]: bank["name"] for bank in DMS_BANKS}
DMS_BANK_IDS = set(DMS_BANK_BY_ID)
