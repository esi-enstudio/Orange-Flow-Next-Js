"""Pydantic schemas for the live-location ingest + read APIs."""

from datetime import datetime
from typing import Any, Dict, Optional

from pydantic import AliasChoices, BaseModel, ConfigDict, Field

# Sensitive / high-risk macro fields that must never be persisted. The automation
# macro also reports the device clipboard and its webhook URL; storing those would
# leak user content and internal URLs, so they are stripped from telemetry.
TELEMETRY_DROP_KEYS = frozenset(
    {
        "clipboard_text",
        "clipboard",
        "webhook_base_url",
        "webhook_url",
    }
)

# Hard caps so a misbehaving device cannot bloat the JSONB column.
TELEMETRY_MAX_KEYS = 60
TELEMETRY_KEY_MAX = 60
TELEMETRY_VALUE_MAX = 220


class LocationUpdateIn(BaseModel):
    """Payload sent by the employee's mobile automation macro (MacroDroid).

    The macro sends a rich payload (GPS fix, battery, charging wattage, power
    state, Wi-Fi, cell/network, storage and device details). Only the fields the
    map needs are declared here; every other field is accepted as ``extra`` and
    captured into :meth:`telemetry` so it can be stored/displayed without a
    schema change per device.

    Declared fields accept the macro's variable names as aliases so the same
    endpoint keeps working for both the old and the updated macro.
    """

    model_config = ConfigDict(populate_by_name=True, extra="allow", coerce_numbers_to_str=True)

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
        validation_alias=AliasChoices("latitude", "lat", "last_loc_lat", "last_location_lat"),
    )
    longitude: float = Field(
        ...,
        ge=-180,
        le=180,
        validation_alias=AliasChoices(
            "longitude", "long", "lng", "lon", "last_loc_long", "last_location_long"
        ),
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
    accuracy: Optional[float] = Field(
        default=None,
        ge=0,
        validation_alias=AliasChoices("accuracy", "last_loc_accuracy", "last_location_accuracy"),
    )
    speed: Optional[float] = Field(
        default=None,
        ge=0,
        validation_alias=AliasChoices("speed", "speed_mps"),
    )
    speed_kmh: Optional[float] = Field(
        default=None,
        ge=0,
        validation_alias=AliasChoices("speed_kmh", "last_loc_speed_kmh"),
    )
    altitude: Optional[float] = Field(
        default=None,
        validation_alias=AliasChoices("altitude", "alt", "last_location_altitude"),
    )
    provider: Optional[str] = Field(default=None, max_length=50)
    device_name: Optional[str] = Field(
        default=None,
        max_length=150,
        validation_alias=AliasChoices("device_name", "device"),
    )
    recorded_at: Optional[datetime] = None

    # ------------------------------------------------------------------ #
    # Telemetry helpers
    # ------------------------------------------------------------------ #
    def _raw_extra(self) -> Dict[str, Any]:
        return dict(self.model_extra or {})

    def telemetry(self) -> Dict[str, Any]:
        """Return a sanitized, size-capped dict of the macro's extra fields.

        Drops sensitive keys (clipboard, webhook URLs) and complex values, keeps
        scalars only, and folds the declared-but-column-less ``speed_kmh`` in.
        """
        data: Dict[str, Any] = {}
        for key, value in self._raw_extra().items():
            if key in TELEMETRY_DROP_KEYS or value is None:
                continue
            if isinstance(value, (dict, list, tuple, set)):
                continue
            key_s = str(key)[:TELEMETRY_KEY_MAX]
            if isinstance(value, bool):
                data[key_s] = value
            elif isinstance(value, (int, float)):
                data[key_s] = value
            else:
                text = str(value).strip()
                if not text:
                    continue
                data[key_s] = text[:TELEMETRY_VALUE_MAX]
            if len(data) >= TELEMETRY_MAX_KEYS:
                break

        if self.speed_kmh is not None:
            data["speed_kmh"] = self.speed_kmh
        return data

    def resolve_is_charging(self) -> Optional[bool]:
        """Derive charging state from the macro's charging wattage when unset."""
        if self.is_charging is not None:
            return self.is_charging
        raw = self._raw_extra().get("charging_wattage")
        try:
            if raw is None or str(raw).strip() == "":
                return None
            return float(raw) > 0
        except (TypeError, ValueError):
            return None
