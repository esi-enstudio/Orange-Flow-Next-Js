"""Canonical top-level module catalog for plan-based module access control.

Every top-level navigation group (see `frontend/src/lib/constants.ts`
`navItems[].moduleKey`) has a matching key here. Plans store an explicit
`allowed_modules` list of these keys; when a plan is subscribed to by a house,
the active house may only access these modules plus the auto-included base
modules.

A path-prefix map (`PATH_TO_MODULE`) binds API endpoints to a module. Plugins
that are not mapped (value None) are always allowed (platform endpoints such as
auth, billing, plans, webhooks, uploads) or helper endpoints that are not part
of any restricted module.

NEW MODULES: when you add a top-level nav group in `constants.ts`, give it a
`moduleKey` (or let it auto-derive from `translationKey`) AND add at least one
route prefix in `PATH_TO_MODULE` here. The parity test
(`backend/tests/test_plan_modules_parity.py`) fails the build if you forget.
"""

from typing import Optional, Tuple, List

# Modules automatically granted to every plan. They are never selectable off.
BASE_MODULES: set = {"dashboard", "todos", "administration"}

# Order matters — first matching prefix wins. Use longest prefixes first so
# specific routes are not swallowed by a shorter sibling.
# value None => platform/always-allowed (never gated by plans).
PATH_TO_MODULE: List[Tuple[str, Optional[str]]] = [
    # ---- platform / always-allowed -------------------------------------------------
    ("/api/auth/", None),
    ("/admin/", None),
    ("/api/v1/admin/monitoring", "live_monitor"),
    ("/api/v1/admin/", None),
    ("/api/admin/", None),
    ("/api/webhook/", None),
    ("/api/v1/plans", None),
    ("/api/v1/subscription", None),
    ("/api/v1/billing", None),
    ("/api/v1/notifications", None),  # per-user feed (own rows only), platform-wide
    ("/api/v1/payments", None),
    ("/api/v1/invoices", None),
    ("/api/v1/invoice", None),
    ("/uploads/", None),
    ("/api/settings/brand", None),
    ("/api/settings/maintenance", None),  # public maintenance status (always reachable)
    ("/api/filter-tags", None),
    ("/api/retailer-filters", None),
    ("/api/shifts", None),  # helper used across modules; not a restricted module
    ("/api/v1/shifts", None),  # helper used across modules; not a restricted module
    ("/api/v1/location/update", None),  # device/macro ingest endpoint (no plan context)
    ("/api/v1/database-backups/restore-jobs", None),  # owner-scoped status works during DB replacement

    # ---- module-bound prefixes (longest first) -------------------------------------
    ("/api/v1/database-backups", "administration"),
    ("/api/v1/restore-points", "administration"),
    ("/api/v1/deploy", "administration"),
    ("/api/rule-config", "administration"),
    ("/api/settings", "administration"),
    ("/api/users", "administration"),
    ("/api/houses", "houses"),  # GET stays exempt (plan visibility); mutations are gated
    ("/api/cv", "administration"),
    ("/api/roles", "roles_permissions"),
    ("/api/permissions", "roles_permissions"),

    ("/api/system-logs", "live_monitor"),
    ("/api/otp", "live_monitor"),

    ("/api/zoom-in", "zoom_in"),

    ("/api/houses", "data_import"),
    ("/api/bts", "bts"),
    ("/api/v1/scratch-card-serials", "data_import"),

    # BP dropdown/filter lookup used by BP Targets — belongs to the always-on
    # administration surface, not the employee hub.
    ("/api/employees/bp-list", "administration"),
    ("/api/employees", "employee_hub"),
    ("/api/v1/locations", "live_location"),

    ("/api/retailer-markings", "retailers"),
    ("/api/retailers", "retailers"),

    ("/api/lifting", "lifting"),
    ("/api/products", "lifting"),

    ("/api/commission", "commission"),

    ("/api/house-targets", "targets"),
    ("/api/supervisor-targets", "targets"),
    ("/api/rso-targets", "targets"),
    ("/api/bp-targets", "targets"),

    ("/api/dms", "dms"),
    ("/api/sync", "dms"),
    ("/api/v1/scratch-cards", "dms"),
    ("/api/scratch-cards", "dms"),

    # import endpoints belong to the data-import module (must precede the
    # shorter report prefixes below so they are not swallowed).
    ("/api/activations/import", "data_import"),
    ("/api/itopup-details/import", "data_import"),
    ("/api/live-activations/import", "data_import"),
    ("/api/scratch-card/import", "data_import"),
    ("/api/sim-issues/import", "data_import"),

    ("/api/ga-report-builder", "reports"),
    ("/api/ga-query", "reports"),
    ("/api/reports/target-achievement", "performance"),
    ("/api/reports/my-target-progress", "performance"),
    ("/api/reports/transactions", "reports"),
    ("/api/transactions", "reports"),
    ("/api/reports", "reports"),
    ("/api/activations", "reports"),
    ("/api/itopup-details", "reports"),
    ("/api/live-activations", "reports"),
    ("/api/itopup-balance", "reports"),
    ("/api/scratch-card", "reports"),
    ("/api/sim-issues", "reports"),

    ("/api/v1/inventory", "inventory"),
    ("/api/v1/sales", "field_sales"),
    ("/api/v1/finance", "finance"),
    ("/api/v1/ev-kit", "sim_management"),
    ("/api/v1/sim-inventory", "sim_management"),
    ("/api/v1/sim-products", "sim_management"),
    ("/api/v1/sim-replacement", "sim_management"),
    ("/api/sim-replacement", "sim_management"),
    ("/api/sim-inventory", "sim_management"),
    ("/api/ev-kit", "sim_management"),
    ("/api/sim-products", "sim_management"),

    ("/api/whatsapp", "whatsapp"),
    ("/api/telegram", "telegram"),

    # Dashboard helpers (base module -> always allowed).
    ("/api/stats", "dashboard"),
    ("/api/todos", "todos"),
]

