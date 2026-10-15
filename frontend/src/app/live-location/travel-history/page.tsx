"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  ArrowLeft,
  BatteryMedium,
  CalendarDays,
  ChevronRight,
  Crosshair,
  ExternalLink,
  Gauge,
  Loader2,
  MapPin,
  Route,
  Timer,
  UserRound,
} from "lucide-react";
import apiClient from "@/lib/api";
import { employeeIdentifierValue } from "@/lib/employeeIdentifier";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import { AccessDenied } from "@/components/ui/AccessDenied";
import PageGuideModal from "@/components/PageGuideModal";
import { DateInput, FilterField, SearchableSelect } from "@/components/filters";
import type { SelectorItem } from "@/app/zoom-in/_components/EntitySelector";
import type { TravelMapLabels, TravelMapPoint, TravelMapStop } from "../_components/TravelPointMap";

const TravelPointMap = dynamic(() => import("../_components/TravelPointMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[320px] w-full animate-pulse items-center justify-center rounded-2xl bg-gray-100 dark:bg-slate-800">
      <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
    </div>
  ),
});

interface TravelPoint extends TravelMapPoint {
  is_charging?: boolean | null;
  speed?: number | null;
  altitude?: number | null;
}

interface TravelStop extends TravelMapStop {
  point_count: number;
  link: string;
}

interface TravelSummary {
  point_count: number;
  stop_count: number;
  distance_km: number;
  first_seen: string | null;
  last_seen: string | null;
}

interface TravelData {
  employee_id: number;
  employee_name: string | null;
  employee_type: string | null;
  dms_code: string | null;
  itop_number: string | null;
  pool_number: string | null;
  house_id: number | null;
  date: string;
  points: TravelPoint[];
  stops: TravelStop[];
  summary: TravelSummary;
}

interface EmployeeOption {
  employee_id: number;
  employee_name: string | null;
  employee_type: string | null;
  dms_code: string | null;
  itop_number: string | null;
  house_name: string | null;
}

