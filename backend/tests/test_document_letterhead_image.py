"""House-wise document letterhead image: storage, tenancy, audit and rendering."""

import io
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy import select

from app.models.activity_log import ActivityLog
from app.models.documents import DocumentTemplate
from app.routers.deps import get_current_user, get_db
from app.routers.documents import router
from app.services import document_render, document_seed, house_letterhead
from conftest import make_house

PERMISSIONS = (
    "documents.view",
    "documents.create",
    "documents.edit",
    "documents.generate",
    "documents.templates.view",
    "documents.templates.manage",
    "documents.letterheads.manage",
)


def _user(house, *, permissions=PERMISSIONS):
    return SimpleNamespace(
        id=1,
        name="Tester",
        status="Active",
        houses=[house],
        roles=[
            SimpleNamespace(
                name="Distributor",
                permissions=[SimpleNamespace(name=name) for name in permissions],
            )
        ],
    )


def _image_bytes() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (1200, 300), "white").save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.fixture
async def api(db):
    app = FastAPI()
    app.include_router(router)
    state = {"user": None}

    async def _get_db():
        yield db

    async def _current_user():
        return state["user"]

    app.dependency_overrides[get_db] = _get_db
    app.dependency_overrides[get_current_user] = _current_user
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client, state


@pytest.fixture
def storage(tmp_path, monkeypatch):
    monkeypatch.setattr(house_letterhead, "LETTERHEAD_ROOT", str(tmp_path / "letterheads"))
    monkeypatch.setattr(document_render, "PRIVATE_ROOT", str(tmp_path))
    return tmp_path


async def test_house_image_upload_stream_and_delete_are_audited(api, db, storage):
    client, state = api
    house = await make_house(db)
    other = await make_house(db, code="H002", name="Other House")
    state["user"] = _user(house)
    headers = {"X-House-ID": str(house.id)}

    status = await client.get("/api/v1/documents/letterheads/house-image", headers=headers)
    assert status.status_code == 200
    assert status.json()["data"] == {"house_id": house.id, "has_image": False}

    uploaded = await client.post(
        "/api/v1/documents/letterheads/house-image",
        headers=headers,
        files={"file": ("letterhead.png", _image_bytes(), "image/png")},
    )
    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()["data"]["has_image"] is True

    await db.refresh(house)
    assert house.letterhead_image_path.startswith(f"{house.id}/")

    streamed = await client.get("/api/v1/documents/letterheads/house-image/file", headers=headers)
    assert streamed.status_code == 200
    assert streamed.content

    deleted = await client.delete("/api/v1/documents/letterheads/house-image", headers=headers)
    assert deleted.status_code == 200
    assert deleted.json()["data"]["has_image"] is False
    await db.refresh(house)
    assert house.letterhead_image_path is None

    logs = (
        await db.execute(
            select(ActivityLog).where(
                ActivityLog.module == "documents",
                ActivityLog.record_identifier == f"house-letterhead: {house.code}",
            )
        )
    ).scalars().all()
    assert {log.action for log in logs} == {"edit", "delete"}
    assert other.id != house.id


async def test_house_image_upload_requires_house_context(api, db, storage):
    client, state = api
    house = await make_house(db)
    state["user"] = _user(house)
    response = await client.post(
        "/api/v1/documents/letterheads/house-image",
        files={"file": ("letterhead.png", _image_bytes(), "image/png")},
    )
    assert response.status_code == 400


async def test_house_image_upload_rejects_cross_house_context(api, db, storage):
    client, state = api
    own = await make_house(db)
    other = await make_house(db, code="H002", name="Other House")
    state["user"] = _user(own)
    response = await client.post(
        "/api/v1/documents/letterheads/house-image",
        headers={"X-House-ID": str(other.id)},
        files={"file": ("letterhead.png", _image_bytes(), "image/png")},
    )
    assert response.status_code == 403


async def test_house_image_upload_rejects_non_image(api, db, storage):
    client, state = api
    house = await make_house(db)
    state["user"] = _user(house)
    response = await client.post(
        "/api/v1/documents/letterheads/house-image",
        headers={"X-House-ID": str(house.id)},
        files={"file": ("bad.txt", b"not an image", "text/plain")},
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "INVALID_IMAGE"


def test_render_html_uses_house_image_instead_of_legacy_header(storage):
    ast = {
        "schema_version": 1,
        "page": {"orientation": "portrait"},
        "blocks": [{"type": "paragraph", "text": "Hello"}],
    }
    legacy = SimpleNamespace(
        organization_name="Legacy Org",
        logo_path=None,
        subtitle=None,
        phone_numbers=[],
        email=None,
        address=None,
        footer_text=None,
    )
    plain = document_render.render_html(ast, {}, letterhead=legacy)
    assert "Legacy Org" in plain
    assert '<div class="house-letterhead">' not in plain

    (storage / "letterheads").mkdir(parents=True, exist_ok=True)
    (storage / "letterheads" / "sample.jpg").write_bytes(_image_bytes())
    with_image = document_render.render_html(
        ast,
        {},
        letterhead=legacy,
        house_letterhead_path="letterheads/sample.jpg",
    )
    assert 'class="house-letterhead"' in with_image
    assert "data:image" in with_image
    assert "Legacy Org" not in with_image


async def test_template_preview_uses_house_image(api, db, storage):
    client, state = api
    house = await make_house(db)
    state["user"] = _user(house)
    await document_seed.seed_documents_module(db)
    template = (await db.execute(select(DocumentTemplate))).scalars().first()
    assert template is not None

    # Two non-default legacy records would be ambiguous for the old resolver;
    # the house image must make them irrelevant.
    for name in ("Legacy A", "Legacy B"):
        legacy = await client.post(
            "/api/v1/documents/letterheads",
            headers={"X-House-ID": str(house.id)},
            json={"name": name, "organization_name": name, "scope": "house"},
        )
        assert legacy.status_code == 201, legacy.text

    uploaded = await client.post(
        "/api/v1/documents/letterheads/house-image",
        headers={"X-House-ID": str(house.id)},
        files={"file": ("letterhead.png", _image_bytes(), "image/png")},
    )
    assert uploaded.status_code == 200, uploaded.text

    preview = await client.post(
        "/api/v1/documents/render/preview",
        headers={"X-House-ID": str(house.id)},
        json={"template_id": template.id},
    )
    assert preview.status_code == 200, preview.text
    assert 'class="house-letterhead"' in preview.json()["data"]["html"]


async def test_house_image_requires_letterhead_manage_permission(api, db, storage):
    client, state = api
    house = await make_house(db)
    state["user"] = _user(house, permissions=("documents.view",))
    headers = {"X-House-ID": str(house.id)}
    response = await client.get("/api/v1/documents/letterheads/house-image", headers=headers)
    assert response.status_code == 403
