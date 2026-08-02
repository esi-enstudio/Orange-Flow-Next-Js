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
import app.models.employee
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
import app.models.bp_target
import app.models.activity_log
import app.models.product_exclusion
import app.models.app_setting
import app.models.scratch_card_serial
import app.models.lifting
import app.models.order_collection
import app.models.bp_retailer_code
import app.models.retailer_visit
import app.models.zoom_in
import app.models.commission
import app.models.ga_section_config
import app.models.product
import app.models.todo
import app.models.cv
import app.models.sales

logger = logging.getLogger(__name__)

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

async def _migrate_ga_section_config_employee_ids():
    try:
        async with engine.begin() as conn:
            result = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name='ga_section_configs' AND column_name='selected_employee_ids'"
            ))
            if result.scalar():
                return
            logger.info("Migrating ga_section_configs: adding selected_employee_ids column...")
            await conn.execute(text(
                "ALTER TABLE ga_section_configs ADD COLUMN selected_employee_ids JSON"
            ))
            logger.info("Migration complete: ga_section_configs.selected_employee_ids")
    except Exception as e:
        logger.warning(f"Migration warning (ga_section_configs.selected_employee_ids): {e}")

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

async def _migrate_retailer_employee_link():
    """Fix retailers whose employee_id was auto-linked via itop_number but whose
    retailer_code is actually an employee's assisted_retailer_code.

    BP/CC assisted codes carry the RSO's iTopUp SR number, so the legacy import
    logic wrongly assigned them to the RSO. The correct owner is the employee
    whose assisted_retailer_code equals the retailer code.
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

async def init_db():
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        await _migrate_employee_sr_no()
        await _migrate_retailer_employee_link()
        await _migrate_retailer_filter_tag_id()
        await _migrate_app_settings_daily_sync()
        await _migrate_live_activation_date_type()
        await _migrate_ga_section_config_employee_ids()
        await _migrate_bp_target_remove_soft_delete()
        await _migrate_lifting_soft_delete()
        await _migrate_indexes()
        from app.models.product_exclusion import ExcludedProductCode
        from sqlalchemy import select, func
        async with async_session() as session:
            count = (await session.execute(select(func.count()).select_from(ExcludedProductCode))).scalar()
            if count == 0:
                defaults = ["SIMSWAP", "EV-SWAP", "ESIMSWAP"]
                for code in defaults:
                    session.add(ExcludedProductCode(product_code=code))
                await session.commit()
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