"""
Lifting statement PDF.

Layout (A4, no page margin):
    Lifting Statement
    House: <name (code)>
    Period: <from - to>
    Generated: <date, time BST>

    <one table with every product line of the filtered records>

    ItopUp Amount: <total>
    Bank Deposit Amount: <total>

    Prepared By            Checked By            Authorized Signature
"""

import logging
from datetime import datetime
from io import BytesIO
from typing import Iterable, Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

logger = logging.getLogger(__name__)

PAGE_WIDTH, PAGE_HEIGHT = A4
MARGIN = 20  # minimum margin in points
CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN

INK = colors.HexColor("#111827")
MUTED = colors.HexColor("#6B7280")
BORDER = colors.HexColor("#9CA3AF")
SUBTLE_BORDER = colors.HexColor("#D1D5DB")
HEADER_BG = colors.HexColor("#F3F4F6")


def _enum_value(value) -> str:
    if value is None:
        return ""
    return str(getattr(value, "value", value))


def _safe(value) -> str:
    """
    reportlab's built-in fonts are WinAnsi only, so replace characters they
    cannot encode instead of letting one odd product name break the export.
    """
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
    return _safe(value)


def _styles() -> dict:
    return {
        "title": ParagraphStyle(
            "StmtTitle", fontName="Helvetica-Bold", fontSize=20, leading=24, textColor=INK
        ),
        "meta": ParagraphStyle(
            "StmtMeta", fontName="Helvetica", fontSize=9.5, leading=13, textColor=INK
        ),
        "total": ParagraphStyle(
            "StmtTotal", fontName="Helvetica", fontSize=10, leading=14, textColor=INK
        ),
        "th": ParagraphStyle(
            "StmtTh", fontName="Helvetica-Bold", fontSize=7.6, leading=9.6, textColor=INK
        ),
        "cell": ParagraphStyle(
            "StmtCell", fontName="Helvetica", fontSize=7.4, leading=9.4, textColor=INK
        ),
        "cell_bold": ParagraphStyle(
            "StmtCellBold", fontName="Helvetica-Bold", fontSize=7.4, leading=9.4, textColor=INK
        ),
    }


def _product_table(records: Iterable, styles: dict) -> Table:
    rows = [
        [
            Paragraph("Date", styles["th"]),
            Paragraph("Record", styles["th"]),
            Paragraph("Product Code", styles["th"]),
            Paragraph("Product Name", styles["th"]),
            Paragraph("Category", styles["th"]),
            Paragraph("Qty", styles["th"]),
            Paragraph("Unit Price", styles["th"]),
            Paragraph("Total (BDT)", styles["th"]),
        ]
    ]

    for record in records:
        date_label = _date_label(record.lifting_date)
        for item in record.products or []:
            product = getattr(item, "product", None)
            rows.append(
                [
                    Paragraph(date_label, styles["cell"]),
                    Paragraph(f"#{record.id}", styles["cell"]),
                    Paragraph(_safe(item.product_code), styles["cell_bold"]),
                    Paragraph(_safe(item.product_name), styles["cell"]),
                    Paragraph(_safe(getattr(product, "category", None) or "-"), styles["cell"]),
                    Paragraph(f"{int(item.quantity or 0):,}", styles["cell"]),
                    Paragraph(_money(item.unit_price), styles["cell"]),
                    Paragraph(_money(item.total_price), styles["cell"]),
                ]
            )

    table = Table(
        rows,
        colWidths=[
            CONTENT_WIDTH * 0.10,
            CONTENT_WIDTH * 0.08,
            CONTENT_WIDTH * 0.12,
            CONTENT_WIDTH * 0.35,
            CONTENT_WIDTH * 0.12,
            CONTENT_WIDTH * 0.08,
            CONTENT_WIDTH * 0.08,
            CONTENT_WIDTH * 0.07,
        ],
        repeatRows=1,
        hAlign="LEFT",
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), HEADER_BG),
                ("BOX", (0, 0), (-1, -1), 0.6, BORDER),
                ("LINEBELOW", (0, 0), (-1, 0), 0.6, BORDER),
                ("INNERGRID", (0, 1), (-1, -1), 0.35, SUBTLE_BORDER),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (5, 0), (-1, -1), "RIGHT"),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    return table


def _signature_table(styles: dict) -> Table:
    def cell(label: str) -> Paragraph:
        return Paragraph(
            f'<br/><br/><br/><font color="#9CA3AF">______________________________</font>'
            f'<br/><font size="8"><b>{label}</b></font>',
            styles["cell"],
        )

    table = Table(
        [[cell("Prepared By"), cell("Checked By"), cell("Authorized Signature")]],
        colWidths=[CONTENT_WIDTH / 3] * 3,
    )
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    return table


def build_lifting_statement_pdf(
    records: Iterable,
    *,
    house_name: str,
    period_label: str,
    generated_by: str = "",
    generated_at: Optional[datetime] = None,
) -> bytes:
    """Render the statement for already filtered records (house and products loaded)."""
    records = list(records)
    generated_at = generated_at or datetime.now()
    styles = _styles()
    buffer = BytesIO()

    # No page margin: a zero-padding frame covers the whole A4 page, so the
    # header starts at x=0 and the table spans the full width.
    doc = BaseDocTemplate(
        buffer,
        pagesize=A4,
        title="Lifting Statement",
        author=generated_by or "OrangeFlow",
        subject=f"Lifting statement for {period_label}",
    )
    doc.addPageTemplates(
        [
            PageTemplate(
                id="full-bleed",
                frames=[
                    Frame(
                        MARGIN,
                        MARGIN,
                        CONTENT_WIDTH,
                        PAGE_HEIGHT - 2 * MARGIN,
                        leftPadding=0,
                        rightPadding=0,
                        topPadding=0,
                        bottomPadding=0,
                        id="full",
                    )
                ],
            )
        ]
    )

    total_itopup = sum(float(r.itopup_amount or 0) for r in records)
    total_deposit = sum(float(r.total_bank_deposit or 0) for r in records)

    generated_label = generated_at.strftime("%d %b %Y, %H:%M")
    generated_line = f"Generated: {generated_label} BST"
    if generated_by:
        generated_line += f" by {_safe(generated_by)}"

    story = [
        Paragraph("Lifting Statement", styles["title"]),
        Spacer(1, 2 * mm),
        Paragraph(f"<b>House:</b> {_safe(house_name)}", styles["meta"]),
        Paragraph(f"<b>Period:</b> {_safe(period_label)}", styles["meta"]),
        Paragraph(generated_line, styles["meta"]),
        Spacer(1, 4 * mm),
        _product_table(records, styles),
        Spacer(1, 5 * mm),
        Paragraph(f"<b>ItopUp Amount:</b> {_money(total_itopup)}", styles["total"]),
        Spacer(1, 1.5 * mm),
        Paragraph(f"<b>Bank Deposit Amount:</b> {_money(total_deposit)}", styles["total"]),
        Spacer(1, 14 * mm),
        _signature_table(styles),
    ]

    doc.build(story)
    pdf_bytes = buffer.getvalue()
    buffer.close()
    return pdf_bytes
