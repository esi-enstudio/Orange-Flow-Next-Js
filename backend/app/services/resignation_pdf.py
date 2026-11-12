"""Three-page resignation document: letter scan, NID, house application.

The application page is the house letterhead image with the editable Bangla
body text (`house_letterhead.py` layout) printed on top of it. Rendering goes
through headless Chromium (Playwright) because it is the only renderer available
here that shapes Bangla text correctly - ReportLab's built-in fonts cannot.

Security: the letterhead layout is tenant-authored data rendered inside the
browser, so the render context has JavaScript disabled and every network
request blocked. Values are HTML-escaped.
"""

import base64
import html
import io
import logging
import os
import re
from datetime import date, datetime
from functools import lru_cache
from pathlib import Path
from typing import Optional

from PIL import Image, ImageOps

from app.models.employee import Employee
from app.models.house import House
from app.services import house_documents, house_letterhead
from app.utils.timezone import now_naive

logger = logging.getLogger(__name__)

FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
IMAGE_MAX_DIMENSION = 2000
RENDER_TIMEOUT_MS = 30000

BANGLA_MONTHS = (
    "জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন",
    "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর",
)

_BN_DIGITS = str.maketrans("0123456789", "০১২৩৪৫৬৭৮৯")
_PLACEHOLDER_RE = re.compile(r"{{\s*([a-z_]+)\s*}}")

# Full designation printed in the letter body (falls back to the raw type).
DESIGNATIONS = {
    "rso": "RSO (Retail Sales Officer)",
    "bp": "BP (Brand Promotor)",
    "bsp": "BSP (Business Service Partner)",
    "rbsp": "RBSP (Retail Business Service Partner)",
    "supervisor": "Supervisor",
    "manager": "Manager",
}

# Sample employee used by the letterhead preview endpoint.
SAMPLE_EMPLOYEE = {
    "employee_name": "মোঃ আব্দুল করিম",
    "fathers_name": "মোঃ আব্দুল রহমান",
    "nid": "1234567890123",
    "joining_date": "2021-01-15",
    "resigned_date": "2026-06-30",
    "employee_type": "rso",
    "dms_code": "R123456",
}


def bn_digits(value) -> str:
    return str(value if value is not None else "").translate(_BN_DIGITS)


def bn_date(value) -> str:
    """Format a stored date as '০৯ নভেম্বর ২০২৬'. Unknown input is returned
    digit-translated rather than dropped."""
    if value is None or str(value).strip() == "":
        return ""
    parsed: Optional[date] = None
    if isinstance(value, (datetime, date)):
        parsed = value.date() if isinstance(value, datetime) else value
    else:
        text = str(value).strip()
        for parser in (
            lambda t: datetime.fromisoformat(t.replace("Z", "")).date(),
            lambda t: datetime.strptime(t, "%d/%m/%Y").date(),
            lambda t: datetime.strptime(t, "%d-%m-%Y").date(),
            lambda t: datetime.strptime(t, "%d %b %Y").date(),
        ):
            try:
                parsed = parser(text)
                break
            except ValueError:
                continue
    if not parsed:
        return bn_digits(str(value).strip())
    return f"{bn_digits(parsed.day)} {BANGLA_MONTHS[parsed.month - 1]} {bn_digits(parsed.year)}"


def _base_values(house: House, employee: dict, application_date: date) -> dict:
    employee_type = str(employee.get("employee_type") or "").strip().lower()

    def bn_first(bangla_key: str, english_key: str) -> str:
        # The letterhead is Bangla, so the operator-typed Bangla value wins and
        # falls back to the English field for employees that have none yet.
        return (employee.get(bangla_key) or employee.get(english_key) or "")

    return {
        "application_date": bn_date(application_date),
        "employee_name": bn_first("employee_name_bn", "employee_name") or employee.get("dms_code") or "",
        "fathers_name": bn_first("fathers_name_bn", "fathers_name"),
        "nid": bn_digits(bn_first("nid_bn", "nid")),
        "joining_date": bn_date(employee.get("joining_date")),
        "resigned_date": bn_date(employee.get("resigned_date")),
        "employee_type": employee_type.upper(),
        "designation": DESIGNATIONS.get(employee_type, employee_type.upper()),
        "dms_code": employee.get("dms_code") or "",
        # Bangla house values (English fallback) + POC placeholders.
        **house_letterhead.placeholder_values(house),
    }


def _substitute(html_text: str, values: dict) -> str:
    """Fill the whitelisted placeholders with escaped values.

    `html_text` is already sanitized HTML (see `house_letterhead`), so escaping
    the markup again would print the tags instead of applying them.
    """
    escaped_values = {key: html.escape(str(value)) for key, value in values.items()}
    return _PLACEHOLDER_RE.sub(lambda m: escaped_values.get(m.group(1), ""), html_text)


def _font_face() -> str:
    faces = []
    for weight, file_name in ((400, "NotoSansBengali-Regular.ttf"), (700, "NotoSansBengali-Bold.ttf")):
        path = FONT_DIR / file_name
        if not path.is_file():
            continue
        encoded = base64.b64encode(path.read_bytes()).decode("ascii")
        faces.append(
            "@font-face{font-family:NotoBengali;font-style:normal;font-weight:%d;"
            "src:url(data:font/ttf;base64,%s) format('truetype');}" % (weight, encoded)
        )
    return "".join(faces)


