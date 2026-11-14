"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { AccessDenied } from "@/components/ui/AccessDenied";
import PageGuideModal from "@/components/PageGuideModal";
import EntitySelector from "@/app/zoom-in/_components/EntitySelector";
import {
  DateRangePicker,
  formatYMD,
  startOfMonth,
  todayYMD,
} from "@/components/date-picker";
import { useLanguage } from "@/i18n/useLanguage";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import {
  Activity,
  Building2,
  ChevronDown,
  Download,
  Filter,
  Inbox,
  RefreshCw,
  RotateCcw,
  Search,
  Store,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

// ------------------------------------------------------------------ types

interface HouseOption {
  id: number;
  name: string;
  code: string;
}

interface EmployeeOption {
  id: number;
  name: string;
  code?: string | null;
  dms_code?: string | null;
  employee_type: string;
  supervisor_name?: string | null;
}

interface ProductOption {
  code: string;
  name?: string | null;
  count: number;
}

interface PromotionOption {
  value: string;
  count: number;
}

interface FilterOptions {
  houses: HouseOption[];
  employees: EmployeeOption[];
  products: ProductOption[];
  promotions: PromotionOption[];
  defaults: { house_id?: number; employee_ids?: number[] };
  role_mode: string;
}

interface Filters {
  houseId: string;
  startDate: string;
  endDate: string;
  employeeIds: string[];
  productCodes: string[];
  promotions: string[];
  search: string;
}

interface DailyPoint {
  date: string;
  sims: number;
  retailers: number;
}

interface SummaryRow {
  employee_id: number | null;
  name: string;
  code: string | null;
  dms_code: string | null;
  employee_type: string;
  supervisor_id: number | null;
  supervisor_name: string | null;
  retailers_total: number;
  retailers_issued: number;
  retailers_pending: number;
  sims: number;
  coverage_pct: number;
  last_issue_date: string | null;
  daily: DailyPoint[];
}

interface SummaryTotals {
  sims: number;
  retailers_total: number;
  retailers_issued: number;
  retailers_pending: number;
  coverage_pct: number;
  employees: number;
  days_with_data: number;
}

interface SummaryData {
  period: { start_date: string; end_date: string; total_days: number; today: string };
  totals: SummaryTotals;
  rows: SummaryRow[];
  daily_totals: DailyPoint[];
}

interface RetailerRow {
  retailer_code: string;
  name: string;
  itop_number: string | null;
  employee_id: number | null;
  employee_name: string | null;
  employee_type: string | null;
  supervisor_name: string | null;
  status: "issued" | "pending";
  sim_count: number;
  first_issue_date: string | null;
  last_issue_date: string | null;
}

interface RetailersData {
  total: number;
  issued: number;
  pending: number;
  page: number;
  per_page: number;
  rows: RetailerRow[];
}

interface DetailRow {
  id: number;
  issue_date: string | null;
  retailer_code: string | null;
  retailer_name: string | null;
  product_code: string | null;
  product_name: string | null;
  promotion: string | null;
  sim_no: string | null;
  selling_price: number | null;
  cluster_market: string | null;
  distributor_name: string | null;
  employee_id: number | null;
  employee_name: string | null;
  employee_type: string | null;
}

interface DetailsData {
  total: number;
  page: number;
  per_page: number;
  rows: DetailRow[];
}

type Tab = "summary" | "daily" | "retailers" | "details";
type ListStatus = "all" | "issued" | "pending";

// ------------------------------------------------------------------ helpers

const TYPE_STYLES: Record<string, string> = {
  rso: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300",
  bp: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  supervisor: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300",
  unassigned: "bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-gray-400",
};

function coverageColor(pct: number): string {
  if (pct >= 80) return "text-emerald-600 dark:text-emerald-400";
  if (pct >= 40) return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

function TypeBadge({ type, label }: { type: string | null | undefined; label: string }) {
  const key = (type || "unassigned").toLowerCase();
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        TYPE_STYLES[key] || TYPE_STYLES.unassigned
      )}
    >
      {label}
    </span>
  );
}

function StatusBadge({
  status,
  issuedLabel,
  pendingLabel,
}: {
  status: "issued" | "pending";
  issuedLabel: string;
  pendingLabel: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        status === "issued"
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
          : "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300"
      )}
    >
      {status === "issued" ? issuedLabel : pendingLabel}
    </span>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  sub?: string;
  tone: string;
}) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 p-4 sm:p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            {label}
          </p>
          <p className="text-2xl font-black tracking-tight text-gray-900 dark:text-gray-100 mt-1">
            {value}
          </p>
          {sub && (
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1 truncate">
              {sub}
            </p>
          )}
        </div>
        <div className={cn("p-2 rounded-lg shrink-0", tone)}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </div>
  );
}

function SkeletonKpi() {
  return (
    <div className="animate-pulse bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 p-5 shadow-sm">
      <div className="h-3 w-24 bg-gray-200 dark:bg-slate-700 rounded-md mb-3" />
      <div className="h-7 w-32 bg-gray-200 dark:bg-slate-700 rounded-md mb-2" />
      <div className="h-2.5 w-20 bg-gray-100 dark:bg-slate-800 rounded-md" />
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
        <div
          key={i}
          className="flex items-center gap-4 px-5 py-4 border-b border-gray-50 dark:border-slate-800"
        >
          <div className="h-3 w-36 bg-gray-200 dark:bg-slate-700 rounded-md" />
          <div className="h-3 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
          {Array.from({ length: 6 }).map((_, j) => (
            <div key={j} className="hidden sm:block h-3 w-12 bg-gray-100 dark:bg-slate-800 rounded-md" />
          ))}
        </div>
      ))}
    </div>
  );
}

function EmptyState({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
      <div className="p-3 rounded-xl bg-gray-50 dark:bg-slate-800 mb-3">
        <Icon className="w-6 h-6 text-gray-400 dark:text-gray-500" />
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400">{text}</p>
    </div>
  );
}

function Pager({
  page,
  perPage,
  total,
  onPrev,
  onNext,
  showing,
  prev,
  next,
}: {
  page: number;
  perPage: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  showing: string;
  prev: string;
  next: string;
}) {
  const end = Math.min(page * perPage, total);
  const start = total === 0 ? 0 : (page - 1) * perPage + 1;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-gray-100 dark:border-slate-800 text-xs text-gray-500 dark:text-gray-400">
      <span>{showing.replace("{start}", String(start)).replace("{end}", String(end)).replace("{total}", String(total))}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onPrev}
          disabled={page <= 1}
          className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 font-semibold hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {prev}
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={end >= total}
          className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 font-semibold hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {next}
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ page

