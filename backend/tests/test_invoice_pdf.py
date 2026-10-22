"""Invoice PDF: rendering, storage and on-demand generation."""

from decimal import Decimal

from app.services import invoice_pdf
from conftest import make_invoice, make_sub


async def test_build_invoice_pdf_returns_pdf_bytes(db, house, plan):
    sub = await make_sub(db, house.id, plan)
    invoice = await make_invoice(db, sub, plan, amount=Decimal("5000.00"))

    pdf = invoice_pdf.build_invoice_pdf(invoice)

    assert pdf.startswith(b"%PDF")
    assert len(pdf) > 1000
    assert pdf.rstrip().endswith(b"%%EOF")


async def test_store_and_read_roundtrip(db, house, plan):
    sub = await make_sub(db, house.id, plan)
    invoice = await make_invoice(db, sub, plan)
    pdf = invoice_pdf.build_invoice_pdf(invoice)

    stored = invoice_pdf.store_invoice_pdf(invoice, pdf)

    assert stored, "the PDF should be written to the configured directory"
    assert invoice_pdf.read_stored_invoice_pdf(invoice) == pdf


async def test_get_or_create_invoice_pdf_persists_path(db, house, plan):
    sub = await make_sub(db, house.id, plan)
    invoice = await make_invoice(db, sub, plan)

    pdf, filename = await invoice_pdf.get_or_create_invoice_pdf(db, invoice)

    await db.refresh(invoice)
    assert pdf.startswith(b"%PDF")
    assert filename == invoice_pdf.invoice_pdf_filename(invoice)
    assert invoice.pdf_path
    assert invoice.pdf_generated_at is not None
    # A second call must reuse the stored copy, not re-render.
    again, _ = await invoice_pdf.get_or_create_invoice_pdf(db, invoice)
    assert again == pdf


async def test_payment_block_only_for_paid_invoices(db, house, plan):
    from types import SimpleNamespace

    sub = await make_sub(db, house.id, plan)
    invoice = await make_invoice(db, sub, plan)
    styles = invoice_pdf._styles()

    assert invoice_pdf._payment_table(invoice, None, styles) is None

    payment = SimpleNamespace(
        gateway="cash",
        gateway_tran_id="CASH-INV-1",
        paid_at=None,
        amount=invoice.total,
        status="succeeded",
        id=1,
    )
    assert invoice_pdf._payment_table(invoice, payment, styles) is not None
    invoice.paid_at = invoice.created_at
    assert invoice_pdf._payment_table(invoice, None, styles) is not None


async def test_paid_pdf_is_larger_than_unpaid(db, house, plan):
    from types import SimpleNamespace

    sub = await make_sub(db, house.id, plan)
    invoice = await make_invoice(db, sub, plan)
    unpaid = invoice_pdf.build_invoice_pdf(invoice)

    invoice.paid_at = invoice.created_at
    payment = SimpleNamespace(
        gateway="cash",
        gateway_tran_id="CASH-INV-1",
        paid_at=invoice.created_at,
        amount=invoice.total,
        status="succeeded",
        id=1,
    )
    paid = invoice_pdf.build_invoice_pdf(invoice, payment=payment)

    assert paid.startswith(b"%PDF")
    assert len(paid) > len(unpaid)


async def test_read_stored_invoice_pdf_missing_file_returns_none(db, house, plan):
    sub = await make_sub(db, house.id, plan)
    invoice = await make_invoice(db, sub, plan)
    invoice.pdf_path = "/nonexistent/path/invoice.pdf"

    assert invoice_pdf.read_stored_invoice_pdf(invoice) is None
