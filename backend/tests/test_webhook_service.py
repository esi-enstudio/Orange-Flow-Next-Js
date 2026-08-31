import pytest

from app.models.payment import Payment, PaymentAttempt
from app.models.webhook_event import WebhookEvent
from app.services.payment import get_gateway
from app.services.webhook_service import process_ipn, get_or_create_event, _event_identity
from sqlalchemy import select

from conftest import make_house, make_plan, make_sub, make_invoice, make_attempt


@pytest.fixture
def gateway(monkeypatch):
    g = get_gateway("sslcommerz")
    assert g is not None, "sslcommerz provider must be registered"
    state = {"valid_result": True}
    calls = []

    async def _validate(**kwargs):
        calls.append(kwargs)
        if state["valid_result"]:
            return {"valid": True, "status": "VALIDATED", "data": {"amount": str(kwargs.get("amount") or 0), "error": ""}}
        return {"valid": False, "status": "INVALID_TRANSACTION", "data": {"amount": "0.00", "error": "not found"}}

    async def _invalid(**kwargs):
        return {"valid": False, "status": "INVALID_TRANSACTION", "data": {"amount": "0.00", "error": "not found"}}

    monkeypatch.setattr(g, "validate_transaction", _validate)
    monkeypatch.setattr(g, "verify_signature", lambda payload: True)
    monkeypatch.setattr(g, "sanitize_payload", lambda payload: dict(payload))
    g._state = state
    g._calls = calls
    g._invalid_fn = _invalid
    return g


@pytest.fixture
def recorded_notifications(monkeypatch):
    calls = []

    async def fake_notify(db, house, kind, invoice=None, sub=None):
        calls.append((house.id, kind))
        return {"sent": {}}

    monkeypatch.setattr("app.services.billing_notifications.notify_house", fake_notify)
    return calls


def _payload(tran_id, status="VALIDATED", **extra) -> dict:
    payload = {
        "tran_id": tran_id,
        "val_id": f"VAL-{tran_id}",
        "status": status,
        "amount": "5000.00",
        "card_type": "VISA",
    }
    payload.update(extra)
    return payload


async def test_event_identity_uses_tran_id():
    assert _event_identity("sslcommerz", {"tran_id": "T1", "x": "1"}) == "T1"
    assert _event_identity("sslcommerz", {"value_a": "VA1"}) == "VA1"
    assert _event_identity("sslcommerz", {"foo": 1, "bar": "b"}) != ""
    assert len(_event_identity("sslcommerz", {})) == 40


async def test_get_or_create_event_returns_same_row(db):
    a = await get_or_create_event(db, "sslcommerz", "ID-1", "POST", {"tran_id": "ID-1"}, 200, 10)
    b = await get_or_create_event(db, "sslcommerz", "ID-1", "POST", {"tran_id": "ID-1"}, 200, 10)
    assert a.id == b.id


async def test_process_ipn_unknown_provider(db):
    result = await process_ipn(db, "nonexistent", {}, duration_ms=5)
    assert result == {"processed": False, "reason": "unknown_provider"}
    events = (await db.execute(select(WebhookEvent))).scalars().all()
    assert len(events) == 1
    assert events[0].status == "failed"


async def test_process_ipn_duplicate_event(db, house, plan, gateway, recorded_notifications):
    sub = await make_sub(db, house.id, plan, trial_days=0)
    invoice = await make_invoice(db, sub, plan)
    attempt = await make_attempt(db, invoice, gateway_tran_id="TR-DUP")
    payload = _payload("TR-DUP")
    first = await process_ipn(db, "sslcommerz", payload, duration_ms=5)
    assert first["processed"] is True
    assert first["reason"] == "payment_confirmed"
    second = await process_ipn(db, "sslcommerz", payload, duration_ms=5)
    assert second == {"processed": True, "reason": "duplicate"}
    events = (await db.execute(select(WebhookEvent))).scalars().all()
    assert len(events) == 1


