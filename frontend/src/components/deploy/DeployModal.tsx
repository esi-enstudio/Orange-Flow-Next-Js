"use client";

import { useEffect, useRef, useState } from "react";
import { X, Loader2, CheckCircle2, XCircle, Terminal, GitCommitHorizontal, Rocket } from "lucide-react";
import { API_BASE } from "@/lib/api";
import Cookies from "js-cookie";

type DeployState = "idle" | "confirm" | "connecting" | "running" | "completed" | "failed" | "error" | "stuck";

interface LogEntry {
  type: "log" | "system" | "error";
  text: string;
  time: Date;
}

interface PendingCommit {
  hash?: string;
  subject?: string;
}

interface DeployModalProps {
  open: boolean;
  onClose: () => void;
}

export default function DeployModal({ open, onClose }: DeployModalProps) {
  const [state, setState] = useState<DeployState>("idle");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [commits, setCommits] = useState<PendingCommit[]>([]);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [hasPending, setHasPending] = useState<boolean | null>(null);
  const [remoteHead, setRemoteHead] = useState("");
  const [isResetting, setIsResetting] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const addLog = (type: LogEntry["type"], text: string) => {
    setLogs((prev) => [...prev, { type, text, time: new Date() }]);
  };

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // When modal opens -> fetch pending commits, show confirmation (NOT auto-start)
  useEffect(() => {
    if (!open) {
      setState("idle");
      setLogs([]);
      setExitCode(null);
      setCommits([]);
      setHasPending(null);
      setRemoteHead("");
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      return;
    }

    let cancelled = false;
    (async () => {
      setState("connecting");
      addLog("system", "Fetching latest commit status...");
      try {
        const res = await fetch(`${API_BASE}/v1/deploy/pending-commits`, {
          headers: { Authorization: `Bearer ${Cookies.get("token")}` },
        });
        const data = await res.json();
        if (cancelled) return;
        setCommits(data.commits || []);
        setPendingCount(data.count ?? 0);
        setRemoteHead(data.remote_head || "");
        setHasPending((data.count ?? 0) > 0);
        setState("confirm");
        addLog("system", data.count > 0 ? `Found ${data.count} pending commit(s).` : "No pending commits. Server is up to date.");
      } catch {
        if (cancelled) return;
        setState("error");
        addLog("error", "Failed to fetch commit status.");
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const startDeploy = () => {
    setState("connecting");
    setLogs([]);
    addLog("system", "Queuing deployment...");

    const token = Cookies.get("token");
    if (!token) {
      setState("error");
      addLog("error", "Authentication token not found. Please login again.");
      return;
    }

    fetch(`${API_BASE}/v1/deploy/trigger`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.detail || `Trigger failed (${res.status})`);
        }
        // success → open SSE stream
        connectStream(token);
      })
      .catch((err) => {
        const msg = err.message || "Failed to trigger deploy";
        setState(msg.toLowerCase().includes("already in progress") ? "stuck" : "error");
        addLog("error", msg);
      });
  };

  const connectStream = (token: string) => {
    setState("running");
    addLog("system", "Deploy queued. Stream connected. Waiting for output...");
    addLog("system", "─".repeat(60));

    const baseUrl = API_BASE.replace(/\/api\/?$/, "");
    const es = new EventSource(`${baseUrl}/api/v1/deploy/stream?token=${token}`);
    es.onerror = null;
    eventSourceRef.current = es;

    es.addEventListener("started", (e) => {
      setState("running");
    });

    es.addEventListener("log", (e) => {
      const data = JSON.parse(e.data);
      setState("running");
      addLog("log", data.line);
    });

    es.addEventListener("completed", (e) => {
      const data = JSON.parse(e.data);
      setExitCode(data.exit_code);
      setState("completed");
      addLog("system", "─".repeat(60));
      addLog("system", "Deploy completed successfully (exit code: " + data.exit_code + ")");
      es.close();
    });

    es.addEventListener("failed", (e) => {
      const data = JSON.parse(e.data);
      setExitCode(data.exit_code);
      setState("failed");
      addLog("system", "─".repeat(60));
      addLog("error", "Deploy failed (exit code: " + data.exit_code + ")");
      es.close();
    });

    es.addEventListener("error", (e) => {
      if (e instanceof MessageEvent) {
        const data = JSON.parse(e.data);
        setState("error");
        addLog("error", "Error: " + (data.message || "unknown"));
        es.close();
        return;
      }

      // The stream closed (the backend restarts mid-deploy and kills the SSE
      // connection before the "completed"/"failed" event can be delivered).
      // Disable auto-reconnect and ask the server for the terminal state so we
      // can still show the real success/failure instead of a generic error.
      es.close();
      checkTerminalState(token);
    });
  };

  const checkTerminalState = async (token: string) => {
    addLog("system", "Deployment finished. Checking final status...");
    const maxTries = 6;
    for (let i = 0; i < maxTries; i++) {
      try {
        const res = await fetch(`${API_BASE}/v1/deploy/status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        const st = data.state;
        if (st === "completed") {
          setExitCode(data.exit_code ?? 0);
          setState("completed");
          addLog("system", "─".repeat(60));
          addLog("system", "Deploy completed successfully (exit code: " + (data.exit_code ?? 0) + ")");
          return;
        }
        if (st === "failed") {
          setExitCode(data.exit_code ?? 1);
          setState("failed");
          addLog("system", "─".repeat(60));
          addLog("error", "Deploy failed (exit code: " + (data.exit_code ?? 1) + ")");
          return;
        }
        if (st === "running") {
          addLog("log", "Deployment still in progress...");
        }
        // wait before retrying (backend may still be restarting)
        await new Promise((r) => setTimeout(r, 2000));
      } catch {
        // backend not up yet
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    setState("error");
    addLog("error", "Connection lost. The server may be restarting.");
  };

  if (!open) return null;

  const isBusy = state === "running" || state === "connecting";

  const handleReset = async () => {
    const token = Cookies.get("token");
    if (!token) {
      setState("error");
      addLog("error", "Authentication token not found. Please login again.");
      return;
    }
    setIsResetting(true);
    addLog("system", "Resetting deployment state...");
    try {
      const res = await fetch(`${API_BASE}/v1/deploy/reset`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || `Reset failed (${res.status})`);
      }
      addLog("system", "Deployment state reset. You can now deploy again.");
      setState("confirm");
      setExitCode(null);
    } catch (err) {
      setState("error");
      addLog("error", (err as Error).message || "Failed to reset deployment");
    } finally {
      setIsResetting(false);
    }
  };


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={isBusy ? undefined : onClose} />
      <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden border border-gray-200 dark:border-slate-700">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${
              state === "running"
                ? "bg-blue-100 dark:bg-blue-500/10"
                : state === "completed"
                ? "bg-emerald-100 dark:bg-emerald-500/10"
                : state === "failed" || state === "error"
                ? "bg-red-100 dark:bg-red-500/10"
                : "bg-gray-100 dark:bg-slate-800"
            }`}>
              <Terminal className={`w-5 h-5 ${
                state === "running"
                  ? "text-blue-600"
                  : state === "completed"
                  ? "text-emerald-600"
                  : state === "failed" || state === "error"
                  ? "text-red-600"
                  : "text-gray-500"
              }`} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Server Deployment</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {state === "idle" && "Ready"}
                {state === "confirm" && "Review pending changes"}
                {state === "connecting" && "Connecting to server..."}
                {state === "running" && "Deployment in progress..."}
                {state === "completed" && "Deployment completed"}
                {state === "failed" && "Deployment failed"}
                {state === "error" && "Connection error"}
                {state === "stuck" && "Previous deployment is stuck"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge state={state} />
            <button
              onClick={onClose}
              disabled={isBusy}
              className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors disabled:opacity-30"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Body: Confirmation OR Terminal */}
        {state === "confirm" ? (
          <div className="flex-1 overflow-y-auto p-6 min-h-[300px] max-h-[50vh]">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-violet-100 dark:bg-violet-500/10 rounded-xl">
                <GitCommitHorizontal className="w-5 h-5 text-violet-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {pendingCount !== null && pendingCount > 0
                    ? `${pendingCount} pending commit(s)` : "No pending commits"}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {remoteHead ? `Remote: ${remoteHead.slice(0, 8)}` : ""}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              {commits.length === 0 ? (
                <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
                  <p>Server is already up to date.</p>
                  <p className="text-xs mt-1">You can still deploy to rebuild/restart services.</p>
                </div>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-slate-800 rounded-xl border border-gray-100 dark:border-slate-800">
                  {commits.map((c, i) => (
                    <li key={i} className="flex items-start gap-3 px-4 py-3">
                      <span className="mt-0.5 px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-slate-800 font-mono text-[11px] text-gray-600 dark:text-gray-400 shrink-0">
                        {c.hash || "—"}
                      </span>
                      <p className="text-sm text-gray-700 dark:text-gray-300 break-words">{c.subject || "..."}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {pendingCount !== null && pendingCount > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-3 flex items-center gap-1.5">
                <Rocket className="w-3.5 h-3.5" />
                Deploying will pull these commits and restart all services.
              </p>
            )}
          </div>
        ) : (
          /* Terminal view for connecting/running/completed/failed/error */
          <div
            ref={logContainerRef}
            className="flex-1 overflow-y-auto bg-gray-950 dark:bg-black p-4 font-mono text-[12px] leading-relaxed min-h-[300px] max-h-[50vh]"
          >
            {logs.length === 0 && (state === "idle" || state === "connecting") && (
              <div className="text-gray-500 flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                Waiting for deployment output...
              </div>
            )}
            {logs.map((log, i) => (
              <div key={i} className={`whitespace-pre-wrap break-words ${
                log.type === "error"
                  ? "text-red-400"
                  : log.type === "system"
                  ? "text-blue-400"
                  : "text-gray-300"
              }`}>
                <span className="text-gray-600 select-none">{log.time.toLocaleTimeString()} </span>
                {log.text}
              </div>
            ))}
            {state === "running" && (
              <div className="text-blue-400 flex items-center gap-1 mt-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>processing...</span>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-900/50">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {state === "confirm" && (pendingCount !== null && pendingCount > 0
              ? "This will pull the commits shown above and restart frontend + backend."
              : "Rebuild and restart services with current code.")}
            {state === "completed" && "Frontend and backend services have been restarted"}
            {state === "failed" && "Check the logs above for error details"}
            {state === "stuck" && "A previous deployment is still marked as running. Reset it to deploy again."}
            {state === "running" && "Do not close this window during deployment"}
          </p>
          {state === "confirm" ? (
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={startDeploy}
                disabled={false}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium text-white bg-primary-500 hover:bg-primary-600 transition-colors"
              >
                <Rocket className="w-4 h-4" />
                Start Deployment
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {(state === "stuck" || state === "failed" || state === "error") && (
                <button
                  onClick={handleReset}
                  disabled={isResetting}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-500/10 hover:bg-amber-200 dark:hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                >
                  {isResetting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Reset
                </button>
              )}
              <button
                onClick={onClose}
                disabled={isBusy}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 ${
                  state === "completed" || state === "failed" || state === "error"
                    ? "bg-primary-500 hover:bg-primary-600 text-white"
                    : "bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-slate-600"
                }`}
              >
                {isBusy ? "Deploying..." : "Close"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ state }: { state: DeployState }) {
  const config = {
    idle: { label: "Idle", className: "bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-400" },
    confirm: { label: "Review", className: "bg-violet-100 dark:bg-violet-500/10 text-violet-700 dark:text-violet-400" },
    connecting: { label: "Connecting", className: "bg-yellow-100 dark:bg-yellow-500/10 text-yellow-700 dark:text-yellow-400" },
    running: { label: "Running", className: "bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400" },
    completed: { label: "Success", className: "bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
    failed: { label: "Failed", className: "bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-400" },
    error: { label: "Error", className: "bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-400" },
    stuck: { label: "Stuck", className: "bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  };

  const c = config[state];

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${c.className}`}>
      {(state === "running" || state === "connecting") && (
        <Loader2 className="w-3 h-3 animate-spin" />
      )}
      {state === "completed" && <CheckCircle2 className="w-3 h-3" />}
      {(state === "failed" || state === "error") && <XCircle className="w-3 h-3" />}
      {c.label}
    </span>
  );
}