# All module keys that a plan may grant (path map values, excluding None).
MODULE_KEYS: List[str] = sorted({m for _, m in PATH_TO_MODULE if m})

# Modules that are globally/always accessible regardless of plan (platform).
PLATFORM_PATHS = tuple(p for p, m in PATH_TO_MODULE if m is None)

# Page-level ("leaf") routes per module, mirroring the top-level nav groups in
# `frontend/src/lib/constants.ts` (`navItems[].children[].href`). A plan's
# `allowed_modules` may contain either a top-level module key (whole module) or
# one of these individual page routes (a single page). When only a leaf of a
# module is granted, the module's APIs remain reachable (shared API surface) but
# the un-granted pages are blocked on the frontend route guard. Kept in sync by
# the parity test (`backend/tests/test_plan_modules_parity.py`).
MODULE_LEAF_ROUTES: dict = {
    "live_monitor": ("/live-monitor", "/admin/monitoring"),
    "data_import": (
        "/import/activations",
        "/import/itopup-details",
        "/import/live-activations",
        "/import/scratch-card",
        "/import/sim-issues",
        "/import/sc-serials",
    ),
    # BTS is a standalone module (own plan key `bts`), rendered as its own
    # top-level sidebar item directly below "Data Import".
    "bts": ("/bts",),
    "employee_hub": ("/employees", "/employees/supervisors"),
    "live_location": ("/live-location",),
    "retailers": (
        "/retailers",
        "/retailers/retailer-marking",
        "/retailers/markings",
        "/retailers/assign-marking",
        "/retailers/import-marking",
        "/retailers/marking-history",
    ),
    # Commission is a standalone module (own plan key `commission`), rendered as
    # its own top-level sidebar item. It was previously a sub-page of the now
    # removed `commercial_sales` group at /commercial/commission.
    "commission": ("/commission",),
    "lifting": ("/liftings", "/liftings/products"),
    "dms": (
        "/dms/sim-issue",
        "/dms/sim-status",
        "/dms/sim-return",
        "/dms/scratch-card",
        "/sync",
    ),
    "reports": (
        "/reports/activations",
        "/reports/recharge",
        "/reports/transactions",
        "/reports/active-lso",
        "/reports/active-sso",
        "/reports/live-activations",
        "/reports/ga-report-builder",
        "/reports/ga-query",
        "/reports/scratch-card",
        "/reports/sim-issues",
    ),
    "sim_management": ("/sim-inventory", "/sim-replacement"),
    "inventory": (
        "/inventory/receiving",
        "/inventory/mother-stock",
        "/inventory/issues",
        "/inventory/returns",
    ),
    "field_sales": ("/sales", "/sales/my-stock"),
    "finance": (
        "/finance/expenses",
        "/finance/receipts",
        "/finance/cashbook",
        "/finance/closing",
        "/finance/itopup",
    ),
    "performance": ("/dashboard/manager", "/dashboard/supervisor", "/dashboard/rso"),
    "targets": ("/targets/house", "/targets/supervisor", "/targets/rso", "/targets/bp"),
    "roles_permissions": ("/roles", "/permissions"),
    "zoom_in": (
        "/zoom-in",
        "/zoom-in/event-types",
        "/zoom-in/activity",
        "/zoom-in/allocation",
        "/zoom-in/eligible-bts",
    ),
    "whatsapp": ("/whatsapp",),
    "telegram": ("/telegram",),
}

