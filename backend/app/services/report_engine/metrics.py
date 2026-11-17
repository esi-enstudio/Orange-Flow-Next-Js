"""Metric registry for the report engine.

A metric is a (table, date column, value expression, optional row filter) tuple.
Adding a metric here makes it available to every dimension and to the frontend
`/options` payload — no other file needs to change.

`target_columns` maps a target *source* to the column that carries its monthly
value. Sources missing from the map are not offered for that metric and are
rejected with `TARGET_SOURCE_UNAVAILABLE_FOR_METRIC` (see target source
availability in the design spec §2).
"""
from dataclasses import dataclass
from typing import Mapping

from app.models.activation import Activation
from app.models.itopup_detail import ITopUpDetail
from app.models.scratch_card_issue import ScratchCardIssue


@dataclass(frozen=True)
class MetricDefinition:
    key: str
    label_en: str
    label_bn: str
    model: type
    date_column: str
    value_type: str  # "count" | "amount"
    sum_column: str | None  # None => COUNT(*)
    row_filters: tuple[tuple[str, str], ...] = ()
    target_columns: Mapping[str, str] = None  # type: ignore[assignment]
    # Target sources available for this metric (any phase). Sources that exist
    # but are not yet implemented (rso/bp/supervisor/retailer_custom in phase 1)
    # raise TARGET_SOURCE_NOT_AVAILABLE from the engine.
    supported_sources: tuple[str, ...] = ("custom", "none")

    def __post_init__(self) -> None:
        if self.value_type not in ("count", "amount"):
            raise ValueError(f"Invalid value_type for metric {self.key}: {self.value_type}")
        if self.target_columns is None:
            object.__setattr__(self, "target_columns", {})
        # `house` is only supported when a monthly target column exists.
        if self.house_target_column is not None and "house" not in self.supported_sources:
            object.__setattr__(
                self, "supported_sources", (*self.supported_sources, "house")
            )

    @property
    def house_target_column(self) -> str | None:
        return self.target_columns.get("house")


METRICS: dict[str, MetricDefinition] = {
    "ga_activation": MetricDefinition(
        key="ga_activation",
        label_en="GA Activation",
        label_bn="জিএ অ্যাক্টিভেশন",
        model=Activation,
        date_column="activation_date",
        value_type="count",
        sum_column=None,
        target_columns={"house": "total_ga_target"},
        supported_sources=("custom", "none", "house", "rso", "bp", "supervisor"),
    ),
    "c2c": MetricDefinition(
        key="c2c",
        label_en="C2C",
        label_bn="সিটুসি",
        model=ITopUpDetail,
        date_column="report_date",
        value_type="amount",
        sum_column="daily_value",
        row_filters=(("report_type", "C2C"),),
        target_columns={"house": "ev_c2c_target"},
        supported_sources=("custom", "none", "house", "rso", "bp", "supervisor"),
    ),
    "c2s": MetricDefinition(
        key="c2s",
        label_en="C2S",
        label_bn="সিটুএস",
        model=ITopUpDetail,
        date_column="report_date",
        value_type="amount",
        sum_column="daily_value",
        row_filters=(("report_type", "C2S"),),
        # No C2S target column exists in any target table (spec §2).
        target_columns={},
        supported_sources=("custom", "none"),
    ),
    "balance": MetricDefinition(
        key="balance",
        label_en="Balance",
        label_bn="ব্যালেন্স",
        model=ITopUpDetail,
        date_column="report_date",
        value_type="amount",
        sum_column="daily_value",
        row_filters=(("report_type", "Balance"),),
        target_columns={},
        supported_sources=("custom", "none"),
    ),
    "sc_issue": MetricDefinition(
        key="sc_issue",
        label_en="Scratch Card Issue",
        label_bn="স্ক্র্যাচ কার্ড ইস্যু",
        model=ScratchCardIssue,
        date_column="issue_date",
        value_type="count",
        sum_column="quantity",
        target_columns={"house": "sc_primary_target"},
        supported_sources=("custom", "none", "house", "rso", "bp", "supervisor"),
    ),
}


def get_metric(key: str) -> MetricDefinition | None:
    return METRICS.get(key)


def supports_target_source(metric_key: str, source: str) -> bool:
    """True when the metric can be measured against this target source (any phase).

    `custom` and `none` are metric-independent. `house`/`rso`/`bp`/`supervisor`
    require a stored monthly target column for the metric.
    """
    metric = METRICS.get(metric_key)
    if metric is None:
        return False
    return source in metric.supported_sources
