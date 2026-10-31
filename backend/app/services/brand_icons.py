import io
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError


MAX_APP_ICON_SIZE = 5 * 1024 * 1024
MAX_FAVICON_SIZE = 1024 * 1024
MAX_IMAGE_DIMENSION = 4096
MAX_IMAGE_PIXELS = 16_000_000
APP_ICON_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}


class BrandIconValidationError(ValueError):
    pass


def _read_image(content: bytes) -> tuple[Image.Image, str]:
    try:
        with Image.open(io.BytesIO(content)) as image:
            image_format = image.format
            image.verify()
        with Image.open(io.BytesIO(content)) as image:
            width, height = image.size
            if (
                width < 1
                or height < 1
                or width > MAX_IMAGE_DIMENSION
                or height > MAX_IMAGE_DIMENSION
                or width * height > MAX_IMAGE_PIXELS
            ):
                raise BrandIconValidationError(
                    f"Image dimensions must not exceed {MAX_IMAGE_DIMENSION}x{MAX_IMAGE_DIMENSION} pixels."
                )
            return ImageOps.exif_transpose(image).convert("RGBA"), image_format
    except BrandIconValidationError:
        raise
    except (OSError, UnidentifiedImageError, Image.DecompressionBombError) as exc:
        raise BrandIconValidationError("The uploaded file is not a valid supported image.") from exc


def generate_app_icon_files(filename: str | None, content: bytes) -> dict[str, bytes]:
    extension = Path(filename or "").suffix.lower()
    if extension not in APP_ICON_EXTENSIONS:
        raise BrandIconValidationError("Upload a PNG, JPG, JPEG, or WEBP image.")
    if not content:
        raise BrandIconValidationError("The uploaded image is empty.")
    if len(content) > MAX_APP_ICON_SIZE:
        raise BrandIconValidationError("The app icon must be 5 MB or smaller.")

    image, image_format = _read_image(content)
    expected_formats = {
        ".png": "PNG",
        ".jpg": "JPEG",
        ".jpeg": "JPEG",
        ".webp": "WEBP",
    }
    if image_format != expected_formats[extension]:
        raise BrandIconValidationError("The file extension does not match the image format.")
    square = ImageOps.fit(image, (512, 512), method=Image.Resampling.LANCZOS)
    files: dict[str, bytes] = {}

    for name, size in (
        ("icon-192.png", 192),
        ("icon-512.png", 512),
        ("apple-touch-icon.png", 180),
    ):
        output = io.BytesIO()
        square.resize((size, size), Image.Resampling.LANCZOS).save(
            output, format="PNG", optimize=True
        )
        files[name] = output.getvalue()

    background = image.getpixel((0, 0))
    if background[3] < 255:
        background = (255, 255, 255, 255)
    maskable = Image.new("RGBA", (512, 512), background)
    safe_image = ImageOps.fit(image, (410, 410), method=Image.Resampling.LANCZOS)
    maskable.alpha_composite(safe_image, (51, 51))
    output = io.BytesIO()
    maskable.save(output, format="PNG", optimize=True)
    files["icon-512-maskable.png"] = output.getvalue()

    output = io.BytesIO()
    square.save(output, format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    files["favicon.ico"] = output.getvalue()
    return files


def validate_favicon_file(filename: str | None, content: bytes) -> bytes:
    extension = Path(filename or "").suffix.lower()
    if extension != ".ico":
        raise BrandIconValidationError("Upload a Windows icon file with the .ico extension.")
    if not content:
        raise BrandIconValidationError("The uploaded favicon is empty.")
    if len(content) > MAX_FAVICON_SIZE:
        raise BrandIconValidationError("The favicon must be 1 MB or smaller.")

    image, _ = _read_image(content)
    try:
        with Image.open(io.BytesIO(content)) as ico:
            if ico.format != "ICO":
                raise BrandIconValidationError("The uploaded file is not a valid ICO image.")
    except BrandIconValidationError:
        raise
    except (OSError, UnidentifiedImageError, Image.DecompressionBombError) as exc:
        raise BrandIconValidationError("The uploaded file is not a valid ICO image.") from exc

    output = io.BytesIO()
    image.save(
        output,
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    return output.getvalue()
