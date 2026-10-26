"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { toast } from "react-hot-toast";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import { AccessDenied } from "@/components/ui/AccessDenied";
import PageGuideModal from "@/components/PageGuideModal";
import {
  Loader2,
  Activity,
  Cpu,
  HardDrive,
  Server,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Database,
  Clock,
  ShieldAlert,
  Check,
  Zap,
  Layers
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from "recharts";

interface SystemSummary {
  cpu_percent: number;
  cpu_count: number;
  load_average: [number | null, number | null, number | null];
  ram_total: number;
  ram_used: number;
  ram_percent: number;
  swap_percent: number;
  disk_total: number;
  disk_used: number;
  disk_percent: number;
  net_sent: number;
  net_recv: number;
  uptime: number;
  timestamp: string;
}

interface ContainerSample {
  container_id: string;
  container_name: string;
  status: string;
  cpu_percent: number;
  memory_usage: number;
  memory_limit: number;
  memory_percent: number;
  restart_count: number;
  timestamp: string;
}

interface MonitoringAlert {
  id: number;
  severity: string;
  category: string;
  title: string;
  message: string;
  status: string;
  first_detected_at: string;
  last_detected_at: string;
}

interface AutomationJob {
  id: number;
  house_id: number | null;
  job_type: string;
  job_identifier: string | null;
  status: string;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  retry_count: number;
  created_at: string;
}

interface HouseOverview {
  house_id: number;
  house_code: string;
  house_name: string;
  is_active: boolean;
  last_successful_sync: string | null;
  last_job_type: string | null;
  failed_jobs_24h: number;
  status: string;
}

interface HistorySample {
  timestamp: string;
  cpu_percent: number;
  ram_percent: number;
  disk_percent: number;
  load_1m: number | null;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return "0 MB";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function formatUptime(seconds: number): string {
  if (!seconds) return "0s";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export default function SystemMonitoringPage() {
  const { user, loading: authLoading, hasPermission } = useAuth();
  const { t: translate } = useLanguage();
  const t = (key: string) => translate(`monitoring.${key}`);
  const tc = (key: string) => translate(`common.${key}`);

  const [loading, setLoading] = useState(true);
  const [collecting, setCollecting] = useState(false);
  const [summary, setSummary] = useState<{
    system: SystemSummary;
    containers: ContainerSample[];
    browser_automation: any;
    alerts: MonitoringAlert[];
    automation_jobs_24h: Record<string, number>;
    houses: HouseOverview[];
  } | null>(null);

  const [historyHours, setHistoryHours] = useState<number>(24);
  const [historyData, setHistoryData] = useState<HistorySample[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Job pagination and filters
  const [jobs, setJobs] = useState<AutomationJob[]>([]);
  const [jobPage, setJobPage] = useState(1);
  const [jobTotalPages, setJobTotalPages] = useState(1);
  const [jobStatusFilter, setJobStatusFilter] = useState<string>("");
  const [jobTypeFilter, setJobTypeFilter] = useState<string>("");
  const [jobsLoading, setJobsLoading] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiClient.get("v1/admin/monitoring/summary");
      if (res.data?.success) {
        setSummary(res.data.data);
      }
    } catch (err: any) {
      console.error("Failed to load monitoring summary:", err);
      toast.error(err?.response?.data?.error?.message || "Failed to fetch monitoring summary");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchHistory = useCallback(async (hours: number) => {
    try {
      setHistoryLoading(true);
      const res = await apiClient.get(`v1/admin/monitoring/history?hours=${hours}`);
      if (res.data?.success) {
        setHistoryData(res.data.data);
      }
    } catch (err: any) {
      console.error("Failed to load monitoring history:", err);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const fetchJobs = useCallback(async (page: number, status: string, jobType: string) => {
    try {
      setJobsLoading(true);
      let url = `v1/admin/monitoring/jobs?page=${page}&per_page=10`;
      if (status) url += `&job_status=${status}`;
      if (jobType) url += `&job_type=${jobType}`;
      const res = await apiClient.get(url);
      if (res.data?.success) {
        setJobs(res.data.data);
        setJobTotalPages(res.data.pagination.total_pages);
      }
    } catch (err: any) {
      console.error("Failed to load automation jobs:", err);
    } finally {
      setJobsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      fetchData();
      fetchHistory(historyHours);
      fetchJobs(jobPage, jobStatusFilter, jobTypeFilter);
    }
  }, [user, historyHours, jobPage, jobStatusFilter, jobTypeFilter, fetchData, fetchHistory, fetchJobs]);

  const handleCollectNow = async () => {
    try {
      setCollecting(true);
      const res = await apiClient.post("v1/admin/monitoring/collect-now");
      if (res.data?.success) {
        toast.success(t("collection_success"));
        fetchData();
        fetchHistory(historyHours);
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || "Failed to collect metrics");
    } finally {
      setCollecting(false);
    }
  };

  const handleAcknowledgeAlert = async (alertId: number) => {
    try {
      const res = await apiClient.post(`v1/admin/monitoring/alerts/${alertId}/acknowledge`);
      if (res.data?.success) {
        toast.success(t("acknowledged_success"));
        fetchData();
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || "Failed to resolve alert");
    }
  };

  if (authLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    );
  }

  // Permission check: requires monitoring.view (Super Admin, Admin, or user with monitoring.view permission)
  if (!hasPermission("monitoring.view")) {
    return <AccessDenied />;
  }

  const sys = summary?.system;
  const containers = summary?.containers || [];
  const alerts = summary?.alerts || [];
  const houses = summary?.houses || [];
  const browserAuto = summary?.browser_automation;

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white dark:bg-slate-900 p-6 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-rose-50 dark:bg-rose-950/50 rounded-xl text-rose-600 dark:text-rose-400">
            <Activity className="h-7 w-7" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t("title")}</h1>
              <PageGuideModal pageKey="monitoring" />
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t("subtitle")}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              fetchData();
              fetchHistory(historyHours);
              fetchJobs(jobPage, jobStatusFilter, jobTypeFilter);
            }}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700 cursor-pointer transition"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {tc("refresh")}
          </button>
          <button
            onClick={handleCollectNow}
            disabled={collecting}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 disabled:opacity-50 cursor-pointer transition shadow-sm"
          >
            {collecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            {collecting ? t("collecting") : t("collect_now")}
          </button>
        </div>
      </div>

      {loading && !summary ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 animate-pulse">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-32 bg-gray-100 dark:bg-slate-800 rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          {/* Active Alerts Banner */}
          {alerts.length > 0 && (
            <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded-2xl p-5 shadow-sm">
              <div className="flex items-center gap-3 mb-3">
                <AlertTriangle className="h-6 w-6 text-rose-600 dark:text-rose-400 shrink-0" />
                <h2 className="text-lg font-bold text-rose-900 dark:text-rose-200">
                  {alerts.length} {t("active_alerts")}
                </h2>
              </div>
              <div className="space-y-3">
                {alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-xl border border-rose-100 dark:border-rose-900/30"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                          alert.severity === "critical"
                            ? "bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200"
                            : "bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200"
                        }`}>
                          {alert.severity}
                        </span>
                        <span className="text-xs font-semibold text-gray-500 uppercase">{alert.category}</span>
                        <span className="text-xs text-gray-400">
                          {new Date(alert.last_detected_at).toLocaleTimeString()}
                        </span>
                      </div>
                      <h3 className="font-bold text-gray-900 dark:text-gray-100 text-sm mt-1">{alert.title}</h3>
                      <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5">{alert.message}</p>
                    </div>
                    <button
                      onClick={() => handleAcknowledgeAlert(alert.id)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 cursor-pointer shrink-0 transition"
                    >
                      {t("acknowledge")}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* System Health Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* CPU */}
            <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-500 dark:text-gray-400">{t("cpu_usage")}</span>
                <div className="p-2.5 bg-blue-50 dark:bg-blue-950/50 rounded-xl text-blue-600 dark:text-blue-400">
                  <Cpu className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-3xl font-extrabold text-gray-900 dark:text-gray-100">
                  {sys?.cpu_percent ?? 0}%
                </span>
                <span className="text-xs text-gray-500">({sys?.cpu_count || 1} Cores)</span>
              </div>
              <div className="mt-3 w-full bg-gray-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    (sys?.cpu_percent || 0) >= 90
                      ? "bg-rose-500"
                      : (sys?.cpu_percent || 0) >= 75
                      ? "bg-amber-500"
                      : "bg-blue-500"
                  }`}
                  style={{ width: `${Math.min(100, sys?.cpu_percent || 0)}%` }}
                />
              </div>
              <p className="text-[11px] text-gray-500 mt-2">
                {t("load_avg")}: {sys?.load_average?.map(l => l !== null ? l.toFixed(2) : "-").join(", ")}
              </p>
            </div>

            {/* RAM */}
            <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-500 dark:text-gray-400">{t("ram_usage")}</span>
                <div className="p-2.5 bg-purple-50 dark:bg-purple-950/50 rounded-xl text-purple-600 dark:text-purple-400">
                  <Server className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-3xl font-extrabold text-gray-900 dark:text-gray-100">
                  {sys?.ram_percent ?? 0}%
                </span>
                <span className="text-xs text-gray-500">
                  {formatBytes(sys?.ram_used || 0)} / {formatBytes(sys?.ram_total || 0)}
                </span>
              </div>
              <div className="mt-3 w-full bg-gray-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    (sys?.ram_percent || 0) >= 92
                      ? "bg-rose-500"
                      : (sys?.ram_percent || 0) >= 85
                      ? "bg-amber-500"
                      : "bg-purple-500"
                  }`}
                  style={{ width: `${Math.min(100, sys?.ram_percent || 0)}%` }}
                />
              </div>
              <p className="text-[11px] text-gray-500 mt-2">
                Swap: {sys?.swap_percent ?? 0}%
              </p>
            </div>

            {/* Disk */}
            <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-500 dark:text-gray-400">{t("disk_usage")}</span>
                <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/50 rounded-xl text-emerald-600 dark:text-emerald-400">
                  <HardDrive className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-3xl font-extrabold text-gray-900 dark:text-gray-100">
                  {sys?.disk_percent ?? 0}%
                </span>
                <span className="text-xs text-gray-500">
                  {formatBytes(sys?.disk_used || 0)} / {formatBytes(sys?.disk_total || 0)}
                </span>
              </div>
              <div className="mt-3 w-full bg-gray-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    (sys?.disk_percent || 0) >= 92
                      ? "bg-rose-500"
                      : (sys?.disk_percent || 0) >= 85
                      ? "bg-amber-500"
                      : "bg-emerald-500"
                  }`}
                  style={{ width: `${Math.min(100, sys?.disk_percent || 0)}%` }}
                />
              </div>
              <p className="text-[11px] text-gray-500 mt-2">
                {t("uptime")}: {formatUptime(sys?.uptime || 0)}
              </p>
            </div>

            {/* Browser Automation & Network */}
            <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-500 dark:text-gray-400">{t("browser_automation")}</span>
                <div className="p-2.5 bg-amber-50 dark:bg-amber-950/50 rounded-xl text-amber-600 dark:text-amber-400">
                  <Layers className="h-5 w-5" />
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200">
                  {browserAuto?.status || "Running"}
                </span>
                <span className="text-xs text-gray-500">{browserAuto?.browser_type}</span>
              </div>
              <div className="mt-3 text-xs space-y-1 text-gray-600 dark:text-gray-400">
                <div className="flex justify-between">
                  <span>{t("active_contexts")}:</span>
                  <span className="font-medium text-gray-900 dark:text-gray-100">{browserAuto?.active_contexts}</span>
                </div>
                <div className="flex justify-between">
                  <span>Net Sent / Recv:</span>
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    {formatBytes(sys?.net_sent || 0)} / {formatBytes(sys?.net_recv || 0)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Historical Metrics Chart */}
          <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t("historical_charts")}</h2>
                <p className="text-xs text-gray-500 mt-0.5">CPU, RAM, and Disk utilization over time</p>
              </div>
              <div className="flex items-center gap-2 bg-gray-50 dark:bg-slate-800 p-1 rounded-xl">
                {[
                  { label: t("last_24_hours"), val: 24 },
                  { label: t("last_48_hours"), val: 48 },
                  { label: t("last_7_days"), val: 168 },
                ].map((item) => (
                  <button
                    key={item.val}
                    onClick={() => setHistoryHours(item.val)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition ${
                      historyHours === item.val
                        ? "bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 shadow-sm"
                        : "text-gray-500 hover:text-gray-900 dark:hover:text-gray-100"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {historyLoading ? (
              <div className="h-72 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
              </div>
            ) : historyData.length === 0 ? (
              <div className="h-72 flex items-center justify-center text-sm text-gray-400">
                No historical samples available yet.
              </div>
            ) : (
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={historyData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} />
                    <XAxis
                      dataKey="timestamp"
                      tickFormatter={(ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      stroke="#9CA3AF"
                      fontSize={11}
                    />
                    <YAxis domain={[0, 100]} stroke="#9CA3AF" fontSize={11} unit="%" />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#1F2937", borderColor: "#374151", borderRadius: "12px", color: "#F9FAFB" }}
                      labelFormatter={(ts) => new Date(String(ts)).toLocaleString()}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="cpu_percent" name="CPU %" stroke="#3B82F6" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="ram_percent" name="RAM %" stroke="#8B5CF6" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="disk_percent" name="Disk %" stroke="#10B981" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Docker Containers & House Status Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Containers Table */}
            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t("containers")}</h2>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
                  {containers.length} Containers
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 dark:bg-slate-800 text-xs text-gray-500 uppercase">
                    <tr>
                      <th className="px-3 py-2">{t("container_name")}</th>
                      <th className="px-3 py-2">{t("status")}</th>
                      <th className="px-3 py-2">{t("cpu_percent")}</th>
                      <th className="px-3 py-2">{t("memory_usage")}</th>
                      <th className="px-3 py-2">{t("restarts")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                    {containers.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-gray-400 text-xs">
                          No container metrics detected (Docker socket not mounted or inactive).
                        </td>
                      </tr>
                    ) : (
                      containers.map((c, idx) => (
                        <tr key={idx} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/50">
                          <td className="px-2 py-1 font-medium text-gray-900 dark:text-gray-100">
                            {c.container_name}
                            <div className="text-[11px] text-gray-400 font-mono">{c.container_id}</div>
                          </td>
                          <td className="px-2 py-1">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold ${
                              c.status === "running" || c.status === "healthy"
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
                                : "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200"
                            }`}>
                              {c.status}
                            </span>
                          </td>
                          <td className="px-2 py-1 text-gray-600 dark:text-gray-300 font-mono">{c.cpu_percent}%</td>
                          <td className="px-2 py-1 text-gray-600 dark:text-gray-300">
                            {formatBytes(c.memory_usage)}
                            <div className="text-[11px] text-gray-400">{c.memory_percent}%</div>
                          </td>
                          <td className="px-2 py-1 text-gray-600 dark:text-gray-300">{c.restart_count}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* House Automation Status */}
            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t("house_overviews")}</h2>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-purple-50 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300">
                  {houses.length} Houses
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-gray-50 dark:bg-slate-800 text-xs text-gray-500 uppercase">
                    <tr>
                      <th className="px-3 py-2">{t("house")}</th>
                      <th className="px-3 py-2">{t("last_sync")}</th>
                      <th className="px-3 py-2">{t("failed_24h")}</th>
                      <th className="px-3 py-2">{t("status")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                    {houses.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-6 text-center text-gray-400 text-xs">
                          No distribution houses configured.
                        </td>
                      </tr>
                    ) : (
                      houses.map((h) => (
                        <tr key={h.house_id} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/50">
                          <td className="px-2 py-1 font-medium text-gray-900 dark:text-gray-100">
                            {h.house_name}
                            <div className="text-[11px] text-gray-400">{h.house_code}</div>
                          </td>
                          <td className="px-2 py-1 text-xs text-gray-600 dark:text-gray-300">
                            {h.last_successful_sync ? new Date(h.last_successful_sync).toLocaleString() : "Never"}
                            {h.last_job_type && <div className="text-[11px] text-gray-400 uppercase">{h.last_job_type}</div>}
                          </td>
                          <td className="px-2 py-1 font-bold text-gray-900 dark:text-gray-100">
                            {h.failed_jobs_24h > 0 ? (
                              <span className="text-rose-600">{h.failed_jobs_24h}</span>
                            ) : (
                              <span className="text-emerald-600">0</span>
                            )}
                          </td>
                          <td className="px-2 py-1">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                              h.status === "healthy"
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
                                : h.status === "warning"
                                ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200"
                                : "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200"
                            }`}>
                              {h.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Automation Job Records Table */}
          <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t("automation_jobs")}</h2>
                <p className="text-xs text-gray-500 mt-0.5">Background sync and job execution logs</p>
              </div>
              <div className="flex items-center gap-3">
                <select
                  value={jobStatusFilter}
                  onChange={(e) => {
                    setJobStatusFilter(e.target.value);
                    setJobPage(1);
                  }}
                  className="bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 outline-none cursor-pointer"
                >
                  <option value="">All Statuses</option>
                  <option value="success">Success</option>
                  <option value="failed">Failed</option>
                  <option value="running">Running</option>
                </select>
              </div>
            </div>

            {jobsLoading ? (
              <div className="h-48 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 dark:bg-slate-800 text-xs text-gray-500 uppercase">
                      <tr>
                        <th className="px-3 py-2">ID</th>
                        <th className="px-3 py-2">{t("job_type")}</th>
                        <th className="px-3 py-2">{t("status")}</th>
                        <th className="px-3 py-2">{t("duration")}</th>
                        <th className="px-3 py-2">{t("started_at")}</th>
                        <th className="px-3 py-2">Error / Info</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                      {jobs.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-3 py-6 text-center text-gray-400 text-xs">
                            No automation job records found.
                          </td>
                        </tr>
                      ) : (
                        jobs.map((j) => (
                          <tr key={j.id} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/50">
                            <td className="px-2 py-1 font-mono text-xs text-gray-500">#{j.id}</td>
                            <td className="px-2 py-1 font-semibold text-gray-900 dark:text-gray-100 uppercase text-xs">
                              {j.job_type}
                              {j.job_identifier && <div className="text-[11px] text-gray-400 font-normal">{j.job_identifier}</div>}
                            </td>
                            <td className="px-2 py-1">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                                j.status === "success"
                                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
                                  : j.status === "failed"
                                  ? "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200"
                                  : "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200"
                              }`}>
                                {j.status}
                              </span>
                            </td>
                            <td className="px-2 py-1 text-xs text-gray-600 dark:text-gray-300 font-mono">
                              {j.duration_ms ? `${j.duration_ms} ms` : "-"}
                            </td>
                            <td className="px-2 py-1 text-xs text-gray-500">
                              {j.started_at ? new Date(j.started_at).toLocaleString() : "-"}
                            </td>
                            <td className="px-2 py-1 text-xs text-rose-600 max-w-xs truncate">
                              {j.error_message || "-"}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {jobTotalPages > 1 && (
                  <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100 dark:border-slate-800">
                    <span className="text-xs text-gray-500">
                      Page {jobPage} of {jobTotalPages}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setJobPage((p) => Math.max(1, p - 1))}
                        disabled={jobPage === 1}
                        className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 text-xs font-medium disabled:opacity-50 cursor-pointer"
                      >
                        {tc("prev")}
                      </button>
                      <button
                        onClick={() => setJobPage((p) => Math.min(jobTotalPages, p + 1))}
                        disabled={jobPage === jobTotalPages}
                        className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 text-xs font-medium disabled:opacity-50 cursor-pointer"
                      >
                        {tc("next")}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
