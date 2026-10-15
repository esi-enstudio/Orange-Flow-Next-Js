"""Employee attachments: profile photo plus scanned documents (NID, certificates, ...).

Storage layout
--------------
Profile photo (public, served through the /uploads mount so it renders in the
employee table without an authenticated round-trip)::

    uploads/employee_photos/{employee_id}/{uuid}.jpg

Documents (private, never mounted - streamed through the authenticated
`/api/employees/{id}/documents/{doc_id}/file` endpoint)::

    private_uploads/employee_documents/{house_id}/{employee_id}/{uuid}{ext}
    private_uploads/employee_documents/_staging/{staged_id}{ext}

Why a staging step?
-------------------
"Register New Employee" creates the employee and its attachments in a single
request, so a file cannot be linked to a primary key that does not exist yet.
Files are therefore uploaded first (`stage_upload`) and later *claimed* by the
create/update payload (`claim_attachments`), which moves them out of staging and
writes the employee_documents rows. Abandoned staging files are purged by
`cleanup_stale_staging_files` on every server start.
"""

import io
import logging
import os
import re
import shutil
import uuid
from datetime import datetime, timedelta
from typing import Iterable, Optional

from fastapi import UploadFile
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee import Employee
from app.models.employee_document import EMPLOYEE_DOCUMENT_TYPES, EmployeeDocument
from app.models.user import User
from app.utils.access_control import is_admin_user
from app.utils.timezone import now_naive

logger = logging.getLogger(__name__)

PRIVATE_STORAGE_ROOT = "private_uploads/employee_documents"
PUBLIC_PHOTO_ROOT = "uploads/employee_photos"
STAGING_DIR = os.path.join(PRIVATE_STORAGE_ROOT, "_staging")

PHOTO_MAX_BYTES = 5 * 1024 * 1024        # 5 MB
DOCUMENT_MAX_BYTES = 10 * 1024 * 1024    # 10 MB
STAGING_MAX_AGE_HOURS = 24
PHOTO_MAX_DIMENSION = 1000

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

# Only control characters are stripped: Bengali/other Unicode letters and their
# combining marks (matras) are NOT part of \w in Python's re, so a whitelist
# would mangle them. Values are display-only - paths are always uuid-based and
# Content-Disposition is RFC 5987-quoted by Starlette.
_CONTROL_CHARS_RE = re.compile(r"[\x00-\x1f\x7f]+")
_STAGED_ID_RE = re.compile(r"^[0-9a-f]{32}$")


# --------------------------------------------------------------------------- #
# storage helpers
# --------------------------------------------------------------------------- #

def ensure_storage_dirs() -> None:
    """Create the storage roots. Safe to call on every start."""
    os.makedirs(STAGING_DIR, exist_ok=True)
    os.makedirs(PUBLIC_PHOTO_ROOT, exist_ok=True)


def user_has_permission(user: User, permission: str) -> bool:
    """Permission check for code paths that are not a FastAPI dependency."""
    if is_admin_user(user):
        return True
    return any(p.name == permission for role in user.roles for p in role.permissions)


def _attr(obj, key: str, default=None):
    """Read a field from a pydantic attachment model or a plain dict."""
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def is_valid_document_type(doc_type: Optional[str]) -> bool:
    return bool(doc_type) and doc_type in EMPLOYEE_DOCUMENT_TYPES


def safe_display_name(original: Optional[str]) -> str:
    """Keep the original name for display/download, stripped of any path parts."""
    # Backslashes are normalised first: on Linux os.path.basename() would keep a
    # Windows-style path ("C:\\docs\\nid.pdf") intact.
    name = os.path.basename((original or "").strip().replace("\\", "/"))
    name = _CONTROL_CHARS_RE.sub("", name).replace("/", "_").strip()
    name = name.lstrip(".").strip()
    return name[:255] or "document"


def safe_title(title: Optional[str]) -> Optional[str]:
    if not title:
        return None
    cleaned = _CONTROL_CHARS_RE.sub("", title).strip()
    return cleaned[:200] or None


def _extension(filename: Optional[str]) -> str:
    return os.path.splitext((filename or "").strip())[1].lower()


