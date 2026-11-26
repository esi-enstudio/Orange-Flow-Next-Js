"""Private image assets referenced by a template's manual image blocks.

Only an asset id from a validated AST can select a file. The stored path is
relative to ``private_uploads`` and is re-checked against the asset root before
it is read, so a forged path can never escape private storage.
"""

import io
import logging
import os
import uuid

from fastapi import UploadFile
from PIL import Image, ImageOps
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.documents import DocumentTemplateAsset
from app.services import document_render

logger = logging.getLogger(__name__)

ASSET_ROOT = os.path.join("private_uploads", "document_template_assets")
ASSET_PREFIX = "document_template_assets"
MAX_IMAGE_BYTES = 2 * 1024 * 1024
MAX_IMAGE_DIMENSION = 2480
ALLOWED_CONTENT_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})
ALLOWED_FORMATS = frozenset({"JPEG", "PNG", "WEBP"})


class InvalidAssetImage(ValueError):
    """An upload that is not a supported image or exceeds the size limit."""


def fs_path(relative_path: str | None) -> str | None:
    """Resolve a stored asset path, rejecting anything outside the asset root."""
    if not relative_path:
        return None
    normalized = relative_path.replace("\\", "/")
    if not normalized.startswith(ASSET_PREFIX + "/"):
        logger.error("Rejected out-of-root template asset path")
        return None
    inner = normalized[len(ASSET_PREFIX) + 1 :]
    root = os.path.realpath(ASSET_ROOT)
    candidate = os.path.realpath(os.path.join(ASSET_ROOT, inner))
    if candidate == root or not candidate.startswith(root + os.sep):
        logger.error("Rejected out-of-root template asset path")
        return None
    return candidate if os.path.isfile(candidate) else None


def image_data_uri(relative_path: str | None) -> str | None:
    """Embed a stored asset as a re-encoded data URI; never trust the path."""
    path = fs_path(relative_path)
    if not path:
        return None
    try:
        with open(path, "rb") as handle:
            return document_render._image_data_uri(handle.read())
    except Exception as exc:  # noqa: BLE001 - a broken scan must not kill rendering
        logger.warning("Could not embed template asset %s: %s", relative_path, exc)
        return None


async def store(
    db: AsyncSession,
    *,
    template,
    house_id: int | None,
    file: UploadFile,
    user,
) -> DocumentTemplateAsset:
    """Normalise and persist one uploaded image; the caller commits."""
    if (file.content_type or "").lower() not in ALLOWED_CONTENT_TYPES:
        raise InvalidAssetImage("Choose a JPG, PNG or WEBP image.")

    contents = await file.read(MAX_IMAGE_BYTES + 1)
    if not contents:
        raise InvalidAssetImage("The uploaded file is empty.")
    if len(contents) > MAX_IMAGE_BYTES:
        raise InvalidAssetImage("The image is too large. Maximum size is 2 MB.")

    try:
        image = Image.open(io.BytesIO(contents))
        image.load()
    except Exception as exc:
        raise InvalidAssetImage("The image could not be read.") from exc
    if (image.format or "").upper() not in ALLOWED_FORMATS:
        raise InvalidAssetImage("Choose a JPG, PNG or WEBP image.")

    image = ImageOps.exif_transpose(image)
    if image.width < 1 or image.height < 1:
        raise InvalidAssetImage("The image dimensions are invalid.")
    image.thumbnail((MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION), Image.Resampling.LANCZOS)
    if image.mode in ("RGBA", "LA") or "transparency" in image.info:
        rgba = image.convert("RGBA")
        background = Image.new("RGB", rgba.size, "white")
        background.paste(rgba, mask=rgba.getchannel("A"))
        image = background
    elif image.mode not in ("RGB", "L"):
        image = image.convert("RGB")

    scope = str(house_id) if house_id is not None else "global"
    relative_dir = os.path.join(ASSET_PREFIX, scope, str(template.id))
    absolute_dir = os.path.join(ASSET_ROOT, scope, str(template.id))
    os.makedirs(absolute_dir, exist_ok=True)
    file_name = f"{uuid.uuid4().hex}.jpg"
    absolute_path = os.path.join(absolute_dir, file_name)
    image.save(absolute_path, format="JPEG", quality=88, optimize=True)

    asset = DocumentTemplateAsset(
        template_id=template.id,
        house_id=house_id,
        file_name=file.filename or file_name,
        storage_path=os.path.join(relative_dir, file_name),
        content_type="image/jpeg",
        size_bytes=os.path.getsize(absolute_path),
        created_by=getattr(user, "id", None),
        updated_by=getattr(user, "id", None),
    )
    db.add(asset)
    await db.flush()
    return asset


async def load_for_render(
    db: AsyncSession,
    *,
    template_id: int,
    asset_id: int,
    house_id: int | None,
) -> DocumentTemplateAsset | None:
    """Load a live asset only when it belongs to this template and house scope."""
    result = await db.execute(
        select(DocumentTemplateAsset).where(
            DocumentTemplateAsset.id == asset_id,
            DocumentTemplateAsset.template_id == template_id,
            DocumentTemplateAsset.is_deleted.is_(False),
            or_(
                DocumentTemplateAsset.house_id.is_(None),
                DocumentTemplateAsset.house_id == house_id,
            ),
        )
    )
    return result.unique().scalar_one_or_none()
