"""Route code parsing and route master reconciliation.

Retailer Excel carries a ROUTE cell such as ``(MYMVAI01_ROUTE0066,MYMVAI01_ROUTE0075)``.
The raw cell is kept on ``retailers.route`` as an import snapshot; the
``routes`` / ``retailer_routes`` tables are the normalized source of truth used
by filters, ownership and reporting.

Unknown codes are **rejected**, never auto-created: an admin registers routes
from the Routes page (or the one-off startup backfill seeds the master from the
codes already present on retailers). This keeps typos out of the master and
makes a missing code visible instead of silently inventing a route.
"""
import logging
import re
from collections import defaultdict

from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.route import EmployeeRoute, Route, RetailerRoute
from app.models.retailer import Retailer
from app.utils.timezone import now_naive

logger = logging.getLogger(__name__)

# MYMVAI01_ROUTE0066 — house prefix, then ROUTE + digits. Zero padding is part of
# the identity (house 1 uses ROUTE11, house 2 uses ROUTE0011), so never normalize it.
ROUTE_CODE_RE = re.compile(r"^[A-Z0-9]+(?:_[A-Z0-9]+)*_ROUTE\d+$")
_ROUTE_SEPARATOR = "_ROUTE"
_SPLIT_RE = re.compile(r"[,;/\r\n]+")


def route_house_prefix(code: str) -> str | None:
    """Return the house prefix embedded in a route code (``MYMVAI01``)."""
    prefix, sep, _ = code.rpartition(_ROUTE_SEPARATOR)
    return prefix if sep and prefix else None


def parse_route_codes(raw, house_code: str | None = None) -> list[str]:
    """Parse a ROUTE cell into unique, validated, ordered route codes.

    Accepts ``(A)``, ``(A,B)``, ``A,B``, ``A; B`` and whitespace variants. The
    first code is the retailer's primary route. Invalid fragments — and codes
    whose prefix belongs to another house — are logged and skipped instead of
    failing the whole import.
    """
    if raw is None:
        return []
    cell = str(raw).strip()
    if not cell or cell.lower() in ("nan", "none", "null"):
        return []

    expected_prefix = (house_code or "").strip().upper() or None
    codes: list[str] = []
    for part in _SPLIT_RE.split(cell):
        code = re.sub(r"\s+", "", part).strip("()[]{}'\"")
        code = code.upper()
        if not code:
            continue
        if not ROUTE_CODE_RE.match(code):
            logger.warning("Skipping invalid route code %r", part.strip())
            continue
        if expected_prefix and route_house_prefix(code) != expected_prefix:
            logger.warning(
                "Skipping cross-house route code %r (house prefix %r)",
                code,
                expected_prefix,
            )
            continue
        if code not in codes:
            codes.append(code)
    return codes


async def route_ids_for_codes(
    session: AsyncSession, house_id: int, codes: list[str]
) -> dict[str, int]:
    """Return ``code -> route_id`` for codes already registered in the master."""
    wanted = [c for c in dict.fromkeys(codes) if c]
    if not wanted:
        return {}
    result = await session.execute(
        select(Route.code, Route.id).where(
            Route.house_id == house_id,
            Route.code.in_(wanted),
            Route.is_deleted.is_(False),
        )
    )
    return {code: route_id for code, route_id in result.all()}


async def register_routes(
    session: AsyncSession,
    house_id: int,
    codes: list[str],
    created_by: int | None = None,
) -> dict[str, int]:
    """Register missing route codes in the house master and return all ids.

    Used by the admin Routes page and by the one-off startup backfill. Imports
    must not call this — they reject unknown codes instead.
    """
    wanted = [c for c in dict.fromkeys(codes) if c and ROUTE_CODE_RE.match(c)]
    if not wanted:
        return {}

    ids = await route_ids_for_codes(session, house_id, wanted)
    missing = [code for code in wanted if code not in ids]
    if missing:
        await session.execute(
            insert(Route),
            [
                {"house_id": house_id, "code": code, "created_by": created_by}
                for code in missing
            ],
        )
        await session.flush()
        ids.update(await route_ids_for_codes(session, house_id, missing))
        logger.info(
            "Registered %s route(s) for house %s: %s",
            len(missing),
            house_id,
            ", ".join(missing[:10]),
        )
    return ids