interface House {
  id: number;
  name: string;
  code: string;
  display_name: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local (device) calendar date — the API compares against BST day bounds. */
function isoDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function clock(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function speedKmh(point: TravelPoint): number | null {
  if (point.speed_kmh != null) return point.speed_kmh;
  if (point.speed != null) return point.speed * 3.6;
  return null;
}

export default function TravelHistoryPage() {
  const { loading: authLoading, hasPermission } = useAuth();
  const { t } = useLanguage();

  const canViewHistory = hasPermission("location.history");

  const [houses, setHouses] = useState<House[]>([]);
  const [houseId, setHouseId] = useState("");

  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeesLoading, setEmployeesLoading] = useState(true);
  const [employeesError, setEmployeesError] = useState(false);

  const [empId, setEmpId] = useState("");
  const [date, setDate] = useState(isoDate());

  const [data, setData] = useState<TravelData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const mapRef = useRef<HTMLDivElement | null>(null);

  // Same house-scoping contract as the live-location page: send X-House-ID for
  // the picked house, and let the backend fall back to the user's own houses
  // when "All houses" is selected.
  const headers = useMemo(() => {
    const h: Record<string, string> = {};
    if (houseId) h["X-House-ID"] = houseId;
    return h;
  }, [houseId]);

  const typeLabel = useCallback(
    (type?: string | null) => {
      const key = (type || "unknown").toLowerCase();
      const path = `live_location.types.${key}`;
      const translated = t(path);
      return translated === path ? type || t("live_location.types.unknown") : translated;
    },
    [t]
  );

  const fetchEmployees = useCallback(async () => {
    setEmployeesLoading(true);
    try {
      const res = await apiClient.get("v1/locations/list", { headers });
      setEmployees(res.data?.data || []);
      setEmployeesError(false);
    } catch {
      setEmployeesError(true);
      setEmployees([]);
    } finally {
      setEmployeesLoading(false);
    }
  }, [headers]);

  const fetchTravel = useCallback(
    async (employeeId: string, day: string) => {
      setLoading(true);
      setLoadError(false);
      setSelectedIndex(null);
      try {
        const res = await apiClient.get(`v1/locations/movement/${employeeId}`, {
          params: day ? { date: day } : {},
          headers,
        });
        setData(res.data?.data || null);
      } catch {
        setLoadError(true);
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [headers]
  );

  useEffect(() => {
    if (authLoading || !canViewHistory) return;
    fetchEmployees();
  }, [authLoading, canViewHistory, fetchEmployees]);

  useEffect(() => {
    if (authLoading || !canViewHistory || !empId) return;
    fetchTravel(empId, date);
  }, [authLoading, canViewHistory, empId, date, fetchTravel]);

  // Fetch accessible houses once (same source as the live-location page).
  useEffect(() => {
    if (authLoading || !canViewHistory) return;
    apiClient
      .get("houses/accessible")
      .then((res) => setHouses(res.data || []))
      .catch(() => {});
  }, [authLoading, canViewHistory]);

  // The employee list is re-scoped by the picked house. An employee selected
  // from another house would 403 on the movement API, so the day's data is
  // dropped and the user is asked to pick again.
  useEffect(() => {
    setEmpId("");
    setData(null);
    setLoadError(false);
    setSelectedIndex(null);
  }, [houseId]);

  const houseItems: SelectorItem[] = useMemo(
    () =>
      houses.map((h) => ({
        id: String(h.id),
        label: h.display_name || h.name,
      })),
    [houses]
  );

  const employeeItems: SelectorItem[] = useMemo(
    () =>
      employees.map((e) => ({
        id: String(e.employee_id),
        label: e.employee_name || e.dms_code || `#${e.employee_id}`,
        sublabel:
          [e.dms_code, e.itop_number].filter(Boolean).join(" · ") || e.house_name || undefined,
        badge: (e.employee_type || "").toUpperCase() || undefined,
      })),
    [employees]
  );

  const points = data?.points || [];
  const stops = data?.stops || [];

  const mapLabels: TravelMapLabels = {
    fit_all: t("live_location.travel.map.fit_all"),
    fullscreen: t("live_location.travel.map.fullscreen"),
    exit_fullscreen: t("live_location.travel.map.exit_fullscreen"),
    empty: t("live_location.travel.map.empty"),
    legend: t("live_location.travel.map.legend"),
    start: t("live_location.travel.map.start"),
    end: t("live_location.travel.map.end"),
    stop: t("live_location.travel.map.stop"),
    selected: t("live_location.travel.map.selected"),
    duration: t("live_location.travel.map.duration"),
  };

  // On phones the map sits above the list, so selecting a record scrolls back up
  // to it instead of leaving the user staring at the list.
  const selectRecord = (index: number) => {
    setSelectedIndex(index);
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1279px)").matches) {
      mapRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  };

  if (!authLoading && !canViewHistory) {
    return <AccessDenied />;
  }

  return (
    <div className="mx-auto max-w-[1600px] animate-in space-y-6 fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <Link
            href="/live-location"
            className="mb-2 inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-gray-500 transition-colors hover:text-primary-600 dark:text-gray-400 dark:hover:text-primary-400"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t("live_location.travel.back_to_live")}
          </Link>
          <div className="flex items-center gap-2.5">
            <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
              <span className="rounded-xl bg-primary-50 p-2 text-primary-600 dark:bg-primary-500/10 dark:text-primary-400">
                <Route className="h-5 w-5" />
              </span>
              {t("live_location.travel.title")}
            </h1>
            <PageGuideModal pageKey="live_location.travel" />
          </div>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{t("live_location.travel.subtitle")}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {/* House scopes the employee list, so it comes first in the cascade.
              Hidden for single-house users, exactly like the live-location page. */}
          {houses.length > 1 && (
            <SearchableSelect
              label={t("live_location.travel.filters.house")}
              items={houseItems}
              value={houseId}
              onChange={setHouseId}
              placeholder={t("live_location.all_houses")}
              searchPlaceholder={t("live_location.travel.filters.house_search")}
              emptyMessage={t("live_location.travel.filters.house_empty")}
              noResultsMessage={t("live_location.travel.filters.house_no_results")}
            />
          )}

          {/* SearchableSelect renders its own FilterField label, so it must not be
              wrapped in a second one — that printed "Employee" twice. */}
          <SearchableSelect
            label={t("live_location.travel.filters.employee")}
            items={employeeItems}
            value={empId}
            onChange={setEmpId}
            loading={employeesLoading}
            disabled={employeesLoading || employeesError || employees.length === 0}
            disabledReason={employeesError ? t("live_location.travel.messages.list_error") : undefined}
            placeholder={t("live_location.travel.filters.employee_placeholder")}
            searchPlaceholder={t("live_location.travel.filters.employee_search")}
            emptyMessage={t("live_location.travel.filters.employee_empty")}
            noResultsMessage={t("live_location.travel.filters.employee_no_results")}
          />

          <FilterField label={t("live_location.travel.filters.date")}>
            <DateInput value={date} onChange={setDate} max={isoDate()} />
          </FilterField>

          <FilterField label={t("live_location.travel.filters.quick_range")}>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDate(isoDate())}
                className={`flex h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors lg:h-9 ${
                  date === isoDate()
                    ? "border-primary-200 bg-primary-50 text-primary-700 dark:border-primary-500/30 dark:bg-primary-500/10 dark:text-primary-300"
                    : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-300 dark:hover:bg-slate-700"
                }`}
              >
                <CalendarDays className="h-3.5 w-3.5" />
                {t("live_location.travel.filters.today")}
              </button>
              <button
                type="button"
                onClick={() => setDate(isoDate(-1))}
                className={`flex h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors lg:h-9 ${
                  date === isoDate(-1)
                    ? "border-primary-200 bg-primary-50 text-primary-700 dark:border-primary-500/30 dark:bg-primary-500/10 dark:text-primary-300"
                    : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-300 dark:hover:bg-slate-700"
                }`}
              >
                {t("live_location.travel.filters.yesterday")}
              </button>
            </div>
          </FilterField>
        </div>
      </div>

      {!empId ? (
        <EmptyState title={t("live_location.travel.messages.select_employee")} hint={t("live_location.travel.messages.select_employee_hint")} />
      ) : (
        <>
          {/* Employee + summary */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              icon={<UserRound className="h-5 w-5" />}
              tone="blue"
              label={t("live_location.travel.summary.employee")}
              value={data?.employee_name || data?.dms_code || "—"}
              // Role · DMS code · identifier: iTopUp number for RSOs, pool
              // number for every other role.
              hint={
                data
                  ? [typeLabel(data.employee_type), data.dms_code, employeeIdentifierValue(data)]
                      .filter(Boolean)
                      .join(" · ") || undefined
                  : undefined
              }
            />
            <StatCard
              icon={<MapPin className="h-5 w-5" />}
              tone="emerald"
              label={t("live_location.travel.summary.points")}
              value={loading ? "…" : String(data?.summary.point_count ?? 0)}
            />
            <StatCard
              icon={<Gauge className="h-5 w-5" />}
              tone="amber"
              label={t("live_location.travel.summary.distance")}
              value={loading ? "…" : `${data?.summary.distance_km ?? 0} km`}
              hint={t("live_location.travel.summary.stops_count", { count: data?.summary.stop_count ?? 0 })}
            />
            <StatCard
              icon={<Timer className="h-5 w-5" />}
              tone="slate"
              label={t("live_location.travel.summary.last_fix")}
              value={loading ? "…" : clock(data?.summary.last_seen)}
              hint={
                data?.summary.first_seen
                  ? t("live_location.travel.summary.first_fix_at", { time: clock(data.summary.first_seen) })
                  : undefined
              }
            />
          </div>

          {/* Records + map */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
            <div ref={mapRef} className="xl:order-2 xl:col-span-3">
              <div className="h-[320px] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:h-[420px] xl:h-[560px]">
                <TravelPointMap
                  points={points}
                  stops={stops}
                  selectedIndex={selectedIndex}
                  labels={mapLabels}
                  fitSignal={`${empId}|${date}`}
                />
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 xl:order-1 xl:col-span-2">
              <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-slate-800">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
                  <Route className="h-4 w-4 text-primary-500" />
                  {t("live_location.travel.records.title")}
                </div>
                <span className="text-[11px] text-gray-400">
                  {t("live_location.travel.records.hint")}
                </span>
              </div>

              {loading ? (
                <div className="divide-y divide-gray-50 dark:divide-slate-800">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="flex animate-pulse items-center gap-3 px-4 py-3">
                      <div className="h-3 w-12 rounded-md bg-gray-200 dark:bg-slate-700" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3 w-32 rounded-md bg-gray-200 dark:bg-slate-700" />
                        <div className="h-2.5 w-24 rounded-md bg-gray-100 dark:bg-slate-800" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : loadError ? (
                <EmptyState title={t("live_location.travel.messages.load_error")} />
              ) : points.length === 0 ? (
                <EmptyState
                  title={t("live_location.travel.messages.no_data")}
                  hint={t("live_location.travel.messages.no_data_hint")}
                />
              ) : (
                <div className="max-h-[560px] divide-y divide-gray-50 overflow-y-auto dark:divide-slate-800">
                  {points.map((point, index) => {
                    const speed = speedKmh(point);
                    const selected = selectedIndex === index;
                    return (
                      <div
                        key={`${point.time}-${index}`}
                        className={`flex items-center gap-2 pr-2 transition-colors ${
                          selected
                            ? "bg-primary-50 dark:bg-primary-500/10"
                            : "hover:bg-gray-50 dark:hover:bg-slate-800/60"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => selectRecord(index)}
                          aria-pressed={selected}
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 px-4 py-2.5 text-left"
                        >
                          <span
                            className={`w-14 shrink-0 font-mono text-xs font-semibold ${
                              selected ? "text-primary-700 dark:text-primary-300" : "text-gray-700 dark:text-gray-200"
                            }`}
                          >
                            {clock(point.time)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-mono text-[11px] text-gray-500 dark:text-gray-400">
                              {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
                            </span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                              <span className="inline-flex items-center gap-1">
                                <Gauge className="h-3 w-3" />
                                {speed != null ? `${Math.round(speed)} km/h` : "—"}
                              </span>
                              <span className="inline-flex items-center gap-1">
                                <BatteryMedium className="h-3 w-3" />
                                {point.battery_percent != null ? `${point.battery_percent}%` : "—"}
                              </span>
                              <span className="hidden items-center gap-1 sm:inline-flex">
                                <Crosshair className="h-3 w-3" />±
                                {point.accuracy != null ? `${Math.round(point.accuracy)} m` : "—"}
                              </span>
                            </span>
                          </span>
                          <ChevronRight
                            className={`h-4 w-4 shrink-0 ${
                              selected ? "text-primary-500" : "text-gray-300 dark:text-slate-600"
                            }`}
                          />
                        </button>
                        <a
                          href={`https://www.google.com/maps?q=${point.lat},${point.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={t("live_location.travel.records.open_map")}
                          aria-label={t("live_location.travel.records.open_map")}
                          className="flex h-11 shrink-0 cursor-pointer items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-primary-600 transition-colors hover:bg-primary-50 dark:text-primary-400 dark:hover:bg-primary-500/10 sm:h-8"
                        >
                          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                          <span className="hidden sm:inline">
                            {t("live_location.travel.records.google_maps")}
                          </span>
                        </a>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
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
  value: string;
  hint?: string;
  tone: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-medium uppercase tracking-wide text-gray-400">{label}</p>
        <span className={`shrink-0 rounded-xl p-2 ${TONES[tone] || TONES.slate}`}>{icon}</span>
      </div>
      <p className="mt-2 truncate text-lg font-bold text-gray-900 dark:text-gray-100">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-gray-400">{hint}</p>}
    </div>
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
