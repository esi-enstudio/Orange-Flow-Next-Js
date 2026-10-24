"""Billing endpoints for the selected house (self-service).

Covers: invoices (list/detail), payments history, manual payment methods,
refund records, and a billing overview card.

Payments are received offline and recorded by an authorised admin
(``POST /api/v1/admin/invoices/{id}/mark-paid`` or the cash-payment endpoint).
There is no hosted checkout and no gateway webhook in this deployment.
"""

import logging
import mimetypes
import os
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.routers.deps import (
    get_db, get_house_context, has_any_permission, has_permission,
)
from app.models.house import House
from app.models.invoice import (
    Invoice, INVOICE_STATUS_ISSUED, INVOICE_STATUS_UNPAID,
)
from app.models.payment import Payment, PAYMENT_STATUS_SUCCEEDED
from app.models.payment_method import PaymentMethod, PAYMENT_METHOD_TYPES
from app.models.user import User
from app.services import entitlement, invoice_pdf, payment_requests
from app.utils.activity_logger import log_activity
from app.utils.timezone import now_naive
from config.settings import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/billing", tags=["Billing"])


async def _house_id(current_user: User, house_context: Optional[int]) -> int:
    h = await entitlement._house_id_for(current_user, house_context)
    if not h:
        raise HTTPException(status_code=400, detail="Please select a house first (X-House-ID header required)")
    return h


def _invoice_payload(invoice: Invoice) -> dict:
    return {
        "id": invoice.id,
        "invoice_no": invoice.invoice_no,
        "amount": float(invoice.amount),
        "tax": float(invoice.tax),
        "total": float(invoice.total),
        "currency": invoice.currency,
        "status": invoice.status,
        "billing_period_start": invoice.billing_period_start,
        "billing_period_end": invoice.billing_period_end,
        "due_date": invoice.due_date,
        "paid_at": invoice.paid_at,
        "description": invoice.description,
        "created_at": invoice.created_at,
        # Shown to the tenant as the payment-order deadline.
        "submission_deadline": invoice.due_date,
    }


def _payment_payload(p: Payment) -> dict:
    meta = p.payment_meta or {}
    return {
        "id": p.id,
        "invoice_id": p.invoice_id,
        "invoice_no": p.invoice.invoice_no if p.invoice else None,
        "amount": float(p.amount),
        "currency": p.currency,
        "status": p.status,
        "gateway": p.gateway,
        "gateway_tran_id": p.gateway_tran_id,
        "reference": p.transaction_reference or meta.get("reference"),
        "method": meta.get("method") or p.gateway,
        "note": meta.get("note"),
        "rejection_reason": meta.get("rejection_reason"),
        "has_proof": bool(meta.get("proof_path")),
        "proof_name": meta.get("proof_name"),
        "sender_number": payment_requests.mask_mobile(meta.get("sender_number")),
        "bank_name": meta.get("bank_name"),
        "depositor_name": meta.get("depositor_name"),
        "payment_date": meta.get("payment_date"),
        "submitted_at": meta.get("submitted_at"),
        "paid_at": p.paid_at,
        "created_at": p.created_at,
    }


# ---------------------------------------------------------------------------
# Invoices
# ---------------------------------------------------------------------------

