"""Admin-only cross-house subscription & billing management.

All endpoints require subscription.manage / billing.manage — granted only to
admin roles (Super Admin / Admin). Non-admin roles are denied even if they
hold subscription.view.
"""

import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.routers.deps import get_db, has_any_permission, has_permission
from app.models.house import House
from app.models.invoice import (
    Invoice, INVOICE_STATUS_PAID, INVOICE_STATUS_ISSUED, INVOICE_STATUS_UNPAID, INVOICE_STATUS_VOID,
)
from app.models.payment import Payment
from app.models.subscription import HouseSubscription
from app.models.user import User
from app.services import invoice_pdf, manual_payment
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
        "paid_at": p.paid_at, "created_at": p.created_at,
    } for p in result.scalars().unique().all()]
    total_pages = (total + per_page - 1) // per_page
    return {"success": True, "data": rows, "pagination": {
        "page": page, "per_page": per_page, "total": total,
        "total_pages": total_pages, "has_next": page < total_pages, "has_prev": page > 1,
    }}


# ---------------------------------------------------------------------------
# Legacy / anomalous subscriptions (fail-open audit surface)
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
