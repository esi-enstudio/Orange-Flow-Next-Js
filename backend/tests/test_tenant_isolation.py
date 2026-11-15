"""P0: tenant isolation and privilege escalation.

Every data query is scoped by the authenticated user's houses. This module
pins the boundary at the dependency that resolves `X-House-ID`, for every role
short of the platform super admin:

- a regular user cannot select a house they do not belong to (403);
- a tenant "admin", "manager" or "house manager" cannot either — those roles
  are tenant-scoped, not platform-wide;
- only the platform super admin may select any house;
- the old platform-wide admin bypass is opt-in (`TENANT_STRICT_HOUSE_ISOLATION=false`).
"""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.middleware.plan_module_guard import _resolve_house_access
from app.routers.deps import get_house_context, require_house_context
from app.services import entitlement
from config.settings import settings
from conftest import make_house


def _user(role_names=(), houses=()):
    return SimpleNamespace(
        id=1,
        roles=[SimpleNamespace(name=name) for name in role_names],
        houses=list(houses),
    )


class _Request:
    method = "GET"

    def __init__(self, house_id=None, path="/api/retailers"):
        self.url = SimpleNamespace(path=path)
        self.headers = {"X-House-ID": str(house_id)} if house_id is not None else {}


async def test_own_house_is_allowed(db, house):
    user = _user(houses=[house])
    assert await get_house_context(x_house_id=house.id, current_user=user) == house.id
    assert await require_house_context(x_house_id=house.id, current_user=user) == house.id


async def test_missing_header_returns_none(db, house):
    assert await get_house_context(x_house_id=None, current_user=_user(houses=[house])) is None


async def test_regular_user_cannot_select_foreign_house(db, house):
    other = await make_house(db, code="H002", name="Other House")
    with pytest.raises(HTTPException) as exc:
        await get_house_context(x_house_id=other.id, current_user=_user(houses=[house]))
    assert exc.value.status_code == 403


@pytest.mark.parametrize("role", ["admin", "manager", "house manager", "house_manager"])
async def test_tenant_admin_roles_cannot_select_foreign_house(db, house, role):
    """Escalation test: admin-ish tenant roles are still house-scoped."""
    other = await make_house(db, code="H003", name="Other House 2")
    with pytest.raises(HTTPException) as exc:
        await get_house_context(
            x_house_id=other.id, current_user=_user(role_names=[role], houses=[house])
        )
    assert exc.value.status_code == 403


async def test_only_super_admin_can_select_any_house(db, house):
    other = await make_house(db, code="H004", name="Other House 3")
    user = _user(role_names=["super admin"], houses=[])
    assert await get_house_context(x_house_id=other.id, current_user=user) == other.id
    assert await require_house_context(x_house_id=other.id, current_user=user) == other.id


async def test_admin_bypass_is_explicit_opt_in(db, house, monkeypatch):
    monkeypatch.setattr(settings, "TENANT_STRICT_HOUSE_ISOLATION", False)
    other = await make_house(db, code="H005", name="Other House 4")
    user = _user(role_names=["admin"], houses=[house])
    assert await get_house_context(x_house_id=other.id, current_user=user) == other.id


async def test_require_house_context_defaults_to_first_house(db, house):
    assert await require_house_context(
        x_house_id=None, current_user=_user(houses=[house])
    ) == house.id


async def test_require_house_context_rejects_foreign_house(db, house):
    other = await make_house(db, code="H006", name="Other House 5")
    with pytest.raises(HTTPException) as exc:
        await require_house_context(
            x_house_id=other.id, current_user=_user(houses=[house])
        )
    assert exc.value.status_code == 403


async def test_middleware_denies_foreign_house_for_tenant_admin(db, house):
    """The request middleware enforces the same boundary before any endpoint."""
    other = await make_house(db, code="H007", name="Other House 6")
    user = _user(role_names=["admin"], houses=[house])

    result = await _resolve_house_access(
        db, _Request(house_id=other.id), user, entitlement, "req-test"
    )
    assert not isinstance(result, tuple)
    assert result.status_code == 403
    body = result.body.decode()
    assert "HOUSE_ACCESS_DENIED" in body


async def test_middleware_allows_own_house(db, plan):
    house = await make_house(db, code="H008", name="Own House")
    from conftest import make_sub

    await make_sub(db, house.id, plan, trial_days=0)
    user = _user(role_names=["admin"], houses=[house])

    result = await _resolve_house_access(
        db, _Request(house_id=house.id), user, entitlement, "req-ok"
    )
    assert isinstance(result, tuple)
    resolved_house, sub = result
    assert resolved_house.id == house.id
    assert sub is not None


async def test_accessible_houses_scoped_to_assignments(db, house):
    """A tenant house manager only sees the houses assigned to them."""
    from app.routers.houses import get_accessible_houses

    await make_house(db, code="H009", name="Foreign House")
    rows = await get_accessible_houses(
        db=db, current_user=_user(role_names=["house manager"], houses=[house])
    )
    assert [r["id"] for r in rows] == [house.id]


async def test_accessible_houses_super_admin_sees_all(db, house):
    from app.routers.houses import get_accessible_houses

    other = await make_house(db, code="H010", name="Another House")
    rows = await get_accessible_houses(
        db=db, current_user=_user(role_names=["super admin"])
    )
    assert {house.id, other.id} <= {r["id"] for r in rows}


async def test_house_list_scoped_to_assignments(db, house):
    from app.routers.houses import list_houses
    from app.schemas.pagination import PaginationParams

    await make_house(db, code="H011", name="Foreign House 2")
    res = await list_houses(
        pagination=PaginationParams(page=1, per_page=20, sort_by="id", sort_order="asc"),
        search=None,
        cluster=None,
        region=None,
        wh_region=None,
        district=None,
        is_active=None,
        db=db,
        current_user=_user(role_names=["house manager"], houses=[house]),
    )
    assert [row["id"] for row in res.data] == [house.id]


async def test_bts_house_filter_is_scoped(db, house):
    from app.routers.bts import _scoped_house_filter

    user = _user(role_names=["house manager"], houses=[house])
    assert _scoped_house_filter(user, house.id) == house.id
    assert _scoped_house_filter(user, None) is None
    with pytest.raises(HTTPException) as exc:
        _scoped_house_filter(user, house.id + 1)
    assert exc.value.status_code == 403

    super_admin = _user(role_names=["super admin"])
    assert _scoped_house_filter(super_admin, house.id + 1) == house.id + 1
