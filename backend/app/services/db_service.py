import json
import logging
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy import text
from config.settings import DATABASE_URL
from app.models.base import Base
import app.models.user
import app.models.house
import app.models.role
import app.models.live_activation
import app.models.retailer
import app.models.retailer_marking
import app.models.rule_config
import app.models.employee
import app.models.employee_document
import app.models.supervisor_assignment
import app.models.bts
import app.models.ga_filter
import app.models.mela
import app.models.activation
import app.models.subscription
import app.models.itopup_detail
import app.models.scratch_card_issue
import app.models.sim_issue
import app.models.sync_history
import app.models.house_target
import app.models.supervisor_target
import app.models.rso_target
import app.models.active_lso_config
import app.models.active_sso_config
import app.models.bp_target
import app.models.activity_log
import app.models.app_setting
import app.models.scratch_card_serial
import app.models.lifting
import app.models.bp_retailer_code
import app.models.zoom_in
import app.models.commission
import app.models.product
import app.models.todo
import app.models.cv
import app.models.stock
import app.models.sales
import app.models.itopup_balance
import app.models.whatsapp_schedule
import app.models.whatsapp_contact
import app.models.ga_report_event
import app.models.ga_report_template
import app.models.ga_report_target
import app.models.database_backup

logger = logging.getLogger(__name__)

# Fatal startup problems found by migrations. `main.py` checks this after
# `init_db()` and refuses to serve traffic when it is non-empty — a
# half-migrated database must not take requests (e.g. the fail-closed billing
# rollout failing would otherwise lock every plan-less tenant out).
STARTUP_FATAL_ERRORS: list[str] = []

# Stable PostgreSQL advisory-lock key for the billing rollout migration, so
# concurrent workers serialize instead of each inserting a subscription.
_BILLING_MIGRATION_LOCK_KEY = 7_312_604_118

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_size=50,
    max_overflow=30,
    pool_pre_ping=True,
    pool_recycle=3600,
)
async_session = async_sessionmaker(engine, expire_on_commit=False)

async def _migrate_retailer_filter_tag_id():
    try:
        async with engine.begin() as conn:
            result = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns WHERE table_name='retailer_filters' AND column_name='tag_id'"
            ))
            if result.scalar():
                return
            logger.info("Migrating retailer_filters: adding tag_id column...")
            await conn.execute(text("ALTER TABLE retailer_filters ADD COLUMN tag_id INTEGER"))
            await conn.execute(text(
                "UPDATE retailer_filters rf SET tag_id = ft.id FROM filter_tags ft "
                "WHERE rf.tag = ft.name AND rf.house_id = ft.house_id"
            ))
            await conn.execute(text("ALTER TABLE retailer_filters ALTER COLUMN tag_id SET NOT NULL"))
            await conn.execute(text("ALTER TABLE retailer_filters DROP COLUMN IF EXISTS tag"))
            await conn.execute(text(
                "ALTER TABLE retailer_filters DROP CONSTRAINT IF EXISTS uix_house_retailer_filter"
            ))
            await conn.execute(text(
                "ALTER TABLE retailer_filters ADD CONSTRAINT uix_house_retailer_tag "
                "UNIQUE (house_id, retailer_id, tag_id)"
            ))
            await conn.execute(text(
                "ALTER TABLE retailer_filters ADD CONSTRAINT fk_retailer_filters_tag_id "
                "FOREIGN KEY (tag_id) REFERENCES filter_tags(id) ON DELETE CASCADE"
            ))
            logger.info("Migration complete: retailer_filters.tag_id")
    except Exception as e:
        logger.warning(f"Migration warning (retailer_filters.tag_id): {e}")

async def _migrate_retailer_markings():
    """One-time migration of legacy filter_tags/retailer_filters into the global
    retailer_markings/retailer_marking_assignments tables.

    - Each distinct tag name becomes one global marking (code = UPPER(name)).
    - Each retailer_filters row becomes an active assignment.
      Cross-house tags with the same name collapse into the single global marking.
    - `retailer_markings` is unique on both name and code, and two tag names that
      differ only by case map to the same UPPER(name) code. The markings INSERT
      therefore dedupes on the code and uses a bare ON CONFLICT DO NOTHING so a
      collision with either constraint is skipped instead of aborting the run.
    Idempotent: guarded by the presence of migrated markings; both INSERTs use
    ON CONFLICT DO NOTHING so a partial re-run is safe.
    """
    try:
        async with engine.begin() as conn:
            migrated_count = (await conn.execute(text(
                "SELECT COUNT(*) FROM retailer_markings WHERE description = 'Migrated from filter_tags'"
            ))).scalar() or 0
            if migrated_count > 0:
                return
            logger.info("Migrating filter_tags -> retailer_markings ...")
            await conn.execute(text(
                "INSERT INTO retailer_markings (name, code, status, description, created_at, is_deleted) "
                "SELECT DISTINCT ON (UPPER(ft.name)) ft.name, UPPER(ft.name), 'active', 'Migrated from filter_tags', NOW(), false "
                "FROM (SELECT DISTINCT name FROM filter_tags) ft ORDER BY UPPER(ft.name) "
                "ON CONFLICT DO NOTHING"
            ))
            await conn.execute(text(
                "INSERT INTO retailer_marking_assignments "
                "(retailer_id, marking_id, status, effective_from, assigned_at, created_at, remarks) "
                "SELECT DISTINCT rf.retailer_id, rm.id, 'active', COALESCE(rf.created_at, NOW()), NOW(), NOW(), "
                "'Migrated from retailer_filters' "
                "FROM retailer_filters rf "
                "JOIN filter_tags ft ON ft.id = rf.tag_id "
                "JOIN retailer_markings rm ON rm.code = UPPER(ft.name) "
                "WHERE rm.is_deleted = false "
                # Bare ON CONFLICT DO NOTHING: the active-row guard is a partial
                # unique index (status = 'active'), so a column-list conflict
                # target would no longer find a matching index.
                "ON CONFLICT DO NOTHING"
            ))
            logger.info("Migration complete: retailer_markings")
    except Exception as e:
        logger.warning(f"Migration warning (retailer_markings): {e}")

async def _migrate_retailer_markings_hard_delete():
    """retailer_markings uses hard delete only (no soft delete).

    - Sets a server default so raw INSERTs can never leave is_deleted NULL.
    - Backfills legacy rows that carry NULL (from older raw INSERTs).
    - Physically removes rows that were previously soft-deleted.
    Idempotent and safe to run on every startup.
    """
    try:
        async with engine.begin() as conn:
            await conn.execute(text(
                "ALTER TABLE retailer_markings ALTER COLUMN is_deleted SET DEFAULT false"
            ))
            await conn.execute(text(
                "UPDATE retailer_markings SET is_deleted = false WHERE is_deleted IS NULL"
            ))
            await conn.execute(text(
                "DELETE FROM retailer_markings WHERE is_deleted = true"
            ))
            logger.info("Migration complete: retailer_markings hard delete normalization")
    except Exception as e:
        logger.warning(f"Migration warning (retailer_markings hard delete): {e}")

async def _migrate_retailer_marking_auto_source():
    """Auto-managed markings: add `retailer_markings.auto_source`.

    The column binds a marking to the employees' assisted codes (values:
    `bp_assisted` / `rso_assisted`). Existing BP and RSO markings — the ones that
    have always been maintained from assisted codes by hand — are adopted once,
    when the column is first created. A later manual clear is never re-applied.
    Idempotent: the backfill only runs on the run that adds the column.
    """
    try:
        async with engine.begin() as conn:
            result = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name='retailer_markings' AND column_name='auto_source'"
            ))
            if result.scalar():
                return
            logger.info("Migrating retailer_markings: adding auto_source column...")
            await conn.execute(text(
                "ALTER TABLE retailer_markings ADD COLUMN auto_source VARCHAR(30)"
            ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_retailer_markings_auto_source "
                "ON retailer_markings (auto_source)"
            ))
            adopted = (await conn.execute(text(
                "UPDATE retailer_markings SET auto_source = CASE "
                "WHEN UPPER(code) = 'BP' THEN 'bp_assisted' "
                "WHEN UPPER(code) = 'RSO' THEN 'rso_assisted' END "
                "WHERE auto_source IS NULL AND UPPER(code) IN ('BP', 'RSO')"
            ))).rowcount
            logger.info(
                "Migration complete: retailer_markings.auto_source (%s marking(s) adopted)",
                adopted,
            )
    except Exception as e:
        logger.warning(f"Migration warning (retailer_markings.auto_source): {e}")


async def _migrate_retailer_marking_assignment_unique():
    """Only one *active* assignment per (retailer, marking) — history stays append-only.

    The original unique constraint covered (retailer_id, marking_id, status), which
    allowed at most one active AND one inactive row per pair. Removing a marking a
    second time then collided with the tombstone row and raised a 500. It is
    replaced by a partial unique index that only guards the active row, so
    assign -> remove -> assign -> remove keeps a full audit trail.
    Idempotent and safe to run on every startup.
    """
    try:
        async with engine.begin() as conn:
            await conn.execute(text(
                "ALTER TABLE retailer_marking_assignments "
                "DROP CONSTRAINT IF EXISTS uq_retailer_marking_active"
            ))
            await conn.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_retailer_marking_active "
                "ON retailer_marking_assignments (retailer_id, marking_id) "
                "WHERE status = 'active'"
            ))
            logger.info("Migration complete: retailer_marking_assignments active-row unique index")
    except Exception as e:
        logger.warning(f"Migration warning (retailer_marking_assignments unique): {e}")


async def _sync_retailer_markings_on_startup():
    """Rebuild auto-managed markings once per boot.

    Skipped while the employees table is still empty (fresh install before the
    first employee import) so nothing is wiped on an incomplete dataset.
    """
    try:
        from app.services.retailer_marking_auto_service import run_auto_marking_sync

        async with async_session() as session:
            employee_count = (await session.execute(
                text("SELECT COUNT(*) FROM employees")
            )).scalar() or 0
            if not employee_count:
                return
            summary = await run_auto_marking_sync(session)
            if summary and (summary["added"] or summary["removed"]):
                logger.info(
                    "Auto marking sync (startup): %s added, %s removed",
                    summary["added"], summary["removed"],
                )
    except Exception as e:
        logger.warning(f"Startup auto marking sync skipped: {e}")


async def _migrate_app_settings_daily_sync():
    try:
        async with engine.begin() as conn:
            result = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns WHERE table_name='app_settings' AND column_name='is_daily_sync_enabled'"
            ))
            if result.scalar():
                return
            logger.info("Migrating app_settings: adding is_daily_sync_enabled column...")
            await conn.execute(text(
                "ALTER TABLE app_settings ADD COLUMN is_daily_sync_enabled INTEGER NOT NULL DEFAULT 1"
            ))
            logger.info("Migration complete: app_settings.is_daily_sync_enabled")
    except Exception as e:
        logger.warning(f"Migration warning (app_settings.is_daily_sync_enabled): {e}")

