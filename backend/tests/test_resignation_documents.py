"""Resignation package: Bangla formatting, gating codes and the 3-page PDF."""

import io
import os
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from PIL import Image

from app.models.employee import Employee
from app.models.employee_document import EmployeeDocument
from app.models.house import House
from app.routers import employees as employees_router
from app.routers.deps import get_current_user, get_db
from app.routers.employees import router
from app.services import house_letterhead as hl
from app.services import resignation_pdf as rp


def _user(house, role="RSO", permissions=()):
    return SimpleNamespace(
        id=1,
        name="Resignation Tester",
        status="Active",
        houses=[house],
        roles=[
            SimpleNamespace(
                name=role,
                permissions=[SimpleNamespace(name=p) for p in permissions],
            )
        ],
    )


@pytest.fixture(autouse=True)
def storage_root(tmp_path, monkeypatch):
    root = tmp_path / "letterheads"
    monkeypatch.setattr(hl, "LETTERHEAD_ROOT", str(root))
    return root


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


async def _resigned_employee(db, status="Resigned"):
    house = House(code="RSN-1", name="Resignation House", email="rsn@example.com", address="Chattogram")
    db.add(house)
    await db.flush()
    employee = Employee(
        house_id=house.id,
        dms_code="RS000111",
        itop_number="1915270101",
        employee_name="Md Karim",
        fathers_name="Md Rahim",
        nid="1234567890123",
        employee_type="rso",
        status=status,
        employee_id="RSO-0111",
        joining_date="2021-01-15",
        resigned_date="2026-06-30",
    )
    db.add(employee)
    await db.commit()
    await db.refresh(house)
    await db.refresh(employee)
    return house, employee


