"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  BarChart3, TrendingUp, Target, Award, Users,
  RotateCcw, Download, Building2, Calendar,
  Zap, Clock, ArrowUp, ArrowDown, Medal,
  Trophy, PieChart, Activity, Sparkles,
  Settings, Tag, X as XIcon,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, LineChart, Line, Legend,
} from "recharts";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { useLanguage } from "@/i18n/useLanguage";

interface DashboardSummary {
  monthly_target: number;
  achievement: number;
  achievement_percentage: number;
  remaining: number;
  daily_required: number;
  daily_required_with_friday: number;
  remaining_fridays: number;
  daily_average: number;
  projection: number;
  expected_percentage: number;
  days_elapsed: number;
  days_remaining: number;
  total_days: number;
}

interface EmployeePerformance {
  id: number;
  name: string;
  target: number;
  achievement: number;
  percentage: number;
  remaining: number;
  daily_average: number;
  projection: number;
  status: string;
}

interface DailyTrend {
  date: string;
  actual: number | null;
  target: number;
  is_future: boolean;
}

interface DashboardData {
  success: boolean;
  summary: DashboardSummary;
  rso_performance: EmployeePerformance[];
  bp_performance: EmployeePerformance[];
  cc_performance: EmployeePerformance[];
  daily_trend: DailyTrend[];
  top_performers: {
    rso: EmployeePerformance[];
    bp: EmployeePerformance[];
    cc: EmployeePerformance[];
  };
}

const SkeletonCard = () => (
  <div className="animate-pulse bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 p-5 shadow-sm">
    <div className="h-3 w-24 bg-gray-200 dark:bg-slate-700 rounded-md mb-3" />
    <div className="h-7 w-32 bg-gray-200 dark:bg-slate-700 rounded-md mb-2" />
    <div className="h-2.5 w-20 bg-gray-100 dark:bg-slate-800 rounded-md" />
  </div>
);

const SkeletonRow = () => (
  <div className="flex items-center gap-4 px-6 py-4 animate-pulse border-b border-gray-50 dark:border-slate-800">
    <div className="w-8 h-8 rounded-lg bg-gray-200 dark:bg-slate-700 shrink-0" />
    <div className="space-y-2 flex-1">
      <div className="h-3 w-28 bg-gray-200 dark:bg-slate-700 rounded-md" />
      <div className="h-2.5 w-20 bg-gray-100 dark:bg-slate-800 rounded-md" />
    </div>
    <div className="hidden sm:block flex-1 space-y-2">
      <div className="h-3 w-16 bg-gray-200 dark:bg-slate-700 rounded-md" />
      <div className="h-2.5 w-12 bg-gray-100 dark:bg-slate-800 rounded-md" />
    </div>
    <div className="hidden md:block flex-1 space-y-2">
      <div className="h-3 w-12 bg-gray-200 dark:bg-slate-700 rounded-md" />
    </div>
    <div className="w-16 h-6 rounded-full bg-gray-200 dark:bg-slate-700" />
  </div>
);

const statusColors: Record<string, string> = {
  achieved: "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30",
  on_track: "bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-500/30",
  needs_attention: "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/30",
  behind: "bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-500/30",
};

const statusIcons: Record<string, any> = {
  achieved: Trophy,
  on_track: Zap,
  needs_attention: Clock,
  behind: ArrowDown,
};

