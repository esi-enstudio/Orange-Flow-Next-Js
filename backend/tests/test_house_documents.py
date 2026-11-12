"""House documents: signature storage, scan compression and the API guards."""

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
from app.services import house_documents as hd


def _image_bytes(width=1200, height=1600, fmt="JPEG", noise=False) -> bytes:
    buffer = io.BytesIO()
    if noise:
        image = Image.frombytes("RGB", (width, height), os.urandom(width * height * 3))
    else:
        image = Image.new("RGB", (width, height), "#ffffff")
    image.save(buffer, format=fmt, quality=95)
    return buffer.getvalue()


def _png_signature(width=600, height=200) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGBA", (width, height), (0, 0, 0, 0)).save(buffer, format="PNG")
    return buffer.getvalue()


def _user(house, role="RSO", permissions=()):
    return SimpleNamespace(
        id=1,
        name="Documents Tester",
        status="Active",
        houses=[house],
        roles=[
            SimpleNamespace(
                name=role,
                permissions=[SimpleNamespace(name=p) for p in permissions],
            )
        ],
    )


async def _make_house(db, code="DOC-1", name="Document House"):
    house = House(code=code, name=name, email=f"{code.lower()}@example.com", address="Dhaka")
    db.add(house)
    await db.commit()
    await db.refresh(house)
    return house


@pytest.fixture(autouse=True)
def storage_root(tmp_path, monkeypatch):
    root = tmp_path / "house_documents"
    monkeypatch.setattr(hd, "ROOT", str(root))
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


# --------------------------------------------------------------------------- #
# Storage + compression
# --------------------------------------------------------------------------- #

async def test_document_image_is_downscaled_and_compressed(db, storage_root):
    house = await _make_house(db)
    original = _image_bytes(2000, 2800, noise=True)
    from starlette.datastructures import UploadFile

    doc = await hd.store_document(
        db,
        house,
        UploadFile(filename="scan.jpg", file=io.BytesIO(original)),
        doc_type="trade_license",
        title="Trade Licence",
        uploaded_by=1,
    )
    await db.commit()

    stored_path = hd.document_fs_path(doc)
    assert stored_path and os.path.isfile(stored_path)
    with Image.open(stored_path) as stored:
        assert max(stored.size) <= hd.DOCUMENT_IMAGE_MAX_DIMENSION
        assert stored.format == "JPEG"
    assert os.path.getsize(stored_path) < len(original)
    assert doc.mime_type == "image/jpeg"
    # A re-encoded PNG/WebP keeps an honest file name.
    assert doc.file_name == "scan.jpg"


async def test_store_document_rejects_unsupported_file(db):
    house = await _make_house(db)
    from starlette.datastructures import UploadFile

    with pytest.raises(ValueError):
        await hd.store_document(
            db,
            house,
            UploadFile(filename="virus.exe", file=io.BytesIO(b"MZ")),
            doc_type="other",
            title=None,
            uploaded_by=1,
        )


async def test_signature_is_stored_as_png(db, storage_root):
    house = await _make_house(db)
    from starlette.datastructures import UploadFile

    await hd.store_signature(house, UploadFile(filename="sign.png", file=io.BytesIO(_png_signature())))
    await db.commit()

    path = hd.signature_fs_path(house)
    assert path and os.path.isfile(path)
    assert hd.serialize_signature(house)["has_signature"] is True
    assert hd.signature_data_uri(house).startswith("data:image/png;base64,")

    hd.delete_signature(house)
    await db.commit()
    assert hd.signature_fs_path(house) is None


# --------------------------------------------------------------------------- #
# API
# --------------------------------------------------------------------------- #

async def test_endpoints_require_permission(api, db):
    app, client = api
    house = await _make_house(db)
    app.dependency_overrides[get_current_user] = lambda: _user(house)

    assert (await client.get(f"/api/houses/{house.id}/documents")).status_code == 403


async def test_house_isolation(api, db):
    app, client = api
    own = await _make_house(db, code="DOC-A", name="Own")
    other = await _make_house(db, code="DOC-B", name="Other")
    app.dependency_overrides[get_current_user] = lambda: _user(
        own, permissions=["houses.document_view"]
    )

    response = await client.get(f"/api/houses/{other.id}/documents")

    assert response.status_code == 403


async def test_signature_upload_stream_and_delete(api, db):
    app, client = api
    house = await _make_house(db)
    app.dependency_overrides[get_current_user] = lambda: _user(house, role="Admin")

    upload = await client.post(
        f"/api/houses/{house.id}/signature",
        files={"file": ("sign.png", _png_signature(), "image/png")},
    )
    assert upload.status_code == 200
    assert upload.json()["signature"]["has_signature"] is True

    image = await client.get(f"/api/houses/{house.id}/signature")
    assert image.status_code == 200
    assert image.headers["content-type"] == "image/png"

    letterhead = await client.get(f"/api/houses/{house.id}/letterhead")
    assert letterhead.json()["has_signature"] is True

    removed = await client.delete(f"/api/houses/{house.id}/signature")
    assert removed.status_code == 200
    assert removed.json()["signature"]["has_signature"] is False


async def test_document_upload_list_download_and_delete(api, db):
    app, client = api
    house = await _make_house(db)
    app.dependency_overrides[get_current_user] = lambda: _user(house, role="Admin")

    upload = await client.post(
        f"/api/houses/{house.id}/documents",
        params={"doc_type": "trade_license", "title": "Trade Licence"},
        files={"file": ("licence.jpg", _image_bytes(1400, 2000), "image/jpeg")},
    )
    assert upload.status_code == 200
    doc = upload.json()["document"]
    assert doc["title"] == "Trade Licence"
    assert doc["doc_type"] == "trade_license"

    listing = await client.get(f"/api/houses/{house.id}/documents")
    assert listing.status_code == 200
    assert len(listing.json()["documents"]) == 1
    assert "trade_license" in listing.json()["document_types"]

    download = await client.get(f"/api/houses/{house.id}/documents/{doc['id']}/file")
    assert download.status_code == 200
    assert download.content.startswith(b"\xff\xd8")  # JPEG magic

    removed = await client.delete(f"/api/houses/{house.id}/documents/{doc['id']}")
    assert removed.status_code == 200
    listing = await client.get(f"/api/houses/{house.id}/documents")
    assert listing.json()["documents"] == []
