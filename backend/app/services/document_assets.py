"""Private, normalized image storage for document letterheads and signatories."""

import io
import logging
import os
import uuid

from fastapi import UploadFile
from PIL import Image, ImageOps

PRIVATE_ROOT = "private_uploads"
DOCUMENT_ASSET_ROOT = "documents"
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_IMAGE_DIMENSION = 2480
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}

logger = logging.getLogger(__name__)


def image_fs_path(relative_path: str | None) -> str | None:
    if not relative_path:
        return None
    root = os.path.realpath(PRIVATE_ROOT)
    candidate = os.path.realpath(os.path.join(PRIVATE_ROOT, relative_path))
    if candidate == root or not candidate.startswith(root + os.sep):
        logger.error("Rejected out-of-root document image path")
        return None
    return candidate if os.path.isfile(candidate) else None


def remove_image(relative_path: str | None) -> None:
    path = image_fs_path(relative_path)
    if path:
        os.remove(path)


async def store_image(
    file: UploadFile,
    *,
    house_id: int | None,
    resource: str,
    record_id: int,
) -> str:
    contents = await file.read(MAX_IMAGE_BYTES + 1)
    if not contents:
        raise ValueError("The uploaded file is empty.")
    if len(contents) > MAX_IMAGE_BYTES:
        raise ValueError("File is too large. Maximum size is 5 MB.")

    try:
        image = Image.open(io.BytesIO(contents))
        image.load()
    except Exception as exc:
        logger.info("Rejected unreadable document image upload: %s", exc)
        raise ValueError("The image could not be read. Choose a JPG, PNG or WEBP file.") from exc

    if (image.format or "").upper() not in ALLOWED_FORMATS:
        raise ValueError("Unsupported image format. Choose a JPG, PNG or WEBP file.")

    image = ImageOps.exif_transpose(image)
    if image.width < 1 or image.height < 1:
        raise ValueError("The image dimensions are invalid.")
    image.thumbnail((MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION), Image.Resampling.LANCZOS)
    if image.mode in ("RGBA", "LA") or "transparency" in image.info:
        rgba = image.convert("RGBA")
        background = Image.new("RGB", rgba.size, "white")
        background.paste(rgba, mask=rgba.getchannel("A"))
        image = background
    elif image.mode not in ("RGB", "L"):
        image = image.convert("RGB")

    scope = str(house_id) if house_id is not None else "global"
    relative_dir = os.path.join(DOCUMENT_ASSET_ROOT, scope, resource, str(record_id))
    absolute_dir = os.path.join(PRIVATE_ROOT, relative_dir)
    os.makedirs(absolute_dir, exist_ok=True)
    file_name = f"{uuid.uuid4().hex}.jpg"
    absolute_path = os.path.join(absolute_dir, file_name)
    try:
        image.save(absolute_path, format="JPEG", quality=88, optimize=True)
    except OSError:
        logger.exception("Could not save normalized document image")
        raise
    return os.path.join(relative_dir, file_name)
