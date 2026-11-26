"""Resignation template generation: required scans, page order, regeneration."""

import io
import re
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from PIL import Image
from sqlalchemy import func, select

from app.models.documents import DocumentTemplateVersion, DocumentVersion
from app.models.employee import Employee
from app.models.employee_document import EmployeeDocument
from app.models.house import House
from app.routers.deps import get_current_user, get_db
from app.routers.documents import router
from app.services import (
    document_numbering,
    document_pdf,
    document_render,
    document_seed,
    document_service as svc,
    employee_documents,
    house_letterhead,
    template_assets,
)

PERMISSIONS = (
    "documents.view",
    "documents.create",
    "documents.edit",
    "documents.generate",
    "documents.regenerate",
    "documents.templates.view",
    "documents.templates.manage",
)


def _user(house_id, user_id=1):
    return SimpleNamespace(
        id=user_id,
        name=f"Resignation User {user_id}",
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
    monkeypatch.setattr(template_assets, "ASSET_ROOT", str(root / "document_template_assets"))
    monkeypatch.setattr(house_letterhead, "LETTERHEAD_ROOT", str(root / "letterheads"))
    monkeypatch.setattr(document_pdf, "PRIVATE_ROOT", str(root))
    return root


def _write_jpeg(path, color="red"):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (8, 8), color).save(path, "JPEG")
    return path


async def _house(db, root):
    house = House(code="RES-1", name="Resignation House", email="res@example.com", address="Dhaka")
    db.add(house)
    await db.commit()
    await db.refresh(house)
    letter_dir = root / "letterheads"
    letter_dir.mkdir(parents=True, exist_ok=True)
    _write_jpeg(letter_dir / "letter.jpg", "white")
    house.letterhead_image_path = "letter.jpg"
    await db.commit()
    return house


async def _employee(db, house, employee_type="rso"):
    employee = Employee(
        house_id=house.id,
        dms_code="DMS-RES",
        itop_number="IT-RES",
        employee_name="Md Karim",
        fathers_name="Md Rahim",
        nid="1234567890123",
        employee_type=employee_type,
        status="Resigned",
        employee_id="EMP-RES",
        joining_date="2021-01-15",
        resigned_date="2026-06-30",
    )
    db.add(employee)
    await db.commit()
    await db.refresh(employee)
    return employee


async def _res_type(db):
    await document_seed.seed_documents_module(db)
    return (
        await db.execute(
            select(document_seed.DocumentType).where(document_seed.DocumentType.code == "RESIGNATION")
        )
    ).scalar_one()


def _ast(source="resignation_letter"):
    return {
        "schema_version": 2,
        "audience": "all",
        "page": {"orientation": "portrait"},
        "blocks": [
            {"type": "image", "source_kind": "dynamic", "source": "resignation_letter"},
            {"type": "page_break"},
            {"type": "image", "source_kind": "dynamic", "source": "employee_nid"},
            {"type": "page_break"},
            {"type": "paragraph", "text": "Third page text"},
        ],
    }


async def _template(db, doc_type, house, *, content=None, name="Resignation Template"):
    template, version = await svc.create_template(
        db,
        document_type_id=doc_type.id,
        house_id=house.id,
        name=name,
        template_mode="VISUAL",
        description=None,
        is_default=False,
        variables_schema={"fields": []},
        version_notes=None,
        content_json=content or _ast(),
        publish=True,
        user=_user(house.id),
    )
    await db.commit()
    await db.refresh(template)
    return template


