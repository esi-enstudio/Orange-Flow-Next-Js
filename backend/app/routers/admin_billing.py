"""Admin-only cross-house subscription & billing management.

All endpoints require subscription.manage / billing.manage — granted only to
admin roles (Super Admin / Admin). Non-admin roles are denied even if they
hold subscription.view.
"""

import logging
import mimetypes
import os
from datetime import date, datetime, time, timedelta
from decimal import Decimal, InvalidOperation
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import or_, select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.routers.deps import get_db, has_any_permission, has_permission
from app.models.house import House
from app.models.invoice import (
    Invoice, INVOICE_STATUS_PAID, INVOICE_STATUS_ISSUED, INVOICE_STATUS_UNPAID, INVOICE_STATUS_VOID,
)
from app.models.payment import (
    Payment,
    Refund,
    PAYMENT_STATUS_SUCCEEDED,
    PAYMENT_STATUS_REFUNDED,
    PAYMENT_STATUS_PARTIALLY_REFUNDED,
)
from app.models.subscription import HouseSubscription
from app.models.user import User
from app.services import invoice_pdf, manual_payment, payment_requests
from app.services import subscription_service as subsvc
from app.services import entitlement
from app.utils.activity_logger import log_activity
from app.utils.timezone import now_naive

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/admin", tags=["Admin Billing"])

ALLOWED_STATUSES = ("trialing", "active", "past_due", "cancelled", "expired", "paused")


def _sub_payload(sub: HouseSubscription) -> dict:
    return {
        "id": sub.id,
        "house": {
            "id": sub.house.id,
            "name": sub.house.name,
            "code": sub.house.code,
        } if sub.house else {"id": sub.house_id},
        "plan": (sub.package.name if sub.package else None),
        "slug": (sub.package.slug if sub.package else None),
        "status": sub.status,
        "billing_interval": sub.billing_interval,
        "currency": sub.currency,
        "plan_price": (
            float(subsvc.plan_price(sub.package, sub.billing_interval))
            if sub.package else None
        ),
        "current_period_start": sub.current_period_start,
        "current_period_end": sub.current_period_end,
        "trial_end": sub.trial_end,
        "grace_period_end": sub.grace_period_end,
        "auto_renew": sub.auto_renew,
        "cancel_at_period_end": sub.cancel_at_period_end,
        "created_at": sub.created_at,
    }


# ---------------------------------------------------------------------------
# Subscriptions
# ---------------------------------------------------------------------------

@router.get("/subscriptions")
async def admin_list_subscriptions(
    page: int = 1,
    per_page: int = 20,
    status: Optional[str] = None,
    house_id: Optional[int] = None,
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("subscription.manage")),
):
    filters = [HouseSubscription.is_deleted == False]  # noqa: E712
    if status:
        filters.append(HouseSubscription.status == status)
    if house_id:
        filters.append(HouseSubscription.house_id == house_id)

    base = select(HouseSubscription).join(House).options(
        selectinload(HouseSubscription.house),
        selectinload(HouseSubscription.package),
    ).where(*filters)
    count_query = select(func.count(HouseSubscription.id)).join(House).where(*filters)
    if search:
        like = f"%{search}%"
        base = base.where(House.name.ilike(like))
        count_query = count_query.where(House.name.ilike(like))

    per_page = max(1, min(per_page, 100))
    total = (await db.execute(count_query)).scalar_one()
    result = await db.execute(
        base.order_by(HouseSubscription.id.desc())
        .offset((page - 1) * per_page).limit(per_page)
    )
    subs = result.scalars().unique().all()
    total_pages = (total + per_page - 1) // per_page
    return {
        "success": True,
        "data": [_sub_payload(s) for s in subs],
        "pagination": {
            "page": page, "per_page": per_page, "total": total,
            "total_pages": total_pages,
            "has_next": page < total_pages, "has_prev": page > 1,
        },
    }


@router.get("/subscriptions/{subscription_id}")
async def admin_subscription_detail(
    subscription_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("subscription.manage")),
):
    sub = (await db.execute(
        select(HouseSubscription)
        .options(selectinload(HouseSubscription.house), selectinload(HouseSubscription.package))
        .where(HouseSubscription.id == subscription_id)
    )).scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")
    data = _sub_payload(sub)
    data["invoices"] = []
    result = await db.execute(
        select(Invoice).where(Invoice.subscription_id == sub.id).order_by(Invoice.id.desc()).limit(20)
    )
    for inv in result.scalars().all():
        data["invoices"].append({
            "id": inv.id, "invoice_no": inv.invoice_no, "total": float(inv.total),
            "currency": inv.currency, "status": inv.status, "due_date": inv.due_date,
            "paid_at": inv.paid_at, "billing_period_start": inv.billing_period_start,
            "billing_period_end": inv.billing_period_end,
        })
    result = await db.execute(
        select(Payment).where(Payment.subscription_id == sub.id).order_by(Payment.id.desc()).limit(20)
    )
    data["payments"] = [{
        "id": p.id, "amount": float(p.amount), "currency": p.currency, "status": p.status,
        "gateway_tran_id": p.gateway_tran_id, "paid_at": p.paid_at,
    } for p in result.scalars().all()]
    return {"success": True, "data": data}


