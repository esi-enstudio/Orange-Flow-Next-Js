"""Recharge Report image (WhatsApp delivery): A4 landscape pagination.

A4 landscape is the maximum page size: a page packed to full keeps the exact A4
landscape ratio, while a page whose content does not fill it shrinks to its
content height, so small houses yield short images instead of tall white voids.
A house with many members spills onto extra pages; the multi-photo image-mode
send path is shared with every paginated report and covered in
test_ga_live_image_pagination.py.
"""
from datetime import date
from io import BytesIO

from PIL import Image

from app.services.recharge_whatsapp_image import (
    PAGE_H,
    PAGE_W,
    _render_image,
    _scale,
)

TODAY = date(2026, 10, 16)
TITLE = "Recharge Report"
SUMMARY = {
    "days_remaining": 12,
    "monthly_target": 500000,
    "achievement": 210000,
    "remaining": 290000,
    "daily_required": 24167,
    "daily_average": 14000,
    "projection": 420000,
    "yesterday_achievement": 18000,
}


def _supervisor(s: int) -> dict:
    return {
        "name": f"Supervisor {s}",
        "pool_number": f"0178{s:06d}",
        "target": 50000 + s * 1000,
        "achievement": 20000 + s * 500,
        "remaining": 30000 - s * 500,
        "projection": 40000 + s * 300,
        "yesterday_c2c": 1000 + s,
        "yesterday_c2s": 500 + s,
    }


def _rso(i: int) -> dict:
    return {
        "name": f"RSO {i}",
        "itop_number": f"19157{i:05d}",
        "target": 10000 + i * 100,
        "achievement": 4000 + i * 50,
        "remaining": 6000 - i * 50,
        "projection": 8000 + i * 30,
        "yesterday_c2c": 200 + i,
        "yesterday_c2s": 100 + i,
        "yesterday_transaction_count": 5 + i,
    }


def _dashboard(n_sup: int, n_rso: int) -> dict:
    return {
        "summary": SUMMARY,
        "supervisor_performance": [_supervisor(s) for s in range(n_sup)],
        "rso_performance": [_rso(i) for i in range(n_rso)],
    }


def _render(dashboard: dict) -> list[bytes]:
    with _scale.temp(1):  # native design units: one page is PAGE_W x PAGE_H
        return _render_image("Test House", "H001", dashboard, TODAY, TITLE)


def _sizes(pages: list[bytes]) -> list[tuple[int, int]]:
    return [Image.open(BytesIO(p)).size for p in pages]


async def test_small_house_page_hugs_its_content():
    pages = _render(_dashboard(1, 2))
    assert len(pages) == 1
    (w, h), = _sizes(pages)
    assert w == PAGE_W
    # Landscape and content-hugging: far shorter than a full A4 sheet, but not
    # a sliver.
    assert w > h
    assert 300 < h < PAGE_H * 0.7


async def test_many_members_split_onto_extra_a4_landscape_pages():
    sizes = _sizes(_render(_dashboard(8, 50)))
    assert len(sizes) > 1
    assert all(w == PAGE_W and h <= PAGE_H for w, h in sizes)
    # A fully packed page keeps the exact A4 landscape sheet (297x210 ratio)...
    assert sizes[0] == (PAGE_W, PAGE_H)
    assert abs(PAGE_W / PAGE_H - 297 / 210) < 0.001
    assert all(h >= PAGE_H - 80 for _, h in sizes[:-1])
    # ...while the tail page hugs its (much shorter) remaining content.
    assert sizes[-1][1] < PAGE_H - 80


async def test_empty_house_yields_one_short_page():
    pages = _render(
        {"summary": SUMMARY, "supervisor_performance": [], "rso_performance": []}
    )
    (w, h), = _sizes(pages)
    assert w == PAGE_W
    assert 0 < h < 400
