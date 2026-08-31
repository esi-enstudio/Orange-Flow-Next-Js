"""Payment gateway provider registry.

Provider-agnostic abstraction so a new gateway (bKash, Nagad, ShurjoPay, ...)
can be added by implementing `create_checkout`, `validate_transaction` and
`initiate_refund` and registering it here — without touching the subscription
or billing services.
"""

import logging
from typing import Optional, Protocol, runtime_checkable

from config.settings import settings

logger = logging.getLogger(__name__)

REGISTRY: dict = {}


@runtime_checkable
class PaymentGatewayProvider(Protocol):
    name: str

    async def create_checkout(self, **kwargs) -> dict:
        """Create a hosted checkout session.

        kwargs: amount, currency, tran_id, item_name, success_url, fail_url,
        cancel_url, ipn_url, customer_name, customer_email, customer_phone
        Returns: {"status": "SUCCESS"|"FAILED", "gateway_page_url", "tran_id",
                  "session_key", "error"}
        """

    async def validate_transaction(self, **kwargs) -> dict:
        """Server-side transaction validation (authoritative).

        kwargs: val_id | tran_id, amount, currency.
        Returns: {"valid": bool, "status": str, "data": {...}}
        """

    async def initiate_refund(self, **kwargs) -> dict:
        """Initiate a refund. kwargs: val_id, tran_id, amount, reference.
        Returns: {"status", "refund_ref", "message"}
        """


def register_gateway(provider: PaymentGatewayProvider):
    REGISTRY[provider.name] = provider
    logger.info("Payment gateway registered: %s", provider.name)


def get_gateway(name: Optional[str] = None) -> Optional[PaymentGatewayProvider]:
    gateway_name = name or settings.PAYMENT_GATEWAY
    provider = REGISTRY.get(gateway_name)
    return provider


def get_active_gateway_name() -> str:
    return settings.PAYMENT_GATEWAY


# late import to keep __init__ light (provider modules import settings only)
def _load_default():
    from app.services.payment.sslcommerz import sslcommerz_provider  # noqa: F401


_load_default()