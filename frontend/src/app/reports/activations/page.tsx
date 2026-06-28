"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  BarChart3, TrendingUp, Target, Award, Users,
  RotateCcw, Download, Printer, Share2, Building2, Calendar,
  Zap, Clock, ArrowUp, ArrowDown, Medal,
  Trophy, PieChart, Activity, Sparkles,
  Settings, Tag, X as XIcon, CheckCircle2, AlertTriangle, Flag, ChevronDown,
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
import { exportActivationsReport } from "@/lib/export-activations";
import { printActivationsReport } from "@/lib/print-report";
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
  yesterday_activation: number;
  previous_month_target: number;
  previous_month_achievement: number;
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
  employee_type?: string;
  itop_number?: string;
  pool_number?: string;
  market_activation?: number;
  market_yesterday?: number;
  yesterday_activation?: number;
  month_total_activation?: number;
  active_days?: number;
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
  supervisor_performance: EmployeePerformance[];
  daily_trend: DailyTrend[];
  top_performers: {
    rso: EmployeePerformance[];
    bp: EmployeePerformance[];
    cc: EmployeePerformance[];
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
  return n.toLocaleString();
}

function KpiCard({ icon: Icon, label, value, valueColor, valueExtra, subtitle, trend, onConfig }: {
  icon: any; label: string; value: string | number;
  valueColor?: string; valueExtra?: React.ReactNode; subtitle?: string | React.ReactNode; trend?: { dir: "up" | "down"; text: string };
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
            <div className="text-[10px] text-gray-400 dark:text-gray-500">{subtitle}</div>
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

function timeBasedStatus(pct: number, daysElapsed: number, totalDays: number): string {
  if (pct >= 100) return "achieved";
  // First 7 days: use raw percentage (old system)
  if (daysElapsed <= 7) {
    if (pct >= 70) return "on_track";
    if (pct >= 40) return "needs_attention";
    return "behind";
  }
  // After 7 days: time-based comparison (both as percentages 0–100)
  const timePct = totalDays > 0 ? (daysElapsed / totalDays) * 100 : 0;
  if (pct >= timePct) return "on_track";
  if (pct >= timePct * 0.5) return "needs_attention";
  return "behind";
}

function PerformanceTable({ data, t, type, daysElapsed, totalDays, daysRemaining }: { data: EmployeePerformance[]; t: (key: string) => string; type: string; daysElapsed: number; totalDays: number; daysRemaining: number }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (!data || data.length === 0) {
    const emptyKeys: Record<string, string> = {
      rso: "activation_report.no_data_rso",
      bp: "activation_report.no_data_bp",
      cc: "activation_report.no_data_cc",
      supervisor: "activation_report.no_data",
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
      {/* Accordion — below lg */}
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
                {(emp.employee_type === "bp" || emp.employee_type === "supervisor") && emp.pool_number && (
                  <p className="text-[10px] text-gray-400 dark:text-gray-500">{emp.pool_number}</p>
                )}
              </div>
              <ChevronDown className={cn("w-4 h-4 text-gray-400 shrink-0 transition-transform duration-200", expandedId === emp.id && "rotate-180")} />
            </button>
            {expandedId === emp.id && (
              <div className="px-4 pb-4 pt-1 space-y-2 text-sm">
                <div className="flex items-center justify-between py-1">
                  <span className="text-gray-500 dark:text-gray-400">{t("activation_report.target")}</span>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{formatNumber(emp.target)}</span>
                </div>
                <div className="flex items-center justify-between py-1 border-t border-gray-50 dark:border-slate-800">
                  <span className="text-gray-500 dark:text-gray-400">{t("activation_report.achieved")}</span>
                  <span className="font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">{formatNumber(emp.achievement)} <StatusBadge status={timeBasedStatus(emp.percentage, daysElapsed, totalDays)} t={t} /></span>
                </div>
                <div className="flex items-center justify-between py-1 border-t border-gray-50 dark:border-slate-800">
                  <span className="text-gray-500 dark:text-gray-400">%</span>
                  <span className="font-bold" style={{ color: emp.percentage >= 100 ? "#10b981" : emp.percentage >= 70 ? "#3b82f6" : emp.percentage >= 40 ? "#f59e0b" : "#ef4444" }}>{emp.percentage}%</span>
                </div>
                <div className="flex items-center justify-between py-1 border-t border-gray-50 dark:border-slate-800">
                  <span className="text-gray-500 dark:text-gray-400">{t("activation_report.remaining")}</span>
                  <span className="text-gray-600 dark:text-gray-400">{formatNumber(emp.remaining)}</span>
                </div>
                {type !== "cc" && (
                  <div className="flex items-center justify-between py-1 border-t border-gray-50 dark:border-slate-800">
                    <span className="text-gray-500 dark:text-gray-400">DRR</span>
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{Math.ceil(emp.remaining / Math.max(daysRemaining, 1))}</span>
                  </div>
                )}
                <div className="flex items-center justify-between py-1 border-t border-gray-50 dark:border-slate-800">
                  <span className="text-gray-500 dark:text-gray-400">{t("activation_report.daily_average")}</span>
                  <span className="text-gray-600 dark:text-gray-400">{Math.round(emp.daily_average)}</span>
                </div>
                <div className="flex items-center justify-between py-1 border-t border-gray-50 dark:border-slate-800">
                  <span className="text-gray-500 dark:text-gray-400">{t("activation_report.projection")}</span>
                  <span className="text-right">
                    <div className="font-semibold text-gray-900 dark:text-gray-100">{formatNumber(Math.round(emp.projection))}</div>
                    {type !== "cc" && (
                      <div className="text-[10px] text-gray-400 leading-tight">
                        {Math.round(emp.projection / Math.max(emp.target, 1) * 100)}%
                      </div>
                    )}
                  </span>
                </div>
                {(type === "bp" || type === "supervisor") && (
                  <>
                    <div className="flex items-center justify-between py-1 border-t border-gray-50 dark:border-slate-800">
                      <span className="text-gray-500 dark:text-gray-400">{t("activation_report.yesterday")}</span>
                      <span className="font-bold text-gray-900 dark:text-gray-100">{formatNumber(emp.yesterday_activation ?? 0)}</span>
                    </div>
                    {type === "bp" && (
                      <div className="flex items-center justify-between py-1 border-t border-gray-50 dark:border-slate-800">
                        <span className="text-gray-500 dark:text-gray-400">{t("activation_report.day_count")}</span>
                        <span className="font-semibold text-gray-900 dark:text-gray-100">{emp.active_days ?? 0}</span>
                      </div>
                    )}
                  </>
                )}
                {type === "rso" && (
                  <>
                    <div className="flex items-center justify-between py-1 border-t border-gray-50 dark:border-slate-800">
                      <span className="text-gray-500 dark:text-gray-400">Market</span>
                      <span className="text-right">
                        <div className="font-bold text-gray-900 dark:text-gray-100 text-sm leading-tight">
                          {formatNumber(emp.market_yesterday ?? 0)}
                        </div>
                        <div className="text-[10px] text-gray-400 leading-tight">
                          MTD: {formatNumber(emp.market_activation ?? 0)}
                        </div>
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-1 border-t border-gray-50 dark:border-slate-800">
                      <span className="text-gray-500 dark:text-gray-400">Own Activation</span>
                      <span className="text-right">
                        <div className="font-bold text-gray-900 dark:text-gray-100 text-sm leading-tight">
                          {formatNumber(emp.yesterday_activation ?? 0)}
                        </div>
                        <div className="text-[10px] text-gray-400 leading-tight">
                          MTD: {formatNumber(emp.month_total_activation ?? 0)} &bull; Day: {emp.active_days ?? 0}
                        </div>
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Normal table — lg+ */}
      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-gray-50/50 dark:bg-slate-800/50 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest border-b border-gray-50 dark:border-slate-800">
              <th className="px-4 py-3 w-10">{t("activation_report.rank")}</th>
              <th className="px-4 py-3">{type === "rso" ? "RSO" : type === "bp" ? "BP" : type === "supervisor" ? "Supervisor" : t("activation_report.employee")}</th>
              <th className="px-4 py-3 text-center">{t("activation_report.target")}</th>
              <th className="px-4 py-3 text-center">{t("activation_report.achieved")}</th>
              <th className="px-4 py-3 text-center">{t("activation_report.percentage")}</th>
              <th className="px-4 py-3 text-center">{t("activation_report.remaining")}</th>
              {type !== "cc" && <th className="px-4 py-3 text-center">DRR</th>}
              <th className="px-4 py-3 text-center">{t("activation_report.daily_average")}</th>
              <th className="px-4 py-3 text-center">{t("activation_report.projection")}</th>
              {type === "rso" && <th className="px-4 py-3 text-center">Market</th>}
              {type === "rso" && <th className="px-4 py-3 text-center">Own Activation</th>}
              {(type === "bp" || type === "supervisor") && <th className="px-4 py-3 text-center">{t("activation_report.yesterday")}</th>}
              {type === "bp" && <th className="px-4 py-3 text-center">{t("activation_report.day_count")}</th>}
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
                <td className="px-4 py-3 whitespace-nowrap">
                  <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{emp.name}</p>
                  {emp.employee_type === "rso" && emp.itop_number && (
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{emp.itop_number}</p>
                  )}
                  {(emp.employee_type === "bp" || emp.employee_type === "supervisor") && emp.pool_number && (
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{emp.pool_number}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{formatNumber(emp.target)}</span>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{formatNumber(emp.achievement)}</span>
                </td>
                <td className="px-4 py-3 text-center">
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
                <td className="px-4 py-3 text-center">
                  <span className="text-sm text-gray-600 dark:text-gray-400">{formatNumber(emp.remaining)}</span>
                </td>
                {type !== "cc" && (
                  <td className="px-4 py-3 text-center">
                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{Math.ceil(emp.remaining / Math.max(daysRemaining, 1))}</span>
                  </td>
                )}
                <td className="px-4 py-3 text-center">
                  <span className="text-sm text-gray-600 dark:text-gray-400">{Math.round(emp.daily_average)}</span>
                </td>
                <td className="px-4 py-3 text-center align-middle">
                  <div className="text-sm font-semibold text-gray-700 dark:text-gray-300 leading-tight">
                    {formatNumber(Math.round(emp.projection))}
                  </div>
                  {type !== "cc" && (
                    <div className="text-[10px] text-gray-400 leading-tight">
                      {Math.round(emp.projection / Math.max(emp.target, 1) * 100)}%
                    </div>
                  )}
                </td>
                {type === "rso" && (
                  <td className="px-4 py-3 text-center align-middle">
                    <div className="font-bold text-gray-900 dark:text-gray-100 text-sm leading-tight">
                      {formatNumber(emp.market_yesterday ?? 0)}
                    </div>
                    <div className="text-[10px] text-gray-400 leading-tight">
                      MTD: {formatNumber(emp.market_activation ?? 0)}
                    </div>
                  </td>
                )}
                {type === "rso" && (
                  <td className="px-4 py-3 text-center align-middle">
                    <div className="font-bold text-gray-900 dark:text-gray-100 text-sm leading-tight">
                      {formatNumber(emp.yesterday_activation ?? 0)}
                    </div>
                    <div className="text-[10px] text-gray-400 leading-tight">
                      MTD: {formatNumber(emp.month_total_activation ?? 0)} &bull; Day: {emp.active_days ?? 0}
                    </div>
                  </td>
                )}
                {(type === "bp" || type === "supervisor") && (
                  <td className="px-4 py-3 text-center">
                    <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{formatNumber(emp.yesterday_activation ?? 0)}</span>
                  </td>
                )}
                {type === "bp" && (
                  <td className="px-4 py-3 text-center">
                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{emp.active_days ?? 0}</span>
                  </td>
                )}
                <td className="px-4 py-3 text-center">
                  <StatusBadge status={timeBasedStatus(emp.percentage, daysElapsed, totalDays)} t={t} />
                </td>
              </tr>
            ))}
            {data.length > 0 && (() => {
              const totalTarget = data.reduce((s, e) => s + e.target, 0);
              const totalAchieved = data.reduce((s, e) => s + e.achievement, 0);
              const totalPct = totalTarget ? Math.round(totalAchieved / totalTarget * 100) : 0;
              const totalRemaining = data.reduce((s, e) => s + e.remaining, 0);
              const totalDailyAvg = totalAchieved / Math.max(daysElapsed, 1);
              const totalProjection = data.reduce((s, e) => s + e.projection, 0);
              const totalYesterday = data.reduce((s, e) => s + (e.yesterday_activation ?? 0), 0);
              const totalMonthTotal = data.reduce((s, e) => s + (e.month_total_activation ?? 0), 0);
              const totalActiveDays = data.reduce((s, e) => s + (e.active_days ?? 0), 0);
              const totalMrktYest = data.reduce((s, e) => s + (e.market_yesterday ?? 0), 0);
              const totalMrktAct = data.reduce((s, e) => s + (e.market_activation ?? 0), 0);
              return (
                <tr className="border-t-2 border-gray-300 dark:border-slate-600 bg-gray-50/80 dark:bg-slate-800/80">
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="text-sm font-extrabold text-gray-900 dark:text-gray-100">Subtotal</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{formatNumber(totalTarget)}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{formatNumber(totalAchieved)}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
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
                  <td className="px-4 py-3 text-center">
                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{formatNumber(totalRemaining)}</span>
                  </td>
                  {type !== "cc" && (
                    <td className="px-4 py-3 text-center">
                      <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{Math.ceil(totalRemaining / Math.max(daysRemaining, 1))}</span>
                    </td>
                  )}
                  <td className="px-4 py-3 text-center">
                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{Math.round(totalDailyAvg)}</span>
                  </td>
                  <td className="px-4 py-3 text-center align-middle">
                    <div className="text-sm font-bold text-gray-700 dark:text-gray-300 leading-tight">{formatNumber(Math.round(totalProjection))}</div>
                    {type !== "cc" && (
                      <div className="text-[10px] text-gray-400 leading-tight">
                        {Math.round(totalProjection / Math.max(totalTarget, 1) * 100)}%
                      </div>
                    )}
                  </td>
                  {type === "rso" && (
                    <td className="px-4 py-3 text-center align-middle">
                      <div className="font-bold text-gray-900 dark:text-gray-100 text-sm">{formatNumber(totalMrktYest)}</div>
                      <div className="text-[10px] text-gray-400">MTD: {formatNumber(totalMrktAct)}</div>
                    </td>
                  )}
                  {type === "rso" && (
                    <td className="px-4 py-3 text-center align-middle">
                      <div className="font-bold text-gray-900 dark:text-gray-100 text-sm">{formatNumber(totalYesterday)}</div>
                      <div className="text-[10px] text-gray-400">MTD: {formatNumber(totalMonthTotal)}</div>
                    </td>
                  )}
                  {(type === "bp" || type === "supervisor") && (
                    <td className="px-4 py-3 text-center">
                      <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{formatNumber(totalYesterday)}</span>
                    </td>
                  )}
                  {type === "bp" && (
                    <td className="px-4 py-3 text-center">
                      <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">{totalActiveDays}</span>
                    </td>
                  )}
                  <td className="px-4 py-3 text-center">
                    <StatusBadge status={timeBasedStatus(totalPct, daysElapsed, totalDays)} t={t} />
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
  const [activeTab, setActiveTab] = useState<"rso" | "bp" | "cc" | "supervisor">("rso");
  const [isDark, setIsDark] = useState(false);
  const [tags, setTags] = useState<{ id: number; name: string }[]>([]);
  const [achievementExcludeTags, setAchievementExcludeTags] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("activation_achievement_exclude_tags") || "[]"); }
    catch { return []; }
  });
  const [achievementExcludeCodes, setAchievementExcludeCodes] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("activation_achievement_exclude_codes") || "[]"); }
    catch { return []; }
  });
  const [rsoExcludeTags, setRsoExcludeTags] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("activation_rso_exclude_tags") || "[]"); }
    catch { return []; }
  });
  const [rsoExcludeCodes, setRsoExcludeCodes] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("activation_rso_exclude_codes") || "[]"); }
    catch { return []; }
  });
  const [rsoAchievedExcludeTags, setRsoAchievedExcludeTags] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("activation_rso_achieved_exclude_tags") || "[]"); }
    catch { return []; }
  });
  const [rsoMarketExcludeTags, setRsoMarketExcludeTags] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("activation_rso_market_exclude_tags") || "[]"); }
    catch { return []; }
  });
  const [rsoActiveDaysThreshold, setRsoActiveDaysThreshold] = useState<number>(() => {
    try { return parseInt(localStorage.getItem("activation_rso_active_days_threshold") || "1"); }
    catch { return 1; }
  });
  const [bpExcludeTags, setBpExcludeTags] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("activation_bp_exclude_tags") || "[]"); }
    catch { return []; }
  });
  const [bpExcludeCodes, setBpExcludeCodes] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("activation_bp_exclude_codes") || "[]"); }
    catch { return []; }
  });
  const [ccExcludeTags, setCcExcludeTags] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("activation_cc_exclude_tags") || "[]"); }
    catch { return []; }
  });
  const [ccExcludeCodes, setCcExcludeCodes] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("activation_cc_exclude_codes") || "[]"); }
    catch { return []; }
  });
  const [supervisorExcludeTags, setSupervisorExcludeTags] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("activation_supervisor_exclude_tags") || "[]"); }
    catch { return []; }
  });
  const [supervisorExcludeCodes, setSupervisorExcludeCodes] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("activation_supervisor_exclude_codes") || "[]"); }
    catch { return []; }
  });
  const [showShareMenu, setShowShareMenu] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showRsoConfig, setShowRsoConfig] = useState(false);
  const [rsoShowAchievedConfig, setRsoShowAchievedConfig] = useState(true);
  const [rsoShowMarketConfig, setRsoShowMarketConfig] = useState(true);
  const [showBpConfig, setShowBpConfig] = useState(false);
  const [showCcConfig, setShowCcConfig] = useState(false);
  const [showSupervisorConfig, setShowSupervisorConfig] = useState(false);
  const rsoConfigRef = useRef<HTMLDivElement>(null);
  const bpConfigRef = useRef<HTMLDivElement>(null);
  const ccConfigRef = useRef<HTMLDivElement>(null);
  const supervisorConfigRef = useRef<HTMLDivElement>(null);
  const [excludedProductCodes, setExcludedProductCodes] = useState<{ id: number; product_code: string }[]>([]);

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
    if (!selectedHouseId) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params: Record<string, any> = { month, year };
      if (selectedHouseId) params.house_id = selectedHouseId;
      if (achievementExcludeTags.length > 0) params.exclude_tags = achievementExcludeTags.join(",");
      if (achievementExcludeCodes.length > 0) params.exclude_codes = achievementExcludeCodes.join(",");
      if (rsoExcludeTags.length > 0) params.rso_exclude_tags = rsoExcludeTags.join(",");
      if (rsoExcludeCodes.length > 0) params.rso_exclude_codes = rsoExcludeCodes.join(",");
      if (rsoAchievedExcludeTags.length > 0) params.rso_achieved_exclude_tags = rsoAchievedExcludeTags.join(",");
      if (rsoMarketExcludeTags.length > 0) params.rso_market_exclude_tags = rsoMarketExcludeTags.join(",");
      params.rso_active_days_threshold = rsoActiveDaysThreshold;
      if (bpExcludeTags.length > 0) params.bp_exclude_tags = bpExcludeTags.join(",");
      if (bpExcludeCodes.length > 0) params.bp_exclude_codes = bpExcludeCodes.join(",");
      if (ccExcludeTags.length > 0) params.cc_exclude_tags = ccExcludeTags.join(",");
      if (ccExcludeCodes.length > 0) params.cc_exclude_codes = ccExcludeCodes.join(",");
      if (supervisorExcludeTags.length > 0) params.supervisor_exclude_tags = supervisorExcludeTags.join(",");
      if (supervisorExcludeCodes.length > 0) params.supervisor_exclude_codes = supervisorExcludeCodes.join(",");
      const res = await apiClient.get("reports/activations/dashboard", { params });
      setData(res.data);
    } catch {
      toast.error(t("activation_report.error_loading"));
    } finally {
      setLoading(false);
    }
  }, [month, year, selectedHouseId, rsoActiveDaysThreshold, achievementExcludeTags, achievementExcludeCodes, rsoExcludeTags, rsoExcludeCodes, rsoAchievedExcludeTags, rsoMarketExcludeTags, bpExcludeTags, bpExcludeCodes, ccExcludeTags, ccExcludeCodes, supervisorExcludeTags, supervisorExcludeCodes]);

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
    localStorage.setItem("activation_achievement_exclude_tags", JSON.stringify(achievementExcludeTags));
  }, [achievementExcludeTags]);

  useEffect(() => {
    localStorage.setItem("activation_achievement_exclude_codes", JSON.stringify(achievementExcludeCodes));
  }, [achievementExcludeCodes]);

  useEffect(() => {
    localStorage.setItem("activation_rso_exclude_tags", JSON.stringify(rsoExcludeTags));
  }, [rsoExcludeTags]);

  useEffect(() => {
    localStorage.setItem("activation_rso_active_days_threshold", String(rsoActiveDaysThreshold));
  }, [rsoActiveDaysThreshold]);

  useEffect(() => {
    localStorage.setItem("activation_rso_exclude_codes", JSON.stringify(rsoExcludeCodes));
  }, [rsoExcludeCodes]);

  useEffect(() => {
    localStorage.setItem("activation_rso_achieved_exclude_tags", JSON.stringify(rsoAchievedExcludeTags));
  }, [rsoAchievedExcludeTags]);

  useEffect(() => {
    localStorage.setItem("activation_rso_market_exclude_tags", JSON.stringify(rsoMarketExcludeTags));
  }, [rsoMarketExcludeTags]);

  useEffect(() => {
    localStorage.setItem("activation_bp_exclude_tags", JSON.stringify(bpExcludeTags));
  }, [bpExcludeTags]);

  useEffect(() => {
    localStorage.setItem("activation_bp_exclude_codes", JSON.stringify(bpExcludeCodes));
  }, [bpExcludeCodes]);

  useEffect(() => {
    localStorage.setItem("activation_cc_exclude_tags", JSON.stringify(ccExcludeTags));
  }, [ccExcludeTags]);

  useEffect(() => {
    localStorage.setItem("activation_cc_exclude_codes", JSON.stringify(ccExcludeCodes));
  }, [ccExcludeCodes]);

  useEffect(() => {
    localStorage.setItem("activation_supervisor_exclude_tags", JSON.stringify(supervisorExcludeTags));
  }, [supervisorExcludeTags]);

  useEffect(() => {
    localStorage.setItem("activation_supervisor_exclude_codes", JSON.stringify(supervisorExcludeCodes));
  }, [supervisorExcludeCodes]);

  useEffect(() => {
    if (!showSupervisorConfig) return;
    const handler = (e: MouseEvent) => {
      if (supervisorConfigRef.current && !supervisorConfigRef.current.contains(e.target as Node)) {
        setShowSupervisorConfig(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSupervisorConfig]);

  useEffect(() => {
    if (!showRsoConfig) return;
    const handler = (e: MouseEvent) => {
      if (rsoConfigRef.current && !rsoConfigRef.current.contains(e.target as Node)) {
        setShowRsoConfig(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showRsoConfig]);

  useEffect(() => {
    if (!showBpConfig) return;
    const handler = (e: MouseEvent) => {
      if (bpConfigRef.current && !bpConfigRef.current.contains(e.target as Node)) {
        setShowBpConfig(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showBpConfig]);

  useEffect(() => {
    if (!showCcConfig) return;
    const handler = (e: MouseEvent) => {
      if (ccConfigRef.current && !ccConfigRef.current.contains(e.target as Node)) {
        setShowCcConfig(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showCcConfig]);

  useEffect(() => {
    if (!authLoading && hasPermission("reports.view")) {
      fetchDashboard();
    }
  }, [authLoading, hasPermission, month, year, selectedHouseId, rsoActiveDaysThreshold, achievementExcludeTags, achievementExcludeCodes, rsoExcludeTags, rsoExcludeCodes, rsoAchievedExcludeTags, rsoMarketExcludeTags, supervisorExcludeTags, supervisorExcludeCodes]);

  const handleExport = async () => {
    if (!data) return;
    const house = houses.find(h => String(h.id) === selectedHouseId);
    try {
      await exportActivationsReport({
        summary: data.summary,
        rso_performance: data.rso_performance,
        bp_performance: data.bp_performance,
        cc_performance: data.cc_performance,
        supervisor_performance: data.supervisor_performance,
        house_name: house?.name || "All Houses",
        house_code: house?.code || "",
        month,
        year,
        month_name: getMonthName(month),
        days_elapsed: data.summary.days_elapsed,
        total_days: data.summary.total_days,
      });
      toast.success(t("activation_report.export_success"));
    } catch {
      toast.error(t("activation_report.export_failed"));
    }
  };

  const handlePrint = () => {
    if (!data) return;
    const house = houses.find(h => String(h.id) === selectedHouseId);
    printActivationsReport({
      summary: data.summary,
      rso_performance: data.rso_performance,
      bp_performance: data.bp_performance,
      cc_performance: data.cc_performance,
      supervisor_performance: data.supervisor_performance,
      house_name: house?.name || "All Houses",
      house_code: house?.code || "",
      month,
      year,
      month_name: getMonthName(month),
      days_elapsed: data.summary.days_elapsed,
      total_days: data.summary.total_days,
    });
  };

  const generateReportImage = async (): Promise<Blob | null> => {
    if (!data) return null;
    const house = houses.find(h => String(h.id) === selectedHouseId);
    const payload = {
      summary: data.summary,
      rso_performance: data.rso_performance,
      bp_performance: data.bp_performance,
      cc_performance: data.cc_performance,
      supervisor_performance: data.supervisor_performance,
      house_name: house?.name || "All Houses",
      house_code: house?.code || "",
      month,
      year,
      month_name: getMonthName(month),
      days_elapsed: data.summary.days_elapsed,
      total_days: data.summary.total_days,
    };
    const html = printActivationsReport(payload, true, true) as string;
    const container = document.createElement("div");
    container.innerHTML = html;
    // Position offscreen but still rendered (opacity:0 + z-index:-1). Avoids
    // `left:-9999px` because html-to-image/SVG foreignObject can fail to render
    // elements outside the viewport, producing a blank white image.
    // Render visibly (html-to-image needs opacity:1 to capture content) but
    // push behind page content with z-index:-1. The page's own backgrounds
    // cover it so the user doesn't see a flash.
    container.style.position = "fixed";
    container.style.top = "0";
    container.style.left = "0";
    container.style.zIndex = "-1";
    container.style.pointerEvents = "none";
    container.style.width = "1700px";
    container.style.background = "#fff";
    document.body.appendChild(container);
    try {
      // Wait for fonts & layout to settle before capturing
      if (typeof document !== "undefined" && (document as any).fonts?.ready) {
        await (document as any).fonts.ready;
      }
      await new Promise(r => setTimeout(r, 150));
      const { toPng } = await import("html-to-image");
      const dataUrl = await toPng(container, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: "#ffffff",
        width: 1700,
        // inline the cloned node's own computed styles so SVG foreignObject
        // doesn't fall back to empty/whitelisted CSS
        style: { backgroundColor: "#ffffff" },
      });
      const res = await fetch(dataUrl);
      return await res.blob();
    } finally {
      document.body.removeChild(container);
    }
  };

  const handleShareImage = async (platform: "whatsapp" | "telegram") => {
    setShowShareMenu(false);
    const blob = await generateReportImage();
    if (!blob) return;

    const file = new File([blob], `activation_report_${year}_${month}.png`, { type: "image/png" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch {
        // share cancelled or failed
      }
    }

    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `activation_report_${year}_${month}.png`;
    link.click();
    URL.revokeObjectURL(link.href);

    const appUrl = platform === "whatsapp"
      ? `https://api.whatsapp.com/send?text=${encodeURIComponent(`${t("activation_report.dashboard_title")} - ${getMonthName(month)} ${year}`)}`
      : `https://t.me/share/url?url=${encodeURIComponent(window.location.href)}&text=${encodeURIComponent(`${t("activation_report.dashboard_title")} - ${getMonthName(month)} ${year}`)}`;
    window.open(appUrl, "_blank");
  };

  const handleShare = () => {
    setShowShareMenu(prev => !prev);
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
            className="inline-flex items-center justify-center p-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors shadow-sm"
            title={t("activation_report.export_dashboard")}
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={handlePrint}
            className="inline-flex items-center justify-center p-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors shadow-sm"
            title={t("activation_report.print")}
          >
            <Printer className="w-4 h-4" />
          </button>
          <div className="relative">
            <button
              onClick={handleShare}
              className="inline-flex items-center justify-center p-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors shadow-sm"
              title={t("activation_report.share")}
            >
              <Share2 className="w-4 h-4" />
            </button>
            {showShareMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowShareMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg shadow-lg py-1 min-w-[160px]">
                  <button
                    onClick={() => handleShareImage("whatsapp")}
                    className="flex items-center gap-3 w-full px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                    <span>WhatsApp</span>
                  </button>
                  <button
                    onClick={() => handleShareImage("telegram")}
                    className="flex items-center gap-3 w-full px-4 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#0088cc"><path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0a12 12 0 00-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
                    <span>Telegram</span>
                  </button>
                </div>
              </>
            )}
          </div>
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
          <div className="grid grid-cols-1 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
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
          <div className="grid grid-cols-1 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              icon={Target}
              label={t("activation_report.monthly_target")}
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
              label={t("activation_report.achievement")}
              value={formatNumber(s.achievement)}
              valueColor="text-emerald-600 dark:text-emerald-400"
              valueExtra={<>{t("activation_report.yesterday_badge", { count: s.yesterday_activation })}</>}
              subtitle={s.previous_month_target > 0
                ? t("activation_report.last_month_achievement", {
                    count: s.previous_month_achievement,
                    pct: Math.round((s.previous_month_achievement / s.previous_month_target) * 100),
                  })
                : t("activation_report.last_month_achievement", { count: s.previous_month_achievement, pct: 0 })}
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
              value={Math.round(s.daily_average)}
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
            <Card className="bg-white dark:bg-slate-900 border-gray-100 dark:border-slate-800 shadow-sm">
              <CardHeader className="flex flex-row items-center gap-2 px-6 pt-5 pb-0">
                <div className="w-9 h-9 rounded-xl bg-primary-50 dark:bg-primary-500/10 flex items-center justify-center shrink-0">
                  <TrendingUp className="w-5 h-5 text-primary-600 dark:text-primary-400" />
                </div>
                <div>
                  <CardTitle className="text-base font-bold text-gray-900 dark:text-gray-100">
                    {t("activation_report.daily_trend")}
                  </CardTitle>
                  <CardDescription className="text-xs text-gray-500 dark:text-gray-400">
                    {t("activation_report.daily_trend_desc") || "Daily activation trend for the month"}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="px-2 sm:p-6">
                {data.daily_trend.length > 0 ? (
                  <ChartContainer
                    config={{
                      actual: {
                        label: "Activations",
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
                    <p className="text-sm text-gray-400">{t("activation_report.no_data")}</p>
                  </div>
                )}
              </CardContent>
            </Card>

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
                  {(() => {
                    const st = timeBasedStatus(s.achievement_percentage, s.days_elapsed, s.total_days);
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
                      achieved: t("activation_report.achieved_status"),
                      on_track: t("activation_report.on_track"),
                      needs_attention: t("activation_report.needs_attention"),
                      behind: t("activation_report.behind"),
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
              {(() => {
                const cardCount = [top.rso.length > 0, top.bp.length > 0, top.cc.length > 0, top.supervisor?.length > 0].filter(Boolean).length;
                const gridCols = cardCount === 4 ? "md:grid-cols-1 lg:grid-cols-4" : cardCount === 3 ? "md:grid-cols-1 lg:grid-cols-3" : cardCount === 2 ? "md:grid-cols-1 lg:grid-cols-2" : "";
                return (
                  <div className={`grid grid-cols-1 ${gridCols} gap-4`}>
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
                    {top.supervisor?.length > 0 && (
                      <LeaderboardCard
                        data={top.supervisor}
                        title={t("activation_report.supervisor_performance")}
                        icon={Users}
                        color="bg-orange-500"
                        t={t}
                      />
                    )}
                  </div>
                );
})()}
            </div>
          )}

          {/* Employee Performance Tabs */}
          <div>
            <div className="flex items-center gap-1 mb-4">
              <div className="flex items-center gap-1 bg-gray-100 dark:bg-slate-800 rounded-lg p-1 overflow-x-auto flex-1 min-w-0">
                {(["rso", "bp", "cc", "supervisor"] as const).map((tab) => {
                  const labels: Record<string, string> = {
                    rso: t("activation_report.rso_performance"),
                    bp: t("activation_report.bp_performance"),
                    cc: t("activation_report.cc_performance"),
                    supervisor: t("activation_report.supervisor_performance"),
                  };
                  const icons: Record<string, any> = {
                    rso: Users,
                    bp: Building2,
                    cc: BarChart3,
                    supervisor: Users,
                  };
                  const Icon = icons[tab];
                  const badgeCounts: Record<string, number> = {
                    rso: data.rso_performance?.length ?? 0,
                    bp: data.bp_performance?.length ?? 0,
                    cc: data.cc_performance?.length ?? 0,
                    supervisor: data.supervisor_performance?.length ?? 0,
                  };
                  const badgeColors: Record<string, string> = {
                    rso: "bg-primary-100 dark:bg-primary-500/20 text-primary-600 dark:text-primary-400",
                    bp: "bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400",
                    cc: "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400",
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
              {activeTab === "rso" && hasPermission("reports.achievement.config") && (
                <div ref={rsoConfigRef} className="relative shrink-0">
                  <button
                    onClick={() => setShowRsoConfig(!showRsoConfig)}
                    className={cn(
                      "flex items-center justify-center w-8 h-8 rounded-lg text-sm transition-all relative bg-gray-100 dark:bg-slate-800",
                      showRsoConfig
                        ? "bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 shadow-sm"
                        : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                    )}
                  >
                    <Settings className="w-4 h-4" />
                    {(rsoExcludeTags.length > 0 || rsoExcludeCodes.length > 0 || rsoAchievedExcludeTags.length > 0 || rsoMarketExcludeTags.length > 0) && (
                      <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-primary-500 ring-2 ring-white dark:ring-slate-800" />
                    )}
                  </button>
                  {showRsoConfig && (
                    <div className="absolute right-0 top-full mt-2 z-40 w-80 bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-2xl p-4 space-y-4">
                      {(rsoExcludeTags.length > 0 || rsoExcludeCodes.length > 0 || rsoAchievedExcludeTags.length > 0 || rsoMarketExcludeTags.length > 0) && (
                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-primary-600 dark:text-primary-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary-500" />
                          {rsoExcludeTags.length + rsoExcludeCodes.length + rsoAchievedExcludeTags.length + rsoMarketExcludeTags.length} filter{(rsoExcludeTags.length + rsoExcludeCodes.length + rsoAchievedExcludeTags.length + rsoMarketExcludeTags.length) !== 1 ? 's' : ''} active
                        </div>
                      )}

                      {/* Achieved Config */}
                      <div className="border border-gray-100 dark:border-slate-800 rounded-lg overflow-hidden">
                        <button
                          onClick={() => setRsoShowAchievedConfig(!rsoShowAchievedConfig)}
                          className="flex items-center justify-between w-full px-3 py-2 text-[11px] font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
                        >
                          <span className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            {t("activation_report.achieved_config")}
                          </span>
                          <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", rsoShowAchievedConfig && "rotate-180")} />
                        </button>
                        {rsoShowAchievedConfig && (
                          <div className="px-3 pb-3 space-y-2">
                            <div className="flex flex-wrap gap-1.5">
                              {tags.length === 0 ? (
                                <p className="text-xs text-gray-400 py-1">{t("activation_report.no_tags")}</p>
                              ) : tags.map(tag => {
                                const isSelected = rsoAchievedExcludeTags.includes(tag.name);
                                return (
                                  <button
                                    key={tag.id}
                                    onClick={() => {
                                      setRsoAchievedExcludeTags(prev =>
                                        isSelected ? prev.filter(t => t !== tag.name) : [...prev, tag.name]
                                      );
                                    }}
                                    className={cn(
                                      "inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-all border",
                                      isSelected
                                        ? "bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-400"
                                        : "bg-gray-50 dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-slate-600"
                                    )}
                                  >
                                    <Tag className="w-2.5 h-2.5" />
                                    {tag.name}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Market Config */}
                      <div className="border border-gray-100 dark:border-slate-800 rounded-lg overflow-hidden">
                        <button
                          onClick={() => setRsoShowMarketConfig(!rsoShowMarketConfig)}
                          className="flex items-center justify-between w-full px-3 py-2 text-[11px] font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
                        >
                          <span className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                            {t("activation_report.market_config")}
                          </span>
                          <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", rsoShowMarketConfig && "rotate-180")} />
                        </button>
                        {rsoShowMarketConfig && (
                          <div className="px-3 pb-3 space-y-2">
                            <div className="flex flex-wrap gap-1.5">
                              {tags.length === 0 ? (
                                <p className="text-xs text-gray-400 py-1">{t("activation_report.no_tags")}</p>
                              ) : tags.map(tag => {
                                const isSelected = rsoMarketExcludeTags.includes(tag.name);
                                return (
                                  <button
                                    key={tag.id}
                                    onClick={() => {
                                      setRsoMarketExcludeTags(prev =>
                                        isSelected ? prev.filter(t => t !== tag.name) : [...prev, tag.name]
                                      );
                                    }}
                                    className={cn(
                                      "inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-all border",
                                      isSelected
                                        ? "bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-400"
                                        : "bg-gray-50 dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-slate-600"
                                    )}
                                  >
                                    <Tag className="w-2.5 h-2.5" />
                                    {tag.name}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="border-t border-gray-50 dark:border-slate-800" />
                      <div className="space-y-2">
                        <p className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t("activation_report.exclude_product_codes")}</p>
                        {excludedProductCodes.length === 0 ? (
                          <p className="text-xs text-gray-400 py-2">{t("activation_report.no_excluded_codes")}</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                            {excludedProductCodes.map(item => {
                              const isSelected = rsoExcludeCodes.includes(item.product_code);
                              return (
                                <button
                                  key={item.id}
                                  onClick={() => {
                                    setRsoExcludeCodes(prev =>
                                      isSelected ? prev.filter(c => c !== item.product_code) : [...prev, item.product_code]
                                    );
                                  }}
                                  className={cn(
                                    "inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-all border",
                                    isSelected
                                      ? "bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-400 line-through"
                                      : "bg-gray-50 dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-slate-600"
                                  )}
                                >
                                  {item.product_code}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                       <div className="border-t border-gray-50 dark:border-slate-800" />
                      <div className="space-y-2">
                        <p className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Active Days Threshold</p>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={1}
                            value={rsoActiveDaysThreshold}
                            onChange={e => setRsoActiveDaysThreshold(Math.max(1, parseInt(e.target.value) || 1))}
                            className="w-16 px-2 py-1.5 text-xs font-bold text-center bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                          />
                          <span className="text-xs text-gray-400">Min. activations/day to count as active</span>
                        </div>
                      </div>
                      <div className="border-t border-gray-50 dark:border-slate-800 flex items-center justify-between pt-2">
                        <button
                          onClick={() => { setRsoExcludeTags([]); setRsoExcludeCodes([]); setRsoAchievedExcludeTags([]); setRsoMarketExcludeTags([]); setRsoActiveDaysThreshold(1); }}
                          className="text-[11px] font-bold text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                        >
                          {t("common.reset")}
                        </button>
                        <button
                          onClick={() => { setShowRsoConfig(false); fetchDashboard(); }}
                          className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-bold hover:bg-primary-600 transition-colors shadow-sm"
                        >
                          {t("common.save_changes")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {activeTab === "bp" && hasPermission("reports.achievement.config") && (
                <div ref={bpConfigRef} className="relative">
                  <button
                    onClick={() => setShowBpConfig(!showBpConfig)}
                    className={cn(
                      "flex items-center justify-center w-8 h-8 rounded-lg text-sm transition-all relative",
                      showBpConfig
                        ? "bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 shadow-sm"
                        : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                    )}
                  >
                    <Settings className="w-4 h-4" />
                    {(bpExcludeTags.length > 0 || bpExcludeCodes.length > 0) && (
                      <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-primary-500 ring-2 ring-white dark:ring-slate-800" />
                    )}
                  </button>
                  {showBpConfig && (
                    <div className="absolute right-0 top-full mt-2 z-40 w-72 bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-2xl p-4 space-y-4">
                      {(bpExcludeTags.length > 0 || bpExcludeCodes.length > 0) && (
                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-primary-600 dark:text-primary-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary-500" />
                          {bpExcludeTags.length + bpExcludeCodes.length} filter{bpExcludeTags.length + bpExcludeCodes.length !== 1 ? 's' : ''} active
                        </div>
                      )}
                      <div className="space-y-2">
                        <p className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t("activation_report.exclude_tags")}</p>
                        {tags.length === 0 ? (
                          <p className="text-xs text-gray-400 py-2">{t("activation_report.no_tags")}</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {tags.map(tag => {
                              const isSelected = bpExcludeTags.includes(tag.name);
                              return (
                                <button
                                  key={tag.id}
                                  onClick={() => {
                                    setBpExcludeTags(prev =>
                                      isSelected ? prev.filter(t => t !== tag.name) : [...prev, tag.name]
                                    );
                                  }}
                                  className={cn(
                                    "inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-all border",
                                    isSelected
                                      ? "bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-400"
                                      : "bg-gray-50 dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-slate-600"
                                  )}
                                >
                                  <Tag className="w-2.5 h-2.5" />
                                  {tag.name}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <div className="border-t border-gray-50 dark:border-slate-800" />
                      <div className="space-y-2">
                        <p className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t("activation_report.exclude_product_codes")}</p>
                        {excludedProductCodes.length === 0 ? (
                          <p className="text-xs text-gray-400 py-2">{t("activation_report.no_excluded_codes")}</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                            {excludedProductCodes.map(item => {
                              const isSelected = bpExcludeCodes.includes(item.product_code);
                              return (
                                <button
                                  key={item.id}
                                  onClick={() => {
                                    setBpExcludeCodes(prev =>
                                      isSelected ? prev.filter(c => c !== item.product_code) : [...prev, item.product_code]
                                    );
                                  }}
                                  className={cn(
                                    "inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-all border",
                                    isSelected
                                      ? "bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-400 line-through"
                                      : "bg-gray-50 dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-slate-600"
                                  )}
                                >
                                  {item.product_code}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <div className="border-t border-gray-50 dark:border-slate-800 flex items-center justify-between pt-2">
                        <button
                          onClick={() => { setBpExcludeTags([]); setBpExcludeCodes([]); }}
                          className="text-[11px] font-bold text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                        >
                          {t("common.reset")}
                        </button>
                        <button
                          onClick={() => { setShowBpConfig(false); fetchDashboard(); }}
                          className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-bold hover:bg-primary-600 transition-colors shadow-sm"
                        >
                          {t("common.save_changes")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {activeTab === "cc" && hasPermission("reports.achievement.config") && (
                <div ref={ccConfigRef} className="relative">
                  <button
                    onClick={() => setShowCcConfig(!showCcConfig)}
                    className={cn(
                      "flex items-center justify-center w-8 h-8 rounded-lg text-sm transition-all relative",
                      showCcConfig
                        ? "bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 shadow-sm"
                        : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                    )}
                  >
                    <Settings className="w-4 h-4" />
                    {(ccExcludeTags.length > 0 || ccExcludeCodes.length > 0) && (
                      <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-primary-500 ring-2 ring-white dark:ring-slate-800" />
                    )}
                  </button>
                  {showCcConfig && (
                    <div className="absolute right-0 top-full mt-2 z-40 w-72 bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-2xl p-4 space-y-4">
                      {(ccExcludeTags.length > 0 || ccExcludeCodes.length > 0) && (
                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-primary-600 dark:text-primary-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary-500" />
                          {ccExcludeTags.length + ccExcludeCodes.length} filter{ccExcludeTags.length + ccExcludeCodes.length !== 1 ? 's' : ''} active
                        </div>
                      )}
                      <div className="space-y-2">
                        <p className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t("activation_report.exclude_tags")}</p>
                        {tags.length === 0 ? (
                          <p className="text-xs text-gray-400 py-2">{t("activation_report.no_tags")}</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {tags.map(tag => {
                              const isSelected = ccExcludeTags.includes(tag.name);
                              return (
                                <button
                                  key={tag.id}
                                  onClick={() => {
                                    setCcExcludeTags(prev =>
                                      isSelected ? prev.filter(t => t !== tag.name) : [...prev, tag.name]
                                    );
                                  }}
                                  className={cn(
                                    "inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-all border",
                                    isSelected
                                      ? "bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-400"
                                      : "bg-gray-50 dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-slate-600"
                                  )}
                                >
                                  <Tag className="w-2.5 h-2.5" />
                                  {tag.name}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <div className="border-t border-gray-50 dark:border-slate-800" />
                      <div className="space-y-2">
                        <p className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t("activation_report.exclude_product_codes")}</p>
                        {excludedProductCodes.length === 0 ? (
                          <p className="text-xs text-gray-400 py-2">{t("activation_report.no_excluded_codes")}</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                            {excludedProductCodes.map(item => {
                              const isSelected = ccExcludeCodes.includes(item.product_code);
                              return (
                                <button
                                  key={item.id}
                                  onClick={() => {
                                    setCcExcludeCodes(prev =>
                                      isSelected ? prev.filter(c => c !== item.product_code) : [...prev, item.product_code]
                                    );
                                  }}
                                  className={cn(
                                    "inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-all border",
                                    isSelected
                                      ? "bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-400 line-through"
                                      : "bg-gray-50 dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-slate-600"
                                  )}
                                >
                                  {item.product_code}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <div className="border-t border-gray-50 dark:border-slate-800 flex items-center justify-between pt-2">
                        <button
                          onClick={() => { setCcExcludeTags([]); setCcExcludeCodes([]); }}
                          className="text-[11px] font-bold text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                        >
                          {t("common.reset")}
                        </button>
                        <button
                          onClick={() => { setShowCcConfig(false); fetchDashboard(); }}
                          className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-bold hover:bg-primary-600 transition-colors shadow-sm"
                        >
                          {t("common.save_changes")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
)}

              {activeTab === "supervisor" && hasPermission("reports.achievement.config") && (
                <div ref={supervisorConfigRef} className="relative shrink-0">
                  <button
                    onClick={() => setShowSupervisorConfig(!showSupervisorConfig)}
                    className={cn(
                      "flex items-center justify-center w-8 h-8 rounded-lg text-sm transition-all relative bg-gray-100 dark:bg-slate-800",
                      showSupervisorConfig
                        ? "bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 shadow-sm"
                        : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                    )}
                  >
                    <Settings className="w-4 h-4" />
                    {(supervisorExcludeTags.length > 0 || supervisorExcludeCodes.length > 0) && (
                      <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-primary-500 ring-2 ring-white dark:ring-slate-800" />
                    )}
                  </button>
                  {showSupervisorConfig && (
                    <div className="absolute right-0 top-full mt-2 z-40 w-72 bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 shadow-2xl p-4 space-y-4">
                      {(supervisorExcludeTags.length > 0 || supervisorExcludeCodes.length > 0) && (
                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-primary-600 dark:text-primary-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary-500" />
                          {supervisorExcludeTags.length + supervisorExcludeCodes.length} filter{supervisorExcludeTags.length + supervisorExcludeCodes.length !== 1 ? 's' : ''} active
                        </div>
                      )}
                      <div className="space-y-2">
                        <p className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t("activation_report.exclude_tags")}</p>
                        {tags.length === 0 ? (
                          <p className="text-xs text-gray-400 py-2">{t("activation_report.no_tags")}</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {tags.map(tag => {
                              const isSelected = supervisorExcludeTags.includes(tag.name);
                              return (
                                <button
                                  key={tag.id}
                                  onClick={() => {
                                    setSupervisorExcludeTags(prev =>
                                      isSelected ? prev.filter(t => t !== tag.name) : [...prev, tag.name]
                                    );
                                  }}
                                  className={cn(
                                    "inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-all border",
                                    isSelected
                                      ? "bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-400"
                                      : "bg-gray-50 dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-slate-600"
                                  )}
                                >
                                  {tag.name}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <div className="border-t border-gray-50 dark:border-slate-800" />
                      <div className="space-y-2">
                        <p className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t("activation_report.exclude_product_codes")}</p>
                        {excludedProductCodes.length === 0 ? (
                          <p className="text-xs text-gray-400 py-2">{t("activation_report.no_excluded_codes")}</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                            {excludedProductCodes.map(item => {
                              const isSelected = supervisorExcludeCodes.includes(item.product_code);
                              return (
                                <button
                                  key={item.id}
                                  onClick={() => {
                                    setSupervisorExcludeCodes(prev =>
                                      isSelected ? prev.filter(c => c !== item.product_code) : [...prev, item.product_code]
                                    );
                                  }}
                                  className={cn(
                                    "inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-all border",
                                    isSelected
                                      ? "bg-rose-50 dark:bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-400 line-through"
                                      : "bg-gray-50 dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-slate-600"
                                  )}
                                >
                                  {item.product_code}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <div className="border-t border-gray-100 dark:border-slate-800 flex items-center justify-between pt-2">
                        <button
                          onClick={() => { setSupervisorExcludeTags([]); setSupervisorExcludeCodes([]); }}
                          className="text-[11px] font-bold text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                        >
                          {t("common.reset")}
                        </button>
                        <button
                          onClick={() => { setShowSupervisorConfig(false); fetchDashboard(); }}
                          className="px-3 py-1.5 bg-primary-500 text-white rounded-lg text-[11px] font-bold hover:bg-primary-600 transition-colors shadow-sm"
                        >
                          {t("common.save_changes")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

              {activeTab === "rso" && (
              <PerformanceTable data={data.rso_performance} t={t} type="rso" daysElapsed={data.summary.days_elapsed} totalDays={data.summary.total_days} daysRemaining={data.summary.days_remaining} />
            )}
            {activeTab === "bp" && (
              <PerformanceTable data={data.bp_performance} t={t} type="bp" daysElapsed={data.summary.days_elapsed} totalDays={data.summary.total_days} daysRemaining={data.summary.days_remaining} />
            )}
            {activeTab === "cc" && (
              <PerformanceTable data={data.cc_performance} t={t} type="cc" daysElapsed={data.summary.days_elapsed} totalDays={data.summary.total_days} daysRemaining={data.summary.days_remaining} />
            )}
            {activeTab === "supervisor" && (
              <PerformanceTable data={data.supervisor_performance} t={t} type="supervisor" daysElapsed={data.summary.days_elapsed} totalDays={data.summary.total_days} daysRemaining={data.summary.days_remaining} />
            )}
          </div>
        </>
      ) : !loading && !data ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm py-20 text-center">
          <Building2 className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
          <p className="text-gray-500 dark:text-gray-400 font-medium">
            {houses.length > 1 && !selectedHouseId
              ? t("activation_report.select_house")
              : t("activation_report.no_data")}
          </p>
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
                      const isSelected = achievementExcludeTags.includes(tag.name);
                      return (
                        <button
                          key={tag.id}
                          onClick={() => {
                            setAchievementExcludeTags(prev =>
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
                      const isSelected = achievementExcludeCodes.includes(item.product_code);
                      return (
                        <button
                          key={item.id}
                          onClick={() => {
                            setAchievementExcludeCodes(prev =>
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
                onClick={() => { setAchievementExcludeTags([]); setAchievementExcludeCodes([]); }}
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
