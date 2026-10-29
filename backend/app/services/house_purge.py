"""Hard-delete a house together with every row that belongs to it.

Deleting a tenant is a whole-tenant operation: employees, retailers, targets,
stock, sales, reports, billing records, schedules and every other operational
table that carries a ``house_id`` must disappear with the house. Child tables
that only point at house-owned rows (``retailer_marking_assignments``,
``mela_assignments``, legacy ``attendance_adjustments`` ...) must be removed
too, otherwise the ``houses`` row cannot be deleted.

The purge order is derived from the live database schema (tables, nullable
columns and foreign keys) instead of a hand-maintained table list. Legacy
tables that never got a SQLAlchemy model are therefore covered automatically,
and no code change is needed when a new house-scoped table is added.

Everything runs on the caller's session/transaction. The caller is responsible
for committing (or rolling back on error).
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Iterable

from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# Never purged by this routine:
# - ``houses`` is removed explicitly at the very end.
# - ``activity_logs`` is an append-only audit trail (no FK to houses); keeping
#   it preserves who deleted the house and when. It is not tenant-scoped data.
_PROTECTED_TABLES = {"houses", "activity_logs"}

# Tables that are deleted explicitly while removing orphaned user accounts.
_USER_DEPENDENT_TABLES = {"todos", "notifications", "cvs", "users_roles", "users_houses"}

_SUPER_ADMIN_ROLE_NAMES = ("super admin", "super_admin", "superadmin")


class HousePurgeError(Exception):
    """Raised when the house data cannot be fully purged."""


@dataclass(frozen=True)
class _ForeignKey:
    child_table: str
    child_columns: tuple[str, ...]
    parent_table: str
    parent_columns: tuple[str, ...]


@dataclass
class _Schema:
    # table -> column -> is_nullable
    tables: dict[str, dict[str, bool]]
    foreign_keys: list[_ForeignKey]

    def has_table(self, name: str) -> bool:
        return name in self.tables


_SCHEMA_CACHE: dict[str, _Schema] = {}
_SCHEMA_LOCK = asyncio.Lock()


def _q(identifier: str) -> str:
    """Quote a trusted database identifier for SQL text()."""
    return '"' + identifier.replace('"', '""') + '"'


def _reflect_schema(sync_conn) -> _Schema:
    inspector = inspect(sync_conn)
    tables: dict[str, dict[str, bool]] = {}
    for table_name in inspector.get_table_names():
        tables[table_name] = {
            column["name"]: bool(column.get("nullable", True))
            for column in inspector.get_columns(table_name)
        }

    foreign_keys: list[_ForeignKey] = []
    for table_name in tables:
        for fk in inspector.get_foreign_keys(table_name):
            parent = fk.get("referred_table")
            if not parent:
                continue
            child_columns = tuple(fk.get("constrained_columns") or ())
            parent_columns = tuple(fk.get("referred_columns") or ())
            if not child_columns or len(child_columns) != len(parent_columns):
                continue
            foreign_keys.append(
                _ForeignKey(table_name, child_columns, parent, parent_columns)
            )

    return _Schema(tables=tables, foreign_keys=foreign_keys)


async def _get_schema(db: AsyncSession) -> _Schema:
    bind = db.get_bind()
    # Schema is immutable for the lifetime of an engine; keying by engine id
    # also keeps parallel test engines (same URL) from sharing a stale cache.
    cache_key = f"{bind.dialect.name}:{id(bind)}"
    cached = _SCHEMA_CACHE.get(cache_key)
    if cached is not None:
        return cached

    async with _SCHEMA_LOCK:
        cached = _SCHEMA_CACHE.get(cache_key)
        if cached is not None:
            return cached
        connection = await db.connection()
        schema = await connection.run_sync(_reflect_schema)
        _SCHEMA_CACHE[cache_key] = schema
        return schema


def _fks_by_child(schema: _Schema) -> dict[str, list[_ForeignKey]]:
    result: dict[str, list[_ForeignKey]] = {}
    for fk in schema.foreign_keys:
        if fk.child_table == fk.parent_table:
            continue
        result.setdefault(fk.child_table, []).append(fk)
    return result


def _build_scope(schema: _Schema) -> tuple[set[str], set[str]]:
    """Return (tables with house_id, full closure including child tables)."""
    direct = {
        table
        for table, columns in schema.tables.items()
        if "house_id" in columns and table not in _PROTECTED_TABLES
    }

    children: dict[str, list[_ForeignKey]] = {}
    for fk in schema.foreign_keys:
        if fk.child_table == fk.parent_table:
            continue
        children.setdefault(fk.parent_table, []).append(fk)

    scope = set(direct)
    queue = list(direct)
    while queue:
        parent = queue.pop()
        for fk in children.get(parent, ()):
            child = fk.child_table
            if child in _PROTECTED_TABLES or child not in schema.tables:
                continue
            if child not in scope:
                scope.add(child)
                queue.append(child)
    return direct, scope


def _topological_order(scope: set[str], fks: Iterable[_ForeignKey]) -> list[str]:
    """Order tables so every parent comes before the tables that reference it."""
    dependencies: dict[str, set[str]] = {table: set() for table in scope}
    for fk in fks:
        if (
            fk.child_table in scope
            and fk.parent_table in scope
            and fk.child_table != fk.parent_table
        ):
            dependencies[fk.child_table].add(fk.parent_table)

    order: list[str] = []
    remaining = set(scope)
    while remaining:
        ready = sorted(
            table for table in remaining if not (dependencies[table] & remaining)
        )
        if not ready:
            # Foreign-key cycle: break it deterministically. The caller nulls
            # nullable references on the resulting "backward" edges.
            ready = [sorted(remaining)[0]]
        for table in ready:
            order.append(table)
            remaining.remove(table)
    return order


class _PredicateBuilder:
    def __init__(self, schema: _Schema, direct: set[str], scope: set[str]):
        self.schema = schema
        self.direct = direct
        self.scope = scope
        self.by_child = _fks_by_child(schema)

    def rows_in_house(self, table: str, alias: str = "t") -> str:
        """Predicate for the target table, qualified with its statement alias.

        The alias matters: an unqualified child column inside the EXISTS
        subquery would resolve to a same-named column of the parent table
        (e.g. ``employees.employee_id``) instead of the row being deleted.
        """
        return self._predicate(table, alias, depth=0, visiting=())

    def _predicate(
        self, table: str, alias: str, depth: int, visiting: tuple[str, ...]
    ) -> str:
        column_prefix = f"{alias}." if alias else ""
        if table in self.direct:
            return f'{column_prefix}{_q("house_id")} = :house_id'

        if table in visiting:
            # Non-house-scoped cycle: cannot resolve, so match nothing.
            return "1 = 0"

        visiting = visiting + (table,)
        clauses: list[str] = []
        for index, fk in enumerate(self.by_child.get(table, ())):
            if fk.parent_table not in self.scope or fk.parent_table == table:
                continue
            parent_alias = f"hp{depth}_{index}"
            join = " AND ".join(
                f"{parent_alias}.{_q(parent_col)} = {column_prefix}{_q(child_col)}"
                for child_col, parent_col in zip(
                    fk.child_columns, fk.parent_columns
                )
            )
            parent_predicate = self._predicate(
                fk.parent_table, parent_alias, depth + 1, visiting
            )
            clauses.append(
                f"EXISTS (SELECT 1 FROM {_q(fk.parent_table)} {parent_alias} "
                f"WHERE {join} AND {parent_predicate})"
            )

        if not clauses:
            return "1 = 0"
        return "(" + " OR ".join(clauses) + ")"


async def _fetch_exclusive_member_ids(db: AsyncSession, house_id: int) -> list[int]:
    """User accounts whose only house membership is the house being deleted."""
    super_admin_placeholders = ", ".join(
        f":role_{index}" for index in range(len(_SUPER_ADMIN_ROLE_NAMES))
    )
    params: dict[str, object] = {"house_id": house_id}
    params.update(
        {f"role_{index}": name for index, name in enumerate(_SUPER_ADMIN_ROLE_NAMES)}
    )
    result = await db.execute(
        text(
            f"""
            SELECT u.id
            FROM users u
            JOIN users_houses uh ON uh.user_id = u.id
            WHERE uh.house_id = :house_id
              AND NOT EXISTS (
                    SELECT 1
                    FROM users_houses memberships
                    WHERE memberships.user_id = u.id
                      AND memberships.house_id <> :house_id
                  )
              AND NOT EXISTS (
                    SELECT 1
                    FROM users_roles ur
                    JOIN roles r ON r.id = ur.role_id
                    WHERE ur.user_id = u.id
                      AND lower(r.name) IN ({super_admin_placeholders})
                  )
            """
        ),
        params,
    )
    return [row[0] for row in result.all()]


async def _delete_orphaned_users(
    db: AsyncSession,
    schema: _Schema,
    candidate_ids: list[int],
    current_user_id: int | None,
) -> int:
    """Delete accounts that existed only for this house.

    Shared accounts (more than one house) are kept untouched, as are super
    admins. An account that is still referenced by a non-nullable row in
    another tenant is also kept — deleting it would corrupt that tenant's data.
    """
    if not candidate_ids or not schema.has_table("users"):
        return 0

    user_fks = [
        fk
        for fk in schema.foreign_keys
        if fk.parent_table == "users"
        and fk.child_table not in _USER_DEPENDENT_TABLES
        and fk.child_table != "users"
    ]

    deleted = 0
    for user_id in candidate_ids:
        if current_user_id is not None and user_id == current_user_id:
            continue

        if schema.has_table("employees"):
            linked = (
                await db.execute(
                    text("SELECT 1 FROM employees WHERE user_id = :user_id LIMIT 1"),
                    {"user_id": user_id},
                )
            ).first()
            if linked is not None:
                continue

        # A non-nullable reference outside the purge scope means the account
        # owns data in another tenant — keep the account.
        blocked = False
        for fk in user_fks:
            if len(fk.child_columns) != 1:
                continue
            column = fk.child_columns[0]
            if schema.tables.get(fk.child_table, {}).get(column, True):
                continue
            existing = (
                await db.execute(
                    text(
                        f"SELECT 1 FROM {_q(fk.child_table)} "
                        f"WHERE {_q(column)} = :user_id LIMIT 1"
                    ),
                    {"user_id": user_id},
                )
            ).first()
            if existing is not None:
                blocked = True
                break
        if blocked:
            continue

        try:
            async with db.begin_nested():
                # Break nullable references from every table (audit columns,
                # assignee columns, ...) before removing the account.
                for fk in user_fks:
                    if len(fk.child_columns) != 1:
                        continue
                    column = fk.child_columns[0]
                    if not schema.tables.get(fk.child_table, {}).get(column, True):
                        continue
                    await db.execute(
                        text(
                            f"UPDATE {_q(fk.child_table)} "
                            f"SET {_q(column)} = NULL WHERE {_q(column)} = :user_id"
                        ),
                        {"user_id": user_id},
                    )

                if schema.has_table("users"):
                    await db.execute(
                        text("UPDATE users SET parent_id = NULL WHERE parent_id = :user_id"),
                        {"user_id": user_id},
                    )

                for table in _USER_DEPENDENT_TABLES:
                    if not schema.has_table(table):
                        continue
                    await db.execute(
                        text(
                            f"DELETE FROM {_q(table)} "
                            f"WHERE {_q('user_id')} = :user_id"
                        ),
                        {"user_id": user_id},
                    )

                await db.execute(
                    text("DELETE FROM users WHERE id = :user_id"),
                    {"user_id": user_id},
                )
            deleted += 1
        except IntegrityError:
            logger.warning(
                "House purge kept user %s: still referenced elsewhere", user_id
            )
    return deleted


async def purge_house(
    db: AsyncSession,
    house_id: int,
    current_user_id: int | None = None,
) -> dict[str, int]:
    """Delete every row that belongs to ``house_id``.

    Returns per-table deleted row counts plus ``users`` for removed orphan
    accounts. Raises :class:`HousePurgeError` when the house row does not exist.
    """
    schema = await _get_schema(db)

    if not schema.has_table("houses"):
        raise HousePurgeError("The houses table is missing from the database schema")

    house_exists = (
        await db.execute(
            text("SELECT 1 FROM houses WHERE id = :house_id"), {"house_id": house_id}
        )
    ).first()
    if house_exists is None:
        raise HousePurgeError(f"House {house_id} does not exist")

    direct, scope = _build_scope(schema)
    if "houses" in scope:
        scope.discard("houses")

    order = _topological_order(scope, schema.foreign_keys)
    # Children first: never remove a parent while a child row still points at it.
    delete_order = list(reversed(order))
    position = {table: index for index, table in enumerate(delete_order)}

    predicates = _PredicateBuilder(schema, direct, scope)

    # Foreign-key cycles (e.g. ev_kit_inventory <-> sim_replacement_requests)
    # cannot be ordered. Break them by nulling the nullable side of every
    # backward edge, which is safe because the whole tenant is going away.
    for fk in schema.foreign_keys:
        if (
            fk.child_table not in scope
            or fk.parent_table not in scope
            or fk.child_table == fk.parent_table
        ):
            continue
        if position.get(fk.child_table, -1) <= position.get(fk.parent_table, -1):
            continue
        if any(
            not schema.tables.get(fk.child_table, {}).get(column, True)
            for column in fk.child_columns
        ):
            logger.warning(
                "House purge: non-nullable cycle edge %s.%s -> %s.%s",
                fk.child_table,
                fk.child_columns,
                fk.parent_table,
                fk.parent_columns,
            )
            continue
        assignments = ", ".join(
            f"{_q(column)} = NULL" for column in fk.child_columns
        )
        await db.execute(
            text(
                f"UPDATE {_q(fk.child_table)} AS t SET {assignments} "
                f"WHERE {predicates.rows_in_house(fk.child_table)}"
            ),
            {"house_id": house_id},
        )

    candidates = (
        await _fetch_exclusive_member_ids(db, house_id)
        if schema.has_table("users")
        and schema.has_table("users_houses")
        and schema.has_table("users_roles")
        and schema.has_table("roles")
        else []
    )

    counts: dict[str, int] = {}
    total_rows = 0
    for table in delete_order:
        result = await db.execute(
            text(
                f"DELETE FROM {_q(table)} AS t "
                f"WHERE {predicates.rows_in_house(table)}"
            ),
            {"house_id": house_id},
        )
        deleted = max(result.rowcount or 0, 0)
        if deleted:
            counts[table] = deleted
            total_rows += deleted

    users_deleted = await _delete_orphaned_users(
        db, schema, candidates, current_user_id
    )
    if users_deleted:
        counts["users"] = users_deleted

    result = await db.execute(
        text("DELETE FROM houses WHERE id = :house_id"), {"house_id": house_id}
    )
    if max(result.rowcount or 0, 0) == 0:
        raise HousePurgeError(f"House {house_id} disappeared during the purge")
    counts["houses"] = 1

    logger.info(
        "Purged house %s: %s rows across %s tables (%s users deleted)",
        house_id,
        total_rows + users_deleted,
        len(counts),
        users_deleted,
    )
    return counts
