"""Render a validated Document AST into print-ready HTML.

Security boundary: everything the browser prints comes from here.

* The AST is the only body format - no user supplied HTML is ever executed.
* Every text value is HTML-escaped **before** variables are substituted, so a
  value containing ``<script>`` prints as literal text.
* No user supplied URLs: images are read from private storage and embedded as
  ``data:`` URIs after PIL re-encodes them.
* CSS values come from validated numbers/enums only (see `document_ast`).
* The render context has JavaScript disabled and every network request blocked
  (`document_pdf.render_pdf`).

Date values are printed in Bangla (Bangla digits + Bangla month), matching the
existing resignation letterhead output for the same document.
"""

import html
import logging
import os
from typing import Optional

from app.services import document_ast
from app.services.resignation_pdf import DESIGNATIONS, _font_face, _image_data_uri, bn_date

logger = logging.getLogger(__name__)

PRIVATE_ROOT = "private_uploads"

# Designation printed for an employee type ("rso" -> "RSO (Retail Sales Officer)").
def employee_designation(employee) -> str:
    employee_type = str(getattr(employee, "employee_type", "") or "").strip().lower()
    return DESIGNATIONS.get(employee_type, employee_type.upper())


def _text(value) -> str:
    return "" if value is None else str(value)


def _image_data_uri_from_path(rel_path: Optional[str]) -> Optional[str]:
    """Read a stored image inside `private_uploads` and return a data URI.

    Returns None for a missing file or a path that escapes the storage root, so
    a broken/malicious path can never leak an arbitrary file into a PDF.
    """
    if not rel_path:
        return None
    root = os.path.realpath(PRIVATE_ROOT)
    candidate = os.path.realpath(os.path.join(PRIVATE_ROOT, rel_path))
    if candidate != root and not candidate.startswith(root + os.sep):
        logger.error("Rejected out-of-root document image path: %s", rel_path)
        return None
    if not os.path.isfile(candidate):
        return None
    try:
        with open(candidate, "rb") as handle:
            return _image_data_uri(handle.read())
    except Exception as exc:  # noqa: BLE001 - a broken image must not kill the PDF
        logger.warning("Could not embed document image %s: %s", rel_path, exc)
        return None


# --------------------------------------------------------------------------- #
# Context
# --------------------------------------------------------------------------- #

def resolve_context(
    fields: list,
    values: Optional[dict] = None,
    *,
    employee=None,
    house=None,
    document: Optional[dict] = None,
    signatory=None,
) -> tuple:
    """Build the print context and list the required fields still empty.

    Automatic values come from the employee/house/document/signatory records.
    Read-only fields can never be overridden by the client; every other field
    may be edited by the operator before generation.
    """
    values = values or {}
    document = document or {}
    context: dict = {}

    for source, keys in document_ast.source_map().items():
        namespace, _, attribute = source.partition(".")
        value = ""
        if namespace == "employee" and employee is not None:
            value = (
                employee_designation(employee)
                if attribute == "designation"
                else getattr(employee, attribute, "")
            )
        elif namespace == "house" and house is not None:
            value = getattr(house, attribute, "")
        elif namespace == "document":
            value = document.get(attribute, "")
        elif namespace == "signatory" and signatory is not None:
            value = getattr(signatory, attribute, "")
        for key in keys:
            context[key] = _text(value)

    for field in fields:
        key = field["key"]
        if field.get("readonly"):
            continue
        submitted = values.get(key)
        if submitted is not None and str(submitted).strip() != "":
            context[key] = _text(submitted)
        elif not str(context.get(key, "")).strip() and field.get("default"):
            context[key] = _text(field["default"])

    for field in fields:
        key = field["key"]
        if field.get("type") == "date" and str(context.get(key, "")).strip():
            context[key] = bn_date(context[key])

    missing = [
        field["key"]
        for field in fields
        if field.get("required") and not str(context.get(field["key"], "")).strip()
    ]
    return context, missing


def _substitute(text: str, context: dict) -> str:
    """Escape the text, then fill whitelisted placeholders with escaped values."""
    variables = set(document_ast.PLACEHOLDER_RE.findall(text))
    unknown = variables - document_ast.VARIABLES.keys()
    if unknown:
        raise document_ast.AstError(
            "Unknown template variables: " + ", ".join(sorted(unknown))
        )
    missing = variables - context.keys()
    if missing:
        raise document_ast.AstError(
            "Undefined template variables: " + ", ".join(sorted(missing))
        )
    escaped = {key: html.escape(_text(value)) for key, value in context.items()}
    return document_ast.PLACEHOLDER_RE.sub(
        lambda match: escaped.get(match.group(1), ""), html.escape(_text(text))
    )


