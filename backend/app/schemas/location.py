"""Pydantic schemas for the live-location ingest + read APIs."""

from datetime import datetime
from typing import Optional

from pydantic import AliasChoices, BaseModel, ConfigDict, Field


class LocationUpdateIn(BaseModel):
    """Payload sent by the employee's mobile automation macro.

    Accepts a few common aliases so the endpoint stays compatible with
    MacroDroid variable names as well as plain lat/long.
    """

    model_config = ConfigDict(populate_by_name=True, extra="ignore", coerce_numbers_to_str=True)

    employee_id: str = Field(
        ...,
        min_length=1,
        max_length=120,
        validation_alias=AliasChoices(
            "employee_id", "employeeId", "employee", "username", "code", "dms_code"
        ),
    )
    latitude: float = Field(
        ...,
        ge=-90,
        le=90,
        validation_alias=AliasChoices("latitude", "lat"),
    )
    longitude: float = Field(
        ...,
        ge=-180,
        le=180,
        validation_alias=AliasChoices("longitude", "long", "lng", "lon"),
    )
    current_battery_percent: Optional[int] = Field(
        default=None,
        ge=0,
        le=100,
        validation_alias=AliasChoices(
            "current_battery_percent", "battery", "battery_percent", "battery_level"
        ),
    )
    is_charging: Optional[bool] = Field(
        default=None,
        validation_alias=AliasChoices("is_charging", "charging"),
    )
    accuracy: Optional[float] = Field(default=None, ge=0)
    speed: Optional[float] = Field(default=None, ge=0)
    provider: Optional[str] = Field(default=None, max_length=50)
    device_name: Optional[str] = Field(
        default=None,
        max_length=150,
        validation_alias=AliasChoices("device_name", "device"),
    )
    recorded_at: Optional[datetime] = None
