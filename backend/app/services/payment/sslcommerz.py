"""SSLCommerz (v4) payment gateway provider.

Docs (verified):
  - Session create:  POST {api_base}/gwprocess/v4/api.php
  - IPN listener:    merchant-configured IPN_URL; merchant must also call the
                     Order Validation API before trusting any IPN callback.
  - Order validate:  GET {api_base}/validator/api/validationserverAPI.php?val_id=...
  - Merchant tran:   GET {api_base}/validator/api/merchantTransIDvalidationAPI.php?tran_id=...
  - Refund:          POST {api_base}/validator/api/refund.php
  - Signature:       MD5(store_passwd + values_of(verify_key order))
                     (verify_key is a comma-separated list echoed by SSLCommerz)

Sandbox base: https://sandbox.sslcommerz.com
Production base: https://securepay.sslcommerz.com
"""

import hashlib
import logging
from urllib.parse import urlencode

import httpx

from config.settings import settings
from app.services.payment import register_gateway

logger = logging.getLogger(__name__)

# keys that are safe to persist alongside a transaction
SAFE_PAYLOAD_KEYS = (
    "tran_id", "val_id", "amount", "store_amount", "card_type", "card_brand",
    "card_issuer", "card_issuer_country", "currency_type", "currency_amount",
    "risk_level", "risk_title", "status", "bank_tran_id", "value_a", "value_b",
    "currency", "base_fair", "verify_sign", "verify_key", "store_id",
)

VALID_STATUSES = ("VALIDATED", "VALID")


def _api_base() -> str:
    base = settings.SSLCOMMERZ_API_BASE
    if not base:
        base = (
            "https://sandbox.sslcommerz.com"
            if settings.SSLCOMMERZ_SANDBOX
            else "https://securepay.sslcommerz.com"
        )
    return base


def _config_ok() -> bool:
    return bool(settings.SSLCOMMERZ_STORE_ID and settings.SSLCOMMERZ_STORE_PASSWORD)


