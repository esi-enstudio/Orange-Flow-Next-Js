import base64

from app.services.Automation.Tasks.lifting_pull import decode_deposit_slip


def test_jpeg_data_url_uses_dms_compatible_jpeg_extension():
    slip = "data:image/jpeg;base64," + base64.b64encode(b"jpeg image").decode()

    content, mime, filename = decode_deposit_slip(slip)

    assert content == b"jpeg image"
    assert mime == "image/jpeg"
    assert filename == "deposit_slip.jpeg"


def test_legacy_base64_slip_uses_dms_compatible_jpeg_extension():
    slip = base64.b64encode(b"jpeg image").decode()

    content, mime, filename = decode_deposit_slip(slip)

    assert content == b"jpeg image"
    assert mime == "image/jpeg"
    assert filename == "deposit_slip.jpeg"
