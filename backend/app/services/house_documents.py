"""House-wise documents: the proprietor signature plus scanned business papers.

Storage layout (private, never mounted - every file is streamed through the
permission-guarded endpoints in `app/routers/houses.py`):::

    private_uploads/house_documents/{house_id}/signature-{uuid}.png
    private_uploads/house_documents/{house_id}/{uuid}{ext}

The letterhead page image has its own storage (`house_letterhead.py`); this
module only owns the signature and the "other documents" list.
"""

import io
import logging
import os
import re
import uuid

from fastapi import UploadFile
from PIL import Image, ImageOps
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.house import House
from app.models.house_document import HOUSE_DOCUMENT_TYPES, HouseDocument
from app.utils.timezone import now_naive

logger = logging.getLogger(__name__)

ROOT = "private_uploads/house_documents"

SIGNATURE_MAX_BYTES = 2 * 1024 * 1024        # 2 MB
SIGNATURE_MIN_WIDTH = 80
SIGNATURE_MAX_DIMENSION = 1200
SIGNATURE_FORMATS = ("JPEG", "PNG", "WEBP")

DOCUMENT_MAX_BYTES = 10 * 1024 * 1024       # 10 MB
# Uploaded scans are re-encoded on the server: 2000px on the long edge is
# readable for a printed A4 page, and JPEG quality 80 keeps a full page scan
# around 200-400 KB instead of several MB. PDFs/office files are stored as-is
# (re-compressing them would need a full document renderer).
DOCUMENT_IMAGE_MAX_DIMENSION = 2000
DOCUMENT_IMAGE_QUALITY = 80

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
DOCUMENT_EXTENSIONS = IMAGE_EXTENSIONS | {".pdf", ".doc", ".docx", ".xls", ".xlsx"}

MIME_BY_EXTENSION = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}

DEFAULT_DOCUMENT_TYPE = "other"

_CONTROL_CHARS_RE = re.compile(r"[\x00-\x1f\x7f]+")


def ensure_storage_dir() -> None:
    os.makedirs(ROOT, exist_ok=True)


def _house_dir(house_id: int) -> str:
    folder = os.path.join(ROOT, str(house_id))
    os.makedirs(folder, exist_ok=True)
    return folder


def _inside_root(relative_path: str):
    """Absolute path for a stored value, or None when it escapes the root."""
    root = os.path.realpath(ROOT)
    candidate = os.path.realpath(os.path.join(ROOT, relative_path))
    if candidate != root and not candidate.startswith(root + os.sep):
        logger.error("Rejected out-of-root house document path: %s", relative_path)
        return None
    return candidate


def _file_extension(file: UploadFile) -> str:
    name = (file.filename or "").strip().lower()
    extension = os.path.splitext(name)[1]
    if extension in DOCUMENT_EXTENSIONS:
        return extension
    return ""


def _clean_name(value: str, limit: int = 200) -> str:
    return _CONTROL_CHARS_RE.sub("", value or "").strip()[:limit]


# --------------------------------------------------------------------------- #
# Proprietor signature
# --------------------------------------------------------------------------- #

def signature_fs_path(house: House):
    """Absolute path of the uploaded signature, or None when missing."""
    rel = getattr(house, "proprietor_signature_path", None)
    if not rel:
        return None
    candidate = _inside_root(rel)
    return candidate if candidate and os.path.isfile(candidate) else None


def delete_signature(house: House) -> None:
    path = signature_fs_path(house)
    if path:
        try:
            os.remove(path)
        except OSError as exc:
            logger.warning("Could not delete proprietor signature %s: %s", path, exc)
    house.proprietor_signature_path = None


async def store_signature(house: House, file: UploadFile) -> str:
    """Validate + normalise the signature image. Raises ValueError.

    PNG is kept as PNG so a transparent scan stays transparent on the
    letterhead; other formats are converted.
    """
    contents = await file.read(SIGNATURE_MAX_BYTES + 1)
    if not contents:
        raise ValueError("The uploaded file is empty.")
    if len(contents) > SIGNATURE_MAX_BYTES:
        raise ValueError("File is too large. Maximum size is 2 MB.")
    try:
        image = Image.open(io.BytesIO(contents))
        image.load()
    except Exception as exc:  # noqa: BLE001 - surfaced to the user
        logger.warning("Rejected signature image %s: %s", file.filename, exc)
        raise ValueError("The image could not be read. Please choose a JPG or PNG file.") from exc

    if (image.format or "").upper() not in SIGNATURE_FORMATS:
        raise ValueError("Unsupported image format. Please choose a JPG or PNG file.")

    image = ImageOps.exif_transpose(image)
    if image.width < SIGNATURE_MIN_WIDTH:
        raise ValueError(
            f"The signature image is too small. Minimum width is {SIGNATURE_MIN_WIDTH}px."
        )
    if image.mode not in ("RGB", "L", "RGBA", "LA"):
        image = image.convert("RGBA" if "transparency" in image.info else "RGB")
    image.thumbnail((SIGNATURE_MAX_DIMENSION, SIGNATURE_MAX_DIMENSION), Image.Resampling.LANCZOS)

    file_name = f"signature-{uuid.uuid4().hex}.png"
    path = os.path.join(_house_dir(house.id), file_name)
    image.save(path, format="PNG", optimize=True)

    delete_signature(house)
    house.proprietor_signature_path = f"{house.id}/{file_name}"
    logger.info("Stored proprietor signature for house %s", house.id)
    return file_name