# Every grantable page route -> owning top-level module (derived once at import).
ALL_LEAF_ROUTES: frozenset = frozenset(
    route for routes in MODULE_LEAF_ROUTES.values() for route in routes
)
LEAF_OWNER: dict = {
    route: module
    for module, routes in MODULE_LEAF_ROUTES.items()
    for route in routes
}

# API path prefixes owned by each grantable page ("leaf"). Used for API-level
# enforcement: when a strict plan grants only SOME pages of a module (leaf-only
# grant), a request is allowed only when its path belongs to a granted page.
# Shared prefixes (MODULE_SHARED_API_PREFIXES) are open to any granted leaf of
# the module; prefixes with no leaf mapping are DENIED inside a leaf-gated
# module (secure fail-closed — new endpoints must be mapped here).
LEAF_TO_API_PREFIXES: dict = {
    # ---- live_monitor ----
    "/live-monitor": ("/api/system-logs", "/api/otp"),
    "/admin/monitoring": ("/api/v1/admin/monitoring",),

    # ---- data_import ----
    "/import/activations": ("/api/activations/import",),
    "/import/itopup-details": ("/api/itopup-details/import",),
    "/import/live-activations": ("/api/live-activations/import",),
    "/import/scratch-card": ("/api/scratch-card/import",),
    "/import/sim-issues": ("/api/sim-issues/import",),
    "/import/sc-serials": ("/api/v1/scratch-card-serials",),

    # ---- bts ----
    "/bts": ("/api/bts",),

    # ---- employee_hub ----
    # the employees router serves both the list and the supervisors page.
    "/employees": ("/api/employees",),
    "/employees/supervisors": ("/api/employees",),

    # ---- live_location ----
    "/live-location": ("/api/v1/locations",),

    # ---- retailers ----
    "/retailers": ("/api/retailers",),
    # the retailer-markings router serves the marking/assign/import/history pages.
    "/retailers/retailer-marking": ("/api/retailer-markings",),
    "/retailers/markings": ("/api/retailer-markings",),
    "/retailers/assign-marking": ("/api/retailer-markings",),
    "/retailers/import-marking": ("/api/retailer-markings",),
    "/retailers/marking-history": ("/api/retailer-markings",),

    # ---- commission ----
    "/commission": ("/api/commission",),

    # ---- lifting ----
    "/liftings": ("/api/lifting",),
    "/liftings/products": ("/api/products",),

    # ---- dms ----
    "/dms/sim-issue": ("/api/dms/sim-issue",),
    "/dms/sim-status": ("/api/dms/sim-status",),
    "/dms/sim-return": ("/api/dms/sim-return",),
    "/dms/scratch-card": ("/api/v1/scratch-cards", "/api/scratch-cards"),
    "/sync": ("/api/sync",),

    # ---- reports ----
    "/reports/activations": (
        "/api/activations",
        "/api/reports/activations/dashboard",
        "/api/reports/activations/whatsapp",
    ),
    "/reports/recharge": ("/api/reports/recharge/dashboard",),
    "/reports/transactions": ("/api/reports/transactions",),
    "/reports/active-lso": ("/api/reports/active-lso",),
    "/reports/active-sso": ("/api/reports/active-sso",),
    "/reports/live-activations": ("/api/reports/live-activations", "/api/live-activations"),
    "/reports/ga-report-builder": ("/api/ga-report-builder",),
    "/reports/ga-query": ("/api/ga-query",),
    "/reports/scratch-card": ("/api/scratch-card",),
    "/reports/sim-issues": ("/api/sim-issues",),

    # ---- inventory ----
    "/inventory/receiving": ("/api/v1/inventory/receipts",),
    "/inventory/mother-stock": ("/api/v1/inventory/serials", "/api/v1/inventory/summary"),
    "/inventory/issues": ("/api/v1/inventory/issues",),
    "/inventory/returns": ("/api/v1/inventory/returns",),

    # ---- field_sales ----
    # both pages share the same router; the page guard decides visibility.
    "/sales": ("/api/v1/sales",),
    "/sales/my-stock": ("/api/v1/sales",),

    # ---- finance ----
    "/finance/expenses": ("/api/v1/finance/expenses", "/api/v1/finance/expense-categories"),
    "/finance/receipts": ("/api/v1/finance/receipts",),
    "/finance/cashbook": ("/api/v1/finance/cash", "/api/v1/finance/cashbook"),
    "/finance/closing": ("/api/v1/finance/daily-closings",),
    "/finance/itopup": ("/api/v1/finance/itopup",),

    # ---- sim_management ----
    "/sim-inventory": ("/api/v1/sim-inventory",),
    "/sim-replacement": ("/api/v1/sim-replacement",),

    # ---- performance ----
    # the target-achievement / my-target-progress APIs back all three dashboards.
    "/dashboard/manager": ("/api/reports/target-achievement", "/api/reports/my-target-progress"),
    "/dashboard/supervisor": ("/api/reports/target-achievement", "/api/reports/my-target-progress"),
    "/dashboard/rso": ("/api/reports/target-achievement", "/api/reports/my-target-progress"),

    # ---- targets ----
    "/targets/house": ("/api/house-targets",),
    "/targets/supervisor": ("/api/supervisor-targets",),
    "/targets/rso": ("/api/rso-targets",),
    "/targets/bp": ("/api/bp-targets",),

    # ---- roles_permissions ----
    "/roles": ("/api/roles",),
    "/permissions": ("/api/permissions",),

    # ---- zoom_in ----
    "/zoom-in": ("/api/zoom-in/events", "/api/zoom-in/dashboard/summary"),
    "/zoom-in/event-types": ("/api/zoom-in/event-types",),
    "/zoom-in/activity": (
        "/api/zoom-in/activities",
        "/api/zoom-in/thanas",
        "/api/zoom-in/retailers-by-rso",
        "/api/zoom-in/bps-by-house",
        "/api/zoom-in/rsos-by-house",
    ),
    "/zoom-in/allocation": ("/api/zoom-in/allocations",),
    "/zoom-in/eligible-bts": (
        "/api/zoom-in/eligible-bts",
        "/api/zoom-in/bts-by-thana",
    ),

    # ---- whatsapp / telegram ----
    "/whatsapp": ("/api/whatsapp", "/api/whatsapp-schedules"),
    "/telegram": ("/api/telegram",),
}

