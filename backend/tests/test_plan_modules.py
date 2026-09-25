"""Unit tests for plan-based module access ("allowed_modules").

Covers the fail-open legacy policy, base-module auto-inclusion, strict plan
gating, and the require_plan_module dependency.
"""

import pytest
from fastapi import HTTPException

from app.services.entitlement import (
    allowed_modules,
    api_path_allowed,
    has_plan_fallback,
    module_enabled,
    module_gated,
    require_plan_module,
)
from config.modules import BASE_MODULES, valid_module_key

from conftest import make_plan, make_sub


async def test_make_plan_supports_allowed_modules(db, house, plan):
    plan = await make_plan(db, name="DMS", slug="dms", allowed_modules=["dms"])
    assert plan.allowed_modules == ["dms"]


async def test_legacy_plan_is_unrestricted(db, house, plan):
    sub = await make_sub(db, house.id, plan, trial_days=0)
    assert allowed_modules(sub) is None
    assert module_enabled(sub, "dms") is True
    assert module_enabled(sub, "reports") is True
    assert module_gated(sub, "dms") is False


async def test_no_plan_fallback_is_unrestricted(db, house, plan):
    sub = await make_sub(db, house.id, plan, trial_days=0)
    sub.package_id = None
    await db.commit()
    assert has_plan_fallback(sub) is True
    assert allowed_modules(sub) is None
    assert module_enabled(sub, "anything") is True


async def test_empty_allowed_modules_treated_as_legacy(db, house, plan):
    sub = await make_sub(db, house.id, plan, trial_days=0)
    sub.package.allowed_modules = []
    await db.commit()
    assert allowed_modules(sub) is None


async def test_strict_plan_grants_only_listed_modules(db, house, plan):
    sub = await make_sub(db, house.id, plan, trial_days=0)
    sub.package.allowed_modules = ["dms"]
    await db.commit()
    assert allowed_modules(sub) == ["dms"]
    assert module_enabled(sub, "dms") is True
    assert module_enabled(sub, "reports") is False
    assert module_gated(sub, "reports") is True
    assert module_gated(sub, "dms") is False


async def test_base_modules_always_enabled(db, house, plan):
    sub = await make_sub(db, house.id, plan, trial_days=0)
    sub.package.allowed_modules = ["dms"]
    await db.commit()
    for base in BASE_MODULES:
        assert module_enabled(sub, base) is True
        assert module_gated(sub, base) is False


def test_valid_module_key():
    assert valid_module_key("dms") is True
    assert valid_module_key("reports") is True
    assert valid_module_key("dashboard") is True
    assert valid_module_key("not_a_module") is False


def test_valid_module_key_accepts_leaf_routes():
    assert valid_module_key("/retailers/markings") is True
    assert valid_module_key("/reports/ga-query") is True
    assert valid_module_key("/retailers/does-not-exist") is False
    assert valid_module_key("/users") is False  # base module leaf is not grantable


def test_module_for_key_resolves_leaves():
    from config.modules import module_for_key

    assert module_for_key("retailers") == "retailers"
    assert module_for_key("/retailers/markings") == "retailers"
    assert module_for_key("/reports/ga-query") == "reports"
    assert module_for_key("/unknown-route") is None


async def test_leaf_grant_enables_parent_module(db, house, plan):
    sub = await make_sub(db, house.id, plan, trial_days=0)
    sub.package.allowed_modules = ["/retailers/markings"]
    await db.commit()
    assert allowed_modules(sub) == ["/retailers/markings"]
    assert module_enabled(sub, "retailers") is True
    assert module_enabled(sub, "reports") is False
    assert module_gated(sub, "retailers") is False
    assert module_gated(sub, "reports") is True
    # A different module where the granted leaf does not belong stays disabled.
    assert module_enabled(sub, "reports") is False


async def test_leaf_grant_does_not_enable_unrelated_module(db, house, plan):
    sub = await make_sub(db, house.id, plan, trial_days=0)
    sub.package.allowed_modules = ["/retailers/markings"]
    await db.commit()
    assert module_enabled(sub, "targets") is False


async def test_api_path_allowed_whole_module(db, house, plan):
    sub = await make_sub(db, house.id, plan, trial_days=0)
    sub.package.allowed_modules = ["reports"]
    await db.commit()
    assert api_path_allowed(sub, "reports", "/api/activations") is True
    assert api_path_allowed(sub, "reports", "/api/ga-query") is True


