"""RESIGNATION audience guard and Bangla-first print context parity."""

import io
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy import select

from app.models.documents import GeneratedDocument
from app.models.employee import Employee
from app.models.employee_document import EmployeeDocument
from app.models.house import House
from app.routers.deps import get_current_user, get_db
from app.routers.documents import router
from app.services import (
    document_ast,
    document_numbering,
    document_pdf,
    document_render,
    document_seed,
    document_service as svc,
    employee_documents,
    house_letterhead,
)

PERMISSIONS = (
    "documents.view",
    "documents.create",
    "documents.generate",
    "documents.templates.view",
    "documents.templates.manage",
)


def _user(house_id):
    return SimpleNamespace(
        id=1,
        name="Parity User",
        status="Active",
        houses=[SimpleNamespace(id=house_id)],
        roles=[
            SimpleNamespace(
                name="Distributor",
                permissions=[SimpleNamespace(name=p) for p in PERMISSIONS],
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
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client, state


@pytest.fixture(autouse=True)
def storage(tmp_path, monkeypatch):
    root = tmp_path / "private_uploads"
    monkeypatch.setattr(employee_documents, "PRIVATE_STORAGE_ROOT", str(root / "employee_documents"))
    monkeypatch.setattr(document_render, "PRIVATE_ROOT", str(root))
    monkeypatch.setattr(house_letterhead, "LETTERHEAD_ROOT", str(root / "letterheads"))
    monkeypatch.setattr(document_pdf, "PRIVATE_ROOT", str(root))
    return root


def _write_jpeg(path, color="red"):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (8, 8), color).save(path, "JPEG")


async def _fixture(db, root, employee_type="bp"):
    house = House(
        code="BP-1",
        name="English House",
        name_bn="বাংলা হাউস",
        email="bp@example.com",
        address="Dhaka",
        address_bn="ঢাকা",
        proprietor_name="English Owner",
        proprietor_name_bn="বাংলা মালিক",
        poc_name="English POC",
        poc_name_bn="বাংলা পিওসি",
    )
    db.add(house)
    await db.commit()
    await db.refresh(house)
    letter_dir = root / "letterheads"
    _write_jpeg(letter_dir / "letter.jpg", "white")
    house.letterhead_image_path = "letter.jpg"

    employee = Employee(
        house_id=house.id,
        dms_code="DMS-BP",
        itop_number="IT-BP",
        employee_name="English Name",
        employee_name_bn="বাংলা নাম",
        fathers_name="English Father",
        fathers_name_bn="বাংলা পিতা",
        nid="1234567890123",
        nid_bn="১২৩৪৫৬৭৮৯০১২৩",
        employee_type=employee_type,
        status="Resigned",
        employee_id="EMP-BP",
        joining_date="2021-01-15",
        resigned_date="2026-06-30",
    )
    db.add(employee)
    await db.commit()
    await db.refresh(employee)

    for doc_type, color in (("resignation_letter", "red"), ("nid", "blue")):
        rel = f"{house.id}/{employee.id}/{doc_type}.jpg"
        _write_jpeg(root / "employee_documents" / rel, color)
        db.add(
            EmployeeDocument(
                employee_id=employee.id,
                house_id=house.id,
                doc_type=doc_type,
                file_name=f"{doc_type}.jpg",
                storage_path=rel,
                file_size=10,
                mime_type="image/jpeg",
                uploaded_by=1,
            )
        )
    await db.commit()
    return house, employee


def _keys():
    return [
        "employee_name",
        "nid",
        "joining_date",
        "resigned_date",
        "designation",
        "house_name",
        "proprietor_name",
        "poc_name",
        "application_date",
    ]


def _ast(audience):
    return {
        "schema_version": 2,
        "audience": audience,
        "page": {"orientation": "portrait"},
        "blocks": [
            {"type": "image", "source_kind": "dynamic", "source": "resignation_letter"},
            {"type": "page_break"},
            {"type": "image", "source_kind": "dynamic", "source": "employee_nid"},
            {"type": "page_break"},
            {
                "type": "paragraph",
                "text": (
                    "{{employee_name}} | {{nid}} | {{joining_date}} | {{resigned_date}} | "
                    "{{designation}} | {{house_name}} | {{proprietor_name}} | "
                    "{{poc_name}} | {{application_date}}"
                ),
            },
        ],
    }


@pytest.fixture
def capture(monkeypatch):
    state = {"html": []}

    async def render(html):
        state["html"].append(html)
        return b"%PDF-1.4 parity"

    async def allocate(*args, **kwargs):
        return "RES-2026-000001"

    monkeypatch.setattr(document_pdf, "render_pdf", render)
    monkeypatch.setattr(document_numbering, "allocate_document_number", allocate)
    return state


async def _template_and_draft(client, db, root, house, employee, audience):
    await document_seed.seed_documents_module(db)
    doc_type = (
        await db.execute(
            select(document_seed.DocumentType).where(document_seed.DocumentType.code == "RESIGNATION")
        )
    ).scalar_one()
    template, _version = await svc.create_template(
        db,
        document_type_id=doc_type.id,
        house_id=house.id,
        name=f"Parity {audience}",
        template_mode="VISUAL",
        description=None,
        is_default=False,
        variables_schema=document_ast.schema_from_keys(_keys()),
        version_notes=None,
        content_json=_ast(audience),
        publish=True,
        user=_user(house.id),
    )
    await db.commit()
    await db.refresh(template)
    state_user = _user(house.id)
    response = await client.post(
        "/api/v1/documents",
        headers={"X-House-ID": str(house.id)},
        json={
            "template_id": template.id,
            "employee_id": employee.id,
            "document_title": "Resignation",
            "document_data": {"employee_name": "Typed English", "nid": "9999999999999"},
        },
    )
    if response.status_code != 201:
        # The api fixture's user is set by the calling test before this helper.
        raise AssertionError(response.text)
    return response.json()["data"]["id"], state_user


@pytest.mark.asyncio
async def test_audience_mismatch_blocked(api, db, storage, capture):
    client, state = api
    house, employee = await _fixture(db, storage, employee_type="bp")
    state["user"] = _user(house.id)
    document_id, _ = await _template_and_draft(client, db, storage, house, employee, "rso")

    response = await client.post(
        f"/api/v1/documents/{document_id}/generate",
        headers={"X-House-ID": str(house.id)},
    )
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "AUDIENCE_MISMATCH"
    assert capture["html"] == []


@pytest.mark.asyncio
async def test_audience_all_accepts_bp_and_prints_bangla_first(api, db, storage, capture):
    client, state = api
    house, employee = await _fixture(db, storage, employee_type="bp")
    state["user"] = _user(house.id)
    document_id, _ = await _template_and_draft(client, db, storage, house, employee, "all")
    headers = {"X-House-ID": str(house.id)}

    response = await client.post(f"/api/v1/documents/{document_id}/generate", headers=headers)
    assert response.status_code == 200, response.text
    html = capture["html"][-1]
    assert "বাংলা নাম" in html
    assert "১২৩৪৫৬৭৮৯০১২৩" in html
    assert "১৫ জানুয়ারি ২০২১" in html
    assert "BP (Brand Promotor)" in html
    assert "বাংলা হাউস" in html
    assert "বাংলা মালিক" in html
    assert "বাংলা পিওসি" in html

    draft = await db.get(GeneratedDocument, document_id)
    assert draft.document_data["employee_name"] == "Typed English"
    assert draft.document_data["nid"] == "9999999999999"


@pytest.mark.asyncio
async def test_audience_all_accepts_rso(api, db, storage, capture):
    client, state = api
    house, employee = await _fixture(db, storage, employee_type="rso")
    state["user"] = _user(house.id)
    document_id, _ = await _template_and_draft(client, db, storage, house, employee, "all")

    response = await client.post(
        f"/api/v1/documents/{document_id}/generate",
        headers={"X-House-ID": str(house.id)},
    )
    assert response.status_code == 200, response.text
    assert "RSO (Retail Sales Officer)" in capture["html"][-1]