async def _migrate_app_settings_favicon():
    try:
        async with engine.begin() as conn:
            result = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns WHERE table_name='app_settings' AND column_name='favicon'"
            ))
            if result.scalar():
                return
            logger.info("Migrating app_settings: adding favicon column...")
            await conn.execute(text(
                "ALTER TABLE app_settings ADD COLUMN favicon VARCHAR(255)"
            ))
            logger.info("Migration complete: app_settings.favicon")
    except Exception as e:
        logger.warning(f"Migration warning (app_settings.favicon): {e}")

async def _migrate_app_settings_sim_serial_length():
    try:
        async with engine.begin() as conn:
            result = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns WHERE table_name='app_settings' AND column_name='sim_serial_length'"
            ))
            if result.scalar():
                return
            logger.info("Migrating app_settings: adding sim_serial_length column...")
            await conn.execute(text(
                "ALTER TABLE app_settings ADD COLUMN sim_serial_length INTEGER NOT NULL DEFAULT 18"
            ))
            logger.info("Migration complete: app_settings.sim_serial_length")
    except Exception as e:
        logger.warning(f"Migration warning (app_settings.sim_serial_length): {e}")

async def _migrate_app_settings_maintenance():
    """Adds maintenance mode columns (flag + grace start + message + audit)."""
    columns = [
        ("maintenance_enabled", "ALTER TABLE app_settings ADD COLUMN maintenance_enabled INTEGER NOT NULL DEFAULT 0"),
        ("maintenance_enabled_at", "ALTER TABLE app_settings ADD COLUMN maintenance_enabled_at TIMESTAMP"),
        ("maintenance_message", "ALTER TABLE app_settings ADD COLUMN maintenance_message TEXT"),
        ("maintenance_updated_at", "ALTER TABLE app_settings ADD COLUMN maintenance_updated_at TIMESTAMP"),
        ("maintenance_updated_by", "ALTER TABLE app_settings ADD COLUMN maintenance_updated_by INTEGER"),
    ]
    try:
        async with engine.begin() as conn:
            for name, ddl in columns:
                result = await conn.execute(text(
                    f"SELECT column_name FROM information_schema.columns WHERE table_name='app_settings' AND column_name='{name}'"
                ))
                if result.scalar():
                    continue
                logger.info(f"Migrating app_settings: adding {name} column...")
                await conn.execute(text(ddl))
            logger.info("Migration complete: app_settings maintenance columns")
    except Exception as e:
        logger.warning(f"Migration warning (app_settings maintenance): {e}")

INDEX_MIGRATIONS = [
    # activations table
    ("ix_activations_house_id", "CREATE INDEX IF NOT EXISTS ix_activations_house_id ON activations (house_id)"),
    ("ix_activations_product_code", "CREATE INDEX IF NOT EXISTS ix_activations_product_code ON activations (product_code)"),
    ("ix_activations_house_date", "CREATE INDEX IF NOT EXISTS ix_activations_house_date ON activations (house_id, activation_date)"),
    ("ix_activations_retailer_id", "CREATE INDEX IF NOT EXISTS ix_activations_retailer_id ON activations (retailer_id)"),
    # itopup_details table
    ("ix_itopup_details_house_id", "CREATE INDEX IF NOT EXISTS ix_itopup_details_house_id ON itopup_details (house_id)"),
    ("ix_itopup_details_house_date", "CREATE INDEX IF NOT EXISTS ix_itopup_details_house_date ON itopup_details (house_id, report_date)"),
    # scratch_card_issues table
    ("ix_scratch_card_issues_house_id", "CREATE INDEX IF NOT EXISTS ix_scratch_card_issues_house_id ON scratch_card_issues (house_id)"),
    ("ix_scratch_card_issues_house_date", "CREATE INDEX IF NOT EXISTS ix_scratch_card_issues_house_date ON scratch_card_issues (house_id, issue_date)"),
    # sim_issues table
    ("ix_sim_issues_house_id", "CREATE INDEX IF NOT EXISTS ix_sim_issues_house_id ON sim_issues (house_id)"),
    ("ix_sim_issues_house_date", "CREATE INDEX IF NOT EXISTS ix_sim_issues_house_date ON sim_issues (house_id, issue_date)"),
    # live_activations table
    ("ix_live_activations_house_id", "CREATE INDEX IF NOT EXISTS ix_live_activations_house_id ON live_activations (house_id)"),
    ("ix_live_activations_product_code", "CREATE INDEX IF NOT EXISTS ix_live_activations_product_code ON live_activations (product_code)"),
    ("ix_live_activations_activation_date", "CREATE INDEX IF NOT EXISTS ix_live_activations_activation_date ON live_activations (activation_date)"),
    # sync_history table
    ("ix_sync_history_house_id", "CREATE INDEX IF NOT EXISTS ix_sync_history_house_id ON sync_history (house_id)"),
    ("ix_sync_history_module_name", "CREATE INDEX IF NOT EXISTS ix_sync_history_module_name ON sync_history (module_name)"),
    ("ix_sync_history_sync_date", "CREATE INDEX IF NOT EXISTS ix_sync_history_sync_date ON sync_history (sync_date)"),
    # retailer_filters table
    ("ix_retailer_filters_retailer_id", "CREATE INDEX IF NOT EXISTS ix_retailer_filters_retailer_id ON retailer_filters (retailer_id)"),
    ("ix_retailer_filters_tag_id", "CREATE INDEX IF NOT EXISTS ix_retailer_filters_tag_id ON retailer_filters (tag_id)"),
    # retailers table
    ("ix_retailers_house_id", "CREATE INDEX IF NOT EXISTS ix_retailers_house_id ON retailers (house_id)"),
    ("ix_retailers_house_employee", "CREATE INDEX IF NOT EXISTS ix_retailers_house_employee ON retailers (house_id, employee_id)"),
    # filter_tags table
    ("ix_filter_tags_name", "CREATE INDEX IF NOT EXISTS ix_filter_tags_name ON filter_tags (name)"),
]

async def _migrate_indexes():
    for name, sql in INDEX_MIGRATIONS:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(sql))
        except Exception as e:
            logger.warning(f"Index migration warning ({name}): {e}")
    logger.info("Index migrations complete")

async def _migrate_live_activation_date_type():
    try:
        async with engine.begin() as conn:
            result = await conn.execute(text(
                "SELECT data_type FROM information_schema.columns WHERE table_name='live_activations' AND column_name='activation_date'"
            ))
            current_type = result.scalar()
            if current_type and current_type.lower() == 'date':
                return
            logger.info("Migrating live_activations: changing activation_date from VARCHAR to DATE...")
            await conn.execute(text("ALTER TABLE live_activations ALTER COLUMN activation_date TYPE DATE USING activation_date::date"))
            logger.info("Migration complete: live_activations.activation_date  DATE")
    except Exception as e:
        logger.warning(f"Migration warning (live_activations.activation_date): {e}")

async def _migrate_bp_target_remove_soft_delete():
    try:
        async with engine.begin() as conn:
            result = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns WHERE table_name='bp_targets' AND column_name='is_deleted'"
            ))
            if not result.scalar():
                return
            logger.info("Migrating bp_targets: removing soft delete columns...")
            await conn.execute(text("DROP INDEX IF EXISTS ix_bp_targets_is_deleted"))
            await conn.execute(text("ALTER TABLE bp_targets DROP COLUMN IF EXISTS deleted_by"))
            await conn.execute(text("ALTER TABLE bp_targets DROP COLUMN IF EXISTS deleted_at"))
            await conn.execute(text("ALTER TABLE bp_targets DROP COLUMN IF EXISTS is_deleted"))
            logger.info("Migration complete: bp_targets soft delete removed")
    except Exception as e:
        logger.warning(f"Migration warning (bp_targets remove soft delete): {e}")

async def _migrate_employee_sr_no():
    try:
        async with engine.begin() as conn:
            result = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns WHERE table_name='employees' AND column_name='sr_no'"
            ))
            if result.scalar():
                return
            logger.info("Migrating employees: adding sr_no column...")
            await conn.execute(text("ALTER TABLE employees ADD COLUMN sr_no VARCHAR"))
            logger.info("Migration complete: employees.sr_no")
    except Exception as e:
        logger.warning(f"Migration warning (employees.sr_no): {e}")

async def _migrate_employee_name():
    """Add employees.employee_name (Excel Name column) and backfill it from the
    linked users table so existing employees get a real name immediately."""
    try:
        async with engine.begin() as conn:
            result = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns WHERE table_name='employees' AND column_name='employee_name'"
            ))
            if not result.scalar():
                logger.info("Migrating employees: adding employee_name column...")
                await conn.execute(text("ALTER TABLE employees ADD COLUMN employee_name VARCHAR"))
                logger.info("Migration complete: employees.employee_name")
            backfilled = await conn.execute(text(
                """
                UPDATE employees e
                SET employee_name = u.name
                FROM users u
                WHERE e.user_id = u.id
                  AND u.name IS NOT NULL AND u.name <> ''
                  AND (e.employee_name IS NULL OR e.employee_name = '')
                """
            ))
            if backfilled.rowcount:
                logger.info(f"Migration: backfilled employee_name for {backfilled.rowcount} employee(s) from linked users")
    except Exception as e:
        logger.warning(f"Migration warning (employees.employee_name): {e}")

async def _migrate_employee_photo_url():
    """Add employees.photo_url for the profile photo uploaded from the
    Register/Edit Employee modal."""
    try:
        async with engine.begin() as conn:
            result = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns WHERE table_name='employees' AND column_name='photo_url'"
            ))
            if result.scalar():
                return
            logger.info("Migrating employees: adding photo_url column...")
            await conn.execute(text("ALTER TABLE employees ADD COLUMN photo_url VARCHAR(500)"))
            logger.info("Migration complete: employees.photo_url")
    except Exception as e:
        logger.warning(f"Migration warning (employees.photo_url): {e}")


