"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { toast } from "react-hot-toast";
import {
  Plus, ChevronLeft, ChevronRight,
  Eye, Pencil, Trash2, ChartNoAxesColumnIncreasing, FileDown,
  Calendar, Activity, Layers, CalendarDays,
  ChevronDown, ChevronUp, TrendingUp,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import CreateEventModal from "./_components/CreateEventModal";
import DeleteConfirmModal from "./_components/DeleteConfirmModal";
import ZoomInMasterFilter, { defaultFilters, type ZoomInFilters } from "@/components/zoom-in/ZoomInMasterFilter";

interface EventItem {
  id: number;
  house_id: number;
  date: string;
  event_type_id: number;
  activity_id: number;
  thana: string;
  activation_count: number;
  house_name: string | null;
  house_code: string | null;
  event_type_name: string | null;
  activity_name: string | null;
  bts_ids: number[];
  rso_ids: number[];
  bp_ids: number[];
  retailer_codes: string[];
}

interface PaginatedResponse {
  success: boolean;
  data: EventItem[];
  pagination: {
    page: number;
    per_page: number;
    total: number;
    total_pages: number;
    has_next: boolean;
    has_prev: boolean;
  };
}

interface DashboardSummary {
  total_events: number;
  total_activations: number;
  total_allocated: number;
  remaining_allocations: number;
  allocation_used_pct: number;
  event_type_breakdown: { event_type: string; thana: string; allocated: number; created: number; remaining: number }[];
  daily_events: { date: string; count: number }[];
}

const perPage = 5;

function StatCard({
  icon: Icon,
  label,
  value,
  subtitle,
  color,
}: {
  icon: typeof Calendar;
  label: string;
  value: string | number;
  subtitle?: string;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    blue: "bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400",
    emerald: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    violet: "bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400",
    amber: "bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400",
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 p-5 shadow-sm hover:shadow-md transition-all duration-300">
      <div className="flex items-start justify-between">
        <div className="space-y-1.5">
          <p className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {label}
          </p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {value}
          </p>
          {subtitle && (
            <p className="text-[11px] text-gray-400 dark:text-gray-500">{subtitle}</p>
          )}
        </div>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${colorMap[color] || colorMap.blue}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </div>
  );
}

export default function ZoomInPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const router = useRouter();
  const { t } = useLanguage();

  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, total_pages: 0, has_next: false, has_prev: false });
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editEventId, setEditEventId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; label: string } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);

  function getDefaultFrom(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  }
  function getDefaultTo(): string {
    return new Date().toISOString().slice(0, 10);
  }

  const [filters, setFilters] = useState<ZoomInFilters>({
    ...defaultFilters,
    date_from: getDefaultFrom(),
    date_to: getDefaultTo(),
  });
  const dateFrom = filters.date_from;
  const dateTo = filters.date_to;

  const handleExport = async () => {
    setExporting(true);
    try {
      const params: Record<string, string> = { date_from: dateFrom, date_to: dateTo };
      const res = await apiClient.get("zoom-in/events/export", {
        params, responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `zoom_in_events_${dateFrom}_to_${dateTo}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success(t("zoom_in.messages.export_success"));
    } catch {
      toast.error(t("zoom_in.messages.export_failed"));
    } finally {
      setExporting(false);
    }
  };

  const fetchDashboard = useCallback(async (month?: string) => {
    setDashboardLoading(true);
    try {
      const params: Record<string, string> = {};
      if (month) params.month = month;
      const res = await apiClient.get<DashboardSummary>("zoom-in/dashboard/summary", { params });
      setDashboard(res.data);
    } catch {
      // silent
    } finally {
      setDashboardLoading(false);
    }
  }, []);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        page: String(page), per_page: String(perPage),
        date_from: dateFrom, date_to: dateTo,
      };
      if (filters.search) params.search = filters.search;
      if (filters.event_type_id) params.event_type_id = String(filters.event_type_id);
      if (filters.activity_id) params.activity_id = String(filters.activity_id);
      if (filters.thana) params.thana = filters.thana;
      const res = await apiClient.get<PaginatedResponse>("zoom-in/events", { params });
      setEvents(res.data.data);
      setPagination(res.data.pagination);
    } catch {
      toast.error(t("zoom_in.messages.load_failed"));
    } finally {
      setLoading(false);
    }
  }, [page, filters, dateFrom, dateTo, t]);

  useEffect(() => {
    if (authLoading || !hasPermission("zoom_in.view")) return;
    const month = dateFrom.substring(0, 7);
    fetchDashboard(month);
  }, [authLoading, hasPermission, dateFrom]);

  useEffect(() => {
    if (authLoading || !hasPermission("zoom_in.view")) return;
    fetchEvents();
  }, [page, filters, dateFrom, dateTo]);

  useEffect(() => {
    setPage(1);
  }, [filters.search, filters.event_type_id, filters.activity_id, filters.thana, dateFrom, dateTo]);

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await apiClient.delete(`zoom-in/events/${deleteTarget.id}`);
      toast.success(t("zoom_in.messages.delete_success"));
      setDeleteTarget(null);
      fetchEvents();
      fetchDashboard(dateFrom.substring(0, 7));
    } catch {
      toast.error(t("common.error"));
    } finally {
      setDeleteLoading(false);
    }
  };

  const onModalSuccess = () => {
    fetchEvents();
    fetchDashboard(dateFrom.substring(0, 7));
  };

  const chartData = (dashboard?.daily_events || []).map((d) => ({
    day: new Date(d.date).getDate().toString(),
    count: d.count,
  }));

  const allocationUsedPct = dashboard?.allocation_used_pct ?? 0;
  const totalAllocated = dashboard?.total_allocated ?? 0;
  const createdFromAlloc = totalAllocated - (dashboard?.remaining_allocations ?? 0);

  if (!authLoading && !hasPermission("zoom_in.view")) {
    return <AccessDenied />;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* ─── Header ───────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t("zoom_in.title")}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t("zoom_in.description")}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {hasPermission("zoom_in.export") && (
            <button
              onClick={handleExport}
              disabled={exporting}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-emerald-500 text-white rounded-xl text-sm font-bold hover:bg-emerald-600 transition-all shadow-sm disabled:opacity-50"
            >
              <FileDown className="w-4 h-4" />
              {t("common.export")}
            </button>
          )}
          {hasPermission("zoom_in.create") && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-xl text-sm font-bold hover:bg-primary-600 transition-all shadow-sm"
            >
              <Plus className="w-4 h-4" />
              {t("zoom_in.create_event")}
            </button>
          )}
        </div>
      </div>

      {/* ─── Stats Cards ──────────────────────────────────────── */}
      {dashboardLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 p-5 animate-pulse">
              <div className="space-y-3">
                <div className="h-3 w-20 bg-gray-200 dark:bg-slate-700 rounded" />
                <div className="h-7 w-16 bg-gray-200 dark:bg-slate-700 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : dashboard ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={CalendarDays}
            label={t("zoom_in.title")}
            value={dashboard.total_events}
            subtitle="Total Events"
            color="blue"
          />
          <StatCard
            icon={Activity}
            label="Activations"
            value={dashboard.total_events > 0 ? "—" : "0"}
            subtitle={dashboard.total_events > 0 ? "from events" : "No data"}
            color="emerald"
          />
          <StatCard
            icon={Layers}
            label="Allocation Used"
            value={`${allocationUsedPct}%`}
            subtitle={`${createdFromAlloc} of ${totalAllocated}`}
            color="violet"
          />
          <StatCard
            icon={Calendar}
            label="Remaining"
            value={dashboard.remaining_allocations}
            subtitle="Available slots"
            color="amber"
          />
        </div>
      ) : null}

      {/* ─── Middle Section: Progress + Chart ─────────────────── */}
      {!dashboardLoading && dashboard && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Allocation Progress */}
          <div className="lg:col-span-1 bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 p-5 shadow-sm">
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-3">Allocation Progress</h3>
            {dashboard.event_type_breakdown.length === 0 ? (
              <p className="text-xs text-gray-400">No allocations for this month</p>
            ) : (
              <div className="space-y-3">
                {dashboard.event_type_breakdown.map((et, idx) => {
                  const pct = et.allocated > 0 ? Math.min(100, (et.created / et.allocated) * 100) : 0;
                  const barColor = pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500";
                  return (
                    <div key={`${et.event_type}-${et.thana}-${idx}`}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="min-w-0 flex items-center gap-1">
                          <span className="text-xs font-bold text-gray-700 dark:text-gray-300">{et.event_type}</span>
                          {et.thana && (
                            <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-1">— {et.thana}</span>
                          )}
                        </div>
                        <span className="text-[11px] text-gray-500 dark:text-gray-400 shrink-0 ml-2">
                          {et.created}/{et.allocated}
                        </span>
                      </div>
                      <div className="h-2 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ease-out ${barColor}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right: Daily Chart */}
          <div className="lg:col-span-2">
            <Card className="bg-white dark:bg-slate-900 py-0">
              <CardHeader className="flex flex-col items-stretch border-b p-0! sm:flex-row">
                <div className="flex flex-1 flex-col justify-center gap-1 px-6 pt-4 pb-3 sm:py-0!">
                  <CardTitle>Daily Events</CardTitle>
                  <CardDescription>
                    Events per day for{" "}
                    {new Date(dateFrom + "T00:00:00").toLocaleDateString("en-US", {
                      month: "long",
                      year: "numeric",
                    })}
                  </CardDescription>
                </div>
                <div className="flex">
                  <div className="relative z-30 flex flex-1 flex-col justify-center gap-1 border-t px-6 py-4 text-left even:border-l sm:border-t-0 sm:border-l sm:px-8 sm:py-6">
                    <span className="text-xs text-muted-foreground">Total Events</span>
                    <span className="text-lg leading-none font-bold sm:text-3xl">
                      {chartData.reduce((s, d) => s + d.count, 0).toLocaleString()}
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-2 sm:p-6">
                {chartData.length === 0 || chartData.every((d) => d.count === 0) ? (
                  <div className="flex items-center justify-center h-[250px] text-xs text-muted-foreground">
                    No events this month
                  </div>
                ) : (
                  <ChartContainer
                    config={{
                      count: {
                        label: "Events",
                        color: "var(--chart-1)",
                      },
                    } satisfies ChartConfig}
                    className="aspect-auto h-[250px] w-full"
                  >
                    <BarChart
                      accessibilityLayer
                      data={chartData}
                      margin={{ left: 12, right: 12 }}
                    >
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey="day"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        tick={{ fontSize: 11, fill: "#9ca3af" }}
                      />
                      <ChartTooltip
                        cursor={{ fill: "rgba(0,0,0,0.03)" }}
                        content={<ChartTooltipContent indicator="dot" />}
                      />
                      <Bar
                        dataKey="count"
                        fill="var(--color-count)"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={24}
                      />
                    </BarChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ─── Filters ──────────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row gap-4">
        <div className="w-full lg:w-72 shrink-0">
          <ZoomInMasterFilter
            filters={filters}
            onChange={(f) => setFilters(f)}
            onClear={() => setFilters({ ...defaultFilters, date_from: getDefaultFrom(), date_to: getDefaultTo() })}
          />
        </div>
        <div className="flex-1 min-w-0">

      {/* ─── Events Table / Loading / Empty ───────────────────── */}
      {loading ? (
        <div className="divide-y divide-gray-100 dark:divide-slate-800 bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 overflow-hidden">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-4 px-6 py-5 animate-pulse">
              <div className="space-y-2 flex-1">
                <div className="h-3 w-40 bg-gray-200 dark:bg-slate-700 rounded-md" />
                <div className="h-2.5 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
              </div>
              <div className="hidden sm:block flex-1 space-y-2">
                <div className="h-3 w-20 bg-gray-200 dark:bg-slate-700 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-gray-300 dark:border-slate-800 p-16 text-center">
          <ChartNoAxesColumnIncreasing className="w-12 h-12 text-gray-300 dark:text-gray-700 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t("zoom_in.messages.no_events")}</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t("zoom_in.messages.no_events_desc")}</p>
          {hasPermission("zoom_in.create") && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center justify-center gap-2 mt-4 px-4 py-2 bg-primary-500 text-white rounded-xl text-sm font-bold hover:bg-primary-600 transition-all shadow-sm"
            >
              <Plus className="w-4 h-4" />
              {t("zoom_in.create_event")}
            </button>
          )}
        </div>
      ) : (
        <>
          {/* ─── Desktop Table ─────────────────────────────────── */}
          <div className="hidden lg:block bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 overflow-hidden">
            <div className="overflow-x-auto scrollbar-custom">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-900/50">
                    <th className="text-left px-6 py-4 font-bold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">{t("zoom_in.table.date")}</th>
                    <th className="text-left px-6 py-4 font-bold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">{t("zoom_in.fields.house")}</th>
                    <th className="text-left px-6 py-4 font-bold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">{t("zoom_in.fields.thana")}</th>
                    <th className="text-left px-6 py-4 font-bold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">{t("zoom_in.fields.event_type")}</th>
                    <th className="text-left px-6 py-4 font-bold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">{t("zoom_in.fields.activation_count")}</th>
                    <th className="text-right px-6 py-4 font-bold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">{t("zoom_in.table.actions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-800/50">
                  {events.map((event) => {
                    const d = new Date(event.date);
                    const formattedDate = d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
                    return (
                      <tr key={event.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                        <td className="whitespace-nowrap px-6 py-4 text-gray-900 dark:text-gray-100 font-medium">{formattedDate}</td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <div className="text-gray-900 dark:text-gray-100 font-medium">{event.house_name || "—"}</div>
                          {event.house_code && <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">{event.house_code}</div>}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-gray-700 dark:text-gray-300">{event.thana}</td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-bold bg-primary-50 dark:bg-primary-500/10 text-primary-600 dark:text-primary-400">
                            {event.event_type_name || "—"}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-gray-900 dark:text-gray-100 font-bold">{event.activation_count ?? 0}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => router.push(`/zoom-in/${event.id}`)}
                              className="p-2 text-gray-400 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/10 rounded-lg transition-all"
                              title="View"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            {hasPermission("zoom_in.edit") && (
                              <button
                                onClick={() => setEditEventId(event.id)}
                                className="p-2 text-gray-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/10 rounded-lg transition-all"
                                title="Edit"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                            )}
                            {hasPermission("zoom_in.delete") && (
                              <button
                                onClick={() => setDeleteTarget({ id: event.id, label: `#${event.id} — ${event.house_name || event.date}` })}
                                className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-all"
                                title="Delete"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ─── Mobile Accordion ──────────────────────────────── */}
          <div className="lg:hidden space-y-3">
            {events.map((event) => {
              const d = new Date(event.date);
              const formattedDate = d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
              const isExpanded = expandedId === event.id;
              return (
                <div
                  key={event.id}
                  className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 overflow-hidden"
                >
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : event.id)}
                    className="w-full flex items-center justify-between p-4 text-left"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-primary-50 dark:bg-primary-500/10 text-primary-600 dark:text-primary-400 text-xs font-bold shrink-0">
                        {event.id}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">
                          {event.house_name || "—"}
                        </p>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                          {event.thana} · {event.event_type_name || "—"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs font-bold text-gray-900 dark:text-gray-100">{event.activation_count ?? 0}</span>
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-0 border-t border-gray-100 dark:border-slate-800 space-y-3">
                      <div className="grid grid-cols-2 gap-3 pt-3">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("zoom_in.table.date")}</p>
                          <p className="text-xs font-medium text-gray-900 dark:text-gray-100 mt-0.5">{formattedDate}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("zoom_in.fields.house")}</p>
                          <p className="text-xs font-medium text-gray-900 dark:text-gray-100 mt-0.5">{event.house_name || "—"}</p>
                          {event.house_code && <p className="text-[10px] text-gray-400">{event.house_code}</p>}
                        </div>
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("zoom_in.fields.thana")}</p>
                          <p className="text-xs font-medium text-gray-900 dark:text-gray-100 mt-0.5">{event.thana}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("zoom_in.fields.event_type")}</p>
                          <span className="inline-flex mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary-50 dark:bg-primary-500/10 text-primary-600 dark:text-primary-400">
                            {event.event_type_name || "—"}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100 dark:border-slate-800">
                        <button
                          onClick={() => router.push(`/zoom-in/${event.id}`)}
                          className="p-2 text-gray-400 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/10 rounded-lg transition-all"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {hasPermission("zoom_in.edit") && (
                          <button
                            onClick={() => setEditEventId(event.id)}
                            className="p-2 text-gray-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/10 rounded-lg transition-all"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        )}
                        {hasPermission("zoom_in.delete") && (
                          <button
                            onClick={() => setDeleteTarget({ id: event.id, label: `#${event.id} — ${event.house_name || event.date}` })}
                            className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-all"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ─── Pagination ───────────────────────────────────────── */}
      {!loading && pagination.total_pages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Showing {(page - 1) * perPage + 1} to {Math.min(page * perPage, pagination.total)} of {pagination.total}
          </p>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={!pagination.has_prev}
              className="flex items-center gap-1 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              {t("common.prev")}
            </button>
            <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{page} / {pagination.total_pages}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!pagination.has_next}
              className="flex items-center gap-1 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              {t("common.next")}
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

        </div>
      </div>

      {/* ─── Modals ───────────────────────────────────────────── */}
      <CreateEventModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={onModalSuccess}
      />
      <CreateEventModal
        isOpen={!!editEventId}
        editEventId={editEventId}
        onClose={() => setEditEventId(null)}
        onSuccess={onModalSuccess}
      />
      <DeleteConfirmModal
        isOpen={!!deleteTarget}
        deleting={deleteTarget}
        loading={deleteLoading}
        onConfirm={handleDeleteConfirm}
        onClose={() => { setDeleteTarget(null); setDeleteLoading(false); }}
      />
    </div>
  );
}
