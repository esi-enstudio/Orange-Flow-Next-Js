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
        BILLING_ENABLED=True,
    )
    assert config.IS_PRODUCTION is True


def test_development_keeps_escape_hatches():
    """Staging/dev may still stage the rollout with the legacy policy."""
    config = _settings(
        ENVIRONMENT="development",
        BILLING_REQUIRE_PLAN=False,
    )
    assert config.IS_PRODUCTION is False
    assert config.BILLING_REQUIRE_PLAN is False


def test_environment_aliases_are_recognized():
    assert _settings(ENVIRONMENT="prod").IS_PRODUCTION is True
    assert _settings(ENVIRONMENT="Production").IS_PRODUCTION is True
    assert _settings(ENVIRONMENT="staging").IS_PRODUCTION is False


def test_production_accepts_cash_only_billing():
    """A cash-only deployment needs no gateway credentials and must boot."""
    config = _settings(
        ENVIRONMENT="production",
        BILLING_REQUIRE_PLAN=True,
        BILLING_ENABLED=True,
    )
    assert config.CASH_PAYMENTS_ENABLED is True
    assert config.IS_PRODUCTION is True
    assert not hasattr(config, "ONLINE_PAYMENTS_ENABLED")