async def _migrate_supervisor_member_rename():
    """Rename supervisor_rso_assignments.rso_employee_id -> member_employee_id.

    The pivot stores RSO AND BP team members under a supervisor, so the old
    column name was misleading. Renames the column, its unique constraint and
    its auto index. Runs BEFORE create_all so the new model metadata
    (member_employee_id) does not try to create a duplicate index on a column
    that does not exist yet.
    """
    try:
        async with engine.begin() as conn:
            result = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name='supervisor_rso_assignments' AND column_name='rso_employee_id'"
            ))
            if not result.scalar():
                return
            logger.info("Migrating supervisor_rso_assignments: renaming rso_employee_id -> member_employee_id ...")
            await conn.execute(text(
                "ALTER TABLE supervisor_rso_assignments RENAME COLUMN rso_employee_id TO member_employee_id"
            ))
            constraint_exists = await conn.execute(text(
                "SELECT 1 FROM pg_constraint WHERE conname = 'uq_supervisor_rso_rso_employee'"
            ))
            if constraint_exists.scalar():
                await conn.execute(text(
                    "ALTER TABLE supervisor_rso_assignments RENAME CONSTRAINT "
                    "uq_supervisor_rso_rso_employee TO uq_supervisor_rso_member_employee"
                ))
            fk_exists = await conn.execute(text(
                "SELECT 1 FROM pg_constraint WHERE conname = 'supervisor_rso_assignments_rso_employee_id_fkey'"
            ))
            if fk_exists.scalar():
                await conn.execute(text(
                    "ALTER TABLE supervisor_rso_assignments RENAME CONSTRAINT "
                    "supervisor_rso_assignments_rso_employee_id_fkey TO "
                    "supervisor_rso_assignments_member_employee_id_fkey"
                ))
            index_exists = await conn.execute(text(
                "SELECT 1 FROM pg_indexes "
                "WHERE tablename = 'supervisor_rso_assignments' AND indexname = 'ix_supervisor_rso_assignments_rso_employee_id'"
            ))
            if index_exists.scalar():
                await conn.execute(text(
                    "ALTER INDEX ix_supervisor_rso_assignments_rso_employee_id "
                    "RENAME TO ix_supervisor_rso_assignments_member_employee_id"
                ))
            logger.info("Migration complete: supervisor_rso_assignments.member_employee_id")
    except Exception as e:
        logger.warning(f"Migration warning (supervisor member rename): {e}")

async def _migrate_supervisor_rso_pivot():
    """Seed supervisor_rso_assignments from existing User.parent_id reporting lines.
    Idempotent — existing pivot rows are never overwritten."""
    try:
        async with engine.begin() as conn:
            seed = await conn.execute(text(
                """
                INSERT INTO supervisor_rso_assignments
                    (supervisor_employee_id, member_employee_id, house_id, assigned_by, created_at)
                SELECT sup_e.id, sub_e.id, sub_e.house_id, NULL, NOW()
                FROM users sub
                JOIN users sup ON sup.id = sub.parent_id
                JOIN employees sub_e ON sub_e.user_id = sub.id
                JOIN employees sup_e ON sup_e.user_id = sup.id
                JOIN users_roles ur ON ur.user_id = sub.id
                JOIN roles r ON r.id = ur.role_id
                WHERE sub.parent_id IS NOT NULL
                  AND LOWER(r.name) = 'rso'
                ON CONFLICT (member_employee_id) DO NOTHING
                """
            ))
            if seed.rowcount:
                logger.info(f"Migration: seeded {seed.rowcount} supervisor_rso_assignments row(s) from parent_id")
            else:
                logger.info("Migration: supervisor_rso_assignments already synced")
    except Exception as e:
        logger.warning(f"Migration warning (supervisor_rso_pivot): {e}")

async def _migrate_lifting_soft_delete():
    try:
        async with engine.begin() as conn:
            result = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name='lifting_records' AND column_name='is_deleted'"
            ))
            if result.scalar():
                return
            logger.info("Migrating lifting_records: adding soft delete columns...")
            await conn.execute(text(
                "ALTER TABLE lifting_records "
                "ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE, "
                "ADD COLUMN deleted_at TIMESTAMP WITHOUT TIME ZONE, "
                "ADD COLUMN deleted_by INTEGER"
            ))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_lifting_records_is_deleted ON lifting_records (is_deleted)"))
            logger.info("Migration complete: lifting_records soft delete")
    except Exception as e:
        logger.warning(f"Migration warning (lifting_records soft delete): {e}")

async def _migrate_lifting_stock_added():
    try:
        async with engine.begin() as conn:
            result = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name='lifting_records' AND column_name='stock_added'"
            ))
            if result.scalar():
                return
            logger.info("Migrating lifting_records: adding stock_added columns...")
            await conn.execute(text(
                "ALTER TABLE lifting_records "
                "ADD COLUMN stock_added BOOLEAN DEFAULT FALSE, "
                "ADD COLUMN stock_added_at TIMESTAMP WITHOUT TIME ZONE, "
                "ADD COLUMN stock_added_by INTEGER"
            ))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_lifting_records_stock_added ON lifting_records (stock_added)"))
            logger.info("Migration complete: lifting_records.stock_added")
    except Exception as e:
        logger.warning(f"Migration warning (lifting_records stock_added): {e}")

async def _migrate_lifting_deposit_slip():
    try:
        async with engine.begin() as conn:
            result = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name='lifting_records' AND column_name='deposit_slip'"
            ))
            if result.scalar():
                return
            logger.info("Migrating lifting_records: adding deposit_slip column...")
            await conn.execute(text(
                "ALTER TABLE lifting_records ADD COLUMN deposit_slip TEXT"
            ))
            logger.info("Migration complete: lifting_records.deposit_slip")
    except Exception as e:
        logger.warning(f"Migration warning (lifting_records deposit_slip): {e}")


async def _migrate_lifting_pull_fields():
    """Add DMS PreRF bank + pull lifecycle columns to lifting_records."""
    try:
        async with engine.begin() as conn:
            result = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name='lifting_records'"
            ))
            existing = {row[0] for row in result.fetchall()}
            wanted = {
                "bank_id": "INTEGER",
                "bank_name": "VARCHAR(120)",
                "pull_status": "VARCHAR(20)",
                "pull_rf_code": "VARCHAR(100)",
                "pull_message": "TEXT",
                "pull_requested_at": "TIMESTAMP WITHOUT TIME ZONE",
                "pull_completed_at": "TIMESTAMP WITHOUT TIME ZONE",
                "pull_requested_by": "INTEGER",
            }
            missing = {name: ddl for name, ddl in wanted.items() if name not in existing}
            if not missing:
                return
            logger.info("Migrating lifting_records: adding DMS PreRF pull columns...")
            clauses = ", ".join(
                f"ADD COLUMN {name} {ddl}" for name, ddl in missing.items()
            )
            await conn.execute(text(f"ALTER TABLE lifting_records {clauses}"))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_lifting_records_pull_status "
                "ON lifting_records (pull_status)"
            ))
            logger.info("Migration complete: lifting_records DMS PreRF pull columns")
    except Exception as e:
        logger.warning(f"Migration warning (lifting_records pull fields): {e}")

async def _migrate_house_live_sync_enabled():
    """Add is_live_sync_enabled column to houses table (GA live sync toggle)."""
    try:
        async with engine.begin() as conn:
            result = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name='houses' AND column_name='is_live_sync_enabled'"
            ))
            if result.scalar():
                return
            logger.info("Migrating houses: adding is_live_sync_enabled column...")
            await conn.execute(text(
                "ALTER TABLE houses ADD COLUMN is_live_sync_enabled BOOLEAN NOT NULL DEFAULT FALSE"
            ))
            logger.info("Migration complete: houses.is_live_sync_enabled")
    except Exception as e:
        logger.warning(f"Migration warning (houses.is_live_sync_enabled): {e}")

async def _migrate_house_show_pull_button():
    """Add show_pull_button column to houses table (per-house PULL badge toggle)."""
    try:
        async with engine.begin() as conn:
            result = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name='houses' AND column_name='show_pull_button'"
            ))
            if result.scalar():
                return
            logger.info("Migrating houses: adding show_pull_button column...")
            await conn.execute(text(
                "ALTER TABLE houses ADD COLUMN show_pull_button BOOLEAN NOT NULL DEFAULT FALSE"
            ))
            logger.info("Migration complete: houses.show_pull_button")
    except Exception as e:
        logger.warning(f"Migration warning (houses.show_pull_button): {e}")

async def _migrate_house_billing_deactivation():
    """Add deactivated_for_billing column to houses table.

    Marks houses that the billing lifecycle locked because their plan expired,
    so renewal only reactivates those and never overrides a manual deactivation.
    """
    try:
        async with engine.begin() as conn:
            result = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name='houses' AND column_name='deactivated_for_billing'"
            ))
            if result.scalar():
                return
            logger.info("Migrating houses: adding deactivated_for_billing column...")
            await conn.execute(text(
                "ALTER TABLE houses ADD COLUMN deactivated_for_billing BOOLEAN NOT NULL DEFAULT FALSE"
            ))
            logger.info("Migration complete: houses.deactivated_for_billing")
    except Exception as e:
        logger.warning(f"Migration warning (houses.deactivated_for_billing): {e}")

async def _migrate_retailer_employee_link():
    """Fix retailers whose employee_id was auto-linked via itop_number but whose
    retailer_code is actually an employee's assisted_retailer_code.

    BP assisted codes carry the RSO's iTopUp SR number, so the legacy import
    logic wrongly assigned them to the RSO. The correct owner is the employee
    whose assisted_retailer_code equals the retailer code.

    Also re-links retailers that were assigned to a resigned/inactive RSO when an
    Active RSO owns the same iTopUp SR number (successor RSO since the iTop number
    was reassigned). The successor takes over the resigned RSO's retailers too,
    including the ones linked via the resigned RSO's assisted_retailer_code.
    """
    try:
        async with engine.begin() as conn:
            fixed = await conn.execute(text(
                """
                UPDATE retailers r
                SET employee_id = e.id
                FROM employees e
                WHERE e.assisted_retailer_code = r.retailer_code
                  AND r.employee_id IS DISTINCT FROM e.id
                """
            ))
            if fixed.rowcount:
                logger.info(f"Migration complete: re-linked {fixed.rowcount} retailer(s) to their assisted-code owner")
    except Exception as e:
        logger.warning(f"Migration warning (retailer employee link): {e}")

    try:
        async with engine.begin() as conn:
            fixed = await conn.execute(text(
                """
                UPDATE retailers r
                SET employee_id = a.id
                FROM employees e
                JOIN employees a
                  ON a.itop_number = e.itop_number
                 AND a.status = 'Active'
                 AND e.status <> 'Active'
                WHERE r.employee_id = e.id
                  AND a.id <> e.id
                  AND r.employee_id IS DISTINCT FROM a.id
                  AND (r.itop_sr_number = e.itop_number
                       OR r.retailer_code = e.assisted_retailer_code)
                """
            ))
            if fixed.rowcount:
                logger.info(f"Migration complete: re-linked {fixed.rowcount} retailer(s) to their active iTop owner")
    except Exception as e:
        logger.warning(f"Migration warning (retailer itop re-link): {e}")

    try:
        async with engine.begin() as conn:
            fixed = await conn.execute(text(
                """
                UPDATE retailers r
                SET employee_id = a.id
                FROM employees a, employees e
                WHERE r.employee_id = e.id
                  AND r.itop_sr_number = a.itop_number
                  AND a.status = 'Active'
                  AND e.status <> 'Active'
                  AND a.id <> e.id
                  AND r.employee_id IS DISTINCT FROM a.id
                """
            ))
            if fixed.rowcount:
                logger.info(f"Migration complete: re-linked {fixed.rowcount} retailer(s) from resigned owners to active iTop owner")
    except Exception as e:
        logger.warning(f"Migration warning (retailer resigned-owner re-link): {e}")

