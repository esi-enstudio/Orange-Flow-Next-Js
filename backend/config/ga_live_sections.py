"""
GA Live Report — Section-wise Filter Configuration.

প্রতিটি সেকশনের জন্য কোন ফিল্টার লাগবে তা এখানে define করা আছে।
নতুন সেকশন বা নতুন ফিল্টার যোগ করলে শুধু এখানে এন্ট্রি যোগ করলেই হবে।
"""

from typing import Optional


class SectionConfig:
    """একটি সেকশনের ফিল্টার কনফিগারেশন"""

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
        self.exclude_products = exclude_products     # ExcludedProductCode টেবিল ব্যবহার করবে?
        self.exclude_retailer_tags = exclude_retailer_tags or []  # কোন ট্যাগের retailer বাদ দেবে?
        self.employee_role = employee_role           # শুধু কোন role দেখাবে? (None = সব)
        self.group_by = group_by                     # GROUP BY clause (যদি লাগে)


# ─── Master section definitions ───
# নতুন সেকশন বা নতুন ফিল্টার যোগ করতে শুধু নিচের list টি edit করুন।

GA_LIVE_SECTIONS = {
    "executive_summary": SectionConfig(
        key="executive_summary",
        label="Executive Summary",
        exclude_products=True,
        exclude_retailer_tags=["DRC"],
        employee_role=None,  # সব employee type
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
