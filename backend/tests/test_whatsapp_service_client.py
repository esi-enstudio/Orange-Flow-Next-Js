import pytest

from app.services.whatsapp_service_client import WhatsAppServiceClient


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("input_phone", "gateway_phone"),
    [
        ("01732547755", "8801732547755"),
        ("8801732547755", "8801732547755"),
    ],
)
async def test_login_pairing_code_normalizes_local_phone_for_gateway(
    monkeypatch, input_phone, gateway_phone
):
    requests = []

    class Response:
        status_code = 200
        is_success = True

        @staticmethod
        def json():
            return {"status": True, "data": {"pair_code": "ABCD-1234"}}

    class AsyncClient:
        def __init__(self, timeout):
            assert timeout == 30

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            return None

        async def post(self, url, *, headers, json):
            requests.append({"url": url, "headers": headers, "json": json})
            return Response()

    monkeypatch.setattr(
        "app.services.whatsapp_service_client.httpx.AsyncClient", AsyncClient
    )
    monkeypatch.setattr(
        "app.services.whatsapp_service_client.settings.WA_GATEWAY_ENABLED", True
    )

    result = await WhatsAppServiceClient().login_pairing_code(
        "device-jwt", input_phone
    )

    assert result == {"pair_code": "ABCD-1234"}
    assert requests[0]["json"] == {"phone": gateway_phone}