async def _migrate_activation_employee_id():
    """Add employee_id to activations/live_activations (an immutable snapshot of
    which employee owned the retailer at import time) and backfill existing rows.

    Attribute is based on activate.employee_id (permanent) rather than
    retailers.employee_id (current), so a resigned RSO/BP keeps their
    historical performance even after their retailers are reassigned.
    """
    try:
        async with engine.begin() as conn:
            await conn.execute(text(
                "ALTER TABLE activations ADD COLUMN IF NOT EXISTS employee_id INTEGER REFERENCES employees(id)"
            ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_activations_employee_id ON activations (employee_id)"
            ))
            backfilled = await conn.execute(text(
                """
                UPDATE activations a
                SET employee_id = r.employee_id
                FROM retailers r
                WHERE a.retailer_id = r.id
                  AND a.employee_id IS NULL
                  AND r.employee_id IS NOT NULL
                """
            ))
            if backfilled.rowcount:
                logger.info(f"Migration complete: backfilled employee_id on {backfilled.rowcount} activation(s)")
    except Exception as e:
        logger.warning(f"Migration warning (activations.employee_id): {e}")

    try:
        async with engine.begin() as conn:
            await conn.execute(text(
                "ALTER TABLE live_activations ADD COLUMN IF NOT EXISTS employee_id INTEGER REFERENCES employees(id)"
            ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_live_activations_employee_id ON live_activations (employee_id)"
            ))
            backfilled = await conn.execute(text(
                """
                UPDATE live_activations la
                SET employee_id = r.employee_id
                FROM retailers r
                WHERE la.retailer_id = r.id
                  AND la.employee_id IS NULL
                  AND r.employee_id IS NOT NULL
                """
            ))
            if backfilled.rowcount:
                logger.info(f"Migration complete: backfilled employee_id on {backfilled.rowcount} live activation(s)")
    except Exception as e:
        logger.warning(f"Migration warning (live_activations.employee_id): {e}")

async def _migrate_supervisor_team_link():
    """Re-tag a supervisor's team (RSO/BP pivot rows) to an active successor
    supervisor when the current supervisor is Resigned/Inactive.

    Successor = active supervisor in the same house sharing the resigned
    supervisor's itop_number or pool_number (mirrors the retailer auto
    handoff). Also keeps users.parent_id in sync with the pivot table.
    """
    try:
        async with engine.begin() as conn:
            fixed = await conn.execute(text(
                """
                UPDATE supervisor_rso_assignments a
                SET supervisor_employee_id = s2.id
                FROM employees s1
                JOIN employees s2
                  ON s1.house_id = s2.house_id
                 AND s2.employee_type = 'supervisor'
                 AND s2.status = 'Active'
                 AND s2.id <> s1.id
                 AND ((s2.itop_number IS NOT NULL AND s2.itop_number = s1.itop_number)
                      OR (s2.pool_number IS NOT NULL AND s2.pool_number = s1.pool_number))
                WHERE a.supervisor_employee_id = s1.id
                  AND s1.employee_type = 'supervisor'
                  AND s1.status <> 'Active'
                """
            ))
            if fixed.rowcount:
                logger.info(f"Migration complete: re-tagged {fixed.rowcount} team member(s) to an active successor supervisor")

        async with engine.begin() as conn:
            synced = await conn.execute(text(
                """
                UPDATE users u
                SET parent_id = ns.id
                FROM supervisor_rso_assignments a
                JOIN employees m ON m.id = a.member_employee_id
                JOIN employees s2 ON s2.id = a.supervisor_employee_id
                JOIN users ns ON ns.id = s2.user_id
                WHERE m.user_id = u.id
                  AND u.parent_id IS DISTINCT FROM ns.id
                """
            ))
            if synced.rowcount:
                logger.info(f"Migration complete: synced parent_id for {synced.rowcount} user(s)")
    except Exception as e:
        logger.warning(f"Migration warning (supervisor team link): {e}")

async def _migrate_whatsapp_schedule_report_type():
    """Add report_type column to whatsapp_schedules."""
    try:
        async with engine.begin() as conn:
            schedule_exists = await conn.execute(text(
                "SELECT to_regclass('public.whatsapp_schedules') IS NOT NULL AS exists"
            ))
            if not schedule_exists.scalar():
                return
            await conn.execute(text(
                "ALTER TABLE whatsapp_schedules ADD COLUMN IF NOT EXISTS report_type VARCHAR(50) NOT NULL DEFAULT 'ga_live'"
            ))
            logger.info("Migration: added whatsapp_schedules.report_type")
    except Exception as e:
        logger.warning(f"Migration warning (whatsapp_schedules.report_type): {e}")

async def _migrate_whatsapp_schedule_columns():
    try:
        async with engine.begin() as conn:
            exists = await conn.execute(text(
                "SELECT to_regclass('public.whatsapp_schedules') IS NOT NULL AS exists"
            ))
            if not exists.scalar():
                return
            await conn.execute(text(
                "ALTER TABLE whatsapp_schedules ADD COLUMN IF NOT EXISTS schedule_type VARCHAR(20) NOT NULL DEFAULT 'daily'"
            ))
            await conn.execute(text(
                "ALTER TABLE whatsapp_schedules ADD COLUMN IF NOT EXISTS interval_minutes INTEGER"
            ))
            logger.info("Migration complete: whatsapp_schedules interval columns ensured")
    except Exception as e:
        logger.warning(f"Migration warning (whatsapp schedule columns): {e}")

async def _migrate_whatsapp_schedule_delivery_columns():
    """Add multi-recipient / duration / timezone columns to whatsapp_schedules."""
    try:
        async with engine.begin() as conn:
            exists = await conn.execute(text(
                "SELECT to_regclass('public.whatsapp_schedules') IS NOT NULL AS exists"
            ))
            if not exists.scalar():
                return
            await conn.execute(text(
                "ALTER TABLE whatsapp_schedules ADD COLUMN IF NOT EXISTS target_ids TEXT"
            ))
            await conn.execute(text(
                "ALTER TABLE whatsapp_schedules ADD COLUMN IF NOT EXISTS target_names TEXT"
            ))
            await conn.execute(text(
                "ALTER TABLE whatsapp_schedules ADD COLUMN IF NOT EXISTS starts_on DATE"
            ))
            await conn.execute(text(
                "ALTER TABLE whatsapp_schedules ADD COLUMN IF NOT EXISTS ends_on DATE"
            ))
            await conn.execute(text(
                "ALTER TABLE whatsapp_schedules ADD COLUMN IF NOT EXISTS timezone_name VARCHAR(50) DEFAULT 'Asia/Dhaka'"
            ))
            logger.info("Migration complete: whatsapp_schedules delivery columns ensured")
    except Exception as e:
        logger.warning(f"Migration warning (whatsapp schedule delivery columns): {e}")

async def _migrate_whatsapp_schedule_time_window():
    """Add interval daily delivery-window columns to whatsapp_schedules.

    Defaults to working hours (08:00-21:00) so existing interval schedules
    no longer push GA live reports overnight (midnight / 1 AM / 2 AM sends).
    """
    try:
        async with engine.begin() as conn:
            exists = await conn.execute(text(
                "SELECT to_regclass('public.whatsapp_schedules') IS NOT NULL AS exists"
            ))
            if not exists.scalar():
                return
            await conn.execute(text(
                "ALTER TABLE whatsapp_schedules ADD COLUMN IF NOT EXISTS start_time VARCHAR(5) NOT NULL DEFAULT '00:00'"
            ))
            await conn.execute(text(
                "ALTER TABLE whatsapp_schedules ADD COLUMN IF NOT EXISTS end_time VARCHAR(5) NOT NULL DEFAULT '23:59'"
            ))
            # Apply the working-hours window to existing interval schedules so the
            # overnight-send regression is fixed immediately, not only for new rows.
            await conn.execute(text(
                "UPDATE whatsapp_schedules SET start_time='08:00', end_time='21:00' "
                "WHERE schedule_type='interval' AND (start_time='00:00' AND end_time='23:59' OR start_time IS NULL OR end_time IS NULL)"
            ))
            logger.info("Migration complete: whatsapp_schedules time window ensured")
    except Exception as e:
        logger.warning(f"Migration warning (whatsapp schedule time window): {e}")

async def _migrate_whatsapp_schedule_send_as():
    """Add send_as column to whatsapp_schedules (image | document | pdf)."""
    try:
        async with engine.begin() as conn:
            exists = await conn.execute(text(
                "SELECT to_regclass('public.whatsapp_schedules') IS NOT NULL AS exists"
            ))
            if not exists.scalar():
                return
            await conn.execute(text(
                "ALTER TABLE whatsapp_schedules ADD COLUMN IF NOT EXISTS send_as VARCHAR(10) NOT NULL DEFAULT 'image'"
            ))
            logger.info("Migration complete: whatsapp_schedules send_as ensured")
    except Exception as e:
        logger.warning(f"Migration warning (whatsapp schedule send_as): {e}")

async def _migrate_whatsapp_schedule_orientation():
    """Add orientation column to whatsapp_schedules (portrait | landscape)."""
    try:
        async with engine.begin() as conn:
            exists = await conn.execute(text(
                "SELECT to_regclass('public.whatsapp_schedules') IS NOT NULL AS exists"
            ))
            if not exists.scalar():
                return
            await conn.execute(text(
                "ALTER TABLE whatsapp_schedules ADD COLUMN IF NOT EXISTS orientation VARCHAR(10) NOT NULL DEFAULT 'portrait'"
            ))
            logger.info("Migration complete: whatsapp_schedules orientation ensured")
    except Exception as e:
        logger.warning(f"Migration warning (whatsapp schedule orientation): {e}")

async def _migrate_ga_report_events_config():
    try:
        async with engine.begin() as conn:
            result = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name='ga_report_events' AND column_name='config'"
            ))
            if result.scalar():
                return
            logger.info("Migrating ga_report_events: adding config column...")
            await conn.execute(text("ALTER TABLE ga_report_events ADD COLUMN config JSON"))
            logger.info("Migration complete: ga_report_events.config")
    except Exception as e:
        logger.warning(f"Migration warning (ga_report_events.config): {e}")

async def _migrate_house_whatsapp_columns():
    """Add WhatsApp gateway columns to houses table."""
    try:
        async with engine.begin() as conn:
            columns = [
                ("wa_api_key", "VARCHAR(200)"),
                ("wa_device_id", "VARCHAR(100)"),
                ("wa_device_secret", "VARCHAR(200)"),
                ("wa_jwt_token", "VARCHAR(500)"),
                ("wa_phone_number", "VARCHAR(20)"),
                ("wa_status", "VARCHAR(20) DEFAULT 'disconnected'"),
                ("wa_last_error", "VARCHAR(500)"),
                ("wa_last_connected_at", "TIMESTAMP WITHOUT TIME ZONE"),
            ]
            for col_name, col_def in columns:
                result = await conn.execute(text(
                    f"SELECT column_name FROM information_schema.columns "
                    f"WHERE table_name='houses' AND column_name='{col_name}'"
                ))
                if result.scalar():
                    continue
                await conn.execute(text(f"ALTER TABLE houses ADD COLUMN {col_name} {col_def}"))
                logger.info(f"Migration: added houses.{col_name}")
            logger.info("Migration complete: houses WhatsApp columns")
    except Exception as e:
        logger.warning(f"Migration warning (houses WhatsApp columns): {e}")

