"""Admin-only cross-house subscription & billing management.

All endpoints require subscription.manage / billing.manage — granted only to
admin roles (Super Admin / Admin). Non-admin roles are denied even if they
hold subscription.view.
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.routers.deps import get_db, has_permission
from app.models.house import House
from app.models.invoice import (
    Invoice, INVOICE_STATUS_PAID, INVOICE_STATUS_ISSUED, INVOICE_STATUS_UNPAID, INVOICE_STATUS_VOID,
)
from app.models.payment import Payment
from app.models.subscription import HouseSubscription
from app.models.webhook_event import WebhookEvent
from app.models.user import User
from app.services import subscription_service as subsvc
from app.services import entitlement
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
    )
    return {"success": True, "invoice": {"id": invoice.id, "invoice_no": invoice.invoice_no, "total": float(invoice.total)}}


# ---------------------------------------------------------------------------
# Invoices (admin-managed / offline payments)
# ---------------------------------------------------------------------------

class MarkPaidRequest(BaseModel):
    gateway_tran_id: Optional[str] = None
    amount: Optional[float] = None
    note: Optional[str] = None


@router.post("/invoices/{invoice_id}/mark-paid")
async def admin_mark_invoice_paid(
    invoice_id: int,
    payload: MarkPaidRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("billing.manage")),
):
    """Authoritative offline/manual payment recording."""
    invoice = (await db.execute(
        select(Invoice).where(Invoice.id == invoice_id)
    )).scalar_one_or_none()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if invoice.status == INVOICE_STATUS_PAID:
        return {"success": True, "already_paid": True}

    from app.models.payment import Payment, PAYMENT_STATUS_SUCCEEDED
    payment = Payment(
        house_id=invoice.house_id,
        invoice_id=invoice.id,
        subscription_id=invoice.subscription_id,
        amount=invoice.total,
        currency=invoice.currency,
        status=PAYMENT_STATUS_SUCCEEDED,
        gateway="manual",
        gateway_tran_id=payload.gateway_tran_id or f"MANUAL-{invoice.invoice_no}-{current_user.id}",
        paid_at=now_naive(),
        payment_meta={"note": payload.note or f"Marked paid by admin {current_user.id}"},
    )
    db.add(payment)
    await subsvc.mark_invoice_paid(db, invoice, gateway_tran_id=payment.gateway_tran_id, changed_via="admin")
    try:
        from app.models.house import House
        from app.services.billing_notifications import notify_house
        house = (await db.execute(select(House).where(House.id == invoice.house_id))).scalar_one_or_none()
        if house:
            await notify_house(db, house, "payment_succeeded", invoice=invoice, sub=invoice.subscription)
    except Exception as exc:
        logger.warning("offline payment notification failed: %s", exc)
    return {"success": True, "invoice_status": "paid"}


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
# Payments + webhook events
# ---------------------------------------------------------------------------

@router.get("/payments")
async def admin_list_payments(
    page: int = 1,
    per_page: int = 20,
    status: Optional[str] = None,
    house_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("payments.manage")),
):
    filters = [Payment.is_deleted == False]  # noqa: E712
    if status:
        filters.append(Payment.status == status)
    if house_id:
        filters.append(Payment.house_id == house_id)
    per_page = max(1, min(per_page, 100))
    total = (await db.execute(select(func.count(Payment.id)).where(*filters))).scalar_one()
    result = await db.execute(
        select(Payment).options(selectinload(Payment.house)).where(*filters).order_by(Payment.id.desc())
        .offset((page - 1) * per_page).limit(per_page)
    )
    rows = [{
        "id": p.id, "house_id": p.house_id, "house_name": p.house.name if p.house else None,
        "amount": float(p.amount), "currency": p.currency, "status": p.status,
        "gateway": p.gateway, "gateway_tran_id": p.gateway_tran_id,
        "card_type": p.card_type, "paid_at": p.paid_at, "created_at": p.created_at,
    } for p in result.scalars().unique().all()]
    total_pages = (total + per_page - 1) // per_page
    return {"success": True, "data": rows, "pagination": {
        "page": page, "per_page": per_page, "total": total,
        "total_pages": total_pages, "has_next": page < total_pages, "has_prev": page > 1,
    }}


@router.get("/webhook-events")
async def admin_list_webhook_events(
    page: int = 1,
    per_page: int = 20,
    status: Optional[str] = None,
    provider: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("webhooks.view")),
):
    filters = []
    if status:
        filters.append(WebhookEvent.status == status)
    if provider:
        filters.append(WebhookEvent.provider == provider)
    from app.utils.access_control import is_admin_user
    sensitive = is_admin_user(current_user)

    per_page = max(1, min(per_page, 100))
    total = (await db.execute(select(func.count(WebhookEvent.id)).where(*filters))).scalar_one()
    result = await db.execute(
        select(WebhookEvent).where(*filters).order_by(WebhookEvent.id.desc())
        .offset((page - 1) * per_page).limit(per_page)
    )
    rows = []
    for ev in result.scalars().all():
        rows.append({
            "id": ev.id, "provider": ev.provider, "event_id": ev.event_id,
            "event_type": ev.event_type, "status": ev.status, "reason": ev.reason,
            "processing_note": ev.processing_note, "status_code": ev.status_code,
            "signature_valid": ev.signature_valid,
            "ip_address": ev.ip_address if sensitive else (ev.ip_address[:8] + "..." if ev.ip_address else None),
            "error_message": ev.error_message, "processed_at": ev.processed_at,
            "created_at": ev.created_at,
        })
    total_pages = (total + per_page - 1) // per_page
    return {"success": True, "data": rows, "pagination": {
        "page": page, "per_page": per_page, "total": total,
        "total_pages": total_pages, "has_next": page < total_pages, "has_prev": page > 1,
    }}


@router.get("/webhook-events/{event_id}")
async def admin_webhook_event_detail(
    event_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(has_permission("webhooks.view")),
):
    ev = (await db.execute(select(WebhookEvent).where(WebhookEvent.id == event_id))).scalar_one_or_none()
    if not ev:
        raise HTTPException(status_code=404, detail="Webhook event not found")
    from app.utils.access_control import is_admin_user
    sensitive = is_admin_user(current_user)
    payload = ev.payload or {}
    if not sensitive:
        payload = {k: ("***" if k in ("verify_sign", "verify_key") else v) for k, v in payload.items()}
    return {"success": True, "data": {
        "id": ev.id, "provider": ev.provider, "event_id": ev.event_id,
        "event_type": ev.event_type, "status": ev.status, "reason": ev.reason,
        "method": ev.method, "status_code": ev.status_code, "duration_ms": ev.duration_ms,
        "ip_address": ev.ip_address if sensitive else "***",
        "signature_valid": ev.signature_valid, "payload": payload,
        "error_message": ev.error_message, "processed_at": ev.processed_at, "created_at": ev.created_at,
    }}    # noqa: E306