class AdminSubscriptionPatch(BaseModel):
    status: Optional[str] = None
    auto_renew: Optional[bool] = None
    billing_interval: Optional[str] = None
    extend_period_days: Optional[int] = None


@router.patch("/subscriptions/{subscription_id}")
async def admin_update_subscription(
    subscription_id: int,
    payload: AdminSubscriptionPatch,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("subscription.manage")),
):
    sub = (await db.execute(
        select(HouseSubscription).where(HouseSubscription.id == subscription_id)
    )).scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")

    if payload.status and payload.status not in ALLOWED_STATUSES:
        raise HTTPException(status_code=400, detail=f"status must be one of {ALLOWED_STATUSES}")

    from datetime import timedelta
    if payload.status:
        await subsvc.set_status(db, sub, payload.status, changed_by=current_user.id,
                                changed_via="admin", change_type="admin_status_override")
    if payload.auto_renew is not None:
        sub.auto_renew = payload.auto_renew
    if payload.billing_interval:
        sub.billing_interval = payload.billing_interval
    if payload.extend_period_days:
        sub.current_period_end = (sub.current_period_end or now_naive()) + timedelta(days=payload.extend_period_days)
        sub.end_date = sub.current_period_end
    sub.updated_at = now_naive()
    await db.commit()
    await db.refresh(sub)
    return {"success": True, "data": _sub_payload(sub)}


@router.post("/subscriptions/{subscription_id}/issue-invoice")
async def admin_issue_invoice(
    subscription_id: int,
    for_next_period: bool = Query(True, description="Bill the next billing period (default) or the current one"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("billing.manage")),
):
    sub = (await db.execute(
        select(HouseSubscription).where(HouseSubscription.id == subscription_id)
    )).scalar_one_or_none()
    if not sub or not sub.package:
        raise HTTPException(status_code=404, detail="Subscription or plan not found")
    invoice = await subsvc.issue_invoice(
        db, sub, sub.package, billing_interval=sub.billing_interval,
        description=f"Manual invoice (admin {current_user.id})",
        period_start=subsvc.next_billing_period_start(sub) if for_next_period else None,
    )
    return {"success": True, "invoice": {"id": invoice.id, "invoice_no": invoice.invoice_no, "total": float(invoice.total)}}


# ---------------------------------------------------------------------------
# Invoices (admin-managed / offline payments)
# ---------------------------------------------------------------------------

class MarkPaidRequest(BaseModel):
    gateway_tran_id: Optional[str] = None
    amount: Optional[float] = None
    note: Optional[str] = None
    reference: Optional[str] = None
    paid_at: Optional[datetime] = None


def _payment_error(exc: "manual_payment.ManualPaymentError") -> HTTPException:
    detail = {"code": exc.code, "message": exc.message}
    if exc.fields:
        detail["fields"] = exc.fields
    return HTTPException(status_code=exc.status_code, detail=detail)


async def _notify_payment(db: AsyncSession, invoice: Invoice, sub) -> None:
    try:
        from app.services.billing_notifications import notify_house
        house = (await db.execute(select(House).where(House.id == invoice.house_id))).scalar_one_or_none()
        if house:
            await notify_house(db, house, "payment_succeeded", invoice=invoice, sub=sub)
    except Exception as exc:  # a notification failure must never undo a payment
        logger.warning("offline payment notification failed: %s", exc)


async def _audit_cash_payment(
    db: AsyncSession,
    request: Request,
    current_user: User,
    result: dict,
    amount,
    reference: Optional[str],
    note: Optional[str],
) -> None:
    payment = result.get("payment")
    invoice = result["invoice"]
    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="billing",
        action="create",
        record_id=payment.id if payment else invoice.id,
        record_identifier=invoice.invoice_no,
        new_values={
            "invoice_id": invoice.id,
            "invoice_no": invoice.invoice_no,
            "amount": float(amount),
            "currency": invoice.currency,
            "gateway": manual_payment.CASH_GATEWAY,
            "reference": reference,
            "note": note,
        },
        request=request,
    )


@router.post("/invoices/{invoice_id}/mark-paid")
async def admin_mark_invoice_paid(
    invoice_id: int,
    payload: MarkPaidRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_any_permission(["billing.manage", "billing.cash_payment"])),
):
    """Authoritative offline/cash payment recording for one invoice."""
    invoice = (await db.execute(
        select(Invoice).where(Invoice.id == invoice_id)
    )).scalar_one_or_none()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    try:
        result = await manual_payment.pay_invoice_manually(
            db,
            invoice,
            amount=payload.amount,
            gateway=manual_payment.CASH_GATEWAY,
            reference=payload.reference or payload.gateway_tran_id,
            note=payload.note,
            paid_at=payload.paid_at,
            recorded_by=current_user.id,
        )
    except manual_payment.ManualPaymentError as exc:
        raise _payment_error(exc)

    invoice = result["invoice"]
    if not result["already_paid"]:
        await _notify_payment(db, invoice, result["subscription"])
        payment = result["payment"]
        await _audit_cash_payment(
            db, request, current_user, result,
            payment.amount if payment else invoice.total,
            payload.reference or payload.gateway_tran_id, payload.note,
        )

    return {
        "success": True,
        "already_paid": result["already_paid"],
        "invoice_status": invoice.status,
        "payment_id": result["payment"].id if result["payment"] else None,
    }