export default function SimIssuesReportPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const { t, language } = useLanguage();

  const [options, setOptions] = useState<FilterOptions | null>(null);
  const [filters, setFilters] = useState<Filters>({
    houseId: "",
    startDate: "",
    endDate: "",
    employeeIds: [],
    productCodes: [],
    promotions: [],
    search: "",
  });
  const [applied, setApplied] = useState<Filters>(filters);
  const [refreshTick, setRefreshTick] = useState(0);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [filtersReady, setFiltersReady] = useState(false);

  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [error, setError] = useState(false);

  const [tab, setTab] = useState<Tab>("summary");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [expandedCode, setExpandedCode] = useState<string | null>(null);

  const [retailerStatus, setRetailerStatus] = useState<ListStatus>("all");
  const [retailerPage, setRetailerPage] = useState(1);
  const [retailers, setRetailers] = useState<RetailersData | null>(null);
  const [loadingRetailers, setLoadingRetailers] = useState(false);

  const [detailPage, setDetailPage] = useState(1);
  const [details, setDetails] = useState<DetailsData | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const [exporting, setExporting] = useState(false);

  const [drill, setDrill] = useState<{
    open: boolean;
    employeeId: number | null;
    employeeName: string;
    status: ListStatus;
    page: number;
    data: RetailersData | null;
    loading: boolean;
  }>({ open: false, employeeId: null, employeeName: "", status: "all", page: 1, data: null, loading: false });

  const [drawer, setDrawer] = useState<{
    open: boolean;
    code: string;
    name: string;
    page: number;
    data: DetailsData | null;
    loading: boolean;
  }>({ open: false, code: "", name: "", page: 1, data: null, loading: false });

  const formatNum = useCallback(
    (n: number | null | undefined) =>
      Number(n ?? 0).toLocaleString(language === "bn" ? "bn-BD" : "en-US"),
    [language]
  );

  const typeLabel = (type: string | null | undefined) => {
    const key = (type || "unassigned").toLowerCase();
    if (!["rso", "bp", "supervisor", "unassigned"].includes(key)) {
      return key.toUpperCase();
    }
    return t(`sim_issue_report.badges.${key}`);
  };

  const buildParams = useCallback((f: Filters) => {
    const p: Record<string, string> = {
      start_date: f.startDate,
      end_date: f.endDate,
    };
    if (f.houseId) p.house_id = f.houseId;
    if (f.employeeIds.length) p.employee_ids = f.employeeIds.join(",");
    if (f.productCodes.length) p.product_codes = f.productCodes.join(",");
    if (f.promotions.length) p.promotions = f.promotions.join(",");
    if (f.search.trim()) p.search = f.search.trim();
    return p;
  }, []);

  const appliedKey = useMemo(() => JSON.stringify(applied), [applied]);

  // ------------------------------------------------------------ bootstrap

  useEffect(() => {
    if (authLoading || !hasPermission("sim_issues.view") || bootstrapped) return;
    setBootstrapped(true);
    const today = todayYMD();
    apiClient
      .get("sim-issues/report/filters")
      .then((res) => {
        const opts = res.data as FilterOptions;
        setOptions(opts);
        // No house is selected by default: a multi-house user must choose one
        // explicitly. Only a single-house account can be pinned automatically.
        const next: Filters = {
          houseId: opts.houses.length === 1 ? String(opts.houses[0].id) : "",
          startDate: startOfMonth(today),
          endDate: today,
          employeeIds: (opts.defaults?.employee_ids || []).map(String),
          productCodes: [],
          promotions: [],
          search: "",
        };
        setFilters(next);
        setApplied(next);
        setFiltersReady(true);
      })
      .catch(() => {
        setError(true);
        setLoadingSummary(false);
        setFiltersReady(true);
        toast.error(t("sim_issue_report.messages.load_failed"));
      });
  }, [authLoading, hasPermission, bootstrapped, t]);

  // --------------------------------------------------------------- summary

  useEffect(() => {
    if (!applied.houseId || !applied.startDate || !applied.endDate) {
      if (filtersReady) setLoadingSummary(false);
      return;
    }
    let cancelled = false;
    setLoadingSummary(true);
    setError(false);
    apiClient
      .get("sim-issues/report/summary", { params: buildParams(applied) })
      .then((res) => {
        if (!cancelled) setSummary(res.data as SummaryData);
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
          toast.error(t("sim_issue_report.messages.load_failed"));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingSummary(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appliedKey, refreshTick, buildParams, applied, t, filtersReady]);

  // ------------------------------------------------------------- retailers

  useEffect(() => {
    if (tab !== "retailers" || !applied.houseId) return;
    let cancelled = false;
    setLoadingRetailers(true);
    apiClient
      .get("sim-issues/report/retailers", {
        params: {
          ...buildParams(applied),
          status: retailerStatus,
          page: retailerPage,
          per_page: 20,
        },
      })
      .then((res) => {
        if (!cancelled) setRetailers(res.data as RetailersData);
      })
      .catch(() => {
        if (!cancelled) toast.error(t("sim_issue_report.messages.load_failed"));
      })
      .finally(() => {
        if (!cancelled) setLoadingRetailers(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, appliedKey, refreshTick, retailerPage, retailerStatus, buildParams, applied, t]);

  // --------------------------------------------------------------- details

  useEffect(() => {
    if (tab !== "details" || !applied.houseId) return;
    let cancelled = false;
    setLoadingDetails(true);
    apiClient
      .get("sim-issues/report/details", {
        params: { ...buildParams(applied), page: detailPage, per_page: 50 },
      })
      .then((res) => {
        if (!cancelled) setDetails(res.data as DetailsData);
      })
      .catch(() => {
        if (!cancelled) toast.error(t("sim_issue_report.messages.load_failed"));
      })
      .finally(() => {
        if (!cancelled) setLoadingDetails(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, appliedKey, refreshTick, detailPage, buildParams, applied, t]);

  // ------------------------------------------------------------ drill modal

  useEffect(() => {
    if (!drill.open || !drill.employeeId || !applied.houseId) return;
    let cancelled = false;
    setDrill((d) => ({ ...d, loading: true }));
    apiClient
      .get("sim-issues/report/retailers", {
        params: {
          ...buildParams(applied),
          employee_id: drill.employeeId,
          status: drill.status,
          page: drill.page,
          per_page: 10,
        },
      })
      .then((res) => {
        if (!cancelled) setDrill((d) => ({ ...d, data: res.data as RetailersData, loading: false }));
      })
      .catch(() => {
        if (!cancelled) {
          setDrill((d) => ({ ...d, loading: false }));
          toast.error(t("sim_issue_report.messages.load_failed"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [drill.open, drill.employeeId, drill.status, drill.page, appliedKey, refreshTick, buildParams, applied, t]);

  // ---------------------------------------------------------- detail drawer

  useEffect(() => {
    if (!drawer.open || !drawer.code || !applied.houseId) return;
    let cancelled = false;
    setDrawer((d) => ({ ...d, loading: true }));
    apiClient
      .get("sim-issues/report/details", {
        params: {
          ...buildParams(applied),
          retailer_code: drawer.code,
          page: drawer.page,
          per_page: 20,
        },
      })
      .then((res) => {
        if (!cancelled) setDrawer((d) => ({ ...d, data: res.data as DetailsData, loading: false }));
      })
      .catch(() => {
        if (!cancelled) {
          setDrawer((d) => ({ ...d, loading: false }));
          toast.error(t("sim_issue_report.messages.load_failed"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [drawer.open, drawer.code, drawer.page, appliedKey, refreshTick, buildParams, applied, t]);

  useEffect(() => {
    if (!drill.open && !drawer.open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drill.open, drawer.open]);

  // ------------------------------------------------------------- handlers

  const updateFilter = (patch: Partial<Filters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  };

  const handleHouseChange = async (id: string) => {
    updateFilter({
      houseId: id,
      employeeIds: [],
      productCodes: [],
      promotions: [],
    });
    setOptions((prev) =>
      prev ? { ...prev, employees: [], products: [], promotions: [] } : prev
    );
    if (!id) return;
    try {
      const res = await apiClient.get("sim-issues/report/filters", {
        params: { house_id: id },
      });
      const opts = res.data as FilterOptions;
      setOptions((prev) => (prev ? { ...prev, ...opts, defaults: prev.defaults } : opts));
    } catch {
      toast.error(t("sim_issue_report.messages.load_failed"));
    }
  };

  const applyFilters = () => {
    if (!filters.houseId) {
      toast.error(t("sim_issue_report.messages.select_house"));
      return;
    }
    if (!filters.startDate || !filters.endDate) {
      toast.error(t("sim_issue_report.messages.select_range"));
      return;
    }
    setRetailerPage(1);
    setDetailPage(1);
    setExpandedId(null);
    setExpandedCode(null);
    setApplied({ ...filters });
  };

  const handleReset = () => {
    const today = todayYMD();
    const next: Filters = {
      houseId: filters.houseId,
      startDate: startOfMonth(today),
      endDate: today,
      employeeIds: [],
      productCodes: [],
      promotions: [],
      search: "",
    };
    setFilters(next);
    setRetailerPage(1);
    setDetailPage(1);
    setExpandedId(null);
    setExpandedCode(null);
    setApplied(next);
  };

  const refreshAll = () => setRefreshTick((n) => n + 1);

  const openDrill = (row: SummaryRow, status: ListStatus) => {
    if (!row.employee_id) return;
    setDrill({
      open: true,
      employeeId: row.employee_id,
      employeeName: row.name,
      status,
      page: 1,
      data: null,
      loading: true,
    });
  };

  const openDrawer = (code: string, name: string) => {
    setDrawer({ open: true, code, name, page: 1, data: null, loading: true });
  };

  const handleExport = async () => {
    if (!applied.houseId) return;
    setExporting(true);
    try {
      const view = tab === "details" ? "details" : tab === "retailers" ? "retailers" : "summary";
      const params: Record<string, string> = { ...buildParams(applied), view };
      if (view === "retailers") params.status = retailerStatus;
      const res = await apiClient.get("sim-issues/report/export", {
        params,
        responseType: "blob",
      });
      const blob = new Blob([res.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sim_issue_${view}_${applied.startDate.replaceAll("-", "")}_${applied.endDate.replaceAll("-", "")}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(t("sim_issue_report.messages.export_success"));
    } catch {
      toast.error(t("sim_issue_report.messages.export_failed"));
    } finally {
      setExporting(false);
    }
  };

  const dailyDates = useMemo(
    () => (summary?.daily_totals || []).map((d) => d.date),
    [summary]
  );

  const dayLabel = (iso: string) => {
    const date = new Date(`${iso}T00:00:00`);
    return date.toLocaleDateString(language === "bn" ? "bn-BD" : "en-GB", {
      day: "2-digit",
      month: "short",
    });
  };

  // --------------------------------------------------------------- render

  if (authLoading) return null;
  if (!hasPermission("sim_issues.view")) return <AccessDenied />;

  const roleMode = options?.role_mode || "admin";
  const canExport = hasPermission("sim_issues.export");
  const totals = summary?.totals;

  const employeeItems = (options?.employees || []).map((e) => ({
    id: String(e.id),
    label: e.name,
    sublabel: [e.code, e.supervisor_name].filter(Boolean).join(" · ") || undefined,
    badge: typeLabel(e.employee_type),
  }));

  const tabButton = (key: Tab, label: string) => (
    <button
      key={key}
      type="button"
      onClick={() => {
        setTab(key);
        setExpandedId(null);
        setExpandedCode(null);
      }}
      className={cn(
        "px-3 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap",
        tab === key
          ? "bg-primary-600 text-white shadow-sm"
          : "text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800"
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="p-4 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {t("sim_issue_report.title")}
            </h1>
            <PageGuideModal pageKey="sim_issue_report" />
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {t("sim_issue_report.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refreshAll}
            className="inline-flex items-center justify-center p-2.5 rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 shadow-sm transition-colors cursor-pointer"
            title={t("sim_issue_report.actions.refresh")}
            aria-label={t("sim_issue_report.actions.refresh")}
          >
            <RefreshCw className={cn("w-4 h-4", loadingSummary && "animate-spin")} />
          </button>
          {canExport && (
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting || !applied.houseId}
              className="inline-flex items-center gap-2 px-3 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold shadow-sm transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className={cn("w-4 h-4", exporting && "animate-pulse")} />
              <span className="hidden sm:inline">
                {exporting
                  ? t("sim_issue_report.actions.exporting")
                  : t("sim_issue_report.actions.export")}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm p-4 sm:p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <EntitySelector
            label={t("sim_issue_report.filters.house")}
            items={(options?.houses || []).map((h) => ({
              id: String(h.id),
              label: h.name,
              sublabel: h.code,
              badge: h.code,
            }))}
            selectedIds={filters.houseId ? [filters.houseId] : []}
            onChange={(ids) => handleHouseChange(String(ids[0] ?? ""))}
            placeholder={t("sim_issue_report.filters.house_placeholder")}
            searchPlaceholder={t("sim_issue_report.filters.house_search")}
            emptyMessage={t("sim_issue_report.filters.empty")}
            noResultsMessage={t("sim_issue_report.filters.no_results")}
            disabled={roleMode !== "admin" || !options}
            single
            closeOnSelect
            selectAllLabel={t("common.select_all")}
            clearLabel={t("common.clear")}
            selectedLabel={t("sim_issue_report.filters.selected")}
          />

          <div>
            <DateRangePicker
              label={t("sim_issue_report.filters.date_range")}
              value={{ from: filters.startDate || null, to: filters.endDate || null }}
              onChange={(range) =>
                updateFilter({
                  startDate: range.from ?? "",
                  endDate: range.to ?? "",
                })
              }
              max={todayYMD()}
              placeholder={t("common.date_range.placeholder")}
              selectEndDateLabel={t("common.date_range.select_end_date")}
              daysSelectedLabel={t("common.date_range.days_selected")}
            />
          </div>

          <EntitySelector
            label={t("sim_issue_report.filters.employees")}
            items={employeeItems}
            selectedIds={filters.employeeIds}
            onChange={(ids) => updateFilter({ employeeIds: ids.map(String) })}
            placeholder={t("sim_issue_report.filters.employees_placeholder")}
            searchPlaceholder={t("sim_issue_report.filters.employees_search")}
            emptyMessage={t("sim_issue_report.filters.empty")}
            noResultsMessage={t("sim_issue_report.filters.no_results")}
            disabled={!filters.houseId}
            selectAllLabel={t("common.select_all")}
            clearLabel={t("common.clear")}
            selectedLabel={t("sim_issue_report.filters.selected")}
          />

          <EntitySelector
            label={t("sim_issue_report.filters.products")}
            items={(options?.products || []).map((p) => ({
              id: p.code,
              label: p.name || p.code,
              sublabel: p.code,
              badge: String(p.count),
            }))}
            selectedIds={filters.productCodes}
            onChange={(ids) => updateFilter({ productCodes: ids.map(String) })}
            placeholder={t("sim_issue_report.filters.products_placeholder")}
            searchPlaceholder={t("sim_issue_report.filters.products_search")}
            emptyMessage={t("sim_issue_report.filters.empty")}
            noResultsMessage={t("sim_issue_report.filters.no_results")}
            disabled={!filters.houseId}
            selectAllLabel={t("common.select_all")}
            clearLabel={t("common.clear")}
            selectedLabel={t("sim_issue_report.filters.selected")}
          />

          <EntitySelector
            label={t("sim_issue_report.filters.promotions")}
            items={(options?.promotions || []).map((p) => ({
              id: p.value,
              label: p.value,
              badge: String(p.count),
            }))}
            selectedIds={filters.promotions}
            onChange={(ids) => updateFilter({ promotions: ids.map(String) })}
            placeholder={t("sim_issue_report.filters.promotions_placeholder")}
            searchPlaceholder={t("sim_issue_report.filters.promotions_search")}
            emptyMessage={t("sim_issue_report.filters.empty")}
            noResultsMessage={t("sim_issue_report.filters.no_results")}
            disabled={!filters.houseId}
            selectAllLabel={t("common.select_all")}
            clearLabel={t("common.clear")}
            selectedLabel={t("sim_issue_report.filters.selected")}
          />

          <div className="sm:col-span-2">
            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
              {t("sim_issue_report.filters.search")}
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={filters.search}
                onChange={(e) => updateFilter({ search: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyFilters();
                }}
                placeholder={t("sim_issue_report.filters.search_placeholder")}
                className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-sm text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary-500 cursor-text"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 mt-4 pt-4 border-t border-gray-100 dark:border-slate-800">
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-gray-700 dark:text-gray-200 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            {t("sim_issue_report.filters.reset")}
          </button>
          <button
            type="button"
            onClick={applyFilters}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold shadow-sm transition-colors cursor-pointer"
          >
            <Filter className="w-4 h-4" />
            {t("sim_issue_report.filters.apply")}
          </button>
        </div>
      </div>

      {!applied.houseId && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm">
          <EmptyState
            icon={Building2}
            text={t("sim_issue_report.messages.select_house_prompt")}
          />
        </div>
      )}

      <div className={cn("space-y-4", !applied.houseId && "hidden")}>
      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {loadingSummary && !summary ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonKpi key={i} />)
        ) : (
          <>
            <KpiCard
              icon={Activity}
              label={t("sim_issue_report.kpi.sims")}
              value={formatNum(totals?.sims)}
              sub={t("sim_issue_report.kpi.sims_sub").replace("{days}", String(totals?.days_with_data ?? 0))}
              tone="bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-400"
            />
            <KpiCard
              icon={Store}
              label={t("sim_issue_report.kpi.coverage")}
              value={`${(totals?.coverage_pct ?? 0).toFixed(1)}%`}
              sub={t("sim_issue_report.kpi.coverage_sub")
                .replace("{issued}", String(totals?.retailers_issued ?? 0))
                .replace("{total}", String(totals?.retailers_total ?? 0))}
              tone="bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"
            />
            <KpiCard
              icon={Inbox}
              label={t("sim_issue_report.kpi.pending")}
              value={formatNum(totals?.retailers_pending)}
              sub={t("sim_issue_report.kpi.pending_sub")}
              tone="bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400"
            />
            <KpiCard
              icon={Users}
              label={t("sim_issue_report.kpi.employees")}
              value={formatNum(totals?.employees)}
              sub={t("sim_issue_report.kpi.employees_sub").replace("{employees}", String(totals?.employees ?? 0))}
              tone="bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400"
            />
          </>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {tabButton("summary", t("sim_issue_report.tabs.summary"))}
        {tabButton("daily", t("sim_issue_report.tabs.daily"))}
        {tabButton("retailers", t("sim_issue_report.tabs.retailers"))}
        {tabButton("details", t("sim_issue_report.tabs.details"))}
      </div>

      {/* ---------------------------------------------------------- SUMMARY */}
      {tab === "summary" && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
          {loadingSummary && !summary ? (
            <SkeletonTable />
          ) : error && !summary ? (
            <EmptyState icon={Inbox} text={t("sim_issue_report.messages.load_failed")} />
          ) : !summary || summary.rows.length === 0 ? (
            <EmptyState icon={Inbox} text={t("sim_issue_report.summary.empty")} />
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-5 py-4 border-b border-gray-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <UserRound className="w-4 h-4 text-primary-600 dark:text-primary-400" />
                  <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                    {t("sim_issue_report.tabs.summary")}
                  </h2>
                </div>
                <p className="text-[11px] text-gray-400 dark:text-gray-500">
                  {t("sim_issue_report.filters.applied_period")
                    .replace("{start}", formatYMD(applied.startDate, language))
                    .replace("{end}", formatYMD(applied.endDate, language))}
                </p>
              </div>

              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-slate-800/60">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("sim_issue_report.summary.employee")}</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("sim_issue_report.summary.type")}</th>
                      <th className="px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("sim_issue_report.summary.retailers")}</th>
                      <th className="px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("sim_issue_report.summary.issued")}</th>
                      <th className="px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("sim_issue_report.summary.pending")}</th>
                      <th className="px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("sim_issue_report.summary.sims")}</th>
                      <th className="px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("sim_issue_report.summary.coverage")}</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("sim_issue_report.summary.last_issue")}</th>
                      <th className="px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("sim_issue_report.summary.actions")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                    {summary.rows.map((row) => (
                      <tr key={row.employee_id ?? "unassigned"} className="hover:bg-gray-50 dark:hover:bg-slate-800/40">
                        <td className="px-2 py-1">
                          <p className="font-semibold text-gray-900 dark:text-gray-100">
                            {row.name || t("sim_issue_report.summary.unassigned")}
                          </p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">
                            {[row.code, row.supervisor_name]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                          </p>
                        </td>
                        <td className="px-2 py-1">
                          <TypeBadge type={row.employee_type} label={typeLabel(row.employee_type)} />
                        </td>
                        <td className="px-2 py-1 text-right">{formatNum(row.retailers_total)}</td>
                        <td className="px-2 py-1 text-right">
                          <button
                            type="button"
                            onClick={() => openDrill(row, "issued")}
                            disabled={!row.employee_id || row.retailers_issued === 0}
                            className="font-semibold text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer disabled:no-underline disabled:cursor-default disabled:text-gray-400"
                          >
                            {formatNum(row.retailers_issued)}
                          </button>
                        </td>
                        <td className="px-2 py-1 text-right">
                          <button
                            type="button"
                            onClick={() => openDrill(row, "pending")}
                            disabled={!row.employee_id || row.retailers_pending === 0}
                            className="font-semibold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer disabled:no-underline disabled:cursor-default disabled:text-gray-400"
                          >
                            {formatNum(row.retailers_pending)}
                          </button>
                        </td>
                        <td className="px-2 py-1 text-right font-semibold">{formatNum(row.sims)}</td>
                        <td className={cn("px-2 py-1 text-right font-bold", coverageColor(row.coverage_pct))}>
                          {row.coverage_pct.toFixed(1)}%
                        </td>
                        <td className="px-2 py-1 whitespace-nowrap text-gray-600 dark:text-gray-300">
                          {row.last_issue_date ? formatYMD(row.last_issue_date, language) : "—"}
                        </td>
                        <td className="px-2 py-1 text-right">
                          <button
                            type="button"
                            onClick={() => openDrill(row, "all")}
                            disabled={!row.employee_id}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-500/10 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Store className="w-3.5 h-3.5" />
                            {t("sim_issue_report.summary.view")}
                          </button>
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-gray-50 dark:bg-slate-800/60 font-bold text-gray-900 dark:text-gray-100">
                      <td className="px-2 py-1" colSpan={2}>{t("sim_issue_report.summary.total")}</td>
                      <td className="px-2 py-1 text-right">{formatNum(totals?.retailers_total)}</td>
                      <td className="px-2 py-1 text-right">{formatNum(totals?.retailers_issued)}</td>
                      <td className="px-2 py-1 text-right">{formatNum(totals?.retailers_pending)}</td>
                      <td className="px-2 py-1 text-right">{formatNum(totals?.sims)}</td>
                      <td className="px-2 py-1 text-right">{totals?.coverage_pct.toFixed(1)}%</td>
                      <td className="px-2 py-1" colSpan={2} />
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Mobile accordion */}
              <div className="lg:hidden divide-y divide-gray-50 dark:divide-slate-800">
                {summary.rows.map((row) => {
                  const key = row.employee_id ?? 0;
                  const open = expandedId === key;
                  return (
                    <div key={key}>
                      <button
                        type="button"
                        onClick={() => setExpandedId(open ? null : key)}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">
                            {row.name || t("sim_issue_report.summary.unassigned")}
                          </p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                            {[row.code, row.supervisor_name].filter(Boolean).join(" · ") || "—"}
                          </p>
                        </div>
                        <TypeBadge type={row.employee_type} label={typeLabel(row.employee_type)} />
                        <span className={cn("text-sm font-bold", coverageColor(row.coverage_pct))}>
                          {row.coverage_pct.toFixed(1)}%
                        </span>
                        <ChevronDown className={cn("w-4 h-4 text-gray-400 transition-transform", open && "rotate-180")} />
                      </button>
                      {open && (
                        <div className="px-4 pb-4 grid grid-cols-2 gap-2 text-sm">
                          <div><span className="text-[11px] text-gray-500 dark:text-gray-400 block">{t("sim_issue_report.summary.retailers")}</span>{formatNum(row.retailers_total)}</div>
                          <div><span className="text-[11px] text-gray-500 dark:text-gray-400 block">{t("sim_issue_report.summary.sims")}</span>{formatNum(row.sims)}</div>
                          <div><span className="text-[11px] text-gray-500 dark:text-gray-400 block">{t("sim_issue_report.summary.issued")}</span>{formatNum(row.retailers_issued)}</div>
                          <div><span className="text-[11px] text-gray-500 dark:text-gray-400 block">{t("sim_issue_report.summary.pending")}</span>{formatNum(row.retailers_pending)}</div>
                          <div className="col-span-2">
                            <span className="text-[11px] text-gray-500 dark:text-gray-400 block">{t("sim_issue_report.summary.last_issue")}</span>
                            {row.last_issue_date ? formatYMD(row.last_issue_date, language) : "—"}
                          </div>
                          <div className="col-span-2 flex gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => openDrill(row, "issued")}
                              disabled={!row.employee_id || row.retailers_issued === 0}
                              className="flex-1 px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-xs font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {t("sim_issue_report.summary.issued")}
                            </button>
                            <button
                              type="button"
                              onClick={() => openDrill(row, "pending")}
                              disabled={!row.employee_id || row.retailers_pending === 0}
                              className="flex-1 px-3 py-2 rounded-lg bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 text-xs font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {t("sim_issue_report.summary.pending")}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------- DAILY */}
      {tab === "daily" && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
          {loadingSummary && !summary ? (
            <SkeletonTable />
          ) : !summary || summary.rows.length === 0 || dailyDates.length === 0 ? (
            <EmptyState icon={Activity} text={t("sim_issue_report.daily.empty")} />
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-4 border-b border-gray-100 dark:border-slate-800">
                <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                  {t("sim_issue_report.tabs.daily")}
                </h2>
                <p className="text-[11px] text-gray-400 dark:text-gray-500">
                  {t("sim_issue_report.daily.hint")}
                </p>
              </div>

              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-slate-800/60">
                    <tr>
                      <th className="sticky left-0 z-10 bg-gray-50 dark:bg-slate-800 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                        {t("sim_issue_report.daily.employee")}
                      </th>
                      {dailyDates.map((d) => (
                        <th
                          key={d}
                          title={formatYMD(d, language)}
                          className="px-2 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 whitespace-nowrap"
                        >
                          {dayLabel(d)}
                        </th>
                      ))}
                      <th className="px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                        {t("sim_issue_report.daily.total")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                    {summary.rows.map((row) => {
                      const byDate = new Map(row.daily.map((p) => [p.date, p]));
                      return (
                        <tr key={row.employee_id ?? "unassigned"} className="hover:bg-gray-50 dark:hover:bg-slate-800/40">
                          <td className="sticky left-0 z-10 bg-white dark:bg-slate-900 px-2 py-1">
                            <p className="font-semibold whitespace-nowrap text-gray-900 dark:text-gray-100">{row.name}</p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">
                              <TypeBadge type={row.employee_type} label={typeLabel(row.employee_type)} />
                            </p>
                          </td>
                          {dailyDates.map((d) => {
                            const point = byDate.get(d);
                            return (
                              <td key={d} className="px-2 py-1 text-center">
                                {point ? (
                                  <div
                                    title={`${formatYMD(d, language)} · ${point.sims} ${t("sim_issue_report.daily.sims")} · ${point.retailers} ${t("sim_issue_report.daily.retailers")}`}
                                    className="inline-flex flex-col items-center min-w-8 rounded px-1 py-0.5 bg-primary-50 dark:bg-primary-500/10"
                                  >
                                    <span className="text-xs font-bold text-primary-700 dark:text-primary-300">
                                      {formatNum(point.sims)}
                                    </span>
                                    <span className="text-[9px] text-primary-500/80 dark:text-primary-400/80">
                                      {formatNum(point.retailers)}
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-gray-300 dark:text-slate-700">·</span>
                                )}
                              </td>
                            );
                          })}
                          <td className="px-2 py-1 text-right font-bold">{formatNum(row.sims)}</td>
                        </tr>
                      );
                    })}
                    <tr className="bg-gray-50 dark:bg-slate-800/60 font-bold">
                      <td className="sticky left-0 z-10 bg-gray-50 dark:bg-slate-800 px-2 py-1">{t("sim_issue_report.daily.total")}</td>
                      {summary.daily_totals.map((d) => (
                        <td key={d.date} className="px-2 py-1 text-center">{formatNum(d.sims)}</td>
                      ))}
                      <td className="px-2 py-1 text-right">{formatNum(totals?.sims)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="lg:hidden divide-y divide-gray-50 dark:divide-slate-800">
                {summary.rows.map((row) => {
                  const key = row.employee_id ?? 0;
                  const open = expandedId === key;
                  return (
                    <div key={key}>
                      <button
                        type="button"
                        onClick={() => setExpandedId(open ? null : key)}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-sm truncate text-gray-900 dark:text-gray-100">{row.name}</p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">
                            {formatNum(row.sims)} {t("sim_issue_report.daily.sims")} · {formatNum(row.retailers_issued)} {t("sim_issue_report.summary.issued")}
                          </p>
                        </div>
                        <ChevronDown className={cn("w-4 h-4 text-gray-400 transition-transform", open && "rotate-180")} />
                      </button>
                      {open && (
                        <div className="px-4 pb-3 space-y-1.5">
                          {row.daily.length === 0 ? (
                            <p className="text-xs text-gray-400">{t("sim_issue_report.daily.empty")}</p>
                          ) : (
                            row.daily.map((point) => (
                              <div key={point.date} className="flex items-center justify-between text-sm">
                                <span className="text-gray-600 dark:text-gray-300">{formatYMD(point.date, language)}</span>
                                <span className="font-semibold text-gray-900 dark:text-gray-100">
                                  {formatNum(point.sims)} · <span className="text-[11px] font-normal text-gray-500">{formatNum(point.retailers)} {t("sim_issue_report.daily.retailers")}</span>
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* --------------------------------------------------------- RETAILERS */}
      {tab === "retailers" && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 sm:px-5 py-4 border-b border-gray-100 dark:border-slate-800">
            <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">
              {t("sim_issue_report.tabs.retailers")}
            </h2>
            <div className="flex items-center gap-1.5">
              {(["all", "issued", "pending"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setRetailerStatus(s);
                    setRetailerPage(1);
                  }}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer",
                    retailerStatus === s
                      ? "bg-primary-600 text-white shadow-sm"
                      : "bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-700"
                  )}
                >
                  {t(`sim_issue_report.retailers.status_${s}`)}
                  {retailers && (
                    <span className="ml-1 opacity-70">
                      ({formatNum(s === "all" ? retailers.total : s === "issued" ? retailers.issued : retailers.pending)})
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {loadingRetailers ? (
            <SkeletonTable />
          ) : !retailers || retailers.rows.length === 0 ? (
            <EmptyState icon={Store} text={t("sim_issue_report.retailers.empty")} />
          ) : (
            <>
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-slate-800/60">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("sim_issue_report.retailers.code")}</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("sim_issue_report.retailers.name")}</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("sim_issue_report.retailers.owner")}</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("sim_issue_report.retailers.supervisor")}</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("sim_issue_report.retailers.status")}</th>
                      <th className="px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("sim_issue_report.retailers.sims")}</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("sim_issue_report.retailers.first_issue")}</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("sim_issue_report.retailers.last_issue")}</th>
                      <th className="px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("sim_issue_report.retailers.actions")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                    {retailers.rows.map((r) => (
                      <tr key={r.retailer_code} className="hover:bg-gray-50 dark:hover:bg-slate-800/40">
                        <td className="px-2 py-1">
                          <button
                            type="button"
                            onClick={() => openDrawer(r.retailer_code, r.name)}
                            className="font-mono text-xs font-semibold text-primary-600 dark:text-primary-400 hover:underline cursor-pointer"
                          >
                            {r.retailer_code}
                          </button>
                        </td>
                        <td className="px-2 py-1">
                          <p className="font-semibold text-gray-900 dark:text-gray-100">{r.name}</p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">{r.itop_number || "—"}</p>
                        </td>
                        <td className="px-2 py-1">
                          <p>{r.employee_name || t("sim_issue_report.summary.unassigned")}</p>
                          <p className="text-[11px]">
                            <TypeBadge type={r.employee_type} label={typeLabel(r.employee_type)} />
                          </p>
                        </td>
                        <td className="px-2 py-1 text-gray-600 dark:text-gray-300">{r.supervisor_name || "—"}</td>
                        <td className="px-2 py-1">
                          <StatusBadge
                            status={r.status}
                            issuedLabel={t("sim_issue_report.retailers.issued_badge")}
                            pendingLabel={t("sim_issue_report.retailers.pending_badge")}
                          />
                        </td>
                        <td className="px-2 py-1 text-right font-semibold">{formatNum(r.sim_count)}</td>
                        <td className="px-2 py-1 whitespace-nowrap text-gray-600 dark:text-gray-300">
                          {r.first_issue_date ? formatYMD(r.first_issue_date, language) : "—"}
                        </td>
                        <td className="px-2 py-1 whitespace-nowrap text-gray-600 dark:text-gray-300">
                          {r.last_issue_date ? formatYMD(r.last_issue_date, language) : "—"}
                        </td>
                        <td className="px-2 py-1 text-right">
                          <button
                            type="button"
                            onClick={() => openDrawer(r.retailer_code, r.name)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-500/10 cursor-pointer"
                          >
                            {t("sim_issue_report.retailers.view_sims")}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="lg:hidden divide-y divide-gray-50 dark:divide-slate-800">
                {retailers.rows.map((r) => {
                  const open = expandedCode === r.retailer_code;
                  return (
                    <div key={r.retailer_code}>
                      <button
                        type="button"
                        onClick={() => setExpandedCode(open ? null : r.retailer_code)}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-sm truncate text-gray-900 dark:text-gray-100">{r.name}</p>
                          <p className="text-[11px] font-mono text-gray-500 dark:text-gray-400">{r.retailer_code} · {r.itop_number || "—"}</p>
                        </div>
                        <StatusBadge
                          status={r.status}
                          issuedLabel={t("sim_issue_report.retailers.issued_badge")}
                          pendingLabel={t("sim_issue_report.retailers.pending_badge")}
                        />
                        <ChevronDown className={cn("w-4 h-4 text-gray-400 transition-transform", open && "rotate-180")} />
                      </button>
                      {open && (
                        <div className="px-4 pb-4 grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <span className="text-[11px] text-gray-500 dark:text-gray-400 block">{t("sim_issue_report.retailers.owner")}</span>
                            {r.employee_name || t("sim_issue_report.summary.unassigned")}
                          </div>
                          <div>
                            <span className="text-[11px] text-gray-500 dark:text-gray-400 block">{t("sim_issue_report.retailers.supervisor")}</span>
                            {r.supervisor_name || "—"}
                          </div>
                          <div>
                            <span className="text-[11px] text-gray-500 dark:text-gray-400 block">{t("sim_issue_report.retailers.sims")}</span>
                            {formatNum(r.sim_count)}
                          </div>
                          <div>
                            <span className="text-[11px] text-gray-500 dark:text-gray-400 block">{t("sim_issue_report.retailers.last_issue")}</span>
                            {r.last_issue_date ? formatYMD(r.last_issue_date, language) : "—"}
                          </div>
                          <div className="col-span-2 pt-1">
                            <button
                              type="button"
                              onClick={() => openDrawer(r.retailer_code, r.name)}
                              className="w-full px-3 py-2 rounded-lg bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-primary-300 text-xs font-semibold cursor-pointer"
                            >
                              {t("sim_issue_report.retailers.view_sims")}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <Pager
                page={retailers.page}
                perPage={retailers.per_page}
                total={retailers.total}
                onPrev={() => setRetailerPage((p) => Math.max(1, p - 1))}
                onNext={() => setRetailerPage((p) => p + 1)}
                showing={t("sim_issue_report.pager.showing")}
                prev={t("sim_issue_report.pager.prev")}
                next={t("sim_issue_report.pager.next")}
              />
            </>
          )}
        </div>
      )}

      {/* ----------------------------------------------------------- DETAILS */}
      {tab === "details" && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-4 border-b border-gray-100 dark:border-slate-800">
            <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">
              {t("sim_issue_report.tabs.details")}
            </h2>
            {details && (
              <p className="text-[11px] text-gray-400 dark:text-gray-500">
                {t("sim_issue_report.details.total").replace("{count}", formatNum(details.total))}
              </p>
            )}
          </div>

          {loadingDetails ? (
            <SkeletonTable />
          ) : !details || details.rows.length === 0 ? (
            <EmptyState icon={Inbox} text={t("sim_issue_report.details.empty")} />
          ) : (
            <>
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-slate-800/60">
                    <tr>
                      <th className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("sim_issue_report.details.date")}</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("sim_issue_report.details.sim_no")}</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("sim_issue_report.details.retailer")}</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("sim_issue_report.details.owner")}</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("sim_issue_report.details.product")}</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("sim_issue_report.details.promotion")}</th>
                      <th className="px-3 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("sim_issue_report.details.price")}</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("sim_issue_report.details.cluster")}</th>
                      <th className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("sim_issue_report.details.distributor")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                    {details.rows.map((r) => (
                      <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/40">
                        <td className="px-2 py-1 whitespace-nowrap">{r.issue_date ? formatYMD(r.issue_date, language) : "—"}</td>
                        <td className="px-2 py-1 font-mono text-xs">{r.sim_no || "—"}</td>
                        <td className="px-2 py-1">
                          <button
                            type="button"
                            onClick={() => r.retailer_code && openDrawer(r.retailer_code, r.retailer_name || "")}
                            className="font-semibold text-primary-600 dark:text-primary-400 hover:underline cursor-pointer"
                          >
                            {r.retailer_name || r.retailer_code || "—"}
                          </button>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400 font-mono">{r.retailer_code || ""}</p>
                        </td>
                        <td className="px-2 py-1">
                          <p>{r.employee_name || t("sim_issue_report.summary.unassigned")}</p>
                          <p className="text-[11px]"><TypeBadge type={r.employee_type} label={typeLabel(r.employee_type)} /></p>
                        </td>
                        <td className="px-2 py-1">
                          <p>{r.product_name || r.product_code || "—"}</p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">{r.product_code || ""}</p>
                        </td>
                        <td className="px-2 py-1">{r.promotion || "—"}</td>
                        <td className="px-2 py-1 text-right">{r.selling_price != null ? formatNum(r.selling_price) : "—"}</td>
                        <td className="px-2 py-1">{r.cluster_market || "—"}</td>
                        <td className="px-2 py-1">{r.distributor_name || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="lg:hidden divide-y divide-gray-50 dark:divide-slate-800">
                {details.rows.map((r) => (
                  <div key={r.id} className="px-4 py-3 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => r.retailer_code && openDrawer(r.retailer_code, r.retailer_name || "")}
                        className="font-semibold text-sm text-primary-600 dark:text-primary-400 truncate"
                      >
                        {r.retailer_name || r.retailer_code}
                      </button>
                      <span className="text-xs text-gray-500 whitespace-nowrap">{r.issue_date ? formatYMD(r.issue_date, language) : "—"}</span>
                    </div>
                    <p className="text-[11px] font-mono text-gray-500 dark:text-gray-400">{r.sim_no}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400">
                      <span>{r.employee_name || t("sim_issue_report.summary.unassigned")}</span>
                      <span>{r.product_name || r.product_code || "—"}</span>
                      <span>{r.promotion || "—"}</span>
                      {r.selling_price != null && <span>{formatNum(r.selling_price)}</span>}
                    </div>
                  </div>
                ))}
              </div>

              <Pager
                page={details.page}
                perPage={details.per_page}
                total={details.total}
                onPrev={() => setDetailPage((p) => Math.max(1, p - 1))}
                onNext={() => setDetailPage((p) => p + 1)}
                showing={t("sim_issue_report.pager.showing")}
                prev={t("sim_issue_report.pager.prev")}
                next={t("sim_issue_report.pager.next")}
              />
            </>
          )}
        </div>
      )}
      </div>

      {/* ------------------------------------------------------- DRILL MODAL */}
      {drill.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setDrill((d) => ({ ...d, open: false }))}
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative w-full max-w-2xl max-h-[85vh] flex flex-col bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-gray-100 dark:border-slate-800 overflow-hidden"
          >
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100 dark:border-slate-800">
              <div>
                <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">
                  {drill.employeeName}
                </h3>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  {t("sim_issue_report.drill.subtitle")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDrill((d) => ({ ...d, open: false }))}
                className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 cursor-pointer"
                aria-label={t("sim_issue_report.drill.close")}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-1.5 px-5 py-3 border-b border-gray-100 dark:border-slate-800">
              {(["all", "issued", "pending"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setDrill((d) => ({ ...d, status: s, page: 1, data: null }))}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer",
                    drill.status === s
                      ? "bg-primary-600 text-white"
                      : "bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300"
                  )}
                >
                  {t(`sim_issue_report.retailers.status_${s}`)}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto">
              {drill.loading ? (
                <div className="p-5 space-y-3 animate-pulse">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-10 rounded-lg bg-gray-100 dark:bg-slate-800" />
                  ))}
                </div>
              ) : !drill.data || drill.data.rows.length === 0 ? (
                <EmptyState icon={Store} text={t("sim_issue_report.drill.empty")} />
              ) : (
                <div className="divide-y divide-gray-50 dark:divide-slate-800">
                  {drill.data.rows.map((r) => (
                    <div key={r.retailer_code} className="flex items-center gap-3 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{r.name}</p>
                        <p className="text-[11px] font-mono text-gray-500 dark:text-gray-400">
                          {r.retailer_code} · {r.itop_number || "—"}
                        </p>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">
                          {r.last_issue_date
                            ? formatYMD(r.last_issue_date, language)
                            : t("sim_issue_report.retailers.pending_badge")}
                        </p>
                      </div>
                      <StatusBadge
                        status={r.status}
                        issuedLabel={t("sim_issue_report.retailers.issued_badge")}
                        pendingLabel={t("sim_issue_report.retailers.pending_badge")}
                      />
                      {r.status === "issued" && (
                        <button
                          type="button"
                          onClick={() => {
                            setDrill((d) => ({ ...d, open: false }));
                            openDrawer(r.retailer_code, r.name);
                          }}
                          className="px-2 py-1 rounded-md text-xs font-semibold text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-500/10 cursor-pointer"
                        >
                          {t("sim_issue_report.retailers.view_sims")}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {drill.data && (
              <Pager
                page={drill.data.page}
                perPage={drill.data.per_page}
                total={drill.data.total}
                onPrev={() => setDrill((d) => ({ ...d, page: Math.max(1, d.page - 1) }))}
                onNext={() => setDrill((d) => ({ ...d, page: d.page + 1 }))}
                showing={t("sim_issue_report.pager.showing")}
                prev={t("sim_issue_report.pager.prev")}
                next={t("sim_issue_report.pager.next")}
              />
            )}
          </div>
        </div>
      )}

      {/* ----------------------------------------------------- DETAIL DRAWER */}
      {drawer.open && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setDrawer((d) => ({ ...d, open: false }))}
          />
          <div
            role="dialog"
            aria-modal="true"
            className="absolute inset-y-0 right-0 w-full sm:max-w-md bg-white dark:bg-slate-900 shadow-xl border-l border-gray-100 dark:border-slate-800 flex flex-col"
          >
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100 dark:border-slate-800">
              <div className="min-w-0">
                <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">
                  {t("sim_issue_report.drawer.title")}
                </h3>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                  {drawer.code} · {drawer.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDrawer((d) => ({ ...d, open: false }))}
                className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 cursor-pointer"
                aria-label={t("sim_issue_report.drawer.close")}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {drawer.data && (
              <p className="px-5 py-2 text-[11px] text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-slate-800">
                {t("sim_issue_report.drawer.total").replace("{count}", formatNum(drawer.data.total))}
              </p>
            )}

            <div className="flex-1 overflow-y-auto">
              {drawer.loading ? (
                <div className="p-5 space-y-3 animate-pulse">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-12 rounded-lg bg-gray-100 dark:bg-slate-800" />
                  ))}
                </div>
              ) : !drawer.data || drawer.data.rows.length === 0 ? (
                <EmptyState icon={Inbox} text={t("sim_issue_report.drawer.empty")} />
              ) : (
                <div className="divide-y divide-gray-50 dark:divide-slate-800">
                  {drawer.data.rows.map((r) => (
                    <div key={r.id} className="px-5 py-3 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {r.issue_date ? formatYMD(r.issue_date, language) : "—"}
                        </span>
                        {r.selling_price != null && (
                          <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                            {formatNum(r.selling_price)}
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-mono font-semibold text-gray-900 dark:text-gray-100 break-all">
                        {r.sim_no}
                      </p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">
                        {[r.product_name || r.product_code, r.promotion].filter(Boolean).join(" · ") || "—"}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {drawer.data && (
              <Pager
                page={drawer.data.page}
                perPage={drawer.data.per_page}
                total={drawer.data.total}
                onPrev={() => setDrawer((d) => ({ ...d, page: Math.max(1, d.page - 1) }))}
                onNext={() => setDrawer((d) => ({ ...d, page: d.page + 1 }))}
                showing={t("sim_issue_report.pager.showing")}
                prev={t("sim_issue_report.pager.prev")}
                next={t("sim_issue_report.pager.next")}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}