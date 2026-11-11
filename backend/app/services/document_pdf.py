"""Private PDF persistence for immutable generated-document versions."""

import logging
import os
import uuid

from app.services.resignation_pdf import render_pdf as render_with_chromium

PRIVATE_ROOT = "private_uploads"
GENERATED_ROOT = "documents/generated"
logger = logging.getLogger(__name__)


async def render_pdf(html_document: str) -> bytes:
    """Use the existing JS-disabled, network-blocked Chromium PDF engine."""
    return await render_with_chromium(html_document)


def store_pdf(*, document_id: int, content: bytes) -> str:
    if not content:
        raise ValueError("PDF renderer returned an empty file")
    relative_dir = os.path.join(GENERATED_ROOT, str(document_id))
    absolute_dir = os.path.join(PRIVATE_ROOT, relative_dir)
    os.makedirs(absolute_dir, mode=0o700, exist_ok=True)
    file_name = f"{uuid.uuid4().hex}.pdf"
    relative_path = os.path.join(relative_dir, file_name)
    absolute_path = os.path.join(PRIVATE_ROOT, relative_path)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    descriptor = os.open(absolute_path, flags, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as file_handle:
            file_handle.write(content)
            file_handle.flush()
            os.fsync(file_handle.fileno())
    except Exception:
        try:
            os.remove(absolute_path)
        except OSError:
            logger.exception("Could not remove incomplete document PDF")
        raise
    return relative_path


def pdf_fs_path(relative_path: str | None) -> str | None:
    if not relative_path:
        return None
    root = os.path.realpath(PRIVATE_ROOT)
    candidate = os.path.realpath(os.path.join(PRIVATE_ROOT, relative_path))
    if candidate == root or not candidate.startswith(root + os.sep):
        logger.error("Rejected out-of-root generated PDF path")
        return None
    return candidate if os.path.isfile(candidate) else None


def remove_pdf(relative_path: str | None) -> None:
    path = pdf_fs_path(relative_path)
    if path:
        os.remove(path)
