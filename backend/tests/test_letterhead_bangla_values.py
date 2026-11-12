"""Letterhead placeholders prefer the Bangla fields, English falls back."""

from datetime import date

from app.models.house import House
from app.services import house_letterhead
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


def test_house_fields_have_placeholders():
    for key in (
        "house_name",
        "house_address",
        "proprietor_name",
        "proprietor_contact",
        "poc_name",
        "poc_mobile",
    ):
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
    assert values["house_name"] == "House"
    assert values["house_address"] == "Address"
    assert values["proprietor_name"] == "Owner"
    assert values["proprietor_contact"] == "017"


def test_employee_designations_use_full_titles():
    for employee_type, expected in (
        ("rso", "RSO (Retail Sales Officer)"),
        ("bp", "BP (Brand Promotor)"),
    ):
        values = _base_values(
            _house(),
            {"employee_type": employee_type},
            date(2026, 11, 12),
        )
        assert values["designation"] == expected


def test_bangla_house_values_win():
    house = House(
        id=1,
        code="H1",
        name="Patwary Telecom",
        name_bn="পাটোয়ারী টেলিকম",
        address="Station Road",
        address_bn="স্টেশন রোড",
        proprietor_name="Owner",
        proprietor_name_bn="স্বত্বাধিকারী",
        proprietor_contact="017",
        proprietor_contact_bn="০১৭",
        poc_name="POC",
        poc_name_bn="পিওসি",
        poc_mobile="018",
        poc_mobile_bn="০১৮",
    )

    values = _base_values(house, {}, date(2026, 11, 12))

    assert values["house_name"] == "পাটোয়ারী টেলিকম"
    assert values["house_address"] == "স্টেশন রোড"
    assert values["proprietor_name"] == "স্বত্বাধিকারী"
    assert values["proprietor_contact"] == "০১৭"
    assert values["poc_name"] == "পিওসি"
    assert values["poc_mobile"] == "০১৮"


def test_serialize_exposes_bangla_first_house_values():
    house = House(
        id=1,
        code="H1",
        name="Patwary Telecom",
        name_bn="পাটোয়ারী টেলিকম",
        poc_mobile="018",
    )

    values = house_letterhead.serialize(house)["values"]

    assert values["house_name"] == "পাটোয়ারী টেলিকম"
    assert values["poc_mobile"] == "018"