async def _migrate_telegram_columns():
    """Add Telegram columns to houses and whatsapp_schedules tables."""
    try:
        async with engine.begin() as conn:
            house_columns = [
                ("telegram_chat_id", "VARCHAR(64)"),
                ("telegram_chat_name", "VARCHAR(200)"),
            ]
            for col_name, col_def in house_columns:
                result = await conn.execute(text(
                    f"SELECT column_name FROM information_schema.columns "
                    f"WHERE table_name='houses' AND column_name='{col_name}'"
                ))
                if result.scalar():
                    continue
                await conn.execute(text(f"ALTER TABLE houses ADD COLUMN {col_name} {col_def}"))
                logger.info(f"Migration: added houses.{col_name}")

            schedule_exists = await conn.execute(text(
                "SELECT to_regclass('public.whatsapp_schedules') IS NOT NULL AS exists"
            ))
            if schedule_exists.scalar():
                await conn.execute(text(
                    "ALTER TABLE whatsapp_schedules ADD COLUMN IF NOT EXISTS channel VARCHAR(16) NOT NULL DEFAULT 'whatsapp'"
                ))
                logger.info("Migration: added whatsapp_schedules.channel")
    except Exception as e:
        logger.warning(f"Migration warning (telegram columns): {e}")

async def _migrate_subscription_billing():
    """Add subscription/billing columns to legacy subscription tables, idempotently."""
    try:
        async with engine.begin() as conn:
            for tbl, columns in (
                ("subscription_packages", [
                    ("slug", "VARCHAR(50)"),
                    ("currency", "VARCHAR(3) DEFAULT 'BDT'"),
                    ("billing_interval", "VARCHAR(16) DEFAULT 'monthly'"),
                    ("price_monthly", "NUMERIC(12,2)"),
                    ("price_yearly", "NUMERIC(12,2)"),
                    ("trial_days", "INTEGER DEFAULT 0"),
                    ("feature_flags", "JSON"),
                    ("allowed_modules", "JSON"),
                    ("limits", "JSON"),
                    ("sort_order", "INTEGER DEFAULT 0"),
                    ("is_deleted", "BOOLEAN DEFAULT FALSE"),
                    ("deleted_at", "TIMESTAMP WITHOUT TIME ZONE"),
                    ("deleted_by", "INTEGER"),
                ]),
                ("house_subscriptions", [
                    ("status", "VARCHAR(20) DEFAULT 'active'"),
                    ("current_period_start", "TIMESTAMP WITHOUT TIME ZONE"),
                    ("current_period_end", "TIMESTAMP WITHOUT TIME ZONE"),
                    ("trial_start", "TIMESTAMP WITHOUT TIME ZONE"),
                    ("trial_end", "TIMESTAMP WITHOUT TIME ZONE"),
                    ("grace_period_end", "TIMESTAMP WITHOUT TIME ZONE"),
                    ("cancel_at_period_end", "BOOLEAN DEFAULT FALSE"),
                    ("cancelled_at", "TIMESTAMP WITHOUT TIME ZONE"),
                    ("cancelled_by", "INTEGER"),
                    ("paused_at", "TIMESTAMP WITHOUT TIME ZONE"),
                    ("resume_at", "TIMESTAMP WITHOUT TIME ZONE"),
                    ("billing_interval", "VARCHAR(16) DEFAULT 'monthly'"),
                    ("currency", "VARCHAR(3) DEFAULT 'BDT'"),
                    ("is_deleted", "BOOLEAN DEFAULT FALSE"),
                    ("deleted_at", "TIMESTAMP WITHOUT TIME ZONE"),
                    ("deleted_by", "INTEGER"),
                ]),
            ):
                for col_name, col_def in columns:
                    result = await conn.execute(text(
                        f"SELECT column_name FROM information_schema.columns "
                        f"WHERE table_name='{tbl}' AND column_name='{col_name}'"
                    ))
                    if result.scalar():
                        continue
                    await conn.execute(text(f"ALTER TABLE {tbl} ADD COLUMN {col_name} {col_def}"))
                    logger.info(f"Migration: added {tbl}.{col_name}")

            # tier column must accept NULL (model declares nullable=True; custom plans use tier=null)
            result = await conn.execute(text(
                "SELECT is_nullable FROM information_schema.columns "
                "WHERE table_name='subscription_packages' AND column_name='tier'"
            ))
            if result.scalar() == "NO":
                await conn.execute(text(
                    "ALTER TABLE subscription_packages ALTER COLUMN tier DROP NOT NULL"
                ))
                logger.info("Migration: subscription_packages.tier is now nullable")

            # Backfill legacy alias -> price_monthly
            result = await conn.execute(text(
                "SELECT COUNT(*) FROM subscription_packages WHERE price_monthly IS NULL"
            ))
            if result.scalar():
                await conn.execute(text(
                    "UPDATE subscription_packages SET "
                    "price_monthly = COALESCE(price, 0), "
                    "price_yearly = COALESCE(price, 0) * 10 "
                    "WHERE price_monthly IS NULL"
                ))
                logger.info("Migration: backfilled subscription_packages.price_monthly/yearly")

            # Backfill slug from tier for legacy rows
            result = await conn.execute(text(
                "SELECT COUNT(*) FROM subscription_packages WHERE slug IS NULL"
            ))
            if result.scalar():
                await conn.execute(text(
                    "UPDATE subscription_packages SET slug = lower(tier::text) "
                    "WHERE slug IS NULL AND tier IS NOT NULL"
                ))
                logger.info("Migration: backfilled subscription_packages.slug")

            # Backfill status / periods on legacy house_subscriptions
            result = await conn.execute(text(
                "SELECT COUNT(*) FROM house_subscriptions WHERE current_period_start IS NULL"
            ))
            if result.scalar():
                await conn.execute(text(
                    "UPDATE house_subscriptions SET "
                    "current_period_start = start_date, "
                    "current_period_end = end_date, "
                    "status = CASE WHEN is_active THEN 'active' ELSE 'expired' END, "
                    "cancel_at_period_end = NOT auto_renew "
                    "WHERE current_period_start IS NULL"
                ))
                logger.info("Migration: backfilled house_subscriptions periods/status")
            logger.info("Migration complete: subscription billing columns ensured")
    except Exception as e:
        logger.warning(f"Migration warning (subscription billing columns): {e}")


async def _migrate_subscription_package_live_uniqueness():
    """Scope plan slug/tier uniqueness to live (non-deleted) rows.

    The legacy schema put full UNIQUE constraints on ``slug`` and ``tier``.
    Soft-deleting a plan therefore kept reserving its identifiers forever, so
    re-creating a plan with the same name (or the same tier) failed with a DB
    IntegrityError / 500. Replace those constraints with partial unique
    indexes that ignore archived rows. Idempotent.
    """
    try:
        async with engine.begin() as conn:
            await conn.execute(text(
                "ALTER TABLE subscription_packages "
                "DROP CONSTRAINT IF EXISTS subscription_packages_tier_key"
            ))
            # Drop the old full unique slug index, keep a plain lookup index.
            await conn.execute(text("DROP INDEX IF EXISTS ix_subscription_packages_slug"))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_subscription_packages_slug "
                "ON subscription_packages (slug)"
            ))
            await conn.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_subscription_packages_slug_live "
                "ON subscription_packages (slug) "
                "WHERE is_deleted = false AND slug IS NOT NULL"
            ))
            await conn.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_subscription_packages_tier_live "
                "ON subscription_packages (tier) "
                "WHERE is_deleted = false AND tier IS NOT NULL"
            ))
            logger.info("Migration complete: plan slug/tier uniqueness scoped to live rows")
    except Exception as e:
        logger.warning(f"Migration warning (subscription package uniqueness): {e}")


async def _migrate_billing_tables_extra():
    """Idempotently add columns added after the original billing tables were created."""
    try:
        async with engine.begin() as conn:
            for tbl, columns in (
                ("payments", [
                    ("subscription_id", "INTEGER"),
                ]),
                ("payment_methods", [
                    ("label", "VARCHAR(120)"),
                    ("instructions", "VARCHAR(500)"),
                    ("is_active", "BOOLEAN DEFAULT TRUE"),
                    ("bank_name", "VARCHAR(120)"),
                    ("account_name", "VARCHAR(120)"),
                    ("account_number", "VARCHAR(60)"),
                    ("routing_number", "VARCHAR(30)"),
                    ("bkash_number", "VARCHAR(30)"),
                    ("nagad_number", "VARCHAR(30)"),
                    ("created_by", "INTEGER"),
                    ("gateway", "VARCHAR(32) DEFAULT 'manual'"),
                    ("is_default", "BOOLEAN DEFAULT FALSE"),
                    ("added_by", "INTEGER"),
                ]),
                ("house_subscriptions", [
                    ("trial_reminder_sent_at", "TIMESTAMP WITHOUT TIME ZONE"),
                ]),
                ("invoices", [
                    ("pdf_path", "VARCHAR(255)"),
                    ("pdf_generated_at", "TIMESTAMP WITHOUT TIME ZONE"),
                ]),
            ):
                for col_name, col_def in columns:
                    result = await conn.execute(text(
                        f"SELECT column_name FROM information_schema.columns "
                        f"WHERE table_name='{tbl}' AND column_name='{col_name}'"
                    ))
                    if result.scalar():
                        continue
                    await conn.execute(text(f"ALTER TABLE {tbl} ADD COLUMN {col_name} {col_def}"))
                    logger.info(f"Migration: added {tbl}.{col_name}")
            logger.info("Migration complete: billing tables extra columns ensured")
    except Exception as e:
        logger.warning(f"Migration warning (billing tables extra columns): {e}")


