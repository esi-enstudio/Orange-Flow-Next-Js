"""House letterhead: layout validation, image storage and the API guards."""

import io
import os
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from PIL import Image

from app.models.house import House
from app.routers.deps import get_current_user, get_db
from app.routers.houses import router
from app.services import house_letterhead as hl


def _image_bytes(width=1200, height=1600, fmt="JPEG") -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), "#ffffff").save(buffer, format=fmt)
    return buffer.getvalue()


def _user(house, role="RSO", permissions=()):
    return SimpleNamespace(
        id=1,
        name="Letterhead Tester",
        status="Active",
        houses=[house],
        roles=[
            SimpleNamespace(
                name=role,
                permissions=[SimpleNamespace(name=p) for p in permissions],
            )
        ],
    )


async def _make_house(db, code="LH-1", name="Letterhead House"):
    house = House(code=code, name=name, email=f"{code.lower()}@example.com", address="Dhaka")
    db.add(house)
    await db.commit()
    await db.refresh(house)
    return house


@pytest.fixture(autouse=True)
def storage_root(tmp_path, monkeypatch):
    monkeypatch.setattr(hl, "LETTERHEAD_ROOT", str(tmp_path / "letterheads"))
    return tmp_path / "letterheads"


@pytest.fixture
async def api(db):
    app = FastAPI()
    app.include_router(router)

    async def _get_db():
        yield db

    app.dependency_overrides[get_db] = _get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield app, client


# --------------------------------------------------------------------------- #
# Layout
# --------------------------------------------------------------------------- #

def test_validate_layout_fills_every_field_and_clamps_to_page():
    layout = hl.validate_layout({"fields": {"nid": {"x": 95, "w": 40, "size": 999}}})

    assert set(layout["fields"]) == set(hl.FIELD_KEYS)
    assert layout["fields"]["nid"]["x"] == 60  # 100 - width
    assert layout["fields"]["nid"]["size"] == 30  # clamped to the max
    assert layout["body"]["enabled"] is True  # the letter body is on by default


def test_validate_layout_rejects_missing_fields():
    with pytest.raises(ValueError):
        hl.validate_layout({"body": {}})
    with pytest.raises(ValueError):
        hl.validate_layout([])


# --------------------------------------------------------------------------- #
# Image storage
# --------------------------------------------------------------------------- #

async def test_store_image_writes_jpeg_and_replaces_previous(db):
    from starlette.datastructures import UploadFile

    house = await _make_house(db)
    first = await hl.store_image(house, UploadFile(filename="page.png", file=io.BytesIO(_image_bytes(fmt="PNG"))))
    first_path = hl.image_fs_path(house)
    assert first_path and os.path.isfile(first_path)

    second = await hl.store_image(house, UploadFile(filename="page.jpg", file=io.BytesIO(_image_bytes())))
    assert second != first
    assert not os.path.exists(first_path)
    assert os.path.isfile(hl.image_fs_path(house))
    assert house.letterhead_image_path == f"{house.id}/{second}"


async def test_store_image_rejects_small_and_non_image(db):
    from starlette.datastructures import UploadFile

    house = await _make_house(db)
    with pytest.raises(ValueError):
        await hl.store_image(house, UploadFile(filename="tiny.jpg", file=io.BytesIO(_image_bytes(width=200))))
    with pytest.raises(ValueError):
        await hl.store_image(house, UploadFile(filename="notes.jpg", file=io.BytesIO(b"not an image")))
    assert house.letterhead_image_path is None


async def test_store_image_rejects_non_raster_formats(db):
    from starlette.datastructures import UploadFile

    house = await _make_house(db)
    buffer = io.BytesIO()
    Image.new("RGB", (1000, 1400), "#ffffff").save(buffer, format="GIF")

    with pytest.raises(ValueError):
        await hl.store_image(
            house, UploadFile(filename="page.gif", file=io.BytesIO(buffer.getvalue()))
        )
    assert house.letterhead_image_path is None