async def test_process_ipn_signature_mismatch(db, house, plan, gateway, monkeypatch):
    gateway.verify_signature = lambda payload: False
    attempt = await make_attempt(db, (await make_invoice(db, (await make_sub(db, house.id, plan, trial_days=0)), plan)), gateway_tran_id="TR-SIG")
    result = await process_ipn(db, "sslcommerz", _payload("TR-SIG"), duration_ms=5)
    assert result == {"processed": False, "reason": "signature_mismatch"}
    event = (await db.execute(select(WebhookEvent))).scalars().first()
    assert event.status == "failed"
    assert event.reason == "signature_mismatch"


async def test_process_ipn_unknown_transaction(db, house, plan, gateway, recorded_notifications):
    result = await process_ipn(db, "sslcommerz", _payload("TR-UNKNOWN"), duration_ms=5)
    assert result == {"processed": True, "reason": "unknown_transaction"}
    event = (await db.execute(select(WebhookEvent))).scalars().first()
    assert event.reason == "unknown_transaction"


async def test_process_ipn_ignored_status(db, house, plan, gateway, recorded_notifications):
    sub = await make_sub(db, house.id, plan, trial_days=0)
    invoice = await make_invoice(db, sub, plan)
    attempt = await make_attempt(db, invoice, gateway_tran_id="TR-IGNORED")
    result = await process_ipn(db, "sslcommerz", _payload("TR-IGNORED", status="FAILED"), duration_ms=5)
    assert result == {"processed": True, "reason": "ignored"}
    await db.refresh(attempt)
    assert attempt.status == "failed"
    event = (await db.execute(select(WebhookEvent))).scalars().first()
    assert event.reason == "ignored"


async def test_process_ipn_success_pays_invoice_and_activates(db, house, plan, gateway, recorded_notifications):
    sub = await make_sub(db, house.id, plan, trial_days=0, status="trialing")
    invoice = await make_invoice(db, sub, plan)
    attempt = await make_attempt(db, invoice, gateway_tran_id="TR-OK")
    result = await process_ipn(db, "sslcommerz", _payload("TR-OK"), duration_ms=5)
    assert result == {"processed": True, "reason": "payment_confirmed"}

    paid = (await db.execute(select(Payment).where(Payment.gateway_tran_id == "TR-OK"))).scalar_one()
    assert paid.invoice_id == invoice.id
    assert paid.status == "succeeded"
    assert paid.gateway == "sslcommerz"

    await db.refresh(attempt)
    assert attempt.status == "success"

    event = (await db.execute(select(WebhookEvent))).scalars().first()
    assert event.status == "processed"
    assert event.reason == "payment_confirmed"
    assert event.signature_valid is True

    assert invoice.status == "paid"
    assert sub.status == "active"
    assert recorded_notifications == [(house.id, "payment_succeeded")]


async def test_process_ipn_validation_failed(db, house, plan, gateway, recorded_notifications):
    sub = await make_sub(db, house.id, plan, trial_days=0)
    invoice = await make_invoice(db, sub, plan)
    attempt = await make_attempt(db, invoice, gateway_tran_id="TR-BADVALID")
    gateway._state["valid_result"] = False
    result = await process_ipn(db, "sslcommerz", _payload("TR-BADVALID"), duration_ms=5)
    assert result == {"processed": False, "reason": "validation_failed"}
    await db.refresh(attempt)
    assert attempt.status == "failed"
    assert "order validation failed" in attempt.error_reason
    event = (await db.execute(select(WebhookEvent))).scalars().first()
    assert event.status == "failed"
    assert event.reason == "validation_failed"


async def test_process_ipn_duplicate_payment_no_second_row(db, house, plan, gateway, recorded_notifications):
    sub = await make_sub(db, house.id, plan, trial_days=0)
    invoice = await make_invoice(db, sub, plan)
    await make_attempt(db, invoice, gateway_tran_id="TR-DUP2")
    first = await process_ipn(db, "sslcommerz", _payload("TR-DUP2"), duration_ms=5)
    assert first["processed"] is True
    payments = (await db.execute(select(Payment))).scalars().all()
    assert len(payments) == 1
    second = await process_ipn(db, "sslcommerz", _payload("TR-DUP2"), duration_ms=5)
    # second call: event already processed -> duplicate path handles it
    assert second["processed"] is True
    payments = (await db.execute(select(Payment))).scalars().all()
    assert len(payments) == 1