const monthNames = {
  1: "January", 2: "February", 3: "March", 4: "April", 5: "May", 6: "June",
  7: "July", 8: "August", 9: "September", 10: "October", 11: "November", 12: "December",
};

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function KpiCard({ icon: Icon, label, value, valueColor, subtitle, trend, onConfig }: {
  icon: any; label: string; value: string | number;
  valueColor?: string; subtitle?: string; trend?: { dir: "up" | "down"; text: string };
  onConfig?: () => void;
}) {
  return (
    <div className="group bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 p-5 shadow-sm hover:shadow-md transition-shadow relative">
      {onConfig && (
        <button
          onClick={onConfig}
          className="absolute top-2 right-2 w-7 h-7 rounded-lg bg-gray-100 dark:bg-slate-800 opacity-0 group-hover:opacity-100 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-slate-700 transition-all duration-200 z-10"
        >
          <Settings className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
        </button>
      )}
      <div className="flex items-start justify-between">
        <div className="space-y-1.5">
          <p className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
            {label}
          </p>
          <p className={cn("text-2xl font-black tracking-tight", valueColor || "text-gray-900 dark:text-gray-100")}>
            {value}
          </p>
          {subtitle && (
            <p className="text-[10px] text-gray-400 dark:text-gray-500">{subtitle}</p>
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
          <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{trend.text}</span>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status, t }: { status: string; t: (key: string) => string }) {
  const Icon = statusIcons[status] || Activity;
  const labelMap: Record<string, string> = {
    achieved: t("activation_report.achieved_status"),
    on_track: t("activation_report.on_track"),
    needs_attention: t("activation_report.needs_attention"),
    behind: t("activation_report.behind"),
  };
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border",
      statusColors[status] || "bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-slate-700"
    )}>
      <Icon className="w-3 h-3" />
      {labelMap[status] || status}
    </span>
  );
}

