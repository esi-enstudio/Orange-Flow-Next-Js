"""House-wise resignation letterhead: the full-page image plus the field layout.

Each house uploads one letterhead image (a scan/design of the pre-printed page)
and positions the six dynamic values on top of it. Positions are stored as
percentages of the A4 page so they are independent of the image resolution.

Files are private (`private_uploads/letterheads/{house_id}/`) and are only
served through the permission-guarded stream endpoint.
"""

import io
import logging
import os
import uuid

from fastapi import UploadFile
from PIL import Image, ImageOps

from app.models.house import House

logger = logging.getLogger(__name__)

LETTERHEAD_ROOT = "private_uploads/letterheads"

LETTERHEAD_MAX_BYTES = 5 * 1024 * 1024
LETTERHEAD_MIN_WIDTH = 800
LETTERHEAD_MAX_DIMENSION = 2480  # A4 at ~300 dpi

# The six values the operator fills automatically. Order is the editor order.
FIELD_KEYS = (
    "application_date",
    "employee_name",
    "fathers_name",
    "nid",
    "joining_date",
    "resigned_date",
)

ALIGNMENTS = ("left", "center", "right", "justify")
ALLOWED_FORMATS = ("JPEG", "PNG", "WEBP")

DEFAULT_BODY_TEXT = (
    "বরাবর,\n"
    "ব্যবস্থাপক\n"
    "{{house_name}}\n"
    "{{house_address}}\n\n"
    "বিষয়: পদত্যাগপত্র জমাদান প্রসঙ্গে।\n\n"
    "জনাব,\n"
    "সবিনয় নিবেদন এই যে, আমি {{employee_name}}, পিতা: {{fathers_name}}, "
    "জাতীয় পরিচয়পত্র নম্বর: {{nid}}, {{joining_date}} তারিখে {{house_name}}-এ "
    "যোগদান করি এবং {{resigned_date}} তারিখে ব্যক্তিগত কারণে স্বেচ্ছায় পদত্যাগ করছি।\n\n"
    "অতএব, মহোদয়ের নিকট বিনীত অনুরোধ, আমার পদত্যাগপত্র গ্রহণ করে আমাকে "
    "সকল দায়দায়িত্ব থেকে অব্যাহতি প্রদান করবেন।\n\n"
    "ধন্যবাদান্তে,\n\n"
    "তারিখ: {{application_date}}\n"
    "নাম: {{employee_name}}\n"
    "স্বাক্ষর: ____________________"
)


def _field(x: float, y: float, w: float = 40, size: float = 12, align: str = "left", bold: bool = False) -> dict:
    return {"x": x, "y": y, "w": w, "size": size, "align": align, "bold": bold}


def default_layout() -> dict:
    """Starting positions for a pre-printed application page.

    The admin drags every box onto the blank it belongs to; these defaults just
    give the editor something sensible to show.
    """
    return {
        "body": {
            "enabled": True,
            "text": DEFAULT_BODY_TEXT,
            "x": 12,
            "y": 30,
            "w": 76,
            "size": 12,
            "line_height": 1.7,
            "align": "justify",
        },
        "fields": {
            "application_date": _field(66, 18, 28, 12, "right"),
            "employee_name": _field(30, 32, 45),
            "fathers_name": _field(30, 38, 45),
            "nid": _field(38, 44, 40),
            "joining_date": _field(40, 50, 35),
            "resigned_date": _field(40, 56, 35),
        },
    }


