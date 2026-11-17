"""Registry invariants: metrics, dimensions and the source x group_by matrix."""
from app.services.report_engine.dimensions import (
    DIMENSIONS,
    DIMENSION_ORDER,
    SOURCE_DIMENSIONS,
    TARGET_SOURCES,
    dimensions_for,
    get_dimension,
    valid_group_by,
)
from app.services.report_engine.metrics import METRICS, get_metric, supports_target_source


def test_metric_registry_is_complete_and_consistent():
    assert set(METRICS) == {"ga_activation", "c2c", "c2s", "balance", "sc_issue"}
    for key, metric in METRICS.items():
        assert metric.key == key
        assert metric.label_en and metric.label_bn
        assert metric.value_type in ("count", "amount")
        assert metric.sum_column is None or isinstance(metric.sum_column, str)
        assert hasattr(metric.model, metric.date_column)
        if metric.value_type == "count" and metric.key != "sc_issue":
            assert metric.sum_column is None


def test_metric_row_filters_select_the_report_type():
    assert METRICS["c2c"].row_filters == (("report_type", "C2C"),)
    assert METRICS["c2s"].row_filters == (("report_type", "C2S"),)
    assert METRICS["balance"].row_filters == (("report_type", "Balance"),)
    assert METRICS["ga_activation"].row_filters == ()


def test_metric_target_availability():
    # Only metrics with a house_targets column may use the house source.
    assert supports_target_source("ga_activation", "house") is True
    assert supports_target_source("c2c", "house") is True
    assert supports_target_source("sc_issue", "house") is True
    assert supports_target_source("c2s", "house") is False
    assert supports_target_source("balance", "house") is False
    # custom / none work for every metric.
    for key in METRICS:
        assert supports_target_source(key, "custom") is True
        assert supports_target_source(key, "none") is True


def test_house_target_columns():
    assert METRICS["ga_activation"].house_target_column == "total_ga_target"
    assert METRICS["c2c"].house_target_column == "ev_c2c_target"
    assert METRICS["sc_issue"].house_target_column == "sc_primary_target"
    assert METRICS["c2s"].house_target_column is None


def test_dimensions_are_registered():
    assert set(DIMENSIONS) == {"rso", "bp", "supervisor", "retailer", "route", "date"}
    assert get_dimension("date").requires_retailer is False
    for dim in DIMENSIONS.values():
        assert dim.label_en and dim.label_bn and dim.null_label_en and dim.null_label_bn


def test_matrix_matches_the_spec():
    # house / custom / none combine with everything.
    for source in ("house", "custom", "none"):
        for dim in DIMENSION_ORDER:
            assert valid_group_by(source, dim) is True

    # Employee sources only roll up to their own dimension, retailer, and date.
    assert valid_group_by("rso", "rso") is True
    assert valid_group_by("rso", "retailer") is True
    assert valid_group_by("rso", "route") is True
    assert valid_group_by("rso", "date") is True
    assert valid_group_by("rso", "bp") is False
    assert valid_group_by("rso", "supervisor") is False

    assert valid_group_by("bp", "bp") is True
    assert valid_group_by("bp", "retailer") is True
    assert valid_group_by("bp", "date") is True
    assert valid_group_by("bp", "rso") is False
    assert valid_group_by("bp", "route") is False

    assert valid_group_by("supervisor", "supervisor") is True
    assert valid_group_by("supervisor", "retailer") is True
    assert valid_group_by("supervisor", "date") is True
    assert valid_group_by("supervisor", "rso") is False

    assert valid_group_by("retailer_custom", "retailer") is True
    assert valid_group_by("retailer_custom", "date") is True
    assert valid_group_by("retailer_custom", "rso") is False


def test_every_source_has_a_matrix_row():
    assert set(SOURCE_DIMENSIONS) == set(TARGET_SOURCES)


def test_dimensions_for_filters_by_metric_target_availability():
    # c2s cannot use house, so the house-only pair disappears.
    assert dimensions_for("c2s", "house") == []
    assert dimensions_for("c2s", "custom") == list(DIMENSION_ORDER)
    assert dimensions_for("ga_activation", "house") == list(DIMENSION_ORDER)
    assert dimensions_for("ga_activation", "rso") == ["rso", "retailer", "route", "date"]
    assert dimensions_for("ga_activation", "nope") == []


def test_unknown_metric_and_dimension():
    assert get_metric("nope") is None
    assert get_dimension("nope") is None
    assert supports_target_source("nope", "house") is False