class CashPaymentRequest(BaseModel):
    amount: Optional[float] = None
    reference: Optional[str] = None
    note: Optional[str] = None
    paid_at: Optional[datetime] = None
    idempotency_key: Optional[str] = None


@router.post("/subscriptions/{subscription_id}/cash-payment")
async def admin_record_cash_payment(
    subscription_id: int,
    payload: CashPaymentRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_any_permission(["billing.manage", "billing.cash_payment"])),
):
    """Record cash received for a subscription in one step (no gateway).

    Reuses the oldest open invoice when one exists; otherwise issues an invoice
    for the next billing period. Cash is the authoritative payment: the
    subscription only activates/renews after this server-side record exists.
    """
    sub = (await db.execute(
        select(HouseSubscription)
        .options(
            selectinload(HouseSubscription.house),
            selectinload(HouseSubscription.package),
        )
        .where(
            HouseSubscription.id == subscription_id,
            HouseSubscription.is_deleted == False,  # noqa: E712
        )
    )).scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")

    try:
        result = await manual_payment.record_cash_payment(
            db,
            sub,
            amount=payload.amount,
            reference=payload.reference,
            note=payload.note,
            paid_at=payload.paid_at,
            recorded_by=current_user.id,
            idempotency_key=payload.idempotency_key,
        )
    except manual_payment.ManualPaymentError as exc:
        raise _payment_error(exc)

    invoice = result["invoice"]
    if not result["already_paid"]:
        await _notify_payment(db, invoice, result["subscription"])
        payment = result["payment"]
        await _audit_cash_payment(
            db, request, current_user, result,
            payment.amount if payment else invoice.total,
            payload.reference, payload.note,
        )

    # Re-read with relationships after mark_invoice_paid refreshed the row.
    fresh_sub = (await db.execute(
        select(HouseSubscription)
        .options(
            selectinload(HouseSubscription.house),
            selectinload(HouseSubscription.package),
        )
        .where(HouseSubscription.id == subscription_id)
    )).scalar_one_or_none()

    return {
        "success": True,
        "already_paid": result["already_paid"],
        "invoice": {
            "id": invoice.id,
            "invoice_no": invoice.invoice_no,
            "total": float(invoice.total),
            "currency": invoice.currency,
            "status": invoice.status,
            "paid_at": invoice.paid_at,
            "billing_period_start": invoice.billing_period_start,
            "billing_period_end": invoice.billing_period_end,
        },
        "subscription": _sub_payload(fresh_sub) if fresh_sub else None,
        "payment_id": result["payment"].id if result["payment"] else None,
    }


