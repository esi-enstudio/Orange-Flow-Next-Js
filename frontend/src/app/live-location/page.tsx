"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import { AccessDenied } from "@/components/ui/AccessDenied";
import PageGuideModal from "@/components/PageGuideModal";
import { toast } from "react-hot-toast";
import {
  BatteryCharging,
  BatteryLow,
  BatteryMedium,
  Building2,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Crosshair,
  Download,
  ExternalLink,
  Loader2,
  MapPin,
  Navigation,
  RefreshCw,
  Route,
  Search,
  Signal,
  SignalZero,
  Users,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import type { LiveMapItem, LiveMapLabels } from "./_components/LiveLocationMap";

const LiveLocationMap = dynamic(() => import("./_components/LiveLocationMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[420px] w-full items-center justify-center rounded-2xl bg-gray-100 dark:bg-slate-800">
      <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
    </div>
  ),
});

const LIST_PER_PAGE = 20;

interface House {
  id: number;
  name: string;
  code: string;
  display_name: string;
}

interface LiveItem extends LiveMapItem {
  employee_code: string | null;
  dms_code: string | null;
  itop_number: string | null;
  house_id: number | null;
  house_name: string | null;
  house_code: string | null;
  accuracy: number | null;
  speed: number | null;
  altitude: number | null;
  provider: string | null;
  device_name: string | null;
  ping_count: number;
  last_seen_at: string | null;
  minutes_since: number | null;
  telemetry: Record<string, unknown> | null;
}

interface Summary {
  tracked: number;
  online: number;
  offline: number;
  low_battery: number;
  charging: number;
  active_total: number;
  online_minutes: number;
}