def _looks_like(contents: bytes, ext: str) -> bool:
    """Magic-byte check so a renamed executable can never pass as a document."""
    if not contents:
        return False
    head = contents[:16]
    if ext in (".jpg", ".jpeg"):
        return head.startswith(b"\xff\xd8\xff")
    if ext == ".png":
        return head.startswith(b"\x89PNG\r\n\x1a\n")
    if ext == ".webp":
        return len(head) >= 12 and head[0:4] == b"RIFF" and head[8:12] == b"WEBP"
    if ext == ".pdf":
        return head.startswith(b"%PDF")
    if ext in (".docx", ".xlsx"):
        return head.startswith(b"PK\x03\x04")
    if ext == ".doc":
        return head.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1")
    if ext == ".xls":
        # Legacy .xls is an OLE2 container; some exporters still write the newer
        # zip format under the old extension.
        return head.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1") or head.startswith(b"PK\x03\x04")
    return False


def _staged_path(staged_id: Optional[str]) -> Optional[str]:
    """Resolve a staged id to its file, rejecting anything path-like."""
    if not staged_id or not _STAGED_ID_RE.match(staged_id):
        return None
    for ext in DOCUMENT_EXTENSIONS:
        candidate = os.path.join(STAGING_DIR, f"{staged_id}{ext}")
        if os.path.isfile(candidate):
            return candidate
    return None


def _unique_photo_path(employee_id: int) -> str:
    folder = os.path.join(PUBLIC_PHOTO_ROOT, str(employee_id))
    os.makedirs(folder, exist_ok=True)
    return os.path.join(folder, f"{uuid.uuid4().hex}.jpg")


def _unique_document_path(house_id: int, employee_id: int, ext: str) -> str:
    folder = os.path.join(PRIVATE_STORAGE_ROOT, str(house_id), str(employee_id))
    os.makedirs(folder, exist_ok=True)
    return os.path.join(folder, f"{uuid.uuid4().hex}{ext}")


def _delete_file(path: Optional[str]) -> None:
    """Best-effort removal of a stored file. Never raises."""
    if not path:
        return
    try:
        if os.path.isfile(path):
            os.remove(path)
    except OSError as exc:
        logger.warning("Could not delete file %s: %s", path, exc)


def _public_path_to_fs(public_path: Optional[str]) -> Optional[str]:
    """'/uploads/employee_photos/4/x.jpg' -> 'uploads/employee_photos/4/x.jpg'."""
    if not public_path or not public_path.startswith("/uploads/"):
        return None
    return os.path.join("uploads", public_path[len("/uploads/"):])


# --------------------------------------------------------------------------- #
# staging + claiming
# --------------------------------------------------------------------------- #

