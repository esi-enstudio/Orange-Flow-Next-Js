"use client";

import { useEffect, useRef } from "react";
import { Loader2, Terminal } from "lucide-react";
import { useLanguage } from "@/i18n/useLanguage";
import { cn } from "@/lib/utils";

export interface LogEntry {
  time: string;
  text: string;
  type: "log" | "error" | "system";
}

interface DeployLogViewerProps {
  logs: LogEntry[];
  isRunning?: boolean;
  heightClass?: string;
}

export default function DeployLogViewer({ logs, isRunning = false, heightClass = "h-72" }: DeployLogViewerProps) {
  const { t } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div ref={ref} className={cn("bg-gray-950 dark:bg-black p-4 font-mono text-[12px] leading-relaxed overflow-y-auto", heightClass)}>
      {logs.length === 0 ? (
        <div className="flex items-center gap-2 text-gray-500">
          <Terminal className="w-4 h-4" />
          <span>{t("deploy.waiting_logs")}</span>
        </div>
      ) : (
        logs.map((log, i) => (
          <div
            key={i}
            className={cn(
              "whitespace-pre-wrap break-words",
              log.type === "error" ? "text-red-400" : log.type === "system" ? "text-blue-400" : "text-gray-300"
            )}
          >
            <span className="text-gray-600 select-none">{log.time} </span>
            {log.text}
          </div>
        ))
      )}
      {isRunning && (
        <div className="text-blue-400 flex items-center gap-1 mt-1">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>{t("deploy.processing")}</span>
        </div>
      )}
    </div>
  );
}
