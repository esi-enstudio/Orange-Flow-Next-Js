import io

import pytest
from PIL import Image

from app.services.brand_icons import (
    BrandIconValidationError,
    generate_app_icon_files,
    validate_favicon_file,
)


def _image_bytes(image_format: str = "PNG") -> bytes:
    image = Image.new(
        "RGB" if image_format == "JPEG" else "RGBA",
        (64, 64),
        (249, 115, 22) if image_format == "JPEG" else (249, 115, 22, 255),
    )
    output = io.BytesIO()
    image.save(output, format=image_format)
    return output.getvalue()


def test_app_icon_upload_generates_all_supported_sizes():
    files = generate_app_icon_files("brand.png", _image_bytes())

    assert set(files) == {
        "favicon.ico",
        "icon-192.png",
        "icon-512.png",
        "icon-512-maskable.png",
        "apple-touch-icon.png",
    }
    for filename, size in (
        ("icon-192.png", 192),
        ("icon-512.png", 512),
        ("icon-512-maskable.png", 512),
        ("apple-touch-icon.png", 180),
    ):
        with Image.open(io.BytesIO(files[filename])) as icon:
            assert icon.size == (size, size)
    with Image.open(io.BytesIO(files["favicon.ico"])) as favicon:
        assert favicon.format == "ICO"
        assert (16, 16) in favicon.ico.sizes()
        assert (32, 32) in favicon.ico.sizes()


@pytest.mark.parametrize(
    "filename,image_format",
    [("brand.jpg", "JPEG"), ("brand.jpeg", "JPEG"), ("brand.webp", "WEBP")],
)
def test_app_icon_accepts_each_documented_image_format(filename, image_format):
    files = generate_app_icon_files(filename, _image_bytes(image_format))

    assert "icon-512.png" in files


@pytest.mark.parametrize("filename", ["brand.gif", "brand.svg", "brand.exe", "brand"])
def test_app_icon_rejects_unsupported_extensions(filename):
    with pytest.raises(BrandIconValidationError, match="PNG, JPG, JPEG, or WEBP"):
        generate_app_icon_files(filename, _image_bytes())


def test_app_icon_rejects_extension_that_does_not_match_image():
    with pytest.raises(BrandIconValidationError, match="does not match"):
        generate_app_icon_files("brand.jpg", _image_bytes("PNG"))


def test_app_icon_rejects_invalid_image_data():
    with pytest.raises(BrandIconValidationError, match="not a valid supported image"):
        generate_app_icon_files("brand.png", b"not an image")


def test_app_icon_rejects_uploads_over_five_megabytes():
    with pytest.raises(BrandIconValidationError, match="5 MB or smaller"):
        generate_app_icon_files("brand.png", b"x" * (5 * 1024 * 1024 + 1))


def test_favicon_requires_a_valid_ico_file():
    ico = generate_app_icon_files("brand.png", _image_bytes())["favicon.ico"]

    favicon = validate_favicon_file("custom.ico", ico)
    with Image.open(io.BytesIO(favicon)) as image:
        assert image.format == "ICO"
    with pytest.raises(BrandIconValidationError, match=r"\.ico extension"):
        validate_favicon_file("custom.png", ico)
    with pytest.raises(BrandIconValidationError, match="not a valid ICO"):
        validate_favicon_file("custom.ico", _image_bytes())


def test_favicon_rejects_uploads_over_one_megabyte():
    with pytest.raises(BrandIconValidationError, match="1 MB or smaller"):
        validate_favicon_file("custom.ico", b"x" * (1024 * 1024 + 1))
