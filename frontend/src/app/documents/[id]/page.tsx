"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Ban, Download, FileText, RefreshCw } from "lucide-react";
import PageGuideModal from "@/components/PageGuideModal";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import apiClient from "@/lib/api";
import { formatDocumentDate, formatDocumentDateTime, getDocumentErrorMessage } from "@/lib/documents";

type DocumentStatus = "DRAFT" | "GENERATED" | "VOID";

interface DocumentVersion {
  id: number;
  document_id: number;
  version_number: number;
  template_version_id: number;
  file_checksum: string;
  file_size: number | null;
  generated_at: string | null;
  generated_by: number | null;
}

interface GeneratedDocument {
  id: number;
  document_number: string;
  document_type_id: number;
  document_type_name: string | null;
  document_type_name_bn: string | null;
  template_id: number;
  template_name: string | null;
  template_version_id: number;
  house_id: number;
  employee_id: number | null;
  employee_name: string | null;
  document_title: string;
  document_data: Record<string, string>;
  status: DocumentStatus;
  current_version: number;
  created_at: string | null;
  versions: DocumentVersion[];
}

interface AuditEntry {
  id: number;
  action: string;
  user_name: string | null;
  created_at: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
}

interface Pagination {
  page: number;
  total_pages: number;
  total: number;
  has_next: boolean;
  has_prev: boolean;
}

