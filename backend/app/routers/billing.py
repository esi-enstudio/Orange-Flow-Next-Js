"""Billing endpoints for the selected house (self-service).

Covers: invoices (list/detail), payment checkout (SSLCommerz session),
payments history, payment methods, refunds, and a billing overview card.
"""

import logging
import random
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.routers.deps import (
    get_db, get_house_context, get_current_user, has_any_permission, has_permission,
)
from app.models.house import House
from app.models.invoice import (
    Invoice, INVOICE_STATUS_PAID, INVOICE_STATUS_ISSUED, INVOICE_STATUS_UNPAID, INVOICE_STATUS_VOID,
)
from app.models.payment import (
    Payment, PaymentAttempt, Refund,
    PAYMENT_STATUS_SUCCEEDED, PAYMENT_STATUS_REFUNDED,
)
from app.models.payment_method import PaymentMethod, PAYMENT_METHOD_TYPES
from app.models.subscription import HouseSubscription, BILLING_INTERVAL_MONTHLY, BILLING_INTERVAL_YEARLY
from app.models.user import User
from app.services import entitlement, subscription_service as subsvc
from app.services.payment import get_gateway, get_active_gateway_name
from app.utils.timezone import now_naive

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/billing", tags=["Billing"])

GATEWAY_NAME = "sslcommerz"


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
    }


def _payment_payload(p: Payment) -> dict:
    return {
        "id": p.id,
        "invoice_id": p.invoice_id,
        "amount": float(p.amount),
        "currency": p.currency,
        "status": p.status,
        "gateway": p.gateway,
        "gateway_tran_id": p.gateway_tran_id,
        "card_type": p.card_type,
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


# ---------------------------------------------------------------------------
# Checkout (hosted gateway session)
# ---------------------------------------------------------------------------

@router.post("/invoices/{invoice_id}/checkout")
async def checkout_invoice(
    invoice_id: int,
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission("billing.pay")),
):
    house_id = await _house_id(current_user, house_context)
    invoice = (await db.execute(
        select(Invoice).where(Invoice.id == invoice_id, Invoice.house_id == house_id)
    )).scalar_one_or_none()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    if invoice.status == INVOICE_STATUS_PAID:
        return {"success": True, "redirect_url": None, "already_paid": True,
                "invoice": _invoice_payload(invoice)}
    if invoice.status == INVOICE_STATUS_VOID:
        raise HTTPException(status_code=400, detail="Invoice is void")

    gateway = get_gateway(GATEWAY_NAME)
    if gateway is None:
        raise HTTPException(status_code=503, detail="Payment gateway is not configured")

    house = (await db.execute(select(House).where(House.id == house_id))).scalar_one()
    tran_id = f"{invoice.invoice_no}A{random.randrange(1000, 9999)}"

    attempt = PaymentAttempt(
        house_id=house_id,
        invoice_id=invoice.id,
        subscription_id=invoice.subscription_id,
        amount=invoice.total,
        currency=invoice.currency,
        gateway=GATEWAY_NAME,
        gateway_tran_id=tran_id,
        status="initiated",
    )
    db.add(attempt)
    await db.flush()

    success_url = settings_value("SSLCOMMERZ_SUCCESS_URL") or default_url(current_user, "success")
    fail_url = settings_value("SSLCOMMERZ_FAIL_URL") or default_url(current_user, "failed")
    cancel_url = settings_value("SSLCOMMERZ_CANCEL_URL") or default_url(current_user, "cancelled")
    ipn_url = settings_value("SSLCOMMERZ_IPN_URL") or default_ipn_url()

    result = await gateway.create_checkout(
        amount=float(invoice.total),
        currency=invoice.currency,
        tran_id=tran_id,
        item_name=invoice.description or f"Subscription invoice {invoice.invoice_no}",
        success_url=success_url,
        fail_url=fail_url,
        cancel_url=cancel_url,
        ipn_url=ipn_url,
        customer_name=house.name,
        customer_email=current_user.email or "",
        customer_phone=getattr(current_user, "phone", None) or "",
    )

    if result.get("status") == "SUCCESS":
        attempt.session_key = result.get("session_key")
        await db.commit()
        return {
            "success": True,
            "redirect_url": result["gateway_page_url"],
            "tran_id": tran_id,
            "payment_attempt_id": attempt.id,
        }
    attempt.status = "failed"
    attempt.error_reason = result.get("error")
    await db.commit()
    raise HTTPException(status_code=502, detail=f"Checkout failed: {result.get('error')}")


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


class RefundRequest(BaseModel):
    amount: Optional[float] = None
    reason: Optional[str] = None


@router.post("/payments/{payment_id}/refund")
async def refund_payment(
    payment_id: int,
    payload: RefundRequest,
    db: AsyncSession = Depends(get_db),
    house_context: Optional[int] = Depends(get_house_context),
    current_user: User = Depends(has_permission("billing.refund")),
):
    house_id = await _house_id(current_user, house_context)
    payment = (await db.execute(
        select(Payment).where(Payment.id == payment_id, Payment.house_id == house_id)
    )).scalar_one_or_none()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    if payment.status in (PAYMENT_STATUS_REFUNDED, "partially_refunded"):
        raise HTTPException(status_code=400, detail=f"Payment is already {payment.status}")

    gateway = get_gateway(payment.gateway)
    if gateway is None:
        raise HTTPException(status_code=503, detail="Payment gateway is not configured")
    if not payment.gateway_tran_id:
        raise HTTPException(status_code=400, detail="Payment has no gateway transaction id to refund")

    refund_amount = payload.amount or float(payment.amount)
    if refund_amount > float(payment.amount):
        raise HTTPException(status_code=400, detail="Refund amount exceeds payment amount")

    result = await gateway.initiate_refund(
        tran_id=payment.gateway_tran_id,
        amount=refund_amount,
        reference=f"refund-{payment.id}-{refund_amount}",
    )
    if result.get("status") not in ("SUCCESS", "PROCESSING"):
        raise HTTPException(status_code=502, detail=f"Refund failed: {result.get('message')}")

    refund = Refund(
        house_id=house_id,
        payment_id=payment.id,
        invoice_id=payment.invoice_id,
        amount=refund_amount,
        currency=payment.currency,
        reason=payload.reason,
        status=result.get("status", "processing"),
        gateway_refund_id=result.get("refund_ref"),
        refunded_by=current_user.id,
        refunded_at=now_naive(),
    )
    db.add(refund)
    payment.status = PAYMENT_STATUS_REFUNDED if refund_amount >= float(payment.amount) else "partially_refunded"
    await db.commit()
    return {"success": True, "refund_id": refund.id, "status": refund.status}


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
        select(PaymentMethod).where(PaymentMethod.house_id == house_id)
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
    method = PaymentMethod(
        house_id=house_id,
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
        },
    }


# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------

def settings_value(name: str) -> Optional[str]:
    from config.settings import settings
    return getattr(settings, name, None) or None


def default_url(current_user: User, state: str) -> str:
    base = settings_value("APP_URL") or "http://localhost:3000"
    return f"{base}/billing?payment={state}"


def default_ipn_url() -> str:
    base = settings_value("APP_URL") or "http://localhost:8000"
    return f"{base}/api/webhook/gateway/sslcommerz"