async def _migrate_remove_payment_gateway_artifacts():
    """Drop the obsolete online-payment tables/columns (manual payments only).

    The SSLCommerz integration was removed: payments are received offline and
    recorded by an authorised admin. The gateway-only artifacts are dropped
    idempotently so an upgraded database matches the current models. Payments
    and payment methods themselves are kept — ``gateway`` there now means the
    manual channel (cash / bank / bkash / ...).
    """
    statements = (
        "DROP TABLE IF EXISTS payment_attempts CASCADE",
        "DROP TABLE IF EXISTS webhook_events CASCADE",
        "ALTER TABLE payments DROP COLUMN IF EXISTS gateway_val_id",
        "ALTER TABLE payments DROP COLUMN IF EXISTS gateway_bank_tran_id",
        "ALTER TABLE payments DROP COLUMN IF EXISTS card_type",
        "ALTER TABLE payments ALTER COLUMN gateway SET DEFAULT 'cash'",
        "ALTER TABLE payment_methods DROP COLUMN IF EXISTS brand",
        "ALTER TABLE payment_methods DROP COLUMN IF EXISTS last4",
        "ALTER TABLE payment_methods DROP COLUMN IF EXISTS token_ref",
        "ALTER TABLE payment_methods DROP COLUMN IF EXISTS customer_id",
        "ALTER TABLE payment_methods DROP COLUMN IF EXISTS is_email_verified",
        "ALTER TABLE payment_methods ALTER COLUMN gateway SET DEFAULT 'manual'",
        "ALTER TABLE house_subscriptions DROP COLUMN IF EXISTS gateway",
        "ALTER TABLE house_subscriptions DROP COLUMN IF EXISTS gateway_customer_id",
        "ALTER TABLE house_subscriptions DROP COLUMN IF EXISTS gateway_reference",
    )
    try:
        async with engine.begin() as conn:
            for stmt in statements:
                try:
                    await conn.execute(text(stmt))
                except Exception as exc:
                    # Missing table/column (fresh DB) or a non-PostgreSQL test DB.
                    logger.debug("Skipping (%s): %s", stmt, exc)
        logger.info("Migration complete: online payment gateway artifacts removed")
    except Exception as e:
        logger.warning(f"Migration warning (remove payment gateway artifacts): {e}")


async def _migrate_bts_own_plan_module():
    """BTS was promoted from a `data_import` sub-page to its own plan module `bts`.

    A plan that grants the whole `data_import` module used to include the BTS page
    implicitly. After the split it would silently lose access, so add the `bts`
    module key to every such plan. Idempotent, and only touches plans that
    explicitly listed `data_import` (plans that granted individual leaves, or
    legacy NULL = unrestricted, are left exactly as they are).
    """
    try:
        async with engine.begin() as conn:
            exists = await conn.execute(text(
                "SELECT to_regclass('public.subscription_packages') IS NOT NULL AS exists"
            ))
            if not exists.scalar():
                return
            result = await conn.execute(text(
                """
                UPDATE subscription_packages
                SET allowed_modules = (
                        SELECT json_agg(item ORDER BY idx)
                        FROM (
                            SELECT idx, value AS item
                            FROM jsonb_array_elements(allowed_modules::jsonb)
                                 WITH ORDINALITY AS t(value, idx)
                            UNION ALL
                            SELECT 999999, '"bts"'::jsonb
                        ) s
                    ),
                    updated_at = NOW()
                WHERE allowed_modules IS NOT NULL
                  AND jsonb_typeof(allowed_modules::jsonb) = 'array'
                  AND NOT (allowed_modules::jsonb ? 'bts')
                  AND (allowed_modules::jsonb ? 'data_import')
                """
            ))
            if result.rowcount:
                logger.info(
                    f"Migration: granted the new 'bts' module to {result.rowcount} "
                    "plan(s) that already had 'data_import'"
                )
    except Exception as e:
        logger.warning(f"Migration warning (bts standalone plan module): {e}")


# Legacy grant keys remapped onto the new `commission` module.
_COMMISSION_KEY_REMAP = {
    "commercial_sales": "commission",
    "/commercial/commission": "commission",
}
# Keys with no surviving page — dropped (that page never existed).
_DROPPED_COMMERCIAL_KEYS = ("/commercial/expenses",)


def _rewrite_allowed_modules(modules: list) -> list:
    """Map a legacy `allowed_modules` list onto the post-split module catalog.

    - `commercial_sales`       -> `commission` (the group's only real page)
    - `/commercial/commission` -> `commission` (page moved to /commission)
    - `/commercial/expenses`   -> dropped (that page never existed)

    Order is preserved and duplicates are collapsed.
    """
    out = []
    for key in modules:
        if key in _DROPPED_COMMERCIAL_KEYS:
            continue
        key = _COMMISSION_KEY_REMAP.get(key, key)
        if key not in out:
            out.append(key)
    return out


async def _migrate_commission_own_plan_module():
    """Commission became its own module (`commission`) and moved /commercial/commission
    -> /commission. The `commercial_sales` group it lived in no longer exists.

    Rewrite every plan's `allowed_modules` so no subscriber silently loses the
    page: module key and page-leaf grants are both remapped onto `commission`,
    and the now-meaningless `commercial_sales` / `/commercial/expenses` keys are
    pruned. Legacy NULL (unrestricted) plans are left untouched. Idempotent.
    """
    try:
        async with engine.begin() as conn:
            exists = await conn.execute(text(
                "SELECT to_regclass('public.subscription_packages') IS NOT NULL AS exists"
            ))
            if not exists.scalar():
                return
            rows = await conn.execute(text(
                """
                SELECT id, allowed_modules
                FROM subscription_packages
                WHERE allowed_modules IS NOT NULL
                  AND jsonb_typeof(allowed_modules::jsonb) = 'array'
                FOR UPDATE
                """
            ))
            updated = 0
            for pkg_id, current in rows:
                new = _rewrite_allowed_modules(list(current or []))
                if new == list(current or []):
                    continue
                await conn.execute(
                    text("UPDATE subscription_packages SET allowed_modules = :mods, updated_at = NOW() WHERE id = :id"),
                    {"mods": json.dumps(new), "id": pkg_id},
                )
                updated += 1
            if updated:
                logger.info(
                    f"Migration: remapped allowed_modules to the new 'commission' module "
                    f"for {updated} plan(s)"
                )
    except Exception as e:
        logger.warning(f"Migration warning (commission standalone plan module): {e}")


async def _migrate_seed_rule_contexts():
    """Seed the built-in report rule contexts (idempotent).

    Contexts are system-level config shared across houses. The built-in ones
    (GA Live, Activation Report, Active SSO) are marked is_system so they cannot
    be deleted; further contexts may be created at runtime via the rule-config
    API.
    """
    try:
        async with engine.begin() as conn:
            await conn.execute(text(
                """INSERT INTO rule_contexts
                     (context_key, name_en, name_bn, icon, sort_order, is_active, is_system, created_at, updated_at, is_deleted)
                   VALUES
                     ('ga_live', 'GA Live', 'GA Live', 'activity', 0, true, true, NOW(), NOW(), false),
                     ('activation_report', 'Activation Report', 'অ্যাক্টিভেশন রিপোর্ট', 'bar-chart-3', 1, true, true, NOW(), NOW(), false),
                     ('active_sso', 'Active SSO', 'অ্যাকটিভ এসএসও', 'target', 2, true, true, NOW(), NOW(), false)
                   ON CONFLICT (context_key) DO NOTHING"""
            ))
            logger.info("Seeded rule contexts")
    except Exception as e:
        logger.warning(f"Seed warning (rule_contexts): {e}")


async def _drop_legacy_ga_section_config_table():
    """Fresh-start: remove the legacy ga_section_configs table and its data.

    The universal rule-config engine replaces ga_section_configs entirely.
    No data is migrated — old section configs are discarded.
    """
    try:
        async with engine.begin() as conn:
            await conn.execute(text("DROP TABLE IF EXISTS ga_section_configs CASCADE"))
            logger.info("Removed legacy table: ga_section_configs")
    except Exception as e:
        logger.warning(f"Migration warning (drop ga_section_configs): {e}")


async def _migrate_rule_apply_to():
    """Add the report-rule ``apply_to`` (page-section) dimension.

    Section-scoped rules let one report page run different rules in different
    places (e.g. summary vs rso vs bp vs supervisor on the activation report).
    Existing rules become ``apply_to = 'all'``.

    The "one active rule per (house, context, role, apply_to, column_key)"
    partial unique index is owned by ``_migrate_rule_column_key()`` (it runs
    immediately after this migration). We deliberately do NOT drop/recreate the
    index here: at this point ``column_key`` may not exist yet, and creating an
    index without ``column_key`` collides whenever a section already owns more
    than one active column-scoped rule (e.g. ach / market_ga / own_ga on the GA
    Live RSO table), which aborts this whole transaction with a
    UniqueViolationError and spams a warning on every startup.
    """
    try:
        async with engine.begin() as conn:
            await conn.execute(text(
                "ALTER TABLE report_rule_masters "
                "ADD COLUMN IF NOT EXISTS apply_to VARCHAR(50) NOT NULL DEFAULT 'all'"
            ))
            await conn.execute(text(
                "UPDATE report_rule_masters "
                "SET apply_to = 'all' WHERE apply_to IS NULL OR apply_to = ''"
            ))
    except Exception as e:
        logger.warning(f"Migration warning (rule apply_to): {e}")


async def _migrate_rule_column_key():
    """Add the report-rule ``column_key`` (metric-column) dimension.

    Column-scoped rules let one report section run a different rule for each
    metric column (e.g. Achieved vs Market GA vs Own GA on the RSO table).
    Existing rules become ``column_key = 'all'`` and the "one active rule per
    (house, context, role, apply_to)" partial unique index is widened to include
    ``column_key`` so each column slot can own one active rule independently.
    """
    try:
        async with engine.begin() as conn:
            await conn.execute(text(
                "ALTER TABLE report_rule_masters "
                "ADD COLUMN IF NOT EXISTS column_key VARCHAR(50) NOT NULL DEFAULT 'all'"
            ))
            await conn.execute(text(
                "UPDATE report_rule_masters "
                "SET column_key = 'all' WHERE column_key IS NULL OR column_key = ''"
            ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_report_rule_masters_column_key "
                "ON report_rule_masters (column_key)"
            ))
            await conn.execute(text(
                "DROP INDEX IF EXISTS uq_rule_master_active_house_context_role"
            ))
            await conn.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_rule_master_active_house_context_role "
                "ON report_rule_masters (house_id, context_key, target_role, apply_to, column_key) "
                "WHERE is_deleted = false AND is_active = true"
            ))
    except Exception as e:
        logger.warning(f"Migration warning (rule column_key): {e}")


async def _migrate_rule_included_employee_user_id_fk():
    """Drop the FK on rule_included_employee_ids.user_id → users.id.

    employees.user_id is a loose reference (no FK to users) and may point to a
    user account that no longer exists. Enforcing the FK here made saving any
    rule with such an employee fail with an IntegrityError (surfaced as
    "Network Error" in the UI). The column is a loose reference of its own, so
    the hard FK is unnecessary.
    """
    try:
        async with engine.begin() as conn:
            tbl = await conn.execute(text(
                "SELECT to_regclass('public.rule_included_employee_ids') IS NOT NULL AS exists"
            ))
            if tbl.scalar():
                await conn.execute(text(
                    "ALTER TABLE rule_included_employee_ids "
                    "DROP CONSTRAINT IF EXISTS rule_included_employee_ids_user_id_fkey"
                ))
                logger.info("Migration: dropped rule_included_employee_ids user_id FK")
    except Exception as e:
        logger.warning(f"Migration warning (rule_included_employee_ids user_id FK): {e}")


