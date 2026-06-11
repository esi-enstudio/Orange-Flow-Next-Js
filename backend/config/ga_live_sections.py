"""
GA Live Report — Section-wise Filter Configuration.

Which filters are needed for each section are defined here.
Add entry here when adding new section or filter.
"""

from typing import Optional


class SectionConfig:
    """Filter configuration for a section"""

    def __init__(
        self,
        key: str,
        label: str,
        exclude_products: bool = True,
        exclude_retailer_tags: Optional[list[str]] = None,
        employee_role: Optional[str] = None,
        group_by: Optional[str] = None,
    ):
        self.key = key
        self.label = label
        self.exclude_products = exclude_products     # Use ExcludedProductCode table?
        self.exclude_retailer_tags = exclude_retailer_tags or []  # Which tag's retailers to exclude?
        self.employee_role = employee_role           # Show only which role? (None = all)
        self.group_by = group_by                     # GROUP BY clause (if needed)


# ─── Master section definitions ───
# Edit the list below to add new sections or filters.

GA_LIVE_SECTIONS = {
    "executive_summary": SectionConfig(
        key="executive_summary",
        label="Executive Summary",
        exclude_products=True,
        exclude_retailer_tags=["DRC"],
        employee_role=None,  # All employee types
    ),
    "distribution": SectionConfig(
        key="distribution",
        label="Activation Distribution",
        exclude_products=True,
        exclude_retailer_tags=["DRC"],
        employee_role=None,
    ),
    "supervisors": SectionConfig(
        key="supervisors",
        label="Supervisor Performance",
        exclude_products=True,
        exclude_retailer_tags=["DRC"],
        employee_role="supervisor",
    ),
    "rsos": SectionConfig(
        key="rsos",
        label="RSO Performance",
        exclude_products=True,
        exclude_retailer_tags=["DRC"],
        employee_role="rso",
    ),
    "bps": SectionConfig(
        key="bps",
        label="BP Performance",
        exclude_products=True,
        exclude_retailer_tags=["DRC"],
        employee_role="bp",
    ),
    "ccs": SectionConfig(
        key="ccs",
        label="CC Performance",
        exclude_products=True,
        exclude_retailer_tags=["DRC"],
        employee_role="cc",
    ),
    "insights": SectionConfig(
        key="insights",
        label="Smart Insights",
        exclude_products=True,
        exclude_retailer_tags=["DRC"],
        employee_role=None,
    ),
    "trend": SectionConfig(
        key="trend",
        label="Activation Trend",
        exclude_products=True,
        exclude_retailer_tags=["DRC"],
        employee_role=None,
        group_by="activation_date",
    ),
}
