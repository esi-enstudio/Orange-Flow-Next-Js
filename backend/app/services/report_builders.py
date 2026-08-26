"""Report Builder Registry

Central registry mapping report_type strings to their image builder functions.
Each builder takes (db: AsyncSession, house_id: int) and returns bytes (PNG image).

To add a new report type:
1. Create a builder function: async def build_xxx_report_image(db, house_id) -> bytes
2. Register it: REPORT_BUILDERS["xxx"] = build_xxx_report_image
3. Use the frontend component: <WhatsAppReportDeliveryModal reportType="xxx" />
"""
import logging
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# Type alias for builder functions
# async (AsyncSession, int) -> bytes
REPORT_BUILDERS: dict[str, callable] = {}


def register_builder(report_type: str):
    """Decorator to register a report builder function."""
    def decorator(func):
        REPORT_BUILDERS[report_type] = func
        return func
    return decorator


def get_report_builder(report_type: str):
    """Get the builder function for a report type. Raises ValueError if not found."""
    builder = REPORT_BUILDERS.get(report_type)
    if not builder:
        raise ValueError(f"Unknown report type: {report_type}. Available: {list(REPORT_BUILDERS.keys())}")
    return builder


def get_report_title(report_type: str) -> str:
    """Get the human-readable title for a report type."""
    titles = {
        "ga_live": "GA Live Report",
        "active_lso": "Active LSO Report",
        "active_sso": "Active SSO Report",
    }
    return titles.get(report_type, report_type.replace("_", " ").title())


# --- Import builders to register them ---
# These imports must happen after REPORT_BUILDERS is defined
def _register_all():
    from app.services.ga_live_whatsapp_image import build_ga_live_report_image
    from app.services.active_lso_whatsapp_image import build_active_lso_report_image
    from app.services.active_sso_whatsapp_image import build_active_sso_report_image

    REPORT_BUILDERS["ga_live"] = build_ga_live_report_image
    REPORT_BUILDERS["active_lso"] = build_active_lso_report_image
    REPORT_BUILDERS["active_sso"] = build_active_sso_report_image

    logger.info(f"Report builders registered: {list(REPORT_BUILDERS.keys())}")


# Call on module load
_register_all()
