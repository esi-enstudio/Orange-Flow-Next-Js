"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  RefreshCw,
  FileSpreadsheet,
  FileText,
  Printer,
  Building2,
  Calendar,
  Filter,
  RotateCcw,
  Clock,
  Settings,
  X as XIcon,
  Users,
  UserCog,
  UserRound,
  Target as TargetIcon,
  AlertTriangle,
  Inbox,
  TrendingUp,
  Award,
  BarChart3,
  Activity,
  Zap,
  Trophy,
  Sparkles,
  Medal,
  PieChart as PieChartIcon,
  ArrowUp,
  ArrowDown,
  type LucideIcon,
} from "lucide-react";
import { toast } from "react-hot-toast";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/useLanguage";
import { exportActiveLsoReport } from "@/lib/export-active-lso";

// ------------------------------------------------------------------ types
interface PeriodInfo {
  start_date: string;
  end_date: string;
  total_days: number;
  days_elapsed: number;
  days_remaining: number;
  today: string;
  target_month: string;
  prev_month_start: string;
  prev_month_end: string;
  active_threshold_days: number;
  active_threshold_amount: number;
}

interface RetailerCounts {
  day_0: number;
  day_1: number;
  day_2: number;
  day_3: number;
  day_4: number;
  day_5: number;
  day_6: number;
  days_no_sales: number;
  inactive_last_month: number;
  reactivated: number;
}

interface RsoRow {
  employee_id: number;
  employee_code: string;
  name: string;
  dms_code: string | null;
  itop_number: string | null;
  supervisor_id: number | null;
  supervisor_name: string | null;
  target: number;
  achieved: number;
  ach_pct: number;
  remaining: number;
  daily_avg: number;
  projection: number;
  drr: number;
  status: string;
  retailer_count: number;
  retailer_counts: RetailerCounts;
}

interface Summary {
  rso_count: number;
  retailer_count: number;
  target: number;
  achieved: number;
  ach_pct: number;
  remaining: number;
  daily_avg: number;
  projection: number;
  drr: number;
  status: string;
  retailer_counts: RetailerCounts;
}

interface SupSummary extends Summary {
  supervisor_id: number | null;
  supervisor_name: string;
}

interface ReportData {
  success: boolean;
  period: PeriodInfo;
  rows: RsoRow[];
  summary: Summary;
  supervisor_summary: SupSummary[];
}

interface FilterOptions {
  success: boolean;
  role_mode: "admin" | "supervisor" | "rso";
  houses: { id: number; name: string; code: string }[];
  managers: { id: number; name: string; code: string; house_id: number }[];
  supervisors: { id: number; name: string; code: string }[];
  rsos: { id: number; name: string; code: string }[];
  defaults: {
    house_id?: number;
    manager_id?: number;
    supervisor_id?: number;
    rso_id?: number;
  };
  statuses: string[];
}

interface FilterState {
  houseId: string;
  managerId: string;
  supervisorId: string;
  rsoId: string;
  status: string;
  month: number;
  year: number;
  startDate: string;
  endDate: string;
}

// ------------------------------------------------------------------ helpers
function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function endOfMonthStr(year: number, month: number): string {
  return toDateStr(new Date(year, month, 0));
}

function formatNumber(n: number): string {
  if (n === undefined || n === null) return "0";
  return Number(n).toLocaleString();
}

const statusColors: Record<string, string> = {
  achieved: "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30",
  on_track: "bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-500/30",
  needs_attention: "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/30",
  behind: "bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-500/30",
};

const A_COL_KEYS = ["target", "achieved", "ach_pct", "remaining", "drr", "daily_avg", "projection", "status"] as const;
const B_COL_KEYS = ["retailers", "day_0", "day_1", "day_2", "day_3", "day_4", "day_5", "day_6", "days_no_sales", "inactive_last_month", "reactivated"] as const;