async def _migrate_rule_included_employee_to_emp_id():
    """Convert rule_included_employee_ids from user ids to employee ids.

    The column used to hold ``employees.user_id`` (the login), so employees
    without a login account could never be picked in Included Employees. It now
    holds ``employees.id``. Existing rows are translated through the login
    inside the rule's own house; rows whose login maps to no employee of that
    house are dropped because they were already unresolvable, and keeping the
    raw number would silently re-point them at an unrelated employee id.
    """
    try:
        async with engine.begin() as conn:
            table_exists = await conn.execute(text(
                "SELECT to_regclass('public.rule_included_employee_ids') IS NOT NULL"
            ))
            if not table_exists.scalar():
                return

            has_user_col = await conn.execute(text(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_name = 'rule_included_employee_ids' AND column_name = 'user_id'"
            ))
            if has_user_col.scalar():
                # Drop the (rule_id, user_id) unique constraint first. The mapping
                # below rewrites values in place and can transiently collide with a
                # not-yet-updated row (e.g. user_id=11 -> employee 3 while the row
                # user_id=3 still holds 3). A uniqueness violation there aborts the
                # whole migration and leaves the column half-converted.
                await conn.execute(text(
                    "ALTER TABLE rule_included_employee_ids "
                    "DROP CONSTRAINT IF EXISTS uq_rule_included_employee_id_rule_user"
                ))
                await conn.execute(text(
                    "DELETE FROM rule_included_employee_ids AS t "
                    "WHERE NOT EXISTS ("
                    "  SELECT 1 FROM employees AS e"
                    "  JOIN report_rule_masters AS r ON r.id = t.rule_id"
                    "  WHERE e.user_id IS NOT NULL"
                    "    AND e.user_id = t.user_id"
                    "    AND e.house_id = r.house_id)"
                ))
                await conn.execute(text(
                    "UPDATE rule_included_employee_ids AS t "
                    "SET user_id = ("
                    "  SELECT min(e.id) FROM employees AS e"
                    "  JOIN report_rule_masters AS r ON r.id = t.rule_id"
                    "  WHERE e.user_id = t.user_id AND e.house_id = r.house_id)"
                ))
                await conn.execute(text(
                    "ALTER TABLE rule_included_employee_ids RENAME COLUMN user_id TO employee_id"
                ))
                logger.info("Migration: rule_included_employee_ids.user_id → employee_id")

            # Two different logins may resolve to the same employee id within one
            # rule; keep the smallest row and drop the rest so the unique
            # constraint can be (re)created safely.
            await conn.execute(text(
                "DELETE FROM rule_included_employee_ids AS a "
                "USING rule_included_employee_ids AS b "
                "WHERE a.id > b.id AND a.rule_id = b.rule_id "
                "AND a.employee_id = b.employee_id"
            ))

            old_idx = await conn.execute(text(
                "SELECT 1 FROM pg_indexes "
                "WHERE schemaname = 'public' AND indexname = 'ix_rule_included_employee_ids_user_id'"
            ))
            if old_idx.scalar():
                await conn.execute(text(
                    "ALTER INDEX ix_rule_included_employee_ids_user_id "
                    "RENAME TO ix_rule_included_employee_ids_employee_id"
                ))

            old_con = await conn.execute(text(
                "SELECT 1 FROM pg_constraint "
                "WHERE conname = 'uq_rule_included_employee_id_rule_user'"
            ))
            if old_con.scalar():
                await conn.execute(text(
                    "ALTER TABLE rule_included_employee_ids "
                    "RENAME CONSTRAINT uq_rule_included_employee_id_rule_user "
                    "TO uq_rule_included_employee_id_rule_emp"
                ))
                logger.info("Migration: renamed rule_included_employee_ids unique constraint")
            else:
                new_con = await conn.execute(text(
                    "SELECT 1 FROM pg_constraint "
                    "WHERE conname = 'uq_rule_included_employee_id_rule_emp'"
                ))
                if not new_con.scalar():
                    await conn.execute(text(
                        "ALTER TABLE rule_included_employee_ids "
                        "ADD CONSTRAINT uq_rule_included_employee_id_rule_emp "
                        "UNIQUE (rule_id, employee_id)"
                    ))
                    logger.info("Migration: created rule_included_employee_ids unique constraint")
    except Exception as e:
        logger.warning(f"Migration warning (rule_included_employee_ids employee_id): {e}")


async def _migrate_location_telemetry_columns():
    """Add the rich-macro fields (altitude + telemetry JSONB) to the location tables.

    ``Base.metadata.create_all`` never alters an existing table, so devices that
    already produced rows need an explicit ``ADD COLUMN`` pass for the new columns
    added to ``EmployeeLiveLocation`` / ``EmployeeLocation``.
    """
    targets = [
        ("employee_live_locations", "altitude", "DOUBLE PRECISION"),
        ("employee_live_locations", "telemetry", "JSONB"),
        ("employee_locations", "altitude", "DOUBLE PRECISION"),
        ("employee_locations", "telemetry", "JSONB"),
    ]
    try:
        async with engine.begin() as conn:
            for table, column, ddl_type in targets:
                exists = await conn.execute(text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name = :t AND column_name = :c"
                ), {"t": table, "c": column})
                if exists.scalar():
                    continue
                logger.info(f"Migrating {table}: adding {column} column...")
                await conn.execute(text(
                    f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type}"
                ))
            logger.info("Migration complete: location telemetry/altitude columns")
    except Exception as e:
        logger.warning(f"Migration warning (location telemetry columns): {e}")


async def _migrate_billing_fail_closed(db_engine=None) -> dict:
    """Deny-by-default rollout: never lock out a tenant that was working before.

    Turning a fail-open entitlement check into a fail-closed one is a behaviour
    change for every house that has no active plan. Shipping it without a
    migration would block all of those tenants on the next deploy. This
    idempotent pass makes the implicit state explicit instead:

    1. **Legacy audit** — every package-less, non-deleted subscription is
       logged. Those rows used to mean "unrestricted" and are the one remaining
       fail-open path, so operators must see them.
    2. Subscriptions with ``package_id IS NULL`` are attached to the
       legacy-unlimited plan to preserve their meaning.
    3. Active houses with no subscription row at all receive an explicit
       legacy-unlimited subscription (10 years), and are logged by name so the
       grant can be replaced with a real plan.

    Concurrency: the whole pass runs inside one transaction guarded by a
    PostgreSQL transaction-scoped advisory lock, so N workers booting at once
    serialize instead of each inserting a subscription. Every insert is also
    ``WHERE NOT EXISTS`` guarded, so a re-run is a no-op.

    Safety:
    - ``BILLING_LEGACY_BACKFILL_DRY_RUN`` reports the plan without writing.
    - In production a failure is fatal (``STARTUP_FATAL_ERRORS``) instead of
      leaving the fleet half-migrated and locking tenants out.

    Controlled by ``settings.BILLING_LEGACY_BACKFILL``.
    """
    from datetime import timedelta

    from sqlalchemy import and_, insert, literal, select, update

    from app.models.house import House
    from app.models.subscription import HouseSubscription, SubscriptionPackage
    from app.utils.timezone import now_naive
    from config.settings import settings

    target_engine = db_engine or engine
    slug = (settings.BILLING_LEGACY_PLAN_SLUG or "legacy-unlimited").strip()
    dry_run = bool(settings.BILLING_LEGACY_BACKFILL_DRY_RUN)
    now_dt = now_naive()
    # Explicit, long grandfather window; replaces the implicit "no plan = forever".
    legacy_end = now_dt + timedelta(days=3650)
    report: dict = {
        "dry_run": dry_run,
        "legacy_plan_id": None,
        "legacy_plan_created": False,
        "package_less_subscriptions": 0,
        "houses_without_plan": [],
        "repaired_package_less": 0,
        "granted_houses": 0,
    }

    try:
        async with target_engine.begin() as conn:
            # Serialize across every app instance booting at the same time.
            # Transaction-scoped: released automatically on commit/rollback.
            if conn.sync_connection.dialect.name == "postgresql":
                await conn.execute(
                    text("SELECT pg_advisory_xact_lock(:key)"),
                    {"key": _BILLING_MIGRATION_LOCK_KEY},
                )

            # --- 1. Legacy audit (always, even in dry-run) -----------------
            # These rows are the ONLY remaining fail-open path: a package-less
            # subscription is entitled ("legacy unlimited") by design. Every
            # such row must be visible to operators until it carries a real plan.
            legacy_stmt = (
                select(
                    HouseSubscription.id,
                    HouseSubscription.house_id,
                    House.name,
                    HouseSubscription.status,
                    HouseSubscription.end_date,
                )
                .select_from(HouseSubscription)
                .outerjoin(House, House.id == HouseSubscription.house_id)
                .where(
                    HouseSubscription.package_id.is_(None),
                    HouseSubscription.is_deleted.is_(False),
                )
                .order_by(HouseSubscription.id)
            )
            legacy_rows = (await conn.execute(legacy_stmt)).all()
            report["package_less_subscriptions"] = len(legacy_rows)
            if legacy_rows:
                logger.critical(
                    "BILLING AUDIT: %s package-less subscription(s) currently get "
                    "UNRESTRICTED access (fail-open legacy path). Attach a real plan: %s",
                    len(legacy_rows),
                    ", ".join(
                        f"sub={row.id} house={row.house_id}:{row.name}"
                        for row in legacy_rows[:25]
                    ),
                )

            has_sub = (
                select(HouseSubscription.id)
                .where(
                    HouseSubscription.house_id == House.id,
                    HouseSubscription.is_deleted.is_(False),
                )
                .exists()
            )
            missing_stmt = (
                select(House.id, House.name)
                .where(House.is_active.is_(True), ~has_sub)
                .order_by(House.id)
            )
            missing_houses = (await conn.execute(missing_stmt)).all()
            report["houses_without_plan"] = [
                {"id": hid, "name": name} for hid, name in missing_houses
            ]

            if not settings.BILLING_LEGACY_BACKFILL:
                logger.warning(
                    "Billing fail-closed rollout: backfill disabled "
                    "(BILLING_LEGACY_BACKFILL=false) — %s house(s) with no plan stay "
                    "blocked and %s package-less row(s) are blocked as 'no plan'.",
                    len(missing_houses), len(legacy_rows),
                )
                return report

            if not legacy_rows and not missing_houses:
                return report

            if dry_run:
                logger.warning(
                    "BILLING MIGRATION DRY RUN: would create/reuse plan '%s', repair "
                    "%s package-less subscription(s) and grant it to %s house(s): %s",
                    slug, len(legacy_rows), len(missing_houses),
                    ", ".join(f"{hid}:{name}" for hid, name in missing_houses[:50]),
                )
                return report

            # --- 2. Ensure the explicit legacy plan exists ------------------
            plan_id = (await conn.execute(
                select(SubscriptionPackage.id).where(
                    SubscriptionPackage.slug == slug,
                    SubscriptionPackage.is_deleted.is_(False),
                )
            )).scalar()

            if plan_id is None:
                plan_values = {
                    "name": "Legacy Unlimited",
                    "slug": slug,
                    "description": (
                        "Grandfathered plan: full access with no module or feature "
                        "restrictions. Granted to houses that existed before plan "
                        "enforcement; replace it with a real plan and an expiry date."
                    ),
                    "currency": "BDT",
                    "billing_interval": "monthly",
                    "price_monthly": 0,
                    "price_yearly": 0,
                    "trial_days": 0,
                    "feature_flags": ["reports", "import", "dms_sync", "export"],
                    "allowed_modules": None,
                    "limits": {},
                    "is_active": True,
                    "sort_order": 999,
                    "is_deleted": False,
                    "created_at": now_dt,
                    "updated_at": now_dt,
                }
                # ON CONFLICT DO NOTHING closes the race even when the advisory
                # lock is unavailable (e.g. a non-PostgreSQL engine).
                dialect = conn.sync_connection.dialect.name
                if dialect == "postgresql":
                    from sqlalchemy.dialects.postgresql import insert as pg_insert

                    # Bare ON CONFLICT DO NOTHING: slug uniqueness is now a
                    # PARTIAL index (live rows only), which PostgreSQL does not
                    # infer from `index_elements=["slug"]`.
                    await conn.execute(
                        pg_insert(SubscriptionPackage)
                        .values(**plan_values)
                        .on_conflict_do_nothing()
                    )
                elif dialect == "sqlite":
                    from sqlalchemy.dialects.sqlite import insert as sqlite_insert

                    await conn.execute(
                        sqlite_insert(SubscriptionPackage)
                        .values(**plan_values)
                        .on_conflict_do_nothing()
                    )
                else:
                    await conn.execute(insert(SubscriptionPackage).values(**plan_values))

                plan_id = (await conn.execute(
                    select(SubscriptionPackage.id).where(
                        SubscriptionPackage.slug == slug,
                        SubscriptionPackage.is_deleted.is_(False),
                    )
                )).scalar()
                report["legacy_plan_created"] = True
                logger.warning("Created legacy plan '%s' (id=%s)", slug, plan_id)

            report["legacy_plan_id"] = plan_id

            # --- 3. Repair package-less rows (preserve their meaning) -------
            if legacy_rows:
                result = await conn.execute(
                    update(HouseSubscription)
                    .where(
                        HouseSubscription.package_id.is_(None),
                        HouseSubscription.is_deleted.is_(False),
                    )
                    .values(package_id=plan_id, updated_at=now_dt)
                )
                report["repaired_package_less"] = result.rowcount or 0
                logger.warning(
                    "Billing rollout: attached legacy plan to %s package-less "
                    "subscription(s) so they keep full access",
                    report["repaired_package_less"],
                )

            # --- 4. Grant a plan to houses that had none --------------------
            if missing_houses:
                # `from_select` + NOT EXISTS keeps this idempotent: a second
                # run (or a concurrent worker) inserts nothing new.
                grant_cols = [
                    HouseSubscription.house_id,
                    HouseSubscription.package_id,
                    HouseSubscription.status,
                    HouseSubscription.start_date,
                    HouseSubscription.end_date,
                    HouseSubscription.current_period_start,
                    HouseSubscription.current_period_end,
                    HouseSubscription.auto_renew,
                    HouseSubscription.billing_interval,
                    HouseSubscription.currency,
                    HouseSubscription.is_deleted,
                    HouseSubscription.created_at,
                    HouseSubscription.updated_at,
                ]
                grant_src = select(
                    House.id,
                    literal(plan_id),
                    literal("active"),
                    literal(now_dt),
                    literal(legacy_end),
                    literal(now_dt),
                    literal(legacy_end),
                    literal(False),
                    literal("monthly"),
                    literal("BDT"),
                    literal(False),
                    literal(now_dt),
                    literal(now_dt),
                ).where(
                    and_(House.is_active.is_(True), ~has_sub)
                )
                result = await conn.execute(
                    insert(HouseSubscription).from_select(grant_cols, grant_src)
                )
                granted = result.rowcount
                report["granted_houses"] = (
                    granted if isinstance(granted, int) and granted >= 0
                    else len(missing_houses)
                )

                names = ", ".join(
                    f"{hid}:{name}" for hid, name in missing_houses[:20]
                )
                more = "" if len(missing_houses) <= 20 else f" (+{len(missing_houses) - 20} more)"
                logger.warning(
                    "Billing rollout: %s/%s house(s) had no plan and were granted '%s' "
                    "for 10 years so they stay online — assign real plans: %s%s",
                    report["granted_houses"], len(missing_houses), slug, names, more,
                )
            return report

    except Exception as exc:
        if settings.IS_PRODUCTION:
            # Fail the boot: serving a half-migrated fleet while fail-closed is
            # on would lock tenants out. Aborting keeps the previous version live.
            message = f"billing fail-closed rollout failed: {exc}"
            STARTUP_FATAL_ERRORS.append(message)
            logger.critical("FATAL: %s", message, exc_info=True)
        else:
            logger.warning(f"Migration warning (billing fail-closed rollout): {exc}")
        return report


