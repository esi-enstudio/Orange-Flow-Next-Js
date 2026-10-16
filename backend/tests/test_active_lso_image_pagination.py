"""Active LSO Report image (WhatsApp delivery): layout and A4 pagination.

The image mirrors the dashboard (house summary + supervisor summary + the
"RSO Target vs Achievement · Retailer Count" table) and is laid out like the
Recharge report image: every page stays inside the exact A4 landscape sheet —
a page packed to full keeps the exact A4 landscape ratio, while a page whose
content does not fill it shrinks to its content height. A house with many rows
spills onto extra pages, repeating the (grouped) table header on continuation
pages; the multi-photo image-mode send path is shared with every paginated
report and covered in test_ga_live_image_pagination.py.
"""
from datetime import date
from io import BytesIO

from PIL import Image

from app.services.active_lso_whatsapp_image import (
    PAGE_H,
    PAGE_W,
    _render_image,
    _scale,
)

TODAY = date(2026, 10, 16)
DAYS = 7
COUNT_KEYS = [f"day_{i}" for i in range(DAYS)] + [
    "days_no_sales",
    "inactive_last_month",
    "reactivated",
]
PERIOD = {
    "start_date": "2026-10-01",
    "end_date": "2026-10-31",
    "active_threshold_days": DAYS,
    "active_threshold_amount": 2000,
}


def _rso(i: int) -> dict:
    return {
        "name": f"RSO {i:02d} Name",
        "supervisor_name": f"Supervisor {i % 4}",
        "target": 120 + i,
        "achieved": 80 + i,
        "ach_pct": 66.6,
        "remaining": 40 - i,
        "drr": 3,
        "daily_avg": 8.1,
        "projection": 250 + i,
        "status": "on_track" if i % 3 else "achieved",
        "retailer_count": 30 + i,
        "retailer_counts": {k: i for k in COUNT_KEYS},
    }


def _supervisor(name: str, rsos: list[dict]) -> dict:
    return {
        "supervisor_name": name,
        "rso_count": len(rsos),
        "retailer_count": sum(r["retailer_count"] for r in rsos),
        "target": sum(r["target"] for r in rsos),
        "achieved": sum(r["achieved"] for r in rsos),
        "ach_pct": 66.6,
        "remaining": sum(r["remaining"] for r in rsos),
        "daily_avg": 8.1,
        "drr": 3,
        "projection": sum(r["projection"] for r in rsos),
        "status": "on_track",
    }


def _dashboard(n_rso: int) -> dict:
    rows = [_rso(i) for i in range(n_rso)]
    retailer_counts = {
        k: sum(r["retailer_counts"][k] for r in rows) for k in COUNT_KEYS
    }
    groups: dict[str, list[dict]] = {}
    for r in rows:
        groups.setdefault(r["supervisor_name"], []).append(r)
    return {
        "period": PERIOD,
        "count_keys": COUNT_KEYS,
        "yesterday_active": 128,
        "rows": rows,
        "summary": {
            "rso_count": n_rso,
            "retailer_count": sum(r["retailer_count"] for r in rows),
            "target": sum(r["target"] for r in rows),
            "achieved": sum(r["achieved"] for r in rows),
            "ach_pct": 66.6,
            "remaining": 0,
            "daily_avg": 80.0,
            "projection": 2500.0,
            "drr": 0,
            "status": "on_track",
            "retailer_counts": retailer_counts,
        },
        "supervisor_summary": [
            _supervisor(name, group) for name, group in sorted(groups.items())
        ],
    }


def _render(dashboard: dict) -> list[bytes]:
    with _scale.temp(1):  # native design units: one page is PAGE_W x PAGE_H
        return _render_image("Test House", "H001", dashboard, TODAY)


def _sizes(pages: list[bytes]) -> list[tuple[int, int]]:
    return [Image.open(BytesIO(p)).size for p in pages]


async def test_small_house_page_hugs_its_content():
    pages = _render(_dashboard(2))
    assert len(pages) == 1
    (w, h), = _sizes(pages)
    assert w == PAGE_W
    # Landscape and content-hugging: far shorter than a full A4 sheet, but not
    # a sliver.
    assert w > h
    assert 250 < h < PAGE_H * 0.8


async def test_every_page_stays_inside_the_exact_a4_sheet():
    # The sheet itself is the exact A4 landscape ratio...
    assert abs(PAGE_W / PAGE_H - 297 / 210) < 0.001
    # ...and no page can ever exceed it in either dimension.
    for w, h in _sizes(_render(_dashboard(40))):
        assert w == PAGE_W
        assert h <= PAGE_H


async def test_many_rsos_split_onto_extra_a4_landscape_pages():
    sizes = _sizes(_render(_dashboard(80)))
    assert len(sizes) > 1
    assert all(w == PAGE_W and h <= PAGE_H for w, h in sizes)
    # A fully packed page keeps the exact A4 landscape sheet...
    assert sizes[0] == (PAGE_W, PAGE_H)
    assert all(h >= PAGE_H - 80 for _, h in sizes[:-1])
    # ...while a tail page that does not fill the sheet hugs its content
    # instead of being stretched to the full A4 height.
    assert sizes[-1][1] < PAGE_H


async def test_long_house_tail_page_hugs_its_remaining_content():
    sizes = _sizes(_render(_dashboard(160)))
    assert len(sizes) >= 3
    assert all(w == PAGE_W and h <= PAGE_H for w, h in sizes)
    assert all(h >= PAGE_H - 80 for _, h in sizes[:-1])
    assert sizes[-1][1] < PAGE_H - 80


async def test_empty_house_yields_one_short_page():
    pages = _render(_dashboard(0))
    (w, h), = _sizes(pages)
    assert w == PAGE_W
    assert 0 < h < 400
