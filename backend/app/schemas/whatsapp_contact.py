from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from config.settings import settings

PHONE_HINT = "Enter a valid number, e.g. 01732547755 or +8801732547755"

# A reachable national number is 9-12 digits (Bangladesh mobile is 10, landline
# 8-10). Validating the national part rather than the whole string keeps the rule
# independent of the country code length.
NSN_MIN_DIGITS = 9
NSN_MAX_DIGITS = 12


def _digits_only(raw: str) -> str:
    return "".join(ch for ch in (raw or "") if ch.isdigit())


def normalize_whatsapp_phone(raw: str) -> str:
    """Convert a user-typed number into full international form (E.164, no ``+``).

    WhatsApp addresses chats as ``<international digits>@s.whatsapp.net``, and a
    national number that keeps its trunk prefix (``01732547755``) resolves to
    nothing. People type every shape though, so all of these must end up as the
    same stored value ``8801732547755``:

    ============================  ==================
    typed                        stored
    ============================  ==================
    ``01732547755``              ``8801732547755``
    ``+8801732547755``           ``8801732547755``
    ``008801732547755``          ``8801732547755``
    ``880-1732 547755``          ``8801732547755``
    ``1732547755``               ``8801732547755``
    ``(01732) 547755``           ``8801732547755``
    ============================  ==================

    Raises ``ValueError`` when the national part is implausibly short/long, or
    when the number looks like it belongs to another country (it neither carries
    the default country code nor a local trunk prefix) — guessing there would
    silently deliver reports to the wrong person.
    """
    digits = _digits_only(raw)
    cc = _digits_only(settings.DEFAULT_COUNTRY_CODE)

    if not digits:
        raise ValueError(PHONE_HINT)

    # "0088..." style international dialling prefix.
    if digits.startswith("00") and len(digits) > 2:
        digits = digits[2:]

    if not digits:
        raise ValueError(PHONE_HINT)

    # Already international: leave untouched.
    if cc and digits.startswith(cc) and len(digits) > len(cc):
        nsn = digits[len(cc):]
    # Local trunk prefix ("0..."): drop it, then add the country code.
    elif digits.startswith("0"):
        nsn = digits.lstrip("0")
    # National significant number without its trunk prefix (e.g. "1732547755").
    elif len(digits) == 10 and digits.startswith("1"):
        nsn = digits
    else:
        raise ValueError(PHONE_HINT)

    if not nsn or not NSN_MIN_DIGITS <= len(nsn) <= NSN_MAX_DIGITS:
        raise ValueError(PHONE_HINT)

    full = f"{cc}{nsn}"
    # E.164 caps at 15 digits.
    if len(full) > 15:
        raise ValueError(PHONE_HINT)
    return full


def phone_to_jid(phone: str) -> str:
    """Address an individual WhatsApp chat the way the delivery gateway expects."""
    return f"{phone}@s.whatsapp.net"


class WhatsAppContactCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    phone_number: str = Field(..., min_length=1, max_length=32)
    note: Optional[str] = Field(None, max_length=500)
    is_active: bool = True

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: str) -> str:
        cleaned = (v or "").strip()
        if not cleaned:
            raise ValueError("Contact name is required")
        return cleaned

    @field_validator("phone_number")
    @classmethod
    def _clean_phone(cls, v: str) -> str:
        return normalize_whatsapp_phone(v)

    @field_validator("note")
    @classmethod
    def _strip_note(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        cleaned = v.strip()
        return cleaned or None


class WhatsAppContactUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    phone_number: Optional[str] = Field(None, min_length=1, max_length=32)
    note: Optional[str] = Field(None, max_length=500)
    is_active: Optional[bool] = None

    @field_validator("name")
    @classmethod
    def _strip_name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("Contact name is required")
        return cleaned

    @field_validator("phone_number")
    @classmethod
    def _clean_phone(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        return normalize_whatsapp_phone(v)

    @field_validator("note")
    @classmethod
    def _strip_note(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        cleaned = v.strip()
        return cleaned or None


class WhatsAppContactSchema(BaseModel):
    id: int
    house_id: int
    name: str
    phone_number: str
    jid: str
    note: Optional[str] = None
    is_active: bool
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)
