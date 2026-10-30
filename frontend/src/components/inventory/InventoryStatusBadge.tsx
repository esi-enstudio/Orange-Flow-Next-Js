"use client";

import { useLanguage } from "@/i18n/useLanguage";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  available: "bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300 border-green-200 dark:border-green-700",
  received: "bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-700",
  assigned: "bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-700",
  sold: "bg-gray-100 dark:bg-gray-500/20 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700",
  returned: "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-700",
  damaged: "bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-700",
  quarantine: "bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-700",
  adjusted: "bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-700",
  draft: "bg-gray-100 dark:bg-gray-500/20 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700",
  posted: "bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300 border-green-200 dark:border-green-700",
  submitted: "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-700",
  verified: "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700",
  approved: "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700",
  rejected: "bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-700",
  cancelled: "bg-gray-100 dark:bg-gray-500/20 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700",
};

export function InventoryStatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const { t } = useLanguage();
  const key = `inventory.status.${status}`;
  const label = t(key);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border whitespace-nowrap",
        STATUS_STYLES[status] || "bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-slate-700",
        className
      )}
    >
      {label === key ? status : label}
    </span>
  );
}