def signature_data_uri(house: House) -> str:
    """Inline JPEG data URI of the signature (transparency flattened to white)."""
    import base64

    path = signature_fs_path(house)
    if not path:
        return ""
    with open(path, "rb") as handle:
        image = Image.open(io.BytesIO(handle.read()))
        image.load()
    if image.mode in ("RGBA", "LA", "P"):
        image = image.convert("RGBA")
        background = Image.new("RGB", image.size, "white")
        background.paste(image, mask=image.split()[-1])
        image = background
    elif image.mode not in ("RGB", "L"):
        image = image.convert("RGB")
    image.thumbnail((SIGNATURE_MAX_DIMENSION, SIGNATURE_MAX_DIMENSION), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def serialize_signature(house: House) -> dict:
    has_signature = signature_fs_path(house) is not None
    return {
        "has_signature": has_signature,
        "signature_url": f"/api/houses/{house.id}/signature" if has_signature else None,
    }


# --------------------------------------------------------------------------- #
# Other documents
# --------------------------------------------------------------------------- #

def serialize_document(doc: HouseDocument) -> dict:
    return {
        "id": doc.id,
        "house_id": doc.house_id,
        "doc_type": doc.doc_type,
        "title": doc.title or "",
        "file_name": doc.file_name,
        "file_size": doc.file_size,
        "mime_type": doc.mime_type or "",
        "uploaded_by": doc.uploaded_by,
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
        "download_url": f"/api/houses/{doc.house_id}/documents/{doc.id}/file",
    }


def document_fs_path(doc: HouseDocument):
    candidate = _inside_root(doc.storage_path or "")
    return candidate if candidate and os.path.isfile(candidate) else None


async def list_documents(db: AsyncSession, house_id: int) -> list[HouseDocument]:
    result = await db.execute(
        select(HouseDocument)
        .where(HouseDocument.house_id == house_id)
        .where(HouseDocument.is_deleted.is_(False))
        .order_by(HouseDocument.created_at.desc(), HouseDocument.id.desc())
    )
    return list(result.scalars().all())


async def store_document(
    db: AsyncSession,
    house: House,
    file: UploadFile,
    doc_type: str,
    title: str | None,
    uploaded_by: int | None,
) -> HouseDocument:
    """Validate + persist an uploaded document. Raises ValueError."""
    doc_type = (doc_type or DEFAULT_DOCUMENT_TYPE).strip().lower()
    if doc_type not in HOUSE_DOCUMENT_TYPES:
        raise ValueError("Unknown document type.")

    contents = await file.read(DOCUMENT_MAX_BYTES + 1)
    if not contents:
        raise ValueError("The uploaded file is empty.")
    if len(contents) > DOCUMENT_MAX_BYTES:
        raise ValueError("File is too large. Maximum size is 10 MB.")

    original_name = _clean_name(file.filename or "")
    extension = _file_extension(file)
    if not extension:
        raise ValueError(
            "Unsupported file type. Allowed: JPG, PNG, WEBP, PDF, DOC, DOCX, XLS, XLSX."
        )
    # Images are verified by content, not only by their extension, and stored
    # downscaled + re-encoded so a phone photo does not cost the storage many MB.
    if extension in IMAGE_EXTENSIONS:
        try:
            image = Image.open(io.BytesIO(contents))
            image.load()
        except Exception as exc:  # noqa: BLE001 - surfaced to the user
            logger.warning("Rejected house document image %s: %s", original_name, exc)
            raise ValueError("The image could not be read. Please choose a valid file.") from exc
        image = ImageOps.exif_transpose(image)
        if image.mode in ("RGBA", "LA", "P"):
            image = image.convert("RGBA")
            background = Image.new("RGB", image.size, "white")
            background.paste(image, mask=image.split()[-1])
            image = background
        elif image.mode not in ("RGB", "L"):
            image = image.convert("RGB")
        image.thumbnail(
            (DOCUMENT_IMAGE_MAX_DIMENSION, DOCUMENT_IMAGE_MAX_DIMENSION),
            Image.Resampling.LANCZOS,
        )
        buffer = io.BytesIO()
        image.save(
            buffer,
            format="JPEG",
            quality=DOCUMENT_IMAGE_QUALITY,
            optimize=True,
            progressive=True,
        )
        contents = buffer.getvalue()
        # A PNG screenshot becomes a much smaller JPEG; keep the name honest.
        extension = ".jpg"
        original_name = os.path.splitext(original_name)[0] + ".jpg"

    storage_name = f"{uuid.uuid4().hex}{extension}"
    folder = _house_dir(house.id)
    with open(os.path.join(folder, storage_name), "wb") as handle:
        handle.write(contents)

    doc = HouseDocument(
        house_id=house.id,
        doc_type=doc_type,
        title=_clean_name(title or "", 200) or original_name[:200],
        file_name=original_name[:255],
        storage_path=f"{house.id}/{storage_name}",
        file_size=len(contents),
        mime_type=MIME_BY_EXTENSION.get(extension, file.content_type or ""),
        uploaded_by=uploaded_by,
    )
    db.add(doc)
    logger.info("Stored %s document for house %s", doc_type, house.id)
    return doc


def delete_document(doc: HouseDocument, deleted_by: int | None) -> None:
    path = document_fs_path(doc)
    if path:
        try:
            os.remove(path)
        except OSError as exc:
            logger.warning("Could not delete house document %s: %s", path, exc)
    doc.is_deleted = True
    doc.deleted_at = now_naive()
    doc.deleted_by = deleted_by