@router.get("/invoices/{invoice_id}/pdf")
async def admin_download_invoice_pdf(
    invoice_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        has_any_permission(["billing.manage", "billing.view", "subscription.manage"])
    ),
):
    """Stream any house's invoice PDF (admin billing view)."""
    invoice = (await db.execute(
        select(Invoice).where(
            Invoice.id == invoice_id,
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


@router.get("/invoices")
async def admin_list_invoices(
    page: int = 1,
    per_page: int = 20,
    status: Optional[str] = None,
    house_id: Optional[int] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("billing.manage")),
):
    filters = [Invoice.is_deleted == False]  # noqa: E712
    if status:
        filters.append(Invoice.status == status)
    if house_id:
        filters.append(Invoice.house_id == house_id)
    if from_date:
        filters.append(Invoice.due_date >= from_date)
    if to_date:
        filters.append(Invoice.due_date <= to_date)

    per_page = max(1, min(per_page, 100))
    total = (await db.execute(select(func.count(Invoice.id)).where(*filters))).scalar_one()
    result = await db.execute(
        select(Invoice).options(selectinload(Invoice.house)).where(*filters).order_by(Invoice.id.desc())
        .offset((page - 1) * per_page).limit(per_page)
    )
    rows = [{
        "id": i.id, "invoice_no": i.invoice_no, "house_id": i.house_id,
        "house_name": i.house.name if i.house else None,
        "total": float(i.total), "currency": i.currency, "status": i.status,
        "due_date": i.due_date, "paid_at": i.paid_at, "created_at": i.created_at,
    } for i in result.scalars().unique().all()]
    total_pages = (total + per_page - 1) // per_page
    return {"success": True, "data": rows, "pagination": {
        "page": page, "per_page": per_page, "total": total,
        "total_pages": total_pages, "has_next": page < total_pages, "has_prev": page > 1,
    }}


# ---------------------------------------------------------------------------
# Payments
# ---------------------------------------------------------------------------

def _payment_review_history(payment: Payment) -> list[dict]:
    """Append-only review trail reconstructed from the payment metadata.

    The immutable source of truth for compliance is ``activity_logs``; this
    list gives the reviewer the same timeline on the payment itself.
    """
    meta = payment.payment_meta or {}
    events: list[dict] = []
    if meta.get("submitted_at"):
        events.append({
            "action": "submitted",
            "at": meta.get("submitted_at"),
            "by": meta.get("submitted_by"),
            "reason": None,
        })
    if meta.get("info_requested_at"):
        events.append({
            "action": "needs_info",
            "at": meta.get("info_requested_at"),
            "by": meta.get("info_requested_by"),
            "reason": meta.get("info_request_reason"),
        })
    if meta.get("rejected_at"):
        events.append({
            "action": "rejected",
            "at": meta.get("rejected_at"),
            "by": meta.get("rejected_by"),
            "reason": meta.get("rejection_reason"),
        })
    if meta.get("approved_at"):
        events.append({
            "action": "approved",
            "at": meta.get("approved_at"),
            "by": meta.get("approved_by"),
            "reason": meta.get("approval_note"),
        })
    return sorted(events, key=lambda e: str(e.get("at") or ""))


async def _actor_labels(db: AsyncSession, ids) -> dict[int, dict]:
    """Map user ids to ``{name, role}`` for the review trail.

    The trail stores ids only; a reviewer needs to read who submitted and who
    decided, so the detail endpoint resolves them in one query.
    """
    wanted = {int(i) for i in ids if i}
    if not wanted:
        return {}
    users = (await db.execute(
        select(User)
        .options(selectinload(User.roles))
        .where(User.id.in_(wanted))
    )).scalars().all()
    return {
        user.id: {
            "name": user.name or f"#{user.id}",
            "role": user.roles[0].name if user.roles else None,
        }
        for user in users
    }


def _payment_row(payment: Payment) -> dict:
    meta = payment.payment_meta or {}
    invoice = payment.invoice
    sub = invoice.subscription if invoice else None
    plan = sub.package if sub and sub.package else None
    return {
        "id": payment.id,
        "house_id": payment.house_id,
        "house_name": payment.house.name if payment.house else None,
        "house_code": payment.house.code if payment.house else None,
        "invoice_id": payment.invoice_id,
        "invoice_no": invoice.invoice_no if invoice else None,
        "plan_name": plan.name if plan else None,
        "expected_amount": float(invoice.total) if invoice else None,
        "amount": float(payment.amount),
        "currency": payment.currency,
        "status": payment.status,
        "gateway": payment.gateway,
        "method": meta.get("method") or payment.gateway,
        "gateway_tran_id": payment.gateway_tran_id,
        "reference": payment.transaction_reference or meta.get("reference"),
        "note": meta.get("note"),
        "rejection_reason": meta.get("rejection_reason"),
        "info_request_reason": meta.get("info_request_reason"),
        "has_proof": bool(meta.get("proof_path")),
        "proof_name": meta.get("proof_name"),
        "submitted_by": meta.get("submitted_by"),
        "submitted_at": meta.get("submitted_at"),
        "sender_number": meta.get("sender_number"),
        "bank_name": meta.get("bank_name"),
        "depositor_name": meta.get("depositor_name"),
        "payment_date": meta.get("payment_date"),
        "paid_at": payment.paid_at,
        "created_at": payment.created_at,
    }


@router.get("/payments/summary")
async def admin_payments_summary(
    house_id: Optional[int] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("payments.manage")),
):
    """Review dashboard counters (all time or filtered by house / period)."""
    filters = [Payment.is_deleted == False]  # noqa: E712
    if house_id:
        filters.append(Payment.house_id == house_id)
    if from_date:
        filters.append(Payment.created_at >= datetime.combine(from_date, time.min))
    if to_date:
        filters.append(Payment.created_at <= datetime.combine(to_date, time.max))

    rows = (await db.execute(
        select(Payment.status, func.count(Payment.id), func.coalesce(func.sum(Payment.amount), 0))
        .where(*filters)
        .group_by(Payment.status)
    )).all()
    by_status = {status: {"count": int(count), "amount": float(amount)} for status, count, amount in rows}
    approved = by_status.get(PAYMENT_STATUS_SUCCEEDED, {"count": 0, "amount": 0.0})
    total_count = sum(v["count"] for v in by_status.values())

    return {
        "success": True,
        "data": {
            "total_submitted": total_count,
            "pending_review": by_status.get("pending", {}).get("count", 0),
            "needs_info": by_status.get("needs_info", {}).get("count", 0),
            "approved": approved["count"],
            "rejected": by_status.get("failed", {}).get("count", 0),
            "refunded": by_status.get("refunded", {}).get("count", 0),
            "total_approved_amount": approved["amount"],
            "by_status": by_status,
        },
    }


@router.get("/payments")
async def admin_list_payments(
    page: int = 1,
    per_page: int = 20,
    status: Optional[str] = None,
    house_id: Optional[int] = None,
    search: Optional[str] = None,
    method: Optional[str] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("payments.manage")),
):
    """Paginated payment queue with review-friendly search and filters."""
    filters = [Payment.is_deleted == False]  # noqa: E712
    if status:
        filters.append(Payment.status == status)
    if house_id:
        filters.append(Payment.house_id == house_id)
    if method:
        filters.append(Payment.gateway == method)
    if from_date:
        filters.append(Payment.created_at >= datetime.combine(from_date, time.min))
    if to_date:
        filters.append(Payment.created_at <= datetime.combine(to_date, time.max))
    if search and search.strip():
        like = f"%{search.strip()}%"
        filters.append(or_(
            Payment.transaction_reference.ilike(like),
            Payment.gateway_tran_id.ilike(like),
            Payment.invoice_id.in_(select(Invoice.id).where(Invoice.invoice_no.ilike(like))),
            Payment.house_id.in_(select(House.id).where(House.name.ilike(like))),
        ))

    per_page = max(1, min(per_page, 100))
    total = (await db.execute(select(func.count(Payment.id)).where(*filters))).scalar_one()
    result = await db.execute(
        select(Payment)
        .options(
            selectinload(Payment.house),
            selectinload(Payment.invoice)
            .selectinload(Invoice.subscription)
            .selectinload(HouseSubscription.package),
        )
        .where(*filters)
        .order_by(Payment.id.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    rows = [_payment_row(p) for p in result.scalars().unique().all()]
    total_pages = (total + per_page - 1) // per_page
    return {"success": True, "data": rows, "pagination": {
        "page": page, "per_page": per_page, "total": total,
        "total_pages": total_pages, "has_next": page < total_pages, "has_prev": page > 1,
    }}


@router.get("/payments/{payment_id}")
async def admin_payment_detail(
    payment_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("payments.manage")),
):
    """Full review view: order, payer evidence, proof and review history."""
    payment = (await db.execute(
        select(Payment)
        .options(
            selectinload(Payment.house),
            selectinload(Payment.refunds),
            selectinload(Payment.invoice)
            .selectinload(Invoice.subscription)
            .selectinload(HouseSubscription.package),
        )
        # Always show the reviewer the current state, never a cached instance.
        .execution_options(populate_existing=True)
        .where(Payment.id == payment_id, Payment.is_deleted == False)  # noqa: E712
    )).scalar_one_or_none()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    data = _payment_row(payment)
    invoice = payment.invoice
    sub = invoice.subscription if invoice else None
    meta = payment.payment_meta or {}
    history = _payment_review_history(payment)
    actors = await _actor_labels(db, [
        meta.get("submitted_by"),
        meta.get("info_requested_by"),
        meta.get("rejected_by"),
        meta.get("approved_by"),
    ])
    for event in history:
        event["by_name"] = (actors.get(event.get("by")) or {}).get("name")
    data.update({
        "submitted_by_name": (actors.get(meta.get("submitted_by")) or {}).get("name"),
        "submitted_by_role": (actors.get(meta.get("submitted_by")) or {}).get("role"),
        "invoice_status": invoice.status if invoice else None,
        "invoice_due_date": invoice.due_date if invoice else None,
        "billing_period_start": invoice.billing_period_start if invoice else None,
        "billing_period_end": invoice.billing_period_end if invoice else None,
        "plan_interval": sub.billing_interval if sub else None,
        "subscription_status": sub.status if sub else None,
        "subscription_period_end": sub.current_period_end if sub else None,
        "review_history": history,
        "refunds": [
            {
                "id": r.id,
                "amount": float(r.amount),
                "currency": r.currency,
                "status": r.status,
                "reason": r.reason,
                "created_at": r.created_at,
                "refunded_at": r.refunded_at,
            }
            for r in (payment.refunds or [])
            if not r.is_deleted
        ],
    })
    return {"success": True, "data": data}


# ---------------------------------------------------------------------------
# Manual payment requests (tenant submitted, admin approved)
# ---------------------------------------------------------------------------

class RejectPaymentRequest(BaseModel):
    reason: Optional[str] = None


def _admin_payment_payload(payment: Payment) -> dict:
    meta = payment.payment_meta or {}
    invoice = payment.invoice
    return {
        "id": payment.id,
        "house_id": payment.house_id,
        "invoice_id": payment.invoice_id,
        "invoice_no": invoice.invoice_no if invoice else None,
        "amount": float(payment.amount),
        "currency": payment.currency,
        "status": payment.status,
        "gateway": payment.gateway,
        "gateway_tran_id": payment.gateway_tran_id,
        "reference": payment.transaction_reference or meta.get("reference"),
        "note": meta.get("note"),
        "rejection_reason": meta.get("rejection_reason"),
        "has_proof": bool(meta.get("proof_path")),
        "proof_name": meta.get("proof_name"),
        "submitted_by": meta.get("submitted_by"),
        "submitted_at": meta.get("submitted_at"),
        "sender_number": meta.get("sender_number"),
        "bank_name": meta.get("bank_name"),
        "depositor_name": meta.get("depositor_name"),
        "payment_date": meta.get("payment_date"),
        "info_request_reason": meta.get("info_request_reason"),
        "paid_at": payment.paid_at,
        "created_at": payment.created_at,
    }


def _payment_request_http_error(exc: "payment_requests.PaymentRequestError") -> HTTPException:
    detail = {"code": exc.code, "message": exc.message}
    if exc.fields:
        detail["fields"] = exc.fields
    return HTTPException(status_code=exc.status_code, detail=detail)


@router.get("/payments/{payment_id}/proof")
async def admin_download_payment_proof(
    payment_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_any_permission(["payments.manage", "billing.manage"])),
):
    payment = (await db.execute(
        select(Payment).where(Payment.id == payment_id, Payment.is_deleted == False)  # noqa: E712
    )).scalar_one_or_none()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    path = payment_requests.proof_disk_path(payment)
    if not path:
        raise HTTPException(status_code=404, detail="No proof file attached")
    meta = payment.payment_meta or {}
    filename = meta.get("proof_name") or os.path.basename(path)
    media_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    return FileResponse(path, media_type=media_type, filename=filename)


