"use client";

import { useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";

import { useLanguage } from "@/i18n/useLanguage";
import type { ConfigState, QueryResult, QueryResultRow } from "./types";

interface PreviewPanelProps {
  result: QueryResult | null;
  loading: boolean;
  error: string | null;
  sort: ConfigState;
  onSort: (field: string) => void;
  page: number;
  onPage: (page: number) => void;
  onRetry: () => void;
}

const COLUMNS = [
  "label",
  "sublabel",
  "achievement",
  "target",
  "adjusted_target",
  "percent_applied",
  "proration_factor",
  "percentage",
  "remaining",
  "status",
] as const;
const SORTABLE_COLUMNS = new Set(["label", "achievement", "target", "adjusted_target", "percentage", "remaining", "status"]);

function StatusBadge({ status }: { status: string }) {
  const { t } = useLanguage();
  const style = status === "achieved"
    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
    : status === "on_track"
      ? "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
      : status === "needs_attention"
        ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
        : status === "behind"
          ? "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"
          : "bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-gray-300";
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${style}`}>
      {t(`report_builder.statuses.${status}`)}
    </span>
  );
}

function formatValue(value: number | null | undefined, language: string) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(language === "bn" ? "bn-BD" : "en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}

function valueFor(row: QueryResultRow, field: string, language: string) {
  if (field === "status") return <StatusBadge status={row.status} />;
  if (field === "percentage" || field === "percent_applied") {
    const value = row[field];
    return value == null ? "—" : `${formatValue(value, language)}%`;
  }
  if (field === "label" || field === "sublabel") return row[field] || "—";
  return formatValue(row[field as keyof QueryResultRow] as number | null, language);
}

function Skeleton() {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-24 animate-pulse rounded-2xl bg-gray-100 dark:bg-slate-800" />
        ))}
      </div>
      <div className="hidden overflow-hidden rounded-2xl border border-gray-100 dark:border-slate-800 lg:block">
        <div className="grid grid-cols-10 gap-2 bg-gray-50 p-3 dark:bg-slate-800">
          {COLUMNS.map((column) => <div key={column} className="h-3 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />)}
        </div>
        {Array.from({ length: 5 }).map((_, row) => (
          <div key={row} className="grid grid-cols-10 gap-2 border-t border-gray-100 p-3 dark:border-slate-800">
            {COLUMNS.map((column) => <div key={column} className="h-4 animate-pulse rounded bg-gray-100 dark:bg-slate-800" />)}
          </div>
        ))}
      </div>
      <div className="space-y-2 lg:hidden">
        {Array.from({ length: 5 }).map((_, row) => (
          <div key={row} className="h-16 animate-pulse rounded-xl bg-gray-100 dark:bg-slate-800" />
        ))}
      </div>
    </>
  );
}

export default function PreviewPanel({
  result,
  loading,
  error,
  sort,
  onSort,
  page,
  onPage,
  onRetry,
}: PreviewPanelProps) {
  const { language, t } = useLanguage();
  const [expandedId, setExpandedId] = useState<string | number | null>(null);
  const totalPages = result?.pagination.total_pages ?? 1;
  const windowStart = Math.max(1, Math.min(page - 2, totalPages - 4));
  const pageNumbers = Array.from(
    { length: Math.min(5, totalPages) },
    (_, index) => windowStart + index,
  );
  const sortBy = sort.sortField;

  if (loading && !result) {
    return <div className="space-y-4"><Skeleton /></div>;
  }

  return (
    <div className="space-y-4">
      {result && (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {([
            ["achievement", result.summary.achievement],
            ["target", result.summary.target],
            ["percentage", result.summary.percentage],
            ["remaining", result.summary.remaining],
          ] as const).map(([key, value]) => (
            <section key={key} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                {t(`report_builder.summaries.${key}`)}
              </p>
              <p className="mt-2 text-xl font-bold text-gray-900 dark:text-gray-100">
                {value == null ? "—" : `${formatValue(value, language)}${key === "percentage" ? "%" : ""}`}
              </p>
              {key === "achievement" && <div className="mt-2"><StatusBadge status={result.summary.status} /></div>}
            </section>
          ))}
        </div>
      )}

      {result && (result.summary.percent_applied != null || result.summary.proration_factor != null) && (
        <p className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs font-medium text-blue-800 dark:border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-200">
          {t("report_builder.target_adjustment", {
            target: formatValue(result.summary.target, language),
            adjusted: formatValue(result.summary.adjusted_target, language),
            percent: result.summary.percent_applied == null
              ? "—"
              : formatValue(result.summary.percent_applied, language),
            factor: result.summary.proration_factor == null
              ? "—"
              : formatValue(result.summary.proration_factor, language),
          })}
        </p>
      )}

      {result?.warnings.map((warning, index) => {
        const key = `report_builder.warnings.${warning.code}`;
        const translated = t(key);
        return (
          <p key={`${warning.code}-${index}`} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            {translated === key ? warning.message : translated}
          </p>
        );
      })}

      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          <span>{error}</span>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex h-11 items-center rounded-lg border border-red-200 px-3 font-semibold cursor-pointer dark:border-red-500/40"
          >
            {t("report_builder.retry")}
          </button>
        </div>
      )}

      {loading && result && <div className="h-1 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-800"><div className="h-full w-1/3 animate-pulse bg-primary-500" /></div>}

      {result && result.data.length > 0 ? (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-gray-100 bg-white dark:border-slate-800 dark:bg-slate-900 lg:block">
            <table className="w-full min-w-[1000px] border-collapse text-left text-sm">
              <thead className="bg-gray-50 text-xs font-bold uppercase text-gray-500 dark:bg-slate-800 dark:text-gray-400">
                <tr>
                  {COLUMNS.map((field) => (
                    <th key={field} className="px-2 py-3">
                      {SORTABLE_COLUMNS.has(field) ? (
                        <button
                          type="button"
                          onClick={() => onSort(field)}
                          className="inline-flex min-h-11 items-center gap-1 text-left cursor-pointer"
                        >
                          {t(`report_builder.columns.${field}`)}
                          {sortBy === field && (sort.sortOrder === "asc"
                            ? <ChevronUp className="h-3.5 w-3.5" />
                            : <ChevronDown className="h-3.5 w-3.5" />)}
                        </button>
                      ) : t(`report_builder.columns.${field}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {result.data.map((row) => (
                  <tr key={`${row.key ?? "none"}-${row.label}`}>
                    {COLUMNS.map((field) => (
                      <td key={field} className="px-2 py-1 text-gray-700 dark:text-gray-200">
                        {valueFor(row, field, language)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-2 lg:hidden">
            {result.data.map((row) => {
              const isExpanded = expandedId === row.key;
              return (
                <section key={`${row.key ?? "none"}-${row.label}`} className="overflow-hidden rounded-xl border border-gray-100 bg-white dark:border-slate-800 dark:bg-slate-900">
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => setExpandedId(isExpanded ? null : row.key)}
                    className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left cursor-pointer"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{row.label}</span>
                      <span className="block truncate text-[11px] text-gray-500 dark:text-gray-400">{row.sublabel || String(row.key ?? "")}</span>
                    </span>
                    <span className="text-sm font-bold text-gray-800 dark:text-gray-200">{formatValue(row.achievement, language)}</span>
                    {isExpanded ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
                  </button>
                  {isExpanded && (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-gray-100 px-4 py-3 dark:border-slate-800">
                      {COLUMNS.slice(2).map((field) => (
                        <div key={field} className="min-w-0">
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">{t(`report_builder.columns.${field}`)}</p>
                          <p className="mt-0.5 truncate text-sm font-medium text-gray-800 dark:text-gray-200">{valueFor(row, field, language)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-100 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {t("report_builder.pagination.page_of", { page, total: totalPages })}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => onPage(page - 1)}
                aria-label={t("report_builder.pagination.previous")}
                className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 enabled:cursor-pointer dark:text-gray-300 dark:hover:bg-slate-800"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {pageNumbers.map((number) => (
                <button
                  key={number}
                  type="button"
                  aria-current={page === number ? "page" : undefined}
                  onClick={() => onPage(number)}
                  className={`h-11 min-w-11 rounded-lg px-2 text-sm cursor-pointer ${page === number ? "bg-primary-600 font-bold text-white" : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-slate-800"}`}
                >
                  {number}
                </button>
              ))}
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => onPage(page + 1)}
                aria-label={t("report_builder.pagination.next")}
                className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 enabled:cursor-pointer dark:text-gray-300 dark:hover:bg-slate-800"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      ) : !loading && result ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-5 py-12 text-center text-sm text-gray-500 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-400">
          {t("report_builder.empty")}
        </div>
      ) : !result && !loading && !error ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-5 py-12 text-center text-sm text-gray-500 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-400">
          {t("report_builder.empty")}
        </div>
      ) : null}
    </div>
  );
}
