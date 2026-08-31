"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Terminal,
  RefreshCw,
  Pin,
  PinOff,
  Search,
  AlertTriangle,
} from "lucide-react";
import apiClient from "@/lib/api";
import { useLanguage } from "@/i18n/useLanguage";
import { cn } from "@/lib/utils";
import PageGuideModal from "@/components/PageGuideModal";

interface LogEntry {
  timestamp: string;
  level: string;
  logger: string;
  message: string;
}

interface SystemLogsPanelProps {
  maxHeight?: string;
}

const LEVEL_STYLES: Record<string, { dot: string; badge: string; border: string; text: string }> = {
  DEBUG: {
    dot: "bg-gray-400 dark:bg-gray-500",
    badge: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400",
    border: "border-l-gray-300 dark:border-l-gray-600",
    text: "text-gray-500 dark:text-gray-400",
  },
  INFO: {
    dot: "bg-blue-500",
    badge: "bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400",
    border: "border-l-blue-400 dark:border-l-blue-500",
    text: "text-gray-800 dark:text-gray-100",
  },
  WARNING: {
    dot: "bg-amber-500",
    badge: "bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400",
    border: "border-l-amber-400 dark:border-l-amber-500",
    text: "text-amber-700 dark:text-amber-300",
  },
  ERROR: {
    dot: "bg-red-500",
    badge: "bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400",
    border: "border-l-red-500 dark:border-l-red-500",
    text: "text-red-700 dark:text-red-300",
  },
  CRITICAL: {
    dot: "bg-red-600",
    badge: "bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300",
    border: "border-l-red-600 dark:border-l-red-500",
    text: "text-red-700 dark:text-red-300",
  },
};

const LEVEL_ORDER = ["ALL", "DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"];

function shortLogger(name: string): string {
  if (!name) return "app";
  const parts = name.split(".");
  return parts.length >= 2 ? parts.slice(0, 2).join(".") : name;
}

function timeOnly(ts: string): string {
  const m = ts.match(/\d{2}:\d{2}:\d{2}/);
  return m ? m[0] : ts;
}

export default function SystemLogsPanel({ maxHeight = "500px" }: SystemLogsPanelProps) {
  const { t } = useLanguage();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [levelFilter, setLevelFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await apiClient.get("system-logs", { params: { limit: 200 } });
      setLogs(res.data?.data || []);
      setHasError(false);
    } catch {
      setHasError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 5000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  useEffect(() => {
    if (!autoScroll || !scrollRef.current) return;
    const el = scrollRef.current;
    el.scrollTop = el.scrollHeight;
  }, [logs, autoScroll]);

  const filtered = logs.filter((log) => {
    if (levelFilter !== "ALL" && log.level.toUpperCase() !== levelFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = `${log.logger} ${log.message}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const countsByLevel: Record<string, number> = {};
  for (const log of logs) {
    const lv = log.level.toUpperCase();
    countsByLevel[lv] = (countsByLevel[lv] || 0) + 1;
  }
  const errorCount = (countsByLevel["ERROR"] || 0) + (countsByLevel["CRITICAL"] || 0);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm transition-colors duration-300 flex flex-col">
      {/* Header */}
      <div className="p-6 pb-4 border-b border-gray-50 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold flex items-center gap-2 dark:text-gray-100">
                {t("system_logs.panel_title")}
                <span className="text-xs font-bold bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400 px-2 py-0.5 rounded-full">
                  {t("otp.live")}
                </span>
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {t("system_logs.panel_subtitle")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {errorCount > 0 && (
              <span className="flex items-center gap-1 text-[11px] font-bold bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 px-2 py-1 rounded-full mr-1">
                <AlertTriangle className="w-3 h-3" />
                {errorCount}
              </span>
            )}
            <button
              onClick={() => setAutoScroll((v) => !v)}
              className={cn(
                "p-2 rounded-lg transition-colors hidden sm:flex",
                autoScroll
                  ? "text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-500/10"
                  : "text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800"
              )}
              title={autoScroll ? t("system_logs.autoscroll_on") : t("system_logs.autoscroll_off")}
              aria-pressed={autoScroll}
            >
              {autoScroll ? <Pin className="w-4 h-4" /> : <PinOff className="w-4 h-4" />}
            </button>
            <button
              onClick={fetchLogs}
              className="p-2 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
              aria-label={t("otp.refresh")}
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <PageGuideModal pageKey="system_logs" />
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 mt-4">
          <div className="flex items-center gap-1 flex-wrap">
            {LEVEL_ORDER.map((lv) => {
              const active = levelFilter === lv;
              return (
                <button
                  key={lv}
                  onClick={() => setLevelFilter(lv)}
                  className={cn(
                    "text-[11px] font-bold px-2.5 py-1 rounded-lg transition-colors capitalize",
                    active
                      ? "bg-slate-900 dark:bg-slate-700 text-white"
                      : "text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700"
                  )}
                >
                  {lv === "ALL" ? t("system_logs.all") : lv.toLowerCase()}
                  {lv !== "ALL" && countsByLevel[lv] ? (
                    <span className={cn("ml-1", active ? "text-white/70" : "text-gray-400 dark:text-gray-500")}>
                      {countsByLevel[lv]}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <div className="relative sm:ml-auto sm:w-56">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("system_logs.search_placeholder")}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg outline-none focus:ring-2 focus:ring-primary-500 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500"
            />
          </div>
        </div>
      </div>

      {/* Body */}
      <div
        ref={scrollRef}
        className="flex-1 relative overflow-y-auto bg-slate-50/70 dark:bg-slate-950/50 rounded-b-2xl"
        style={{ maxHeight }}
      >
        {loading ? (
          <div className="divide-y divide-gray-100 dark:divide-slate-800">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="px-5 py-3 animate-pulse">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-gray-200 dark:bg-slate-700" />
                  <div className="h-2.5 w-16 bg-gray-200 dark:bg-slate-700 rounded" />
                  <div className="h-2.5 w-14 bg-gray-100 dark:bg-slate-800 rounded" />
                </div>
                <div className="h-2.5 w-3/4 bg-gray-100 dark:bg-slate-800 rounded" />
              </div>
            ))}
          </div>
        ) : hasError ? (
          <div className="flex flex-col items-center justify-center py-14 text-center px-6">
            <AlertTriangle className="w-10 h-10 text-red-300 dark:text-red-600 mx-auto mb-3" />
            <p className="text-sm text-gray-500 dark:text-gray-400">{t("system_logs.load_failed")}</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center px-6">
            <Terminal className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-sm text-gray-500 dark:text-gray-400">{t("system_logs.no_data")}</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-800/60">
            {filtered.length === 0 ? (
              <div className="py-14 text-center text-sm text-gray-400 dark:text-gray-500">
                {t("system_logs.no_match")}
              </div>
            ) : (
              filtered.map((log, i) => {
                const lv = log.level.toUpperCase();
                const style = LEVEL_STYLES[lv] || LEVEL_STYLES.INFO;
                return (
                  <div
                    key={`${log.timestamp}-${i}`}
                    className={cn("px-5 py-2.5 border-l-2 hover:bg-white dark:hover:bg-slate-900/40 transition-colors", style.border)}
                  >
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", style.dot)} />
                      <span className="font-mono text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">
                        {timeOnly(log.timestamp)}
                      </span>
                      <span className={cn(
                        "text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded",
                        style.badge
                      )}>
                        {lv}
                      </span>
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono truncate">
                        {shortLogger(log.logger)}
                      </span>
                    </div>
                    <p className={cn(
                      "font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap pl-3.5",
                      style.text
                    )}>
                      {log.message}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}