class SSLCommerzProvider:
    name = "sslcommerz"

    @staticmethod
    def verify_signature(payload: dict) -> bool:
        """Validate `verify_sign` echoed over the merchant's order validation data."""
        store_pass = settings.SSLCOMMERZ_STORE_PASSWORD
        verify_key = (payload.get("verify_key") or "").split(",")
        if not store_pass or not verify_key:
            return False
        values_in_order = "".join(str(payload.get(k, "")) for k in verify_key)
        expected = hashlib.md5((store_pass + values_in_order).encode("utf-8")).hexdigest()
        actual = str(payload.get("verify_sign") or "").lower()
        return expected == actual

    @staticmethod
    def sanitize_payload(payload: dict) -> dict:
        return {k: payload[k] for k in SAFE_PAYLOAD_KEYS if k in payload}

    async def create_checkout(self, **kwargs) -> dict:
        if not _config_ok():
            return {"status": "FAILED", "error": "Payment gateway is not configured"}

        amount = kwargs["amount"]
        payload = {
            "store_id": settings.SSLCOMMERZ_STORE_ID,
            "store_passwd": settings.SSLCOMMERZ_STORE_PASSWORD,
            "total_amount": f"{float(amount):.2f}",
            "currency": kwargs.get("currency", "BDT"),
            "tran_id": kwargs["tran_id"],
            "success_url": kwargs["success_url"],
            "fail_url": kwargs["fail_url"],
            "cancel_url": kwargs["cancel_url"],
            "ipn_url": kwargs["ipn_url"],
            "cus_name": (kwargs.get("customer_name") or "House")[:80],
            "cus_email": (kwargs.get("customer_email") or "")[:80],
            "cus_phone": (kwargs.get("customer_phone") or "")[:20],
            "shipping_method": "NO",
            "product_name": (kwargs.get("item_name") or "Subscription")[:200],
            "product_category": "Subscription",
            "product_profile": "general",
            "num_of_item": 1,
        }

        url = f"{_api_base()}{settings.SSLCOMMERZ_SESSION_PATH}"
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(url, data=payload)
                data = resp.json()
        except httpx.HTTPError as exc:
            logger.error("SSLCommerz session create failed: %s", exc)
            return {"status": "FAILED", "error": "Unable to reach payment gateway"}

        if data.get("status") == "SUCCESS":
            return {
                "status": "SUCCESS",
                "gateway_page_url": data.get("GatewayPageURL"),
                "tran_id": data.get("tran_id"),
                "session_key": data.get("sessionkey"),
                "error": None,
            }
        return {"status": "FAILED", "error": data.get("failedreason") or "Session creation failed"}

    async def validate_transaction(self, **kwargs) -> dict:
        if settings.BILLING_INVOICE_DRY_RUN:
            # Dry-run/E2E mode: no real gateway credentials required. Return a
            # synthetic VALIDATED result matching the requested amount so the
            # full payment-success path (checkout -> webhook -> validation ->
            # mark invoice paid) can be exercised without SSLCommerz sandbox.
            amount = kwargs.get("amount")
            return {
                "valid": True,
                "status": "VALIDATED",
                "data": {
                    "amount": f"{float(amount):.2f}" if amount is not None else "0.00",
                    "currency": kwargs.get("currency") or "BDT",
                    "tran_id": kwargs.get("tran_id"),
                    "val_id": kwargs.get("val_id") or f"DRYRUN-{kwargs.get('tran_id')}",
                    "error": "",
                },
            }
        if not _config_ok():
            return {"valid": False, "status": "ERROR", "data": {"error": "Gateway not configured"}}

        val_id = kwargs.get("val_id")
        tran_id = kwargs.get("tran_id")
        amount = kwargs.get("amount")
        currency = kwargs.get("currency")

        params = {
            "store_id": settings.SSLCOMMERZ_STORE_ID,
            "store_passwd": settings.SSLCOMMERZ_STORE_PASSWORD,
            "format": "json",
        }
        if val_id:
            base_path = settings.SSLCOMMERZ_VALIDATION_PATH
            params["val_id"] = val_id
        elif tran_id:
            base_path = settings.SSLCOMMERZ_MERCHANT_VALIDATION_PATH
            params["tran_id"] = tran_id
        else:
            return {"valid": False, "status": "ERROR", "data": {"error": "val_id or tran_id required"}}

        url = f"{_api_base()}{base_path}?{urlencode(params)}"
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.get(url)
                data = resp.json()
        except httpx.HTTPError as exc:
            logger.error("SSLCommerz validate failed: %s", exc)
            return {"valid": False, "status": "ERROR", "data": {"error": "Validation API unreachable"}}

        status = str(data.get("status") or "").upper()
        valid = status in VALID_STATUSES

        if valid and amount is not None:
            try:
                matched = abs(float(data.get("amount", 0)) - float(amount)) < 0.01
            except (TypeError, ValueError):
                matched = False
            if not matched:
                logger.warning(
                    "Payment amount mismatch: expected %s got %s (tran_id=%s)",
                    amount, data.get("amount"), data.get("tran_id"),
                )
                valid = False
        if valid and currency:
            data_currency = str(data.get("currency") or "").upper()
            if data_currency and data_currency != str(currency).upper():
                logger.warning("Currency mismatch: %s vs %s", currency, data_currency)
                valid = False

        return {"valid": valid, "status": status, "data": data}

    async def initiate_refund(self, **kwargs) -> dict:
        if not _config_ok():
            return {"status": "FAILED", "message": "Payment gateway is not configured"}
        payload = {
            "store_id": settings.SSLCOMMERZ_STORE_ID,
            "store_passwd": settings.SSLCOMMERZ_STORE_PASSWORD,
            "refund_amount": f"{float(kwargs['amount']):.2f}",
            "refe_ref_id": kwargs.get("reference") or "",
            "tran_id": kwargs.get("tran_id", ""),
            "refund_ref_id_advance": "",
        }
        url = f"{_api_base()}{settings.SSLCOMMERZ_REFUND_PATH}"
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(url, data=payload)
                data = resp.json()
        except httpx.HTTPError as exc:
            logger.error("SSLCommerz refund failed: %s", exc)
            return {"status": "FAILED", "message": "Refund API unreachable"}
        return {"status": data.get("status"), "refund_ref": data.get("refund_ref_id"), "message": data.get("errorReason")}


sslcommerz_provider = SSLCommerzProvider()
register_gateway(sslcommerz_provider)