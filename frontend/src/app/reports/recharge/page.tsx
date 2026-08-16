"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  BarChart3, TrendingUp, Target, Award, Users,
  RotateCcw, Download, Share2, Building2, Calendar,
  Zap, Clock, ArrowUp, ArrowDown, Medal,
  Trophy, PieChart, Activity, Sparkles,
  ChevronDown, BatteryCharging,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis,
  CartesianGrid,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import { exportRechargeReport } from "@/lib/export-recharge";
import { toast } from "react-hot-toast";
import { AccessDenied } from "@/components/ui/AccessDenied";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { useLanguage } from "@/i18n/useLanguage";

interface DashboardSummary {
  monthly_target: number;
  ev_c2c_target: number;
  sc_primary_target: number;
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
  yesterday_achievement: number;
  previous_month_target: number;
  previous_month_achievement: number;
}

interface EmployeePerformance {
  id: number;
  name: string;
  target: number;
  ev_target?: number;
  sc_target?: number;
  achievement: number;
  percentage: number;
  remaining: number;
  daily_average: number;
  projection: number;
  status: string;
  employee_type?: string;
  itop_number?: string;
  pool_number?: string;
  yesterday_achievement?: number;
  yesterday_c2c?: number;
  yesterday_c2s?: number;
  yesterday_transaction_count?: number;
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
  supervisor_performance: EmployeePerformance[];
  daily_trend: DailyTrend[];
  top_performers: {
    rso: EmployeePerformance[];
    supervisor: EmployeePerformance[];
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
  return Math.round(n).toLocaleString();
}

function KpiCard({ icon: Icon, label, value, valueColor, valueExtra, subtitle, trend }: {
  icon: any; label: string; value: string | number;
  valueColor?: string; valueExtra?: React.ReactNode; subtitle?: string | React.ReactNode; trend?: { dir: "up" | "down"; text: string };
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

function StatusBadge({ status, t }: { status: string; t: (key: string) => string }) {
  const Icon = statusIcons[status] || Activity;
  const labelMap: Record<string, string> = {
    achieved: t("recharge_report.achieved_status"),
    on_track: t("recharge_report.on_track"),
    needs_attention: t("recharge_report.needs_attention"),
    behind: t("recharge_report.behind"),
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

function projectionStatus(achPct: number, projPct: number): string {
  if (achPct >= 100) return "achieved";
  if (projPct >= 100) return "on_track";
  if (projPct >= 95) return "needs_attention";
  return "behind";
}

function PerformanceTable({ data, t, type, reportType, daysElapsed, daysRemaining }: { data: EmployeePerformance[]; t: (key: string) => string; type: string; reportType: "recharge" | "ev_secondary"; daysElapsed: number; daysRemaining: number }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (!data || data.length === 0) {
    const emptyKeys: Record<string, string> = {
      rso: "recharge_report.no_data_rso",
      supervisor: "recharge_report.no_data_supervisor",
    };
    return (
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 p-10 text-center">
        <Users className="w-10 h-10 text-gray-200 dark:text-gray-700 mx-auto mb-3" />
        <p className="text-sm text-gray-400 dark:text-gray-500 font-medium">{t(emptyKeys[type] || "recharge_report.no_data")}</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
      <div className="lg:hidden divide-y divide-gray-50 dark:divide-slate-800">
        {data.map((emp, idx) => (
          <div key={emp.id}>
            <button
              onClick={() => setExpandedId(expandedId === emp.id ? null : emp.id)}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-gray-50/30 dark:hover:bg-slate-800/30"
            >
              <div className={cn(
                "w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black shrink-0",
                idx === 0 ? "bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400" :
                idx === 1 ? "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300" :
                idx === 2 ? "bg-orange-100 dark:bg-orange-500/20 text-orange-600 dark:text-orange-400" :
                "bg-gray-100 dark:bg-slate-800 text-gray-400 dark:text-gray-500"
              )}>
                {idx + 1}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{emp.name}</p>
                {emp.employee_type === "rso" && emp.itop_number && (
                  <p className="text-[10px] text-gray-400 dark:text-gray-500">{emp.itop_number}</p>
                )}
                {emp.employee_type === "supervisor" && emp.pool_number && (
                  <p className="text-[10px] text-gray-400 dark:text-gray-500">{emp.pool_number}</p>
                )}
              </div>
              <ChevronDown className={cn("w-4 h-4 text-gray-400 shrink-0 transition-transform duration-200", expandedId === emp.id && "rotate-180")} />
            </button>
            {expandedId === emp.id && (
              <div className="px-4 pb-4 pt-1 space-y-2 text-sm">
                <div className="flex items-center justify-between py-1">
                  <span className="text-gray-500 dark:text-gray-400">{t("recharge_report.target")}</span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{formatNumber(emp.target)}</span>
                </div>
                {reportType !== "ev_secondary" && emp.ev_target !== undefined && (
                  <div className="flex items-center justify-between py-1 border-t border-gray-50 dark:border-slate-800">
                    <span className="text-gray-500 dark:text-gray-400">{t("recharge_report.ev_target")}</span>
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{formatNumber(emp.ev_target)}</span>
                  </div>
                )}
                {reportType !== "ev_secondary" && emp.sc_target !== undefined && (
                  <div className="flex items-center justify-between py-1 border-t border-gray-50 dark:border-slate-800">
                    <span className="text-gray-500 dark:text-gray-400">{t("recharge_report.sc_target")}</span>
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{formatNumber(emp.sc_target)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between py-1 border-t border-gray-50 dark:border-slate-800">
                  <span className="text-gray-500 dark:text-gray-400">{t("recharge_report.achieved")}</span>
                  <span className="font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">{formatNumber(emp.achievement)} <StatusBadge status={projectionStatus(emp.percentage, Math.round(emp.projection / Math.max(emp.target, 1) * 100))} t={t} /></span>
                </div>
                <div className="flex items-center justify-between py-1 border-t border-gray-50 dark:border-slate-800">
                  <span className="text-gray-500 dark:text-gray-400">%</span>
                  <span className="font-bold" style={{ color: emp.percentage >= 100 ? "#10b981" : emp.percentage >= 70 ? "#3b82f6" : emp.percentage >= 40 ? "#f59e0b" : "#ef4444" }}>{Math.round(emp.percentage)}%</span>
                </div>
                <div className="flex items-center justify-between py-1 border-t border-gray-50 dark:border-slate-800">
                  <span className="text-gray-500 dark:text-gray-400">{t("recharge_report.remaining")}</span>
                  <span className="text-gray-600 dark:text-gray-400">{formatNumber(emp.remaining)}</span>
                </div>
                <div className="flex items-center justify-between py-1 border-t border-gray-50 dark:border-slate-800">
                  <span className="text-gray-500 dark:text-gray-400">DRR</span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{formatNumber(Math.ceil(emp.remaining / Math.max(daysRemaining, 1)))}</span>
                </div>
                <div className="flex items-center justify-between py-1 border-t border-gray-50 dark:border-slate-800">
                  <span className="text-gray-500 dark:text-gray-400">{t("recharge_report.daily_average")}</span>
                  <span className="text-gray-600 dark:text-gray-400">{formatNumber(Math.round(emp.daily_average))}</span>
                </div>
                <div className="flex items-center justify-between py-1 border-t border-gray-50 dark:border-slate-800">
                  <span className="text-gray-500 dark:text-gray-400">{t("recharge_report.projection")}</span>
                  <span className="text-right">
                    <div className="font-semibold text-gray-900 dark:text-gray-100">{formatNumber(Math.round(emp.projection))}</div>
                    <div className="text-[10px] text-gray-400 leading-tight">
                      {Math.round(emp.projection / Math.max(emp.target, 1) * 100)}%
                    </div>
                  </span>
                </div>
                <div className="flex items-center justify-between py-1 border-t border-gray-50 dark:border-slate-800">
                  <span className="text-gray-500 dark:text-gray-400">{t("recharge_report.yesterday_c2c")}</span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{formatNumber(emp.yesterday_c2c ?? 0)}</span>
                </div>
                <div className="flex items-center justify-between py-1 border-t border-gray-50 dark:border-slate-800">
                  <span className="text-gray-500 dark:text-gray-400">{t("recharge_report.yesterday_c2s")}</span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{formatNumber(emp.yesterday_c2s ?? 0)}</span>
                </div>
                <div className="flex items-center justify-between py-1 border-t border-gray-50 dark:border-slate-800">
                  <span className="text-gray-500 dark:text-gray-400">{t("recharge_report.yesterday_transaction_count")}</span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{formatNumber(emp.yesterday_transaction_count ?? 0)}</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-gray-50/50 dark:bg-slate-800/50 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest border-b border-gray-50 dark:border-slate-800">
              <th className="px-4 py-3 w-10">{t("recharge_report.rank")}</th>
              <th className="px-4 py-3">{type === "rso" ? "RSO" : t("recharge_report.employee")}</th>
              <th className="px-4 py-3 text-center">{t("recharge_report.target")}</th>
              {reportType !== "ev_secondary" && (
                <th className="px-4 py-3 text-center">{t("recharge_report.ev_target")}</th>
              )}
              {reportType !== "ev_secondary" && (
                <th className="px-4 py-3 text-center">{t("recharge_report.sc_target")}</th>
              )}
              <th className="px-4 py-3 text-center">{t("recharge_report.achieved")}</th>
              <th className="px-4 py-3 text-center">{t("recharge_report.percentage")}</th>
              <th className="px-4 py-3 text-center">{t("recharge_report.remaining")}</th>
              <th className="px-4 py-3 text-center">DRR</th>
              <th className="px-4 py-3 text-center">{t("recharge_report.daily_average")}</th>
              <th className="px-4 py-3 text-center">{t("recharge_report.projection")}</th>
              <th className="px-4 py-3 text-center">{t("recharge_report.yesterday_c2c")}</th>
              <th className="px-4 py-3 text-center">{t("recharge_report.yesterday_c2s")}</th>
              <th className="px-4 py-3 text-center">{t("recharge_report.yesterday_transaction_count")}</th>
              <th className="px-4 py-3 text-center">{t("recharge_report.status")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
            {data.map((emp, idx) => (
              <tr key={emp.id} className="hover:bg-gray-50/30 dark:hover:bg-slate-800/30 transition-colors">
                <td className="px-2 py-1">
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
                <td className="px-2 py-1 whitespace-nowrap">
                  <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{emp.name}</p>
                  {emp.employee_type === "rso" && emp.itop_number && (
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{emp.itop_number}</p>
                  )}
                  {emp.employee_type === "supervisor" && emp.pool_number && (
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{emp.pool_number}</p>
                  )}
                </td>
                <td className="px-2 py-1 text-center">
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{formatNumber(emp.target)}</span>
                </td>
                {reportType !== "ev_secondary" && (
                  <td className="px-2 py-1 text-center">
                    <span className="text-sm text-gray-600 dark:text-gray-400">{formatNumber(emp.ev_target ?? 0)}</span>
                  </td>
                )}
                {reportType !== "ev_secondary" && (
                  <td className="px-2 py-1 text-center">
                    <span className="text-sm text-gray-600 dark:text-gray-400">{formatNumber(emp.sc_target ?? 0)}</span>
                  </td>
                )}
                <td className="px-2 py-1 text-center">
                  <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{formatNumber(emp.achievement)}</span>
                </td>
                <td className="px-2 py-1 text-center">
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
                      {Math.round(emp.percentage)}%
                    </span>
                  </div>
                </td>
                <td className="px-2 py-1 text-center">
                  <span className="text-sm text-gray-600 dark:text-gray-400">{formatNumber(emp.remaining)}</span>
                </td>
                <td className="px-2 py-1 text-center">
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{formatNumber(Math.ceil(emp.remaining / Math.max(daysRemaining, 1)))}</span>
                </td>
                <td className="px-2 py-1 text-center">
                  <span className="text-sm text-gray-600 dark:text-gray-400">{formatNumber(Math.round(emp.daily_average))}</span>
                </td>
                <td className="px-2 py-1 text-center align-middle">
                  <div className="text-sm font-semibold text-gray-700 dark:text-gray-300 leading-tight">
                    {formatNumber(Math.round(emp.projection))}
                  </div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-400 leading-tight">
                    {Math.round(emp.projection / Math.max(emp.target, 1) * 100)}%
                  </div>
                </td>
                <td className="px-2 py-1 text-center">
                  <span className="text-sm text-gray-600 dark:text-gray-400">{formatNumber(emp.yesterday_c2c ?? 0)}</span>
                </td>
                <td className="px-2 py-1 text-center">
                  <span className="text-sm text-gray-600 dark:text-gray-400">{formatNumber(emp.yesterday_c2s ?? 0)}</span>
                </td>
                <td className="px-2 py-1 text-center">
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{formatNumber(emp.yesterday_transaction_count ?? 0)}</span>
                </td>
                <td className="px-2 py-1 text-center">
                  <StatusBadge status={projectionStatus(emp.percentage, Math.round(emp.projection / Math.max(emp.target, 1) * 100))} t={t} />
                </td>
              </tr>
            ))}
            {data.length > 0 && (() => {
              const totalTarget = data.reduce((s, e) => s + e.target, 0);
              const totalEvTarget = data.reduce((s, e) => s + (e.ev_target ?? 0), 0);
              const totalScTarget = data.reduce((s, e) => s + (e.sc_target ?? 0), 0);
              const totalAchieved = data.reduce((s, e) => s + e.achievement, 0);
              const totalPct = totalTarget ? Math.round(totalAchieved / totalTarget * 100) : 0;
              const totalRemaining = data.reduce((s, e) => s + e.remaining, 0);
              const totalDailyAvg = totalAchieved / Math.max(daysElapsed, 1);
              const totalProjection = data.reduce((s, e) => s + e.projection, 0);
              const totalYesterdayC2c = data.reduce((s, e) => s + (e.yesterday_c2c ?? 0), 0);
              const totalYesterdayC2s = data.reduce((s, e) => s + (e.yesterday_c2s ?? 0), 0);
              const totalTxnCount = data.reduce((s, e) => s + (e.yesterday_transaction_count ?? 0), 0);
              return (
                <tr className="border-t-2 border-gray-300 dark:border-slate-600 bg-gray-50/80 dark:bg-slate-800/80">
                  <td className="px-2 py-1" />
                  <td className="px-2 py-1 whitespace-nowrap">
                    <span className="text-sm font-extrabold text-gray-900 dark:text-gray-100">Subtotal</span>
                  </td>
                  <td className="px-2 py-1 text-center">
                    <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{formatNumber(totalTarget)}</span>
                  </td>
                  {reportType !== "ev_secondary" && (
                    <td className="px-2 py-1 text-center">
                      <span className="text-sm text-gray-600 dark:text-gray-400">{formatNumber(totalEvTarget)}</span>
                    </td>
                  )}
                  {reportType !== "ev_secondary" && (
                    <td className="px-2 py-1 text-center">
                      <span className="text-sm text-gray-600 dark:text-gray-400">{formatNumber(totalScTarget)}</span>
                    </td>
                  )}
                  <td className="px-2 py-1 text-center">
                    <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{formatNumber(totalAchieved)}</span>
                  </td>
                  <td className="px-2 py-1 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-16 h-1.5 bg-gray-100 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-500",
                            totalPct >= 100 ? "bg-emerald-500" :
                            totalPct >= 70 ? "bg-blue-500" :
                            totalPct >= 40 ? "bg-amber-500" : "bg-rose-500"
                          )}
                          style={{ width: `${Math.min(totalPct, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs font-bold text-gray-600 dark:text-gray-400 w-10 text-center">{totalPct}%</span>
                    </div>
                  </td>
                  <td className="px-2 py-1 text-center">
                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{formatNumber(totalRemaining)}</span>
                  </td>
                  <td className="px-2 py-1 text-center">
                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{formatNumber(Math.ceil(totalRemaining / Math.max(daysRemaining, 1)))}</span>
                  </td>
                  <td className="px-2 py-1 text-center">
                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{formatNumber(Math.round(totalDailyAvg))}</span>
                  </td>
                  <td className="px-2 py-1 text-center align-middle">
                    <div className="text-sm font-bold text-gray-700 dark:text-gray-300 leading-tight">{formatNumber(Math.round(totalProjection))}</div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-400 leading-tight">
                      {Math.round(totalProjection / Math.max(totalTarget, 1) * 100)}%
                    </div>
                  </td>
                  <td className="px-2 py-1 text-center">
                    <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{formatNumber(totalYesterdayC2c)}</span>
                  </td>
                  <td className="px-2 py-1 text-center">
                    <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{formatNumber(totalYesterdayC2s)}</span>
                  </td>
                  <td className="px-2 py-1 text-center">
                    <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{formatNumber(totalTxnCount)}</span>
                  </td>
                  <td className="px-2 py-1 text-center">
                    <StatusBadge status={projectionStatus(totalPct, totalProjection ? Math.round(totalProjection / Math.max(totalTarget, 1) * 100) : 0)} t={t} />
                  </td>
                </tr>
              );
            })()}
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
                <div className="flex items-center gap-2 text-[10px] text-gray-400 dark:text-gray-500">
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
                  {Math.round(emp.percentage)}%
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const REPORT_TYPE_KEY = "recharge_report_type";

function getStoredReportType(): "recharge" | "ev_secondary" {
  try {
    const stored = localStorage.getItem(REPORT_TYPE_KEY);
    if (stored === "ev_secondary") return "ev_secondary";
  } catch {}
  return "recharge";
}

export default function RechargeDashboardPage() {
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
  const [activeTab, setActiveTab] = useState<"rso" | "supervisor">("rso");
  const [reportType, setReportType] = useState<"recharge" | "ev_secondary">(getStoredReportType);
  const [isDark, setIsDark] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const handleReportTypeChange = (type: "recharge" | "ev_secondary") => {
    setReportType(type);
    try {
      localStorage.setItem(REPORT_TYPE_KEY, type);
    } catch {}
  };

  useEffect(() => {
    if (!authLoading && !hasPermission("reports.view")) {
      const timer = setTimeout(() => router.push("/"), 5000);
      return () => clearTimeout(timer);
    }
  }, [authLoading, hasPermission, router]);

  const fetchDashboard = useCallback(async () => {
    if (!selectedHouseId) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params: Record<string, any> = { month, year, report_type: reportType };
      if (selectedHouseId) params.house_id = selectedHouseId;
      const res = await apiClient.get("reports/recharge/dashboard", { params });
      setData(res.data);
    } catch {
      toast.error(t("recharge_report.error_loading"));
    } finally {
      setLoading(false);
    }
  }, [month, year, selectedHouseId, reportType]);

  useEffect(() => {
    if (!authLoading && hasPermission("reports.view")) {
      apiClient.get("houses/accessible").then(res => {
        setHouses(res.data);
      }).catch(() => {});
    }
  }, [authLoading, hasPermission]);

  useEffect(() => {
    if (!authLoading && hasPermission("reports.view")) {
      fetchDashboard();
    }
  }, [authLoading, hasPermission, month, year, selectedHouseId, reportType]);

  const handleExport = async () => {
    if (!data) return;
    const house = houses.find(h => String(h.id) === selectedHouseId);
    try {
      await exportRechargeReport({
        summary: data.summary,
        rso_performance: data.rso_performance,
        supervisor_performance: data.supervisor_performance,
        house_name: house?.name || "All Houses",
        house_code: house?.code || "",
        month,
        year,
        month_name: getMonthName(month),
        report_type: reportType,
        days_elapsed: data.summary.days_elapsed,
        total_days: data.summary.total_days,
      });
      toast.success(t("recharge_report.export_success"));
    } catch {
      toast.error(t("recharge_report.export_failed"));
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
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex items-center gap-1 bg-gray-100 dark:bg-slate-800 rounded-xl p-1 shadow-sm">
          <button
            onClick={() => handleReportTypeChange("recharge")}
            className={cn(
              "inline-flex items-center gap-2 px-3 md:px-5 py-2 rounded-lg text-xs md:text-sm font-bold transition-all whitespace-nowrap",
              reportType === "recharge"
                ? "bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            )}
          >
            <Zap className="w-4 h-4 text-primary-600 dark:text-primary-400" />
            {t("recharge_report.type_recharge")}
          </button>
          <button
            onClick={() => handleReportTypeChange("ev_secondary")}
            className={cn(
              "inline-flex items-center gap-2 px-3 md:px-5 py-2 rounded-lg text-xs md:text-sm font-bold transition-all whitespace-nowrap",
              reportType === "ev_secondary"
                ? "bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            )}
          >
            <BatteryCharging className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            {t("recharge_report.type_ev_secondary")}
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {reportType === "ev_secondary"
              ? t("recharge_report.ev_dashboard_title")
              : t("recharge_report.dashboard_title")}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {reportType === "ev_secondary"
              ? t("recharge_report.ev_dashboard_subtitle")
              : t("recharge_report.dashboard_subtitle")}
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
                <option value="">{t("recharge_report.all_houses")}</option>
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
            className="inline-flex items-center justify-center p-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors shadow-sm"
            title={t("recharge_report.export_dashboard")}
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={fetchDashboard}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-lg text-sm font-bold hover:bg-primary-600 transition-colors shadow-sm disabled:opacity-50"
          >
            <RotateCcw className={cn("w-4 h-4", loading && "animate-spin")} />
            {t("recharge_report.refresh")}
          </button>
        </div>
      </div>

      {loading && !data ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="animate-pulse bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 p-6">
                <div className="h-4 w-36 bg-gray-200 dark:bg-slate-700 rounded-md mb-4" />
                <div className="h-48 bg-gray-100 dark:bg-slate-800 rounded-lg" />
              </div>
            ))}
          </div>
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-50 dark:border-slate-800">
              <div className="h-4 w-24 bg-gray-200 dark:bg-slate-700 rounded-md" />
            </div>
            {Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}
          </div>
        </>
      ) : data && s ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              icon={Target}
              label={reportType === "ev_secondary" ? t("recharge_report.ev_c2c_target") : t("recharge_report.monthly_target")}
              value={formatNumber(s.monthly_target)}
              valueColor="text-gray-900 dark:text-gray-100"
              trend={s.previous_month_target > 0 ? {
                dir: s.monthly_target >= s.previous_month_target ? "up" as const : "down" as const,
                text: s.monthly_target >= s.previous_month_target
                   ? `+${formatNumber(s.monthly_target - s.previous_month_target)} from last month`
                  : `${formatNumber(s.monthly_target - s.previous_month_target)} from last month`,
              } : undefined}
            />
            <KpiCard
              icon={TrendingUp}
              label={t("recharge_report.achievement")}
              value={formatNumber(Math.round(s.achievement))}
              valueColor="text-emerald-600 dark:text-emerald-400"
              valueExtra={<>{t("recharge_report.yesterday_badge", { count: formatNumber(s.yesterday_achievement) })}</>}
              subtitle={s.previous_month_target > 0
                ? t("recharge_report.last_month_achievement", {
                    count: formatNumber(s.previous_month_achievement),
                    pct: Math.round((s.previous_month_achievement / s.previous_month_target) * 100),
                  })
                : t("recharge_report.last_month_achievement", { count: formatNumber(s.previous_month_achievement), pct: 0 })}
            />
            <KpiCard
              icon={Award}
              label={t("recharge_report.achievement_pct")}
              value={`${Math.round(s.achievement_percentage)}%`}
              valueColor={
                s.achievement_percentage >= 100 ? "text-emerald-600 dark:text-emerald-400" :
                s.achievement_percentage >= 70 ? "text-blue-600 dark:text-blue-400" :
                s.achievement_percentage >= 40 ? "text-amber-600 dark:text-amber-400" :
                "text-rose-600 dark:text-rose-400"
              }
              subtitle={`${t("recharge_report.expected_pct")}: ${Math.round(s.expected_percentage)}%`}
            />
            <KpiCard
              icon={BarChart3}
              label={t("recharge_report.remaining")}
              value={formatNumber(s.remaining)}
              valueColor="text-amber-600 dark:text-amber-400"
              subtitle={t("recharge_report.days_remaining") + ": " + s.days_remaining}
            />
            <KpiCard
              icon={Activity}
              label={t("recharge_report.daily_average")}
              value={formatNumber(Math.round(s.daily_average))}
              valueColor="text-blue-600 dark:text-blue-400"
              subtitle={t("recharge_report.days_elapsed") + ": " + s.days_elapsed}
            />
            <KpiCard
              icon={Zap}
              label={t("recharge_report.daily_required")}
              value={formatNumber(s.daily_required)}
              valueColor="text-purple-600 dark:text-purple-400"
              subtitle={t("recharge_report.remaining_fridays") + ": " + s.remaining_fridays}
            />
            <KpiCard
              icon={Trophy}
              label={t("recharge_report.projection")}
              value={formatNumber(Math.round(s.projection))}
              valueColor={
                s.expected_percentage >= 100 ? "text-emerald-600 dark:text-emerald-400" :
                s.expected_percentage >= 70 ? "text-blue-600 dark:text-blue-400" :
                "text-amber-600 dark:text-amber-400"
              }
              subtitle={`${t("recharge_report.expected_pct")}: ${Math.round(s.expected_percentage)}%`}
            />
            <KpiCard
              icon={Sparkles}
              label={t("recharge_report.expected_pct")}
              value={`${Math.round(s.expected_percentage)}%`}
              valueColor={
                s.expected_percentage >= 100 ? "text-emerald-600 dark:text-emerald-400" :
                s.expected_percentage >= 70 ? "text-blue-600 dark:text-blue-400" :
                "text-amber-600 dark:text-amber-400"
              }
            />
          </div>

          {/* EV C2C and SC Primary Target Cards */}
          {reportType === "recharge" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <KpiCard
                icon={Zap}
                label={t("recharge_report.ev_c2c_target")}
                value={formatNumber(s.ev_c2c_target)}
                valueColor="text-indigo-600 dark:text-indigo-400"
              />
              <KpiCard
                icon={Zap}
                label={t("recharge_report.sc_primary_target")}
                value={formatNumber(s.sc_primary_target)}
                valueColor="text-violet-600 dark:text-violet-400"
              />
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="bg-white dark:bg-slate-900 border-gray-100 dark:border-slate-800 shadow-sm">
              <CardHeader className="flex flex-row items-center gap-2 px-6 pt-5 pb-0">
                <div className="w-9 h-9 rounded-xl bg-primary-50 dark:bg-primary-500/10 flex items-center justify-center shrink-0">
                  <TrendingUp className="w-5 h-5 text-primary-600 dark:text-primary-400" />
                </div>
                <div>
                  <CardTitle className="text-base font-bold text-gray-900 dark:text-gray-100">
                    {t("recharge_report.daily_trend")}
                  </CardTitle>
                  <CardDescription className="text-xs text-gray-500 dark:text-gray-400">
                    {t("recharge_report.daily_trend_desc")}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="px-2 sm:p-6">
                {data.daily_trend.length > 0 ? (
                  <ChartContainer
                    config={{
                      actual: {
                        label: reportType === "ev_secondary" ? "EV C2C (BDT)" : "Recharge (BDT)",
                        color: isDark ? "#60a5fa" : "#3b82f6",
                      },
                    }}
                    className="aspect-auto h-[250px] w-full"
                  >
                    <BarChart
                      accessibilityLayer
                      data={data.daily_trend.filter(d => !d.is_future)}
                      margin={{ top: 5, right: 5, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#334155" : "#e5e7eb"} />
                      <XAxis
                        dataKey="date"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        minTickGap={32}
                        tick={{ fontSize: 11, fill: isDark ? "#94a3b8" : "#64748b" }}
                        tickFormatter={(val) => {
                          const d = new Date(val);
                          return d.toLocaleDateString("en", { day: "numeric" });
                        }}
                      />
                      <YAxis
                        allowDecimals={false}
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        tick={{ fontSize: 11, fill: isDark ? "#94a3b8" : "#64748b" }}
                      />
                      <ChartTooltip
                        cursor={{ fill: isDark ? "rgba(148,163,184,0.05)" : "rgba(0,0,0,0.03)" }}
                        content={
                          <ChartTooltipContent
                            labelFormatter={(val) => new Date(val).toLocaleDateString("en", {
                              weekday: "short", month: "short", day: "numeric"
                            })}
                            indicator="dot"
                          />
                        }
                      />
                      <Bar
                        dataKey="actual"
                        radius={[4, 4, 0, 0]}
                        fill="var(--color-actual)"
                        maxBarSize={24}
                      />
                    </BarChart>
                  </ChartContainer>
                ) : (
                  <div className="h-[250px] flex items-center justify-center">
                    <p className="text-sm text-gray-400">{t("recharge_report.no_data")}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-sm p-6">
              <h2 className="font-bold text-base flex items-center gap-2 dark:text-gray-100 mb-4">
                <PieChart className="w-5 h-5 text-primary-600 dark:text-primary-400" />
                {t("recharge_report.target_vs_achievement")}
              </h2>
              <div className="space-y-6">
                <div className="text-center">
                  <p className="text-4xl font-black text-gray-900 dark:text-gray-100">{Math.round(s.achievement_percentage)}%</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t("recharge_report.achievement_pct")}</p>
                  {(() => {
                    const st = projectionStatus(s.achievement_percentage, Math.round(s.projection / Math.max(s.monthly_target, 1) * 100));
                    const statusColors: Record<string, string> = {
                      achieved: "text-emerald-600 dark:text-emerald-400",
                      on_track: "text-blue-600 dark:text-blue-400",
                      needs_attention: "text-amber-600 dark:text-amber-400",
                      behind: "text-rose-600 dark:text-rose-400",
                    };
                    const statusIcons: Record<string, React.ReactNode> = {
                      achieved: <TrendingUp className="w-6 h-6 mx-auto mt-1 text-emerald-600 dark:text-emerald-400" />,
                      on_track: <TrendingUp className="w-6 h-6 mx-auto mt-1 text-blue-600 dark:text-blue-400" />,
                      needs_attention: <TrendingUp className="w-6 h-6 mx-auto mt-1 text-amber-600 dark:text-amber-400" />,
                      behind: <TrendingUp className="w-6 h-6 mx-auto mt-1 text-rose-600 dark:text-rose-400" />,
                    };
                    const labelMap: Record<string, string> = {
                      achieved: t("recharge_report.achieved_status"),
                      on_track: t("recharge_report.on_track"),
                      needs_attention: t("recharge_report.needs_attention"),
                      behind: t("recharge_report.behind"),
                    };
                    return (
                      <div className="grid grid-cols-2 gap-3 pt-2">
                        <div className="bg-gray-50 dark:bg-slate-800/50 rounded-lg p-3 text-center">
                          {statusIcons[st]}
                          <p className={`text-lg font-black mt-1 ${statusColors[st]}`}>{labelMap[st]}</p>
                        </div>
                        <div className="bg-gray-50 dark:bg-slate-800/50 rounded-lg p-3 text-center">
                          <p className="text-xs text-gray-500 dark:text-gray-400">ETA (Days)</p>
                          <Clock className="w-6 h-6 mx-auto mt-1 text-rose-600 dark:text-rose-400" />
                          <p className="text-lg font-black text-rose-600 dark:text-rose-400">{s.days_remaining}</p>
                        </div>
                      </div>
                    );
                  })()}
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                      <span>{t("recharge_report.achievement")}</span>
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
                </div>
              </div>
            </div>
          </div>

          {top && (top.rso.length > 0 || top.supervisor?.length > 0) && (
            <div>
              <h2 className="font-bold text-base flex items-center gap-2 dark:text-gray-100 mb-4">
                <Medal className="w-5 h-5 text-amber-500" />
                {t("recharge_report.top_performers")}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-1 lg:grid-cols-2 gap-4">
                {top.rso.length > 0 && (
                  <LeaderboardCard
                    data={top.rso}
                    title={t("recharge_report.rso_performance")}
                    icon={Users}
                    color="bg-blue-500"
                    t={t}
                  />
                )}
                {top.supervisor?.length > 0 && (
                  <LeaderboardCard
                    data={top.supervisor}
                    title={t("recharge_report.supervisor_performance")}
                    icon={Users}
                    color="bg-orange-500"
                    t={t}
                  />
                )}
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center gap-1 mb-4">
              <div className="flex items-center gap-1 bg-gray-100 dark:bg-slate-800 rounded-lg p-1 overflow-x-auto flex-1 min-w-0">
                {(["rso", "supervisor"] as const).map((tab) => {
                  const labels: Record<string, string> = {
                    rso: t("recharge_report.rso_performance"),
                    supervisor: t("recharge_report.supervisor_performance"),
                  };
                  const icons: Record<string, any> = {
                    rso: Users,
                    supervisor: Users,
                  };
                  const Icon = icons[tab];
                  const badgeCounts: Record<string, number> = {
                    rso: data.rso_performance?.length ?? 0,
                    supervisor: data.supervisor_performance?.length ?? 0,
                  };
                  const badgeColors: Record<string, string> = {
                    rso: "bg-primary-100 dark:bg-primary-500/20 text-primary-600 dark:text-primary-400",
                    supervisor: "bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400",
                  };
                  return (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={cn(
                        "flex items-center gap-1 md:gap-2 px-2 md:px-4 h-8 rounded-lg text-[11px] md:text-sm font-bold transition-all whitespace-nowrap",
                        activeTab === tab
                          ? "bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 shadow-sm"
                          : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                      )}
                    >
                      <Icon className="w-3.5 h-3.5 md:w-4 md:h-4 shrink-0" />
                      <span>{labels[tab]}</span>
                      {badgeCounts[tab] > 0 && (
                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-bold", badgeColors[tab])}>
                          {badgeCounts[tab]}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {activeTab === "rso" && (
              <PerformanceTable data={data.rso_performance} t={t} type="rso" reportType={reportType} daysElapsed={data.summary.days_elapsed} daysRemaining={data.summary.days_remaining} />
            )}
            {activeTab === "supervisor" && (
              <PerformanceTable data={data.supervisor_performance} t={t} type="supervisor" reportType={reportType} daysElapsed={data.summary.days_elapsed} daysRemaining={data.summary.days_remaining} />
            )}
          </div>
        </>
      ) : !loading && !data ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm py-20 text-center">
          <Building2 className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
          <p className="text-gray-500 dark:text-gray-400 font-medium">
            {houses.length > 1 && !selectedHouseId
              ? t("recharge_report.select_house")
              : t("recharge_report.no_data")}
          </p>
        </div>
      ) : null}
    </div>
  );
}