@router.post("/payments/{payment_id}/approve")
async def admin_approve_payment(
    payment_id: int,
    request: Request,
    idempotency_key: Optional[str] = Header(None, alias="Idempotency-Key"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("billing.approve_payment")),
):
    """Approve a tenant payment request and start the paid period now.

    Approval time is authoritative: a first activation runs for one billing
    interval from now (monthly = 1 month, yearly = 1 year). A renewal extends
    the current period end instead, so approved early payments never lose time.

    The payment and invoice rows are locked and the whole decision commits in
    one transaction; an ``Idempotency-Key`` retry returns ``already_approved``
    without extending the subscription twice.
    """
    payment = (await db.execute(
        select(Payment).where(Payment.id == payment_id, Payment.is_deleted == False)  # noqa: E712
    )).scalar_one_or_none()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    try:
        result = await payment_requests.approve_request(
            db, payment, approved_by=current_user.id, idempotency_key=idempotency_key
        )
    except payment_requests.PaymentRequestError as exc:
        raise _payment_request_http_error(exc)

    invoice = result["invoice"]
    sub = result["subscription"]
    if not result["already_approved"]:
        await _notify_payment(db, invoice, sub)
        await log_activity(
            db=db,
            user_id=current_user.id,
            user_name=current_user.name,
            module="billing",
            action="approve",
            record_id=payment.id,
            record_identifier=invoice.invoice_no if invoice else None,
            new_values={
                "payment_id": payment.id,
                "invoice_id": payment.invoice_id,
                "amount": float(payment.amount),
                "currency": payment.currency,
                "channel": payment.gateway,
                "subscription_status": sub.status if sub else None,
                "period_start": invoice.billing_period_start if invoice else None,
                "period_end": invoice.billing_period_end if invoice else None,
                "approved_at": payment.paid_at,
            },
            request=request,
            status_code=200,
        )

    return {
        "success": True,
        "already_approved": result["already_approved"],
        "payment": _admin_payment_payload(payment),
        "invoice": {
            "id": invoice.id if invoice else None,
            "invoice_no": invoice.invoice_no if invoice else None,
            "status": invoice.status if invoice else None,
            "billing_period_start": invoice.billing_period_start if invoice else None,
            "billing_period_end": invoice.billing_period_end if invoice else None,
        },
        "subscription": _sub_payload(sub) if sub else None,
    }


