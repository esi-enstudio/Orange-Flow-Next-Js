"""Letterhead placeholders prefer the Bangla employee fields, English falls back."""

from datetime import date

from app.models.house import House
from app.services.house_letterhead import BODY_PLACEHOLDERS
from app.services.resignation_pdf import _base_values


def _house() -> House:
    return House(
        id=1,
        code="H1",
        name="House",
        address="Address",
        proprietor_name="Owner",
        proprietor_contact="017",
    )


def test_bangla_employee_fields_have_placeholders():
    for key in ("employee_name", "fathers_name", "nid"):
        assert key in BODY_PLACEHOLDERS


def test_bangla_values_win_and_nid_keeps_bangla_digits():
    values = _base_values(
        _house(),
        {
            "employee_name": "Md Karim",
            "employee_name_bn": "মোঃ করিম",
            "fathers_name": "Md Rahim",
            "fathers_name_bn": "মোঃ রহিম",
            "nid": "1234567890123",
            "nid_bn": "১২৩৪৫৬৭৮৯০১২৩",
        },
        date(2026, 11, 12),
    )

    assert values["employee_name"] == "মোঃ করিম"
    assert values["fathers_name"] == "মোঃ রহিম"
    assert values["nid"] == "১২৩৪৫৬৭৮৯০১২৩"


def test_english_values_are_used_when_bangla_is_missing():
    values = _base_values(
        _house(),
        {"employee_name": "Md Karim", "fathers_name": "Md Rahim", "nid": "1234567890123"},
        date(2026, 11, 12),
    )

    assert values["employee_name"] == "Md Karim"
    assert values["fathers_name"] == "Md Rahim"
    assert values["nid"] == "১২৩৪৫৬৭৮৯০১২৩"