@router.get("/invoices")
async def list_invoices(
    page: int = 1,
    per_page: int = 20,
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_any_permission(["billing.view", "subscription.view"])),
):
    house_id = await _house_id(current_user, house_context)
    filters = [Invoice.house_id == house_id, Invoice.is_deleted == False]  # noqa: E712
    if status:
        filters.append(Invoice.status == status)

    per_page = max(1, min(per_page, 100))
    total = (await db.execute(select(func.count(Invoice.id)).where(*filters))).scalar_one()
    result = await db.execute(
        select(Invoice)
        .where(*filters)
        .order_by(Invoice.id.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    invoices = result.scalars().all()
    total_pages = (total + per_page - 1) // per_page
    return {
        "success": True,
        "data": [_invoice_payload(i) for i in invoices],
        "pagination": {
            "page": page, "per_page": per_page, "total": total,
            "total_pages": total_pages,
            "has_next": page < total_pages, "has_prev": page > 1,
        },
    }


@router.get("/invoices/{invoice_id}")
async def invoice_detail(
    invoice_id: int,
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_any_permission(["billing.view", "subscription.view"])),
):
    house_id = await _house_id(current_user, house_context)
    invoice = (await db.execute(
        select(Invoice).where(Invoice.id == invoice_id, Invoice.house_id == house_id)
    )).scalar_one_or_none()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    payments = (await db.execute(
        select(Payment).where(Payment.invoice_id == invoice_id)
    )).scalars().all()
    data = _invoice_payload(invoice)
    data["payments"] = [_payment_payload(p) for p in payments]
    return {"success": True, "data": data}


@router.get("/invoices/{invoice_id}/pdf")
async def download_invoice_pdf(
    invoice_id: int,
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_any_permission(["billing.view", "subscription.view", "payments.view"])),
):
    """Stream the invoice PDF for the selected house.

    Manual payments generate and store the PDF when the payment completes; this
    endpoint also renders one on demand for invoices that predate that (or
    whose stored file was removed).
    """
    house_id = await _house_id(current_user, house_context)
    invoice = (await db.execute(
        select(Invoice).where(
            Invoice.id == invoice_id,
            Invoice.house_id == house_id,
            Invoice.is_deleted == False,  # noqa: E712
        )
    )).scalar_one_or_none()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    pdf_bytes, filename = await invoice_pdf.get_or_create_invoice_pdf(db, invoice)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Payments history + refunds
# ---------------------------------------------------------------------------

@router.get("/payments")
async def list_payments(
    page: int = 1,
    per_page: int = 20,
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_any_permission(["billing.view", "subscription.view"])),
):
    house_id = await _house_id(current_user, house_context)
    per_page = max(1, min(per_page, 100))
    total = (await db.execute(
        select(func.count(Payment.id)).where(Payment.house_id == house_id, Payment.is_deleted == False)  # noqa: E712
    )).scalar_one()
    result = await db.execute(
        select(Payment)
        .where(Payment.house_id == house_id, Payment.is_deleted == False)  # noqa: E712
        .order_by(Payment.id.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    payments = result.scalars().all()
    total_pages = (total + per_page - 1) // per_page
    return {
        "success": True,
        "data": [_payment_payload(p) for p in payments],
        "pagination": {
            "page": page, "per_page": per_page, "total": total,
            "total_pages": total_pages,
            "has_next": page < total_pages, "has_prev": page > 1,
        },
    }


def _payment_request_error(exc: "payment_requests.PaymentRequestError") -> HTTPException:
    detail = {"code": exc.code, "message": exc.message}
    if exc.fields:
        detail["fields"] = exc.fields
    return HTTPException(status_code=exc.status_code, detail=detail)


@router.post("/payments/request", status_code=201)
async def submit_payment_request(
    request: Request,
    invoice_id: int = Form(...),
    method: str = Form("manual"),
    amount: Optional[float] = Form(None),
    reference: Optional[str] = Form(None),
    note: Optional[str] = Form(None),
    sender_number: Optional[str] = Form(None),
    bank_name: Optional[str] = Form(None),
    depositor_name: Optional[str] = Form(None),
    payment_date: Optional[date] = Form(None),
    proof: Optional[UploadFile] = File(None),
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission("billing.request_payment")),
):
    """Submit an offline payment for admin approval (nothing is activated yet)."""
    house_id = await _house_id(current_user, house_context)
    invoice = (await db.execute(
        select(Invoice).where(
            Invoice.id == invoice_id,
            Invoice.house_id == house_id,
            Invoice.is_deleted == False,  # noqa: E712
        )
    )).scalar_one_or_none()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    try:
        payment = await payment_requests.submit_request(
            db,
            invoice,
            house_id=house_id,
            amount=amount,
            method=method,
            reference=reference,
            note=note,
            proof=proof,
            submitted_by=current_user.id,
            sender_number=sender_number,
            bank_name=bank_name,
            depositor_name=depositor_name,
            payment_date=payment_date,
        )
    except payment_requests.PaymentRequestError as exc:
        raise _payment_request_error(exc)

    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="billing",
        action="create",
        record_id=payment.id,
        record_identifier=invoice.invoice_no,
        new_values={
            "payment_request_id": payment.id,
            "invoice_id": invoice.id,
            "amount": float(payment.amount),
            "channel": payment.gateway,
            "reference": (payment.payment_meta or {}).get("reference"),
            "has_proof": bool((payment.payment_meta or {}).get("proof_path")),
        },
        request=request,
        status_code=201,
    )
    return {"success": True, "data": _payment_payload(payment)}


