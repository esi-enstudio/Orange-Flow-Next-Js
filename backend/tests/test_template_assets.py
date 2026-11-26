"""Private template assets: upload, list, stream, delete, tenancy and audit."""

import io
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, UploadFile
from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy import select

from app.models.activity_log import ActivityLog
from app.routers.deps import get_current_user, get_db
from app.routers.documents import router
from app.services import document_seed, template_assets

DOC_PERMISSIONS = (
    "documents.view",
    "documents.create",
    "documents.templates.view",
    "documents.templates.manage",
)


def _user(house, permissions=DOC_PERMISSIONS, user_id=1):
    return SimpleNamespace(
        id=user_id,
        name=f"Asset User {user_id}",
        status="Active",
        houses=[house],
        roles=[
            SimpleNamespace(
                name="Distributor",
                permissions=[SimpleNamespace(name=p) for p in permissions],
            )
        ],
    )


def _jpeg_bytes():
    buffer = io.BytesIO()
    Image.new("RGB", (10, 10), "blue").save(buffer, "JPEG")
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


@pytest.fixture(autouse=True)
def asset_root(tmp_path, monkeypatch):
    monkeypatch.setattr(template_assets, "ASSET_ROOT", str(tmp_path / "assets"))
    return tmp_path


async def _make_house(db, code="TAS-1"):
    from app.models.house import House

    house = House(code=code, name="Asset House", email="asset@example.com", address="Dhaka")
    db.add(house)
    await db.commit()
    await db.refresh(house)
    return house


async def _make_template(db, client, state, house, name="House Template"):
    state["user"] = _user(house)
    await document_seed.seed_documents_module(db)
    doc_type = (
        await db.execute(
            select(document_seed.DocumentType).where(document_seed.DocumentType.code == "NOC")
        )
    ).scalar_one()
    response = await client.post(
        "/api/v1/documents/templates",
        headers={"X-House-ID": str(house.id)},
        json={
            "document_type_id": doc_type.id,
            "name": name,
            "content_json": {
                "schema_version": 2,
                "page": {"orientation": "portrait"},
                "blocks": [
                    {
                        "type": "image",
                        "source_kind": "manual",
                        "asset_id": 1,
                    }
                ],
            },
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


async def _upload(client, house, template_id, **overrides):
    data = {"file": ("scan.jpg", io.BytesIO(_jpeg_bytes()), "image/jpeg")}
    data.update(overrides)
    return await client.post(
        f"/api/v1/documents/templates/{template_id}/assets",
        headers={"X-House-ID": str(house.id)},
        files=data,
    )


@pytest.mark.asyncio
async def test_upload_lists_streams_and_soft_deletes_with_audit(api, db):
    client, state = api
    house = await _make_house(db)
    template = await _make_template(db, client, state, house)
    headers = {"X-House-ID": str(house.id)}

    response = await _upload(client, house, template["id"])
    assert response.status_code == 201, response.text
    asset = response.json()["data"]
    assert "storage_path" not in asset
    assert asset["template_id"] == template["id"]

    logs = (
        await db.execute(
            select(ActivityLog).where(
                ActivityLog.module == "document_template", ActivityLog.action == "create"
            )
        )
    ).scalars().all()
    assert len(logs) == 2  # template create + asset create

    listed = await client.get(
        f"/api/v1/documents/templates/{template['id']}/assets", headers=headers
    )
    assert [item["id"] for item in listed.json()["data"]] == [asset["id"]]

    streamed = await client.get(
        f"/api/v1/documents/templates/{template['id']}/assets/{asset['id']}/file",
        headers=headers,
    )
    assert streamed.status_code == 200
    assert streamed.headers["cache-control"] == "private, no-store"

    deleted = await client.delete(
        f"/api/v1/documents/templates/{template['id']}/assets/{asset['id']}",
        headers=headers,
    )
    assert deleted.status_code == 200
    listed_again = await client.get(
        f"/api/v1/documents/templates/{template['id']}/assets", headers=headers
    )
    assert listed_again.json()["data"] == []
    delete_logs = (
        await db.execute(
            select(ActivityLog).where(
                ActivityLog.module == "document_template", ActivityLog.action == "delete"
            )
        )
    ).scalars().all()
    assert len(delete_logs) == 1


@pytest.mark.asyncio
async def test_manage_permission_required(api, db):
    client, state = api
    house = await _make_house(db)
    template = await _make_template(db, client, state, house)
    state["user"] = _user(
        house,
        permissions=("documents.view", "documents.templates.view"),
        user_id=2,
    )
    response = await _upload(client, house, template["id"])
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_asset_other_house_unresolvable(api, db):
    client, state = api
    house = await _make_house(db)
    other = await _make_house(db, code="TAS-2")
    template = await _make_template(db, client, state, house)
    asset = (await _upload(client, house, template["id"])).json()["data"]

    assert await template_assets.load_for_render(
        db, template_id=template["id"], asset_id=asset["id"], house_id=house.id
    ) is not None
    assert await template_assets.load_for_render(
        db, template_id=template["id"], asset_id=asset["id"], house_id=other.id
    ) is None


@pytest.mark.asyncio
async def test_asset_wrong_template_rejected(api, db):
    client, state = api
    house = await _make_house(db)
    first = await _make_template(db, client, state, house, name="First")
    second = await _make_template(db, client, state, house, name="Second")
    asset = (await _upload(client, house, first["id"])).json()["data"]

    assert await template_assets.load_for_render(
        db, template_id=second["id"], asset_id=asset["id"], house_id=house.id
    ) is None


@pytest.mark.asyncio
async def test_invalid_upload_rejected(api, db):
    client, state = api
    house = await _make_house(db)
    template = await _make_template(db, client, state, house)

    gif = await client.post(
        f"/api/v1/documents/templates/{template['id']}/assets",
        headers={"X-House-ID": str(house.id)},
        files={"file": ("scan.gif", io.BytesIO(b"GIF89a"), "image/gif")},
    )
    assert gif.status_code == 422
    assert gif.json()["detail"]["code"] == "INVALID_IMAGE"

    huge = await client.post(
        f"/api/v1/documents/templates/{template['id']}/assets",
        headers={"X-House-ID": str(house.id)},
        files={"file": ("big.jpg", io.BytesIO(b"x" * (2 * 1024 * 1024 + 1)), "image/jpeg")},
    )
    assert huge.status_code == 422