async def stage_upload(file: UploadFile, kind: str) -> dict:
    """Validate an uploaded file and park it in the staging directory.

    Returns the staged descriptor the client sends back with the create/update
    payload. Raises ValueError with a user-presentable message on rejection.
    """
    if kind not in ("photo", "document"):
        raise ValueError("kind must be 'photo' or 'document'")
    ensure_storage_dirs()

    original_name = safe_display_name(file.filename)
    ext = _extension(original_name)
    max_bytes = PHOTO_MAX_BYTES if kind == "photo" else DOCUMENT_MAX_BYTES
    allowed = IMAGE_EXTENSIONS if kind == "photo" else DOCUMENT_EXTENSIONS

    if ext not in allowed:
        raise ValueError(
            "Profile photos must be JPG, JPEG, PNG or WEBP."
            if kind == "photo"
            else "Allowed document types: PDF, JPG, PNG, WEBP, DOC, DOCX, XLS, XLSX."
        )

    contents = await file.read(max_bytes + 1)
    if len(contents) > max_bytes:
        raise ValueError(f"File is too large. Maximum size is {max_bytes // (1024 * 1024)} MB.")
    if not contents:
        raise ValueError("The uploaded file is empty.")
    if not _looks_like(contents, ext):
        raise ValueError("The file content does not match its extension.")

    staged_id = uuid.uuid4().hex
    staged_ext = ext
    stored_bytes = len(contents)

    if kind == "photo":
        # Normalise the avatar once, here: broken images are caught before the
        # employee is saved and the public file stays small.
        try:
            image = Image.open(io.BytesIO(contents))
            image.load()
        except Exception as exc:  # noqa: BLE001 - surfaced to the user
            logger.warning("Rejected employee photo %s: %s", original_name, exc)
            raise ValueError("The image could not be read. Please choose another photo.") from exc
        if image.mode != "RGB":
            image = image.convert("RGB")
        image.thumbnail((PHOTO_MAX_DIMENSION, PHOTO_MAX_DIMENSION), Image.Resampling.LANCZOS)
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=88, optimize=True)
        data = buffer.getvalue()
        staged_ext = ".jpg"
        stored_bytes = len(data)
    else:
        data = contents

    staged_path = os.path.join(STAGING_DIR, f"{staged_id}{staged_ext}")
    with open(staged_path, "wb") as fh:
        fh.write(data)

    mime_type = (
        "image/jpeg" if kind == "photo"
        else ((file.content_type or "").split(";")[0].strip() or MIME_BY_EXTENSION.get(ext, "application/octet-stream"))
    )
    logger.info("Staged employee %s '%s' (%s bytes)", kind, original_name, stored_bytes)
    return {
        "staged_id": staged_id,
        "kind": kind,
        "original_name": original_name,
        "size": stored_bytes,
        "mime_type": mime_type,
        "is_image": staged_ext in IMAGE_EXTENSIONS,
    }


async def claim_attachments(
    db: AsyncSession,
    employee: Employee,
    attachments: Iterable,
    current_user: User,
) -> dict:
    """Move staged files into permanent storage and link them to the employee.

    Handles the profile photo (replacing + deleting the previous file) and
    normal documents. Missing/already-claimed staged ids are skipped with a
    warning so a retried request can never fail on a consumed upload.
    """
    claimed: list[dict] = []
    photo_replaced = False

    for attachment in attachments:
        staged_id = _attr(attachment, "staged_id")
        kind = (_attr(attachment, "kind") or "document").lower()
        src = _staged_path(staged_id)
        if not src:
            logger.warning("Staged upload %s for employee %s was not found; skipped", staged_id, employee.id)
            continue

        if kind == "photo":
            photo_fs = _unique_photo_path(employee.id)
            shutil.move(src, photo_fs)
            _delete_file(_public_path_to_fs(employee.photo_url))
            employee.photo_url = f"/uploads/employee_photos/{employee.id}/{os.path.basename(photo_fs)}"
            photo_replaced = True
            claimed.append({"kind": "photo", "url": employee.photo_url})
            continue

        doc_type = _attr(attachment, "doc_type")
        if not is_valid_document_type(doc_type):
            doc_type = "other"
        ext = _extension(src)
        dest = _unique_document_path(employee.house_id, employee.id, ext)
        shutil.move(src, dest)
        stored_name = safe_display_name(_attr(attachment, "original_name") or os.path.basename(src))
        doc = EmployeeDocument(
            employee_id=employee.id,
            house_id=employee.house_id,
            doc_type=doc_type,
            title=safe_title(_attr(attachment, "title")) or safe_title(os.path.splitext(stored_name)[0]),
            file_name=stored_name,
            storage_path=os.path.relpath(dest, PRIVATE_STORAGE_ROOT).replace("\\", "/"),
            file_size=os.path.getsize(dest),
            mime_type=MIME_BY_EXTENSION.get(ext, "application/octet-stream"),
            uploaded_by=current_user.id,
        )
        db.add(doc)
        await db.flush()
        claimed.append({"kind": "document", "id": doc.id, "doc_type": doc.doc_type})

    return {"claimed": claimed, "photo_replaced": photo_replaced}


# --------------------------------------------------------------------------- #
# reading / deleting
# --------------------------------------------------------------------------- #