def _num(value, default: float, low: float, high: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = default
    return max(low, min(high, number))


def _clean_text(value, limit: int = 20000) -> str:
    if not isinstance(value, str):
        return ""
    return value.replace("\x00", "")[:limit]


def _clean_block(raw: dict, fallback: dict) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    align = raw.get("align", fallback["align"])
    return {
        "x": _num(raw.get("x"), fallback["x"], 0, 100),
        "y": _num(raw.get("y"), fallback["y"], 0, 100),
        "w": _num(raw.get("w"), fallback["w"], 5, 100),
        "size": _num(raw.get("size"), fallback["size"], 6, 30),
        "align": align if align in ALIGNMENTS else fallback["align"],
        "bold": bool(raw.get("bold", fallback.get("bold", False))),
    }


def validate_layout(payload) -> dict:
    """Normalise a client layout into the stored shape. Raises ValueError."""
    if not isinstance(payload, dict):
        raise ValueError("layout must be an object")
    defaults = default_layout()
    fields_raw = payload.get("fields")
    if not isinstance(fields_raw, dict):
        raise ValueError("layout.fields is required")
    fields = {}
    for key in FIELD_KEYS:
        block = _clean_block(fields_raw.get(key), defaults["fields"][key])
        # A box may not start so far right that it runs off the page.
        block["x"] = min(block["x"], 100 - block["w"])
        fields[key] = block

    body_raw = payload.get("body") if isinstance(payload.get("body"), dict) else {}
    body = _clean_block(body_raw, defaults["body"])
    body["x"] = min(body["x"], 100 - body["w"])
    body["enabled"] = bool(body_raw.get("enabled", defaults["body"]["enabled"]))
    body["text"] = _clean_text(body_raw.get("text", defaults["body"]["text"]))
    body["line_height"] = _num(body_raw.get("line_height"), defaults["body"]["line_height"], 1.0, 3.0)

    return {"body": body, "fields": fields}


def _house_dir(house_id: int) -> str:
    folder = os.path.join(LETTERHEAD_ROOT, str(house_id))
    os.makedirs(folder, exist_ok=True)
    return folder


def image_fs_path(house: House):
    """Absolute path of the stored letterhead image, or None when missing."""
    rel = getattr(house, "letterhead_image_path", None)
    if not rel:
        return None
    root = os.path.realpath(LETTERHEAD_ROOT)
    candidate = os.path.realpath(os.path.join(LETTERHEAD_ROOT, rel))
    if candidate != root and not candidate.startswith(root + os.sep):
        logger.error("Rejected out-of-root letterhead path: %s", rel)
        return None
    return candidate if os.path.isfile(candidate) else None


def delete_image(house: House) -> None:
    path = image_fs_path(house)
    if path:
        try:
            os.remove(path)
        except OSError as exc:
            logger.warning("Could not delete letterhead image %s: %s", path, exc)
    house.letterhead_image_path = None


async def store_image(house: House, file: UploadFile) -> str:
    """Validate + normalise the uploaded page image. Raises ValueError."""
    contents = await file.read(LETTERHEAD_MAX_BYTES + 1)
    if not contents:
        raise ValueError("The uploaded file is empty.")
    if len(contents) > LETTERHEAD_MAX_BYTES:
        raise ValueError("File is too large. Maximum size is 5 MB.")
    try:
        image = Image.open(io.BytesIO(contents))
        image.load()
    except Exception as exc:  # noqa: BLE001 - surfaced to the user
        logger.warning("Rejected letterhead image %s: %s", file.filename, exc)
        raise ValueError("The image could not be read. Please choose a JPG, PNG or WEBP file.") from exc

    # Only raster formats a browser and Chromium can print reliably.
    if (image.format or "").upper() not in ALLOWED_FORMATS:
        raise ValueError("Unsupported image format. Please choose a JPG, PNG or WEBP file.")

    image = ImageOps.exif_transpose(image)
    if image.width < LETTERHEAD_MIN_WIDTH:
        raise ValueError(f"The image is too small. Minimum width is {LETTERHEAD_MIN_WIDTH}px.")
    if image.mode not in ("RGB", "L"):
        image = image.convert("RGB")
    image.thumbnail((LETTERHEAD_MAX_DIMENSION, LETTERHEAD_MAX_DIMENSION), Image.Resampling.LANCZOS)

    file_name = f"{uuid.uuid4().hex}.jpg"
    path = os.path.join(_house_dir(house.id), file_name)
    image.save(path, format="JPEG", quality=88, optimize=True)

    delete_image(house)
    # Relative to LETTERHEAD_ROOT so the file stays inside the house folder.
    house.letterhead_image_path = f"{house.id}/{file_name}"
    logger.info("Stored letterhead image for house %s (%s bytes)", house.id, os.path.getsize(path))
    return file_name


def configured(house: House) -> bool:
    """The bulk generation gate: an image plus every one of the six fields."""
    if image_fs_path(house) is None:
        return False
    layout = getattr(house, "letterhead_layout", None)
    if not isinstance(layout, dict):
        return False
    fields = layout.get("fields")
    if not isinstance(fields, dict):
        return False
    return all(key in fields for key in FIELD_KEYS)


def serialize(house: House) -> dict:
    return {
        "house_id": house.id,
        "house_name": house.name,
        "house_code": house.code,
        "house_address": house.address or "",
        "has_image": image_fs_path(house) is not None,
        "image_url": f"/api/houses/{house.id}/letterhead/image" if house.letterhead_image_path else None,
        "layout": house.letterhead_layout or default_layout(),
        "default_layout": default_layout(),
        "configured": configured(house),
        "updated_at": house.letterhead_updated_at.isoformat() if house.letterhead_updated_at else None,
        "updated_by": house.letterhead_updated_by,
    }