function relativeTime(minutes: number | null, t: (k: string, p?: Record<string, string | number>) => string): string {
  if (minutes == null) return "—";
  if (minutes <= 1) return t("live_location.time.just_now");
  if (minutes < 60) return t("live_location.time.minutes_ago", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("live_location.time.hours_ago", { count: hours });
  return t("live_location.time.days_ago", { count: Math.floor(hours / 24) });
}

function formatClock(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Grouped view of the device telemetry the macro sends (stored server-side in a
// JSONB column). Each field maps to a `live_location.telemetry.fields.*` key.
const TELEMETRY_GROUPS: { key: string; fields: string[] }[] = [
  {
    key: "battery",
    fields: ["power_on_off", "charging_wattage", "battery_current_now", "battery_current_average"],
  },
  {
    key: "network",
    fields: [
      "cell_connection_type",
      "wifi_ssid",
      "wifi_mac",
      "wifi_signal_strength",
      "cell_tower_signal_strength",
      "sim_one_operator_name",
      "sim_two_operator_name",
      "mobile_county_code",
      "mobile_network_code",
      "location_area_code",
      "cell_id",
      "current_ip",
      "current_ip_v6",
    ],
  },
  {
    key: "device",
    fields: [
      "device_manufacturer",
      "device_model",
      "android_version",
      "android_version_sdk_level",
      "macrodroid_version",
      "macrodroid_is_pro",
      "device_uptime",
      "screen_resulation",
      "ram_total",
      "ram_available",
    ],
  },
  {
    key: "storage",
    fields: [
      "internal_storage_external_total",
      "internal_storage_external_free",
      "external_storage_external_total",
      "external_storage_external_free",
    ],
  },
  {
    key: "volume",
    fields: ["vol_ring", "vol_notif", "vol_alarm", "vol_music", "vol_system", "vol_call", "vol_bt_voice"],
  },
  {
    key: "location",
    fields: ["last_location_latlong", "last_location_time", "last_loc_link"],
  },
  {
    key: "automation",
    fields: ["macro_name", "macro_id", "macro_category", "system_time", "speed_kmh", "create_guid"],
  },
];

const TELEMETRY_UNITS: Record<string, string> = {
  wifi_signal_strength: " dBm",
  cell_tower_signal_strength: " dBm",
  battery_current_now: " mA",
  battery_current_average: " mA",
  charging_wattage: " W",
  speed_kmh: " km/h",
};

function formatTelemetryValue(key: string, value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return `${value}${TELEMETRY_UNITS[key] ?? ""}`;
}

// A raw dBm reading means nothing to an operator, so signal fields are shown as
// a plain-language quality label (Great → Poor) with bars and the raw value.
type SignalLevel = "great" | "good" | "fair" | "low" | "poor";

const SIGNAL_FIELDS: Record<string, "wifi" | "cell"> = {
  wifi_signal_strength: "wifi",
  cell_tower_signal_strength: "cell",
};

// Minimum dBm required for each level (great, good, fair, low); weaker is "poor".
const SIGNAL_THRESHOLDS: Record<"wifi" | "cell", [number, number, number, number]> = {
  wifi: [-50, -60, -70, -80],
  cell: [-70, -80, -90, -100],
};

const SIGNAL_LEVEL_ORDER: SignalLevel[] = ["great", "good", "fair", "low", "poor"];

const SIGNAL_STYLES: Record<SignalLevel, { chip: string; text: string; bar: string }> = {
  great: { chip: "bg-emerald-50 dark:bg-emerald-500/10", text: "text-emerald-700 dark:text-emerald-400", bar: "bg-emerald-500" },
  good: { chip: "bg-green-50 dark:bg-green-500/10", text: "text-green-700 dark:text-green-400", bar: "bg-green-500" },
  fair: { chip: "bg-amber-50 dark:bg-amber-500/10", text: "text-amber-700 dark:text-amber-400", bar: "bg-amber-500" },
  low: { chip: "bg-orange-50 dark:bg-orange-500/10", text: "text-orange-700 dark:text-orange-400", bar: "bg-orange-500" },
  poor: { chip: "bg-red-50 dark:bg-red-500/10", text: "text-red-700 dark:text-red-400", bar: "bg-red-500" },
};

// Some devices report the magnitude without the sign — dBm is always negative.
function parseDbm(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(String(value).replace(/[^0-9.+-]/g, ""));
  if (!Number.isFinite(parsed) || parsed === 0) return null;
  return parsed > 0 ? -parsed : parsed;
}

function signalLevel(dbm: number, kind: "wifi" | "cell"): SignalLevel {
  const [great, good, fair, low] = SIGNAL_THRESHOLDS[kind];
  if (dbm >= great) return "great";
  if (dbm >= good) return "good";
  if (dbm >= fair) return "fair";
  if (dbm >= low) return "low";
  return "poor";
}

// Falls back to a prettified key for telemetry fields the device adds later and
// that have no translation yet (t() returns the path when a key is missing).
function telemetryFieldLabel(t: (k: string) => string, key: string): string {
  const path = `live_location.telemetry.fields.${key}`;
  const translated = t(path);
  if (translated !== path) return translated;
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function LiveLocationPage() {
  const { loading: authLoading, hasPermission, selectedHouse } = useAuth();
  const { t } = useLanguage();

  const canView = hasPermission("location.view");
  const canExport = hasPermission("location.export");
  const canViewHistory = hasPermission("location.history");

  const [houses, setHouses] = useState<House[]>([]);
  const [houseId, setHouseId] = useState<string>("");
  const [items, setItems] = useState<LiveItem[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loadError, setLoadError] = useState(false);

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [employeeType, setEmployeeType] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [batteryBelow, setBatteryBelow] = useState("");

  const [autoRefresh, setAutoRefresh] = useState(true);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [listPage, setListPage] = useState(1);
  const [fitSignal, setFitSignal] = useState(0);

  const [trailEmployeeId, setTrailEmployeeId] = useState<number | null>(null);
  const [trailPoints, setTrailPoints] = useState<[number, number][]>([]);
  const [trailLoading, setTrailLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Travel history (admin-only)
  const [travelOpen, setTravelOpen] = useState(false);
  const [travelList, setTravelList] = useState<any[]>([]);
  const [travelListLoading, setTravelListLoading] = useState(false);
  const [travelEmpId, setTravelEmpId] = useState<string>("");
  const [travelDate, setTravelDate] = useState<string>("");
  const [travelLoading, setTravelLoading] = useState(false);
  const [travelData, setTravelData] = useState<any>(null);
  const [showTelemetry, setShowTelemetry] = useState(true);

  const filtersKey = `${houseId}|${debouncedSearch}|${employeeType}|${statusFilter}|${batteryBelow}`;

  // Debounce the search box.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => clearTimeout(id);
  }, [search]);

  // Reset to first list page whenever filters change.
  useEffect(() => {
    setListPage(1);
  }, [filtersKey]);

  // Fetch accessible houses once.
  useEffect(() => {
    if (authLoading || !canView) return;
    apiClient
      .get("houses/accessible")
      .then((res) => {
        const list: House[] = res.data || [];
        setHouses(list);
        // Do not auto-select any house by default
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, canView]);

  const fetchLive = useCallback(
    async (silent = false) => {
      if (!canView) return;
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const headers: Record<string, string> = {};
        if (houseId) headers["X-House-ID"] = houseId;
        const params: Record<string, string | number> = { per_page: 1000 };
        if (debouncedSearch) params.search = debouncedSearch;
        if (employeeType) params.employee_type = employeeType;
        if (statusFilter) params.status = statusFilter;
        if (batteryBelow) params.battery_below = Number(batteryBelow);

        const res = await apiClient.get("v1/locations/live", { params, headers });
        setItems(res.data.data || []);
        setSummary(res.data.summary || null);
        setLastUpdated(new Date());
        setLoadError(false);
      } catch {
        if (!silent) setLoadError(true);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [canView, houseId, debouncedSearch, employeeType, statusFilter, batteryBelow]
  );

  useEffect(() => {
    if (authLoading || !canView) return;
    fetchLive(false);
  }, [authLoading, canView, fetchLive, filtersKey]);

  // Auto refresh every 30s.
  useEffect(() => {
    if (!autoRefresh || authLoading || !canView) return;
    const id = setInterval(() => fetchLive(true), 30000);
    return () => clearInterval(id);
  }, [autoRefresh, authLoading, canView, fetchLive]);

  const closeTrail = useCallback(() => {
    setTrailEmployeeId(null);
    setTrailPoints([]);
  }, []);

  const toggleTrail = useCallback(
    async (empId: number) => {
      if (trailEmployeeId === empId) {
        closeTrail();
        return;
      }
      setTrailEmployeeId(empId);
      setTrailLoading(true);
      try {
        const headers: Record<string, string> = {};
        if (houseId) headers["X-House-ID"] = houseId;
        const res = await apiClient.get(`v1/locations/history/${empId}`, {
          params: { limit: 300 },
          headers,
        });
        const points: [number, number][] = (res.data.data || [])
          .map((p: { latitude: number; longitude: number }) => [p.latitude, p.longitude] as [number, number])
          .reverse();
        setTrailPoints(points);
      } catch {
        toast.error(t("live_location.messages.load_error"));
        closeTrail();
      } finally {
        setTrailLoading(false);
      }
    },
    [trailEmployeeId, houseId, t, closeTrail]
  );

  const selectEmployee = useCallback((id: number) => {
    setSelectedId(id);
  }, []);

  const handleExport = useCallback(async () => {
    if (!canExport) return;
    setExporting(true);
    try {
      const headers: Record<string, string> = {};
      if (houseId) headers["X-House-ID"] = houseId;
      const params: Record<string, string | number> = {};
      if (debouncedSearch) params.search = debouncedSearch;
      if (employeeType) params.employee_type = employeeType;
      const res = await apiClient.get("v1/locations/export", {
        params,
        headers,
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.download = `live_locations_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success(t("live_location.export_success"));
    } catch {
      toast.error(t("live_location.export_error"));
    } finally {
      setExporting(false);
    }
  }, [canExport, houseId, debouncedSearch, employeeType, t]);

  // Travel history hooks
  useEffect(() => {
    if (!travelOpen || !canViewHistory) return;
    setTravelListLoading(true);
    const headers: Record<string, string> = {};
    if (houseId) headers["X-House-ID"] = houseId;
    apiClient
      .get("v1/locations/list", { headers })
      .then((res) => {
        setTravelList(res.data?.data || []);
      })
      .catch(() => toast.error(t("live_location.messages.load_error")))
      .finally(() => setTravelListLoading(false));
  }, [travelOpen, canViewHistory, houseId, t]);

  const fetchTravelHistory = useCallback(async () => {
    if (!travelEmpId || !canViewHistory) return;
    setTravelLoading(true);
    setTravelData(null);
    try {
      const headers: Record<string, string> = {};
      if (houseId) headers["X-House-ID"] = houseId;
      const params: Record<string, string> = {};
      if (travelDate) params.date = travelDate;
      const res = await apiClient.get(`v1/locations/movement/${travelEmpId}`, {
        params,
        headers,
      });
      setTravelData(res.data?.data || null);
    } catch {
      toast.error(t("live_location.messages.load_error"));
    } finally {
      setTravelLoading(false);
    }
  }, [travelEmpId, travelDate, canViewHistory, houseId]);

  const selected = useMemo(
    () => items.find((i) => i.employee_id === selectedId) || null,
    [items, selectedId]
  );

  // Telemetry keys the device sends that are not part of a named group yet —
  // shown under "Other" so no received field is ever hidden from the operator.
  const otherTelemetryKeys = useMemo(() => {
    const known = new Set(TELEMETRY_GROUPS.flatMap((g) => g.fields));
    return Object.keys(selected?.telemetry || {}).filter((k) => !known.has(k));
  }, [selected]);

  const mapItems: LiveMapItem[] = useMemo(
    () =>
      items
        .filter((i) => Number.isFinite(i.latitude) && Number.isFinite(i.longitude))
        .map((i) => ({
          employee_id: i.employee_id,
          employee_name: i.employee_name,
          employee_type: i.employee_type,
          dms_code: i.dms_code,
          latitude: i.latitude,
          longitude: i.longitude,
          battery_percent: i.battery_percent,
          battery_status: i.battery_status,
          is_online: i.is_online,
        })),
    [items]
  );

  const mapLabels: LiveMapLabels = {
    legend: t("live_location.map.legend"),
    online: t("live_location.map.legend_online"),
    offline: t("live_location.map.legend_offline"),
    low_battery: t("live_location.map.legend_low_battery"),
    fullscreen: t("live_location.map.fullscreen"),
    exit_fullscreen: t("live_location.map.exit_fullscreen"),
  };

  const totalPages = Math.max(1, Math.ceil(items.length / LIST_PER_PAGE));
  const pageItems = useMemo(
    () => items.slice((listPage - 1) * LIST_PER_PAGE, listPage * LIST_PER_PAGE),
    [items, listPage]
  );

  const typeLabel = (type?: string | null) => {
    const key = (type || "unknown").toLowerCase();
    const translated = t(`live_location.types.${key}`);
    return translated === `live_location.types.${key}` ? (type || t("live_location.types.unknown")) : translated;
  };

  const copyCoords = (lat: number, lng: number) => {
    navigator.clipboard?.writeText(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!authLoading && !canView) {
    return <AccessDenied />;
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            <span className="rounded-xl bg-emerald-50 p-2 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
              <MapPin className="h-5 w-5" />
            </span>
            {t("live_location.title")}
          </h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{t("live_location.subtitle")}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <PageGuideModal pageKey="live_location" />

          {houses.length > 1 && (
            <div className="relative">
              <Building2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <select
                value={houseId}
                onChange={(e) => setHouseId(e.target.value)}
                className="cursor-pointer appearance-none rounded-xl border border-gray-200 bg-white py-2 pl-9 pr-8 text-sm font-medium text-gray-900 shadow-sm outline-none transition-colors hover:bg-gray-50 focus:ring-2 focus:ring-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-gray-100 dark:hover:bg-slate-800"
              >
                <option value="">{t("live_location.all_houses")}</option>
                {houses.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.display_name || h.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={() => fetchLive(true)}
            disabled={refreshing}
            className="flex cursor-pointer items-center gap-2 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-60 dark:border-slate-800 dark:bg-slate-900 dark:text-gray-200 dark:hover:bg-slate-800"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">{t("live_location.refresh")}</span>
          </button>

          {canExport && (
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex cursor-pointer items-center gap-2 rounded-xl bg-primary-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 disabled:opacity-60"
            >
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              <span className="hidden sm:inline">{t("live_location.export")}</span>
            </button>
          )}
          {canViewHistory && (
            <button
              onClick={() => setTravelOpen(true)}
              className="flex cursor-pointer items-center gap-2 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 dark:border-slate-800 dark:bg-slate-900 dark:text-gray-200 dark:hover:bg-slate-800"
            >
              <Route className="h-4 w-4" />
              <span className="hidden sm:inline">{t("live_location.travel_history")}</span>
            </button>
          )}
        </div>
      </div>

      {/* Travel History Modal */}
      {travelOpen && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-slate-800">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {t("live_location.travel_history")}
              </h2>
              <button
                onClick={() => setTravelOpen(false)}
                className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-col gap-3 border-b border-gray-100 p-4 dark:border-slate-800 md:flex-row md:items-end md:justify-between">
              <div className="flex flex-1 flex-col gap-3 md:flex-row md:items-center">
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                    {t("live_location.table.employee")}
                  </label>
                  <select
                    value={travelEmpId}
                    onChange={(e) => setTravelEmpId(e.target.value)}
                    className="w-full cursor-pointer rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm outline-none focus:ring-2 focus:ring-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-gray-100"
                  >
                    <option value="">{t("live_location.filters.search_placeholder")}</option>
                    {travelList.map((e) => (
                      <option key={e.employee_id} value={e.employee_id}>
                        {e.employee_name || e.dms_code || `#${e.employee_id}`}
                        {e.dms_code ? ` (${e.dms_code})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">
                    {t("live_location.detail.coordinates")}
                  </label>
                  <input
                    type="date"
                    value={travelDate}
                    onChange={(e) => setTravelDate(e.target.value)}
                    className="cursor-pointer rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm outline-none focus:ring-2 focus:ring-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-gray-100"
                  />
                </div>
              </div>
              <button
                onClick={fetchTravelHistory}
                disabled={!travelEmpId || travelLoading}
                className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-700 disabled:opacity-60"
              >
                {travelLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Route className="h-4 w-4" />}
                {t("live_location.detail.view_history")}
              </button>
            </div>

            <div className="max-h-[calc(90vh-180px)] overflow-y-auto p-4">
              {!travelData ? (
                <div className="flex flex-col items-center justify-center py-12 text-center text-sm text-gray-400">
                  {t("live_location.history.empty")}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <MiniInfo label={t("live_location.table.employee")}>
                      {travelData.employee_name || travelData.dms_code || `#${travelData.employee_id}`}
                    </MiniInfo>
                    <MiniInfo label={t("live_location.table.type")}>{typeLabel(travelData.employee_type)}</MiniInfo>
                    <MiniInfo label={t("live_location.history.points")}>{travelData.summary?.point_count || 0}</MiniInfo>
                    <MiniInfo label={t("live_location.history.distance_km") || "Distance (km)"}>
                      {travelData.summary?.distance_km || 0}
                    </MiniInfo>
                  </div>
                  <div className="max-h-[400px] overflow-auto rounded-xl border border-gray-100 dark:border-slate-800">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-gray-50 dark:bg-slate-800/60">
                        <tr className="text-left text-[10px] uppercase tracking-wide text-gray-400">
                          <th className="px-3 py-2 font-semibold">Time</th>
                          <th className="px-3 py-2 font-semibold">Lat</th>
                          <th className="px-3 py-2 font-semibold">Lng</th>
                          <th className="px-3 py-2 font-semibold">Speed</th>
                          <th className="px-3 py-2 font-semibold">Battery</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(travelData.points || []).map((p: any, i: number) => (
                          <tr key={i} className="border-b border-gray-50 dark:border-slate-800/60">
                            <td className="px-3 py-1 font-mono">{p.time ? new Date(p.time).toLocaleString() : "-"}</td>
                            <td className="px-3 py-1 font-mono">{p.lat?.toFixed(5)}</td>
                            <td className="px-3 py-1 font-mono">{p.lng?.toFixed(5)}</td>
                            <td className="px-3 py-1">{p.speed_kmh ? `${Math.round(p.speed_kmh)} km/h` : (p.speed ? `${Math.round(p.speed*3.6)} km/h` : "-")}</td>
                            <td className="px-3 py-1">{p.battery_percent != null ? `${p.battery_percent}%` : "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={<Users className="h-5 w-5" />}
          tone="blue"
          label={t("live_location.stats.tracked")}
          value={summary?.tracked ?? 0}
          hint={t("live_location.stats.coverage", {
            tracked: summary?.tracked ?? 0,
            total: summary?.active_total ?? 0,
          })}
        />
        <StatCard
          icon={<Wifi className="h-5 w-5" />}
          tone="emerald"
          label={t("live_location.stats.online")}
          value={summary?.online ?? 0}
        />
        <StatCard
          icon={<WifiOff className="h-5 w-5" />}
          tone="slate"
          label={t("live_location.stats.offline")}
          value={summary?.offline ?? 0}
        />
        <StatCard
          icon={<BatteryLow className="h-5 w-5" />}
          tone="amber"
          label={t("live_location.stats.low_battery")}
          value={summary?.low_battery ?? 0}
        />
      </div>

      {/* Map + detail */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="relative isolate flex min-h-[520px] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 xl:col-span-2">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5 dark:border-slate-800">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
              <Navigation className="h-4 w-4 text-emerald-500" />
              {t("live_location.map.legend")}
              {lastUpdated && (
                <span className="text-[11px] font-normal text-gray-400">
                  · {t("live_location.updated_at", { time: lastUpdated.toLocaleTimeString() })}
                </span>
              )}
            </div>
            <button
              onClick={() => setFitSignal((s) => s + 1)}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-slate-800 dark:hover:text-gray-200"
            >
              <Crosshair className="h-3.5 w-3.5" />
              {t("live_location.map.fit_all")}
            </button>
          </div>
          <div className="min-h-0 w-full flex-1">
            <LiveLocationMap
              items={mapItems}
              selectedId={selectedId}
              onSelect={selectEmployee}
              trail={trailPoints}
              labels={mapLabels}
              fitSignal={fitSignal}
              emptyLabel={t("live_location.map.no_locations")}
            />
          </div>
        </div>

        {/* Detail panel */}
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">
              {t("live_location.detail.title")}
            </h2>
            {selected && (
              <button
                onClick={() => setSelectedId(null)}
                className="cursor-pointer rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {!selected ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <MapPin className="mb-3 h-9 w-9 text-gray-300 dark:text-slate-600" />
              <p className="max-w-[220px] text-sm text-gray-400">{t("live_location.detail.select_prompt")}</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base font-bold text-gray-900 dark:text-gray-100">
                    {selected.employee_name || selected.dms_code || `#${selected.employee_id}`}
                  </p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    {[selected.employee_code, selected.dms_code, selected.itop_number].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <StatusBadge online={selected.is_online} t={t} />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <MiniInfo label={t("live_location.detail.battery")}>
                  <BatteryChip item={selected} t={t} />
                </MiniInfo>
                <MiniInfo label={t("live_location.detail.last_seen")}>
                  {relativeTime(selected.minutes_since, t)}
                </MiniInfo>
                <MiniInfo label={t("live_location.table.type")}>{typeLabel(selected.employee_type)}</MiniInfo>
                <MiniInfo label={t("live_location.detail.pings")}>{selected.ping_count}</MiniInfo>
                <MiniInfo label={t("live_location.detail.accuracy")}>
                  {selected.accuracy != null ? `${Math.round(selected.accuracy)} m` : "—"}
                </MiniInfo>
                <MiniInfo label={t("live_location.detail.device")}>
                  {selected.device_name || selected.provider || "—"}
                </MiniInfo>
              </div>

              <div className="rounded-xl bg-gray-50 px-3 py-2 dark:bg-slate-800/60">
                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
                  {t("live_location.detail.coordinates")}
                </p>
                <p className="font-mono text-xs text-gray-700 dark:text-gray-200">
                  {selected.latitude.toFixed(5)}, {selected.longitude.toFixed(5)}
                </p>
                <p className="mt-0.5 text-[11px] text-gray-400">{formatClock(selected.last_seen_at)}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                <a
                  href={`https://www.google.com/maps?q=${selected.latitude},${selected.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-slate-700 dark:text-gray-300 dark:hover:bg-slate-800"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  {t("live_location.detail.open_in_maps")}
                </a>
                <button
                  onClick={() => copyCoords(selected.latitude, selected.longitude)}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-slate-700 dark:text-gray-300 dark:hover:bg-slate-800"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? t("live_location.detail.copied") : t("live_location.detail.copy_coords")}
                </button>
                <button
                  onClick={() => toggleTrail(selected.employee_id)}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-2.5 py-1.5 text-xs font-semibold text-primary-700 transition-colors hover:bg-primary-100 dark:border-primary-500/30 dark:bg-primary-500/10 dark:text-primary-300"
                >
                  {trailLoading && trailEmployeeId === selected.employee_id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Route className="h-3.5 w-3.5" />
                  )}
                  {trailEmployeeId === selected.employee_id
                    ? t("live_location.detail.hide_history")
                    : t("live_location.detail.view_history")}
                </button>
              </div>

              {Object.keys(selected.telemetry || {}).length > 0 && (
                <div className="rounded-xl border border-gray-200 dark:border-slate-800">
                  <div className="flex w-full items-center justify-between gap-2 px-3 py-2">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200">
                      <Signal className="h-3.5 w-3.5 text-primary-500" />
                      {t("live_location.telemetry.title")}
                    </span>
                  </div>
                  <div className="max-h-80 space-y-2 overflow-y-auto border-t border-gray-100 px-3 py-2.5 dark:border-slate-800">
                    {TELEMETRY_GROUPS.map((group) => {
                      const rows = group.fields.filter((f) => {
                        const v = selected.telemetry?.[f];
                        return v !== undefined && v !== null && `${v}` !== "";
                      });
                      if (rows.length === 0) return null;
                      return (
                        <div key={group.key} className="rounded-lg border border-gray-200 dark:border-slate-700">
                          <div className="border-b border-gray-100 px-2 py-1.5 dark:border-slate-700/60">
                            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                              {t(`live_location.telemetry.groups.${group.key}`)}
                            </p>
                          </div>
                          <div className="divide-y divide-gray-100 dark:divide-slate-800">
                            {rows.map((f) => (
                              <div key={f} className="flex items-start justify-between gap-3 px-2 py-1">
                                <span className="text-[11px] text-gray-500 dark:text-gray-400">
                                  {telemetryFieldLabel(t, f)}
                                </span>
                                <TelemetryValue field={f} value={selected.telemetry?.[f]} t={t} />
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    {otherTelemetryKeys.length > 0 && (
                      <div className="rounded-lg border border-gray-200 dark:border-slate-700">
                        <div className="border-b border-gray-100 px-2 py-1.5 dark:border-slate-700/60">
                          <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                            {t("live_location.telemetry.groups.other")}
                          </p>
                        </div>
                        <div className="divide-y divide-gray-100 dark:divide-slate-800">
                          {otherTelemetryKeys.map((f) => (
                            <div key={f} className="flex items-start justify-between gap-3 px-2 py-1">
                              <span className="text-[11px] text-gray-500 dark:text-gray-400">
                                {telemetryFieldLabel(t, f)}
                              </span>
                              <TelemetryValue field={f} value={selected.telemetry?.[f]} t={t} />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Filters + list */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-3 border-b border-gray-100 p-4 dark:border-slate-800 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-xs">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("live_location.filters.search_placeholder")}
              className="w-full rounded-xl border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 outline-none transition-colors focus:ring-2 focus:ring-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-gray-100"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect value={employeeType} onChange={setEmployeeType} label={t("live_location.filters.all_types")}>
              <option value="">{t("live_location.filters.all_types")}</option>
              {["rso", "bp", "supervisor", "manager", "bsp", "rbsp"].map((type) => (
                <option key={type} value={type}>
                  {typeLabel(type)}
                </option>
              ))}
            </FilterSelect>

            <FilterSelect value={statusFilter} onChange={setStatusFilter} label={t("live_location.filters.all_status")}>
              <option value="">{t("live_location.filters.all_status")}</option>
              <option value="online">{t("live_location.filters.online")}</option>
              <option value="offline">{t("live_location.filters.offline")}</option>
            </FilterSelect>

            <FilterSelect value={batteryBelow} onChange={setBatteryBelow} label={t("live_location.filters.battery_below")}>
              <option value="">{t("live_location.filters.battery_below")}</option>
              <option value="20">{t("live_location.filters.battery_below")}</option>
            </FilterSelect>

            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 dark:border-slate-800 dark:text-gray-300">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="h-4 w-4 cursor-pointer accent-primary-600"
              />
              <span className="whitespace-nowrap">{t("live_location.auto_refresh")}</span>
            </label>
          </div>
        </div>

        {/* Desktop table */}
        {loading ? (
          <TableSkeleton />
        ) : loadError ? (
          <EmptyState title={t("live_location.messages.load_error")} />
        ) : items.length === 0 ? (
          <EmptyState title={t("live_location.messages.no_data")} hint={t("live_location.messages.no_data_hint")} />
        ) : (
          <>
            <div className="hidden lg:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-[11px] uppercase tracking-wide text-gray-400 dark:border-slate-800">
                    <th className="px-4 py-2 font-semibold">{t("live_location.table.employee")}</th>
                    <th className="px-2 py-2 font-semibold">{t("live_location.table.type")}</th>
                    <th className="px-2 py-2 font-semibold">{t("live_location.table.status")}</th>
                    <th className="px-2 py-2 font-semibold">{t("live_location.table.battery")}</th>
                    <th className="px-2 py-2 font-semibold">{t("live_location.table.last_seen")}</th>
                    <th className="px-2 py-2 font-semibold">{t("live_location.table.location")}</th>
                    <th className="px-2 py-2 font-semibold">{t("live_location.table.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((item) => (
                    <tr
                      key={item.employee_id}
                      onClick={() => selectEmployee(item.employee_id)}
                      className={`cursor-pointer border-b border-gray-50 transition-colors hover:bg-gray-50/80 dark:border-slate-800/60 dark:hover:bg-slate-800/50 ${
                        selectedId === item.employee_id ? "bg-emerald-50/60 dark:bg-emerald-500/5" : ""
                      }`}
                    >
                      <td className="px-4 py-1">
                        <p className="font-medium text-gray-900 dark:text-gray-100">
                          {item.employee_name || item.dms_code || `#${item.employee_id}`}
                        </p>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">
                          {[item.dms_code, item.itop_number].filter(Boolean).join(" · ") || "—"}
                        </p>
                      </td>
                      <td className="px-2 py-1 text-gray-600 dark:text-gray-300">{typeLabel(item.employee_type)}</td>
                      <td className="px-2 py-1">
                        <StatusBadge online={item.is_online} t={t} />
                      </td>
                      <td className="px-2 py-1">
                        <BatteryChip item={item} t={t} />
                      </td>
                      <td className="px-2 py-1">
                        <p className="text-gray-700 dark:text-gray-200">{relativeTime(item.minutes_since, t)}</p>
                        <p className="text-[11px] text-gray-400">{formatClock(item.last_seen_at)}</p>
                      </td>
                      <td className="px-2 py-1 font-mono text-[11px] text-gray-500 dark:text-gray-400">
                        {item.latitude.toFixed(4)}, {item.longitude.toFixed(4)}
                      </td>
                      <td className="px-2 py-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleTrail(item.employee_id);
                          }}
                          className="flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-primary-600 transition-colors hover:bg-primary-50 dark:hover:bg-primary-500/10"
                        >
                          <Route className="h-3.5 w-3.5" />
                          {t("live_location.detail.view_history")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile accordion */}
            <div className="divide-y divide-gray-100 lg:hidden dark:divide-slate-800">
              {pageItems.map((item) => {
                const expanded = expandedId === item.employee_id;
                return (
                  <div key={item.employee_id}>
                    <button
                      onClick={() => setExpandedId(expanded ? null : item.employee_id)}
                      className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-gray-900 dark:text-gray-100">
                          {item.employee_name || item.dms_code || `#${item.employee_id}`}
                        </p>
                        <p className="truncate text-[11px] text-gray-500 dark:text-gray-400">
                          {[item.employee_code, item.dms_code, item.itop_number].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <StatusBadge online={item.is_online} t={t} />
                        {expanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                      </div>
                    </button>
                    {expanded && (
                      <div className="space-y-2 bg-gray-50/60 px-4 pb-4 pt-1 dark:bg-slate-800/40">
                        <div className="grid grid-cols-2 gap-2">
                          <MiniInfo label={t("live_location.table.type")}>{typeLabel(item.employee_type)}</MiniInfo>
                          <MiniInfo label={t("live_location.table.battery")}>
                            <BatteryChip item={item} t={t} />
                          </MiniInfo>
                          <MiniInfo label={t("live_location.table.last_seen")}>{relativeTime(item.minutes_since, t)}</MiniInfo>
                          <MiniInfo label={t("live_location.detail.accuracy")}>
                            {item.accuracy != null ? `${Math.round(item.accuracy)} m` : "—"}
                          </MiniInfo>
                          <MiniInfo label={t("live_location.table.location")}>
                            <span className="font-mono text-[11px]">
                              {item.latitude.toFixed(4)}, {item.longitude.toFixed(4)}
                            </span>
                          </MiniInfo>
                          <MiniInfo label={t("live_location.detail.pings")}>{item.ping_count}</MiniInfo>
                        </div>
                        <div className="flex flex-wrap gap-2 pt-1">
                          <button
                            onClick={() => selectEmployee(item.employee_id)}
                            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 dark:border-slate-700 dark:text-gray-300"
                          >
                            <MapPin className="h-3.5 w-3.5" />
                            {t("live_location.detail.show_on_map")}
                          </button>
                          <button
                            onClick={() => toggleTrail(item.employee_id)}
                            className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-2.5 py-1.5 text-xs font-semibold text-primary-700 dark:border-primary-500/30 dark:bg-primary-500/10 dark:text-primary-300"
                          >
                            <Route className="h-3.5 w-3.5" />
                            {trailEmployeeId === item.employee_id
                              ? t("live_location.detail.hide_history")
                              : t("live_location.detail.view_history")}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            {items.length > LIST_PER_PAGE && (
              <div className="flex items-center justify-between px-4 py-3">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {items.length} · {listPage}/{totalPages}
                </p>
                <div className="flex items-center gap-1">
                  <button
                    disabled={listPage <= 1}
                    onClick={() => setListPage((p) => Math.max(1, p - 1))}
                    className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-gray-300 dark:hover:bg-slate-800"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    disabled={listPage >= totalPages}
                    onClick={() => setListPage((p) => Math.min(totalPages, p + 1))}
                    className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-gray-300 dark:hover:bg-slate-800"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------- Sub-components ------------------------------ */

const TONES: Record<string, string> = {
  blue: "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400",
  emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400",
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300",
  amber: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400",
};

function StatCard({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint?: string;
  tone: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</p>
        <span className={`rounded-xl p-2 ${TONES[tone] || TONES.slate}`}>{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-gray-100">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-gray-400">{hint}</p>}
    </div>
  );
}

function StatusBadge({ online, t }: { online: boolean; t: (k: string) => string }) {
  return online ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
      <Signal className="h-3 w-3" />
      {t("live_location.status.online")}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500 dark:bg-slate-700/40 dark:text-slate-300">
      <SignalZero className="h-3 w-3" />
      {t("live_location.status.offline")}
    </span>
  );
}

function BatteryChip({ item, t }: { item: { battery_percent?: number | null; battery_status: string }; t: (k: string) => string }) {
  const pct = item.battery_percent;
  let icon = <BatteryMedium className="h-3.5 w-3.5" />;
  let cls = "text-gray-500 dark:text-gray-400";
  if (item.battery_status === "charging") {
    icon = <BatteryCharging className="h-3.5 w-3.5" />;
    cls = "text-blue-500";
  } else if (item.battery_status === "low") {
    icon = <BatteryLow className="h-3.5 w-3.5" />;
    cls = "text-amber-500";
  } else if (item.battery_status === "ok") {
    cls = "text-emerald-600 dark:text-emerald-400";
  }
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${cls}`}>
      {icon}
      {pct != null ? `${pct}%` : t("live_location.status.unknown")}
    </span>
  );
}

function SignalQuality({ dbm, kind, t }: { dbm: number; kind: "wifi" | "cell"; t: (k: string) => string }) {
  const level = signalLevel(dbm, kind);
  const style = SIGNAL_STYLES[level];
  const bars = Math.max(1, 4 - SIGNAL_LEVEL_ORDER.indexOf(level));
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 ${style.chip}`}
      title={`${Math.round(dbm)} dBm`}
    >
      <span className="flex items-end gap-[2px]" aria-hidden>
        {[1, 2, 3, 4].map((bar) => (
          <span
            key={bar}
            className={`w-[3px] rounded-sm ${bar <= bars ? style.bar : "bg-gray-300 dark:bg-slate-600"}`}
            style={{ height: `${3 + bar * 2}px` }}
          />
        ))}
      </span>
      <span className={`text-[11px] font-semibold ${style.text}`}>
        {t(`live_location.telemetry.signal.${level}`)}
      </span>
      <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{Math.round(dbm)} dBm</span>
    </span>
  );
}

// Signal readings get the quality chip; every other telemetry field stays plain.
function TelemetryValue({ field, value, t }: { field: string; value: unknown; t: (k: string) => string }) {
  const kind = SIGNAL_FIELDS[field];
  const dbm = kind ? parseDbm(value) : null;
  if (kind && dbm !== null) return <SignalQuality dbm={dbm} kind={kind} t={t} />;
  return (
    <span className="break-all text-right text-xs font-medium text-gray-800 dark:text-gray-100">
      {formatTelemetryValue(field, value)}
    </span>
  );
}

function MiniInfo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-gray-50 px-3 py-2 dark:bg-slate-800/60">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <div className="mt-0.5 text-sm font-medium text-gray-800 dark:text-gray-200">{children}</div>
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  label,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className="cursor-pointer rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm outline-none transition-colors hover:bg-gray-50 focus:ring-2 focus:ring-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-gray-200 dark:hover:bg-slate-800"
    >
      {children}
    </select>
  );
}

function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <MapPin className="mb-3 h-9 w-9 text-gray-300 dark:text-slate-600" />
      <p className="text-sm font-semibold text-gray-600 dark:text-gray-300">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="divide-y divide-gray-50 dark:divide-slate-800">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex animate-pulse items-center gap-4 px-4 py-4">
          <div className="h-9 w-9 shrink-0 rounded-xl bg-gray-200 dark:bg-slate-700" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-40 rounded-md bg-gray-200 dark:bg-slate-700" />
            <div className="h-2.5 w-24 rounded-md bg-gray-100 dark:bg-slate-800" />
          </div>
          <div className="hidden space-y-2 sm:block">
            <div className="h-3 w-16 rounded-md bg-gray-200 dark:bg-slate-700" />
            <div className="h-2.5 w-12 rounded-md bg-gray-100 dark:bg-slate-800" />
          </div>
          <div className="h-6 w-16 rounded-full bg-gray-100 dark:bg-slate-800" />
        </div>
      ))}
    </div>
  );
}