async def sync_retailer_routes(
    session: AsyncSession,
    assignments: dict[str, tuple[int, list[str]]],
    user_id: int | None = None,
) -> dict[str, int]:
    """Reconcile active route links for the given retailers in this transaction.

    ``assignments`` maps ``retailer_code -> (house_id, ordered route codes)``.
    Existing links that are no longer listed are closed (history preserved), new
    ones are opened, and the primary flag follows the first code in the list.
    Codes missing from the route master are rejected and logged, never created.
    """
    counts = {"added": 0, "removed": 0, "unchanged": 0, "skipped": 0, "rejected": 0}
    if not assignments:
        return counts

    retailer_rows = await session.execute(
        select(Retailer.id, Retailer.retailer_code, Retailer.house_id).where(
            Retailer.retailer_code.in_(list(assignments.keys()))
        )
    )
    retailers = {code: (rid, hid) for rid, code, hid in retailer_rows.all()}
    if not retailers:
        return counts

    codes_by_house: dict[int, set[str]] = defaultdict(set)
    for code, (_, codes) in assignments.items():
        if code in retailers:
            codes_by_house[retailers[code][1]].update(codes)
    route_ids: dict[tuple[int, str], int] = {}
    for house_id, codes in codes_by_house.items():
        for route_code, route_id in (
            await route_ids_for_codes(session, house_id, list(codes))
        ).items():
            route_ids[(house_id, route_code)] = route_id

    unknown = sorted(
        {
            route_code
            for house_id, codes in codes_by_house.items()
            for route_code in codes
            if (house_id, route_code) not in route_ids
        }
    )
    if unknown:
        counts["rejected"] = len(unknown)
        logger.warning(
            "Rejected %s unregistered route code(s) during retailer import: %s. "
            "Register them on the Routes page to attach retailers.",
            len(unknown),
            ", ".join(unknown[:10]),
        )

    retailer_ids = [rid for rid, _ in retailers.values()]
    link_rows = await session.execute(
        select(RetailerRoute).where(
            RetailerRoute.retailer_id.in_(retailer_ids),
            RetailerRoute.status == "active",
        )
    )
    active: dict[int, dict[int, RetailerRoute]] = defaultdict(dict)
    for link in link_rows.scalars():
        active[link.retailer_id][link.route_id] = link

    timestamp = now_naive()
    to_insert: list[dict] = []
    to_close: list[int] = []
    primary_updates: list[tuple[RetailerRoute, bool]] = []

    for code, (_, codes) in assignments.items():
        found = retailers.get(code)
        if not found:
            counts["skipped"] += 1
            continue
        retailer_id, house_id = found
        wanted_ids = [
            route_ids[(house_id, route_code)]
            for route_code in codes
            if (house_id, route_code) in route_ids
        ]
        primary_id = wanted_ids[0] if wanted_ids else None
        current = active.get(retailer_id, {})

        for route_id, link in current.items():
            if route_id in wanted_ids:
                counts["unchanged"] += 1
                want_primary = route_id == primary_id
                if link.is_primary != want_primary:
                    primary_updates.append((link, want_primary))
            else:
                to_close.append(link.id)
                counts["removed"] += 1

        for route_id in wanted_ids:
            if route_id in current:
                continue
            to_insert.append(
                {
                    "retailer_id": retailer_id,
                    "route_id": route_id,
                    "is_primary": route_id == primary_id,
                    "status": "active",
                    "effective_from": timestamp,
                    "assigned_at": timestamp,
                    "assigned_by": user_id,
                }
            )
            counts["added"] += 1

    if to_close:
        await session.execute(
            update(RetailerRoute)
            .where(RetailerRoute.id.in_(to_close))
            .values(
                status="inactive",
                effective_to=timestamp,
                removed_at=timestamp,
                removed_by=user_id,
            )
        )
    for link, want_primary in primary_updates:
        link.is_primary = want_primary
    if to_insert:
        await session.execute(insert(RetailerRoute), to_insert)

    return counts


async def retailer_primary_route_map(
    session: AsyncSession, retailer_ids: list[int]
) -> dict[int, str]:
    """Return ``retailer_id -> primary route code`` for the given retailers."""
    wanted = [rid for rid in dict.fromkeys(retailer_ids) if rid]
    if not wanted:
        return {}
    rows = await session.execute(
        select(RetailerRoute.retailer_id, Route.code)
        .join(Route, Route.id == RetailerRoute.route_id)
        .where(
            RetailerRoute.retailer_id.in_(wanted),
            RetailerRoute.status == "active",
            RetailerRoute.is_primary.is_(True),
            Route.is_deleted.is_(False),
        )
    )
    return {retailer_id: code for retailer_id, code in rows.all()}


async def close_employee_route_links(
    session: AsyncSession,
    route_id: int,
    user_id: int | None = None,
    reason: str = "manual",
) -> int:
    """Close the active owner link of a route (history preserved)."""
    timestamp = now_naive()
    result = await session.execute(
        update(EmployeeRoute)
        .where(
            EmployeeRoute.route_id == route_id,
            EmployeeRoute.status == "active",
        )
        .values(
            status="inactive",
            effective_to=timestamp,
            removed_at=timestamp,
            removed_by=user_id,
            reason=reason,
        )
    )
    return result.rowcount or 0
