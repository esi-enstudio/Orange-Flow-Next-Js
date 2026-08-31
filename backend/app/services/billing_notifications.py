"""Billing notifications (email / WhatsApp / Telegram).

Best-effort multi-channel delivery to a house for billing events:
  - invoice_issued       -> new invoice to pay
  - payment_succeeded    -> payment receipt / activation
  - trial_ending         -> trial ends soon
  - past_due             -> payment overdue
  - expired              -> subscription expired

Each channel is independent and never raises into the caller.
"""

import logging
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.house import House
from app.models.invoice import Invoice
from app.models.subscription import HouseSubscription
from config.settings import settings

logger = logging.getLogger(__name__)

SUPPORTED_KINDS = ("invoice_issued", "payment_succeeded", "trial_ending", "past_due", "expired")


def _amount(value) -> str:
    try:
        return f"৳{float(value):,.2f}"
    except (TypeError, ValueError):
        return str(value)


def build_message(kind: str, house: House, invoice=None, sub=None) -> tuple:
    """Returns (subject, text) for the event kind."""
    plan = sub.package.name if sub and sub.package else "Subscription"
    if kind == "invoice_issued":
        amount = _amount(invoice.total if invoice else 0)
        due = (invoice.due_date.strftime("%d %b %Y") if invoice and invoice.due_date else "soon")
        subj = f"[OrangeFlow] Invoice {invoice.invoice_no if invoice else ''} — {plan}"
        text = (
            f"Dear {house.name},\n\n"
            f"A new invoice ({invoice.invoice_no if invoice else ''}) of {amount} "
            f"has been issued for your {plan} subscription.\n"
            f"Due date: {due}.\nPlease pay to keep your services active.\n\n"
            f"অর্ডার নং: {invoice.invoice_no if invoice else ''}\n"
            f"মোট পরিমাণ: {amount}\nপ্রদানের শেষ তারিখ: {due}\n"
            f"আপনার সাবস্ক্রিপশন সচল রাখতে সময়মতো পেমেন্ট করুন।\n\n— OrangeFlow"
        )
    elif kind == "payment_succeeded":
        amount = _amount(invoice.total if invoice else 0)
        subj = f"[OrangeFlow] Payment received {amount} — {plan}"
        text = (
            f"Dear {house.name},\n\n"
            f"We received your payment of {amount} for the {plan} subscription."
            f" Thank you! Your subscription is active.\n\n"
            f"আমরা আপনার {plan} সাবস্ক্রিপশনের জন্য {amount} পেমেন্ট পেয়েছি। ধন্যবাদ! "
            f"আপনার সাবস্ক্রিপশন সক্রিয় রয়েছে।\n\n— OrangeFlow"
        )
    elif kind == "trial_ending":
        text_end = (sub.trial_end.strftime("%d %b %Y") if sub and sub.trial_end else "soon")
        subj = f"[OrangeFlow] Your trial ends {text_end}"
        text = (
            f"Dear {house.name},\n\n"
            f"Your {plan} free trial ends on {text_end}. "
            f"Please pay your subscription invoice to continue uninterrupted.\n\n"
            f"আপনার {plan} ট্রায়াল {text_end} তারিখে শেষ হবে। "
            f"সাবস্ক্রিপশন চালু রাখতে ইনভয়েস পেমেন্ট করুন।\n\n— OrangeFlow"
        )
    elif kind == "past_due":
        end = (sub.grace_period_end.strftime("%d %b %Y") if sub and sub.grace_period_end else "soon")
        subj = f"[OrangeFlow] Payment overdue — {plan}"
        text = (
            f"Dear {house.name},\n\n"
            f"Your {plan} subscription payment is overdue. "
            f"It will be deactivated on {end} unless paid.\n\n"
            f"আপনার {plan} সাবস্ক্রিপশনের পেমেন্ট বকেয়া রয়েছে। "
            f"{end} এর মধ্যে পরিশোধ না করলে এটি নিষ্ক্রিয় হবে।\n\n— OrangeFlow"
        )
    elif kind == "expired":
        subj = f"[OrangeFlow] Subscription expired — {plan}"
        text = (
            f"Dear {house.name},\n\n"
            f"Your {plan} subscription has expired. "
            f"Please renew to regain full access.\n\n"
            f"আপনার {plan} সাবস্ক্রিপশন মেয়াদোত্তীর্ণ হয়েছে। পুনরায় চালু করতে রিনিউ করুন।\n\n— OrangeFlow"
        )
    else:
        return "", ""
    return subj, text


async def _send_email(house, subject, text):
    try:
        from app.utils.email import send_email
        if house.email:
            html = text.replace("\n", "<br/>")
            send_email(house.email, subject, f"<div style='font-family:Arial;line-height:1.6'>{html}</div>")
            return True
    except Exception as exc:
        logger.warning("notify email failed for house %s: %s", house.id, exc)
    return False


async def _send_telegram(db: AsyncSession, house, text):
    if not house.telegram_chat_id:
        return False
    try:
        from app.services.telegram_service import resolve_house_tg_bot, send_message
        bot = await resolve_house_tg_bot(db, house)
        if bot and bot.bot_token:
            await send_message(bot.bot_token, house.telegram_chat_id, text)
            return True
    except Exception as exc:
        logger.warning("notify telegram failed for house %s: %s", house.id, exc)
    return False


async def _send_whatsapp(house, text):
    if not (house.wa_jwt_token and house.wa_phone_number):
        return False
    try:
        from app.services.whatsapp_service_client import WhatsAppServiceClient
        jid = house.wa_phone_number if "@" in house.wa_phone_number else f"{house.wa_phone_number}@s.whatsapp.net"
        client = WhatsAppServiceClient()
        await client.send_text(house.wa_jwt_token, jid, text)
        return True
    except Exception as exc:
        logger.warning("notify whatsapp failed for house %s: %s", house.id, exc)
    return False


async def notify_house(
    db: AsyncSession,
    house: House,
    kind: str,
    invoice: Optional[Invoice] = None,
    sub: Optional[HouseSubscription] = None,
) -> dict:
    if kind not in SUPPORTED_KINDS:
        return {"sent": {}}
    subject, text = build_message(kind, house, invoice=invoice, sub=sub)
    if not subject:
        return {"sent": {}}
    sent = {
        "email": await _send_email(house, subject, text),
        "telegram": await _send_telegram(db, house, text),
        "whatsapp": await _send_whatsapp(house, text),
    }
    logger.info("billing notify %s -> house %s: %s", kind, house.id, sent)
    return {"sent": sent}