"""Report Builder Registry

Central registry mapping report_type strings to their image builder functions.
Each builder takes (db: AsyncSession, house_id: int) and returns either a single
PNG (``bytes``) or, for paginated reports (e.g. ga_live, recharge, active_lso,
active_sso), a list of A4 page PNGs (``list[bytes]``).

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

# Builders that also accept a ``scale`` keyword, so a lightweight on-screen
# preview can be rendered at a reduced resolution while scheduled/direct sends
# keep the full-resolution image. Report types missing here always render at
# their builder's default resolution.
SCALE_AWARE_BUILDERS: dict[str, callable] = {}

# Builders for report types that need more than the house context (e.g. one
# RSO's list). Signature:
#   async (db, house_id, *, report_params: dict, scale: int | None = None)
# ``report_params`` carries the per-report context persisted on the schedule
# (e.g. {"employee_id": 42}); ``scale`` mirrors SCALE_AWARE_BUILDERS.
FILTERED_BUILDERS: dict[str, callable] = {}

# Builders that also accept an ``orientation`` keyword ("portrait" | "landscape"),
# letting the user pick a phone-friendly tall layout or a wider A4-landscape
# layout with larger table fonts. Report types missing here ignore the requested
# orientation and always render in their builder's default layout.
ORIENTATION_AWARE_BUILDERS: dict[str, callable] = {}


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
        "activation": "Activation Report",
        "recharge": "Recharge Report",
        "recharge_ev_secondary": "EV Secondary Report",
        "active_sso_inactive_retailers": "Inactive Retailers (Active SSO)",
    }
    return titles.get(report_type, report_type.replace("_", " ").title())


# --- Import builders to register them ---
# These imports must happen after REPORT_BUILDERS is defined
def _register_all():
    from app.services.ga_live_whatsapp_image import build_ga_live_report_image
    from app.services.active_lso_whatsapp_image import build_active_lso_report_image
    from app.services.active_sso_whatsapp_image import build_active_sso_report_image
    from app.services.activation_whatsapp_image import build_activation_report_image
    from app.services.recharge_whatsapp_image import (
        build_recharge_ev_report_image,
        build_recharge_report_image,
    )

    REPORT_BUILDERS["ga_live"] = build_ga_live_report_image
    REPORT_BUILDERS["active_lso"] = build_active_lso_report_image
    REPORT_BUILDERS["active_sso"] = build_active_sso_report_image
    REPORT_BUILDERS["activation"] = build_activation_report_image
    REPORT_BUILDERS["recharge"] = build_recharge_report_image
    REPORT_BUILDERS["recharge_ev_secondary"] = build_recharge_ev_report_image

    SCALE_AWARE_BUILDERS["ga_live"] = build_ga_live_report_image
    SCALE_AWARE_BUILDERS["active_lso"] = build_active_lso_report_image
    SCALE_AWARE_BUILDERS["active_sso"] = build_active_sso_report_image
    SCALE_AWARE_BUILDERS["activation"] = build_activation_report_image
    SCALE_AWARE_BUILDERS["recharge"] = build_recharge_report_image
    SCALE_AWARE_BUILDERS["recharge_ev_secondary"] = build_recharge_ev_report_image

    ORIENTATION_AWARE_BUILDERS["activation"] = build_activation_report_image

    from app.services.active_sso_retailers_whatsapp_image import (
        build_active_sso_inactive_retailers_image,
    )

    REPORT_BUILDERS["active_sso_inactive_retailers"] = build_active_sso_inactive_retailers_image
    FILTERED_BUILDERS["active_sso_inactive_retailers"] = build_active_sso_inactive_retailers_image

    logger.info(f"Report builders registered: {list(REPORT_BUILDERS.keys())}")


# Call on module load
_register_all()
