"""Parity test: every frontend nav group moduleKey must be covered by the
backend PATH_TO_MODULE map.

This keeps the plan modal (derived from navItems in constants.ts) and the
backend enforcement layer (config/modules.py) from drifting apart. If a nav
group has no owned API routes (billing_group is a pure platform group), it is
expected to be excluded here.

The constants-driven assertions only run where `frontend/src/lib/constants.ts`
is reachable (host/CI where backend and frontend live side by side); inside the
backend-only docker container they are skipped.
"""

import re
import pathlib

import pytest

from config.modules import (
    PATH_TO_MODULE,
    BASE_MODULES,
    module_for_path,
    MODULE_KEYS,
    ALL_LEAF_ROUTES,
    LEAF_OWNER,
    LEAF_TO_API_PREFIXES,
    MODULE_SHARED_API_PREFIXES,
)

# Platform-only groups with no restricted API surface.
NO_API_GROUPS = {"billing_group"}

FRONTEND_CONSTANTS = (
    pathlib.Path(__file__).resolve().parents[1] / "frontend" / "src" / "lib" / "constants.ts"
)

FRONTEND_AVAILABLE = FRONTEND_CONSTANTS.exists()

requires_frontend = pytest.mark.skipif(
    not FRONTEND_AVAILABLE, reason="frontend/src/lib/constants.ts not mounted (backend-only container)"
)


def _nav_module_keys() -> set:
    text = FRONTEND_CONSTANTS.read_text()
    return set(re.findall(r'moduleKey:\s*"([^"]+)"', text))


def _path_modules() -> dict:
    return {module: [p for p, m in PATH_TO_MODULE if m == module] for module in MODULE_KEYS}


@requires_frontend
def test_constants_file_exists():
    assert FRONTEND_CONSTANTS.exists(), "frontend/src/lib/constants.ts not found"


@requires_frontend
def test_nav_items_exist():
    assert len(_nav_module_keys()) >= 15, "expected top-level nav moduleKeys"


@requires_frontend
def test_all_path_modules_are_known_nav_modules():
    nav = _nav_module_keys()
    for module in MODULE_KEYS:
        assert module in nav, f"PATH_TO_MODULE grants unknown module '{module}' not in navItems"


@requires_frontend
def test_every_non_base_nav_module_is_mapped():
    nav = _nav_module_keys()
    for module in nav - BASE_MODULES - NO_API_GROUPS:
        assert module in MODULE_KEYS, (
            f"navItems moduleKey '{module}' has no PATH_TO_MODULE entry. "
            "Add a route prefix in backend/config/modules.py."
        )


def test_base_modules_have_dedicated_paths():
    from config.modules import PATH_TO_MODULE

    values = {m for _, m in PATH_TO_MODULE if m}
    for module in BASE_MODULES:
        assert module in values, f"base module '{module}' should own at least one route"


def test_none_platform_paths_never_gate():
    import config.modules as modules

    for path, module in modules.PATH_TO_MODULE:
        if module is None:
            assert module_for_path(path) is None


def test_path_resolution_longest_prefix_wins():
    assert module_for_path("/api/v1/scratch-card-serials") == "data_import"
    assert module_for_path("/api/v1/scratch-card-serials/123") == "data_import"
    assert module_for_path("/api/v1/scratch-cards/123") == "dms"
    assert module_for_path("/api/reports/target-achievement") == "performance"
    assert module_for_path("/api/reports/ga-query/activations") == "reports"
    assert module_for_path("/api/dms/sim-issue") == "dms"
    assert module_for_path("/api/auth/login") is None
    assert module_for_path("/api/v1/plans") is None
    assert module_for_path("/admin/plans") is None


def test_mapped_prefixes_are_real_api_paths():
    for prefix, module in PATH_TO_MODULE:
        assert prefix.startswith("/"), f"prefix must be absolute: {prefix!r}"
        if module is not None:
            assert module not in NO_API_GROUPS


def test_leaf_catalog_is_well_formed():
    from config.modules import ALL_LEAF_ROUTES, LEAF_OWNER, MODULE_KEYS

    assert len(ALL_LEAF_ROUTES) > 0
    assert len(ALL_LEAF_ROUTES) == len(LEAF_OWNER), "duplicate leaf routes"
    for route in ALL_LEAF_ROUTES:
        assert route.startswith("/"), f"leaf route must be absolute: {route!r}"
        assert not route.endswith("/"), f"leaf route must not end with '/': {route!r}"
        assert LEAF_OWNER[route] in MODULE_KEYS, (
            f"leaf {route!r} owned by un-mapped module {LEAF_OWNER[route]!r}"
        )


def test_leaf_catalog_has_no_base_module_leaves():
    from config.modules import ALL_LEAF_ROUTES, LEAF_OWNER

    owned = set(LEAF_OWNER.values())
    assert not (owned & BASE_MODULES), "base module leaves must not be grantable"


def test_every_leaf_has_an_api_prefix_mapping():
    missing = [leaf for leaf in ALL_LEAF_ROUTES if not LEAF_TO_API_PREFIXES.get(leaf)]
    assert not missing, f"leaves without API prefix mapping: {missing}"


def test_leaf_api_prefixes_are_valid_and_owned_by_the_right_module():
    for leaf, prefixes in LEAF_TO_API_PREFIXES.items():
        owner = LEAF_OWNER.get(leaf)
        assert owner, f"leaf {leaf!r} not in MODULE_LEAF_ROUTES"
        assert prefixes, f"leaf {leaf!r} has empty prefix list"
        for prefix in prefixes:
            assert prefix.startswith("/api"), f"prefix must be /api: {prefix!r}"
            mapped = module_for_path(prefix)
            assert mapped == owner, (
                f"leaf {leaf!r} prefix {prefix!r} maps to module {mapped!r}, "
                f"expected own module {owner!r}"
            )


def test_shared_api_prefixes_are_real_module_paths():
    for module, prefixes in MODULE_SHARED_API_PREFIXES.items():
        assert module in MODULE_KEYS, f"shared prefix module {module!r} unknown"
        for prefix in prefixes:
            assert prefix.startswith("/api"), f"shared prefix must be /api: {prefix!r}"
            assert module_for_path(prefix) == module, (
                f"shared prefix {prefix!r} does not resolve to {module!r}"
            )


@requires_frontend
def test_every_catalog_leaf_exists_in_nav():
    from config.modules import ALL_LEAF_ROUTES

    text = FRONTEND_CONSTANTS.read_text()
    hrefs = set(re.findall(r'href:\s*"([^"]+)"', text))
    for route in ALL_LEAF_ROUTES:
        assert route in hrefs, f"leaf route {route!r} missing from frontend navItems"