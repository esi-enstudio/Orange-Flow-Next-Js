"""House-wise resignation letterhead: the full-page image plus the body text.

Each house uploads one letterhead image (a scan/design of the pre-printed page)
and edits the Bangla application text printed on top of it. Positions are stored
as percentages of the A4 page so they are independent of the image resolution.

Files are private (`private_uploads/letterheads/{house_id}/`) and are only
served through the permission-guarded stream endpoint.
"""

import html
import io
import logging
import os
import re
import uuid

from fastapi import UploadFile
from lxml import html as lxml_html
from PIL import Image, ImageOps

from app.models.house import House
from app.services import house_documents

logger = logging.getLogger(__name__)

LETTERHEAD_ROOT = "private_uploads/letterheads"

LETTERHEAD_MAX_BYTES = 5 * 1024 * 1024
LETTERHEAD_MIN_WIDTH = 800
LETTERHEAD_MAX_DIMENSION = 2480  # A4 at ~300 dpi

ALIGNMENTS = ("left", "center", "right", "justify")
ALLOWED_FORMATS = ("JPEG", "PNG", "WEBP")

# Tags the body editor may produce (bold/italic/underline, lists, aligned
# paragraphs, inline signature images). Everything else is stripped before the
# HTML reaches the PDF renderer or the page preview.
BODY_HTML_TAGS = frozenset(
    {
        "b", "strong", "i", "em", "u", "s", "strike", "br",
        "div", "p", "span", "ul", "ol", "li", "img",
    }
)
_STYLE_PATTERNS = {
    "text-align": re.compile(r"(left|center|right|justify)"),
    "font-weight": re.compile(r"(normal|bold|[1-9]00)"),
    "font-style": re.compile(r"(normal|italic)"),
    "text-decoration": re.compile(r"(none|underline|line-through|underline line-through)"),
    "font-size": re.compile(r"\d{1,2}(\.\d+)?pt"),
    "width": re.compile(r"\d{1,3}%"),
}

# A signature image is embedded as a base64 data URI so it travels with the
# layout and the PDF renderer. SVG is never accepted (script vector).
_IMAGE_SRC_RE = re.compile(r"data:image/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+")
IMAGE_SRC_MAX_CHARS = 520_000
BODY_HTML_MAX_CHARS = 1_500_000

# Editable Bangla template printed on the letterhead page. `{{placeholder}}`
# tokens are filled from the employee + house records at generation time
# (see `resignation_pdf._base_values`). The operator may rewrite every line in
# the letterhead editor; only the placeholders stay dynamic.
DEFAULT_BODY_TEXT = (
    "তারিখঃ {{application_date}}ইং\n"
    "প্রাপকঃ\n"
    "{{house_name}}\n"
    "{{house_address}}\n\n"
    "বিষয়ঃ অনাপত্তি সনদ (No Objection Certificate - NOC)\n\n"
    "সম্মানিত,\n\n"
    "যার দ্বারা প্রত্যায়ন করা যাচ্ছে যে, {{employee_name}}, পিতাঃ {{fathers_name}}, "
    "জাতীয় পরিচয়পত্র নংঃ {{nid}}, আমাদের {{house_name}}-এ {{joining_date}}ইং থেকে "
    "{{resigned_date}}ইং পর্যন্ত {{designation}} পদে কর্মরত ছিলেন।\n\n"
    "তিনি স্বেচ্ছায় চাকরি থেকে পদত্যাগ করেছেন এবং তার কার্যক্রম ও আচরণ সন্তোষজনক ছিল। "
    "আমাদের পক্ষ থেকে রেজিগনেশন প্রক্রিয়া সম্পন্ন করার জন্য কোন আপত্তি নেই।\n\n"
    "এই অনাপত্তি সনদ তার প্রয়োজনীয় কাজে ব্যবহারের জন্য প্রদান করা হইলো।\n\n\n\n"
    "{{proprietor_name}}\n"
    "ডিস্ট্রিবিউটর\n"
    "{{house_name}}\n"
    "{{proprietor_contact}}"
)

