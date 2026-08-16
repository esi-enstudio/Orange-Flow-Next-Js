"use client";

import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from "react";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  RotateCcw, Download, Building2, Calendar, Zap, Clock,
  ArrowUp, ChevronDown, Wallet, ReceiptText,
  CalendarDays, ListFilter, Store, UserRound, Inbox,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { cn } from "@/lib/utils";
import { exportTransactionsReport } from "@/lib/export-transactions";
import { toast } from "react-hot-toast";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { useLanguage } from "@/i18n/useLanguage";

// ------------------------------------------------------------------ types

interface Summary {
  total_value: number;
  total_records: number;
  active_days: number;
  active_retailers: number;
  daily_average: number;
}

interface RetailerDetail {
  retailer_id: number;
  retailer_code: string;
  retailer_name: string;
  value: number;
}

interface DailyGroup {
  date: string;
  total_value: number;
  record_count: number;
  retailer_count: number;
  retailers: RetailerDetail[];
}

interface TrendPoint {
  date: string;
  value: number;
  count: number;
}

interface Pagination {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

interface ReportData {
  success: boolean;
  house_id: number | null;
  summary: Summary;
  trend: TrendPoint[];
  data: DailyGroup[];
  pagination: Pagination;
}

interface HouseOption {
  id: number;
  name: string;
  code: string;
  display_name: string;
}

interface EntityOption {
  id: number;
  code: string;
  name: string;
  itop_number?: string;
  rso_name?: string;
}

const REPORT_TYPES = ["C2C", "C2S", "Balance"] as const;
type ReportType = (typeof REPORT_TYPES)[number];
type EntityType = "rso" | "retailer";
type TimeMode = "day" | "month" | "range";

// ------------------------------------------------------------------ helpers

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthRange(month: number, year: number): { start: string; end: string } {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);
  return { start: toDateStr(start), end: toDateStr(end) };
}

