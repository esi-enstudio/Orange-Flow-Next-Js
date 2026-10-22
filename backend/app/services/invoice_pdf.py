"""Invoice PDF (A4) for a subscription invoice.

The PDF is generated when a manual payment completes and is also rendered on
demand for invoices that predate the stored copy. Files live under
``private_uploads/invoices`` (never publicly served); the download endpoints in
``routers/billing.py`` / ``routers/admin_billing.py`` stream them to an
authenticated user instead.

All timestamps are naive Bangladesh Standard Time, matching the rest of the
billing module.
"""

import logging
import os
import re
from datetime import datetime
from io import BytesIO
from typing import Optional, Tuple

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.models.invoice import Invoice
from app.utils.timezone import now_naive

logger = logging.getLogger(__name__)

# Tests monkeypatch this to a temporary directory.
INVOICE_PDF_DIR = os.path.join("private_uploads", "invoices")

INK = colors.HexColor("#111827")
MUTED = colors.HexColor("#6B7280")
BORDER = colors.HexColor("#D1D5DB")
HEADER_BG = colors.HexColor("#F3F4F6")
ACCENT = colors.HexColor("#F97316")
ACCENT_SOFT = colors.HexColor("#FFF7ED")

STATUS_COLORS = {
    "paid": colors.HexColor("#047857"),
    "issued": colors.HexColor("#1D4ED8"),
    "unpaid": colors.HexColor("#B45309"),
    "partially_paid": colors.HexColor("#B45309"),
    "void": colors.HexColor("#9CA3AF"),
    "draft": colors.HexColor("#9CA3AF"),
}


def _safe(value) -> str:
    """Reportlab's built-in fonts are WinAnsi only — replace what they cannot encode."""
    if value is None:
        return ""
    text = str(value)
    try:
        text.encode("cp1252")
    except UnicodeEncodeError:
        text = text.encode("cp1252", "replace").decode("cp1252")
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _money(value) -> str:
    try:
        return f"{float(value or 0):,.2f}"
    except (TypeError, ValueError):
        return "0.00"


def _date_label(value) -> str:
    if hasattr(value, "strftime"):
        return value.strftime("%d %b %Y")
    return "—"


def _datetime_label(value) -> str:
    if hasattr(value, "strftime"):
        return value.strftime("%d %b %Y, %H:%M")
    return "—"


def invoice_pdf_filename(invoice: Invoice) -> str:
    safe_no = re.sub(r"[^A-Za-z0-9_-]", "_", invoice.invoice_no or f"invoice-{invoice.id}")
    return f"{safe_no}.pdf"


def _styles() -> dict:
    return {
        "brand": ParagraphStyle(
            "InvoiceBrand", fontName="Helvetica-Bold", fontSize=16, leading=19, textColor=ACCENT
        ),
        "brand_sub": ParagraphStyle(
            "InvoiceBrandSub", fontName="Helvetica", fontSize=8, leading=11, textColor=MUTED
        ),
        "title": ParagraphStyle(
            "InvoiceTitle", fontName="Helvetica-Bold", fontSize=22, leading=26, textColor=INK,
            alignment=2,
        ),
        "label": ParagraphStyle(
            "InvoiceLabel", fontName="Helvetica-Bold", fontSize=7.5, leading=10,
            textColor=MUTED, spaceAfter=1,
        ),
        "value": ParagraphStyle(
            "InvoiceValue", fontName="Helvetica", fontSize=9.5, leading=13, textColor=INK
        ),
        "value_bold": ParagraphStyle(
            "InvoiceValueBold", fontName="Helvetica-Bold", fontSize=9.5, leading=13,
            textColor=INK,
        ),
        "section": ParagraphStyle(
            "InvoiceSection", fontName="Helvetica-Bold", fontSize=8, leading=11,
            textColor=MUTED, spaceAfter=3,
        ),
        "th": ParagraphStyle(
            "InvoiceTh", fontName="Helvetica-Bold", fontSize=8, leading=10.5, textColor=INK
        ),
        "cell": ParagraphStyle(
            "InvoiceCell", fontName="Helvetica", fontSize=8.5, leading=11.5, textColor=INK
        ),
        "cell_right": ParagraphStyle(
            "InvoiceCellRight", fontName="Helvetica", fontSize=8.5, leading=11.5,
            textColor=INK, alignment=2,
        ),
        "total": ParagraphStyle(
            "InvoiceTotal", fontName="Helvetica-Bold", fontSize=11, leading=14,
            textColor=INK, alignment=2,
        ),
        "footer": ParagraphStyle(
            "InvoiceFooter", fontName="Helvetica", fontSize=7.5, leading=10.5, textColor=MUTED
        ),
    }


