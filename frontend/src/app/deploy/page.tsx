"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Rocket,
  GitCommitHorizontal,
  Loader2,
  CheckCircle2,
  XCircle,
  Terminal,
  RefreshCw,
  AlertTriangle,
  Shield,
  Clock,
  Activity,
} from "lucide-react";
import PageGuideModal from "@/components/PageGuideModal";
import DeployProgress, { type DeployStep } from "@/components/deploy/DeployProgress";
import DeployLogViewer from "@/components/deploy/DeployLogViewer";
import { API_BASE, default as apiClient } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { useLanguage } from "@/i18n/useLanguage";
import { cn } from "@/lib/utils";

const DEPLOY_SERVICE_HOST = (() => {
  const base = API_BASE.replace(/\/api\/?$/, "");
  const parsed = new URL(base);
  return parsed.hostname;
})();

const DEPLOY_WS_URL = `ws://${DEPLOY_SERVICE_HOST}:8100`;
const DEPLOY_HTTP_URL = `http://${DEPLOY_SERVICE_HOST}:8100`;

type DeployState =
  | { type: "idle" }
  | { type: "running"; currentStep: string | null; steps: DeployStep[] }
  | { type: "completed"; exitCode: number; message: string; duration: number }
  | { type: "failed"; exitCode: number; message: string }
  | { type: "error"; message: string };

interface PendingCommit {
  hash: string;
  subject: string;
  date?: string;
}

interface WsStatusData {
  state?: string;
  currentStep?: string | null;
  steps?: DeployStep[];
  exitCode?: number | null;
  message?: string;
  duration?: number;
}

interface WsMessage {
  type: string;
  data?: WsStatusData & {
    step?: string;
    line?: string;
    lines?: string[];
    ok?: boolean;
    error?: string;
    exitCode?: number;
    failed?: boolean;
  };
  timestamp?: number;
}