async def _scan(db, employee, doc_type, rel_path, color="red"):
    _write_jpeg(Path(employee_documents.PRIVATE_STORAGE_ROOT) / rel_path, color)
    doc = EmployeeDocument(
        employee_id=employee.id,
        house_id=employee.house_id,
        doc_type=doc_type,
        file_name=rel_path.split("/")[-1],
        storage_path=rel_path,
        file_size=10,
        mime_type="image/jpeg",
        uploaded_by=1,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return doc


@pytest.fixture
def capture(monkeypatch):
    state = {"html": [], "numbers": 0}

    async def render(html):
        state["html"].append(html)
        return b"%PDF-1.4 resignation test"

    async def allocate(*args, **kwargs):
        state["numbers"] += 1
        return f"RES-2026-{state['numbers']:06d}"

    monkeypatch.setattr(document_pdf, "render_pdf", render)
    monkeypatch.setattr(document_numbering, "allocate_document_number", allocate)
    return state


async def _draft(client, house, template, employee):
    response = await client.post(
        "/api/v1/documents",
        headers={"X-House-ID": str(house.id)},
        json={
            "template_id": template.id,
            "employee_id": employee.id,
            "document_title": "Resignation",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]["id"]


@pytest.mark.asyncio
async def test_missing_required_image_no_number(api, db, storage, capture):
    client, state = api
    house = await _house(db, storage)
    state["user"] = _user(house.id)
    employee = await _employee(db, house)
    doc_type = await _res_type(db)
    template = await _template(db, doc_type, house)
    document_id = await _draft(client, house, template, employee)
    headers = {"X-House-ID": str(house.id)}

    response = await client.post(f"/api/v1/documents/{document_id}/generate", headers=headers)

    assert response.status_code == 422, response.text
    detail = response.json()["detail"]
    assert detail["code"] == "IMAGE_SOURCE_MISSING"
    assert "resignation_letter" in detail["sources"]
    assert "employee_nid" in detail["sources"]
    assert capture["numbers"] == 0
    assert capture["html"] == []
    assert await db.scalar(select(func.count(DocumentVersion.id))) == 0


@pytest.mark.asyncio
async def test_generate_embeds_pages_in_order(api, db, storage, capture):
    client, state = api
    house = await _house(db, storage)
    state["user"] = _user(house.id)
    employee = await _employee(db, house)
    await _scan(db, employee, "resignation_letter", f"{house.id}/{employee.id}/letter.jpg")
    await _scan(db, employee, "nid", f"{house.id}/{employee.id}/nid.jpg", "blue")
    doc_type = await _res_type(db)
    template = await _template(db, doc_type, house)
    document_id = await _draft(client, house, template, employee)

    response = await client.post(
        f"/api/v1/documents/{document_id}/generate",
        headers={"X-House-ID": str(house.id)},
    )
    assert response.status_code == 200, response.text
    html = capture["html"][-1]
    first_img = html.index('data:image/jpeg;base64,')
    first_break = html.index('class="page-break"')
    second_break = html.index('class="page-break"', first_break + 1)
    assert first_img < first_break
    assert html.index('data:image/jpeg;base64,', first_img + 1) < second_break
    assert "Third page text" in html[second_break:]


@pytest.mark.asyncio
async def test_regenerate_re_resolves_replaced_scan(api, db, storage, capture):
    client, state = api
    house = await _house(db, storage)
    state["user"] = _user(house.id)
    employee = await _employee(db, house)
    letter = await _scan(db, employee, "resignation_letter", f"{house.id}/{employee.id}/letter.jpg")
    await _scan(db, employee, "nid", f"{house.id}/{employee.id}/nid.jpg", "blue")
    doc_type = await _res_type(db)
    template = await _template(db, doc_type, house)
    document_id = await _draft(client, house, template, employee)
    headers = {"X-House-ID": str(house.id)}

    assert (await client.post(f"/api/v1/documents/{document_id}/generate", headers=headers)).status_code == 200
    _write_jpeg(storage / "employee_documents" / letter.storage_path, "green")
    assert (await client.post(f"/api/v1/documents/records/{document_id}/regenerate", headers=headers)).status_code == 200

    figure_uri = re.compile(r'<figure class="doc-image"[^>]*><img src="([^"]+)"')

    def first_scan_uri(html):
        return figure_uri.findall(html)[0]

    first, second = capture["html"]
    assert first_scan_uri(first) != first_scan_uri(second)


@pytest.mark.asyncio
async def test_manual_asset_from_another_template_rejected(api, db, storage, capture):
    client, state = api
    house = await _house(db, storage)
    state["user"] = _user(house.id)
    employee = await _employee(db, house)
    await _scan(db, employee, "resignation_letter", f"{house.id}/{employee.id}/letter.jpg")
    await _scan(db, employee, "nid", f"{house.id}/{employee.id}/nid.jpg", "blue")
    doc_type = await _res_type(db)
    owner = await _template(db, doc_type, house, name="Asset Owner")
    state["user"] = _user(house.id)
    headers = {"X-House-ID": str(house.id)}
    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), "red").save(buffer, "JPEG")
    uploaded = await client.post(
        f"/api/v1/documents/templates/{owner.id}/assets",
        headers=headers,
        files={"file": ("scan.jpg", io.BytesIO(buffer.getvalue()), "image/jpeg")},
    )
    assert uploaded.status_code == 201, uploaded.text
    asset_id = uploaded.json()["data"]["id"]

    other_ast = _ast()
    other_ast["blocks"] = [
        {"type": "image", "source_kind": "manual", "asset_id": asset_id},
    ]
    other = await _template(db, doc_type, house, content=other_ast, name="Asset Thief")
    document_id = await _draft(client, house, other, employee)

    response = await client.post(f"/api/v1/documents/{document_id}/generate", headers=headers)
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "IMAGE_SOURCE_MISSING"
    assert f"manual:{asset_id}" in response.json()["detail"]["sources"]
