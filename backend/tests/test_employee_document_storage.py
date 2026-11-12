"""Employee attachment storage: image compression and the 2 MB upload cap."""

import io
import os

import pytest
from fastapi import UploadFile
from PIL import Image

from app.services import employee_documents as ed


def _image_bytes(fmt: str, size=(640, 480)) -> bytes:
    image = Image.effect_noise(size, 80).convert("RGB")
    buffer = io.BytesIO()
    image.save(buffer, format=fmt)
    return buffer.getvalue()


def _isolate_storage(monkeypatch, tmp_path):
    monkeypatch.setattr(ed, "STAGING_DIR", str(tmp_path / "staging"))
    monkeypatch.setattr(ed, "PRIVATE_STORAGE_ROOT", str(tmp_path / "documents"))
    monkeypatch.setattr(ed, "PUBLIC_PHOTO_ROOT", str(tmp_path / "photos"))


def test_compressed_image_is_webp_at_the_same_resolution():
    original = _image_bytes("PNG")

    compressed = ed._compressed_image(original, ed.DOCUMENT_MAX_BYTES)

    assert len(compressed) < len(original)
    with Image.open(io.BytesIO(compressed)) as result:
        assert result.format == "WEBP"
        assert result.size == (640, 480)


async def test_stage_photo_stores_a_compressed_webp(monkeypatch, tmp_path):
    _isolate_storage(monkeypatch, tmp_path)
    upload = UploadFile(filename="me.png", file=io.BytesIO(_image_bytes("PNG")))

    staged = await ed.stage_upload(upload, "photo")

    assert staged["original_name"] == "me.webp"
    stored = os.path.join(ed.STAGING_DIR, f"{staged['staged_id']}.webp")
    assert os.path.getsize(stored) <= ed.PHOTO_MAX_BYTES
    with Image.open(stored) as result:
        assert result.format == "WEBP"
        assert result.size == (640, 480)


async def test_stage_document_converts_image_to_webp(monkeypatch, tmp_path):
    _isolate_storage(monkeypatch, tmp_path)
    upload = UploadFile(filename="nid.png", file=io.BytesIO(_image_bytes("PNG")))

    staged = await ed.stage_upload(upload, "document")

    assert staged["original_name"] == "nid.webp"
    assert staged["is_image"] is True
    assert os.path.isfile(os.path.join(ed.STAGING_DIR, f"{staged['staged_id']}.webp"))


async def test_stage_rejects_files_over_two_megabytes(monkeypatch, tmp_path):
    _isolate_storage(monkeypatch, tmp_path)
    oversized = b"\xff\xd8\xff" + b"0" * ed.DOCUMENT_MAX_BYTES
    upload = UploadFile(filename="big.pdf", file=io.BytesIO(oversized))

    with pytest.raises(ValueError, match="Maximum size is 2 MB"):
        await ed.stage_upload(upload, "document")