@router.get("/payments/{payment_id}/proof")
async def download_payment_proof(
    payment_id: int,
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_any_permission(["billing.view", "subscription.view"])),
):
    house_id = await _house_id(current_user, house_context)
    payment = await payment_requests.get_payment_for_house(db, payment_id, house_id)
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    path = payment_requests.proof_disk_path(payment)
    if not path:
        raise HTTPException(status_code=404, detail="No proof file attached")
    meta = payment.payment_meta or {}
    filename = meta.get("proof_name") or os.path.basename(path)
    media_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    return FileResponse(path, media_type=media_type, filename=filename)


# ---------------------------------------------------------------------------
# Payment methods (manual bank transfer options)
# ---------------------------------------------------------------------------

@router.get("/payment-methods")
async def list_payment_methods(
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_any_permission(["billing.view", "subscription.view"])),
):
    house_id = await _house_id(current_user, house_context)
    result = (await db.execute(
        select(PaymentMethod).where(
            PaymentMethod.house_id == house_id,
            PaymentMethod.is_deleted == False,  # noqa: E712
        ).order_by(PaymentMethod.id.asc())
    )).scalars()
    return {"success": True, "data": [
        {
            "id": m.id,
            "method_type": m.method_type,
            "label": m.label,
            "bank_name": m.bank_name,
            "account_name": m.account_name,
            "account_number": m.account_number,
            "routing_number": m.routing_number,
            "bkash_number": m.bkash_number,
            "nagad_number": m.nagad_number,
            "instructions": m.instructions,
            "is_active": m.is_active,
        } for m in result
    ]}


class PaymentMethodRequest(BaseModel):
    method_type: str
    label: str
    bank_name: Optional[str] = None
    account_name: Optional[str] = None
    account_number: Optional[str] = None
    routing_number: Optional[str] = None
    bkash_number: Optional[str] = None
    nagad_number: Optional[str] = None
    instructions: Optional[str] = None


@router.post("/payment-methods")
async def create_payment_method(
    payload: PaymentMethodRequest,
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission("billing.edit")),
):
    if payload.method_type not in PAYMENT_METHOD_TYPES:
        raise HTTPException(status_code=400, detail=f"method_type must be one of {PAYMENT_METHOD_TYPES}")
    house_id = await _house_id(current_user, house_context)

    # Check for duplicate payment method
    query = select(PaymentMethod).where(
        PaymentMethod.house_id == house_id,
        PaymentMethod.method_type == payload.method_type,
        PaymentMethod.is_deleted == False,  # noqa: E712
    )
    if payload.account_number:
        query = query.where(PaymentMethod.account_number == payload.account_number)
    elif payload.bkash_number:
        query = query.where(PaymentMethod.bkash_number == payload.bkash_number)
    elif payload.nagad_number:
        query = query.where(PaymentMethod.nagad_number == payload.nagad_number)
    elif payload.label:
        query = query.where(PaymentMethod.label == payload.label)

    existing = (await db.execute(query)).first()
    if existing:
        raise HTTPException(status_code=400, detail="A payment method with these details already exists for this house.")

    method = PaymentMethod(
        house_id=house_id,
        gateway="cash" if payload.method_type == "cash" else "manual",
        method_type=payload.method_type,
        label=payload.label,
        bank_name=payload.bank_name,
        account_name=payload.account_name,
        account_number=payload.account_number,
        routing_number=payload.routing_number,
        bkash_number=payload.bkash_number,
        nagad_number=payload.nagad_number,
        instructions=payload.instructions,
        is_active=True,
        created_by=current_user.id,
    )
    db.add(method)
    await db.commit()
    await db.refresh(method)
    return {"success": True, "id": method.id}


