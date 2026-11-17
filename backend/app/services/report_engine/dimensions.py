"""Dimension registry for the report engine.

A dimension decides how aggregated rows are grouped and labelled. Attribution
never re-implements the retailer<->employee rules: every employee dimension is
read from `retailers.employee_id`, which the retailer import plus the startup
self-healing migrations keep correct (docs/agents/domain-rules.md).
"""

from dataclasses import dataclass

from app.services.report_engine.metrics import METRICS


@dataclass(frozen=True)
class DimensionDefinition:
    key: str
    label_en: str
    label_bn: str
    null_label_en: str
    null_label_bn: str
    requires_retailer: bool = True


DIMENSIONS: dict[str, DimensionDefinition] = {
    "rso": DimensionDefinition(
        key="rso",
        label_en="RSO",
        label_bn="আরএসও",
        null_label_en="Unassigned",
        null_label_bn="অনির্ধারিত",
    ),
    "bp": DimensionDefinition(
        key="bp",
        label_en="BP",
        label_bn="বিপি",
        null_label_en="No BP",
        null_label_bn="বিপি নেই",
    ),
    "supervisor": DimensionDefinition(
        key="supervisor",
        label_en="Supervisor",
        label_bn="সুপারভাইজার",
        null_label_en="No supervisor",
        null_label_bn="সুপারভাইজার নেই",
    ),
    "retailer": DimensionDefinition(
        key="retailer",
        label_en="Retailer",
        label_bn="রিটেইলার",
        null_label_en="Unassigned",
        null_label_bn="অনির্ধারিত",
    ),
    "route": DimensionDefinition(
        key="route",
        label_en="Route",
        label_bn="রুট",
        null_label_en="No route",
        null_label_bn="রুট নেই",
    ),
    "date": DimensionDefinition(
        key="date",
        label_en="Date",
        label_bn="তারিখ",
        null_label_en="No date",
        null_label_bn="তারিখ নেই",
        requires_retailer=False,
    ),
}

DIMENSION_ORDER: tuple[str, ...] = ("rso", "bp", "supervisor", "retailer", "route", "date")

# source -> dimensions that may be combined with it (design spec §4)
SOURCE_DIMENSIONS: dict[str, frozenset[str]] = {
    "house": frozenset({"rso", "bp", "supervisor", "retailer", "route", "date"}),
    "rso": frozenset({"rso", "retailer", "route", "date"}),
    "bp": frozenset({"bp", "retailer", "date"}),
    "supervisor": frozenset({"supervisor", "retailer", "date"}),
    "retailer_custom": frozenset({"retailer", "date"}),
    "custom": frozenset({"rso", "bp", "supervisor", "retailer", "route", "date"}),
    "none": frozenset({"rso", "bp", "supervisor", "retailer", "route", "date"}),
}

TARGET_SOURCES: tuple[str, ...] = ("house", "rso", "bp", "supervisor", "retailer_custom", "custom", "none")


def get_dimension(key: str) -> DimensionDefinition | None:
    return DIMENSIONS.get(key)


def valid_group_by(source: str, dimension: str) -> bool:
    """Whether a target source may be combined with a grouping dimension."""
    return dimension in SOURCE_DIMENSIONS.get(source, frozenset())


def dimensions_for(metric_key: str, source: str) -> list[str]:
    """Dimensions valid for both the metric's available sources and the matrix."""
    metric = METRICS.get(metric_key)
    if metric is None:
        return []
    if source not in metric.supported_sources:
        return []
    allowed = SOURCE_DIMENSIONS.get(source, frozenset())
    return [d for d in DIMENSION_ORDER if d in allowed]