function parseId(value: string | string[] | undefined): number | null {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function GeneratedDocumentPage() {
  const { t, language } = useLanguage();
  const { hasPermission, loading: authLoading, selectedHouse } = useAuth();
  const selectedHouseId = selectedHouse?.id;
  const params = useParams<{ id: string }>();
  const documentId = parseId(params.id);
  const canView = hasPermission("documents.view");
  const canDownload = hasPermission("documents.download");
  const canRegenerate = hasPermission("documents.regenerate");
  const canVoid = hasPermission("documents.void");
  const canAudit = hasPermission("documents.audit.view");
  const headers = useMemo(
    () => selectedHouseId ? { "X-House-ID": String(selectedHouseId) } : {},
    [selectedHouseId],
  );
  const [document, setDocument] = useState<GeneratedDocument | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditPagination, setAuditPagination] = useState<Pagination | null>(null);
  const [auditPage, setAuditPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [auditError, setAuditError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const loadDocument = useCallback(async () => {
    if (!documentId || !selectedHouseId) {
      setLoading(false);
      setDocument(null);
      return;
    }
    setLoading(true);
    setErrorMessage("");
    try {
      const response = await apiClient.get(`v1/documents/records/${documentId}`, { headers });
      setDocument(response.data.data);
    } catch (error: unknown) {
      setErrorMessage(getDocumentErrorMessage(error, t("document_detail.load_error")));
    } finally {
      setLoading(false);
    }
  }, [documentId, headers, selectedHouseId, t]);

  const loadAudit = useCallback(async (pageNumber: number) => {
    if (!documentId || !selectedHouseId || !canAudit) return;
    setAuditError("");
    try {
      const response = await apiClient.get(`v1/documents/records/${documentId}/audit`, {
        params: { page: pageNumber, per_page: 20 },
        headers,
      });
      setAudit(response.data.data);
      setAuditPagination(response.data.pagination);
      setAuditPage(pageNumber);
    } catch (error: unknown) {
      setAuditError(getDocumentErrorMessage(error, t("document_detail.audit_load_error")));
    }
  }, [canAudit, documentId, headers, selectedHouseId, t]);

  useEffect(() => {
    if (authLoading || !canView) return;
    void loadDocument();
  }, [authLoading, canView, loadDocument]);

  const recordId = document?.id;
  useEffect(() => {
    if (recordId && canAudit) void loadAudit(1);
  }, [canAudit, loadAudit, recordId]);

  if (!authLoading && !canView) return <AccessDenied />;

  const statusLabel = document ? t(`document_detail.${document.status.toLowerCase()}`) : "";

  const downloadVersion = async (version: DocumentVersion) => {
    if (!document) return;
    setErrorMessage("");
    try {
      const response = await apiClient.get(
        `v1/documents/records/${document.id}/versions/${version.version_number}/download`,
        { headers, responseType: "blob" },
      );
      const objectUrl = window.URL.createObjectURL(response.data);
      const anchor = window.document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${document.document_number}-v${version.version_number}.pdf`;
      anchor.click();
      window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1000);
    } catch (error: unknown) {
      setErrorMessage(getDocumentErrorMessage(error, t("document_detail.download_error")));
    }
  };

  const regenerate = async () => {
    if (!document) return;
    setActionBusy(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await apiClient.post(`v1/documents/records/${document.id}/regenerate`, {}, { headers });
      setSuccessMessage(t("document_detail.regenerate_success"));
      await loadDocument();
      if (canAudit) await loadAudit(1);
    } catch (error: unknown) {
      setErrorMessage(getDocumentErrorMessage(error, t("document_detail.regenerate_error")));
    } finally {
      setActionBusy(false);
    }
  };

  const voidDocument = async () => {
    if (!document || !window.confirm(t("document_detail.void_confirm"))) return;
    setActionBusy(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await apiClient.post(`v1/documents/records/${document.id}/void`, {}, { headers });
      setSuccessMessage(t("document_detail.void_success"));
      await loadDocument();
      if (canAudit) await loadAudit(1);
    } catch (error: unknown) {
      setErrorMessage(getDocumentErrorMessage(error, t("document_detail.void_error")));
    } finally {
      setActionBusy(false);
    }
  };

  const fieldRows = document ? Object.entries(document.document_data || {}) : [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400"><FileText className="h-5 w-5" /></div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t("document_detail.title")}</h1>
          <PageGuideModal pageKey="document_detail" />
        </div>
        <Link href="/documents" className="inline-flex min-h-11 items-center rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-gray-200 dark:hover:bg-slate-800">{t("common.back")}</Link>
      </header>
      {errorMessage && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{errorMessage}</p>}
      {successMessage && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">{successMessage}</p>}
      {!selectedHouseId && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{t("document_detail.select_house")}</p>}

      {loading ? (
        <div className="space-y-4 animate-pulse">
          <div className="h-36 rounded-2xl bg-gray-100 dark:bg-slate-800" />
          <div className="h-72 rounded-2xl bg-gray-100 dark:bg-slate-800" />
        </div>
      ) : !document ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">{errorMessage || t("document_detail.load_error")}</div>
      ) : (
        <>
          <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t("document_detail.document_number")}</p>
                <h2 className="mt-1 break-all text-xl font-bold text-gray-900 dark:text-gray-100">{document.document_number}</h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{document.document_title}</p>
              </div>
              <span className="rounded-full bg-gray-100 px-3 py-1.5 text-xs font-bold text-gray-700 dark:bg-slate-800 dark:text-gray-200">{statusLabel}</span>
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-gray-100 pt-4 text-sm dark:border-slate-800 sm:grid-cols-3 xl:grid-cols-5">
              <div><dt className="text-xs text-gray-500 dark:text-gray-400">{t("document_detail.document_type")}</dt><dd className="mt-1 font-medium text-gray-900 dark:text-gray-100">{language === "bn" ? document.document_type_name_bn || document.document_type_name || `#${document.document_type_id}` : document.document_type_name || `#${document.document_type_id}`}</dd></div>
              <div><dt className="text-xs text-gray-500 dark:text-gray-400">{t("document_detail.template")}</dt><dd className="mt-1"><Link href={`/documents/templates/${document.template_id}`} className="font-medium text-primary-700 hover:underline dark:text-primary-300">{document.template_name || `#${document.template_id}`}</Link></dd></div>
              <div><dt className="text-xs text-gray-500 dark:text-gray-400">{t("document_detail.employee")}</dt><dd className="mt-1 font-medium text-gray-900 dark:text-gray-100">{document.employee_name || (document.employee_id ? `#${document.employee_id}` : "-")}</dd></div>
              <div><dt className="text-xs text-gray-500 dark:text-gray-400">{t("document_detail.created")}</dt><dd className="mt-1 font-medium text-gray-900 dark:text-gray-100">{formatDocumentDateTime(document.created_at)}</dd></div>
              <div><dt className="text-xs text-gray-500 dark:text-gray-400">{t("document_detail.current_version")}</dt><dd className="mt-1 font-medium text-gray-900 dark:text-gray-100">{document.current_version || "-"}</dd></div>
            </dl>
            <div className="mt-5 flex flex-wrap gap-2 border-t border-gray-100 pt-4 dark:border-slate-800">
              {canRegenerate && document.status === "GENERATED" && (
                <button type="button" onClick={() => void regenerate()} disabled={actionBusy} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-primary-600 px-4 text-sm font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50">
                  <RefreshCw className={`h-4 w-4 ${actionBusy ? "animate-spin" : ""}`} />{actionBusy ? t("document_detail.regenerating") : t("document_detail.regenerate")}
                </button>
              )}
              {canVoid && document.status !== "VOID" && (
                <button type="button" onClick={() => void voidDocument()} disabled={actionBusy} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-rose-200 px-4 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-900/50 dark:text-rose-300 dark:hover:bg-rose-950/30">
                  <Ban className="h-4 w-4" />{t("document_detail.void_document")}
                </button>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 sm:p-6">
            <h2 className="mb-4 font-semibold text-gray-900 dark:text-gray-100">{t("document_detail.document_data")}</h2>
            {fieldRows.length === 0 ? <p className="text-sm text-gray-500 dark:text-gray-400">{t("document_detail.no_data")}</p> : (
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {fieldRows.map(([key, value]) => (
                  <div key={key} className="min-w-0 rounded-xl bg-gray-50 p-3 dark:bg-slate-950">
                    <dt className="break-all text-xs text-gray-500 dark:text-gray-400">{key.replaceAll("_", " ")}</dt>
                    <dd className="mt-1 break-words text-sm font-medium text-gray-900 dark:text-gray-100">{value && /(?:^|_)date(?:_|$)/i.test(key) && /^\d{4}-\d{2}-\d{2}/.test(value) ? formatDocumentDate(value) : value || "-"}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">{t("document_detail.version_history")}</h2>
            {document.versions.length === 0 ? (
              <p className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-500 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-400">{t("document_detail.no_versions")}</p>
            ) : (
              <div className="space-y-3">
                {document.versions.map((version) => (
                  <article key={version.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 dark:text-gray-100">{t("document_detail.version", { version: version.version_number })}</p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t("document_detail.generated_at")}: {formatDocumentDateTime(version.generated_at)} · {t("document_detail.file_size")}: {formatBytes(version.file_size)}</p>
                      <p className="mt-1 break-all font-mono text-[11px] text-gray-500 dark:text-gray-400">{t("document_detail.checksum")}: {version.file_checksum}</p>
                    </div>
                    {canDownload && <button type="button" onClick={() => void downloadVersion(version)} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-gray-200 dark:hover:bg-slate-800"><Download className="h-4 w-4" />{t("document_detail.download")}</button>}
                  </article>
                ))}
              </div>
            )}
          </section>

          {canAudit && (
            <section className="space-y-3">
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">{t("document_detail.audit")}</h2>
              {auditError ? (
                <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{auditError}</p>
              ) : audit.length === 0 ? (
                <p className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-500 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-400">{t("document_detail.no_audit")}</p>
              ) : (
                <div className="space-y-3">
                  {audit.map((entry) => (
                    <article key={entry.id} className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold capitalize text-gray-900 dark:text-gray-100">{entry.action.replaceAll("_", " ")}</p>
                        <time className="text-xs text-gray-500 dark:text-gray-400">{formatDocumentDateTime(entry.created_at)}</time>
                      </div>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{entry.user_name || "-"}</p>
                      {(entry.old_values || entry.new_values) && <pre className="mt-3 overflow-x-auto rounded-lg bg-gray-50 p-3 text-[11px] text-gray-700 dark:bg-slate-950 dark:text-gray-300">{JSON.stringify({ old: entry.old_values, new: entry.new_values }, null, 2)}</pre>}
                    </article>
                  ))}
                  {auditPagination && auditPagination.total_pages > 1 && (
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-gray-500 dark:text-gray-400">{t("documents.record_page_count", { page: auditPagination.page, total: auditPagination.total_pages, count: auditPagination.total })}</p>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => void loadAudit(auditPage - 1)} disabled={!auditPagination.has_prev} className="min-h-11 min-w-11 cursor-pointer rounded-xl border border-gray-200 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700">{t("common.prev")}</button>
                        <button type="button" onClick={() => void loadAudit(auditPage + 1)} disabled={!auditPagination.has_next} className="min-h-11 min-w-11 cursor-pointer rounded-xl border border-gray-200 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700">{t("common.next")}</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