def _header_table(invoice: Invoice, styles: dict) -> Table:
    status = str(invoice.status or "").lower()
    status_color = STATUS_COLORS.get(status, MUTED)
    status_label = status.replace("_", " ").title() or "Unknown"
    left = [
        Paragraph("ORANGEFLOW", styles["brand"]),
        Paragraph("Distribution House Management System", styles["brand_sub"]),
    ]
    right = [
        Paragraph("INVOICE", styles["title"]),
        Paragraph(
            f'<font color="{status_color.hexval()}"><b>{_safe(status_label)}</b></font>',
            styles["brand_sub"],
        ),
    ]
    table = Table([[left, right]], colWidths=[110 * mm, 62 * mm])
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    return table


def _meta_table(invoice: Invoice, styles: dict) -> Table:
    def cell(label: str, value: str, bold: bool = False):
        return [
            Paragraph(label, styles["label"]),
            Paragraph(value, styles["value_bold"] if bold else styles["value"]),
        ]

    rows = [[
        cell("Invoice No", _safe(invoice.invoice_no), True),
        cell("Issued", _date_label(invoice.created_at)),
        cell("Due date", _date_label(invoice.due_date)),
        cell("Paid on", _date_label(invoice.paid_at)),
    ]]
    table = Table(rows, colWidths=[74 * mm, 34 * mm, 34 * mm, 30 * mm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), ACCENT_SOFT),
                ("BOX", (0, 0), (-1, -1), 0.6, BORDER),
                ("INNERGRID", (0, 0), (-1, -1), 0.4, BORDER),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    return table


def _parties_table(invoice: Invoice, styles: dict) -> Table:
    house = getattr(invoice, "house", None)
    sub = getattr(invoice, "subscription", None)
    plan = getattr(getattr(sub, "package", None), "name", None)

    bill_lines = [f"<b>{_safe(house.name if house else 'House')}</b>"]
    if house and house.code:
        bill_lines.append(f"Code: {_safe(house.code)}")
    if house and house.address:
        bill_lines.append(_safe(house.address))
    if house and house.email:
        bill_lines.append(_safe(house.email))
    if house and (house.poc_mobile or house.proprietor_contact):
        bill_lines.append(_safe(house.poc_mobile or house.proprietor_contact))

    sub_lines = [f"<b>{_safe(plan or 'Subscription')}</b>"]
    if sub and sub.billing_interval:
        sub_lines.append(f"Interval: {_safe(sub.billing_interval)}")
    if invoice.billing_period_start or invoice.billing_period_end:
        sub_lines.append(
            f"Period: {_date_label(invoice.billing_period_start)} – "
            f"{_date_label(invoice.billing_period_end)}"
        )
    if sub and sub.status:
        sub_lines.append(f"Subscription: {_safe(str(sub.status).replace('_', ' ').title())}")

    body = Paragraph("<br/>".join(bill_lines), styles["value"])
    body_right = Paragraph("<br/>".join(sub_lines), styles["value"])
    table = Table(
        [[Paragraph("BILL TO", styles["section"]), Paragraph("SUBSCRIPTION", styles["section"])],
         [body, body_right]],
        colWidths=[86 * mm, 86 * mm],
    )
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 1),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
            ]
        )
    )
    return table


def _line_items_table(invoice: Invoice, styles: dict) -> Table:
    sub = getattr(invoice, "subscription", None)
    plan = getattr(getattr(sub, "package", None), "name", None)
    description = invoice.description or (
        f"{plan} subscription" if plan else "Subscription invoice"
    )
    period = ""
    if invoice.billing_period_start or invoice.billing_period_end:
        period = f"{_date_label(invoice.billing_period_start)} – {_date_label(invoice.billing_period_end)}"

    rows = [
        [
            Paragraph("Description", styles["th"]),
            Paragraph("Period", styles["th"]),
            Paragraph("Amount (BDT)", styles["th"]),
        ],
        [
            Paragraph(_safe(description), styles["cell"]),
            Paragraph(_safe(period) or "—", styles["cell"]),
            Paragraph(_money(invoice.amount), styles["cell_right"]),
        ],
    ]
    if float(invoice.tax or 0):
        rows.append(
            [
                Paragraph("Tax", styles["cell"]),
                Paragraph("", styles["cell"]),
                Paragraph(_money(invoice.tax), styles["cell_right"]),
            ]
        )
    rows.append(
        [
            Paragraph("", styles["cell"]),
            Paragraph("<b>Total</b>", styles["cell"]),
            Paragraph(
                f"{_money(invoice.total)} {_safe(invoice.currency or 'BDT')}", styles["total"]
            ),
        ]
    )

    table = Table(rows, colWidths=[96 * mm, 46 * mm, 30 * mm], repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), HEADER_BG),
                ("BOX", (0, 0), (-1, -1), 0.6, BORDER),
                ("LINEBELOW", (0, 0), (-1, 0), 0.6, BORDER),
                ("INNERGRID", (0, 1), (-1, -2), 0.35, BORDER),
                ("LINEABOVE", (0, -1), (-1, -1), 0.6, BORDER),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return table