# Placeholders the body text may use, in the order the editor lists them.
BODY_PLACEHOLDERS = (
    "application_date",
    "employee_name",
    "fathers_name",
    "nid",
    "designation",
    "joining_date",
    "resigned_date",
    "dms_code",
    "house_name",
    "house_address",
    "house_code",
    "proprietor_name",
    "proprietor_contact",
    "poc_name",
    "poc_mobile",
)


def placeholder_values(house: House) -> dict:
    """House placeholders, Bangla value first and English as the fallback.

    The letterhead is Bangla, so an operator-typed Bangla value wins over the
    English house field (mirrors the employee placeholders).
    """

    def bn_first(bangla_value, english_value) -> str:
        return bangla_value or english_value or ""

    return {
        "house_name": bn_first(house.name_bn, house.name),
        "house_address": bn_first(house.address_bn, house.address),
        "house_code": house.code or "",
        "proprietor_name": bn_first(house.proprietor_name_bn, house.proprietor_name),
        "proprietor_contact": bn_first(house.proprietor_contact_bn, house.proprietor_contact),
        "poc_name": bn_first(house.poc_name_bn, house.poc_name),
        "poc_mobile": bn_first(house.poc_mobile_bn, house.poc_mobile),
    }


def default_layout() -> dict:
    """Starting layout: one editable body block over the letterhead image.

    The signature block auto-prints the proprietor signature uploaded for the
    house (see `house_documents`); it stays inert while no file is stored.
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
        "signature": {"enabled": True, "x": 58, "y": 78, "w": 24},
    }


def _num(value, default: float, low: float, high: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = default
    return max(low, min(high, number))


def _clean_text(value, limit: int = BODY_HTML_MAX_CHARS) -> str:
    if not isinstance(value, str):
        return ""
    return value.replace("\x00", "")[:limit]


def _valid_image_src(src: str) -> bool:
    """Accept only inline base64 raster images produced by the editor."""
    return len(src) <= IMAGE_SRC_MAX_CHARS and _IMAGE_SRC_RE.fullmatch(src) is not None


def _clean_style(raw: str) -> str:
    """Keep only the alignment/weight/decoration properties the editor emits."""
    kept = []
    for chunk in (raw or "").split(";"):
        prop, _, value = chunk.partition(":")
        prop = prop.strip().lower()
        value = " ".join(value.split()).lower()
        pattern = _STYLE_PATTERNS.get(prop)
        if pattern and pattern.fullmatch(value):
            kept.append(f"{prop}:{value}")
    return ";".join(kept)


def sanitize_body_html(value) -> str:
    """Allow-list HTML for the letter body (rich text editor output).

    Plain text (legacy layouts) passes through unchanged apart from escaping
    `<`/`&`, so existing letterheads keep rendering exactly as before.
    """
    text = _clean_text(value)
    if not text.strip():
        return ""
    try:
        root = lxml_html.fragment_fromstring(text, create_parent="div")
    except (ValueError, lxml_html.etree.ParserError):
        return html.escape(text)

    # Drop a script/style element together with its content; unwrap any other
    # tag that is not in the allow list so the operator never loses typed text.
    for _ in range(20):
        removed = False
        for node in list(root.iterdescendants()):
            tag = node.tag.lower() if isinstance(node.tag, str) else ""
            if tag in ("script", "style"):
                node.drop_tree()
                removed = True
            elif tag == "img":
                # Drop any image that is not a safe inline base64 raster.
                if not _valid_image_src(node.get("src") or ""):
                    node.drop_tree()
                    removed = True
                    continue
                for name in list(node.attrib):
                    if name == "style":
                        cleaned = _clean_style(node.get("style") or "")
                        if cleaned:
                            node.set("style", cleaned)
                        else:
                            del node.attrib[name]
                    elif name != "src":
                        del node.attrib[name]
            elif tag not in BODY_HTML_TAGS:
                node.drop_tag()
                removed = True
            else:
                for name in list(node.attrib):
                    if name == "style":
                        cleaned = _clean_style(node.get("style") or "")
                        if cleaned:
                            node.set("style", cleaned)
                        else:
                            del node.attrib[name]
                    else:
                        del node.attrib[name]
        if not removed:
            break

    return (root.text or "") + "".join(
        lxml_html.tostring(child, encoding="unicode") for child in root
    )


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
    body_raw = payload.get("body") if isinstance(payload.get("body"), dict) else {}
    body = _clean_block(body_raw, defaults["body"])
    body["x"] = min(body["x"], 100 - body["w"])
    body["enabled"] = bool(body_raw.get("enabled", defaults["body"]["enabled"]))
    body["text"] = sanitize_body_html(body_raw.get("text", defaults["body"]["text"]))
    body["line_height"] = _num(body_raw.get("line_height"), defaults["body"]["line_height"], 1.0, 3.0)

    signature_raw = payload.get("signature") if isinstance(payload.get("signature"), dict) else {}
    signature_defaults = defaults["signature"]
    signature = {
        "x": _num(signature_raw.get("x"), signature_defaults["x"], 0, 100),
        "y": _num(signature_raw.get("y"), signature_defaults["y"], 0, 100),
        "w": _num(signature_raw.get("w"), signature_defaults["w"], 5, 100),
        "enabled": bool(signature_raw.get("enabled", signature_defaults["enabled"])),
    }
    signature["x"] = min(signature["x"], 100 - signature["w"])

    return {"body": body, "signature": signature}


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
    # Keep the print resolution (up to ~300 dpi A4) while shrinking the file:
    # progressive JPEG at quality 82 is roughly half the size of quality 88.
    image.save(path, format="JPEG", quality=82, optimize=True, progressive=True)

    delete_image(house)
    # Relative to LETTERHEAD_ROOT so the file stays inside the house folder.
    house.letterhead_image_path = f"{house.id}/{file_name}"
    logger.info("Stored letterhead image for house %s (%s bytes)", house.id, os.path.getsize(path))
    return file_name


def configured(house: House) -> bool:
    """The bulk generation gate: a letterhead image must be uploaded."""
    return image_fs_path(house) is not None


def serialize(house: House) -> dict:
    stored = house.letterhead_layout or {}
    defaults = default_layout()
    body = {**defaults["body"], **(stored.get("body") or {})}
    signature = {**defaults["signature"], **(stored.get("signature") or {})}
    # Always hand sanitized HTML to the browser: older rows may predate the editor.
    layout = {
        "body": {**body, "text": sanitize_body_html(body.get("text", ""))},
        "signature": signature,
    }
    return {
        "house_id": house.id,
        "house_name": house.name,
        "house_code": house.code,
        "house_address": house.address or "",
        # Bangla-first values for every house placeholder, so the on-screen
        # preview matches the generated PDF.
        "values": placeholder_values(house),
        "has_image": image_fs_path(house) is not None,
        "image_url": f"/api/houses/{house.id}/letterhead/image" if house.letterhead_image_path else None,
        # The proprietor signature is uploaded once per house and is placed
        # automatically on the letterhead page.
        "has_signature": house_documents.signature_fs_path(house) is not None,
        "signature_url": (
            f"/api/houses/{house.id}/signature"
            if house_documents.signature_fs_path(house)
            else None
        ),
        "layout": layout,
        "default_layout": default_layout(),
        "body_placeholders": list(BODY_PLACEHOLDERS),
        "configured": configured(house),
        "updated_at": house.letterhead_updated_at.isoformat() if house.letterhead_updated_at else None,
        "updated_by": house.letterhead_updated_by,
    }