async def test_api_path_allowed_leaf_grant_opens_only_owned_page(db, house, plan):
    sub = await make_sub(db, house.id, plan, trial_days=0)
    sub.package.allowed_modules = ["/reports/activations"]
    await db.commit()
    # owned page opens (including its dashboard/whatsapp sub-resources)...
    assert api_path_allowed(sub, "reports", "/api/activations") is True
    assert api_path_allowed(sub, "reports", "/api/activations/export") is True
    assert api_path_allowed(sub, "reports", "/api/reports/activations/dashboard/export") is True
    # ...but a different page of the same module stays blocked (API-level).
    assert api_path_allowed(sub, "reports", "/api/ga-query") is False
    assert api_path_allowed(sub, "reports", "/api/reports/active-lso") is False


async def test_api_path_allowed_shared_prefix_opens_any_leaf(db, house, plan):
    sub = await make_sub(db, house.id, plan, trial_days=0)
    sub.package.allowed_modules = ["/sim-inventory"]
    await db.commit()
    assert api_path_allowed(sub, "sim_management", "/api/v1/sim-inventory") is True
    assert api_path_allowed(sub, "sim_management", "/api/v1/sim-replacement") is False
    assert api_path_allowed(sub, "sim_management", "/api/v1/ev-kit") is True
    assert api_path_allowed(sub, "sim_management", "/api/v1/sim-products") is True


async def test_api_path_allowed_unmapped_page_fail_closed(db, house, plan):
    sub = await make_sub(db, house.id, plan, trial_days=0)
    sub.package.allowed_modules = ["/retailers/markings"]
    await db.commit()
    # unknown endpoint inside a leaf-gated module is denied (secure default).
    assert api_path_allowed(sub, "retailers", "/api/retailers/unknown-thing") is False


async def test_api_path_allowed_denies_unincluded_module(db, house, plan):
    sub = await make_sub(db, house.id, plan, trial_days=0)
    sub.package.allowed_modules = ["/reports/activations"]
    await db.commit()
    assert api_path_allowed(sub, "targets", "/api/house-targets") is False


async def test_api_path_allowed_base_and_legacy(db, house, plan):
    legacy = await make_sub(db, house.id, plan, trial_days=0)
    assert api_path_allowed(legacy, "reports", "/api/activations") is True

    strict = await make_sub(db, house.id, plan, trial_days=0)
    strict.package.allowed_modules = ["dms"]
    await db.commit()
    assert api_path_allowed(strict, "dashboard", "/api/stats") is True


async def test_api_path_allowed_import_prefix_resolves_data_import(db, house, plan):
    sub = await make_sub(db, house.id, plan, trial_days=0)
    sub.package.allowed_modules = ["/import/activations"]
    await db.commit()
    assert api_path_allowed(sub, "data_import", "/api/activations/import") is True
    # the docs-only activations page of reports is not open through import leaf.
    assert api_path_allowed(sub, "reports", "/api/activations/report") is False


async def test_require_plan_module_blocks_strict_missing(db, house, plan):
    sub = await make_sub(db, house.id, plan, trial_days=0)
    sub.package.allowed_modules = ["dms"]
    await db.commit()

    dep = require_plan_module("reports")
    with pytest.raises(HTTPException) as exc:
        await dep(house_context=house.id, current_user=_non_admin_user(), db=db)
    assert exc.value.status_code == 403
    assert "PLAN_MODULE_DISABLED" in exc.value.detail


async def test_require_plan_module_passes_when_included(db, house, plan):
    sub = await make_sub(db, house.id, plan, trial_days=0)
    sub.package.allowed_modules = ["dms"]
    await db.commit()

    dep = require_plan_module("dms")
    result = await dep(house_context=house.id, current_user=_non_admin_user(), db=db)
    assert result is None


async def test_require_plan_module_passes_on_legacy(db, house, plan):
    sub = await make_sub(db, house.id, plan, trial_days=0)
    sub.package.allowed_modules = None
    await db.commit()

    dep = require_plan_module("reports")
    assert await dep(house_context=house.id, current_user=_non_admin_user(), db=db) is None


def _non_admin_user():
    from app.models.user import User

    return User(email="x@example.com", name="X", hashed_password="x", roles=[])