function StatusBadge({ status }: { status: string }) {
  const { t } = useLanguage();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap",
        statusColors[status] || statusColors.behind
      )}
    >
      {t(`active_lso_report.status.${status}`)}
    </span>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  valueColor,
  valueExtra,
  subtitle,
  trend,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  valueColor?: string;
  valueExtra?: React.ReactNode;
  subtitle?: string | React.ReactNode;
  trend?: { dir: "up" | "down"; text: string };
}) {
  return (
    <div className="group bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 p-5 shadow-sm hover:shadow-md transition-shadow relative">
      <div className="flex items-start justify-between">
        <div className="space-y-1.5">
          <p className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            {label}
          </p>
          <div className="flex items-center gap-2">
            <p className={cn("text-2xl font-black tracking-tight", valueColor || "text-gray-900 dark:text-gray-100")}>
              {value}
            </p>
            {valueExtra && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30">
                {valueExtra}
              </span>
            )}
          </div>
          {subtitle && (
            <div className="text-[11px] text-gray-400 dark:text-gray-500">{subtitle}</div>
          )}
        </div>
        <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-500/10 flex items-center justify-center shrink-0">
          <Icon className="w-5 h-5 text-primary-600 dark:text-primary-400" />
        </div>
      </div>
      {trend && (
        <div className="mt-3 flex items-center gap-1.5">
          {trend.dir === "up" ? (
            <ArrowUp className="w-3 h-3 text-emerald-500" />
          ) : (
            <ArrowDown className="w-3 h-3 text-rose-500" />
          )}
          <span className={`text-[11px] font-medium ${trend.dir === "up" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{trend.text}</span>
        </div>
      )}
    </div>
  );
}

function projectionStatus(achPct: number, projPct: number): string {
  if (achPct >= 100) return "achieved";
  if (projPct >= 100) return "on_track";
  if (projPct >= 95) return "needs_attention";
  return "behind";
}

function LeaderboardCard({ data, title, icon: Icon, color, t, subtitleKey }: {
  data: Array<{ name: string; achieved: number; target: number; ach_pct: number }>;
  title: string;
  icon: LucideIcon;
  color: string;
  t: (key: string) => string;
  subtitleKey: string;
}) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", color)}>
          <Icon className="w-4 h-4 text-white" />
        </div>
        <h3 className="font-bold text-sm text-gray-900 dark:text-gray-100">{title}</h3>
      </div>
      {data.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-4">{t("active_lso_report.messages.no_data")}</p>
      ) : (
        <div className="space-y-2">
          {data.map((emp, idx) => (
            <div key={`${emp.name}-${idx}`} className="flex items-center gap-3 py-1.5">
              <div className={cn(
                "w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-black shrink-0",
                idx === 0 ? "bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400" :
                idx === 1 ? "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300" :
                idx === 2 ? "bg-orange-100 dark:bg-orange-500/20 text-orange-600 dark:text-orange-400" :
                "bg-gray-100 dark:bg-slate-800 text-gray-400"
              )}>
                {idx + 1}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-gray-900 dark:text-gray-100 truncate">{emp.name}</p>
                <div className="flex items-center gap-2 text-[10px] text-gray-400">
                  <span>{formatNumber(emp.achieved)} / {formatNumber(emp.target)}</span>
                </div>
              </div>
              <div className="text-right">
                <p className={cn(
                  "text-xs font-black",
                  emp.ach_pct >= 100 ? "text-emerald-600 dark:text-emerald-400" :
                  emp.ach_pct >= 70 ? "text-blue-600 dark:text-blue-400" :
                  emp.ach_pct >= 40 ? "text-amber-600 dark:text-amber-400" :
                  "text-rose-600 dark:text-rose-400"
                )}>
                  {emp.ach_pct}%
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
      {subtitleKey && data.length > 0 && (
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-3 border-t border-gray-100 dark:border-slate-800 pt-3">
          {t(subtitleKey)}
        </p>
      )}
    </div>
  );
}

function SkeletonTable() {
  return (
    <div className="animate-pulse bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-slate-800">
        <div className="h-4 w-44 bg-gray-200 dark:bg-slate-700 rounded-md" />
        <div className="h-8 w-28 bg-gray-200 dark:bg-slate-700 rounded-lg" />
      </div>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4 border-b border-gray-50 dark:border-slate-800">
          <div className="h-3 w-36 bg-gray-200 dark:bg-slate-700 rounded-md" />
          <div className="h-3 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
          {Array.from({ length: 10 }).map((_, j) => (
            <div key={j} className="h-3 w-12 bg-gray-100 dark:bg-slate-800 rounded-md" />
          ))}
        </div>
      ))}
    </div>
  );
}

function SkeletonKpiCard() {
  return (
    <div className="animate-pulse bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 p-5 shadow-sm">
      <div className="h-3 w-24 bg-gray-200 dark:bg-slate-700 rounded-md mb-3" />
      <div className="h-7 w-32 bg-gray-200 dark:bg-slate-700 rounded-md mb-2" />
      <div className="h-2.5 w-20 bg-gray-100 dark:bg-slate-800 rounded-md" />
    </div>
  );
}

// ------------------------------------------------------------------ page
export default function ActiveLsoReportPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const router = useRouter();
  const { t, language } = useLanguage();

  const today = new Date();

  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
  const [filters, setFilters] = useState<FilterState>({
    houseId: "",
    managerId: "",
    supervisorId: "",
    rsoId: "",
    status: "",
    month: today.getMonth() + 1,
    year: today.getFullYear(),
    startDate: toDateStr(new Date(today.getFullYear(), today.getMonth(), 1)),
    endDate: endOfMonthStr(today.getFullYear(), today.getMonth() + 1),
  });
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [exporting, setExporting] = useState<"xlsx" | "csv" | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [configLoading, setConfigLoading] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configIsCustom, setConfigIsCustom] = useState(false);
  const [configForm, setConfigForm] = useState({ days: "7", amount: "500" });

  const initializedRef = useRef(false);
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const permissionOk = !authLoading && hasPermission("active_lso.view");

  // Redirect if no permission
  useEffect(() => {
    if (!authLoading && !hasPermission("active_lso.view")) {
      const timer = setTimeout(() => router.push("/"), 5000);
      return () => clearTimeout(timer);
    }
  }, [authLoading, hasPermission, router]);

  const buildParams = useCallback((f: FilterState) => {
    const p: Record<string, string> = { start_date: f.startDate, end_date: f.endDate };
    if (f.houseId) p.house_id = f.houseId;
    if (f.managerId) p.manager_id = f.managerId;
    if (f.supervisorId) p.supervisor_id = f.supervisorId;
    if (f.rsoId) p.rso_id = f.rsoId;
    if (f.status) p.status = f.status;
    return p;
  }, []);

  const fetchData = useCallback(
    async (f: FilterState, silent = false) => {
      if (!silent) setLoading(true);
      setError(false);
      try {
        const res = await apiClient.get("reports/active-lso", { params: buildParams(f) });
        setData(res.data);
        setLastUpdated(new Date());
      } catch {
        setError(true);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [buildParams]
  );

  // Load filter options once
  useEffect(() => {
    if (!authLoading && hasPermission("active_lso.view")) {
      apiClient
        .get("reports/active-lso/filters")
        .then((res) => {
          const opts = res.data as FilterOptions;
          setFilterOptions(opts);
          const d = opts.defaults || {};
          setFilters((prev) => {
            const next: FilterState = {
              ...prev,
              houseId: d.house_id ? String(d.house_id) : prev.houseId,
              managerId: d.manager_id ? String(d.manager_id) : "",
              supervisorId: d.supervisor_id ? String(d.supervisor_id) : "",
              rsoId: d.rso_id ? String(d.rso_id) : "",
            };
            return next;
          });
          initializedRef.current = true;
        })
        .catch(() => {
          setError(true);
          setLoading(false);
        });
    }
  }, [authLoading, hasPermission]);

  // Fetch whenever filters change (after options are loaded)
  useEffect(() => {
    if (initializedRef.current && permissionOk) {
      if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
      fetchTimerRef.current = setTimeout(() => fetchData(filters), 400);
      return () => {
        if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
      };
    }
  }, [filters, permissionOk, fetchData]);

  const updateFilter = (patch: Partial<FilterState>) => {
    setFilters((prev) => {
      const next = { ...prev, ...patch };
      if (patch.month !== undefined || patch.year !== undefined) {
        const m = patch.month ?? prev.month;
        const y = patch.year ?? prev.year;
        next.startDate = toDateStr(new Date(y, m - 1, 1));
        next.endDate = endOfMonthStr(y, m);
      }
      return next;
    });
  };

  const handleManagerChange = (id: string) => {
    const mgr = filterOptions?.managers.find((m) => String(m.id) === id);
    setFilters((prev) => ({
      ...prev,
      managerId: id,
      houseId: mgr ? String(mgr.house_id) : prev.houseId,
    }));
  };

  const handleReset = () => {
    const d = filterOptions?.defaults || {};
    setFilters((prev) => ({
      ...prev,
      houseId: d.house_id ? String(d.house_id) : "",
      managerId: "",
      supervisorId: d.supervisor_id ? String(d.supervisor_id) : "",
      rsoId: d.rso_id ? String(d.rso_id) : "",
      status: "",
      month: today.getMonth() + 1,
      year: today.getFullYear(),
      startDate: toDateStr(new Date(today.getFullYear(), today.getMonth(), 1)),
      endDate: endOfMonthStr(today.getFullYear(), today.getMonth() + 1),
    }));
  };

  const handleExport = async (format: "xlsx" | "csv") => {
    if (!data) return;
    setExporting(format);
    try {
      await exportActiveLsoReport(format, {
        start_date: filters.startDate,
        end_date: filters.endDate,
        house_id: filters.houseId ? Number(filters.houseId) : null,
        manager_id: filters.managerId ? Number(filters.managerId) : null,
        supervisor_id: filters.supervisorId ? Number(filters.supervisorId) : null,
        rso_id: filters.rsoId ? Number(filters.rsoId) : null,
        status: filters.status || null,
      });
    } catch {
      toast.error(t("active_lso_report.messages.export_failed"));
    } finally {
      setExporting(null);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const openConfig = async () => {
    setShowConfig(true);
    setConfigLoading(true);
    try {
      const params: Record<string, string> = { month: String(filters.month), year: String(filters.year) };
      if (filters.houseId) params.house_id = filters.houseId;
      const res = await apiClient.get("reports/active-lso/config", { params });
      const d = res.data?.data;
      if (d) {
        setConfigForm({ days: String(d.days_threshold), amount: String(d.amount_threshold) });
        setConfigIsCustom(!!d.is_custom);
      }
    } catch {
      toast.error(t("active_lso_report.config.load_failed"));
    } finally {
      setConfigLoading(false);
    }
  };

  const saveConfig = async () => {
    const days = parseInt(configForm.days, 10);
    const amount = parseFloat(configForm.amount);
    if (!Number.isFinite(days) || days < 1 || days > 31) {
      toast.error(t("active_lso_report.config.invalid_days"));
      return;
    }
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error(t("active_lso_report.config.invalid_amount"));
      return;
    }
    setSavingConfig(true);
    try {
      await apiClient.put("reports/active-lso/config", {
        house_id: filters.houseId ? Number(filters.houseId) : undefined,
        month: filters.month,
        year: filters.year,
        days_threshold: days,
        amount_threshold: amount,
      });
      toast.success(t("active_lso_report.config.save_success"));
      setShowConfig(false);
      fetchData(filters);
    } catch {
      toast.error(t("active_lso_report.config.save_failed"));
    } finally {
      setSavingConfig(false);
    }
  };

  if (authLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 bg-gray-200 dark:bg-slate-700 rounded-md animate-pulse" />
        <SkeletonTable />
      </div>
    );
  }

  if (!hasPermission("active_lso.view")) {
    return <AccessDenied />;
  }

  const mode = filterOptions?.role_mode || "admin";
  const lockedHouse = mode !== "admin";
  const lockedSupervisor = mode === "supervisor" || mode === "rso";
  const lockedRso = mode === "rso";
  const showManager = mode === "admin" && (filterOptions?.managers.length ?? 0) > 0;

  const period = data?.period;
  const summary = data?.summary;
  const rows = data?.rows || [];
  const supSummary = data?.supervisor_summary || [];

  const getMonthName = (m: number) => {
    if (language === "bn") {
      const bnMonths: Record<number, string> = {
        1: "জানুয়ারি", 2: "ফেব্রুয়ারি", 3: "মার্চ", 4: "এপ্রিল",
        5: "মে", 6: "জুন", 7: "জুলাই", 8: "আগস্ট",
        9: "সেপ্টেম্বর", 10: "অক্টোবর", 11: "নভেম্বর", 12: "ডিসেম্বর",
      };
      return bnMonths[m] || "";
    }
    const enMonths = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return enMonths[m - 1] || "";
  };

  const selectClass =
    "pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg text-sm font-medium text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors shadow-sm outline-none focus:ring-2 focus:ring-primary-500 appearance-none cursor-pointer min-w-[150px] disabled:opacity-50 disabled:cursor-not-allowed";

  const renderCountCell = (counts: RetailerCounts, key: (typeof B_COL_KEYS)[number], retailerCount?: number) => {
    if (key === "retailers") return formatNumber(retailerCount ?? 0);
    return formatNumber((counts as unknown as Record<string, number>)[key] ?? 0);
  };

  const renderACell = (row: { target: number; achieved: number; ach_pct: number; remaining: number; drr: number; daily_avg: number; projection: number; status: string }, key: (typeof A_COL_KEYS)[number]) => {
    switch (key) {
      case "target": return <span className="font-semibold text-gray-900 dark:text-gray-100">{formatNumber(row.target)}</span>;
      case "achieved": return <span className="font-bold text-gray-900 dark:text-gray-100">{formatNumber(row.achieved)}</span>;
      case "ach_pct": return <span className="font-bold">{formatNumber(Math.round(row.ach_pct))}%</span>;
      case "remaining": return formatNumber(row.remaining);
      case "drr": return formatNumber(row.drr);
      case "daily_avg": return formatNumber(row.daily_avg);
      case "projection": return <span className="font-semibold">{formatNumber(Math.round(row.projection))}</span>;
      case "status": return <StatusBadge status={row.status} />;
    }
  };

  const renderTotalCell = (key: (typeof A_COL_KEYS)[number] | (typeof B_COL_KEYS)[number]) => {
    if (!summary) return "";
    if (A_COL_KEYS.includes(key as (typeof A_COL_KEYS)[number])) {
      return renderACell(summary, key as (typeof A_COL_KEYS)[number]);
    }
    if (key === "retailers") return formatNumber(summary.retailer_count);
    return formatNumber((summary.retailer_counts as unknown as Record<string, number>)[key as string] ?? 0);
  };

  return (
    <div className="space-y-5 print:space-y-3">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2.5">
            <TargetIcon className="w-6 h-6 text-primary-600 dark:text-primary-400" />
            {t("active_lso_report.title")}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t("active_lso_report.subtitle")}</p>
          {period && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">
              {t("active_lso_report.period", { start: period.start_date, end: period.end_date })}
              {" · "}
              {t("active_lso_report.days_elapsed")}: {period.days_elapsed}/{period.total_days}
              {" · "}
              {t("active_lso_report.days_remaining")}: {period.days_remaining}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasPermission("active_lso.export") && (
            <>
              <button
                onClick={() => handleExport("xlsx")}
                disabled={exporting !== null || !data}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg text-sm font-semibold shadow-sm transition-colors"
              >
                <FileSpreadsheet className="w-4 h-4" />
                {exporting === "xlsx" ? "..." : t("active_lso_report.actions.export_excel")}
              </button>
              <button
                onClick={() => handleExport("csv")}
                disabled={exporting !== null || !data}
                className="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-800 rounded-lg text-sm font-semibold shadow-sm transition-colors disabled:opacity-50"
              >
                <FileText className="w-4 h-4" />
                {exporting === "csv" ? "..." : t("active_lso_report.actions.export_csv")}
              </button>
            </>
          )}
          {hasPermission("active_lso.print") && (
            <button
              onClick={handlePrint}
              disabled={!data}
              className="inline-flex items-center gap-2 p-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-800 rounded-lg shadow-sm transition-colors disabled:opacity-50"
              title={t("active_lso_report.actions.print")}
            >
              <Printer className="w-4 h-4" />
            </button>
          )}
          {hasPermission("active_lso.config") && (
            <button
              onClick={openConfig}
              className="inline-flex items-center gap-2 p-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-800 rounded-lg shadow-sm transition-colors"
              title={t("active_lso_report.config.title")}
            >
              <Settings className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => fetchData(filters)}
            disabled={loading}
            className="inline-flex items-center gap-2 p-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-800 rounded-lg shadow-sm transition-colors disabled:opacity-50"
            title={t("active_lso_report.actions.refresh")}
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="print:hidden bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3 text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
          <Filter className="w-3.5 h-3.5" />
          {t("active_lso_report.filters.apply")}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {filterOptions && filterOptions.houses.length > 1 && !lockedHouse && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("active_lso_report.filters.house")}</label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <select value={filters.houseId} onChange={(e) => updateFilter({ houseId: e.target.value })} className={selectClass}>
                  <option value="">{t("active_lso_report.filters.all")}</option>
                  {filterOptions.houses.map((h) => (
                    <option key={h.id} value={h.id}>{h.name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {showManager && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("active_lso_report.filters.manager")}</label>
              <div className="relative">
                <UserCog className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <select value={filters.managerId} onChange={(e) => handleManagerChange(e.target.value)} className={selectClass}>
                  <option value="">{t("active_lso_report.filters.all")}</option>
                  {filterOptions?.managers.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {filterOptions && filterOptions.supervisors.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("active_lso_report.filters.supervisor")}</label>
              <div className="relative">
                <UserRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <select
                  value={filters.supervisorId}
                  onChange={(e) => updateFilter({ supervisorId: e.target.value })}
                  disabled={lockedSupervisor}
                  className={selectClass}
                >
                  <option value="">{t("active_lso_report.filters.all")}</option>
                  {filterOptions.supervisors.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {filterOptions && filterOptions.rsos.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("active_lso_report.filters.rso")}</label>
              <div className="relative">
                <Users className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <select
                  value={filters.rsoId}
                  onChange={(e) => updateFilter({ rsoId: e.target.value })}
                  disabled={lockedRso}
                  className={selectClass}
                >
                  <option value="">{t("active_lso_report.filters.all")}</option>
                  {filterOptions.rsos.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {filterOptions && filterOptions.statuses.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("active_lso_report.filters.status")}</label>
              <div className="relative">
                <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <select value={filters.status} onChange={(e) => updateFilter({ status: e.target.value })} className={selectClass}>
                  <option value="">{t("active_lso_report.filters.all")}</option>
                  {filterOptions.statuses.map((s) => (
                    <option key={s} value={s}>{t(`active_lso_report.status.${s}`)}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("active_lso_report.filters.month")}</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <select
                value={filters.month}
                onChange={(e) => updateFilter({ month: Number(e.target.value) })}
                className={selectClass}
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>{getMonthName(m)}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("active_lso_report.filters.year")}</label>
            <select
              value={filters.year}
              onChange={(e) => updateFilter({ year: Number(e.target.value) })}
              className="px-3 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg text-sm font-medium text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary-500"
            >
              {Array.from({ length: 5 }, (_, i) => today.getFullYear() - 2 + i).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("active_lso_report.filters.start_date")}</label>
            <input
              type="date"
              value={filters.startDate}
              onChange={(e) => updateFilter({ startDate: e.target.value })}
              className="px-3 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg text-sm font-medium text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("active_lso_report.filters.end_date")}</label>
            <input
              type="date"
              value={filters.endDate}
              onChange={(e) => updateFilter({ endDate: e.target.value })}
              className="px-3 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg text-sm font-medium text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchData(filters)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-semibold shadow-sm transition-colors"
            >
              <Filter className="w-4 h-4" />
              {t("active_lso_report.filters.apply")}
            </button>
            <button
              onClick={handleReset}
              className="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-800 rounded-lg text-sm font-semibold shadow-sm transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              {t("active_lso_report.filters.reset")}
            </button>
          </div>
        </div>
        {period && (
          <p className="mt-3 text-[11px] text-gray-400 dark:text-gray-500">
            {t("active_lso_report.threshold_note", {
              days: period.active_threshold_days,
              amount: period.active_threshold_amount.toLocaleString(),
            })}
            {lastUpdated && (
              <>
                {" · "}
                {t("active_lso_report.messages.last_updated", {
                  time: lastUpdated.toLocaleTimeString(language === "bn" ? "bn-BD" : "en-US", { hour: "2-digit", minute: "2-digit" }),
                })}
              </>
            )}
          </p>
        )}
      </div>

      {/* Error */}
      {error && !loading && (
        <div className="flex items-center gap-3 p-4 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-xl text-sm text-rose-700 dark:text-rose-400">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          {t("active_lso_report.messages.error")}
        </div>
      )}

      {/* Loading */}
      {loading && !data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => <SkeletonKpiCard key={i} />)}
          </div>
          <div className="animate-pulse bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm p-6">
            <div className="h-4 w-44 bg-gray-200 dark:bg-slate-700 rounded-md mb-4" />
            <div className="h-40 bg-gray-100 dark:bg-slate-800 rounded-lg" />
          </div>
          <SkeletonTable />
        </>
      )}

      {/* Sections */}
      {!loading && !error && data && (
        <>
          {summary && period && (
            <>
              {/* Summary KPI Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard
                  icon={TargetIcon}
                  label={t("active_lso_report.cards.monthly_target")}
                  value={formatNumber(summary.target)}
                  valueColor="text-gray-900 dark:text-gray-100"
                  subtitle={`${formatNumber(summary.rso_count)} ${t("active_lso_report.summary.rso_count")}`}
                />
                <KpiCard
                  icon={TrendingUp}
                  label={t("active_lso_report.cards.achievement")}
                  value={formatNumber(summary.achieved)}
                  valueColor="text-emerald-600 dark:text-emerald-400"
                  subtitle={`${formatNumber(summary.retailer_count)} ${t("active_lso_report.summary.retailer_count")}`}
                />
                <KpiCard
                  icon={Award}
                  label={t("active_lso_report.cards.achievement_pct")}
                  value={`${summary.ach_pct}%`}
                  valueColor={
                    summary.ach_pct >= 100 ? "text-emerald-600 dark:text-emerald-400" :
                    summary.ach_pct >= 70 ? "text-blue-600 dark:text-blue-400" :
                    summary.ach_pct >= 40 ? "text-amber-600 dark:text-amber-400" :
                    "text-rose-600 dark:text-rose-400"
                  }
                  subtitle={<StatusBadge status={summary.status} />}
                />
                <KpiCard
                  icon={BarChart3}
                  label={t("active_lso_report.cards.remaining")}
                  value={formatNumber(summary.remaining)}
                  valueColor="text-amber-600 dark:text-amber-400"
                  subtitle={t("active_lso_report.days_remaining") + ": " + period.days_remaining}
                />
                <KpiCard
                  icon={Activity}
                  label={t("active_lso_report.cards.daily_average")}
                  value={formatNumber(summary.daily_avg)}
                  valueColor="text-blue-600 dark:text-blue-400"
                  subtitle={t("active_lso_report.days_elapsed") + ": " + period.days_elapsed}
                />
                <KpiCard
                  icon={Zap}
                  label={t("active_lso_report.cards.daily_required")}
                  value={formatNumber(summary.drr)}
                  valueColor="text-purple-600 dark:text-purple-400"
                  subtitle={t("active_lso_report.cards.per_day")}
                />
                <KpiCard
                  icon={Trophy}
                  label={t("active_lso_report.cards.projection")}
                  value={formatNumber(Math.round(summary.projection))}
                  valueColor="text-amber-600 dark:text-amber-400"
                  subtitle={t("active_lso_report.cards.expected_pct") + ": " + (summary.target > 0 ? Math.round((summary.projection / summary.target) * 100) : 0) + "%"}
                />
                <KpiCard
                  icon={Sparkles}
                  label={t("active_lso_report.cards.expected_pct")}
                  value={(summary.target > 0 ? Math.round((summary.projection / summary.target) * 100) : 0) + "%"}
                  valueColor="text-amber-600 dark:text-amber-400"
                  subtitle={`${formatNumber(Math.round(summary.projection))} / ${formatNumber(summary.target)}`}
                />
              </div>

              {/* Target vs Achievement */}
              <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm p-6">
                <h2 className="font-bold text-base flex items-center gap-2 dark:text-gray-100 mb-4">
                  <PieChartIcon className="w-5 h-5 text-primary-600 dark:text-primary-400" />
                  {t("active_lso_report.cards.target_vs_achievement")}
                </h2>
                <div className="space-y-6">
                  <div className="text-center">
                    <p className="text-4xl font-black text-gray-900 dark:text-gray-100">{summary.ach_pct}%</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t("active_lso_report.cards.achievement_pct")}</p>
                    {(() => {
                      const st = projectionStatus(summary.ach_pct, summary.target > 0 ? Math.round((summary.projection / summary.target) * 100) : 0);
                      const statusText: Record<string, string> = {
                        achieved: t("active_lso_report.status.achieved"),
                        on_track: t("active_lso_report.status.on_track"),
                        needs_attention: t("active_lso_report.status.needs_attention"),
                        behind: t("active_lso_report.status.behind"),
                      };
                      const statusTxtColor: Record<string, string> = {
                        achieved: "text-emerald-600 dark:text-emerald-400",
                        on_track: "text-blue-600 dark:text-blue-400",
                        needs_attention: "text-amber-600 dark:text-amber-400",
                        behind: "text-rose-600 dark:text-rose-400",
                      };
                      const statusIconColor: Record<string, string> = {
                        achieved: "text-emerald-600 dark:text-emerald-400",
                        on_track: "text-blue-600 dark:text-blue-400",
                        needs_attention: "text-amber-600 dark:text-amber-400",
                        behind: "text-rose-600 dark:text-rose-400",
                      };
                      return (
                        <div className="grid grid-cols-2 gap-3 pt-2">
                          <div className="bg-gray-50 dark:bg-slate-800/50 rounded-lg p-3 text-center">
                            <TrendingUp className={`w-6 h-6 mx-auto mt-1 ${statusIconColor[st]}`} />
                            <p className={`text-lg font-black mt-1 ${statusTxtColor[st]}`}>{statusText[st]}</p>
                          </div>
                          <div className="bg-gray-50 dark:bg-slate-800/50 rounded-lg p-3 text-center">
                            <p className="text-xs text-gray-500 dark:text-gray-400">{t("active_lso_report.cards.eta_days")}</p>
                            <Clock className="w-6 h-6 mx-auto mt-1 text-rose-600 dark:text-rose-400" />
                            <p className="text-lg font-black text-rose-600 dark:text-rose-400">{period.days_remaining}</p>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                  <div className="space-y-3">
                    <div>
                      <div className="flex justify-between text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                        <span>{t("active_lso_report.cards.achievement")}</span>
                        <span>{formatNumber(summary.achieved)} / {formatNumber(summary.target)}</span>
                      </div>
                      <div className="h-3 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-700",
                            summary.ach_pct >= 100 ? "bg-emerald-500" :
                            summary.ach_pct >= 70 ? "bg-blue-500" :
                            summary.ach_pct >= 40 ? "bg-amber-500" : "bg-rose-500"
                          )}
                          style={{ width: `${Math.min(summary.ach_pct, 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Top Performers Leaderboard */}
              {(() => {
                const topRso = [...rows].sort((a, b) => b.ach_pct - a.ach_pct).slice(0, 5)
                  .map((r) => ({ name: r.name, achieved: r.achieved, target: r.target, ach_pct: r.ach_pct }));
                const topSup = [...supSummary].sort((a, b) => b.ach_pct - a.ach_pct).slice(0, 5)
                  .map((s) => ({ name: s.supervisor_name, achieved: s.achieved, target: s.target, ach_pct: s.ach_pct }));
                const cards = [
                  topRso.length > 0 ? { data: topRso, title: t("active_lso_report.cards.rso_performance"), icon: Users, color: "bg-blue-500" } : null,
                  topSup.length > 0 ? { data: topSup, title: t("active_lso_report.cards.supervisor_performance"), icon: UserRound, color: "bg-purple-500" } : null,
                ].filter(Boolean) as Array<{ data: Array<{ name: string; achieved: number; target: number; ach_pct: number }>; title: string; icon: LucideIcon; color: string }>;
                if (cards.length === 0) return null;
                return (
                  <div>
                    <h2 className="font-bold text-base flex items-center gap-2 dark:text-gray-100 mb-4">
                      <Medal className="w-5 h-5 text-amber-500" />
                      {t("active_lso_report.cards.top_performers")}
                    </h2>
                    <div className={`grid grid-cols-1 ${cards.length === 2 ? "md:grid-cols-1 lg:grid-cols-2" : ""} gap-4`}>
                      {cards.map((c) => (
                        <LeaderboardCard key={c.title} data={c.data} title={c.title} icon={c.icon} color={c.color} t={t} subtitleKey="" />
                      ))}
                    </div>
                  </div>
                );
              })()}
            </>
          )}

          {/* Section A + B */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <TargetIcon className="w-4 h-4 text-primary-600 dark:text-primary-400" />
                <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                  {t("active_lso_report.section_a")} · {t("active_lso_report.section_b")}
                </h2>
              </div>
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {formatNumber(summary?.rso_count ?? 0)} {t("active_lso_report.summary.rso_count")} · {formatNumber(summary?.retailer_count ?? 0)} {t("active_lso_report.summary.retailer_count")}
              </span>
            </div>

            {rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Inbox className="w-10 h-10 text-gray-300 dark:text-gray-600 mb-3" />
                <p className="text-sm text-gray-500 dark:text-gray-400">{t("active_lso_report.messages.no_data")}</p>
              </div>
            ) : (
              <div className="overflow-auto max-h-[70vh] border-t border-gray-100 dark:border-slate-800">
                <table className="w-full text-xs text-gray-700 dark:text-gray-300 border-separate border-spacing-0 whitespace-nowrap">
                  <thead>
                    <tr>
                      <th rowSpan={2} className="sticky top-0 left-0 z-40 h-9 px-3 bg-slate-100 dark:bg-slate-800 text-left font-bold text-gray-600 dark:text-gray-300 border-b border-r border-gray-200 dark:border-slate-700">
                        {t("active_lso_report.columns.rso")}
                      </th>
                      <th rowSpan={2} className="sticky top-0 z-30 h-9 px-3 bg-slate-100 dark:bg-slate-800 text-left font-bold text-gray-600 dark:text-gray-300 border-b border-r border-gray-200 dark:border-slate-700">
                        {t("active_lso_report.columns.supervisor")}
                      </th>
                      <th colSpan={A_COL_KEYS.length} className="sticky top-0 z-30 h-9 px-3 bg-slate-100 dark:bg-slate-800 text-center font-bold text-gray-600 dark:text-gray-300 border-b border-r border-gray-200 dark:border-slate-700">
                        {t("active_lso_report.section_a")}
                      </th>
                      <th colSpan={B_COL_KEYS.length} className="sticky top-0 z-30 h-9 px-3 bg-slate-100 dark:bg-slate-800 text-center font-bold text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-slate-700">
                        {t("active_lso_report.section_b")}
                      </th>
                    </tr>
                    <tr>
                      {A_COL_KEYS.map((k) => (
                        <th key={k} className="sticky top-9 z-20 h-9 px-2 bg-slate-100 dark:bg-slate-800 text-center font-semibold text-gray-500 dark:text-gray-400 border-b border-r border-gray-200 dark:border-slate-700">
                          {t(`active_lso_report.columns.${k}`)}
                        </th>
                      ))}
                      {B_COL_KEYS.map((k) => (
                        <th key={k} className="sticky top-9 z-20 h-9 px-2 bg-slate-100 dark:bg-slate-800 text-center font-semibold text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-slate-700">
                          {t(`active_lso_report.columns.${k}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => (
                      <tr key={row.employee_id} className={idx % 2 === 1 ? "bg-gray-50/50 dark:bg-slate-800/30" : ""}>
                        <td className="sticky left-0 z-10 px-3 py-1.5 font-medium text-gray-900 dark:text-gray-100 border-b border-r border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900">
                          <p className="font-medium text-xs">{row.name}</p>
                          <p className="text-[11px] text-gray-400 dark:text-gray-500">
                            {row.dms_code || "—"}
                            {(row.dms_code || "—") && row.itop_number && (
                              <span className="text-gray-300 dark:text-gray-600"> · </span>
                            )}
                            {row.itop_number || ""}
                          </p>
                        </td>
                        <td className="px-3 py-1.5 border-b border-r border-gray-100 dark:border-slate-800">
                          <p className="font-medium">{row.supervisor_name || "—"}</p>
                          <p className="text-[11px] text-gray-400 dark:text-gray-500">{formatNumber(row.retailer_count)}</p>
                        </td>
                        {A_COL_KEYS.map((k) => (
                          <td key={k} className="px-2 py-1.5 text-center border-b border-r border-gray-100 dark:border-slate-800">
                            {renderACell(row, k)}
                          </td>
                        ))}
                        {B_COL_KEYS.map((k) => (
                          <td key={k} className={cn("px-2 py-1.5 text-center border-b border-gray-100 dark:border-slate-800", k === "days_no_sales" || k === "inactive_last_month" || k === "reactivated" ? "bg-amber-50/40 dark:bg-amber-500/5" : "")}>
                            {renderCountCell(row.retailer_counts, k, row.retailer_count)}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {/* Grand total */}
                    <tr className="bg-slate-100 dark:bg-slate-800">
                      <td className="sticky left-0 z-10 px-3 py-2 font-bold text-gray-900 dark:text-gray-100 bg-slate-100 dark:bg-slate-800 border-t-2 border-gray-300 dark:border-slate-600 border-r">
                        {t("active_lso_report.summary.grand_total")}
                      </td>
                      <td className="px-3 py-2 font-bold text-gray-900 dark:text-gray-100 border-t-2 border-gray-300 dark:border-slate-600 border-r">
                        {formatNumber(summary?.rso_count ?? 0)} {t("active_lso_report.summary.rso_count")}
                      </td>
                      {A_COL_KEYS.map((k) => (
                        <td key={k} className="px-2 py-2 text-center font-bold text-gray-900 dark:text-gray-100 border-t-2 border-gray-300 dark:border-slate-600 border-r">
                          {renderTotalCell(k)}
                        </td>
                      ))}
                      {B_COL_KEYS.map((k) => (
                        <td key={k} className="px-2 py-2 text-center font-bold text-gray-900 dark:text-gray-100 border-t-2 border-gray-300 dark:border-slate-600">
                          {renderTotalCell(k)}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Section C */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100 dark:border-slate-800">
              <Users className="w-4 h-4 text-primary-600 dark:text-primary-400" />
              <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">{t("active_lso_report.section_c")}</h2>
            </div>
            {supSummary.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <Inbox className="w-10 h-10 text-gray-300 dark:text-gray-600 mb-3" />
                <p className="text-sm text-gray-500 dark:text-gray-400">{t("active_lso_report.messages.no_data")}</p>
              </div>
            ) : (
              <div className="overflow-auto max-h-[60vh]">
                <table className="w-full text-xs text-gray-700 dark:text-gray-300 border-separate border-spacing-0 whitespace-nowrap">
                  <thead>
                    <tr>
                      <th className="sticky top-0 z-20 h-9 px-3 bg-slate-100 dark:bg-slate-800 text-left font-bold text-gray-600 dark:text-gray-300 border-b border-r border-gray-200 dark:border-slate-700">
                        {t("active_lso_report.summary.supervisor_name")}
                      </th>
                      <th className="sticky top-0 z-20 h-9 px-2 bg-slate-100 dark:bg-slate-800 text-center font-semibold text-gray-500 dark:text-gray-400 border-b border-r border-gray-200 dark:border-slate-700">
                        {t("active_lso_report.summary.rso_count")}
                      </th>
                      <th className="sticky top-0 z-20 h-9 px-2 bg-slate-100 dark:bg-slate-800 text-center font-semibold text-gray-500 dark:text-gray-400 border-b border-r border-gray-200 dark:border-slate-700">
                        {t("active_lso_report.summary.retailer_count")}
                      </th>
                      {A_COL_KEYS.map((k) => (
                        <th key={k} className="sticky top-0 z-20 h-9 px-2 bg-slate-100 dark:bg-slate-800 text-center font-semibold text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-slate-700">
                          {t(`active_lso_report.columns.${k}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {supSummary.map((s, idx) => (
                      <tr key={s.supervisor_id ?? idx} className={idx % 2 === 1 ? "bg-gray-50/50 dark:bg-slate-800/30" : ""}>
                        <td className="px-3 py-1.5 font-medium text-gray-900 dark:text-gray-100 border-b border-r border-gray-100 dark:border-slate-800">{s.supervisor_name}</td>
                        <td className="px-2 py-1.5 text-center border-b border-r border-gray-100 dark:border-slate-800">{formatNumber(s.rso_count)}</td>
                        <td className="px-2 py-1.5 text-center border-b border-r border-gray-100 dark:border-slate-800">{formatNumber(s.retailer_count)}</td>
                        {A_COL_KEYS.map((k) => (
                          <td key={k} className="px-2 py-1.5 text-center border-b border-gray-100 dark:border-slate-800">
                            {renderACell(s, k)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Active LSO Config Modal */}
      {showConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setShowConfig(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-50 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary-50 dark:bg-primary-500/10 flex items-center justify-center">
                  <Settings className="w-5 h-5 text-primary-600 dark:text-primary-400" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-gray-900 dark:text-gray-100">{t("active_lso_report.config.title")}</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {getMonthName(filters.month)} {filters.year}
                    {filters.houseId && filterOptions ? ` · ${filterOptions.houses.find((h) => String(h.id) === filters.houseId)?.name ?? ""}` : ""}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowConfig(false)}
                className="w-8 h-8 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 flex items-center justify-center transition-colors"
              >
                <XIcon className="w-4 h-4 text-gray-400" />
              </button>
            </div>

            {configLoading ? (
              <div className="p-5 space-y-4 animate-pulse">
                <div className="h-3 w-40 bg-gray-200 dark:bg-slate-700 rounded-md" />
                <div className="h-11 w-full bg-gray-200 dark:bg-slate-700 rounded-lg" />
                <div className="h-3 w-32 bg-gray-200 dark:bg-slate-700 rounded-md" />
                <div className="h-11 w-full bg-gray-200 dark:bg-slate-700 rounded-lg" />
              </div>
            ) : (
              <>
                <div className="p-5 space-y-4">
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">{t("active_lso_report.config.desc")}</p>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                      {t("active_lso_report.config.days")}
                      {!configIsCustom && (
                        <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-800 text-gray-400 dark:text-gray-500 font-medium">
                          {t("active_lso_report.config.default_badge")}
                        </span>
                      )}
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={configForm.days}
                      onChange={(e) => setConfigForm((f) => ({ ...f, days: e.target.value }))}
                      className="w-full min-h-[44px] px-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">{t("active_lso_report.config.amount")}</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={configForm.amount}
                      onChange={(e) => setConfigForm((f) => ({ ...f, amount: e.target.value }))}
                      className="w-full min-h-[44px] px-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                    />
                  </div>
                </div>
                <div className="px-5 py-4 border-t border-gray-100 dark:border-slate-800 flex items-center justify-end gap-2">
                  <button
                    onClick={() => setShowConfig(false)}
                    className="px-4 min-h-[44px] rounded-xl border border-gray-200 dark:border-slate-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    onClick={saveConfig}
                    disabled={savingConfig}
                    className="inline-flex items-center gap-2 px-4 min-h-[44px] rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
                  >
                    {savingConfig ? t("active_lso_report.config.saving") : t("active_lso_report.config.save")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