@lru_cache(maxsize=2)
def _image_data_uri(raw: bytes) -> str:
    """Normalise a scan into a JPEG data URI (small PDF, correct orientation)."""
    image = Image.open(io.BytesIO(raw))
    image.load()
    image = ImageOps.exif_transpose(image)
    # Flatten a transparent scan (PNG signature) onto white instead of letting
    # `convert("RGB")` turn the transparent pixels black.
    if image.mode in ("RGBA", "LA", "P"):
        image = image.convert("RGBA")
        background = Image.new("RGB", image.size, "white")
        background.paste(image, mask=image.split()[-1])
        image = background
    elif image.mode not in ("RGB", "L"):
        image = image.convert("RGB")
    image.thumbnail((IMAGE_MAX_DIMENSION, IMAGE_MAX_DIMENSION), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=85, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def _page_style() -> str:
    return (
        _font_face()
        + "@page{size:A4;margin:0}"
        + "html,body{margin:0;padding:0}"
        + ".page{position:relative;width:210mm;height:297mm;overflow:hidden;"
          "page-break-after:always;background:#fff}"
        + ".page:last-child{page-break-after:auto}"
        + ".bg{position:absolute;left:0;top:0;width:100%;"
          "background-repeat:no-repeat;background-position:top left;background-size:100% auto}"
        + ".fit{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:contain}"
        + ".sig{position:absolute;height:auto}"
        + ".t{position:absolute;font-family:NotoBengali;font-weight:400;line-height:1.45;"
          "white-space:pre-wrap;overflow-wrap:break-word;color:#000}"
        + ".t.b{font-weight:700}"
        # Rich-text body: paragraphs/lists must not add their own browser margins.
        + ".t p{margin:0}"
        + ".t ul,.t ol{margin:0;padding-left:1.2em}"
        + ".t img{max-width:100%;height:auto;vertical-align:middle}"
    )


def _text_block(block: dict, text: str) -> str:
    classes = "t b" if block.get("bold") else "t"
    style = (
        f"left:{block['x']}%;top:{block['y']}%;width:{block['w']}%;"
        f"font-size:{block['size']}pt;text-align:{block['align']};"
    )
    if block.get("line_height"):
        style += f"line-height:{block['line_height']};"
    return f'<div class="{classes}" style="{style}">{text}</div>'


def build_application_page(
    house: House,
    values: dict,
    layout: Optional[dict] = None,
    image_uri: Optional[str] = None,
) -> str:
    """Page 3: letterhead image + the editable application text."""
    layout = layout or house.letterhead_layout or house_letterhead.default_layout()
    if image_uri is None:
        path = house_letterhead.image_fs_path(house)
        image_uri = _image_data_uri(Path(path).read_bytes()) if path else ""

    parts = [f'<div class="page"><div class="bg" style="height:100%;'
             f'background-image:url({image_uri})"></div>']
    body = layout.get("body") or {}
    body_html = house_letterhead.sanitize_body_html(body.get("text")) if body.get("enabled") else ""
    if body_html:
        parts.append(_text_block(body, _substitute(body_html, values)))

    # The proprietor signature is uploaded per house; print it where the layout
    # says (below the proprietor name by default) without any manual step.
    signature_block = layout.get("signature") or {}
    signature_uri = signature_block.get("enabled", True) and house_documents.signature_data_uri(house)
    if signature_uri:
        parts.append(
            f'<img class="sig" style="left:{signature_block.get("x", 58)}%;'
            f'top:{signature_block.get("y", 78)}%;width:{signature_block.get("w", 24)}%" '
            f'src="{signature_uri}">'
        )
    parts.append("</div>")
    return "".join(parts)


def build_document_html(pages: list) -> str:
    return (
        "<!DOCTYPE html><html><head><meta charset='utf-8'><style>"
        + _page_style()
        + "</style></head><body>"
        + "".join(pages)
        + "</body></html>"
    )


def build_resignation_html(
    house: House,
    employee: dict,
    letter_image: bytes,
    nid_image: bytes,
    application_date: Optional[date] = None,
) -> str:
    values = _base_values(house, employee, application_date or now_naive().date())
    pages = [
        f'<div class="page"><img class="fit" src="{_image_data_uri(letter_image)}"></div>',
        f'<div class="page"><img class="fit" src="{_image_data_uri(nid_image)}"></div>',
        build_application_page(house, values),
    ]
    return build_document_html(pages)


async def render_pdf(html_document: str) -> bytes:
    """Render HTML to PDF with headless Chromium (no JS, no network)."""
    from playwright.async_api import async_playwright

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            args=["--no-sandbox", "--disable-dev-shm-usage"]
        )
        try:
            context = await browser.new_context(java_script_enabled=False)

            async def _block(route):
                await route.abort()

            await context.route("**/*", _block)
            page = await context.new_page()
            page.set_default_timeout(RENDER_TIMEOUT_MS)
            await page.set_content(html_document, wait_until="load")
            return await page.pdf(
                format="A4",
                print_background=True,
                margin={"top": "0", "bottom": "0", "left": "0", "right": "0"},
            )
        finally:
            await browser.close()


def employee_values(house: House, employee: Employee, application_date: Optional[date] = None) -> dict:
    return _base_values(house, employee.__dict__, application_date or now_naive().date())


def sample_values(house: House, application_date: Optional[date] = None) -> dict:
    return _base_values(house, SAMPLE_EMPLOYEE, application_date or now_naive().date())


def build_preview_html(house: House, layout: Optional[dict] = None) -> str:
    """Single application page rendered with sample Bangla data."""
    return build_document_html([build_application_page(house, sample_values(house), layout)])


def safe_pdf_filename(employee: Employee) -> str:
    reference = re.sub(r"[^A-Za-z0-9_-]+", "", employee.dms_code or employee.employee_id or str(employee.id))
    return f"Resignation_{reference or employee.id}.pdf"