def serialize_document(doc: EmployeeDocument, uploader_name: Optional[str] = None) -> dict:
    """API shape for a single document. Never exposes storage paths."""
    return {
        "id": doc.id,
        "employee_id": doc.employee_id,
        "doc_type": doc.doc_type,
        "title": doc.title,
        "file_name": doc.file_name,
        "file_size": doc.file_size or 0,
        "mime_type": doc.mime_type,
        "is_image": _extension(doc.file_name) in IMAGE_EXTENSIONS,
        "uploaded_by": doc.uploaded_by,
        "uploaded_by_name": uploader_name,
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
        "file_url": f"/api/employees/{doc.employee_id}/documents/{doc.id}/file",
    }


async def list_documents(db: AsyncSession, employee_id: int) -> list[dict]:
    """Active documents of an employee, newest first, with uploader names."""
    result = await db.execute(
        select(EmployeeDocument, User.name)
        .outerjoin(User, User.id == EmployeeDocument.uploaded_by)
        .where(
            EmployeeDocument.employee_id == employee_id,
            EmployeeDocument.is_deleted.is_(False),
        )
        .order_by(EmployeeDocument.created_at.desc(), EmployeeDocument.id.desc())
    )
    return [serialize_document(doc, uploader_name) for doc, uploader_name in result.all()]


async def get_document(db: AsyncSession, employee_id: int, doc_id: int) -> Optional[EmployeeDocument]:
    result = await db.execute(
        select(EmployeeDocument).where(
            EmployeeDocument.id == doc_id,
            EmployeeDocument.employee_id == employee_id,
            EmployeeDocument.is_deleted.is_(False),
        )
    )
    return result.unique().scalar_one_or_none()


def document_file_path(doc: EmployeeDocument) -> Optional[str]:
    """Absolute path of a stored document, guaranteed to stay inside the root."""
    if not doc.storage_path:
        return None
    root = os.path.realpath(PRIVATE_STORAGE_ROOT)
    candidate = os.path.realpath(os.path.join(PRIVATE_STORAGE_ROOT, doc.storage_path))
    if candidate != root and not candidate.startswith(root + os.sep):
        logger.error("Rejected out-of-root document path: %s", doc.storage_path)
        return None
    return candidate if os.path.isfile(candidate) else None


async def soft_delete_documents(
    db: AsyncSession,
    employee: Employee,
    doc_ids: Iterable,
    current_user: User,
) -> list[dict]:
    """Soft delete documents of an employee. Files stay on disk for audit."""
    ids = {int(i) for i in doc_ids if str(i).strip().isdigit()}
    if not ids:
        return []
    result = await db.execute(
        select(EmployeeDocument).where(
            EmployeeDocument.employee_id == employee.id,
            EmployeeDocument.id.in_(ids),
            EmployeeDocument.is_deleted.is_(False),
        )
    )
    deleted = []
    for doc in result.unique().scalars().all():
        doc.is_deleted = True
        doc.deleted_at = now_naive()
        doc.deleted_by = current_user.id
        deleted.append({"id": doc.id, "file_name": doc.file_name, "doc_type": doc.doc_type})
    return deleted


async def clear_employee_photo(employee: Employee) -> Optional[str]:
    """Remove the profile photo (file + column). Returns the previous URL."""
    previous = employee.photo_url
    if not previous:
        return None
    _delete_file(_public_path_to_fs(previous))
    employee.photo_url = None
    return previous


def cleanup_stale_staging_files(max_age_hours: int = STAGING_MAX_AGE_HOURS) -> int:
    """Purge staged uploads that were never claimed (abandoned modal sessions)."""
    if not os.path.isdir(STAGING_DIR):
        return 0
    cutoff = datetime.now() - timedelta(hours=max_age_hours)
    removed = 0
    for name in os.listdir(STAGING_DIR):
        path = os.path.join(STAGING_DIR, name)
        if not os.path.isfile(path):
            continue
        try:
            if datetime.fromtimestamp(os.path.getmtime(path)) < cutoff:
                os.remove(path)
                removed += 1
        except OSError as exc:
            logger.warning("Could not purge stale staged file %s: %s", path, exc)
    if removed:
        logger.info("Purged %s stale staged employee upload(s)", removed)
    return removed
