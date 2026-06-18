"use client";

import { useEffect, useState, useCallback } from "react";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  Target,
  TrendingUp,
  Users,
  Crosshair,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/useLanguage";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
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
  active_rso_count?: number;
}

interface RSOProgress {
  level: string;
  rso_employee_id: number;
  rso_name: string;
  categories: TargetCategory[];
  summary: TargetSummary;
  daily_trend: { date: string; actual: number }[];
}

interface SupervisorData {
  level: string;
  supervisor_employee_id: number;
  categories: TargetCategory[];
  summary: TargetSummary;
  daily_trend: { date: string; actual: number }[];
  rso_breakdown: RSOProgress[];
}

export default function SupervisorDashboard() {
  const [data, setData] = useState<SupervisorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedRso, setExpandedRso] = useState<number | null>(null);
  const { loading: authLoading, hasPermission } = useAuth();
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

  const fetchData = useCallback(async () => {
    if (!hasPermission("reports.target_achievement")) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await apiClient.get("reports/my-target-progress");
      const d = res.data?.data;
      if (d && d.level === "supervisor") {
        setData(d);
      } else {
        setData(null);
      }
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [hasPermission]);

  useEffect(() => {
    if (!authLoading) fetchData();
  }, [fetchData, authLoading]);

  const statusColor = (status: string) => {
    switch (status) {
      case "achieved": return "text-green-600 bg-green-50 dark:bg-green-500/10 dark:text-green-400";
      case "on_track": return "text-blue-600 bg-blue-50 dark:bg-blue-500/10 dark:text-blue-400";
      case "needs_attention": return "text-amber-600 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-400";
      case "behind": return "text-red-600 bg-red-50 dark:bg-red-500/10 dark:text-red-400";
      default: return "text-gray-600 bg-gray-50";
    }
  };

  const progressBarColor = (pct: number) => {
    if (pct >= 100) return "bg-green-500";
    if (pct >= 70) return "bg-blue-500";
    if (pct >= 40) return "bg-amber-500";
    return "bg-red-500";
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
        <div className="h-48 bg-gray-200 dark:bg-slate-700 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-500">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
          {t('target_achievement.my_progress')}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {t('target_achievement.subtitle')}
        </p>
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
            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{t('target_achievement.target')}</p>
              <h3 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">{data.summary.total_target.toLocaleString()}</h3>
            </div>
            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{t('target_achievement.achieved')}</p>
              <h3 className="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">{data.summary.total_achieved.toLocaleString()}</h3>
            </div>
            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{t('target_achievement.percentage')}</p>
              <h3 className={cn("text-2xl font-bold mt-1", data.summary.overall_percentage >= 70 ? "text-green-600" : "text-amber-600")}>
                {data.summary.overall_percentage}%
              </h3>
            </div>
            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{t('target_achievement.projected')}</p>
              <h3 className="text-2xl font-bold text-purple-600 dark:text-purple-400 mt-1">{data.summary.projected_percentage}%</h3>
            </div>
          </div>

          {/* Supervisor's Own Target Progress */}
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
                      <span className="text-xs text-gray-500">{cat.achieved}/{cat.target}</span>
                      <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full", statusColor(cat.status))}>
                        {cat.percentage}%
                      </span>
                    </div>
                  </div>
                  <div className="w-full h-2 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all", progressBarColor(cat.percentage))} style={{ width: `${Math.min(cat.percentage, 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* RSO Performance Table */}
          {data.rso_breakdown && data.rso_breakdown.length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
              <div className="p-6 border-b border-gray-50 dark:border-slate-800">
                <h2 className="font-bold text-lg dark:text-gray-100 flex items-center gap-2">
                  <Users className="w-5 h-5 text-primary-500" />
                  {t('target_achievement.rso_breakdown')}
                  <span className="text-xs font-bold bg-primary-50 dark:bg-primary-500/10 text-primary-600 dark:text-primary-400 px-2 py-0.5 rounded-full">
                    {data.rso_breakdown.length}
                  </span>
                </h2>
              </div>
              <div className="divide-y divide-gray-50 dark:divide-slate-800">
                {data.rso_breakdown.map((rso) => (
                  <div key={rso.rso_employee_id}>
                    <button
                      onClick={() => setExpandedRso(expandedRso === rso.rso_employee_id ? null : rso.rso_employee_id)}
                      className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50/50 dark:hover:bg-slate-800/50 transition-colors text-left"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-500/20 flex items-center justify-center text-primary-600 dark:text-primary-400 font-bold text-xs">
                          {rso.rso_name?.charAt(0) || "R"}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{rso.rso_name || `RSO #${rso.rso_employee_id}`}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-gray-500">{t('target_achievement.target')}: {rso.summary.total_target}</span>
                            <span className="text-xs text-gray-400">|</span>
                            <span className={cn("text-xs font-semibold", rso.summary.overall_percentage >= 70 ? "text-green-600" : "text-red-500")}>
                              {rso.summary.overall_percentage}%
                            </span>
                          </div>
                        </div>
                      </div>
                      {expandedRso === rso.rso_employee_id ? (
                        <ChevronDown className="w-4 h-4 text-gray-400" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-gray-400" />
                      )}
                    </button>
                    {expandedRso === rso.rso_employee_id && (
                      <div className="px-6 pb-4 pl-16 space-y-3">
                        {rso.categories.map((cat) => (
                          <div key={cat.key}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                                {language === "bn" ? cat.label_bn : cat.label_en}
                              </span>
                              <span className={cn("text-xs font-bold", statusColor(cat.status))}>
                                {cat.percentage}%
                              </span>
                            </div>
                            <div className="w-full h-1.5 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
                              <div className={cn("h-full rounded-full", progressBarColor(cat.percentage))} style={{ width: `${Math.min(cat.percentage, 100)}%` }} />
                            </div>
                          </div>
                        ))}
                        <div className="flex items-center gap-4 pt-2 text-xs text-gray-400 dark:text-gray-500 border-t border-gray-50 dark:border-slate-800">
                          <span>{t('target_achievement.achieved')}: {rso.summary.total_achieved}</span>
                          <span>{t('target_achievement.projected')}: {rso.summary.projected_percentage}%</span>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Daily Trend */}
          {data.daily_trend && data.daily_trend.length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-6">
              <h2 className="font-bold text-lg mb-4 dark:text-gray-100 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-primary-500" />
                {t('target_achievement.daily_trend')}
              </h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.daily_trend} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#334155" : "#e5e7eb"} />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: isDark ? "#94a3b8" : "#64748b" }} tickFormatter={(v: string) => new Date(v + "T00:00:00").toLocaleDateString("en", { month: "short", day: "numeric" })} stroke={isDark ? "#475569" : "#cbd5e1"} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: isDark ? "#94a3b8" : "#64748b" }} stroke={isDark ? "#475569" : "#cbd5e1"} />
                    <Tooltip contentStyle={{ borderRadius: "12px", border: isDark ? "1px solid #334155" : "1px solid #e5e7eb", fontSize: "13px", backgroundColor: isDark ? "#1e293b" : "#ffffff", color: isDark ? "#e2e8f0" : "#1e293b" }} labelFormatter={(v: any) => typeof v === 'string' ? new Date(v + "T00:00:00").toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" }) : v} />
                    <Bar dataKey="actual" radius={[6, 6, 0, 0]} fill="#f97316" maxBarSize={40} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
