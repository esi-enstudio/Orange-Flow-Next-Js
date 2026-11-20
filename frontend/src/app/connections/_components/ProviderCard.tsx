"use client";

import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Clock3, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/useLanguage";
import type { HouseConnectionState } from "@/hooks/useHouseConnections";
import type { ConnectionProviderPresentation } from "@/lib/connectionProviders";

interface ProviderCardProps {
  presentation: ConnectionProviderPresentation;
  state?: HouseConnectionState;
  loading?: boolean;
  action?: ReactNode;
  children?: ReactNode;
}

const STATUS_STYLES: Record<string, string> = {
  connected:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
  disconnected:
    "border-gray-200 bg-gray-50 text-gray-600 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-300",
  ready:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
  not_configured:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
  error:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300",
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function ProviderCard({
  presentation,
  state,
  loading = false,
  action,
  children,
}: ProviderCardProps) {
  const { t } = useLanguage();
  const Logo = presentation.icon;

  if (loading) {
    return (
      <div className="flex flex-col rounded-2xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-start gap-3">
          <div className="size-11 animate-pulse rounded-xl bg-gray-100 dark:bg-slate-800" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-24 animate-pulse rounded bg-gray-100 dark:bg-slate-800" />
            <div className="h-3 w-full animate-pulse rounded bg-gray-100 dark:bg-slate-800" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-gray-100 dark:bg-slate-800" />
          </div>
        </div>
        <div className="mt-4 h-11 w-full animate-pulse rounded-xl bg-gray-100 dark:bg-slate-800" />
      </div>
    );
  }

  const status = state?.status ?? "not_configured";
  const statusKey = `connectionsPage.status.${status}`;
  const statusLabel = t(statusKey) === statusKey ? t("connectionsPage.status.error") : t(statusKey);

  return (
    <article className="flex h-full flex-col rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-xl",
            presentation.tileClass
          )}
        >
          <Logo aria-hidden="true" className="size-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {t(presentation.nameKey)}
            </h2>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                STATUS_STYLES[status] ?? STATUS_STYLES.error
              )}
            >
              {status === "connected" ? (
                <CheckCircle2 aria-hidden="true" className="size-3" />
              ) : status === "error" ? (
                <AlertCircle aria-hidden="true" className="size-3" />
              ) : (
                <RefreshCw aria-hidden="true" className="size-3" />
              )}
              {statusLabel}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {t(presentation.descriptionKey)}
          </p>
        </div>
      </div>

      <dl className="mt-3 space-y-2 text-sm">
        {state?.account && (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-gray-500 dark:text-gray-400">
              {t("connectionsPage.account")}
            </dt>
            <dd className="truncate font-medium text-gray-800 dark:text-gray-200">
              {state.account}
            </dd>
          </div>
        )}
        {state?.detail && (
          <p className="truncate text-xs text-gray-500 dark:text-gray-400">
            {state.detail}
          </p>
        )}
        <div className="flex items-center justify-between gap-3">
          <dt className="inline-flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
            <Clock3 aria-hidden="true" className="size-3.5" />
            {t("connectionsPage.last_connected")}
          </dt>
          <dd className="text-gray-700 dark:text-gray-300">
            {formatDate(state?.last_connected_at ?? null)}
          </dd>
        </div>
      </dl>

      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-slate-800 dark:text-gray-300">
          {t(presentation.usedForKey)}
        </span>
      </div>

      {children && <div className="mt-3">{children}</div>}
      {action && <div className="mt-auto pt-3">{action}</div>}
    </article>
  );
}