async def _add_document(db, employee, doc_type, name):
    doc = EmployeeDocument(
        employee_id=employee.id,
        house_id=employee.house_id,
        doc_type=doc_type,
        file_name=f"{name}.jpg",
        storage_path=f"{employee.id}/{name}.jpg",
        file_size=10,
        mime_type="image/jpeg",
        is_deleted=False,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return doc


async def _configure_letterhead(db, house):
    house.letterhead_image_path = f"{house.id}/page.jpg"
    house.letterhead_layout = hl.default_layout()
    await db.commit()
    image = os.path.join(hl.LETTERHEAD_ROOT, str(house.id), "page.jpg")
    os.makedirs(os.path.dirname(image), exist_ok=True)
    buffer = io.BytesIO()
    Image.new("RGB", (1200, 1600), "#ffffff").save(buffer, format="JPEG")
    with open(image, "wb") as fh:
        fh.write(buffer.getvalue())


# --------------------------------------------------------------------------- #
# Bangla helpers
# --------------------------------------------------------------------------- #

def test_bn_date_uses_bangla_digits_and_months():
    assert rp.bn_date("2026-06-30") == "৩০ জুন ২০২৬"
    assert rp.bn_date("2021-01-15") == "১৫ জানুয়ারি ২০২১"
    assert rp.bn_date(None) == ""
    assert rp.bn_date("unknown") == "unknown"


def test_bn_digits_translates_only_digits():
    assert rp.bn_digits("NID 1234") == "NID ১২৩৪"


def test_application_page_escapes_tenant_text():
    house = House(code="ESC", name="House <b>X</b>", address="<script>alert(1)</script>")
    house.letterhead_layout = hl.default_layout()
    values = rp.sample_values(house)
    values["employee_name"] = "<img src=x onerror=alert(1)>"

    page = rp.build_application_page(house, values, image_uri="data:image/jpeg;base64,AAA")

    assert "&lt;img" in page
    assert "<img src=x" not in page


def test_application_page_has_body_and_six_positioned_fields():
    house = House(code="BLK", name="Block House", address="Dhaka")
    house.letterhead_layout = hl.default_layout()

    page = rp.build_application_page(
        house, rp.sample_values(house), image_uri="data:image/jpeg;base64,AAA"
    )

    # One body block + the six dynamic value blocks.
    assert page.count('<div class="t') == 7
    assert "১২৩৪৫৬৭৮৯০১২৩" in page  # NID rendered in Bangla digits
    assert "মোঃ আব্দুল করিম" in page


def test_noc_template_fills_employee_and_proprietor_values():
    house = House(
        code="NOC-1",
        name="পাটোয়ারী টেলিকম",
        address="বঙ্গবন্ধু সরণি রোড, ভৈরব, কিশোরগঞ্জ",
        proprietor_name="সামছুজ্জামান পাটোয়ারী",
        proprietor_contact="০১৯১৭৭৪৭৫৫৫",
    )
    house.letterhead_layout = hl.default_layout()

    page = rp.build_application_page(house, rp.sample_values(house), image_uri="data:image/jpeg;base64,AAA")

    # Every placeholder resolves — nothing is left as a raw token.
    assert "{{" not in page
    assert "No Objection Certificate" in page
    assert "RSO (Retail Sales Officer)" in page
    assert "সামছুজ্জামান পাটোয়ারী" in page
    assert "০১৯১৭৭৪৭৫৫৫" in page


def test_document_html_is_a4():
    html = rp.build_document_html(["<div>1</div>", "<div>2</div>", "<div>3</div>"])

    assert html.count("<div>") == 3
    assert "@page{size:A4;margin:0}" in html


# --------------------------------------------------------------------------- #
# API guards
# --------------------------------------------------------------------------- #

async def test_requires_permission(api, db):
    app, client = api
    house, employee = await _resigned_employee(db)
    app.dependency_overrides[get_current_user] = lambda: _user(house)

    response = await client.get(f"/api/employees/{employee.id}/resignation-documents")

    assert response.status_code == 403


async def test_house_isolation(api, db):
    app, client = api
    own, _ = await _resigned_employee(db)
    other = House(code="RSN-2", name="Other", email="o@example.com")
    db.add(other)
    await db.flush()
    foreign = Employee(house_id=other.id, dms_code="RS000222", employee_name="Other", employee_type="rso", status="Resigned")
    db.add(foreign)
    await db.commit()
    app.dependency_overrides[get_current_user] = lambda: _user(
        own, permissions=["employees.resignation_view"]
    )

    response = await client.get(f"/api/employees/{foreign.id}/resignation-documents")

    assert response.status_code == 403


async def test_documents_endpoint_reports_missing_pieces(api, db):
    app, client = api
    house, employee = await _resigned_employee(db)
    app.dependency_overrides[get_current_user] = lambda: _user(house, role="Admin")

    response = await client.get(f"/api/employees/{employee.id}/resignation-documents")

    assert response.status_code == 200
    body = response.json()
    assert body["missing"] == ["resignation_letter", "nid", "letterhead"]
    assert body["can_generate"] is False


async def test_overview_lists_only_resigned_with_readiness(api, db):
    app, client = api
    house, employee = await _resigned_employee(db)
    db.add(Employee(house_id=house.id, dms_code="RS000333", employee_name="Still Active", employee_type="rso", status="Active"))
    db.add(Employee(house_id=house.id, dms_code="RS000444", employee_name="A Manager", employee_type="manager", status="Resigned"))
    await db.commit()
    app.dependency_overrides[get_current_user] = lambda: _user(house, role="Admin")

    response = await client.get("/api/employees/resignation-overview")

    assert response.status_code == 200
    body = response.json()
    # Active employees and non-RSO/BP types never appear in the picker.
    assert [row["dms_code"] for row in body["data"]] == ["RS000111"]
    row = body["data"][0]
    assert row["itop_number"] == "1915270101"
    assert row["house_code"] == "RSN-1"
    assert row["missing"] == ["resignation_letter", "nid", "letterhead"]
    assert row["ready"] is False
    assert body["pagination"]["total"] == 1


async def test_overview_reports_ready_when_all_pieces_exist(api, db):
    app, client = api
    house, employee = await _resigned_employee(db)
    await _add_document(db, employee, "resignation_letter", "letter")
    await _add_document(db, employee, "voter_id", "nid")
    await _configure_letterhead(db, house)
    app.dependency_overrides[get_current_user] = lambda: _user(house, role="Admin")

    response = await client.get("/api/employees/resignation-overview")

    assert response.status_code == 200
    row = response.json()["data"][0]
    assert row["missing"] == []
    assert row["ready"] is True


async def test_generation_blocks_with_codes(api, db):
    app, client = api
    house, employee = await _resigned_employee(db)
    app.dependency_overrides[get_current_user] = lambda: _user(house, role="Admin")

    missing_letter = await client.post(f"/api/employees/{employee.id}/resignation-package")
    assert missing_letter.status_code == 422
    assert missing_letter.json()["detail"]["code"] == "RESIGNATION_LETTER_MISSING"

    await _add_document(db, employee, "resignation_letter", "letter")
    missing_nid = await client.post(f"/api/employees/{employee.id}/resignation-package")
    assert missing_nid.json()["detail"]["code"] == "NID_MISSING"

    await _add_document(db, employee, "nid", "nid")
    missing_letterhead = await client.post(f"/api/employees/{employee.id}/resignation-package")
    assert missing_letterhead.json()["detail"]["code"] == "LETTERHEAD_NOT_CONFIGURED"


async def test_generation_requires_resigned_status(api, db):
    app, client = api
    house, employee = await _resigned_employee(db, status="Active")
    app.dependency_overrides[get_current_user] = lambda: _user(house, role="Admin")

    response = await client.post(f"/api/employees/{employee.id}/resignation-package")

    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "EMPLOYEE_NOT_RESIGNED"


async def test_generation_returns_pdf(api, db, tmp_path, monkeypatch):
    app, client = api
    house, employee = await _resigned_employee(db)
    app.dependency_overrides[get_current_user] = lambda: _user(house, role="Admin")
    letter = await _add_document(db, employee, "resignation_letter", "letter")
    nid = await _add_document(db, employee, "nid", "nid")
    await _configure_letterhead(db, house)

    paths = {}
    for doc in (letter, nid):
        path = tmp_path / f"{doc.doc_type}.jpg"
        buffer = io.BytesIO()
        Image.new("RGB", (600, 400), "#eeeeee").save(buffer, format="JPEG")
        path.write_bytes(buffer.getvalue())
        paths[doc.id] = str(path)

    monkeypatch.setattr(employees_router, "document_file_path", lambda doc: paths[doc.id])

    rendered = {}

    async def _fake_render(html):
        rendered["html"] = html
        return b"%PDF-1.4 resignation"

    monkeypatch.setattr(employees_router, "render_pdf", _fake_render)
    response = await client.post(f"/api/employees/{employee.id}/resignation-package")

    assert response.status_code == 200
    assert response.content == b"%PDF-1.4 resignation"
    assert response.headers["content-type"] == "application/pdf"
    assert "Resignation_RS000111.pdf" in response.headers["content-disposition"]
    assert "৩০ জুন ২০২৬" in rendered["html"]  # resignation date is Bangla