# --------------------------------------------------------------------------- #
# Blocks
# --------------------------------------------------------------------------- #

def _block_style(block: dict) -> str:
    return (
        f"text-align:{block.get('align', 'left')};"
        f"font-size:{block.get('size', 12)}pt;"
        f"line-height:{block.get('line_height', 1.7)};"
    )


def _signature_html(block: dict, context: dict, signatory) -> str:
    parts = []
    if block.get("show_image", True) and signatory is not None:
        uri = _image_data_uri_from_path(getattr(signatory, "signature_path", None))
        if uri:
            parts.append(f'<img class="sig-img" src="{uri}" alt="">')

    if signatory is not None:
        lines = [
            signatory.name,
            signatory.designation,
            context.get("house_name", ""),
            signatory.phone or "",
        ]
        lines = [html.escape(_text(line)) for line in lines if _text(line).strip()]
    else:
        fallback = block.get("fallback") or {}
        lines = [
            _substitute(fallback.get(key, ""), context)
            for key in ("name", "designation", "organization", "phone")
        ]
        lines = [line for line in lines if line.strip()]

    parts.extend(f'<div class="sig-line">{line}</div>' for line in lines)
    if not parts:
        return ""
    return (
        f'<div class="sig" style="text-align:{block.get("align", "left")};'
        f'font-size:{block.get("size", 12)}pt">'
        + "".join(parts)
        + "</div>"
    )


def _block_html(block: dict, context: dict, signatory) -> str:
    block_type = block["type"]

    if block_type in ("heading", "paragraph"):
        tag = "h2" if block_type == "heading" else "p"
        css_class = "doc-heading" if block_type == "heading" else "doc-p"
        weight = "font-weight:700;" if block.get("bold") else ""
        return (
            f'<{tag} class="{css_class}" style="{_block_style(block)}{weight}">'
            f'{_substitute(block.get("text", ""), context)}</{tag}>'
        )

    if block_type == "spacer":
        return f'<div style="height:{block.get("height", 8)}mm"></div>'

    if block_type == "divider":
        return f'<hr class="doc-divider" style="border-top:{block.get("size", 1)}px solid #000">'

    if block_type == "signature":
        return _signature_html(block, context, signatory)

    if block_type == "page_break":
        return '<div class="page-break"></div>'

    # Unreachable: validate_ast rejects unknown types.
    return ""


# --------------------------------------------------------------------------- #
# Letterhead
# --------------------------------------------------------------------------- #

def letterhead_html(letterhead) -> str:
    if letterhead is None:
        return ""
    logo = _image_data_uri_from_path(getattr(letterhead, "logo_path", None))
    phones = getattr(letterhead, "phone_numbers", None) or []
    contact = " · ".join(
        part
        for part in (
            html.escape(_text(getattr(letterhead, "address", "") or "")),
            " · ".join(html.escape(_text(phone)) for phone in phones),
            html.escape(_text(getattr(letterhead, "email", "") or "")),
        )
        if part
    )
    parts = ['<div class="letterhead">']
    if logo:
        parts.append(f'<img class="logo" src="{logo}" alt="">')
    parts.append(
        f'<div class="org">{html.escape(_text(letterhead.organization_name))}</div>'
    )
    if getattr(letterhead, "subtitle", None):
        parts.append(f'<div class="subtitle">{html.escape(_text(letterhead.subtitle))}</div>')
    if contact:
        parts.append(f'<div class="contact">{contact}</div>')
    parts.append("</div>")
    return "".join(parts)


def footer_html(letterhead) -> str:
    if letterhead is None or not getattr(letterhead, "footer_text", None):
        return ""
    return f'<div class="doc-footer">{html.escape(_text(letterhead.footer_text))}</div>'


# --------------------------------------------------------------------------- #
# Document
# --------------------------------------------------------------------------- #

