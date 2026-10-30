"use client";

import { useEffect, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Inbox, Loader2, X } from "lucide-react";

import { useLanguage } from "@/i18n/useLanguage";

/* -------------------------------------------------------------------------- */
/* formatting                                                                  */
/* -------------------------------------------------------------------------- */

export function money(value?: number | null): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function todayISO(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

export function apiError(
  err: unknown,
  fallback: string
): { message: string; fields?: Record<string, string> } {
  const response = (err as { response?: { data?: any } })?.response?.data;
  const detail = response?.detail;
  let message = fallback;

  if (typeof detail === "string") {
    message = detail;
  } else if (Array.isArray(detail)) {
    message = detail
      .map((item) => (typeof item === "string" ? item : item?.msg || fallback))
      .join("; ");
  } else if (detail && typeof detail === "object") {
    message = detail.message || fallback;
  } else if (response?.error?.message) {
    message = response.error.message;
  }

  const fields =
    (detail && typeof detail === "object" && !Array.isArray(detail) ? detail.fields : undefined) ||
    response?.error?.fields;

  return { message, fields: fields as Record<string, string> | undefined };
}

export function formatDate(value?: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* -------------------------------------------------------------------------- */
/* class helpers                                                               */
/* -------------------------------------------------------------------------- */

export const inputClass =
  "w-full rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary-500";

export const selectClass = `${inputClass} cursor-pointer`;

export const searchInputClass =
  "w-full rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 pl-9 pr-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 cursor-text outline-none focus:ring-2 focus:ring-primary-500";

export const cardClass =
  "rounded-2xl border border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900";

export const btnPrimary =
  "inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer";

export const btnSecondary =
  "inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer";

export const btnIcon =
  "p-2.5 rounded-xl border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer";

export const labelClass =
  "block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5";

/* -------------------------------------------------------------------------- */
/* primitives                                                                  */
/* -------------------------------------------------------------------------- */

const STATUS_TONES: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30",
  submitted: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/30",
  approved: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/30",
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30",
  rejected: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30",
  reopened: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:border-orange-500/30",
  verified: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30",
  unverified: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30",
  in: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30",
  out: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30",
  neutral: "bg-gray-50 text-gray-700 border-gray-200 dark:bg-slate-800 dark:text-gray-300 dark:border-slate-700",
};

export function StatusPill({
  status,
  label,
}: {
  status: string;
  label?: string;
}) {
  const { t } = useLanguage();
  const translated = t(`finance.common.statuses.${status}`);
  const text = label ?? (translated === `finance.common.statuses.${status}` ? status : translated);
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-semibold capitalize whitespace-nowrap ${
        STATUS_TONES[status] || STATUS_TONES.neutral
      }`}
    >
      {text}
    </span>
  );
}

const TONE_CLASSES: Record<string, { card: string; value: string }> = {
  slate: { card: "border-gray-100 dark:border-slate-800", value: "text-gray-900 dark:text-gray-100" },
  amber: { card: "border-amber-100 dark:border-amber-500/20 bg-amber-50/40 dark:bg-amber-500/5", value: "text-amber-700 dark:text-amber-300" },
  blue: { card: "border-blue-100 dark:border-blue-500/20 bg-blue-50/40 dark:bg-blue-500/5", value: "text-blue-700 dark:text-blue-300" },
  emerald: { card: "border-emerald-100 dark:border-emerald-500/20 bg-emerald-50/40 dark:bg-emerald-500/5", value: "text-emerald-700 dark:text-emerald-300" },
  rose: { card: "border-rose-100 dark:border-rose-500/20 bg-rose-50/40 dark:bg-rose-500/5", value: "text-rose-700 dark:text-rose-300" },
  violet: { card: "border-violet-100 dark:border-violet-500/20 bg-violet-50/40 dark:bg-violet-500/5", value: "text-violet-700 dark:text-violet-300" },
};

export function SummaryCard({
  label,
  value,
  hint,
  tone = "slate",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: keyof typeof TONE_CLASSES;
}) {
  const palette = TONE_CLASSES[tone] || TONE_CLASSES.slate;
  return (
    <div className={`rounded-2xl border bg-white dark:bg-slate-900 px-4 py-3 ${palette.card}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p className={`text-lg font-bold mt-0.5 break-words ${palette.value}`}>{value}</p>
      {hint ? <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{hint}</p> : null}
    </div>
  );
}

export function FieldError({ error }: { error?: string }) {
  if (!error) return null;
  return <p className="text-xs text-red-600 dark:text-red-400 mt-1">{error}</p>;
}

export function Field({
  label,
  required,
  error,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className={labelClass}>
        {label}
        {required ? <span className="text-red-500"> *</span> : null}
      </label>
      {children}
      {hint ? <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">{hint}</p> : null}
      <FieldError error={error} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* overlay                                                                     */
/* -------------------------------------------------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  maxWidth = "sm:max-w-lg",
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: string;
  busy?: boolean;
}) {
  const { t } = useLanguage();

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="fixed inset-0 bg-black/40" onClick={() => !busy && onClose()} />
      <div
        className={`relative w-full ${maxWidth} max-h-[92vh] overflow-y-auto bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl shadow-2xl border border-gray-100 dark:border-slate-800 p-4 sm:p-6`}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{title}</h2>
            {subtitle ? (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => !busy && onClose()}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 cursor-pointer shrink-0"
            aria-label={t("finance.common.close")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
        {footer ? <div className="flex flex-wrap justify-end gap-2 mt-5">{footer}</div> : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* table states                                                                */
/* -------------------------------------------------------------------------- */

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y divide-gray-50 dark:divide-slate-800">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-4 px-4 py-4 animate-pulse">
          <div className="space-y-2 flex-1">
            <div className="h-3 w-32 bg-gray-200 dark:bg-slate-700 rounded-md" />
            <div className="h-2.5 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
          </div>
          <div className="hidden sm:block flex-1 space-y-2">
            <div className="h-3 w-24 bg-gray-200 dark:bg-slate-700 rounded-md" />
            <div className="h-2.5 w-16 bg-gray-100 dark:bg-slate-800 rounded-md" />
          </div>
          <div className="h-5 w-16 bg-gray-100 dark:bg-slate-800 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="p-10 text-center">
      <Inbox className="w-10 h-10 mx-auto text-gray-300 dark:text-slate-600" />
      <p className="mt-2 text-sm font-semibold text-gray-700 dark:text-gray-200">{title}</p>
      {description ? (
        <p className="text-xs text-gray-500 dark:text-gray-400">{description}</p>
      ) : null}
    </div>
  );
}

export interface PaginationMeta {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

export function Pagination({
  meta,
  onPage,
}: {
  meta: PaginationMeta | null;
  onPage: (page: number) => void;
}) {
  const { t } = useLanguage();
  if (!meta || meta.total_pages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
      <span>
        {t("finance.common.page_info", {
          page: meta.page,
          total: meta.total_pages,
          count: meta.total,
        })}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onPage(meta.page - 1)}
          disabled={!meta.has_prev}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          {t("finance.common.previous")}
        </button>
        <button
          type="button"
          onClick={() => onPage(meta.page + 1)}
          disabled={!meta.has_next}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          {t("finance.common.next")}
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

export function BusyLabel({ busy, label }: { busy: boolean; label: string }) {
  if (!busy) return <>{label}</>;
  return (
    <>
      <Loader2 className="w-4 h-4 animate-spin" />
      {label}
    </>
  );
}
