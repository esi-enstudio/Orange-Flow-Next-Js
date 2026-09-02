"use client";

import { useEffect, useRef, useState } from "react";
import { X, Loader2, CheckCircle2, XCircle, Terminal } from "lucide-react";
import { API_BASE } from "@/lib/api";
import Cookies from "js-cookie";

type DeployState = "idle" | "connecting" | "running" | "completed" | "failed" | "error";

interface LogEntry {
  type: "log" | "system" | "error";
  text: string;
  time: Date;
}

interface DeployModalProps {
  open: boolean;
  onClose: () => void;
}

export default function DeployModal({ open, onClose }: DeployModalProps) {
  const [state, setState] = useState<DeployState>("idle");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [exitCode, setExitCode] = useState<number | null>(null);
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

  useEffect(() => {
    if (!open) {
      setState("idle");
      setLogs([]);
      setExitCode(null);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      return;
    }

    startDeploy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const startDeploy = async () => {
    setState("connecting");
    setLogs([]);
    setExitCode(null);
    addLog("system", "Connecting to deployment server...");

    const token = Cookies.get("token");
    if (!token) {
      setState("error");
      addLog("error", "Authentication token not found. Please login again.");
      return;
    }

    try {
      const baseUrl = API_BASE.replace(/\/api\/?$/, "");
      const es = new EventSource(
        `${baseUrl}/api/v1/deploy/stream?token=${token}`
      );
      eventSourceRef.current = es;

      es.addEventListener("started", (e) => {
        const data = JSON.parse(e.data);
        setState("running");
        addLog("system", `Deploy process started (PID: ${data.pid})`);
        addLog("system", "─".repeat(60));
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
        addLog("system", `Deploy completed successfully (exit code: ${data.exit_code})`);
        es.close();
      });

      es.addEventListener("failed", (e) => {
        const data = JSON.parse(e.data);
        setExitCode(data.exit_code);
        setState("failed");
        addLog("system", "─".repeat(60));
        addLog("error", `Deploy failed (exit code: ${data.exit_code})`);
        es.close();
      });

      es.addEventListener("error", (e) => {
        if (e instanceof MessageEvent) {
          const data = JSON.parse(e.data);
          setState("error");
          addLog("error", `Error: ${data.message}`);
        } else {
          setState("error");
          addLog("error", "Connection lost. The server may be restarting.");
        }
        es.close();
      });

      es.onerror = () => {
        if (state === "running" || state === "connecting") {
          addLog("error", "Connection interrupted. Waiting for reconnect...");
        }
      };
    } catch (err) {
      setState("error");
      addLog("error", `Failed to start deploy: ${err}`);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={state === "running" ? undefined : onClose} />
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
                {state === "idle" && "Ready to deploy"}
                {state === "connecting" && "Connecting to server..."}
                {state === "running" && "Deployment in progress..."}
                {state === "completed" && "Deployment completed"}
                {state === "failed" && "Deployment failed"}
                {state === "error" && "Connection error"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge state={state} />
            <button
              onClick={onClose}
              disabled={state === "running" || state === "connecting"}
              className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors disabled:opacity-30"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Log Terminal */}
        <div
          ref={logContainerRef}
          className="flex-1 overflow-y-auto bg-gray-950 dark:bg-black p-4 font-mono text-[12px] leading-relaxed min-h-[300px] max-h-[50vh]"
        >
          {logs.length === 0 && (state === "idle" || state === "connecting") && (
            <div className="text-gray-500 flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" />
              Waiting for deployment to start...
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

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-900/50">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {state === "completed" && "Frontend and backend services have been restarted"}
            {state === "failed" && "Check the logs above for error details"}
            {state === "running" && "Do not close this window during deployment"}
          </p>
          <button
            onClick={onClose}
            disabled={state === "running" || state === "connecting"}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 ${
              state === "completed" || state === "failed" || state === "error"
                ? "bg-primary-500 hover:bg-primary-600 text-white"
                : "bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-slate-600"
            }`}
          >
            {state === "running" || state === "connecting" ? "Deploying..." : "Close"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ state }: { state: DeployState }) {
  const config = {
    idle: { label: "Idle", className: "bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-400" },
    connecting: { label: "Connecting", className: "bg-yellow-100 dark:bg-yellow-500/10 text-yellow-700 dark:text-yellow-400" },
    running: { label: "Running", className: "bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400" },
    completed: { label: "Success", className: "bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
    failed: { label: "Failed", className: "bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-400" },
    error: { label: "Error", className: "bg-red-100 dark:bg-red-500/10 text-red-700 dark:text-red-400" },
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
