"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import apiClient from "@/lib/api";
import { toast } from "react-hot-toast";
import { ArrowLeft, FileText, CheckCircle2, AlertCircle, HelpCircle, Search, ChevronLeft, ChevronRight, Upload, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import PageGuideModal from "@/components/PageGuideModal";
import ImageLightbox from "@/components/ui/ImageLightbox";
import LetterheadPreview from "@/components/houses/LetterheadPreview";
import { formatYMD } from "@/components/date-picker/format";
import { resignationLetterheadValues } from "@/lib/letterhead";

/** Compact size for a document card, e.g. 348 KB / 1.2 MB. */
function fileSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Authenticated image endpoint turned into an object URL (plain <img> gets 401). */
function useAuthImage(path: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!path) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    apiClient
      .get(path, { responseType: "blob" })
      .then((res) => {
        if (cancelled) return;
        objectUrl = window.URL.createObjectURL(new Blob([res.data]));
        setUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) window.URL.revokeObjectURL(objectUrl);
    };
  }, [path]);
  return url;
}

/** Document thumbnail on the card; clicking it opens the full-screen viewer. */
function DocumentThumb({
  path,
  title,
  label,
  fallback,
}: {
  path: string | null;
  title: string;
  label: string;
  fallback: React.ReactNode;
}) {
  const url = useAuthImage(path);
  const [open, setOpen] = useState(false);
  if (!url) {
    return (
      <div className="flex h-32 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800">
        {fallback}
      </div>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={label}
        aria-label={label}
        className="h-32 w-24 shrink-0 rounded-xl overflow-hidden border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 cursor-pointer hover:ring-2 hover:ring-primary-500 transition-all"
      >
        {/* Keep the preview within a fixed thumbnail so wide scans cannot stretch the card. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={title} className="h-full w-full object-contain" />
      </button>
      <ImageLightbox open={open} src={url} alt={title} title={title} onClose={() => setOpen(false)} />
    </>
  );
}

export default function ResignationDocumentsPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { hasPermission } = useAuth();

  const empId = Number(searchParams.get("emp_id"));
  const hasEmpId = Number.isFinite(empId) && empId > 0;
  const [loading, setLoading] = useState(hasEmpId);
  const [data, setData] = useState<any>(null);
  const [generating, setGenerating] = useState(false);

  // Employee picker (shown when no emp_id is in the URL, e.g. from the sidebar)
  const [overview, setOverview] = useState<{ data: any[]; pagination: any } | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [documentTab, setDocumentTab] = useState<"ready" | "not_ready">("not_ready");

  // Document cards upload straight from the card (no modal in between).
  const letterInputRef = useRef<HTMLInputElement>(null);
  const nidInputRef = useRef<HTMLInputElement>(null);
  const [uploadingLetter, setUploadingLetter] = useState(false);
  const [uploadingNid, setUploadingNid] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<"letter" | "nid" | "letterhead" | null>(null);
  const [removing, setRemoving] = useState(false);

  // `silent` keeps the cards on screen when only the document status changed.
  const fetchData = async (silent = false) => {
    if (!hasEmpId) {
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    try {
      const res = await apiClient.get(`employees/${empId}/resignation-documents`);
      setData(res.data);
    } catch (err: any) {
      toast.error(err.response?.data?.detail || t("common.action_failed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empId]);

  const fetchOverview = async (pageNo: number, keyword: string) => {
    setOverviewLoading(true);
    setOverviewError(false);
    try {
      const res = await apiClient.get("employees/resignation-overview", {
        params: { page: pageNo, per_page: 20, search: keyword || undefined },
      });
      setOverview(res.data);
    } catch {
      setOverviewError(true);
    } finally {
      setOverviewLoading(false);
    }
  };

  useEffect(() => {
    if (hasEmpId) return;
    const timer = setTimeout(() => fetchOverview(page, search), 350);
    return () => clearTimeout(timer);
  }, [hasEmpId, page, search]);

  const uploadDocument = async (kind: "resignation_letter" | "nid", file: File) => {
    const setBusy = kind === "resignation_letter" ? setUploadingLetter : setUploadingNid;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("kind", kind);
      form.append("file", file);
      await apiClient.post(`employees/${empId}/resignation-documents`, form);
      toast.success(t("resignation_docs.upload_success"));
      await fetchData(true);
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : t("resignation_docs.upload_failed"));
    } finally {
      setBusy(false);
    }
  };

  const handleFileSelected = (
    kind: "resignation_letter" | "nid",
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    // Reset so picking the same file again still fires onChange.
    e.target.value = "";
    if (file) void uploadDocument(kind, file);
  };

  // Soft delete: the file leaves the card but stays on disk for the audit trail.
  const removeAttachment = async () => {
    if (!pendingRemove) return;
    setRemoving(true);
    try {
      if (pendingRemove === "letterhead") {
        await apiClient.delete(`houses/${data.letterhead.house_id}/letterhead/image`);
      } else {
        const doc = pendingRemove === "letter" ? data.resignation_letter : data.nid;
        await apiClient.delete(`employees/${empId}/resignation-documents/${doc.id}`);
      }
      toast.success(t("resignation_docs.remove_success"));
      setPendingRemove(null);
      await fetchData(true);
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : t("resignation_docs.remove_failed"));
    } finally {
      setRemoving(false);
    }
  };

  const generatePdf = async () => {
    setGenerating(true);
    try {
      const res = await apiClient.post(
        `employees/${empId}/resignation-package`,
        {},
        { responseType: "blob" }
      );
      const url = window.URL.createObjectURL(
        new Blob([res.data], { type: "application/pdf" })
      );
      const link = document.createElement("a");
      link.href = url;
      const filenamePart = (value: string | number) =>
        String(value).trim().replace(/[\/\\:*?"<>|]+/g, "_");
      const dmsCode = filenamePart(data.employee?.dms_code || empId);
      const employeeName = filenamePart(data.employee?.employee_name || "Employee");
      link.download = `${dmsCode}_${employeeName}_Resign_Letter.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
      toast.success(t("resignation_docs.generate_success"));
    } catch (err: any) {
      let detail = err.response?.data?.detail;
      if (err.response?.data instanceof Blob) {
        try {
          const payload = JSON.parse(await err.response.data.text());
          detail = payload.detail;
        } catch {
          detail = undefined;
        }
      }

      const errorKeys: Record<string, string> = {
        EMPLOYEE_NOT_RESIGNED: "error_not_resigned",
        RESIGNATION_LETTER_MISSING: "error_letter_missing",
        NID_MISSING: "error_nid_missing",
        LETTERHEAD_NOT_CONFIGURED: "error_letterhead_missing",
        RESIGNATION_FILE_MISSING: "error_file_missing",
        PDF_GENERATION_FAILED: "error_pdf_generation",
      };
      const message = detail?.code
        ? t(`resignation_docs.${errorKeys[detail.code] || "generate_failed"}`)
        : typeof detail === "string"
          ? detail
          : t("resignation_docs.generate_failed");
      toast.error(message);
    } finally {
      setGenerating(false);
    }
  };

  if (!hasPermission("employees.resignation_view")) {
    return <AccessDenied />;
  }

  if (loading) {
    // Content-aware skeleton: mirrors the header, the employee card and the
    // three document cards so the layout does not jump when the data arrives.
    return (
      <div className="space-y-6 animate-pulse">
        <div className="flex items-center justify-between">
          <div className="h-7 w-56 rounded-lg bg-gray-200 dark:bg-slate-700" />
          <div className="h-10 w-24 rounded-xl bg-gray-200 dark:bg-slate-700" />
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 p-6">
          <div className="space-y-2">
            <div className="h-4 w-48 rounded-md bg-gray-200 dark:bg-slate-700" />
            <div className="h-3 w-64 rounded-md bg-gray-100 dark:bg-slate-800" />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="p-6 rounded-2xl border border-gray-200 dark:border-slate-700"
            >
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-gray-200 dark:bg-slate-700 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-32 rounded-md bg-gray-200 dark:bg-slate-700" />
                  <div className="h-3 w-24 rounded-md bg-gray-100 dark:bg-slate-800" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!hasEmpId) {
    const rows = overview?.data ?? [];
    const meta = overview?.pagination;
    const visibleRows = rows.filter((emp: any) =>
      documentTab === "ready" ? emp.ready : !emp.ready
    );
    const missingLabel: Record<string, string> = {
      resignation_letter: t("resignation_docs.letter_chip"),
      nid: t("resignation_docs.nid_chip"),
      letterhead: t("resignation_docs.letterhead_chip"),
    };
    const openEmployee = (id: number) =>
      router.push(`/employees/resignation-documents?emp_id=${id}`);

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <FileText className="w-6 h-6 text-primary-500" />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {t("resignation_docs.page_title")}
            </h1>
            <PageGuideModal pageKey="resignation_docs" />
          </div>
          <Link
            href="/employees"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 font-medium text-sm cursor-pointer transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            {t("resignation_docs.open_employees")}
          </Link>
        </div>

        {/* Search */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 p-4 sm:p-6">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            {t("resignation_docs.list_subtitle")}
          </p>
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder={t("resignation_docs.search_placeholder")}
              className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-sm text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>

        {overviewLoading ? (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 divide-y divide-gray-50 dark:divide-slate-800">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 sm:px-6 py-5 animate-pulse">
                <div className="w-10 h-10 rounded-xl bg-gray-200 dark:bg-slate-700 shrink-0" />
                <div className="space-y-2 flex-1">
                  <div className="h-3 w-32 bg-gray-200 dark:bg-slate-700 rounded-md" />
                  <div className="h-2.5 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
                </div>
                <div className="hidden sm:block w-28 space-y-2">
                  <div className="h-3 w-20 bg-gray-200 dark:bg-slate-700 rounded-md" />
                  <div className="h-2.5 w-16 bg-gray-100 dark:bg-slate-800 rounded-md" />
                </div>
              </div>
            ))}
          </div>
        ) : overviewError ? (
          <div className="text-center py-12 bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700">
            <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("resignation_docs.overview_failed")}
            </p>
            <button
              onClick={() => fetchOverview(page, search)}
              className="mt-4 px-4 py-2 rounded-xl bg-primary-500 text-white text-sm font-medium cursor-pointer hover:bg-primary-600 transition-colors"
            >
              {t("common.refresh")}
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16 bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700">
            <FileText className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <p className="text-gray-700 dark:text-gray-200 font-medium">
              {t("resignation_docs.no_resigned_title")}
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 max-w-md mx-auto">
              {t("resignation_docs.no_resigned_desc")}
            </p>
          </div>
        ) : (
          <>
            <div
              role="tablist"
              aria-label={t("resignation_docs.document_status_tabs")}
              className="flex gap-2 border-b border-gray-200 dark:border-slate-700"
            >
              {(["not_ready", "ready"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  id={`resignation-documents-tab-${tab}`}
                  aria-selected={documentTab === tab}
                  aria-controls="resignation-documents-tabpanel"
                  onClick={() => setDocumentTab(tab)}
                  className={cn(
                    "min-h-11 px-4 border-b-2 text-sm font-semibold cursor-pointer transition-colors",
                    documentTab === tab
                      ? "border-primary-500 text-primary-600 dark:text-primary-400"
                      : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  )}
                >
                  {t(`resignation_docs.${tab === "ready" ? "ready_tab" : "not_ready_tab"}`)}
                </button>
              ))}
            </div>

            {visibleRows.length === 0 ? (
              <div
                id="resignation-documents-tabpanel"
                role="tabpanel"
                aria-labelledby={`resignation-documents-tab-${documentTab}`}
                className="text-center py-10 bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 text-sm text-gray-500 dark:text-gray-400"
              >
                {t("resignation_docs.no_records_in_tab")}
              </div>
            ) : (
              <div
                id="resignation-documents-tabpanel"
                role="tabpanel"
                aria-labelledby={`resignation-documents-tab-${documentTab}`}
              >
                {/* Desktop table */}
            <div className="hidden lg:block bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-slate-800/60 border-b border-gray-200 dark:border-slate-700">
                    <th className="px-2 py-2 text-left text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t("resignation_docs.employee_house")}</th>
                    <th className="px-2 py-2 text-left text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t("resignation_docs.employee")}</th>
                    <th className="px-2 py-2 text-left text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t("resignation_docs.employee_type")}</th>
                    <th className="px-2 py-2 text-left text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t("resignation_docs.employee_resigned")}</th>
                    <th className="px-2 py-2 text-left text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t("resignation_docs.docs_status")}</th>
                    <th className="px-2 py-2 text-right text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t("common.action")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                  {visibleRows.map((emp: any) => (
                    <tr key={emp.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="px-2 py-1">
                        <p className="text-xs text-gray-900 dark:text-gray-100">{emp.house_name || "-"}</p>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">{emp.house_code || "-"}</p>
                      </td>
                      <td className="px-2 py-1">
                        <p className="font-medium text-gray-900 dark:text-gray-100">{emp.employee_name || "-"}</p>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">
                          {emp.dms_code || "-"} · {emp.itop_number || "-"}
                        </p>
                      </td>
                      <td className="px-2 py-1 uppercase text-xs text-gray-600 dark:text-gray-300">{emp.employee_type || "-"}</td>
                      <td className="px-2 py-1 text-xs text-gray-600 dark:text-gray-300">{formatYMD(emp.resigned_date, "en")}</td>
                      <td className="px-2 py-1">
                        {emp.ready ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-green-50 dark:bg-green-900/30 text-[11px] font-medium text-green-700 dark:text-green-300">
                            <CheckCircle2 className="w-3.5 h-3.5" /> {t("resignation_docs.ready_badge")}
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {emp.missing.map((item: string) => (
                              <span key={item} className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-900/30 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                                {missingLabel[item] || item}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1 text-right">
                        <button
                          onClick={() => openEmployee(emp.id)}
                          className="px-3 py-1.5 rounded-lg bg-primary-500 text-white text-xs font-medium hover:bg-primary-600 cursor-pointer transition-colors"
                        >
                          {t("resignation_docs.open_documents")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="lg:hidden space-y-3">
              {visibleRows.map((emp: any) => (
                <button
                  key={emp.id}
                  onClick={() => openEmployee(emp.id)}
                  className="w-full text-left bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 p-4 cursor-pointer hover:border-primary-300 dark:hover:border-primary-700 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 dark:text-gray-100 truncate">{emp.employee_name || "-"}</p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">
                        {emp.dms_code || "-"} · {emp.itop_number || "-"} · {(emp.employee_type || "-").toUpperCase()}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                    <span>{emp.house_name || "-"} · {emp.house_code || "-"}</span>
                    <span>· {formatYMD(emp.resigned_date, "en")}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {emp.ready ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-green-50 dark:bg-green-900/30 text-[11px] font-medium text-green-700 dark:text-green-300">
                        <CheckCircle2 className="w-3.5 h-3.5" /> {t("resignation_docs.ready_badge")}
                      </span>
                    ) : (
                      emp.missing.map((item: string) => (
                        <span key={item} className="inline-flex items-center px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-900/30 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                          {missingLabel[item] || item}
                        </span>
                      ))
                    )}
                  </div>
                </button>
              ))}
            </div>
              </div>
            )}

            {/* Pagination */}
            {meta && meta.total_pages > 1 && (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {meta.page} / {meta.total_pages} ({meta.total})
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={!meta.has_prev}
                    className="px-3 py-2 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-medium text-gray-700 dark:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors inline-flex items-center gap-1"
                  >
                    <ChevronLeft className="w-4 h-4" /> {t("common.prev")}
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(meta.total_pages, p + 1))}
                    disabled={!meta.has_next}
                    className="px-3 py-2 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-medium text-gray-700 dark:text-gray-300 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors inline-flex items-center gap-1"
                  >
                    {t("common.next")} <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
        <p className="text-gray-500 dark:text-gray-400">{t("common.not_found")}</p>
        <button
          onClick={() => router.back()}
          className="mt-4 px-4 py-2 rounded-xl bg-primary-500 text-white cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4 inline mr-1" />
          {t("common.back")}
        </button>
      </div>
    );
  }

  const letterheadValues = resignationLetterheadValues(data.employee ?? {});

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t("resignation_docs.page_title")}
          </h1>
          <PageGuideModal pageKey="resignation_docs" />
        </div>
        <button
          onClick={() => router.back()}
          className="px-4 py-2 rounded-xl border bg-white dark:bg-slate-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-700 font-medium cursor-pointer transition-colors flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          {t("common.back")}
        </button>
      </div>

      {/* Employee Info Card */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {data.employee?.employee_name || t("resignation_docs.employee")}
            </h2>
            <div className="flex flex-wrap gap-3 mt-2 text-sm text-gray-500 dark:text-gray-400">
              <span className="flex items-center gap-1">
                <FileText className="w-4 h-4" />
                {data.employee?.dms_code || "-"}
              </span>
              <span className="flex items-center gap-1">
                <span className="uppercase">{data.employee?.employee_type || "-"}</span>
              </span>
              <span className="flex items-center gap-1">
                {data.employee?.house_name}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Status Grid */}
      <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {/* Resignation Letter */}
        <div className={cn(
          "min-w-0 overflow-hidden rounded-2xl border p-4 transition-all sm:p-5 lg:p-6",
          data.resignation_letter
            ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
            : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
        )}>
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
            <div className="group relative inline-block shrink-0">
              <DocumentThumb
                path={
                  data.resignation_letter
                    ? `employees/${empId}/documents/${data.resignation_letter.id}/file`
                    : null
                }
                title={data.resignation_letter?.file_name || t("resignation_docs.resignation_letter")}
                label={t("resignation_docs.preview_document")}
                fallback={
                  <div className={cn(
                    "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl",
                    data.resignation_letter
                      ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
                      : "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
                  )}>
                    <FileText className="w-6 h-6" />
                  </div>
                }
              />
              {data.resignation_letter && hasPermission("employees.resignation_delete") && (
                <button
                  type="button"
                  onClick={() => setPendingRemove("letter")}
                  aria-label={t("resignation_docs.remove_letter")}
                  title={t("resignation_docs.remove_letter")}
                  className="absolute right-1 top-1 z-10 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 cursor-pointer xl:pointer-events-none xl:opacity-0 xl:group-hover:pointer-events-auto xl:group-hover:opacity-100 xl:group-focus-within:pointer-events-auto xl:group-focus-within:opacity-100"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900/75 text-white shadow-sm transition-colors hover:bg-red-600 dark:bg-slate-900/90 dark:hover:bg-red-600">
                    <Trash2 className="h-3.5 w-3.5 shrink-0" />
                  </span>
                </button>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="break-words font-semibold text-gray-900 dark:text-gray-100">
                {t("resignation_docs.resignation_letter")}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {data.resignation_letter
                  ? t("resignation_docs.letter_uploaded")
                  : t("resignation_docs.letter_not_uploaded")}
              </p>
              {data.resignation_letter && (
                <p className="mt-2 break-all text-[11px] text-gray-400 dark:text-gray-500">
                  {data.resignation_letter.file_name}
                  {data.resignation_letter.file_size > 0 &&
                    ` · ${fileSize(data.resignation_letter.file_size)}`}
                </p>
              )}
              {hasPermission("employees.resignation_upload") && (
                <div className="mt-2">
                  <input
                    ref={letterInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => handleFileSelected("resignation_letter", e)}
                  />
                  <button
                    onClick={() => letterInputRef.current?.click()}
                    disabled={uploadingLetter}
                    className="inline-flex min-h-11 max-w-full flex-wrap items-center gap-1.5 text-left text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {uploadingLetter ? (
                      <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4 shrink-0" />
                    )}
                    {t(
                      data.resignation_letter
                        ? "resignation_docs.replace_letter"
                        : "resignation_docs.upload_letter"
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* NID */}
        <div className={cn(
          "min-w-0 overflow-hidden rounded-2xl border p-4 transition-all sm:p-5 lg:p-6",
          data.nid
            ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
            : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
        )}>
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
            <div className="group relative inline-block shrink-0">
              <DocumentThumb
                path={data.nid ? `employees/${empId}/documents/${data.nid.id}/file` : null}
                title={data.nid?.file_name || t("resignation_docs.nid")}
                label={t("resignation_docs.preview_document")}
                fallback={
                  <div className={cn(
                    "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl",
                    data.nid
                      ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
                      : "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
                  )}>
                    <FileText className="w-6 h-6" />
                  </div>
                }
              />
              {data.nid && hasPermission("employees.resignation_delete") && (
                <button
                  type="button"
                  onClick={() => setPendingRemove("nid")}
                  aria-label={t("resignation_docs.remove_nid")}
                  title={t("resignation_docs.remove_nid")}
                  className="absolute right-1 top-1 z-10 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 cursor-pointer xl:pointer-events-none xl:opacity-0 xl:group-hover:pointer-events-auto xl:group-hover:opacity-100 xl:group-focus-within:pointer-events-auto xl:group-focus-within:opacity-100"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900/75 text-white shadow-sm transition-colors hover:bg-red-600 dark:bg-slate-900/90 dark:hover:bg-red-600">
                    <Trash2 className="h-3.5 w-3.5 shrink-0" />
                  </span>
                </button>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="break-words font-semibold text-gray-900 dark:text-gray-100">
                {t("resignation_docs.nid")}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {data.nid
                  ? t("resignation_docs.nid_uploaded")
                  : t("resignation_docs.nid_not_uploaded")}
              </p>
              {data.nid && (
                <p className="mt-2 break-all text-[11px] text-gray-400 dark:text-gray-500">
                  {data.nid.file_name}
                  {data.nid.file_size > 0 && ` · ${fileSize(data.nid.file_size)}`}
                  {data.nid.source && ` (${data.nid.source})`}
                </p>
              )}
              {hasPermission("employees.resignation_upload") && (
                <div className="mt-2">
                  <input
                    ref={nidInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => handleFileSelected("nid", e)}
                  />
                  <button
                    onClick={() => nidInputRef.current?.click()}
                    disabled={uploadingNid}
                    className="inline-flex min-h-11 max-w-full flex-wrap items-center gap-1.5 text-left text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {uploadingNid ? (
                      <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                    ) : (
                      <Upload className="w-4 h-4 shrink-0" />
                    )}
                    {t(
                      data.nid
                        ? "resignation_docs.replace_nid"
                        : "resignation_docs.upload_nid"
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Letterhead */}
        <div className={cn(
          "min-w-0 overflow-hidden rounded-2xl border p-4 transition-all sm:p-5 lg:p-6",
          data.letterhead?.configured
            ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
            : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
        )}>
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
            <div className="group relative inline-block shrink-0">
              <LetterheadPreview
                houseId={data.letterhead?.configured ? data.letterhead?.house_id : null}
                title={data.letterhead?.house_name || t("resignation_docs.letterhead")}
                label={t("resignation_docs.preview_document")}
                values={letterheadValues}
                fallback={
                  <div className={cn(
                    "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl",
                    data.letterhead?.configured
                      ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
                      : "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
                  )}>
                    <HelpCircle className="w-6 h-6" />
                  </div>
                }
              />
              {data.letterhead?.configured && hasPermission("houses.letterhead_edit") && (
                <button
                  type="button"
                  onClick={() => setPendingRemove("letterhead")}
                  aria-label={t("resignation_docs.remove_letterhead")}
                  title={t("resignation_docs.remove_letterhead")}
                  className="absolute right-1 top-1 z-10 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 cursor-pointer xl:pointer-events-none xl:opacity-0 xl:group-hover:pointer-events-auto xl:group-hover:opacity-100 xl:group-focus-within:pointer-events-auto xl:group-focus-within:opacity-100"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900/75 text-white shadow-sm transition-colors hover:bg-red-600 dark:bg-slate-900/90 dark:hover:bg-red-600">
                    <Trash2 className="h-3.5 w-3.5 shrink-0" />
                  </span>
                </button>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="break-words font-semibold text-gray-900 dark:text-gray-100">
                {t("resignation_docs.letterhead")}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {data.letterhead?.configured
                  ? t("resignation_docs.letterhead_configured")
                  : t("resignation_docs.letterhead_not_configured")}
              </p>
              {data.letterhead && (
                <p className="mt-2 break-words text-[11px] text-gray-400 dark:text-gray-500">
                  {data.letterhead.house_name}
                </p>
              )}
              {data.letterhead?.house_id && (
                <Link
                  href={`/houses/letterhead?house_id=${data.letterhead.house_id}&emp_id=${empId}`}
                  className="mt-2 inline-flex min-h-11 max-w-full items-center break-words text-sm font-medium text-primary-600 dark:text-primary-400 hover:underline cursor-pointer"
                >
                  {t(
                    data.letterhead.configured
                      ? "resignation_docs.update_letterhead"
                      : "resignation_docs.configure_letterhead"
                  )}
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Missing Items */}
      {data.missing.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-6">
          <h3 className="font-semibold text-amber-800 dark:text-amber-200 flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            {t("resignation_docs.missing_items")}
          </h3>
          <ul className="mt-3 space-y-2">
            {data.missing.map((item: string) => (
              <li key={item} className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {t(`resignation_docs.${item === "resignation_letter" ? "resignation_letter" : item === "nid" ? "nid" : "letterhead"}`)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <button
          onClick={generatePdf}
          disabled={!data.can_generate || generating || !hasPermission("employees.resignation_generate")}
          className={cn(
            "px-6 py-3 rounded-xl font-medium cursor-pointer transition-colors flex items-center gap-2 text-lg disabled:cursor-not-allowed",
            data.can_generate && hasPermission("employees.resignation_generate")
              ? "bg-primary-500 text-white hover:bg-primary-600"
              : "bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
          )}>
          {generating ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <FileText className="w-5 h-5" />
          )}
          {t(generating ? "resignation_docs.generating" : "resignation_docs.generate_pdf")}
        </button>
      </div>

      {/* Info Box */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-2xl p-6">
        <h3 className="font-semibold text-blue-800 dark:text-blue-200 flex items-center gap-2">
          <HelpCircle className="w-5 h-5" />
          {t("resignation_docs.guide.title")}
        </h3>
        <p className="mt-2 text-sm text-blue-700 dark:text-blue-300">
          {t("resignation_docs.guide.overview")}
        </p>
        <details className="mt-4 group">
          <summary className="cursor-pointer font-medium text-blue-700 dark:text-blue-300 flex items-center gap-2">
            <span>{t("common.details")}</span>
            <span className="ml-auto transition-transform group-open:rotate-90">▼</span>
          </summary>
          <div className="mt-3 space-y-3 text-sm text-blue-700 dark:text-blue-300">
            <div>
              <p className="font-medium">{t("resignation_docs.guide.steps_title")}</p>
              <ol className="list-decimal list-inside mt-1 space-y-1">
                {Object.values(data?.guide?.steps || {}).map((s: any, i) => (
                  <li key={i}>{s.title}: {s.desc}</li>
                ))}
              </ol>
            </div>
            <div>
              <p className="font-medium">{t("resignation_docs.guide.notes_title")}</p>
              <ul className="list-disc list-inside mt-1 space-y-1">
                {Object.values(data?.guide?.notes || {}).map((n: any, i) => (
                  <li key={i}>{n.title}: {n.desc}</li>
                ))}
              </ul>
            </div>
          </div>
        </details>
      </div>

      <ConfirmationModal
        isOpen={pendingRemove !== null}
        onClose={() => setPendingRemove(null)}
        onConfirm={removeAttachment}
        title={t("resignation_docs.remove_confirm_title")}
        message={t("resignation_docs.remove_confirm_message")}
        confirmText={t("common.delete")}
        type="danger"
        loading={removing}
      />
    </div>
  );
}