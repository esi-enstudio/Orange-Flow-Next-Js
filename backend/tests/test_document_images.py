"""House-scoped image resolution for dynamic employee scans."""

import pytest
from PIL import Image

from app.models.employee import Employee
from app.models.employee_document import EmployeeDocument
from app.models.house import House
from app.services import document_ast, document_images, document_render, employee_documents


@pytest.fixture(autouse=True)
def storage_root(tmp_path, monkeypatch):
    root = tmp_path / "employee_documents"
    monkeypatch.setattr(employee_documents, "PRIVATE_STORAGE_ROOT", str(root))
    monkeypatch.setattr(document_render, "PRIVATE_ROOT", str(tmp_path))
    return tmp_path


async def _house_and_employee(db, code="IMG-1", employee_type="rso"):
    house = House(code=code, name="Image House", email="img@example.com", address="Chattogram")
    db.add(house)
    await db.flush()
    employee = Employee(
        house_id=house.id,
        dms_code=f"DMS-{code}",
        itop_number=f"IT-{code}",
        employee_name="Md Karim",
        fathers_name="Md Rahim",
        nid="1234567890123",
        employee_type=employee_type,
        status="Resigned",
        employee_id=f"EMP-{code}",
        joining_date="2021-01-15",
        resigned_date="2026-06-30",
    )
    db.add(employee)
    await db.commit()
    await db.refresh(house)
    await db.refresh(employee)
    return house, employee


def _write_jpeg(root, rel_path):
    path = root / rel_path
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (8, 8), "red").save(path, "JPEG")
    return path


async def _add_scan(db, employee, doc_type, rel_path, *, house_id=None):
    doc = EmployeeDocument(
        employee_id=employee.id,
        house_id=house_id if house_id is not None else employee.house_id,
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


def _ast(*blocks):
    return document_ast.validate_ast(
        {
            "schema_version": 2,
            "page": {"orientation": "portrait"},
            "blocks": list(blocks),
        }
    )


@pytest.mark.asyncio
async def test_resolves_uploaded_letter_and_nid_for_selected_employee(db, storage_root):
    house, employee = await _house_and_employee(db)
    letter_rel = f"{house.id}/{employee.id}/letter.jpg"
    nid_rel = f"{house.id}/{employee.id}/nid.jpg"
    _write_jpeg(storage_root / "employee_documents", letter_rel)
    _write_jpeg(storage_root / "employee_documents", nid_rel)
    await _add_scan(db, employee, "resignation_letter", letter_rel)
    await _add_scan(db, employee, "nid", nid_rel)

    images, missing = await document_images.resolve_image_sources(
        db,
        house_id=house.id,
        template_id=1,
        employee=employee,
        ast=_ast(
            {"type": "image", "source_kind": "dynamic", "source": "resignation_letter"},
            {"type": "image", "source_kind": "dynamic", "source": "employee_nid"},
        ),
    )

    assert set(images) == {"resignation_letter", "employee_nid"}
    assert all(value.startswith("data:image/jpeg;base64,") for value in images.values())
    assert missing == []


@pytest.mark.asyncio
async def test_resolve_never_reads_other_house(db, storage_root):
    house, employee = await _house_and_employee(db)
    other_house, _ = await _house_and_employee(db, code="IMG-2")
    rel = f"{other_house.id}/{employee.id}/foreign.jpg"
    _write_jpeg(storage_root / "employee_documents", rel)
    await _add_scan(db, employee, "resignation_letter", rel, house_id=other_house.id)

    images, missing = await document_images.resolve_image_sources(
        db,
        house_id=house.id,
        template_id=1,
        employee=employee,
        ast=_ast(
            {"type": "image", "source_kind": "dynamic", "source": "resignation_letter"}
        ),
    )

    assert images == {}
    assert "resignation_letter" in missing


@pytest.mark.asyncio
async def test_resolve_ignores_client_path(db, storage_root):
    house, employee = await _house_and_employee(db)
    rel = f"{house.id}/{employee.id}/letter.jpg"
    _write_jpeg(storage_root / "employee_documents", rel)
    await _add_scan(db, employee, "resignation_letter", rel)

    images, missing = await document_images.resolve_image_sources(
        db,
        house_id=house.id,
        template_id=1,
        employee=employee,
        ast=_ast(
            {
                "type": "image",
                "source_kind": "dynamic",
                "source": "resignation_letter",
                "storage_path": "../../etc/passwd",
                "src": "https://example.com/evil.jpg",
            }
        ),
    )

    assert list(images) == ["resignation_letter"]
    assert "root:" not in images["resignation_letter"]
    assert missing == []


@pytest.mark.asyncio
async def test_missing_file_is_reported_not_raised(db, storage_root):
    house, employee = await _house_and_employee(db)
    await _add_scan(db, employee, "nid", f"{house.id}/{employee.id}/gone.jpg")

    images, missing = await document_images.resolve_image_sources(
        db,
        house_id=house.id,
        template_id=1,
        employee=employee,
        ast=_ast(
            {"type": "image", "source_kind": "dynamic", "source": "employee_nid"}
        ),
    )

    assert images == {}
    assert missing == ["employee_nid"]