function formatNumber(n: number): string {
  if (n === undefined || n === null) return "0";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatDate(dateStr: string, lang: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (lang === "bn") {
    const bnDays = ["রবি", "সোম", "মঙ্গল", "বুধ", "বৃহস্পতি", "শুক্র", "শনি"];
    const bnMonths = ["জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন", "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর"];
    const bnNum = (n: number) => String(n).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
    return `${bnDays[dt.getDay()]}, ${bnNum(d)} ${bnMonths[m - 1]} ${bnNum(y)}`;
  }
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// ------------------------------------------------------------------ skeleton

const SkeletonCard = () => (
  <div className="animate-pulse bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 p-5 shadow-sm">
    <div className="h-3 w-24 bg-gray-200 dark:bg-slate-700 rounded-md mb-3" />
    <div className="h-7 w-32 bg-gray-200 dark:bg-slate-700 rounded-md mb-2" />
    <div className="h-2.5 w-20 bg-gray-100 dark:bg-slate-800 rounded-md" />
  </div>
);

const SkeletonRow = () => (
  <div className="flex items-center gap-4 px-6 py-4 animate-pulse border-b border-gray-50 dark:border-slate-800">
    <div className="w-10 h-10 rounded-lg bg-gray-200 dark:bg-slate-700 shrink-0" />
    <div className="space-y-2 flex-1">
      <div className="h-3 w-28 bg-gray-200 dark:bg-slate-700 rounded-md" />
      <div className="h-2.5 w-20 bg-gray-100 dark:bg-slate-800 rounded-md" />
    </div>
    <div className="hidden sm:block flex-1 space-y-2">
      <div className="h-3 w-16 bg-gray-200 dark:bg-slate-700 rounded-md" />
    </div>
    <div className="w-20 h-6 rounded-md bg-gray-200 dark:bg-slate-700" />
  </div>
);

// ------------------------------------------------------------------ component

export default function TransactionsReportPage() {
  const { selectedHouse, hasPermission, loading: authLoading } = useAuth();
  const { t, language } = useLanguage();

  const today = new Date();
  const [selectedHouseId, setSelectedHouseId] = useState<string>(selectedHouse ? String(selectedHouse.id) : "");
  const [houses, setHouses] = useState<HouseOption[]>([]);

  const [reportType, setReportType] = useState<ReportType>("C2C");
  const [entityType, setEntityType] = useState<EntityType>("rso");
  const [entities, setEntities] = useState<EntityOption[]>([]);
  const [selectedEntity, setSelectedEntity] = useState<string>("");
  const [entitySearch, setEntitySearch] = useState<string>("");
  const [entityOpen, setEntityOpen] = useState(false);

  const [timeMode, setTimeMode] = useState<TimeMode>("month");
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const [singleDate, setSingleDate] = useState(toDateStr(today));
  const [startDate, setStartDate] = useState(toDateStr(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [endDate, setEndDate] = useState(toDateStr(today));

  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const entityDropdownRef = useRef<HTMLDivElement>(null);

  const dateRange = useMemo<{ start: string; end: string }>(() => {
    if (timeMode === "day") return { start: singleDate, end: singleDate };
    if (timeMode === "month") return monthRange(month, year);
    return { start: startDate, end: endDate };
  }, [timeMode, singleDate, month, year, startDate, endDate]);

  useEffect(() => {
    if (!authLoading && hasPermission("transactions.view")) {
      apiClient.get("houses/accessible").then((res) => setHouses(res.data)).catch(() => {});
    }
  }, [authLoading, hasPermission]);

  const fetchEntities = useCallback(async (type: EntityType, search: string) => {
    if (!selectedHouseId) {
      setEntities([]);
      return;
    }
    try {
      const res = await apiClient.get("reports/transactions/entities", {
        params: { entity_type: type, search: search || undefined, house_id: selectedHouseId },
      });
      setEntities(res.data?.data || []);
    } catch {
      setEntities([]);
    }
  }, [selectedHouseId]);

  useEffect(() => {
    setSelectedEntity("");
    fetchEntities(entityType, "");
  }, [entityType, selectedHouseId, fetchEntities]);

  useEffect(() => {
    const timer = setTimeout(() => fetchEntities(entityType, entitySearch), 300);
    return () => clearTimeout(timer);
  }, [entitySearch, entityType, fetchEntities]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (entityDropdownRef.current && !entityDropdownRef.current.contains(e.target as Node)) {
        setEntityOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const fetchReport = useCallback(async (targetPage: number) => {
    if (!selectedHouseId) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params: Record<string, any> = {
        report_type: reportType,
        start_date: dateRange.start,
        end_date: dateRange.end,
        house_id: selectedHouseId,
        page: targetPage,
        per_page: 15,
      };
      if (entityType === "retailer" && selectedEntity) params.retailer_id = selectedEntity;
      if (entityType === "rso" && selectedEntity) params.rso_id = selectedEntity;
      const res = await apiClient.get("reports/transactions", { params });
      setData(res.data);
    } catch {
      toast.error(t("transactions_report.messages.error"));
    } finally {
      setLoading(false);
    }
  }, [selectedHouseId, reportType, entityType, selectedEntity, dateRange.start, dateRange.end, t]);

  useEffect(() => {
    if (!authLoading && hasPermission("transactions.view")) {
      fetchReport(page);
    }
  }, [authLoading, hasPermission, selectedHouseId, reportType, entityType, selectedEntity, dateRange.start, dateRange.end, page, fetchReport]);

  const resetAndFetch = () => {
    setPage(1);
    setExpandedId(null);
  };

  const changePage = (p: number) => {
    setPage(p);
    setExpandedId(null);
    fetchReport(p);
  };

  const handleExport = async () => {
    try {
      await exportTransactionsReport({
        report_type: reportType,
        start_date: dateRange.start,
        end_date: dateRange.end,
        house_id: selectedHouseId ? Number(selectedHouseId) : null,
        rso_id: entityType === "rso" && selectedEntity ? Number(selectedEntity) : null,
        retailer_id: entityType === "retailer" && selectedEntity ? Number(selectedEntity) : null,
      });
      toast.success(t("transactions_report.messages.export_success"));
    } catch {
      toast.error(t("transactions_report.messages.export_failed"));
    }
  };

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

  if (!authLoading && !hasPermission("transactions.view")) {
    return <AccessDenied />;
  }

  const s = data?.summary;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t("transactions_report.title")}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t("transactions_report.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {houses.length > 1 && (
            <div className="relative">
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <select
                value={selectedHouseId}
                onChange={(e) => { setSelectedHouseId(e.target.value); resetAndFetch(); }}
                className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg text-sm font-medium text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors shadow-sm outline-none focus:ring-2 focus:ring-primary-500 appearance-none cursor-pointer min-w-[160px]"
              >
                <option value="">{t("transactions_report.filters.house")}</option>
                {houses.map((h) => (
                  <option key={h.id} value={h.id}>{h.display_name}</option>
                ))}
              </select>
            </div>
          )}
          <button
            onClick={handleExport}
            disabled={!data}
            className="inline-flex items-center justify-center p-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors shadow-sm disabled:opacity-50"
            title={t("transactions_report.actions.export")}
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={() => { setPage(1); fetchReport(1); }}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-bold hover:bg-primary-600 transition-colors shadow-sm disabled:opacity-50"
          >
            <RotateCcw className={cn("w-4 h-4", loading && "animate-spin")} />
            {t("transactions_report.actions.refresh")}
          </button>
        </div>
      </div>

      {/* Report type toggle */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-1 bg-gray-100 dark:bg-slate-800 rounded-xl p-1 shadow-sm">
          {REPORT_TYPES.map((rt) => (
            <button
              key={rt}
              onClick={() => { setReportType(rt); resetAndFetch(); }}
              className={cn(
                "inline-flex items-center gap-2 px-3 md:px-5 py-2 rounded-lg text-xs md:text-sm font-bold transition-all whitespace-nowrap",
                reportType === rt
                  ? "bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 shadow-sm"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
              )}
            >
              {rt === "C2C" && <Zap className={cn("w-4 h-4", reportType === rt ? "text-primary-600 dark:text-primary-400" : "text-gray-400 dark:text-gray-500")} />}
              {rt === "C2S" && <Wallet className={cn("w-4 h-4", reportType === rt ? "text-emerald-600 dark:text-emerald-400" : "text-gray-400 dark:text-gray-500")} />}
              {rt === "Balance" && <ReceiptText className={cn("w-4 h-4", reportType === rt ? "text-indigo-600 dark:text-indigo-400" : "text-gray-400 dark:text-gray-500")} />}
              {rt}
            </button>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Entity type + picker */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm p-4">
          <div className="inline-flex items-center gap-1 bg-gray-100 dark:bg-slate-800 rounded-lg p-1 mb-3 w-full">
            {(["rso", "retailer"] as EntityType[]).map((et) => (
              <button
                key={et}
                onClick={() => { setEntityType(et); resetAndFetch(); }}
                className={cn(
                  "flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all",
                  entityType === et
                    ? "bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 shadow-sm"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                )}
              >
                {et === "rso" ? <UserRound className="w-3.5 h-3.5" /> : <Store className="w-3.5 h-3.5" />}
                {et === "rso" ? t("transactions_report.filters.rso") : t("transactions_report.filters.retailer")}
              </button>
            ))}
          </div>
          <div className="relative" ref={entityDropdownRef}>
            <button
              onClick={() => setEntityOpen((v) => !v)}
              disabled={!selectedHouseId}
              className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 transition-all disabled:opacity-50 text-left"
            >
              <span className={cn("truncate", !selectedEntity && "text-gray-400 dark:text-gray-500")}>
                {selectedEntity
                  ? entities.find((e) => String(e.id) === selectedEntity)?.name || t("transactions_report.filters.select_entity")
                  : t("transactions_report.filters.select_entity")}
              </span>
              <ChevronDown className={cn("w-3.5 h-3.5 text-gray-400 shrink-0 transition-transform", entityOpen && "rotate-180")} />
            </button>
            {entityOpen && (
              <div className="absolute z-20 mt-1 w-full bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl shadow-xl overflow-hidden">
                <div className="p-2 border-b border-gray-50 dark:border-slate-800">
                  <input
                    type="text"
                    value={entitySearch}
                    onChange={(e) => setEntitySearch(e.target.value)}
                    placeholder={t("transactions_report.filters.search_placeholder")}
                    className="w-full px-3 py-1.5 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 transition-all"
                  />
                </div>
                <div className="max-h-56 overflow-y-auto">
                  {entities.length === 0 ? (
                    <p className="px-3 py-4 text-xs text-center text-gray-400">{t("transactions_report.messages.no_entities")}</p>
                  ) : (
                    entities.map((e) => (
                      <button
                        key={e.id}
                        onClick={() => { setSelectedEntity(String(e.id)); setEntityOpen(false); resetAndFetch(); }}
                        className={cn(
                          "w-full text-left px-3 py-2 transition-colors",
                          String(e.id) === selectedEntity
                            ? "bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-primary-300"
                            : "hover:bg-gray-50 dark:hover:bg-slate-800 text-gray-700 dark:text-gray-300"
                        )}
                      >
                        <p className="text-xs font-medium">{e.name}</p>
                        <p className="text-[11px] text-gray-400">
                          {e.code}
                          {e.itop_number ? ` | ${e.itop_number}` : ""}
                          {e.rso_name ? ` | ${e.rso_name}` : ""}
                        </p>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Time mode */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm p-4">
          <div className="inline-flex items-center gap-1 bg-gray-100 dark:bg-slate-800 rounded-lg p-1 mb-3 w-full">
            {(["day", "month", "range"] as TimeMode[]).map((tm) => (
              <button
                key={tm}
                onClick={() => { setTimeMode(tm); resetAndFetch(); }}
                className={cn(
                  "flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-[11px] font-bold transition-all whitespace-nowrap",
                  timeMode === tm
                    ? "bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 shadow-sm"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                )}
              >
                {tm === "day" && <Calendar className="w-3.5 h-3.5" />}
                {tm === "month" && <CalendarDays className="w-3.5 h-3.5" />}
                {tm === "range" && <ListFilter className="w-3.5 h-3.5" />}
                {tm === "day" ? t("transactions_report.filters.day") : tm === "month" ? t("transactions_report.filters.month") : t("transactions_report.filters.range")}
              </button>
            ))}
          </div>
          {timeMode === "day" && (
            <input type="date" value={singleDate} onChange={(e) => { setSingleDate(e.target.value); resetAndFetch(); }}
              className="w-full px-3 py-2 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 transition-all" />
          )}
          {timeMode === "month" && (
            <div className="grid grid-cols-2 gap-2">
              <select value={month} onChange={(e) => { setMonth(Number(e.target.value)); resetAndFetch(); }}
                className="w-full px-2 py-2 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 transition-all">
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>{getMonthName(m)}</option>
                ))}
              </select>
              <select value={year} onChange={(e) => { setYear(Number(e.target.value)); resetAndFetch(); }}
                className="w-full px-2 py-2 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 transition-all">
                {Array.from({ length: 5 }, (_, i) => today.getFullYear() - 2 + i).map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          )}
          {timeMode === "range" && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">From</label>
                <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); resetAndFetch(); }}
                  className="w-full px-2 py-2 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 transition-all" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">To</label>
                <input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); resetAndFetch(); }}
                  className="w-full px-2 py-2 bg-gray-50 dark:bg-slate-800 border border-transparent rounded-lg text-xs dark:text-gray-200 outline-none focus:border-primary-500 transition-all" />
              </div>
            </div>
          )}
        </div>

        {/* Summary strip */}
        <div className="md:col-span-2 xl:col-span-2 grid grid-cols-2 gap-4">
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-2">
              <Wallet className="w-4 h-4 text-primary-500" />
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">{t("transactions_report.summary.total_value")}</span>
            </div>
            <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {loading ? <span className="animate-pulse text-gray-300 dark:text-gray-700">---</span> : formatNumber(s?.total_value ?? 0)}
            </p>
            <p className="text-[11px] text-gray-400 mt-1">BDT</p>
          </div>
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-2">
              <ReceiptText className="w-4 h-4 text-emerald-500" />
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">{t("transactions_report.summary.transactions")}</span>
            </div>
            <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {loading ? <span className="animate-pulse text-gray-300 dark:text-gray-700">---</span> : formatNumber(s?.total_records ?? 0)}
            </p>
            <p className="text-[11px] text-gray-400 mt-1">{t("transactions_report.summary.records")}</p>
          </div>
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-2">
              <CalendarDays className="w-4 h-4 text-indigo-500" />
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">{t("transactions_report.summary.active_days")}</span>
            </div>
            <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {loading ? <span className="animate-pulse text-gray-300 dark:text-gray-700">---</span> : formatNumber(s?.active_days ?? 0)}
            </p>
            <p className="text-[11px] text-gray-400 mt-1">{t("transactions_report.summary.retailers", { count: s?.active_retailers ?? 0 })}</p>
          </div>
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4 text-amber-500" />
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">{t("transactions_report.summary.daily_average")}</span>
            </div>
            <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {loading ? <span className="animate-pulse text-gray-300 dark:text-gray-700">---</span> : formatNumber(s?.daily_average ?? 0)}
            </p>
            <p className="text-[11px] text-gray-400 mt-1">BDT</p>
          </div>
        </div>
      </div>

      {/* Daily trend chart */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{t("transactions_report.chart.title")}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {dateRange.start} → {dateRange.end}
            </p>
          </div>
          <TrendPill loading={loading} />
        </div>
        {loading ? (
          <div className="h-56 animate-pulse bg-gray-100 dark:bg-slate-800 rounded-lg" />
        ) : data && data.trend.length > 0 ? (
          <ResponsiveContainer width="100%" height={224}>
            <BarChart data={data.trend} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-gray-100 dark:stroke-slate-800" vertical={false} />
              <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} tick={{ fontSize: 11 }} stroke="#94a3b8" />
              <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
              <Tooltip
                cursor={{ fill: "rgba(148,163,184,0.08)" }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-xl shadow-xl px-3 py-2 text-xs">
                      <p className="font-bold text-gray-900 dark:text-gray-100 mb-1">{formatDate(String(label), language)}</p>
                      <p className="text-gray-500 dark:text-gray-400">
                        {t("transactions_report.chart.value")}: <span className="font-bold text-gray-900 dark:text-gray-100">{formatNumber(Number(payload[0].value))}</span> BDT
                      </p>
                      <p className="text-gray-500 dark:text-gray-400">
                        {t("transactions_report.chart.count")}: <span className="font-bold text-gray-900 dark:text-gray-100">{formatNumber(Number(payload[1]?.value ?? 0))}</span>
                      </p>
                    </div>
                  );
                }}
              />
              <Bar dataKey="value" fill="var(--chart-1, #f97316)" radius={[4, 4, 0, 0]} maxBarSize={32} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-56 flex flex-col items-center justify-center text-center">
            <Inbox className="w-10 h-10 text-gray-200 dark:text-gray-700 mb-3" />
            <p className="text-sm text-gray-400 dark:text-gray-500 font-medium">{t("transactions_report.messages.no_data")}</p>
          </div>
        )}
      </div>

      {/* Daily grouped table */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-50 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{t("transactions_report.table.title")}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {data ? `${data.pagination.total} ${t("transactions_report.table.days")}` : ""}
            </p>
          </div>
          {data && data.data.length > 0 && (
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 hidden sm:block">
              {t("transactions_report.table.page_of", { page: data.pagination.page, total: data.pagination.total_pages })}
            </span>
          )}
        </div>

        {loading ? (
          <>
            {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
          </>
        ) : !data || data.data.length === 0 ? (
          <div className="p-10 text-center">
            <Inbox className="w-10 h-10 text-gray-200 dark:text-gray-700 mx-auto mb-3" />
            <p className="text-sm text-gray-400 dark:text-gray-500 font-medium">{t("transactions_report.messages.no_data")}</p>
          </div>
        ) : (
          <>
            {/* Mobile accordion */}
            <div className="lg:hidden divide-y divide-gray-50 dark:divide-slate-800">
              {data.data.map((g) => {
                const isOpen = expandedId === g.date;
                return (
                  <div key={g.date}>
                    <button
                      onClick={() => setExpandedId(isOpen ? null : g.date)}
                      className="w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-gray-50/30 dark:hover:bg-slate-800/30"
                    >
                      <div className="w-9 h-9 rounded-lg bg-primary-50 dark:bg-primary-500/10 flex items-center justify-center shrink-0">
                        <Calendar className="w-4 h-4 text-primary-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{formatDate(g.date, language)}</p>
                        <p className="text-[11px] text-gray-400 dark:text-gray-500">{g.retailer_count} {t("transactions_report.table.retailers")} • {g.record_count} {t("transactions_report.table.records")}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{formatNumber(g.total_value)}</p>
                        <p className="text-[10px] text-gray-400">BDT</p>
                      </div>
                      <ChevronDown className={cn("w-4 h-4 text-gray-400 shrink-0 transition-transform duration-200", isOpen && "rotate-180")} />
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-4 pt-1 space-y-2">
                        {g.retailers.map((r) => (
                          <div key={r.retailer_id} className="flex items-center justify-between py-1.5 border-t border-gray-50 dark:border-slate-800 text-sm">
                            <div className="min-w-0 pr-3">
                              <p className="font-semibold text-gray-900 dark:text-gray-100 truncate">{r.retailer_name}</p>
                              <p className="text-[11px] text-gray-400">{r.retailer_code}</p>
                            </div>
                            <span className="font-semibold text-gray-900 dark:text-gray-100 whitespace-nowrap">{formatNumber(r.value)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Desktop table */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-gray-50/50 dark:bg-slate-800/50 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest border-b border-gray-50 dark:border-slate-800">
                    <th className="px-4 py-3">{t("transactions_report.table.date")}</th>
                    <th className="px-4 py-3 text-right">{t("transactions_report.table.value")}</th>
                    <th className="px-4 py-3 text-center">{t("transactions_report.table.records")}</th>
                    <th className="px-4 py-3 text-center">{t("transactions_report.table.retailers")}</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                  {data.data.map((g) => {
                    const isOpen = expandedId === g.date;
                    return (
                      <Fragment key={g.date}>
                        <tr className="hover:bg-gray-50/30 dark:hover:bg-slate-800/30 transition-colors">
                          <td className="px-4 py-2.5">
                            <p className="font-medium text-gray-900 dark:text-gray-100">{formatDate(g.date, language)}</p>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <p className="font-bold text-gray-900 dark:text-gray-100">{formatNumber(g.total_value)}</p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">BDT</p>
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-1 rounded-md bg-gray-100 dark:bg-slate-800 text-xs font-semibold text-gray-600 dark:text-gray-300">
                              {formatNumber(g.record_count)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-1 rounded-md bg-emerald-50 dark:bg-emerald-500/10 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                              {formatNumber(g.retailer_count)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <button
                              onClick={() => setExpandedId(isOpen ? null : g.date)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-colors"
                            >
                              {isOpen ? t("transactions_report.table.hide_detail") : t("transactions_report.table.view_detail")}
                              <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", isOpen && "rotate-180")} />
                            </button>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-gray-50/40 dark:bg-slate-800/30">
                            <td colSpan={5} className="px-6 py-3">
                              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                                {g.retailers.map((r) => (
                                  <div key={r.retailer_id} className="flex items-center justify-between px-3 py-2 bg-white dark:bg-slate-900 rounded-lg border border-gray-100 dark:border-slate-800">
                                    <div className="min-w-0 pr-2">
                                      <p className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate">{r.retailer_name}</p>
                                      <p className="text-[11px] text-gray-400">{r.retailer_code}</p>
                                    </div>
                                    <span className="text-xs font-bold text-gray-900 dark:text-gray-100 whitespace-nowrap">{formatNumber(r.value)}</span>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {data.pagination.total_pages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-50 dark:border-slate-800">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {t("transactions_report.table.page_of", { page: data.pagination.page, total: data.pagination.total_pages })}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => changePage(data.pagination.page - 1)}
                    disabled={!data.pagination.has_prev}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
                  >
                    {t("transactions_report.table.prev")}
                  </button>
                  <span className="px-3 py-1.5 text-xs font-bold text-gray-700 dark:text-gray-200 bg-primary-50 dark:bg-primary-500/10 rounded-lg">
                    {data.pagination.page}
                  </span>
                  <button
                    onClick={() => changePage(data.pagination.page + 1)}
                    disabled={!data.pagination.has_next}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
                  >
                    {t("transactions_report.table.next")}
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

function TrendPill({ loading }: { loading: boolean }) {
  const { t } = useLanguage();
  if (loading) {
    return <div className="w-24 h-6 animate-pulse bg-gray-200 dark:bg-slate-700 rounded-full" />;
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-xs font-bold text-emerald-600 dark:text-emerald-400">
      <ArrowUp className="w-3.5 h-3.5" />
      {t("transactions_report.chart.daily")}
    </span>
  );
}