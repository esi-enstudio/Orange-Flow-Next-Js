"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, FileText, RefreshCw, Search } from "lucide-react";
import PageGuideModal from "@/components/PageGuideModal";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import apiClient from "@/lib/api";
import { formatDocumentDate, getDocumentErrorMessage } from "@/lib/documents";

type DocumentStatus = "DRAFT" | "GENERATED" | "VOID";

interface DocumentType {
  id: number;
  name: string;
  name_bn: string | null;
}

interface DocumentRecord {
  id: number;
  document_number: string;
  document_title: string;
  document_type_id: number;
  document_type_name: string;
  document_type_name_bn: string | null;
  employee_name: string | null;
  status: DocumentStatus;
  current_version: number;
  created_at: string | null;
}

interface Pagination {
  page: number;
  total_pages: number;
  total: number;
  has_next: boolean;
  has_prev: boolean;
}

interface Summary {
  total: number;
  draft: number;
  generated: number;
  void: number;
}

const initialSummary: Summary = { total: 0, draft: 0, generated: 0, void: 0 };
const controlClass =
  "min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-primary-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100";

function statusKey(status: DocumentStatus): string {
  if (status === "GENERATED") return "generated";
  if (status === "VOID") return "void";
  return "draft";
}

export default function DocumentsPage() {
  const { t, language } = useLanguage();
  const { hasPermission, loading: authLoading, selectedHouse } = useAuth();
  const selectedHouseId = selectedHouse?.id;
  const canView = hasPermission("documents.view");
  const headers = useMemo(
    () => selectedHouseId ? { "X-House-ID": String(selectedHouseId) } : {},
    [selectedHouseId],
  );
  const [records, setRecords] = useState<DocumentRecord[]>([]);
  const [types, setTypes] = useState<DocumentType[]>([]);
  const [summary, setSummary] = useState<Summary>(initialSummary);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [documentTypeId, setDocumentTypeId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const loadRecords = useCallback(async () => {
    if (!selectedHouseId) {
      setLoading(false);
      setRecords([]);
      setPagination(null);
      return;
    }
    setLoading(true);
    setLoadError("");
    try {
      const params = {
        page,
        per_page: 20,
        search: search.trim() || undefined,
        status: status || undefined,
        document_type_id: documentTypeId || undefined,
        from_date: fromDate || undefined,
        to_date: toDate || undefined,
      };
      const [listResponse, summaryResponse] = await Promise.all([
        apiClient.get("v1/documents/records", { params, headers }),
        apiClient.get("v1/documents/records/summary", { headers }),
      ]);
      setRecords(listResponse.data.data);
      setPagination(listResponse.data.pagination);
      setSummary(summaryResponse.data.data);
    } catch (error: unknown) {
      setLoadError(getDocumentErrorMessage(error, t("documents.load_error")));
    } finally {
      setLoading(false);
    }
  }, [documentTypeId, fromDate, headers, page, search, selectedHouseId, status, t, toDate]);

  useEffect(() => {
    if (authLoading || !canView) return;
    const timer = window.setTimeout(() => void loadRecords(), search ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [authLoading, canView, loadRecords, search]);

  useEffect(() => {
    if (!selectedHouseId || !canView) {
      setTypes([]);
      return;
    }
    apiClient.get("v1/documents/types")
      .then((response) => setTypes(response.data.data))
      .catch((error: unknown) => setLoadError(getDocumentErrorMessage(error, t("documents.load_error"))));
  }, [canView, selectedHouseId, t]);

  if (!authLoading && !canView) return <AccessDenied />;

  const typeNames = new Map(
    types.map((type) => [type.id, language === "bn" ? type.name_bn || type.name : type.name]),
  );

  const clearFilters = () => {
    setSearch("");
    setStatus("");
    setDocumentTypeId("");
    setFromDate("");
    setToDate("");
    setPage(1);
  };

  const statusLabel = (recordStatus: DocumentStatus) => t(`document_detail.${statusKey(recordStatus)}`);
  const statCards = [
    { key: "total_documents", value: summary.total, tone: "text-gray-900 dark:text-gray-100" },
    { key: "draft_documents", value: summary.draft, tone: "text-amber-700 dark:text-amber-300" },
    { key: "generated_documents", value: summary.generated, tone: "text-emerald-700 dark:text-emerald-300" },
    { key: "void_documents", value: summary.void, tone: "text-rose-700 dark:text-rose-300" },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400">
            <FileText className="h-5 w-5" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t("documents.history_title")}</h1>
          <PageGuideModal pageKey="document_history" />
        </div>
        <button
          type="button"
          onClick={() => void loadRecords()}
          disabled={loading || !selectedHouseId}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-200 dark:hover:bg-slate-800"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {t("documents.refresh")}
        </button>
      </header>

      <p className="text-sm text-gray-500 dark:text-gray-400">{t("documents.history_description")}</p>
      {!selectedHouseId && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{t("document_detail.select_house")}</p>}

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {statCards.map((card) => (
          <article key={card.key} className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 sm:p-5">
            <p className="text-sm text-gray-500 dark:text-gray-400">{t(`documents.${card.key}`)}</p>
            <p className={`mt-2 text-2xl font-bold ${card.tone}`}>{loading ? "—" : card.value}</p>
          </article>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-3 rounded-2xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 sm:grid-cols-2 xl:grid-cols-6">
        <label className="relative sm:col-span-2 xl:col-span-2">
          <span className="sr-only">{t("documents.search")}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={search}
            onChange={(event) => { setSearch(event.target.value); setPage(1); }}
            placeholder={t("documents.search_records")}
            className={`${controlClass} cursor-text pl-10`}
          />
        </label>
        <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className={`${controlClass} cursor-pointer`}>
          <option value="">{t("documents.all_statuses")}</option>
          <option value="DRAFT">{t("document_detail.draft")}</option>
          <option value="GENERATED">{t("document_detail.generated")}</option>
          <option value="VOID">{t("document_detail.void")}</option>
        </select>
        <select value={documentTypeId} onChange={(event) => { setDocumentTypeId(event.target.value); setPage(1); }} className={`${controlClass} cursor-pointer`}>
          <option value="">{t("documents.all_types")}</option>
          {types.map((type) => <option key={type.id} value={type.id}>{language === "bn" ? type.name_bn || type.name : type.name}</option>)}
        </select>
        <label className="text-xs text-gray-500 dark:text-gray-400">
          {t("documents.from_date")}
          <input type="date" value={fromDate} onChange={(event) => { setFromDate(event.target.value); setPage(1); }} className={`${controlClass} mt-1 cursor-pointer`} />
        </label>
        <label className="text-xs text-gray-500 dark:text-gray-400">
          {t("documents.to_date")}
          <input type="date" value={toDate} onChange={(event) => { setToDate(event.target.value); setPage(1); }} className={`${controlClass} mt-1 cursor-pointer`} />
        </label>
        <div className="flex items-end sm:col-span-2 xl:col-span-6">
          <button type="button" onClick={clearFilters} className="min-h-11 cursor-pointer rounded-xl px-3 text-sm font-semibold text-primary-700 hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-primary-950/30">
            {t("documents.clear_filters")}
          </button>
        </div>
      </section>

      {loadError ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-900/50 dark:bg-red-950/20">
          <p className="text-sm font-medium text-red-700 dark:text-red-300">{loadError}</p>
          <button type="button" onClick={() => void loadRecords()} className="mt-4 min-h-11 cursor-pointer rounded-xl bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700">{t("documents.try_again")}</button>
        </div>
      ) : loading ? (
        <div className="space-y-3 animate-pulse">
          {Array.from({ length: 8 }).map((_, index) => <div key={index} className="h-16 rounded-xl bg-gray-100 dark:bg-slate-800" />)}
        </div>
      ) : records.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white py-14 text-center dark:border-slate-700 dark:bg-slate-900">
          <FileText className="mx-auto mb-3 h-10 w-10 text-gray-300 dark:text-slate-600" />
          <p className="font-semibold text-gray-800 dark:text-gray-200">{t("documents.no_records")}</p>
        </div>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900 lg:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-slate-800/60">
                  <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t("documents.document_number")}</th>
                  <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t("documents.type")}</th>
                  <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t("documents.employee")}</th>
                  <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t("documents.status")}</th>
                  <th className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t("documents.created")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {records.map((record) => (
                  <tr key={record.id}>
                    <td className="px-2 py-1">
                      <Link href={`/documents/${record.id}`} className="font-semibold text-primary-700 hover:underline dark:text-primary-300">{record.document_number}</Link>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">{record.document_title}</p>
                    </td>
                    <td className="px-2 py-1 text-gray-700 dark:text-gray-300">{language === "bn" ? record.document_type_name_bn || record.document_type_name : record.document_type_name || typeNames.get(record.document_type_id)}</td>
                    <td className="px-2 py-1 text-gray-700 dark:text-gray-300">{record.employee_name || "-"}</td>
                    <td className="px-2 py-1"><span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700 dark:bg-slate-800 dark:text-gray-200">{statusLabel(record.status)}</span></td>
                    <td className="px-2 py-1 text-gray-700 dark:text-gray-300">{formatDocumentDate(record.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 lg:hidden">
            {records.map((record) => {
              const expanded = expandedId === record.id;
              return (
                <article key={record.id} className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                  <button type="button" onClick={() => setExpandedId(expanded ? null : record.id)} aria-expanded={expanded} className="flex min-h-16 w-full cursor-pointer items-center gap-3 p-4 text-left">
                    {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-gray-500" /> : <ChevronRight className="h-4 w-4 shrink-0 text-gray-500" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-gray-900 dark:text-gray-100">{record.document_number}</span>
                      <span className="block truncate text-[11px] text-gray-500 dark:text-gray-400">{record.document_title}</span>
                    </span>
                    <span className="shrink-0 rounded-full bg-gray-100 px-2 py-1 text-[11px] font-semibold text-gray-700 dark:bg-slate-800 dark:text-gray-200">{statusLabel(record.status)}</span>
                  </button>
                  {expanded && (
                    <div className="space-y-3 border-t border-gray-100 px-4 py-3 dark:border-slate-800">
                      <dl className="grid grid-cols-2 gap-3 text-xs">
                        <div><dt className="text-gray-500 dark:text-gray-400">{t("documents.type")}</dt><dd className="mt-0.5 font-medium text-gray-800 dark:text-gray-200">{language === "bn" ? record.document_type_name_bn || record.document_type_name : record.document_type_name || typeNames.get(record.document_type_id)}</dd></div>
                        <div><dt className="text-gray-500 dark:text-gray-400">{t("documents.employee")}</dt><dd className="mt-0.5 font-medium text-gray-800 dark:text-gray-200">{record.employee_name || "-"}</dd></div>
                        <div><dt className="text-gray-500 dark:text-gray-400">{t("documents.created")}</dt><dd className="mt-0.5 font-medium text-gray-800 dark:text-gray-200">{formatDocumentDate(record.created_at)}</dd></div>
                        <div><dt className="text-gray-500 dark:text-gray-400">{t("documents.version")}</dt><dd className="mt-0.5 font-medium text-gray-800 dark:text-gray-200">{record.current_version || "-"}</dd></div>
                      </dl>
                      <Link href={`/documents/${record.id}`} className="inline-flex min-h-11 items-center font-semibold text-primary-700 hover:underline dark:text-primary-300">{t("documents.open_document")}</Link>
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          {pagination && pagination.total_pages > 1 && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-gray-500 dark:text-gray-400">{t("documents.record_page_count", { page: pagination.page, total: pagination.total_pages, count: pagination.total })}</p>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={!pagination.has_prev} className="min-h-11 min-w-11 cursor-pointer rounded-xl border border-gray-200 bg-white text-sm text-gray-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-200">{t("common.prev")}</button>
                <button type="button" onClick={() => setPage((current) => current + 1)} disabled={!pagination.has_next} className="min-h-11 min-w-11 cursor-pointer rounded-xl border border-gray-200 bg-white text-sm text-gray-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-200">{t("common.next")}</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
