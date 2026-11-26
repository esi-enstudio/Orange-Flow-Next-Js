"""POST /render/preview-ast renders unsaved edits without touching the database."""

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.models.activity_log import ActivityLog
from app.models.documents import DocumentTemplateVersion
from app.models.employee import Employee
from app.models.house import House
from app.routers.deps import get_current_user, get_db
from app.routers.documents import router
from app.services import document_seed, document_service as svc

PERMISSIONS = (
    "documents.view",
    "documents.create",
    "documents.templates.view",
    "documents.templates.manage",
)


def _user(house_id, permissions=PERMISSIONS, user_id=1):
    return SimpleNamespace(
        id=user_id,
        name=f"Preview User {user_id}",
        status="Active",
        houses=[SimpleNamespace(id=house_id)],
        roles=[
            SimpleNamespace(
                name="Distributor",
                permissions=[SimpleNamespace(name=p) for p in permissions],
            )
        ],
    )


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


async def _house(db, code="PA-1"):
    house = House(code=code, name="Preview House", email="pa@example.com", address="Dhaka")
    db.add(house)
    await db.commit()
    await db.refresh(house)
    return house


async def _employee(db, house, code="PA-1"):
    employee = Employee(
        house_id=house.id,
        dms_code=f"DMS-{code}",
        itop_number=f"IT-{code}",
        employee_name="Md Karim",
        fathers_name="Md Rahim",
        nid="1234567890123",
        employee_type="rso",
        status="Active",
        employee_id=f"EMP-{code}",
        joining_date="2021-01-15",
    )
    db.add(employee)
    await db.commit()
    await db.refresh(employee)
    return employee


async def _template(db, house):
    await document_seed.seed_documents_module(db)
    doc_type = (
        await db.execute(
            select(document_seed.DocumentType).where(document_seed.DocumentType.code == "NOC")
        )
    ).scalar_one()
    template, version = await svc.create_template(
        db,
        document_type_id=doc_type.id,
        house_id=house.id,
        name="Preview Draft",
        template_mode="VISUAL",
        description=None,
        is_default=False,
        variables_schema={"fields": []},
        version_notes=None,
        content_json={
            "schema_version": 2,
            "page": {"orientation": "portrait"},
            "blocks": [{"type": "paragraph", "text": "Saved body"}],
        },
        publish=False,
        user=_user(house.id),
    )
    await db.commit()
    await db.refresh(template)
    return template


def _draft_ast():
    return {
        "schema_version": 2,
        "page": {"orientation": "portrait"},
        "blocks": [
            {"type": "paragraph", "text": "Unsaved body"},
            {
                "type": "image",
                "source_kind": "dynamic",
                "source": "employee_nid",
                "fallback_text": "<b>NID pending</b>",
            },
            {"type": "page_break"},
            {"type": "image", "source_kind": "manual", "asset_id": 1},
        ],
    }


@pytest.mark.asyncio
async def test_preview_ast_no_db_write(api, db):
    client, state = api
    house = await _house(db)
    employee = await _employee(db, house)
    template = await _template(db, house)
    state["user"] = _user(house.id)

    versions_before = await db.scalar(select(func.count(DocumentTemplateVersion.id)))
    logs_before = await db.scalar(select(func.count(ActivityLog.id)))

    response = await client.post(
        "/api/v1/documents/render/preview-ast",
        headers={"X-House-ID": str(house.id)},
        json={
            "template_id": template.id,
            "content_json": _draft_ast(),
            "variables_schema": {"fields": []},
            "employee_id": employee.id,
        },
    )

    assert response.status_code == 200, response.text
    html = response.json()["data"]["html"]
    assert "Unsaved body" in html
    assert "NID pending" in html
    assert '<div class="page-break"></div>' in html
    assert "Saved body" not in html
    assert await db.scalar(select(func.count(DocumentTemplateVersion.id))) == versions_before
    assert await db.scalar(select(func.count(ActivityLog.id))) == logs_before


@pytest.mark.asyncio
async def test_preview_ast_rejects_invalid(api, db):
    client, state = api
    house = await _house(db)
    template = await _template(db, house)
    state["user"] = _user(house.id)
    ast = _draft_ast()
    ast["blocks"].append({"type": "not_a_block"})

    response = await client.post(
        "/api/v1/documents/render/preview-ast",
        headers={"X-House-ID": str(house.id)},
        json={"template_id": template.id, "content_json": ast},
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "INVALID_TEMPLATE"


@pytest.mark.asyncio
async def test_preview_ast_rejects_foreign_house_employee(api, db):
    client, state = api
    house = await _house(db)
    other = await _house(db, code="PA-2")
    other_employee = await _employee(db, other, code="PA-2")
    template = await _template(db, house)
    state["user"] = _user(house.id)

    response = await client.post(
        "/api/v1/documents/render/preview-ast",
        headers={"X-House-ID": str(house.id)},
        json={
            "template_id": template.id,
            "content_json": _draft_ast(),
            "employee_id": other_employee.id,
        },
    )
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "EMPLOYEE_NOT_FOUND"


@pytest.mark.asyncio
async def test_preview_ast_requires_view_permission(api, db):
    client, state = api
    house = await _house(db)
    template = await _template(db, house)
    state["user"] = _user(house.id, permissions=("documents.create",), user_id=2)

    response = await client.post(
        "/api/v1/documents/render/preview-ast",
        headers={"X-House-ID": str(house.id)},
        json={"template_id": template.id, "content_json": _draft_ast()},
    )
    assert response.status_code == 403