def _page_css(page: dict, *, embed_fonts: bool = True) -> str:
    margins = page["margins"]
    orientation = "landscape" if page.get("orientation") == "landscape" else "portrait"
    # The PDF gets the font embedded (headless Chromium may have no Bangla
    # font installed). A browser preview already has one, so embedding the
    # ~1 MB base64 payload there only slows the response down.
    font_face = _font_face() if embed_fonts else ""
    font_family = (
        "NotoBengali"
        if embed_fonts
        else "'Noto Sans Bengali','Nirmala UI','Kalpurush','SolaimanLipi',sans-serif"
    )
    return (
        font_face
        + f"@page{{size:A4 {orientation};margin:{margins['top']}mm {margins['right']}mm "
        f"{margins['bottom']}mm {margins['left']}mm}}"
        + "html,body{margin:0;padding:0;background:#fff}"
        + f"body{{font-family:{font_family};font-size:{page.get('font_size', 12)}pt;"
        f"line-height:{page.get('line_height', 1.7)};color:#000}}"
        + ".doc-heading{margin:0 0 3mm 0;line-height:1.35}"
        + ".doc-p{margin:0 0 3mm 0;white-space:pre-wrap;overflow-wrap:break-word}"
        + ".doc-divider{border:0;border-top:1px solid #000;margin:3mm 0}"
        + ".page-break{page-break-after:always;break-after:page;height:0}"
        + ".letterhead{margin:0 0 6mm 0}"
        + ".letterhead .logo{max-height:18mm;max-width:45mm;display:block;margin-bottom:2mm}"
        + ".letterhead .org{font-size:15pt;font-weight:700;line-height:1.3}"
        + ".letterhead .subtitle{font-size:10pt;color:#333}"
        + ".letterhead .contact{font-size:9pt;color:#444;margin-top:1mm}"
        + ".sig{margin-top:10mm}"
        + ".sig .sig-img{max-height:18mm;max-width:50mm;display:block;margin-bottom:1mm}"
        + ".sig .sig-line{line-height:1.45}"
        + ".doc-footer{position:fixed;left:0;right:0;bottom:0;text-align:center;"
        "font-size:8pt;color:#555;border-top:0.3mm solid #bbb;padding-top:1.5mm}"
        + "@media print{html,body{background:#fff!important;-webkit-print-color-adjust:exact;"
        "print-color-adjust:exact}.doc-heading,.sig{break-inside:avoid;page-break-inside:avoid}"
        ".page-break{break-after:page;page-break-after:always}.doc-footer{position:fixed}}"
    )


def render_html(
    ast: dict,
    context: dict,
    *,
    letterhead=None,
    signatory=None,
    title: Optional[str] = None,
    embed_fonts: bool = True,
) -> str:
    """Full printable HTML for one document.

    `embed_fonts=False` is for the in-app preview; the PDF path must keep the
    default so the Bangla font travels with the document.
    """
    ast = document_ast.validate_ast(ast)
    unknown = document_ast.collect_variables(ast) - document_ast.VARIABLES.keys()
    if unknown:
        raise document_ast.AstError(
            "Unknown template variables: " + ", ".join(sorted(unknown))
        )
    body = [letterhead_html(letterhead)]
    body.extend(_block_html(block, context, signatory) for block in ast["blocks"])
    body.append(footer_html(letterhead))
    document_title = html.escape(_text(title or "Document"))
    lang = "bn" if any("\u0980" <= char <= "\u09ff" for char in "".join(context.values())) else "en"

    return (
        "<!DOCTYPE html><html lang='" + lang + "'><head><meta charset='utf-8'>"
        "<title>" + document_title + "</title>"
        "<style>" + _page_css(ast["page"], embed_fonts=embed_fonts) + "</style></head><body>"
        + "".join(body)
        + "</body></html>"
    )


def preview_values(fields: list) -> dict:
    """Sample values for a template preview (no employee selected yet)."""
    samples = {
        "employee_name": "মোঃ আব্দুল করিম",
        "fathers_name": "মোঃ আব্দুল রহমান",
        "mothers_name": "মোসাঃ রহিমা বেগম",
        "nid": "1234567890123",
        "dob": "1990-01-01",
        "dms_code": "R123456",
        "employee_id": "RSO-001",
        "itop_number": "1915270101",
        "personal_number": "01700000000",
        "pool_number": "01700000001",
        "employee_type": "rso",
        "designation": "RSO (Retail Sales Officer)",
        "joining_date": "2021-01-15",
        "resigned_date": "2026-06-30",
        "present_address": "মিরপুর, ঢাকা",
        "permanent_address": "মিরপুর, ঢাকা",
        "house_name": "এম/এস পাটোয়ারী টেলিকম",
        "house_code": "H001",
        "house_address": "১২৩, প্রধান সড়ক, ঢাকা",
        "house_district": "ঢাকা",
        "proprietor_name": "মোঃ পাটোয়ারী",
        "proprietor_contact": "01711111111",
        "document_number": "NOC-2026-0001",
        "document_date": "2026-11-11",
        "application_date": "2026-11-11",
        "document_title": "অনাপত্তি সনদ",
    }
    values = {}
    for field in fields:
        key = field["key"]
        values[key] = samples.get(key) or (field.get("options") or [""])[0] or f"[{field['label']}]"
    return values
