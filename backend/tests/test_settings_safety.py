"""P0: production must refuse to boot with a fail-open billing configuration.

`config/settings.py` validates this at import time, but a regression there would
be silent until a deploy. These tests instantiate `Settings` directly with the
dangerous combinations and assert the app cannot start.
"""

import pytest
from pydantic import ValidationError

from config.settings import Settings


def _settings(**overrides) -> Settings:
    # Do not read `backend/.env`; the test environment supplies DB/SECRET values.
    return Settings(_env_file=None, **overrides)


@pytest.mark.parametrize(
    "overrides,field",
    [
        ({"BILLING_REQUIRE_PLAN": False}, "BILLING_REQUIRE_PLAN"),
        ({"BILLING_INVOICE_DRY_RUN": True}, "BILLING_INVOICE_DRY_RUN"),
        ({"BILLING_ENABLED": False}, "BILLING_ENABLED"),
    ],
)
def test_production_rejects_dangerous_billing_flags(overrides, field):
    with pytest.raises(ValidationError) as exc:
        _settings(ENVIRONMENT="production", **overrides)
    message = str(exc.value)
    assert field in message
    assert "production" in message.lower()


def test_production_accepts_fail_closed_configuration():
    config = _settings(
        ENVIRONMENT="production",
        BILLING_REQUIRE_PLAN=True,
        BILLING_INVOICE_DRY_RUN=False,
        BILLING_ENABLED=True,
    )
    assert config.IS_PRODUCTION is True


def test_development_keeps_escape_hatches():
    """Staging/dev may still stage the rollout with the legacy policy."""
    config = _settings(
        ENVIRONMENT="development",
        BILLING_REQUIRE_PLAN=False,
        BILLING_INVOICE_DRY_RUN=True,
    )
    assert config.IS_PRODUCTION is False
    assert config.BILLING_REQUIRE_PLAN is False


def test_environment_aliases_are_recognized():
    assert _settings(ENVIRONMENT="prod").IS_PRODUCTION is True
    assert _settings(ENVIRONMENT="Production").IS_PRODUCTION is True
    assert _settings(ENVIRONMENT="staging").IS_PRODUCTION is False


@pytest.mark.parametrize("gateway,expected", [
    ("none", False),
    ("off", False),
    ("disabled", False),
    ("cash", False),
    ("manual", False),
    ("sslcommerz", True),
])
def test_online_payments_flag_follows_gateway(gateway, expected):
    config = _settings(PAYMENT_GATEWAY=gateway)
    assert config.ONLINE_PAYMENTS_ENABLED is expected


def test_production_accepts_cash_only_billing():
    """A cash-only deployment needs no gateway credentials and must boot."""
    config = _settings(
        ENVIRONMENT="production",
        PAYMENT_GATEWAY="none",
        BILLING_REQUIRE_PLAN=True,
        BILLING_INVOICE_DRY_RUN=False,
        BILLING_ENABLED=True,
    )
    assert config.ONLINE_PAYMENTS_ENABLED is False
    assert config.IS_PRODUCTION is True
