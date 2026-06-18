"use client";

import { useEffect, useState, useCallback } from "react";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  Target,
  TrendingUp,
  TrendingDown,
  Crosshair,
  Users,
  Building2,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/useLanguage";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine,
} from "recharts";

interface TargetCategory {
  key: string;
  label_en: string;
  label_bn: string;
  target: number;
  achieved: number;
  percentage: number;
  remaining: number;
  projected: number;
  status: string;
}

interface TargetSummary {
  total_target: number;
  total_achieved: number;
  overall_percentage: number;
  projected_percentage: number;
}

interface HouseTargetData {
  level: string;
  house_id: number;
  target_date: string;
  days_elapsed: number;
  days_remaining: number;
  categories: TargetCategory[];
  daily_trend: { date: string; actual: number }[];
  summary: TargetSummary;
}

interface House {
  id: number;
  name: string;
  code: string;
  display_name: string;
}

export default function ManagerDashboard() {
  const [data, setData] = useState<HouseTargetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [houses, setHouses] = useState<House[]>([]);
  const [selectedHouseId, setSelectedHouseId] = useState<string>("");
  const { user, loading: authLoading, hasPermission } = useAuth();
  const { t, language } = useLanguage();
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (authLoading) return;
    apiClient.get("houses/accessible").then(res => {
      const h = res.data || [];
      setHouses(h);
      if (h.length === 1) setSelectedHouseId(String(h[0].id));
    }).catch(() => {});
  }, [authLoading]);

  const fetchData = useCallback(async () => {
    if (!hasPermission("reports.target_achievement")) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (selectedHouseId) params.house_id = selectedHouseId;
      const res = await apiClient.get("reports/target-achievement", { params });
      setData(res.data?.data || null);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [selectedHouseId, hasPermission]);

  useEffect(() => {
    if (!authLoading) fetchData();
  }, [fetchData, authLoading]);

  const statusColor = (status: string) => {
    switch (status) {
      case "achieved": return "text-green-600 bg-green-50 dark:bg-green-500/10 dark:text-green-400";
      case "on_track": return "text-blue-600 bg-blue-50 dark:bg-blue-500/10 dark:text-blue-400";
      case "needs_attention": return "text-amber-600 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-400";
      case "behind": return "text-red-600 bg-red-50 dark:bg-red-500/10 dark:text-red-400";
      default: return "text-gray-600 bg-gray-50 dark:bg-gray-500/10 dark:text-gray-400";
    }
  };

  const statusLabel = (status: string) => {
    const key = `target_achievement.status_${status}`;
    const val = t(key);
    return val === key ? status.replace("_", " ") : val;
  };

  if (!authLoading && !hasPermission("reports.target_achievement")) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Target className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400">{t('common.access_denied')}</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6 p-4 md:p-6 max-w-7xl mx-auto animate-pulse">
        <div className="h-8 w-64 bg-gray-200 dark:bg-slate-700 rounded-lg" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 bg-gray-200 dark:bg-slate-700 rounded-2xl" />
          ))}
        </div>
        <div className="h-64 bg-gray-200 dark:bg-slate-700 rounded-2xl" />
        <div className="h-48 bg-gray-200 dark:bg-slate-700 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            {t('target_achievement.title')}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t('target_achievement.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {houses.length > 1 && (
            <div className="relative">
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <select
                value={selectedHouseId}
                onChange={(e) => setSelectedHouseId(e.target.value)}
                className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg text-sm font-medium text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors shadow-sm outline-none focus:ring-2 focus:ring-primary-500 appearance-none cursor-pointer"
              >
                <option value="">{t('common.all')}</option>
                {houses.map((h) => (
                  <option key={h.id} value={h.id}>{h.display_name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {!data ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Target className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4" />
          <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">
            {t('target_achievement.no_target')}
          </h3>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <SummaryCard
              title={t('target_achievement.target')}
              value={data.summary.total_target.toLocaleString()}
              icon={Crosshair}
              color="bg-blue-500"
            />
            <SummaryCard
              title={t('target_achievement.achieved')}
              value={data.summary.total_achieved.toLocaleString()}
              icon={TrendingUp}
              color="bg-green-500"
            />
            <SummaryCard
              title={t('target_achievement.percentage')}
              value={`${data.summary.overall_percentage}%`}
              icon={Target}
              color={data.summary.overall_percentage >= 70 ? "bg-green-500" : data.summary.overall_percentage >= 40 ? "bg-amber-500" : "bg-red-500"}
            />
            <SummaryCard
              title={t('target_achievement.projected')}
              value={`${data.summary.projected_percentage}%`}
              icon={TrendingUp}
              color="bg-purple-500"
              subtitle={`${data.days_elapsed}d ${t('target_achievement.days_elapsed').toLowerCase()}, ${data.days_remaining}d ${t('target_achievement.days_remaining').toLowerCase()}`}
            />
          </div>

          {/* Category-wise Progress */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-6">
            <h2 className="font-bold text-lg mb-4 dark:text-gray-100 flex items-center gap-2">
              <Target className="w-5 h-5 text-primary-500" />
              {t('target_achievement.overall')}
            </h2>
            <div className="space-y-4">
              {data.categories.map((cat) => (
                <div key={cat.key}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {language === "bn" ? cat.label_bn : cat.label_en}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {cat.achieved}/{cat.target}
                      </span>
                      <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full", statusColor(cat.status))}>
                        {cat.percentage}%
                      </span>
                    </div>
                  </div>
                  <div className="w-full h-2.5 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-500",
                        cat.percentage >= 100 ? "bg-green-500" :
                        cat.percentage >= 70 ? "bg-blue-500" :
                        cat.percentage >= 40 ? "bg-amber-500" : "bg-red-500"
                      )}
                      style={{ width: `${Math.min(cat.percentage, 100)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className={cn("text-[10px] font-medium", statusColor(cat.status))}>
                      {statusLabel(cat.status)}
                    </span>
                    <span className="text-[10px] text-gray-400 dark:text-gray-500">
                      {t('target_achievement.remaining')}: {cat.remaining.toLocaleString()} | {t('target_achievement.projected')}: {Math.round(cat.projected).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Daily Trend Chart */}
          {data.daily_trend && data.daily_trend.length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-lg dark:text-gray-100 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-primary-500" />
                  {t('target_achievement.daily_trend')}
                </h2>
              </div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.daily_trend} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#334155" : "#e5e7eb"} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: isDark ? "#94a3b8" : "#64748b" }}
                      tickFormatter={(val: string) => {
                        const d = new Date(val + "T00:00:00");
                        return d.toLocaleDateString("en", { month: "short", day: "numeric" });
                      }}
                      stroke={isDark ? "#475569" : "#cbd5e1"}
                    />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: isDark ? "#94a3b8" : "#64748b" }} stroke={isDark ? "#475569" : "#cbd5e1"} />
                    <Tooltip
                      contentStyle={{
                        borderRadius: "12px",
                        border: isDark ? "1px solid #334155" : "1px solid #e5e7eb",
                        fontSize: "13px",
                        backgroundColor: isDark ? "#1e293b" : "#ffffff",
                        color: isDark ? "#e2e8f0" : "#1e293b",
                      }}
                      labelFormatter={(val: any) => typeof val === 'string' ? new Date(val + "T00:00:00").toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" }) : val}
                    />
                    <Bar dataKey="actual" radius={[6, 6, 0, 0]} fill="#f97316" maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Info Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-6">
              <h3 className="font-semibold text-sm text-gray-500 dark:text-gray-400 mb-2">
                {t('target_achievement.days_elapsed')}
              </h3>
              <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                {data.days_elapsed}
                <span className="text-base font-normal text-gray-400 dark:text-gray-500 ml-1">
                  / {data.days_elapsed + data.days_remaining}
                </span>
              </p>
            </div>
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-6">
              <h3 className="font-semibold text-sm text-gray-500 dark:text-gray-400 mb-2">
                {t('target_achievement.days_remaining')}
              </h3>
              <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                {data.days_remaining}
                <span className="text-base font-normal text-gray-400 dark:text-gray-500 ml-1">
                  {t('target_achievement.days_remaining').toLowerCase()}
                </span>
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  title,
  value,
  icon: Icon,
  color,
  subtitle,
}: {
  title: string;
  value: string;
  icon: React.ElementType;
  color: string;
  subtitle?: string;
}) {
  return (
    <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm hover:shadow-md transition-all duration-300">
      <div className="flex justify-between items-start mb-4">
        <div className={cn("p-3 rounded-xl text-white shadow-lg", color)}>
          <Icon className="w-6 h-6" />
        </div>
      </div>
      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{title}</p>
      <h3 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">{value}</h3>
      {subtitle && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{subtitle}</p>
      )}
    </div>
  );
}
