"""GA Live report image (WhatsApp delivery): A4 portrait pagination.

A4 portrait is the maximum page height: a page packed to full keeps the exact
A4 ratio, while a page whose content does not fill it shrinks to its content
height, so small houses yield short images instead of tall white voids. A house
with many members spills onto extra pages, and in image (photo) send mode every
page is delivered as its own photo.
"""
from datetime import date
from io import BytesIO
from types import SimpleNamespace

from PIL import Image

from app.models.whatsapp_schedule import WhatsAppSchedule
from app.services.ga_live_whatsapp_image import (
    PAGE_H,
    PAGE_W,
    _render_image,
    _temp_scale,
)
from app.services.whatsapp_schedule_service import _report_pages, _send_telegram_report
from conftest import make_house

HOUSE = SimpleNamespace(name="Test House", code="H001")
TODAY = date(2026, 10, 16)
SUMMARY = {
    "days_remaining": 12,
    "monthly_target": 12000,
    "achievement": 5432,
    "remaining": 6568,
    "daily_required_with_friday": 547,
    "supervisor_target_map": {},
}


def _rso(i: int) -> dict:
    target, ach = 100 + i * 3, 40 + i * 2
    return {
        "employee_id": 1000 + i,
        "name": f"RSO {i}",
        "itop_number": f"19157{i:05d}",
        "assisted_code": f"R3444{i:03d}",
        "target": target,
        "achievement": ach,
        "remaining": max(0, target - ach),
        "own_activation": 10 + i,
        "market_activation": 30 + i,
        "total_activation": ach,
    }


def _bp(i: int) -> dict:
    target, ach = 50 + i, 20 + i
    return {
        "employee_id": 2000 + i,
        "name": f"BP {i}",
        "pool_number": f"0157{i:06d}",
        "assisted_code": f"BP{i:03d}",
        "target": target,
        "achievement": ach,
        "remaining": max(0, target - ach),
        "own_activation": ach,
        "total_activation": ach,
    }


def _data(n_sup: int, n_rso: int, n_bp: int) -> dict:
    supervisors = []
    for s in range(n_sup):
        supervisors.append({
            "employee_id": 3000 + s,
            "name": f"Supervisor {s}",
            "pool_number": f"0178{s:06d}",
            "team_rso_ids": [1000 + i for i in range(s * 3, min(s * 3 + 3, n_rso))],
            "team_bp_ids": [2000 + i for i in range(s * 3, min(s * 3 + 3, n_bp))],
            "total_activation": 100 + s,
        })
    return {
        "summary": {"total_activations": 999},
        "supervisors": supervisors,
        "rsos": [_rso(i) for i in range(n_rso)],
        "bps": [_bp(i) for i in range(n_bp)],
    }


def _render(data: dict) -> list[bytes]:
    with _temp_scale(1):  # native design units: one page is PAGE_W x PAGE_H
        return _render_image(HOUSE, data, SUMMARY, TODAY)


def _sizes(pages: list[bytes]) -> list[tuple[int, int]]:
    return [Image.open(BytesIO(p)).size for p in pages]


async def test_small_house_page_hugs_its_content():
    pages = _render(_data(1, 3, 2))
    assert len(pages) == 1
    (w, h), = _sizes(pages)
    assert w == PAGE_W
    # Content-hugging: far shorter than a full A4 sheet, but not a sliver.
    assert 300 < h < PAGE_H * 0.6


async def test_many_members_split_onto_extra_a4_pages():
    sizes = _sizes(_render(_data(6, 30, 35)))
    assert len(sizes) > 1
    assert all(w == PAGE_W and h <= PAGE_H for w, h in sizes)
    # A fully packed page keeps the exact A4 portrait sheet (210x297 ratio)...
    assert sizes[0] == (PAGE_W, PAGE_H)
    assert abs(PAGE_H / PAGE_W - 297 / 210) < 0.001
    assert all(h >= PAGE_H - 80 for _, h in sizes[:-1])
    # ...while the tail page hugs its (much shorter) remaining content.
    assert sizes[-1][1] < PAGE_H - 80


async def test_empty_house_yields_one_short_page():
    pages = _render(
        {"summary": {"total_activations": 0}, "supervisors": [], "rsos": [], "bps": []}
    )
    (w, h), = _sizes(pages)
    assert w == PAGE_W
    assert 0 < h < 400


async def test_report_pages_wraps_single_png():
    assert _report_pages(b"png") == [b"png"]
    assert _report_pages([b"a", b"b"]) == [b"a", b"b"]


async def test_telegram_image_send_delivers_every_a4_page(db, monkeypatch):
    house = await make_house(db)
    house.telegram_chat_id = "123456"
    schedule = WhatsAppSchedule(
        house_id=house.id,
        schedule_type="daily",
        schedule_time="10:00",
        channel="telegram",
        whatsapp_chat_id="123456",
        whatsapp_chat_name="Test Group",
        report_type="ga_live",
        send_as="image",
    )
    db.add(schedule)
    await db.commit()

    sent: list[tuple[bytes, str]] = []

    async def fake_get_report_image(db_, report_type, house_id, **kw):
        return [b"page-1", b"page-2"]

    async def fake_resolve_bot(db_, house_):
        return SimpleNamespace(bot_token="tok", name="bot")

    async def fake_send_photo(token, chat_id, image_bytes, caption=""):
        sent.append((image_bytes, caption))
        return {"ok": True}

    monkeypatch.setattr(
        "app.services.whatsapp_schedule_service.get_report_image", fake_get_report_image
    )
    monkeypatch.setattr(
        "app.services.telegram_service.resolve_house_tg_bot", fake_resolve_bot
    )
    monkeypatch.setattr("app.services.telegram_service.send_photo", fake_send_photo)

    ok = await _send_telegram_report(db, schedule)

    assert ok is True
    # Every A4 page goes out as its own photo; caption only on the first.
    assert [p for p, _ in sent] == [b"page-1", b"page-2"]
    assert sent[0][1] != "" and sent[1][1] == ""