@router.post("/payments/{payment_id}/reject")
async def admin_reject_payment(
    payment_id: int,
    payload: RejectPaymentRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("billing.reject_payment")),
):
    payment = (await db.execute(
        select(Payment).where(Payment.id == payment_id, Payment.is_deleted == False)  # noqa: E712
    )).scalar_one_or_none()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    try:
        payment = await payment_requests.reject_request(
            db, payment, rejected_by=current_user.id, reason=payload.reason
        )
    except payment_requests.PaymentRequestError as exc:
        raise _payment_request_http_error(exc)

    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="billing",
        action="reject",
        record_id=payment.id,
        record_identifier=payment.invoice.invoice_no if payment.invoice else None,
        new_values={
            "payment_id": payment.id,
            "invoice_id": payment.invoice_id,
            "amount": float(payment.amount),
            "reason": payload.reason,
        },
        request=request,
        status_code=200,
    )
    try:
        from app.services.billing_notifications import notify_house

        house = (await db.execute(select(House).where(House.id == payment.house_id))).scalar_one_or_none()
        if house:
            await notify_house(db, house, "payment_rejected", invoice=payment.invoice)
    except Exception as exc:  # notification failure must not undo the rejection
        logger.warning("payment rejection notification failed: %s", exc)

    return {"success": True, "payment": _admin_payment_payload(payment)}


class RequestInfoPaymentRequest(BaseModel):
    reason: Optional[str] = None


