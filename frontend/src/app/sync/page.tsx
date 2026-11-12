"use client";
import { useState, useCallback, useEffect, useRef } from "react";
import { useLanguage } from "@/i18n/useLanguage";
import { useAuth } from "@/context/AuthContext";
import { CloudDownload, Loader2, CheckCircle2, Activity, Database, Zap, Building2, X, SmartphoneNfc } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "react-hot-toast";
import Cookies from "js-cookie";
import axios from "@/lib/api";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { cn } from "@/lib/utils";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "/api";
const ITOPUP_TYPES = ["C2C", "C2S", "Balance"] as const;
type ITopupTypeStatus = "waiting" | "checking" | "queued" | "downloading" | "complete" | "no_missing" | "failed";

function getItopupTypeStatus(events: string[], reportType: string): ITopupTypeStatus {
  let latestModuleStartIndex = -1;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].startsWith("Checking ITopUp Detail for ")) {
      latestModuleStartIndex = index;
      break;
    }
  }

  let latestCheckIndex = -1;
  for (let index = events.length - 1; index > latestModuleStartIndex; index -= 1) {
    if (events[index].startsWith(`Checking iTopUp ${reportType} `)) {
      latestCheckIndex = index;
      break;
    }
  }

  if (latestModuleStartIndex >= 0 && latestCheckIndex < latestModuleStartIndex) {
    return "checking";
  }

  const typeEvents = events.slice(latestCheckIndex < 0 ? 0 : latestCheckIndex).filter(
    (message) =>
      message.includes(`iTopUp ${reportType}`) ||
      message.includes(`dms_report_${reportType}`),
  );
  const latestEvent = typeEvents[typeEvents.length - 1];
  if (!latestEvent) return "waiting";
  if (latestEvent.startsWith("Checking iTopUp")) return "checking";
  if (latestEvent.startsWith("No missing dates")) return "no_missing";
  if (latestEvent.startsWith("Downloading dms_report_")) return "downloading";
  if (latestEvent.startsWith("Found ")) {
    return latestEvent.includes("0 missing range(s)") ? "no_missing" : "queued";
  }
  if (latestEvent.startsWith("✓ dms_report_")) {
    const expectedRanges = typeEvents
      .filter((message) => message.startsWith("Found "))
      .reduce((total, message) => total + Number(message.match(/^Found (\d+)/)?.[1] || 0), 0);
    const completedRanges = typeEvents.filter((message) => message.startsWith("✓ dms_report_")).length;
    if (latestEvent.endsWith(": error")) return "failed";
    return completedRanges >= expectedRanges ? "complete" : "queued";
  }
  return "waiting";
}

interface HouseOption {
  id: number; name: string; code: string;
}

interface SyncCardProps {
  title: string;
  description: string;
  icon: any;
  color: string;
  bgColor: string;
  endpoint: string;
  permission: string;
  hasPermission: boolean;
  t: (key: string) => string;
  active: boolean;
  busy: boolean;
  backgroundActive: boolean;
  onSyncClick: (endpoint: string, label: string, bg: boolean) => void;
}

function SyncCard({ title, description, icon: Icon, color, bgColor, endpoint, hasPermission, t, active, busy, backgroundActive, onSyncClick }: SyncCardProps) {
  if (!hasPermission) return null;

  return (
    <div className="group/card bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-3 sm:p-4 hover:shadow-md hover:border-primary-200 dark:hover:border-primary-800/50 transition-all duration-300">
      <div className="flex flex-col items-center gap-3 mb-4 text-center sm:flex-row sm:items-start sm:gap-4 sm:text-left">
        <div className={cn("p-3 rounded-xl transition-all duration-300 group-hover/card:scale-110 group-hover/card:shadow-sm", bgColor)}>
          <Icon className={cn("w-6 h-6 transition-all duration-300 group-hover/card:scale-110", color)} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{title}</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{description}</p>
        </div>
      </div>
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={() => onSyncClick(endpoint, title, false)}
          disabled={busy}
          className="group/btn flex-1 flex min-h-11 cursor-pointer items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-medium hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200 shadow-lg shadow-primary-200 dark:shadow-primary-900/30 hover:shadow-xl hover:shadow-primary-300 dark:hover:shadow-primary-900/50 hover:scale-[1.02] active:scale-[0.98]"
        >
          {active && !backgroundActive ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudDownload className="w-4 h-4 transition-all duration-300 group-hover/btn:-translate-y-0.5" />}
          {active && !backgroundActive ? t('sync.syncing') : t('sync.sync_now')}
        </button>
        <button
          onClick={() => onSyncClick(endpoint, title, true)}
          disabled={busy}
          className="flex min-h-11 cursor-pointer items-center justify-center gap-2 px-4 py-2.5 bg-gray-100 dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-100 hover:bg-gray-200 dark:hover:bg-slate-700 hover:border-gray-400 dark:hover:border-gray-500 disabled:cursor-not-allowed disabled:opacity-50 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
        >
          {active && backgroundActive && <Loader2 className="h-4 w-4 animate-spin" />}
          {t('sync.sync_bg')}
        </button>
      </div>
    </div>
  );
}