@router.put("/payment-methods/{method_id}")
async def update_payment_method(
    method_id: int,
    payload: PaymentMethodRequest,
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission("billing.edit")),
):
    if payload.method_type not in PAYMENT_METHOD_TYPES:
        raise HTTPException(status_code=400, detail=f"method_type must be one of {PAYMENT_METHOD_TYPES}")
    house_id = await _house_id(current_user, house_context)

    method = await db.get(PaymentMethod, method_id)
    if not method or method.is_deleted or method.house_id != house_id:
        raise HTTPException(status_code=404, detail="Payment method not found")

    # Check for duplicate if fields changed
    query = select(PaymentMethod).where(
        PaymentMethod.house_id == house_id,
        PaymentMethod.method_type == payload.method_type,
        PaymentMethod.is_deleted == False,  # noqa: E712
        PaymentMethod.id != method_id,
    )
    if payload.account_number:
        query = query.where(PaymentMethod.account_number == payload.account_number)
    elif payload.bkash_number:
        query = query.where(PaymentMethod.bkash_number == payload.bkash_number)
    elif payload.nagad_number:
        query = query.where(PaymentMethod.nagad_number == payload.nagad_number)
    elif payload.label:
        query = query.where(PaymentMethod.label == payload.label)

    existing = (await db.execute(query)).first()
    if existing:
        raise HTTPException(status_code=400, detail="A payment method with these details already exists for this house.")

    method.method_type = payload.method_type
    method.gateway = "cash" if payload.method_type == "cash" else "manual"
    method.label = payload.label
    method.bank_name = payload.bank_name
    method.account_name = payload.account_name
    method.account_number = payload.account_number
    method.routing_number = payload.routing_number
    method.bkash_number = payload.bkash_number
    method.nagad_number = payload.nagad_number
    method.instructions = payload.instructions
    method.updated_at = now_naive()

    await db.commit()
    await db.refresh(method)
    return {"success": True, "id": method.id}


@router.delete("/payment-methods/{method_id}")
async def delete_payment_method(
    method_id: int,
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission("billing.edit")),
):
    house_id = await _house_id(current_user, house_context)
    method = await db.get(PaymentMethod, method_id)
    if not method or method.is_deleted or method.house_id != house_id:
        raise HTTPException(status_code=404, detail="Payment method not found")

    method.is_deleted = True
    method.deleted_at = now_naive()
    method.deleted_by = current_user.id
    await db.commit()
    return {"success": True, "message": "Payment method deleted successfully"}


# ---------------------------------------------------------------------------
# Overview (billing page header card)
# ---------------------------------------------------------------------------

@router.get("/overview")
async def billing_overview(
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_any_permission(["billing.view", "subscription.view"])),
):
    house_id = await _house_id(current_user, house_context)
    sub = await entitlement.get_house_subscription(db, house_id)
    house_name = (await db.execute(select(House.name).where(House.id == house_id))).scalar_one_or_none()

    total_received = (await db.execute(
        select(func.coalesce(func.sum(Payment.amount), 0)).where(
            Payment.house_id == house_id,
            Payment.status == PAYMENT_STATUS_SUCCEEDED,
            Payment.is_deleted == False,  # noqa: E712
        )
    )).scalar_one()
    unpaid_count = (await db.execute(
        select(func.count(Invoice.id)).where(
            Invoice.house_id == house_id,
            Invoice.status.in_([INVOICE_STATUS_ISSUED, INVOICE_STATUS_UNPAID]),
            Invoice.is_deleted == False,  # noqa: E712
        )
    )).scalar_one()
    due_now = (await db.execute(
        select(func.coalesce(func.sum(Invoice.total), 0)).where(
            Invoice.house_id == house_id,
            Invoice.status.in_([INVOICE_STATUS_ISSUED, INVOICE_STATUS_UNPAID]),
            Invoice.due_date <= now_naive(),
            Invoice.is_deleted == False,  # noqa: E712
        )
    )).scalar_one()

    return {
        "success": True,
        "data": {
            "house_id": house_id,
            "house_name": house_name,
            "effective_status": entitlement.effective_status(sub) if sub else "none",
            "plan_name": sub.package.name if sub and sub.package else None,
            "billing_interval": sub.billing_interval if sub else None,
            "next_billing_date": (sub.current_period_end or sub.end_date) if sub else None,
            "total_received": float(total_received),
            "unpaid_invoices": unpaid_count,
            "amount_due_now": float(due_now),
            "cash_payments_enabled": settings.CASH_PAYMENTS_ENABLED,
        },
    }