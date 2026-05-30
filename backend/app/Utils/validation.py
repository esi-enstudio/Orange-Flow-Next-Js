import os
import uuid
import re

ALLOWED_EXTENSIONS = {".xlsx", ".xls", ".jpg", ".jpeg", ".png"}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB

def safe_filename(original: str) -> str:
    name = os.path.basename(original)
    name = re.sub(r'[^\w\.\-]', '_', name)
    return f"{uuid.uuid4().hex}_{name}"

def validate_excel(filename: str) -> bool:
    ext = os.path.splitext(filename)[1].lower()
    return ext in {".xlsx", ".xls"}

def validate_image(filename: str) -> bool:
    ext = os.path.splitext(filename)[1].lower()
    return ext in {".jpg", ".jpeg", ".png"}
