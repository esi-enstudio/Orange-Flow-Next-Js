"""Request schemas for the report-builder API."""

from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ReportTargetConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: Literal[
        "house", "rso", "bp", "supervisor", "retailer_custom", "custom", "none"
    ] = "none"
    value: float | None = None
    percent: float | None = None
    proration: bool = False


class ReportFilterConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    retailer_ids: list[int] = Field(default_factory=list)
    employee_ids: list[int] = Field(default_factory=list)
    route_codes: list[str] = Field(default_factory=list)
    supervisor_ids: list[int] = Field(default_factory=list)


class ReportSortConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: Literal[
        "key", "label", "achievement", "target", "adjusted_target",
        "percentage", "remaining", "status",
    ] = "achievement"
    order: Literal["asc", "desc"] = "desc"


class ReportQueryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    metric: str
    date_from: date
    date_to: date
    group_by: list[str]
    filters: ReportFilterConfig = Field(default_factory=ReportFilterConfig)
    target: ReportTargetConfig = Field(default_factory=ReportTargetConfig)
    sort: ReportSortConfig = Field(default_factory=ReportSortConfig)
    page: int = Field(default=1, ge=1)
    per_page: int = Field(default=50, ge=1, le=200)
    house_id: int | None = None


class ReportExportRequest(ReportQueryRequest):
    pass