function PerformanceTable({ data, t, type }: { data: EmployeePerformance[]; t: (key: string) => string; type: string }) {
  if (!data || data.length === 0) {
    const emptyKeys: Record<string, string> = {
      rso: "activation_report.no_data_rso",
      bp: "activation_report.no_data_bp",
      cc: "activation_report.no_data_cc",
    };
    return (
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 p-10 text-center">
        <Users className="w-10 h-10 text-gray-200 dark:text-gray-700 mx-auto mb-3" />
        <p className="text-sm text-gray-400 dark:text-gray-500 font-medium">{t(emptyKeys[type] || "activation_report.no_data")}</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-gray-50/50 dark:bg-slate-800/50 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest border-b border-gray-50 dark:border-slate-800">
              <th className="px-4 py-3 w-10">{t("activation_report.rank")}</th>
              <th className="px-4 py-3">{t("activation_report.employee")}</th>
              <th className="px-4 py-3 text-center">{t("activation_report.target")}</th>
              <th className="px-4 py-3 text-center">{t("activation_report.achieved")}</th>
              <th className="px-4 py-3 text-center hidden sm:table-cell">{t("activation_report.percentage")}</th>
              <th className="px-4 py-3 text-center hidden md:table-cell">{t("activation_report.remaining")}</th>
              <th className="px-4 py-3 text-center hidden lg:table-cell">{t("activation_report.daily_average")}</th>
              <th className="px-4 py-3 text-center hidden xl:table-cell">{t("activation_report.projection")}</th>
              <th className="px-4 py-3 text-center">{t("activation_report.status")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
            {data.map((emp, idx) => (
              <tr key={emp.id} className="hover:bg-gray-50/30 dark:hover:bg-slate-800/30 transition-colors">
                <td className="px-4 py-3">
                  <div className={cn(
                    "w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black",
                    idx === 0 ? "bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400" :
                    idx === 1 ? "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300" :
                    idx === 2 ? "bg-orange-100 dark:bg-orange-500/20 text-orange-600 dark:text-orange-400" :
                    "bg-gray-100 dark:bg-slate-800 text-gray-400 dark:text-gray-500"
                  )}>
                    {idx + 1}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{emp.name}</p>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{formatNumber(emp.target)}</span>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{formatNumber(emp.achievement)}</span>
                </td>
                <td className="px-4 py-3 text-center hidden sm:table-cell">
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-16 h-1.5 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-500",
                          emp.percentage >= 100 ? "bg-emerald-500" :
                          emp.percentage >= 70 ? "bg-blue-500" :
                          emp.percentage >= 40 ? "bg-amber-500" : "bg-rose-500"
                        )}
                        style={{ width: `${Math.min(emp.percentage, 100)}%` }}
                      />
                    </div>
                    <span className="text-xs font-bold text-gray-600 dark:text-gray-400 w-10 text-center">
                      {emp.percentage}%
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-center hidden md:table-cell">
                  <span className="text-sm text-gray-600 dark:text-gray-400">{formatNumber(emp.remaining)}</span>
                </td>
                <td className="px-4 py-3 text-center hidden lg:table-cell">
                  <span className="text-sm text-gray-600 dark:text-gray-400">{emp.daily_average.toFixed(1)}</span>
                </td>
                <td className="px-4 py-3 text-center hidden xl:table-cell">
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{formatNumber(Math.round(emp.projection))}</span>
                </td>
                <td className="px-4 py-3 text-center">
                  <StatusBadge status={emp.status} t={t} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LeaderboardCard({ data, title, icon: Icon, color, t }: {
  data: EmployeePerformance[]; title: string; icon: any; color: string; t: (key: string) => string
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
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-4">No data</p>
      ) : (
        <div className="space-y-2">
          {data.map((emp, idx) => (
            <div key={emp.id} className="flex items-center gap-3 py-1.5">
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
                  <span>{formatNumber(emp.achievement)} / {formatNumber(emp.target)}</span>
                </div>
              </div>
              <div className="text-right">
                <p className={cn(
                  "text-xs font-black",
                  emp.percentage >= 100 ? "text-emerald-600 dark:text-emerald-400" :
                  emp.percentage >= 70 ? "text-blue-600 dark:text-blue-400" :
                  emp.percentage >= 40 ? "text-amber-600 dark:text-amber-400" :
                  "text-rose-600 dark:text-rose-400"
                )}>
                  {emp.percentage}%
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ActivationDashboardPage() {
  const { selectedHouse, hasPermission, loading: authLoading } = useAuth();
  const router = useRouter();
  const { t, language } = useLanguage();

  const today = new Date();
  const [selectedHouseId, setSelectedHouseId] = useState<string>("");
  const [houses, setHouses] = useState<{ id: number; name: string; code: string; display_name: string }[]>([]);
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"rso" | "bp" | "cc">("rso");
  const [isDark, setIsDark] = useState(false);
  const [tags, setTags] = useState<{ id: number; name: string }[]>([]);
  const [selectedExcludeTags, setSelectedExcludeTags] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("activation_exclude_tags") || "[]"); }
    catch { return []; }
  });
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [excludedProductCodes, setExcludedProductCodes] = useState<{ id: number; product_code: string }[]>([]);
  const [selectedExcludeCodes, setSelectedExcludeCodes] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("activation_exclude_codes") || "[]"); }
    catch { return []; }
  });

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!authLoading && !hasPermission("reports.view")) {
      const timer = setTimeout(() => router.push("/"), 5000);
      return () => clearTimeout(timer);
    }
  }, [authLoading, hasPermission, router]);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { month, year };
      if (selectedHouseId) params.house_id = selectedHouseId;
      if (selectedExcludeTags.length > 0) params.exclude_tags = selectedExcludeTags.join(",");
      if (selectedExcludeCodes.length > 0) params.exclude_codes = selectedExcludeCodes.join(",");
      const res = await apiClient.get("reports/activations/dashboard", { params });
      setData(res.data);
    } catch {
      toast.error(t("activation_report.error_loading"));
    } finally {
      setLoading(false);
    }
  }, [month, year, selectedHouseId, selectedExcludeTags, selectedExcludeCodes, t]);

  useEffect(() => {
    if (!authLoading && hasPermission("reports.view")) {
      apiClient.get("houses/accessible").then(res => {
        setHouses(res.data);
      }).catch(() => {});
      apiClient.get("filter-tags").then(res => {
        setTags(res.data);
      }).catch(() => {});
      apiClient.get("product-exclusions").then(res => {
        setExcludedProductCodes(res.data);
      }).catch(() => {});
    }
  }, [authLoading, hasPermission]);

  useEffect(() => {
    localStorage.setItem("activation_exclude_tags", JSON.stringify(selectedExcludeTags));
  }, [selectedExcludeTags]);

  useEffect(() => {
    localStorage.setItem("activation_exclude_codes", JSON.stringify(selectedExcludeCodes));
  }, [selectedExcludeCodes]);

  useEffect(() => {
    if (!authLoading && hasPermission("reports.view")) {
      fetchDashboard();
    }
  }, [authLoading, hasPermission, fetchDashboard]);

  const handleExport = async () => {
    try {
      const params: Record<string, any> = { month, year };
      if (selectedHouseId) params.house_id = selectedHouseId;
      const res = await apiClient.get("reports/activations/dashboard/export", {
        params,
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `activation_dashboard_${year}_${month}.xlsx`);
      document.body.appendChild(link);
      link.click();
      toast.success(t("activation_report.export_success"));
    } catch {
      toast.error(t("activation_report.export_failed"));
    }
  };

  const getMonthName = (m: number) => {
    if (language === 'bn') {
      const bnMonths: Record<number, string> = {
        1: "জানুয়ারি", 2: "ফেব্রুয়ারি", 3: "মার্চ", 4: "এপ্রিল",
        5: "মে", 6: "জুন", 7: "জুলাই", 8: "আগস্ট",
        9: "সেপ্টেম্বর", 10: "অক্টোবর", 11: "নভেম্বর", 12: "ডিসেম্বর"
      };
      return bnMonths[m] || "";
    }
    return monthNames[m as keyof typeof monthNames] || "";
  };

  if (!authLoading && !hasPermission("reports.view")) {
    return <AccessDenied />;
  }

  const s = data?.summary;
  const top = data?.top_performers;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t("activation_report.dashboard_title")}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t("activation_report.dashboard_subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {houses.length > 1 && (
            <div className="relative">
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <select
                value={selectedHouseId}
                onChange={(e) => { setSelectedHouseId(e.target.value); }}
                className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg text-sm font-medium text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors shadow-sm outline-none focus:ring-2 focus:ring-primary-500 appearance-none cursor-pointer min-w-[160px]"
              >
                <option value="">{t("activation_report.all_houses")}</option>
                {houses.map((h) => (
                  <option key={h.id} value={h.id}>{h.display_name}</option>
                ))}
              </select>
            </div>
          )}
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg text-sm font-medium text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary-500 appearance-none cursor-pointer"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>{getMonthName(m)}</option>
              ))}
            </select>
          </div>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="px-3 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg text-sm font-medium text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary-500"
          >
            {Array.from({ length: 5 }, (_, i) => today.getFullYear() - 2 + i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-bold hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors shadow-sm"
          >
            <Download className="w-4 h-4" />
            {t("activation_report.export_dashboard")}
          </button>
          <button
            onClick={fetchDashboard}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-bold hover:bg-primary-600 transition-colors shadow-sm disabled:opacity-50"
          >
            <RotateCcw className={cn("w-4 h-4", loading && "animate-spin")} />
            {t("activation_report.refresh")}
          </button>
        </div>
      </div>

      {loading && !data ? (
        <>
          {/* Summary Skeleton */}
          <div className="grid grid-cols-2 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
          {/* Charts Skeleton */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="animate-pulse bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 p-6">
                <div className="h-4 w-36 bg-gray-200 dark:bg-slate-700 rounded-md mb-4" />
                <div className="h-48 bg-gray-100 dark:bg-slate-800 rounded-lg" />
              </div>
            ))}
          </div>
          {/* Table Skeleton */}
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-50 dark:border-slate-800">
              <div className="h-4 w-24 bg-gray-200 dark:bg-slate-700 rounded-md" />
            </div>
            {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
          </div>
        </>
      ) : data && s ? (
        <>
          {/* Summary KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              icon={Target}
              label={t("activation_report.monthly_target")}
              value={formatNumber(s.monthly_target)}
              valueColor="text-gray-900 dark:text-gray-100"
              subtitle={`${t("activation_report.days_elapsed")}: ${s.days_elapsed} / ${s.total_days}`}
            />
            <KpiCard
              icon={TrendingUp}
              label={t("activation_report.achievement")}
              value={formatNumber(s.achievement)}
              valueColor="text-emerald-600 dark:text-emerald-400"
              subtitle={`${s.achievement_percentage}% of target`}
              onConfig={hasPermission("reports.achievement.config") ? () => setShowConfigModal(true) : undefined}
            />
            <KpiCard
              icon={Award}
              label={t("activation_report.achievement_pct")}
              value={`${s.achievement_percentage}%`}
              valueColor={
                s.achievement_percentage >= 100 ? "text-emerald-600 dark:text-emerald-400" :
                s.achievement_percentage >= 70 ? "text-blue-600 dark:text-blue-400" :
                s.achievement_percentage >= 40 ? "text-amber-600 dark:text-amber-400" :
                "text-rose-600 dark:text-rose-400"
              }
              subtitle={`${t("activation_report.expected_pct")}: ${s.expected_percentage}%`}
            />
            <KpiCard
              icon={BarChart3}
              label={t("activation_report.remaining")}
              value={formatNumber(s.remaining)}
              valueColor="text-amber-600 dark:text-amber-400"
              subtitle={t("activation_report.days_remaining") + ": " + s.days_remaining}
            />
            <KpiCard
              icon={Activity}
              label={t("activation_report.daily_average")}
              value={s.daily_average.toFixed(1)}
              valueColor="text-blue-600 dark:text-blue-400"
              subtitle={t("activation_report.days_elapsed") + ": " + s.days_elapsed}
            />
            <KpiCard
              icon={Zap}
              label={t("activation_report.daily_required")}
              value={s.daily_required}
              valueColor="text-purple-600 dark:text-purple-400"
              subtitle={`${t("activation_report.with_friday")}: ${s.daily_required_with_friday} | ${t("activation_report.remaining_fridays")}: ${s.remaining_fridays}`}
            />
            <KpiCard
              icon={Trophy}
              label={t("activation_report.projection")}
              value={formatNumber(Math.round(s.projection))}
              valueColor={
                s.expected_percentage >= 100 ? "text-emerald-600 dark:text-emerald-400" :
                s.expected_percentage >= 70 ? "text-blue-600 dark:text-blue-400" :
                "text-amber-600 dark:text-amber-400"
              }
              subtitle={`${t("activation_report.expected_pct")}: ${s.expected_percentage}%`}
            />
            <KpiCard
              icon={Sparkles}
              label={t("activation_report.expected_pct")}
              value={`${s.expected_percentage}%`}
              valueColor={
                s.expected_percentage >= 100 ? "text-emerald-600 dark:text-emerald-400" :
                s.expected_percentage >= 70 ? "text-blue-600 dark:text-blue-400" :
                "text-amber-600 dark:text-amber-400"
              }
              subtitle={`${formatNumber(Math.round(s.projection))} / ${formatNumber(s.monthly_target)}`}
            />
          </div>

          {/* Charts Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Daily Trend Chart */}
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm p-6">
              <h2 className="font-bold text-base flex items-center gap-2 dark:text-gray-100 mb-4">
                <TrendingUp className="w-5 h-5 text-primary-600 dark:text-primary-400" />
                {t("activation_report.daily_trend")}
              </h2>
              {data.daily_trend.length > 0 ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.daily_trend.filter(d => !d.is_future)} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#334155" : "#e5e7eb"} />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10, fill: isDark ? "#94a3b8" : "#64748b" }}
                        tickFormatter={(val) => {
                          const d = new Date(val);
                          return d.toLocaleDateString("en", { day: "numeric" });
                        }}
                        stroke={isDark ? "#475569" : "#cbd5e1"}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 11, fill: isDark ? "#94a3b8" : "#64748b" }}
                        stroke={isDark ? "#475569" : "#cbd5e1"}
                      />
                      <Tooltip
                        contentStyle={{
                          borderRadius: "12px",
                          border: isDark ? "1px solid #334155" : "1px solid #e5e7eb",
                          fontSize: "13px",
                          backgroundColor: isDark ? "#1e293b" : "#ffffff",
                          color: isDark ? "#e2e8f0" : "#1e293b",
                        }}
                        labelFormatter={(val) => new Date(val).toLocaleDateString("en", {
                          weekday: "short", month: "short", day: "numeric"
                        })}
                        formatter={(value: any) => [value, "Activations"]}
                      />
                      <Bar
                        dataKey="actual"
                        radius={[4, 4, 0, 0]}
                        fill="#3b82f6"
                        maxBarSize={24}
                        name="Actual"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center">
                  <p className="text-sm text-gray-400">{t("activation_report.no_data")}</p>
                </div>
              )}
            </div>

            {/* Target vs Achievement */}
            <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm p-6">
              <h2 className="font-bold text-base flex items-center gap-2 dark:text-gray-100 mb-4">
                <PieChart className="w-5 h-5 text-primary-600 dark:text-primary-400" />
                {t("activation_report.target_vs_achievement")}
              </h2>
              <div className="space-y-6">
                <div className="text-center">
                  <p className="text-4xl font-black text-gray-900 dark:text-gray-100">{s.achievement_percentage}%</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t("activation_report.achievement_pct")}</p>
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                      <span>{t("activation_report.achievement")}</span>
                      <span>{formatNumber(s.achievement)} / {formatNumber(s.monthly_target)}</span>
                    </div>
                    <div className="h-3 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-700",
                          s.achievement_percentage >= 100 ? "bg-emerald-500" :
                          s.achievement_percentage >= 70 ? "bg-blue-500" :
                          s.achievement_percentage >= 40 ? "bg-amber-500" : "bg-rose-500"
                        )}
                        style={{ width: `${Math.min(s.achievement_percentage, 100)}%` }}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div className="bg-gray-50 dark:bg-slate-800/50 rounded-lg p-3 text-center">
                      <p className="text-xs text-gray-500 dark:text-gray-400">{t("activation_report.daily_average")}</p>
                      <p className="text-lg font-black text-gray-900 dark:text-gray-100">{s.daily_average.toFixed(1)}</p>
                    </div>
                    <div className="bg-gray-50 dark:bg-slate-800/50 rounded-lg p-3 text-center">
                      <p className="text-xs text-gray-500 dark:text-gray-400">{t("activation_report.remaining")}</p>
                      <p className="text-lg font-black text-amber-600 dark:text-amber-400">{formatNumber(s.remaining)}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Top Performers Leaderboard */}
          {top && (top.rso.length > 0 || top.bp.length > 0 || top.cc.length > 0) && (
            <div>
              <h2 className="font-bold text-base flex items-center gap-2 dark:text-gray-100 mb-4">
                <Medal className="w-5 h-5 text-amber-500" />
                {t("activation_report.top_performers")}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {top.rso.length > 0 && (
                  <LeaderboardCard
                    data={top.rso}
                    title={t("activation_report.rso_performance")}
                    icon={Users}
                    color="bg-blue-500"
                    t={t}
                  />
                )}
                {top.bp.length > 0 && (
                  <LeaderboardCard
                    data={top.bp}
                    title={t("activation_report.bp_performance")}
                    icon={Users}
                    color="bg-purple-500"
                    t={t}
                  />
                )}
                {top.cc.length > 0 && (
                  <LeaderboardCard
                    data={top.cc}
                    title={t("activation_report.cc_performance")}
                    icon={Users}
                    color="bg-emerald-500"
                    t={t}
                  />
                )}
              </div>
            </div>
          )}

          {/* Employee Performance Tabs */}
          <div>
            <div className="flex items-center gap-1 mb-4 bg-gray-100 dark:bg-slate-800 rounded-lg p-1 w-fit">
              {(["rso", "bp", "cc"] as const).map((tab) => {
                const labels: Record<string, string> = {
                  rso: t("activation_report.rso_performance"),
                  bp: t("activation_report.bp_performance"),
                  cc: t("activation_report.cc_performance"),
                };
                const icons: Record<string, any> = {
                  rso: Users,
                  bp: Building2,
                  cc: BarChart3,
                };
                const Icon = icons[tab];
                return (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all",
                      activeTab === tab
                        ? "bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 shadow-sm"
                        : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    {labels[tab]}
                    {tab === "rso" && data.rso_performance.length > 0 && (
                      <span className="text-[10px] bg-primary-100 dark:bg-primary-500/20 text-primary-600 dark:text-primary-400 px-1.5 py-0.5 rounded-full font-bold">
                        {data.rso_performance.length}
                      </span>
                    )}
                    {tab === "bp" && data.bp_performance.length > 0 && (
                      <span className="text-[10px] bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400 px-1.5 py-0.5 rounded-full font-bold">
                        {data.bp_performance.length}
                      </span>
                    )}
                    {tab === "cc" && data.cc_performance.length > 0 && (
                      <span className="text-[10px] bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded-full font-bold">
                        {data.cc_performance.length}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {activeTab === "rso" && (
              <PerformanceTable data={data.rso_performance} t={t} type="rso" />
            )}
            {activeTab === "bp" && (
              <PerformanceTable data={data.bp_performance} t={t} type="bp" />
            )}
            {activeTab === "cc" && (
              <PerformanceTable data={data.cc_performance} t={t} type="cc" />
            )}
          </div>
        </>
      ) : !loading && !data ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm py-20 text-center">
          <BarChart3 className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
          <p className="text-gray-500 dark:text-gray-400 font-medium">{t("activation_report.no_data")}</p>
        </div>
      ) : null}

      {/* Config Modal */}
      {hasPermission("reports.achievement.config") && showConfigModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={() => setShowConfigModal(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-2xl w-full max-w-lg max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-50 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-primary-50 dark:bg-primary-500/10 flex items-center justify-center">
                  <Settings className="w-5 h-5 text-primary-600 dark:text-primary-400" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-gray-900 dark:text-gray-100">{t("activation_report.config_title")}</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{t("activation_report.config_desc")}</p>
                </div>
              </div>
              <button
                onClick={() => setShowConfigModal(false)}
                className="w-8 h-8 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 flex items-center justify-center transition-colors"
              >
                <XIcon className="w-4 h-4 text-gray-400" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto max-h-[calc(80vh-80px)] space-y-6">
              {/* Tags Section */}
              <div className="space-y-3">
                <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t("activation_report.exclude_tags")}</p>
                <p className="text-[11px] text-gray-400 dark:text-gray-500">{t("activation_report.exclude_tags_hint")}</p>
                {tags.length === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">{t("activation_report.no_tags")}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {tags.map(tag => {
                      const isSelected = selectedExcludeTags.includes(tag.name);
                      return (
                        <button
                          key={tag.id}
                          onClick={() => {
                            setSelectedExcludeTags(prev =>
                              isSelected ? prev.filter(t => t !== tag.name) : [...prev, tag.name]
                            );
                          }}
                          className={cn(
                            "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border",
                            isSelected
                              ? "bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-400"
                              : "bg-gray-50 dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-slate-600"
                          )}
                        >
                          <Tag className="w-3 h-3" />
                          {tag.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Product Codes Section */}
              <div className="space-y-3">
                <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t("activation_report.exclude_product_codes")}</p>
                <p className="text-[11px] text-gray-400 dark:text-gray-500">{t("activation_report.exclude_product_codes_hint")}</p>
                {excludedProductCodes.length === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">{t("activation_report.no_excluded_codes")}</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {excludedProductCodes.map(item => {
                      const isSelected = selectedExcludeCodes.includes(item.product_code);
                      return (
                        <button
                          key={item.id}
                          onClick={() => {
                            setSelectedExcludeCodes(prev =>
                              isSelected ? prev.filter(c => c !== item.product_code) : [...prev, item.product_code]
                            );
                          }}
                          className={cn(
                            "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border",
                            isSelected
                              ? "bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-400 line-through"
                              : "bg-gray-50 dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-slate-600"
                          )}
                        >
                          {item.product_code}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 p-5 border-t border-gray-50 dark:border-slate-800">
              <button
                onClick={() => { setSelectedExcludeTags([]); setSelectedExcludeCodes([]); }}
                className="px-4 py-2 text-sm font-bold text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
              >
                {t("common.reset")}
              </button>
              <button
                onClick={() => { setShowConfigModal(false); fetchDashboard(); }}
                className="px-5 py-2 bg-primary-500 text-white rounded-lg text-sm font-bold hover:bg-primary-600 transition-colors shadow-sm"
              >
                {t("common.save_changes")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
