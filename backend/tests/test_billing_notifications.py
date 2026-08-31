from decimal import Decimal

import pytest

from app.models.house import House
from app.services.billing_notifications import (
    SUPPORTED_KINDS,
    _amount,
    _send_email,
    _send_telegram,
    _send_whatsapp,
    build_message,
    notify_house,
)
from conftest import make_house, make_invoice, make_plan, make_sub


# ----------------------------------------------------------------------
# build_message
# ----------------------------------------------------------------------

async def test_build_message_all_supported_kinds(db, house, plan):
    sub = await make_sub(db, house.id, plan, trial_days=1)
    invoice = await make_invoice(db, sub, plan, amount=Decimal("5000.00"))
    for kind in SUPPORTED_KINDS:
        subject, text = build_message(kind, house, invoice=invoice, sub=sub)
        assert subject, f"{kind} should produce a subject"
        assert text, f"{kind} should produce a body"
        assert "Dear Test House" in text


async def test_build_message_contains_bengali(db, house, plan):
    sub = await make_sub(db, house.id, plan, trial_days=1)
    invoice = await make_invoice(db, sub, plan)
    for kind in SUPPORTED_KINDS:
        _, text = build_message(kind, house, invoice=invoice, sub=sub)
        assert any(ord(c) > 0x7FF for c in text), f"{kind} text must include Bengali"

    # Bengali keywords present for invoice_issued
    _, text = build_message("invoice_issued", house, invoice=invoice, sub=sub)
    assert "৳" in text and "প্রদান" in text


async def test_build_message_unknown_kind(db, house, plan):
    sub = await make_sub(db, house.id, plan)
    assert build_message("nonsense", house, sub=sub) == ("", "")


async def test_build_message_no_sub_uses_plan_fallback(db, house, plan):
    subject, text = build_message("expired", house)
    assert "Subscription" in subject
    assert "Subscription" in text


async def test_build_message_grace_end_passed_as_soon(db, house, plan):
    sub = await make_sub(db, house.id, plan, status="past_due")
    sub.grace_period_end = None
    _, text = build_message("past_due", house, sub=sub)
    assert "soon" in text


def test_amount_formatting():
    assert _amount(Decimal("5000.00")) == "৳5,000.00"
    assert _amount(0) == "৳0.00"
    assert _amount(None) == "None"


# ----------------------------------------------------------------------
# per-channel guards (no config -> skip, never raise)
# ----------------------------------------------------------------------

async def test_send_email_no_address(db, house, plan):
    house.email = None
    assert await _send_email(house, "s", "t") is False


async def test_send_email_success_path(db, monkeypatch, house, plan):
    captured = {}
    monkeypatch.setattr(
        "app.utils.email.send_email",
        lambda to, subject, html: captured.update(to=to, subject=subject, html=html) or True,
    )
    assert await _send_email(house, "Hello", "Body") is True
    assert captured["to"] == house.email
    assert captured["subject"] == "Hello"
    assert "Body" in captured["html"]


async def test_send_email_exception_never_raises(db, monkeypatch, house, plan):
    def boom(*a, **k):
        raise RuntimeError("smtp down")

    monkeypatch.setattr("app.utils.email.send_email", boom)
    assert await _send_email(house, "s", "t") is False


async def test_send_telegram_no_chat_id(db, house, plan):
    house.telegram_chat_id = None
    assert await _send_telegram(db, house, "hi") is False


async def test_send_whatsapp_no_credentials(db, house, plan):
    house.wa_jwt_token = None
    house.wa_phone_number = None
    assert await _send_whatsapp(house, "hi") is False


# ----------------------------------------------------------------------
# notify_house dispatch
# ----------------------------------------------------------------------

async def test_notify_house_dispatches_all_channels(db, monkeypatch, house, plan):
    sent = []
    async def _email(h, s, t):
        sent.append("email")
        return True

    async def _telegram(s, h, t):
        sent.append("telegram")
        return True

    async def _whatsapp(h, t):
        sent.append("whatsapp")
        return True

    monkeypatch.setattr("app.services.billing_notifications._send_email", _email)
    monkeypatch.setattr("app.services.billing_notifications._send_telegram", _telegram)
    monkeypatch.setattr("app.services.billing_notifications._send_whatsapp", _whatsapp)

    result = await notify_house(db, house, "invoice_issued")
    assert result == {"sent": {"email": True, "telegram": True, "whatsapp": True}}
    assert sent == ["email", "telegram", "whatsapp"]


async def test_notify_house_single_channel_declines(db, monkeypatch, house, plan):
    sent = []

    async def _email(h, s, t):
        sent.append("email")
        return False

    async def _telegram(s, h, t):
        return False

    async def _whatsapp(h, t):
        return True

    monkeypatch.setattr("app.services.billing_notifications._send_email", _email)
    monkeypatch.setattr("app.services.billing_notifications._send_telegram", _telegram)
    monkeypatch.setattr("app.services.billing_notifications._send_whatsapp", _whatsapp)

    result = await notify_house(db, house, "invoice_issued")
    assert result == {"sent": {"email": False, "telegram": False, "whatsapp": True}}


async def test_notify_house_unknown_kind_no_channels(db, monkeypatch, house, plan):
    calls = []
    async def _email(h, s, t):
        calls.append("email")
        return True

    monkeypatch.setattr("app.services.billing_notifications._send_email", _email)
    result = await notify_house(db, house, "not_a_kind")
    assert result == {"sent": {}}
    assert calls == []