@router.post("/payments/{payment_id}/request-info")
async def admin_request_info_payment(
    payment_id: int,
    payload: RequestInfoPaymentRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("billing.approve_payment")),
):
    """Flag a pending payment as needing more information from the customer.

    Moves the payment to the NEEDS_INFO state. The invoice stays open; when the
    customer resubmits, the new pending payment supersedes this one.
    """
    payment = (await db.execute(
        select(Payment).where(Payment.id == payment_id, Payment.is_deleted == False)  # noqa: E712
    )).scalar_one_or_none()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    try:
        payment = await payment_requests.request_info(
            db, payment, requested_by=current_user.id, reason=payload.reason
        )
    except payment_requests.PaymentRequestError as exc:
        raise _payment_request_http_error(exc)

    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="billing",
        action="needs_info",
        record_id=payment.id,
        record_identifier=payment.invoice.invoice_no if payment.invoice else None,
        old_values={"status": "pending"},
        new_values={
            "payment_id": payment.id,
            "invoice_id": payment.invoice_id,
            "amount": float(payment.amount),
            "reason": payload.reason,
        },
        request=request,
        status_code=200,
    )
    try:
        from app.services.billing_notifications import notify_house

        house = (await db.execute(select(House).where(House.id == payment.house_id))).scalar_one_or_none()
        if house:
            await notify_house(db, house, "payment_needs_info", invoice=payment.invoice)
    except Exception as exc:
        logger.warning("payment needs_info notification failed: %s", exc)
    return {"success": True, "payment": _admin_payment_payload(payment)}


# ---------------------------------------------------------------------------
# Refunds (admin only, two-step: record -> confirm the money was returned)
# ---------------------------------------------------------------------------

REFUND_ACTIVE_STATUSES = ("processing", "succeeded")


class RefundCreateRequest(BaseModel):
    amount: Optional[float] = None
    reason: Optional[str] = None


class RefundRejectRequest(BaseModel):
    reason: Optional[str] = None


def _required_reason(reason: Optional[str]) -> str:
    cleaned = (reason or "").strip()
    if len(cleaned) < 3:
        raise HTTPException(
            status_code=422,
            detail={
                "code": "REASON_REQUIRED",
                "message": "A reason is required for this action",
                "fields": {"reason": "Enter at least 3 characters"},
            },
        )
    return cleaned[:500]


async def _reserved_refund_amount(
    db: AsyncSession, payment_id: int, *, exclude_id: Optional[int] = None
) -> Decimal:
    """Amount already reserved by processing/succeeded refunds."""
    query = select(func.coalesce(func.sum(Refund.amount), 0)).where(
        Refund.payment_id == payment_id,
        Refund.status.in_(REFUND_ACTIVE_STATUSES),
        Refund.is_deleted == False,  # noqa: E712
    )
    if exclude_id is not None:
        query = query.where(Refund.id != exclude_id)
    return Decimal(str((await db.execute(query)).scalar_one() or 0)).quantize(Decimal("0.01"))


def _refund_payload(refund: Refund) -> dict:
    return {
        "id": refund.id,
        "payment_id": refund.payment_id,
        "amount": float(refund.amount),
        "currency": refund.currency,
        "status": refund.status,
        "reason": refund.reason,
        "refunded_by": refund.refunded_by,
        "refunded_at": refund.refunded_at,
        "created_at": refund.created_at,
    }


@router.post("/payments/{payment_id}/refund", status_code=201)
async def admin_create_refund(
    payment_id: int,
    payload: RefundCreateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("billing.refund")),
):
    """Record a refund that is being returned offline (status ``processing``).

    The payment status only changes when the refund is confirmed complete, so a
    refund is never reported as done before the money actually went back.
    """
    payment = (await db.execute(
        select(Payment).where(Payment.id == payment_id, Payment.is_deleted == False)  # noqa: E712
    )).scalar_one_or_none()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    if payment.status not in (PAYMENT_STATUS_SUCCEEDED, PAYMENT_STATUS_PARTIALLY_REFUNDED):
        raise HTTPException(
            status_code=400,
            detail="Only an approved payment can be refunded",
        )

    reason = _required_reason(payload.reason)
    reserved = await _reserved_refund_amount(db, payment.id)
    remaining = Decimal(payment.amount).quantize(Decimal("0.01")) - reserved
    try:
        amount = (
            remaining if payload.amount is None
            else Decimal(str(payload.amount)).quantize(Decimal("0.01"))
        )
    except (InvalidOperation, ValueError):
        raise HTTPException(
            status_code=422,
            detail={
                "code": "INVALID_REFUND_AMOUNT",
                "message": "Invalid refund amount",
                "fields": {"amount": "Enter a valid amount"},
            },
        )
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Nothing left to refund on this payment")
    if amount > remaining:
        raise HTTPException(
            status_code=400,
            detail=f"Refund exceeds the refundable amount ({remaining} {payment.currency})",
        )

    refund = Refund(
        house_id=payment.house_id,
        payment_id=payment.id,
        invoice_id=payment.invoice_id,
        amount=amount,
        currency=payment.currency,
        reason=reason,
        status="processing",
        refunded_by=current_user.id,
    )
    db.add(refund)
    await db.commit()
    await db.refresh(refund)

    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="billing",
        action="refund",
        record_id=payment.id,
        record_identifier=payment.invoice.invoice_no if payment.invoice else None,
        new_values={
            "refund_id": refund.id,
            "payment_id": payment.id,
            "amount": float(amount),
            "currency": payment.currency,
            "reason": reason,
            "status": refund.status,
        },
        request=request,
        status_code=201,
    )
    return {"success": True, "data": _refund_payload(refund)}