async def init_db():
    try:
        # Files staged from an employee modal that was never saved are useless
        # after a restart - purge them before serving traffic.
        from app.services.employee_documents import cleanup_stale_staging_files, ensure_storage_dirs

        ensure_storage_dirs()
        cleanup_stale_staging_files()

        await _drop_legacy_ga_section_config_table()
        await _migrate_supervisor_member_rename()
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        await _migrate_seed_rule_contexts()
        await _migrate_rule_apply_to()
        await _migrate_rule_column_key()
        await _migrate_rule_included_employee_user_id_fk()
        await _migrate_rule_included_employee_to_emp_id()
        await _migrate_employee_sr_no()
        await _migrate_employee_name()
        await _migrate_employee_photo_url()
        await _migrate_supervisor_rso_pivot()
        await _migrate_retailer_employee_link()
        await _migrate_activation_employee_id()
        await _migrate_supervisor_team_link()
        await _migrate_retailer_filter_tag_id()
        await _migrate_retailer_markings()
        await _migrate_retailer_markings_hard_delete()
        await _migrate_retailer_marking_auto_source()
        await _migrate_retailer_marking_assignment_unique()
        await _migrate_house_live_sync_enabled()
        await _migrate_house_show_pull_button()
        await _migrate_house_billing_deactivation()
        await _migrate_app_settings_daily_sync()
        await _migrate_app_settings_favicon()
        await _migrate_app_settings_sim_serial_length()
        await _migrate_app_settings_maintenance()
        await _migrate_live_activation_date_type()
        await _migrate_bp_target_remove_soft_delete()
        await _migrate_lifting_soft_delete()
        await _migrate_lifting_stock_added()
        await _migrate_lifting_deposit_slip()
        await _migrate_lifting_pull_fields()
        await _migrate_indexes()
        await _migrate_location_telemetry_columns()
        await _migrate_whatsapp_schedule_columns()
        await _migrate_whatsapp_schedule_report_type()
        await _migrate_whatsapp_schedule_delivery_columns()
        await _migrate_whatsapp_schedule_time_window()
        await _migrate_whatsapp_schedule_send_as()
        await _migrate_whatsapp_schedule_orientation()
        await _migrate_ga_report_events_config()
        await _migrate_house_whatsapp_columns()
        await _migrate_telegram_columns()
        await _migrate_subscription_billing()
        await _migrate_subscription_package_live_uniqueness()
        await _migrate_billing_tables_extra()
        await _migrate_remove_payment_gateway_artifacts()
        await _migrate_billing_fail_closed()
        await _migrate_bts_own_plan_module()
        await _migrate_commission_own_plan_module()
        await _sync_retailer_markings_on_startup()
    except Exception as e:
        error_msg = str(e).lower()
        if "already exists" in error_msg:
            logger.warning(f"Some DB objects already exist (normal on restart). Dropping conflicting constraint and retrying...")
            await _drop_conflicting_constraints()
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
        else:
            logger.warning(f"Table sync error (non-critical): {e}")

async def _drop_conflicting_constraints():
    try:
        async with engine.begin() as conn:
            result = await conn.execute(text(
                "SELECT to_regclass('public.dms_reports') IS NOT NULL AS exists"
            ))
            dms_reports_exists = result.scalar()
            result2 = await conn.execute(text(
                "SELECT to_regclass('public.itopup_details') IS NOT NULL AS exists"
            ))
            itopup_details_exists = result2.scalar()

            if dms_reports_exists and not itopup_details_exists:
                await conn.execute(text("ALTER TABLE dms_reports RENAME TO itopup_details"))
                await conn.execute(text("ALTER INDEX dms_reports_pkey RENAME TO itopup_details_pkey"))
                await conn.execute(text("ALTER INDEX ix_dms_reports_report_date RENAME TO ix_itopup_details_report_date"))
                await conn.execute(text("ALTER INDEX ix_dms_reports_report_type RENAME TO ix_itopup_details_report_type"))
                await conn.execute(text("ALTER INDEX ix_dms_reports_retailer_id RENAME TO ix_itopup_details_retailer_id"))
                logger.info("Renamed dms_reports -> itopup_details (data preserved).")
            elif dms_reports_exists and itopup_details_exists:
                await conn.execute(text("ALTER TABLE dms_reports DROP CONSTRAINT IF EXISTS uix_house_retailer_type_date"))
                await conn.execute(text("DROP TABLE IF EXISTS dms_reports CASCADE"))
                logger.info("Dropped old dms_reports table (itopup_details already exists).")
    except Exception:
        await _rename_via_sync()

async def _rename_via_sync():
    try:
        from sqlalchemy import create_engine
        from config.settings import settings
        sync_engine = create_engine(settings.SYNC_DATABASE_URL)
        with sync_engine.begin() as conn:
            result = conn.execute(text(
                "SELECT to_regclass('public.dms_reports') IS NOT NULL"
            )).scalar()
            result2 = conn.execute(text(
                "SELECT to_regclass('public.itopup_details') IS NOT NULL"
            )).scalar()
            if result and not result2:
                conn.execute(text("ALTER TABLE dms_reports RENAME TO itopup_details"))
                conn.execute(text("ALTER INDEX dms_reports_pkey RENAME TO itopup_details_pkey"))
                conn.execute(text("ALTER INDEX ix_dms_reports_report_date RENAME TO ix_itopup_details_report_date"))
                conn.execute(text("ALTER INDEX ix_dms_reports_report_type RENAME TO ix_itopup_details_report_type"))
                conn.execute(text("ALTER INDEX ix_dms_reports_retailer_id RENAME TO ix_itopup_details_retailer_id"))
                logger.info("Renamed dms_reports -> itopup_details via sync (data preserved).")
            elif result and result2:
                conn.execute(text("ALTER TABLE dms_reports DROP CONSTRAINT IF EXISTS uix_house_retailer_type_date"))
                conn.execute(text("DROP TABLE IF EXISTS dms_reports CASCADE"))
                logger.info("Dropped old dms_reports via sync.")
    except Exception as cleanup_err:
        logger.warning(f"Table rename/cleanup error: {cleanup_err}")