def _payment_table(invoice: Invoice, payment, styles: dict) -> Optional[Table]:
    """Payment reference block; nothing is shown for an unpaid invoice."""
    if payment is None and not invoice.paid_at:
        return None
    if payment is None:
        payments = list(getattr(invoice, "payments", None) or [])
        succeeded = [p for p in payments if p.status == "succeeded"] or payments
        payment = max(succeeded, key=lambda p: p.id) if succeeded else None

    method = _safe((getattr(payment, "gateway", None) or "manual")).title()
    reference = _safe(getattr(payment, "gateway_tran_id", None) or invoice.gateway_tran_id or "—")
    paid_at = _date_label(getattr(payment, "paid_at", None) or invoice.paid_at)
    amount = _money(getattr(payment, "amount", None) or invoice.total)

    rows = [[
        [Paragraph("Payment method", styles["label"]), Paragraph(method, styles["value"])],
        [Paragraph("Reference", styles["label"]), Paragraph(reference, styles["value"])],
        [Paragraph("Paid on", styles["label"]), Paragraph(paid_at, styles["value"])],
        [Paragraph("Amount received", styles["label"]), Paragraph(amount, styles["value_bold"])],
    ]]
    table = Table(rows, colWidths=[46 * mm, 50 * mm, 40 * mm, 36 * mm])
    table.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.6, BORDER),
                ("INNERGRID", (0, 0), (-1, -1), 0.4, BORDER),
                ("BACKGROUND", (0, 0), (-1, -1), colors.white),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    return table


def build_invoice_pdf(
    invoice: Invoice,
    *,
    payment=None,
    generated_by: str = "",
    generated_at: Optional[datetime] = None,
) -> bytes:
    """Render the invoice as an A4 PDF and return the bytes."""
    styles = _styles()
    buffer = BytesIO()
    generated_at = generated_at or now_naive()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
        title=f"Invoice {invoice.invoice_no}",
        author=generated_by or "OrangeFlow",
        subject="Subscription invoice",
    )

    footer = f"System generated invoice · {_datetime_label(generated_at)} BST"
    if generated_by:
        footer += f" · {_safe(generated_by)}"

    story = [
        _header_table(invoice, styles),
        Spacer(1, 6 * mm),
        _meta_table(invoice, styles),
        Spacer(1, 6 * mm),
        _parties_table(invoice, styles),
        Spacer(1, 6 * mm),
        _line_items_table(invoice, styles),
    ]

    payment_block = _payment_table(invoice, payment, styles)
    if payment_block is not None:
        story.extend([Spacer(1, 6 * mm), payment_block])

    story.extend(
        [
            Spacer(1, 9 * mm),
            Paragraph(_safe(footer), styles["footer"]),
        ]
    )

    doc.build(story)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    return pdf_bytes


def store_invoice_pdf(invoice: Invoice, pdf_bytes: bytes) -> Optional[str]:
    """Persist the PDF next to the other private uploads. Best effort."""
    try:
        os.makedirs(INVOICE_PDF_DIR, exist_ok=True)
        path = os.path.join(INVOICE_PDF_DIR, invoice_pdf_filename(invoice))
        with open(path, "wb") as handle:
            handle.write(pdf_bytes)
        return path
    except OSError as exc:
        # A read-only filesystem must never break recording a payment.
        logger.warning("invoice PDF could not be stored for %s: %s", invoice.invoice_no, exc)
        return None


def read_stored_invoice_pdf(invoice: Invoice) -> Optional[bytes]:
    path = invoice.pdf_path or os.path.join(INVOICE_PDF_DIR, invoice_pdf_filename(invoice))
    try:
        with open(path, "rb") as handle:
            return handle.read()
    except OSError:
        return None


async def get_or_create_invoice_pdf(db, invoice: Invoice) -> Tuple[bytes, str]:
    """Return (pdf_bytes, filename), rendering and storing it when missing."""
    pdf_bytes = read_stored_invoice_pdf(invoice)
    if pdf_bytes is None:
        pdf_bytes = build_invoice_pdf(invoice)
        stored = store_invoice_pdf(invoice, pdf_bytes)
        if stored:
            invoice.pdf_path = stored
            invoice.pdf_generated_at = now_naive()
            try:
                await db.commit()
            except Exception as exc:  # pragma: no cover - defensive
                await db.rollback()
                logger.warning("invoice PDF path could not be saved (invoice %s): %s",
                               invoice.invoice_no, exc)
    return pdf_bytes, invoice_pdf_filename(invoice)