async def test_store_image_downscales_large_scan(db):
    from starlette.datastructures import UploadFile

    house = await _make_house(db)
    await hl.store_image(
        house,
        UploadFile(filename="scan.jpg", file=io.BytesIO(_image_bytes(width=3000, height=4200))),
    )

    with Image.open(hl.image_fs_path(house)) as stored:
        assert max(stored.size) <= hl.LETTERHEAD_MAX_DIMENSION


async def test_configured_requires_image_and_layout(db):
    from starlette.datastructures import UploadFile

    house = await _make_house(db)
    assert hl.configured(house) is False
    await hl.store_image(house, UploadFile(filename="page.jpg", file=io.BytesIO(_image_bytes())))
    assert hl.configured(house) is False  # image alone is not enough
    house.letterhead_layout = hl.default_layout()
    assert hl.configured(house) is True


# --------------------------------------------------------------------------- #
# API
# --------------------------------------------------------------------------- #

async def test_endpoints_require_permission(api, db):
    app, client = api
    house = await _make_house(db)
    app.dependency_overrides[get_current_user] = lambda: _user(house)

    assert (await client.get(f"/api/houses/{house.id}/letterhead")).status_code == 403


async def test_house_isolation(api, db):
    app, client = api
    own = await _make_house(db, code="LH-A", name="Own")
    other = await _make_house(db, code="LH-B", name="Other")
    app.dependency_overrides[get_current_user] = lambda: _user(
        own, permissions=["houses.letterhead_view"]
    )

    response = await client.get(f"/api/houses/{other.id}/letterhead")

    assert response.status_code == 403


async def test_upload_layout_and_stream(api, db):
    app, client = api
    house = await _make_house(db)
    app.dependency_overrides[get_current_user] = lambda: _user(house, role="Admin")

    upload = await client.post(
        f"/api/houses/{house.id}/letterhead/image",
        files={"file": ("page.jpg", _image_bytes(), "image/jpeg")},
    )
    assert upload.status_code == 200
    assert upload.json()["has_image"] is True

    layout = await client.put(
        f"/api/houses/{house.id}/letterhead",
        json={"layout": {"fields": {"nid": {"x": 10, "y": 20}}}},
    )
    assert layout.status_code == 200
    body = layout.json()
    assert body["configured"] is True
    assert body["layout"]["fields"]["nid"]["y"] == 20

    image = await client.get(f"/api/houses/{house.id}/letterhead/image")
    assert image.status_code == 200
    assert image.headers["content-type"] == "image/jpeg"

    removed = await client.delete(f"/api/houses/{house.id}/letterhead/image")
    assert removed.status_code == 200
    assert removed.json()["has_image"] is False


async def test_preview_requires_uploaded_image(api, db):
    app, client = api
    house = await _make_house(db)
    app.dependency_overrides[get_current_user] = lambda: _user(house, role="Admin")

    response = await client.post(f"/api/houses/{house.id}/letterhead/preview", json={})

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "LETTERHEAD_IMAGE_MISSING"


async def test_preview_renders_pdf(api, db, monkeypatch):
    app, client = api
    house = await _make_house(db)
    app.dependency_overrides[get_current_user] = lambda: _user(house, role="Admin")
    await client.post(
        f"/api/houses/{house.id}/letterhead/image",
        files={"file": ("page.jpg", _image_bytes(), "image/jpeg")},
    )

    async def _fake_render(html):
        assert "NotoBengali" in html
        return b"%PDF-1.4 preview"

    monkeypatch.setattr("app.routers.houses.render_pdf", _fake_render)
    response = await client.post(f"/api/houses/{house.id}/letterhead/preview", json={})

    assert response.status_code == 200
    assert response.content == b"%PDF-1.4 preview"
    assert response.headers["content-type"] == "application/pdf"