@router.post("/refunds/{refund_id}/complete")
async def admin_complete_refund(
    refund_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("billing.refund")),
):
    """Confirm the money was actually returned; only now the payment changes."""
    refund = (await db.execute(
        select(Refund).where(Refund.id == refund_id, Refund.is_deleted == False)  # noqa: E712
    )).scalar_one_or_none()
    if not refund:
        raise HTTPException(status_code=404, detail="Refund not found")
    if refund.status != "processing":
        raise HTTPException(status_code=409, detail=f"Refund is already {refund.status}")

    # Lock the payment row (bare id select: FOR UPDATE cannot sit on the
    # eager-loaded outer joins), then read the fresh instance.
    locked_id = (await db.execute(
        select(Payment.id).where(Payment.id == refund.payment_id).with_for_update()
    )).scalar_one_or_none()
    if locked_id is None:
        raise HTTPException(status_code=404, detail="Payment not found")
    payment = (await db.execute(
        select(Payment).where(Payment.id == locked_id)
    )).scalar_one()

    refund.status = "succeeded"
    refund.refunded_at = now_naive()
    await db.flush()

    total_refunded = Decimal(str((await db.execute(
        select(func.coalesce(func.sum(Refund.amount), 0)).where(
            Refund.payment_id == payment.id,
            Refund.status == "succeeded",
            Refund.is_deleted == False,  # noqa: E712
        )
    )).scalar_one() or 0)).quantize(Decimal("0.01"))
    payment.status = (
        PAYMENT_STATUS_REFUNDED
        if total_refunded >= Decimal(payment.amount)
        else PAYMENT_STATUS_PARTIALLY_REFUNDED
    )
    await db.commit()
    await db.refresh(refund)
    await db.refresh(payment)

    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="billing",
        action="refund_completed",
        record_id=payment.id,
        record_identifier=payment.invoice.invoice_no if payment.invoice else None,
        new_values={
            "refund_id": refund.id,
            "payment_id": payment.id,
            "amount": float(refund.amount),
            "payment_status": payment.status,
            "total_refunded": float(total_refunded),
        },
        request=request,
        status_code=200,
    )
    return {
        "success": True,
        "data": _refund_payload(refund),
        "payment_status": payment.status,
    }


@router.post("/refunds/{refund_id}/reject")
async def admin_reject_refund(
    refund_id: int,
    payload: RefundRejectRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("billing.refund")),
):
    """Mark a refund attempt failed (e.g. the transfer bounced)."""
    refund = (await db.execute(
        select(Refund).where(Refund.id == refund_id, Refund.is_deleted == False)  # noqa: E712
    )).scalar_one_or_none()
    if not refund:
        raise HTTPException(status_code=404, detail="Refund not found")
    if refund.status != "processing":
        raise HTTPException(status_code=409, detail=f"Refund is already {refund.status}")

    reason = _required_reason(payload.reason)
    refund.status = "failed"
    refund.reason = reason
    await db.commit()
    await db.refresh(refund)

    await log_activity(
        db=db,
        user_id=current_user.id,
        user_name=current_user.name,
        module="billing",
        action="refund_failed",
        record_id=refund.payment_id,
        new_values={
            "refund_id": refund.id,
            "payment_id": refund.payment_id,
            "amount": float(refund.amount),
            "reason": reason,
        },
        request=request,
        status_code=200,
    )
    return {"success": True, "data": _refund_payload(refund)}


# ---------------------------------------------------------------------------

@router.get("/legacy-subscriptions")
async def admin_list_legacy_subscriptions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("subscription.manage")),
):
    """Subscriptions with no plan attached (the old implicit free pass).

    Deny-by-default blocks these rows as ``SUBSCRIPTION_REQUIRED`` and the
    startup migration repairs them to the explicit ``legacy-unlimited`` plan.
    This endpoint exists so operators can find every remaining anomalous row in
    a deployment: in a healthy database it returns an empty list. Repair a row
    with ``PATCH /api/v1/admin/subscriptions/{id}`` (set ``package_id``).
    """
    rows = (await db.execute(
        select(HouseSubscription)
        .options(
            selectinload(HouseSubscription.house),
            selectinload(HouseSubscription.package),
        )
        .where(
            HouseSubscription.package_id.is_(None),
            HouseSubscription.is_deleted == False,  # noqa: E712
        )
        .order_by(HouseSubscription.id)
    )).scalars().all()

    if rows:
        logger.critical(
            "BILLING AUDIT: %s package-less subscription(s) need repair: %s",
            len(rows),
            ", ".join(f"sub={row.id} house={row.house_id}" for row in rows[:25]),
        )

    return {
        "success": True,
        "data": [_sub_payload(row) for row in rows],
        "total": len(rows),
        "note": (
            "Package-less subscriptions are blocked at runtime as 'no plan'. "
            "Attach a real plan before treating them as active."
        ),
    }