# Endpoints that belong to a whole module (no single page) — open whenever ANY
# leaf of the module is granted. Keeping them here avoids breaking pages that
# share a single router; page-specific endpoints stay strictly leaf-gated.
MODULE_SHARED_API_PREFIXES: dict = {
    "inventory": (
        "/api/v1/inventory/products",
        "/api/v1/inventory/employees",
        "/api/v1/inventory/ledger",
    ),
    "finance": (
        "/api/v1/finance/employees",
        "/api/v1/finance/cash-accounts",
    ),
    "sim_management": ("/api/v1/ev-kit", "/api/v1/sim-products"),
    "reports": ("/api/itopup-details", "/api/itopup-balance"),
    "zoom_in": ("/api/zoom-in/filter-options",),
}


def module_for_path(path: str) -> Optional[str]:
    """Return the top-level module key an API path belongs to.

    None => platform helper / unmapped / always-allowed. Use `path_is_mapped`
    to tell "explicitly always-allowed" apart from "nobody mapped this yet".
    """
    for prefix, module in PATH_TO_MODULE:
        if path.startswith(prefix):
            return module
    return None


def path_is_mapped(path: str) -> bool:
    """Whether `PATH_TO_MODULE` has an explicit entry for this path.

    `True` covers both module-bound prefixes and deliberate ``None``
    (platform/helper) entries. `False` means the path is unknown to the plan
    system — the middleware fails closed for strict plans so a forgotten
    mapping cannot leak a paid module.
    """
    return any(path.startswith(prefix) for prefix, _module in PATH_TO_MODULE)


def leaf_owners_for_path(module_key: str, path: str) -> List[str]:
    """Grantable pages (leaves) owning an API path, longest-prefix match.

    Only leaves of `module_key` are considered. Returns [] when the path is not
    scoped to any page of the module (module-level shared or unmapped).
    """
    best = -1
    owners: List[str] = []
    for leaf, prefixes in LEAF_TO_API_PREFIXES.items():
        if LEAF_OWNER.get(leaf) != module_key:
            continue
        for prefix in prefixes:
            if path.startswith(prefix):
                if len(prefix) > best:
                    best = len(prefix)
                    owners = [leaf]
                elif len(prefix) == best and leaf not in owners:
                    owners.append(leaf)
    return owners


def valid_module_key(key: str) -> bool:
    """Accept a top-level module key, a base module, or a grantable page route."""
    return key in MODULE_KEYS or key in BASE_MODULES or key in ALL_LEAF_ROUTES


def module_for_key(key: str) -> Optional[str]:
    """Resolve an allowed key (module or leaf route) to its top-level module."""
    if key in MODULE_KEYS or key in BASE_MODULES:
        return key
    return LEAF_OWNER.get(key)