export default function SyncPage() {
  const { t } = useLanguage();
  const { hasPermission } = useAuth();
  const [activeEndpoint, setActiveEndpoint] = useState<string | null>(null);
  const [backgroundActive, setBackgroundActive] = useState(false);
  const [progressMsg, setProgressMsg] = useState<string | null>(null);
  const [progressEvents, setProgressEvents] = useState<string[]>([]);
  const [houses, setHouses] = useState<HouseOption[]>([]);
  const [houseModal, setHouseModal] = useState<{ endpoint: string; label: string; bg: boolean } | null>(null);
  const pollingRef = useRef(false);

  useEffect(() => {
    axios.get("/houses/accessible").then(r => setHouses(r.data || [])).catch(() => {});
  }, []);

  const pollStatus = useCallback(async (jobId: string) => {
    pollingRef.current = true;
    const token = Cookies.get("token");

    while (pollingRef.current) {
      await new Promise(r => setTimeout(r, 2000));

      try {
        const h: Record<string, string> = {};
        if (token) h["Authorization"] = `Bearer ${token}`;
        const res = await fetch(`${API_BASE}/sync/status/${jobId}`, { headers: h });

        if (!res.ok) {
          pollingRef.current = false;
          setActiveEndpoint(null);
          setBackgroundActive(false);
          setProgressMsg(null);
          toast.error("Failed to check sync status");
          return;
        }

        const data = await res.json();

        if (data.status === "not_found") {
          pollingRef.current = false;
          setActiveEndpoint(null);
          setBackgroundActive(false);
          setProgressMsg(null);
          toast.error("Sync job not found");
          return;
        }

        if (data.events?.length > 0) {
          const messages = data.events.map((event: { msg: string }) => event.msg);
          setProgressEvents(messages);
          setProgressMsg(messages[messages.length - 1]);
        }

        if (data.status === "complete") {
          pollingRef.current = false;
          setActiveEndpoint(null);
          setBackgroundActive(false);
          setProgressMsg(null);
          toast.success(data.message || "Sync completed");
          return;
        }

        if (data.status === "error") {
          pollingRef.current = false;
          setActiveEndpoint(null);
          setBackgroundActive(false);
          setProgressMsg(null);
          toast.error(data.message || "Sync failed");
          return;
        }
      } catch (e: any) {
        pollingRef.current = false;
        setActiveEndpoint(null);
        setBackgroundActive(false);
        setProgressMsg(null);
        toast.error(e?.message || "Lost connection to sync");
        return;
      }
    }
  }, []);

  const doSync = async (endpoint: string, label: string, background: boolean, houseId: string) => {
    setActiveEndpoint(endpoint);
    setBackgroundActive(background);
    setProgressMsg(`Starting ${label} sync...`);
    setProgressEvents([]);

    try {
      const token = Cookies.get("token");
      const h: Record<string, string> = {};
      if (token) h["Authorization"] = `Bearer ${token}`;
      if (houseId) h["X-House-ID"] = houseId;

      const url = `${API_BASE}${endpoint}${background ? "?background=true" : ""}`;
      const res = await fetch(url, { method: "POST", headers: h });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.detail || err?.message || `Request failed (${res.status})`);
      }

      const data = await res.json();

      if (background) {
        toast.success(`${label}: ${t('sync.started')}`);
        if (data.job_id) {
          pollStatus(data.job_id);
        } else {
          setActiveEndpoint(null);
          setBackgroundActive(false);
          setProgressMsg(null);
        }
        return;
      }

      if (data.job_id) {
        pollStatus(data.job_id);
      } else {
        setActiveEndpoint(null);
        setBackgroundActive(false);
        setProgressMsg(null);
        toast.success(data.message || "Sync completed");
      }
    } catch (err: any) {
      toast.error(err?.message || "Sync failed");
      setActiveEndpoint(null);
      setBackgroundActive(false);
      setProgressMsg(null);
    }
  };

  const handleSyncClick = (endpoint: string, label: string, bg: boolean) => {
    setHouseModal({ endpoint, label, bg });
  };

  const handleHouseSelect = (houseId: string) => {
    const m = houseModal!;
    setHouseModal(null);
    doSync(m.endpoint, m.label, m.bg, houseId);
  };

  const modules = [
    {
      title: t('sync.activation'),
      description: t('sync.activation_desc'),
      icon: Activity,
      color: "text-primary-600",
      bgColor: "bg-primary-100 dark:bg-primary-500/20",
      endpoint: "/sync/activation",
      permission: "automation.dms_sync",
    },
    {
      title: t('sync.itopup'),
      description: t('sync.itopup_desc'),
      icon: Database,
      color: "text-emerald-600",
      bgColor: "bg-emerald-100 dark:bg-emerald-500/20",
      endpoint: "/sync/itopup",
      permission: "automation.dms_sync",
    },
    {
      title: t('sync.sim_issue'),
      description: t('sync.sim_issue_desc'),
      icon: SmartphoneNfc,
      color: "text-sky-600",
      bgColor: "bg-sky-100 dark:bg-sky-500/20",
      endpoint: "/sync/sim-issue",
      permission: "automation.dms_sync",
    },
    {
      title: t('sync.live_activation'),
      description: t('sync.live_activation_desc'),
      icon: Zap,
      color: "text-amber-600",
      bgColor: "bg-amber-100 dark:bg-amber-500/20",
      endpoint: "/sync/live-activation",
      permission: "automation.ga_sync",
    },
  ];

  const canView = modules.some(m => hasPermission(m.permission));
  if (!canView) return <AccessDenied />;

  const lastProgressEvent = progressEvents[progressEvents.length - 1] || "";
  const currentTask = lastProgressEvent || progressMsg || "";
  const taskFailed = currentTask.startsWith("✗") || currentTask.endsWith(": error");
  const taskComplete = currentTask.startsWith("✓") || currentTask.startsWith("No missing dates");
  const currentItopupType =
    lastProgressEvent.startsWith("Checking ITopUp Detail for ") ||
    lastProgressEvent.startsWith("Range progress: checking for ")
      ? null
      : progressEvents
        .slice()
        .reverse()
        .map((message) => message.match(/(?:dms_report_|iTopUp\s+|\[)(C2C|C2S|Balance)/i)?.[1])
        .find(Boolean) ?? null;
  const latestRangeProgress = progressEvents
    .slice()
    .reverse()
    .find((message) => message.startsWith("Range progress:"));
  const rangeProgress = latestRangeProgress?.match(/Range progress:\s*(\d+)\/(\d+)\s+ranges/);
  const processedRanges = rangeProgress ? Number(rangeProgress[1]) : null;
  const totalRanges = rangeProgress ? Number(rangeProgress[2]) : null;
  const progressPercent = totalRanges === null
    ? null
    : totalRanges === 0
      ? 100
      : Math.min(100, Math.round(((processedRanges || 0) / totalRanges) * 100));

  return (
    <div className="p-2 sm:p-4 lg:p-6 space-y-3 sm:space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="p-2.5 bg-purple-100 dark:bg-purple-500/20 rounded-xl">
          <CloudDownload className="w-5 h-5 text-purple-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('sync.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t('sync.description')}</p>
        </div>
      </div>

      {progressMsg && (
        <div className="overflow-hidden rounded-2xl border border-primary-100 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col items-center gap-2 border-b border-gray-100 bg-gradient-to-r from-primary-50/80 to-white px-4 py-4 text-center dark:border-slate-700 dark:bg-slate-900 dark:from-slate-800 dark:via-slate-900 dark:to-slate-900 sm:flex-row sm:items-start sm:gap-3 sm:px-5 sm:text-left">
            <div className="shrink-0 rounded-xl bg-primary-100 p-2.5 text-primary-700 dark:bg-primary-500/20 dark:text-primary-300">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                <h2 className="font-semibold text-gray-900 dark:text-gray-100">{t('sync.progress_title')}</h2>
                <span className="rounded-full bg-primary-100 px-2.5 py-1 text-xs font-semibold text-primary-700 dark:border dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100">
                  {modules.find((module) => module.endpoint === activeEndpoint)?.title}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('sync.progress_detail')}</p>
            </div>
          </div>

          <div className="space-y-4 p-4 sm:p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t('sync.current_task')}
                </p>
                <div
                  role="log"
                  aria-label={t('sync.current_task')}
                  aria-live="polite"
                  aria-relevant="additions text"
                  title={currentTask}
                  className="mt-1 flex min-h-11 min-w-0 items-center gap-2 overflow-hidden rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950/60"
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                    {taskFailed ? (
                      <X className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                    ) : taskComplete ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Loader2 className="h-4 w-4 animate-spin text-primary-600" />
                    )}
                  </span>
                  <div className="h-5 min-w-0 flex-1 overflow-hidden">
                    <AnimatePresence mode="wait">
                      <motion.p
                        key={currentTask}
                        initial={{ y: 20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: -20, opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        className={cn(
                          "truncate text-xs",
                          taskFailed
                            ? "font-medium text-rose-700 dark:text-rose-300"
                            : taskComplete
                              ? "font-medium text-emerald-700 dark:text-emerald-300"
                              : "font-medium text-gray-700 dark:text-gray-200",
                        )}
                      >
                        {currentTask}
                      </motion.p>
                    </AnimatePresence>
                  </div>
                </div>
              </div>
              {activeEndpoint === "/sync/itopup" && (
                <div className="shrink-0 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-900/70 dark:bg-emerald-950/30">
                  <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300">{t('sync.current_type')}</p>
                  <p className="mt-0.5 text-sm font-bold text-emerald-800 dark:text-emerald-200">
                    {currentItopupType || t('sync.preparing')}
                  </p>
                </div>
              )}
            </div>

            {activeEndpoint === "/sync/itopup" && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t('sync.itopup_type_progress')}
                </p>
                <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                  {ITOPUP_TYPES.map((reportType) => {
                    const status = getItopupTypeStatus(progressEvents, reportType);
                    const isCurrent = currentItopupType === reportType;
                    const isDone = status === "complete" || status === "no_missing";
                    const isFailed = status === "failed";
                    return (
                      <div
                        key={reportType}
                        className={cn(
                          "flex min-h-11 items-center justify-between gap-1 rounded-xl border px-2 py-2",
                          isCurrent
                            ? "border-primary-300 bg-primary-50 dark:border-primary-800 dark:bg-primary-950/40"
                            : isFailed
                              ? "border-rose-200 bg-rose-50 dark:border-rose-900/60 dark:bg-rose-950/30"
                              : isDone
                                ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30"
                                : "border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-slate-800/60",
                        )}
                      >
                        <span className="text-xs font-bold text-gray-800 dark:text-gray-100 sm:text-sm">{reportType}</span>
                        <span className="flex items-center gap-1 whitespace-nowrap text-[10px] font-medium text-gray-600 dark:text-gray-300 sm:text-xs">
                          {isCurrent && !isDone && !isFailed ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary-600" />
                          ) : isDone ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                          ) : null}
                          {t(`sync.status_${status}`)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t('sync.range_progress_title')}
                </p>
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                  {progressPercent === null
                    ? t('sync.preparing')
                    : totalRanges === 0
                      ? t('sync.no_missing_ranges')
                      : (
                      <>
                        {t('sync.ranges_progress')
                          .replace('{completed}', String(processedRanges))
                          .replace('{total}', String(totalRanges))}
                        <span className="ml-1 text-gray-500 dark:text-gray-400">({progressPercent}%)</span>
                      </>
                      )}
                </p>
              </div>
              <div
                role="progressbar"
                aria-label={t('sync.range_progress_title')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progressPercent ?? undefined}
                className="h-2.5 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800"
              >
                <div
                  className={cn(
                    "h-full rounded-full bg-gradient-to-r from-primary-500 to-emerald-500 transition-all duration-500",
                    progressPercent === null && "w-1/3 animate-pulse",
                  )}
                  style={progressPercent === null ? undefined : { width: `${progressPercent}%` }}
                />
              </div>
            </div>

          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 sm:gap-3">
        {modules.map((mod) => (
          <SyncCard
            key={mod.endpoint}
            {...mod}
            hasPermission={hasPermission(mod.permission)}
            t={t}
            active={activeEndpoint === mod.endpoint}
            busy={activeEndpoint !== null}
            backgroundActive={activeEndpoint === mod.endpoint && backgroundActive}
            onSyncClick={handleSyncClick}
          />
        ))}
      </div>

      {/* House selection modal */}
      {houseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/40" onClick={() => setHouseModal(null)} />
          <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border dark:border-slate-700 p-4 sm:p-6 w-full max-w-sm mx-4">
            <button
              onClick={() => setHouseModal(null)}
              className="absolute top-4 right-4 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">
              {houseModal.bg ? t('sync.sync_bg') : t('sync.sync_now')}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              {houseModal.label} &mdash; select a house
            </p>
            <div className="space-y-1.5">
              <button
                onClick={() => handleHouseSelect("")}
                className="flex cursor-pointer items-center gap-3 w-full text-left px-4 py-3 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors border border-transparent hover:border-gray-300 dark:hover:border-slate-600"
              >
                <Building2 className="w-4 h-4 text-gray-400" />
                All Houses
              </button>
              {houses.map(h => (
                <button
                  key={h.id}
                  onClick={() => handleHouseSelect(String(h.id))}
                  className="flex cursor-pointer items-center gap-3 w-full text-left px-4 py-3 rounded-xl text-sm text-gray-700 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors border border-transparent hover:border-gray-300 dark:hover:border-slate-600"
                >
                  <Building2 className="w-4 h-4 text-gray-400 shrink-0" />
                  <span>{h.name}</span>
                  <span className="text-gray-400 text-xs ml-auto">({h.code})</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
