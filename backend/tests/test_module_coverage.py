"""P0: every API route must be attributable to a plan module (or be exempt).

Module entitlement is enforced server-side by `PlanModuleGuard`. That only
works if each `/api` route is either:

- mapped in `config.modules.PATH_TO_MODULE` (module-bound or deliberately
  always-allowed `None`), or
- exempted by the middleware (auth, billing, plans, webhooks, health, ...).

The middleware fails closed (`PLAN_MODULE_UNMAPPED`) for strict plans on any
route that is neither. This test is the build-time guard that keeps the map
complete when someone adds an endpoint.

Routes are extracted statically with `ast`, so the test does not need the full
application dependency set (playwright, uvicorn) installed.
"""

import ast
from pathlib import Path

import pytest

from app.middleware.plan_module_guard import _is_exempt
from config.modules import path_is_mapped

ROUTER_DIR = Path(__file__).resolve().parents[1] / "app" / "routers"
MAIN_PY = Path(__file__).resolve().parents[1] / "main.py"
HTTP_METHODS = {"get", "post", "put", "patch", "delete"}


def _router_prefix(tree: ast.AST) -> str:
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call):
            func = node.value.func
            if getattr(func, "id", None) == "APIRouter":
                for kw in node.value.keywords:
                    if kw.arg == "prefix" and isinstance(kw.value, ast.Constant):
                        return str(kw.value.value or "")
    return ""


def _iter_routes(path: Path):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    prefix = _router_prefix(tree)
    target = "app" if path.name == "main.py" else "router"
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for dec in node.decorator_list:
            if not (isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute)):
                continue
            owner = dec.func.value
            if not (isinstance(owner, ast.Name) and owner.id == target):
                continue
            method = dec.func.attr.lower()
            if method not in HTTP_METHODS or not dec.args:
                continue
            arg = dec.args[0]
            if not isinstance(arg, ast.Constant) or not isinstance(arg.value, str):
                continue
            yield prefix, arg.value, method.upper()


def _api_paths() -> list[tuple[str, str]]:
    found: set[tuple[str, str]] = set()
    files = sorted(ROUTER_DIR.glob("*.py")) + [MAIN_PY]
    # main.py mounts these two routers under an extra "/api" prefix.
    api_mounted = {"admin_controller.py", "admin_setup_controller.py"}
    for file in files:
        for prefix, route, method in _iter_routes(file):
            full = (prefix.rstrip("/") + "/" + route.lstrip("/")).rstrip("/") or "/"
            candidates = {full}
            if file.name in api_mounted and not full.startswith("/api"):
                candidates.add("/api" + full)
            for candidate in candidates:
                if candidate.startswith("/api"):
                    found.add((candidate, method))
    return sorted(found)


class _FakeRequest:
    def __init__(self, path: str, method: str):
        from types import SimpleNamespace

        self.url = SimpleNamespace(path=path)
        self.method = method
        self.headers = {}


def test_every_api_route_is_mapped_or_exempt():
    routes = _api_paths()
    assert routes, "route extraction found nothing — the test itself is broken"

    missing = [
        (path, method)
        for path, method in routes
        if not path_is_mapped(path) and not _is_exempt(_FakeRequest(path, method))
    ]
    assert not missing, (
        "These /api routes are neither mapped in config/modules.py "
        "PATH_TO_MODULE nor exempt in PlanModuleGuard, so strict plans would "
        "fail closed on them. Add a mapping (or an explicit None entry for a "
        "platform helper):\n"
        + "\n".join(f"  {method} {path}" for path, method in missing)
    )


@pytest.mark.parametrize(
    "path,method,should_be_exempt",
    [
        ("/api/auth/login", "POST", True),
        ("/api/v1/billing/invoices", "GET", True),
        ("/api/v1/subscription/entitlements", "GET", True),
        ("/api/houses", "GET", True),
        ("/api/houses", "POST", False),  # mutations are still gated
        ("/api/retailers", "GET", False),
        ("/api/v1/scratch-cards", "POST", False),
    ],
)
def test_exempt_boundary(path, method, should_be_exempt):
    assert _is_exempt(_FakeRequest(path, method)) is should_be_exempt