export default function DeployPage() {
  const { t } = useLanguage();
  const { hasPermission, loading: authLoading, user } = useAuth();
  const router = useRouter();

  const [mounted, setMounted] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [deploy, setDeploy] = useState<DeployState>({ type: "idle" });
  const [pendingCommits, setPendingCommits] = useState<PendingCommit[]>([]);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [logs, setLogs] = useState<{ time: string; text: string; type: "log" | "error" | "system" }[]>([]);
  const [starting, setStarting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAdmin = Boolean(
    user?.roles?.some(
      (r) => r.name.toLowerCase() === "admin" || r.name.toLowerCase() === "super admin" || r.name.toLowerCase() === "super_admin"
    )
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  // Redirect if no permission
  useEffect(() => {
    if (!authLoading && !hasPermission("app_settings.manage")) {
      const timer = setTimeout(() => router.push("/"), 5000);
      return () => clearTimeout(timer);
    }
  }, [authLoading, hasPermission, router]);

  const addLog = useCallback((type: "log" | "error" | "system", text: string) => {
    setLogs((prev) => [...prev, { time: new Date().toLocaleTimeString(), text, type }]);
  }, []);

  const fetchCommits = useCallback(async () => {
    try {
      const res = await fetch(`${DEPLOY_HTTP_URL}/api/pending-commits`, { cache: "no-store" });
      const data = await res.json();
      setPendingCommits(data.commits || []);
      setPendingCount(data.count ?? 0);
      return data;
    } catch {
      setPendingCommits([]);
      setPendingCount(null);
      return null;
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${DEPLOY_HTTP_URL}/api/status`, { cache: "no-store" });
      return await res.json();
    } catch {
      return null;
    }
  }, []);

  // Request a short-lived admin deploy ticket from the backend. The deploy-service
  // validates this ticket before allowing a deploy to be triggered/reset.
  const getDeployTicket = useCallback(async (): Promise<string | null> => {
    try {
      const res = await apiClient.post("v1/deploy/authorize");
      return res.data?.ticket ?? null;
    } catch {
      return null;
    }
  }, []);

  const handleWsMessage = useCallback(
    (msg: WsMessage) => {
      const data = msg.data ?? {};
      switch (msg.type) {
        case "status":
          if (data.state === "running") {
            setDeploy({ type: "running", currentStep: data.currentStep ?? null, steps: (data.steps as DeployStep[]) || [] });
          } else if (data.state === "completed") {
            setDeploy({ type: "completed", exitCode: data.exitCode ?? 0, message: data.message || "Deploy successful", duration: data.duration ?? 0 });
          } else if (data.state === "failed") {
            setDeploy({ type: "failed", exitCode: data.exitCode ?? 1, message: data.message || "Deploy failed" });
          } else {
            setDeploy({ type: "idle" });
          }
          break;

        case "step":
          setDeploy((prev) => {
            if (prev.type !== "running") return prev;
            return {
              ...prev,
              currentStep: data.step ?? null,
              steps: [...prev.steps, { name: data.step ?? "unknown", status: "running" as const, startTime: Date.now() }],
            };
          });
          break;

        case "progress":
          break;

        case "log":
          setLogs((prev) => [...prev, { time: new Date().toLocaleTimeString(), text: data.line ?? "", type: "log" as const }]);
          break;

        case "log_batch": {
          const lines: string[] = data.lines || [];
          setLogs((prev) => [
            ...prev,
            ...lines.map((line) => ({ time: new Date().toLocaleTimeString(), text: line, type: "log" as const })),
          ]);
          break;
        }

        case "complete":
          setDeploy({
            type: "completed",
            exitCode: data.exitCode ?? 0,
            message: data.message ?? "Deploy successful",
            duration: data.duration ?? 0,
          });
          setStarting(false);
          fetchCommits();
          break;

        case "failed":
          setDeploy({ type: "failed", exitCode: data.exitCode ?? 1, message: data.message ?? "Deploy failed" });
          setStarting(false);
          break;

        case "trigger_result":
          setStarting(false);
          if (!data.ok) {
            addLog("error", data.error ?? "Failed to start deploy");
          }
          break;
      }
    },
    [fetchCommits, addLog]
  );

  // Initial load
  useEffect(() => {
    if (mounted && isAdmin) {
      fetchCommits();
      fetchStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, isAdmin]);

  // WebSocket connection with auto-reconnect
  useEffect(() => {
    if (!mounted || !isAdmin) return;

    let closed = false;

    const connect = () => {
      if (closed) return;
      try {
        const ws = new WebSocket(DEPLOY_WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
          setWsConnected(true);
          addLog("system", "Connected to deploy service");
        };

        ws.onclose = () => {
          setWsConnected(false);
          if (!closed) {
            reconnectRef.current = setTimeout(connect, 3000);
          }
        };

        ws.onerror = () => {
          setWsConnected(false);
          addLog("error", "Deploy service connection error");
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            handleWsMessage(msg);
          } catch {}
        };
      } catch {
        if (!closed) {
          reconnectRef.current = setTimeout(connect, 3000);
        }
      }
    };

    connect();

    return () => {
      closed = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [mounted, isAdmin, handleWsMessage, addLog]);

  const startDeploy = async () => {
    if (!wsConnected || deploy.type === "running") return;

    const ticket = await getDeployTicket();
    if (!ticket) {
      addLog("error", "Failed to obtain deploy authorization ticket");
      return;
    }

    setStarting(true);
    setLogs([]);
    setDeploy({ type: "running", currentStep: null, steps: [] });
    addLog("system", "Starting deployment...");

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: "start", ticket }));
    } else {
      // Fallback to REST
      fetch(`${DEPLOY_HTTP_URL}/api/trigger`, {
        method: "POST",
        headers: { "X-Deploy-Ticket": ticket },
      })
        .then((res) => res.json())
        .then((data) => {
          if (!data.ok) {
            setStarting(false);
            addLog("error", data.error || "Failed to start deploy");
          }
        })
        .catch(() => {
          setStarting(false);
          addLog("error", "Failed to reach deploy service");
        });
    }
  };

  const handleReset = async () => {
    const ticket = await getDeployTicket();
    if (!ticket) {
      addLog("error", "Failed to obtain deploy authorization ticket");
      return;
    }
    try {
      const res = await fetch(`${DEPLOY_HTTP_URL}/api/reset`, {
        method: "POST",
        headers: { "X-Deploy-Ticket": ticket },
      });
      const data = await res.json();
      if (data.ok) {
        setDeploy({ type: "idle" });
        setLogs([]);
        addLog("system", "Deploy state reset");
        fetchCommits();
      }
    } catch {
      addLog("error", "Failed to reset deploy state");
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchCommits();
    await fetchStatus();
    setTimeout(() => setRefreshing(false), 500);
  };

  const isRunning = deploy.type === "running";

  // Permission guard (after mounting to avoid SSR mismatch)
  if (mounted && !authLoading && !hasPermission("app_settings.manage")) {
    return <AccessDenied />;
  }

  if (!mounted || authLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t("deploy.title")}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t("deploy.description")}</p>
        </div>
        <div className="flex items-center gap-3">
          <PageGuideModal pageKey="deploy" />
          <div
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium",
              wsConnected
                ? "bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-400"
            )}
          >
            <span className={cn("w-2 h-2 rounded-full", wsConnected ? "bg-emerald-500 animate-pulse" : "bg-red-500")} />
            {wsConnected ? t("deploy.connected") : t("deploy.disconnected")}
          </div>
        </div>
      </div>

      {/* Status Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Service Status */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-xl bg-blue-100 dark:bg-blue-500/10">
              <Activity className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t("deploy.service_status")}</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("deploy.deploy_service_card")}</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
                wsConnected
                  ? "bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-400"
              )}
            >
              {wsConnected ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {t("deploy.operational")}
                </>
              ) : (
                <>
                  <XCircle className="w-3.5 h-3.5" />
                  {t("deploy.unreachable")}
                </>
              )}
            </span>
          </div>
        </div>

        {/* Pending Commits */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-5">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 rounded-xl bg-violet-100 dark:bg-violet-500/10">
              <GitCommitHorizontal className="w-5 h-5 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t("deploy.pending_commits")}</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("deploy.pending_commits_hint")}</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            {pendingCount !== null ? (
              <span
                className={cn(
                  "text-2xl font-bold",
                  pendingCount > 0 ? "text-red-500" : "text-emerald-500"
                )}
              >
                {pendingCount}
              </span>
            ) : (
              <span className="text-2xl font-bold text-gray-300 dark:text-slate-700">—</span>
            )}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
              title={t("deploy.refresh")}
            >
              <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
            </button>
          </div>
        </div>

        {/* Current State */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-5">
          <div className="flex items-center gap-3 mb-3">
            <div
              className={cn(
                "p-2.5 rounded-xl",
                isRunning
                  ? "bg-blue-100 dark:bg-blue-500/10"
                  : deploy.type === "completed"
                  ? "bg-emerald-100 dark:bg-emerald-500/10"
                  : deploy.type === "failed" || deploy.type === "error"
                  ? "bg-red-100 dark:bg-red-500/10"
                  : "bg-gray-100 dark:bg-slate-800"
              )}
            >
              <Rocket
                className={cn(
                  "w-5 h-5",
                  isRunning
                    ? "text-blue-600 dark:text-blue-400"
                    : deploy.type === "completed"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : deploy.type === "failed" || deploy.type === "error"
                    ? "text-red-600 dark:text-red-400"
                    : "text-gray-500 dark:text-gray-400"
                )}
              />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t("deploy.current_state")}</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("deploy.current_state_hint")}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium",
                isRunning
                  ? "bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400"
                  : deploy.type === "completed"
                  ? "bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : deploy.type === "failed" || deploy.type === "error"
                  ? "bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-400"
                  : "bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-400"
              )}
            >
              {isRunning && <Loader2 className="w-3 h-3 animate-spin" />}
              {deploy.type === "completed" && <CheckCircle2 className="w-3 h-3" />}
              {(deploy.type === "failed" || deploy.type === "error") && <XCircle className="w-3 h-3" />}
              {deploy.type === "idle" && "—"}
              {isRunning && t("deploy.status_deploying")}
              {deploy.type === "completed" && t("deploy.status_success")}
              {deploy.type === "failed" && t("deploy.status_failed")}
              {deploy.type === "error" && t("deploy.status_error")}
              {deploy.type === "idle" && t("deploy.status_idle")}
            </span>
          </div>
        </div>
      </div>

      {/* Main Action Area */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pending Commits Panel */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GitCommitHorizontal className="w-4 h-4 text-violet-500" />
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t("deploy.github_changes")}</h2>
            </div>
            {pendingCount !== null && pendingCount > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-xs font-bold">
                {pendingCount}
              </span>
            )}
          </div>

          <div className="divide-y divide-gray-100 dark:divide-slate-800 max-h-64 overflow-y-auto">
            {pendingCount === null ? (
              <div className="p-6 text-center">
                <Loader2 className="w-6 h-6 animate-spin text-gray-300 dark:text-slate-700 mx-auto mb-2" />
                <p className="text-sm text-gray-400 dark:text-gray-500">{t("deploy.loading_commits")}</p>
              </div>
            ) : pendingCommits.length === 0 ? (
              <div className="p-6 text-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                <p className="text-sm text-gray-500 dark:text-gray-400">{t("deploy.up_to_date")}</p>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">{t("deploy.up_to_date_hint")}</p>
              </div>
            ) : (
              pendingCommits.map((c, i) => (
                <div key={i} className="flex items-start gap-3 px-6 py-3">
                  <span className="mt-0.5 px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-slate-800 font-mono text-[11px] text-gray-600 dark:text-gray-400 shrink-0">
                    {c.hash}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-700 dark:text-gray-300 break-words">{c.subject}</p>
                    {c.date && <p className="text-[11px] text-gray-400 dark:text-gray-500">{c.date}</p>}
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="px-6 py-4 border-t border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-900/50">
            <button
              onClick={startDeploy}
              disabled={!wsConnected || isRunning || starting}
              className={cn(
                "w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold",
                "transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                !wsConnected || isRunning || starting
                  ? "bg-gray-100 dark:bg-slate-800 text-gray-400 dark:text-gray-500 cursor-not-allowed"
                  : "bg-primary-500 hover:bg-primary-600 text-white shadow-sm hover:shadow-md active:scale-[0.98] focus-visible:ring-primary-500 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950"
              )}
            >
              {starting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t("deploy.starting")}
                </>
              ) : isRunning ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t("deploy.deploying")}
                </>
              ) : (
                <>
                  <Rocket className="w-4 h-4" />
                  {t("deploy.start_button")}
                </>
              )}
            </button>
          </div>
        </div>

        {/* Deploy Summary Panel */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Rocket className="w-4 h-4 text-primary-500" />
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t("deploy.deploy_summary")}</h2>
            </div>
            {(deploy.type === "failed" || deploy.type === "error") && (
              <button
                onClick={handleReset}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-500/10 hover:bg-amber-200 dark:hover:bg-amber-500/20 transition-colors"
              >
                {t("deploy.reset")}
              </button>
            )}
          </div>

          {!isRunning && deploy.type === "idle" ? (
            <div className="p-8 text-center">
              <Shield className="w-12 h-12 text-gray-300 dark:text-slate-700 mx-auto mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400">{t("deploy.no_deploy_yet")}</p>
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">{t("deploy.no_deploy_yet_hint")}</p>
            </div>
          ) : (
            <div className="p-6 space-y-4">
              {/* Result Banner */}
              {deploy.type === "completed" && (
                <div className="flex items-start gap-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 p-4">
                  <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">{t("deploy.deploy_complete_msg")}</p>
                    <p className="text-[11px] text-emerald-600/80 dark:text-emerald-400/70 mt-0.5">{deploy.message}</p>
                    {deploy.duration > 0 && (
                      <p className="text-[11px] text-emerald-600/80 dark:text-emerald-400/70 mt-1 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {t("deploy.duration")}: {deploy.duration}s
                      </p>
                    )}
                  </div>
                </div>
              )}

              {deploy.type === "failed" && (
                <div className="flex items-start gap-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-4">
                  <XCircle className="w-6 h-6 text-red-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-red-700 dark:text-red-400">{t("deploy.deploy_failed_msg")}</p>
                    <p className="text-[11px] text-red-600/80 dark:text-red-400/70 mt-0.5">{deploy.message}</p>
                  </div>
                </div>
              )}

              {/* Progress Steps */}
              {isRunning && <DeployProgress steps={deploy.steps} preparing />}

              {deploy.type === "error" && (
                <div className="flex items-start gap-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 p-4">
                  <AlertTriangle className="w-6 h-6 text-red-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-700 dark:text-red-400">{deploy.message}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Live Log Terminal */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-gray-500" />
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t("deploy.live_log")}</h2>
          </div>
          {logs.length > 0 && (
            <span className="text-[11px] text-gray-400 dark:text-gray-500">{logs.length} {t("deploy.lines")}</span>
          )}
        </div>

        <DeployLogViewer logs={logs} isRunning={isRunning} />

      </div>
    </div>
  );
}
