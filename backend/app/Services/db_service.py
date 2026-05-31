import logging
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy import text
from config.settings import DATABASE_URL
from app.Models.base import Base
import app.Models.user
import app.Models.house
import app.Models.role
import app.Models.live_activation
import app.Models.retailer
import app.Models.employee
import app.Models.bts
import app.Models.ga_filter
import app.Models.mela
import app.Models.activation
import app.Models.subscription
import app.Models.itopup_detail
import app.Models.scratch_card_issue
import app.Models.sim_issue
import app.Models.sync_history
import app.Models.house_target
import app.Models.supervisor_target
import app.Models.rso_target
import app.Models.product_exclusion

logger = logging.getLogger(__name__)

engine = create_async_engine(DATABASE_URL, echo=False)
async_session = async_sessionmaker(engine, expire_on_commit=False)

async def init_db():
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        from app.Models.product_exclusion import ExcludedProductCode
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