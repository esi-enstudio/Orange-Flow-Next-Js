"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import apiClient from "@/lib/api";
import { toast } from "react-hot-toast";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  HelpCircle,
  Home,
  LayoutTemplate,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import EntitySelector, { type SelectorItem } from "@/app/zoom-in/_components/EntitySelector";
import { cn } from "@/lib/utils";
import { getDocumentErrorMessage } from "@/lib/documents";
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

interface ResignationTemplate {
  id: number;
  name: string;
  scope: "global" | "house";
  is_default: boolean;
  is_active: boolean;
  latest_version?: {
    version_number?: number;
    is_published?: boolean;
    published_version?: number;
  } | null;
}

/** apiClient keeps structured codes in `error_code` while flattening `detail`. */
function getDocumentErrorCode(error: unknown): string {
  if (typeof error !== "object" || error === null || !("response" in error)) return "";
  const data = (error as { response?: { data?: unknown } }).response?.data;
  if (typeof data !== "object" || data === null || !("error_code" in data)) return "";
  const code = (data as { error_code?: unknown }).error_code;
  return typeof code === "string" ? code : "";
}

function PageHeader({
  action,
  title,
  subtitle,
  t,
}: {
  action: React.ReactNode;
  title: string;
  subtitle: string;
  t: (path: string, params?: Record<string, string | number | undefined>) => string;
}) {
  return (
    <header className="border-b border-gray-200 pb-4 dark:border-slate-700">
      <nav aria-label={t("resignation_docs.breadcrumb_label")} className="-mt-1 mb-3 text-[13px]">
        <ol className="flex flex-wrap items-center gap-1.5 text-gray-500 dark:text-gray-400">
          <li>
            <Link href="/" className="inline-flex min-h-11 items-center gap-1.5 transition-colors hover:text-gray-700 dark:hover:text-gray-200">
              <Home aria-hidden="true" className="size-4" />
              {t("resignation_docs.breadcrumb_home")}
            </Link>
          </li>
          <li aria-hidden="true"><ChevronRight className="size-3.5" /></li>
          <li>
            <Link href="/employees" className="inline-flex min-h-11 items-center transition-colors hover:text-gray-700 dark:hover:text-gray-200">
              {t("resignation_docs.breadcrumb_employees")}
            </Link>
          </li>
          <li aria-hidden="true"><ChevronRight className="size-3.5" /></li>
          <li aria-current="page" className="font-medium text-gray-700 dark:text-gray-300">{title}</li>
        </ol>
      </nav>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-950/40 dark:text-primary-300">
            <FileText aria-hidden="true" className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{title}</h1>
              <PageGuideModal pageKey="resignation_docs" />
            </div>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
          </div>
        </div>
        {action}
      </div>
    </header>
  );
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
  const { hasPermission, loading: authLoading, selectedHouse } = useAuth();
  const selectedHouseId = selectedHouse?.id;
  const headers = useMemo<Record<string, string>>(() => {
    const result: Record<string, string> = {};
    if (selectedHouseId) result["X-House-ID"] = String(selectedHouseId);
    return result;
  }, [selectedHouseId]);
  const canReadTemplates = hasPermission("documents.templates.view") || hasPermission("documents.create");
  const canCreateDocument = hasPermission("documents.create");
  const canGenerateDocument = hasPermission("documents.generate");
  const canDownloadDocument = hasPermission("documents.download");

  const empId = Number(searchParams.get("emp_id"));
  const hasEmpId = Number.isFinite(empId) && empId > 0;
  const [loading, setLoading] = useState(hasEmpId);
  const [data, setData] = useState<any>(null);
  const [generating, setGenerating] = useState(false);

  // Published RESIGNATION templates are the authoring source of truth. The
  // legacy package endpoint stays on the server but is no longer surfaced.
  const [templates, setTemplates] = useState<ResignationTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [generationError, setGenerationError] = useState("");
  const [failedDraftId, setFailedDraftId] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState("");
  const [downloadTarget, setDownloadTarget] = useState<{ documentId: number; versionNumber: number } | null>(null);
  const previewRequestId = useRef(0);

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

  const loadTemplates = useCallback(async () => {
    if (!hasEmpId || !canReadTemplates) return;
    setTemplatesLoading(true);
    setTemplatesError("");
    try {
      const typesResponse = await apiClient.get("v1/documents/types");
      const resignationType = (typesResponse.data.data as Array<{ id: number; code: string }>).find(
        (item) => item.code === "RESIGNATION",
      );
      if (!resignationType) {
        setTemplates([]);
        setTemplatesError(t("resignation_docs.template_load_error"));
        return;
      }
      const response = await apiClient.get("v1/documents/templates", {
        params: { document_type_id: resignationType.id, per_page: 100 },
        headers,
      });
      const published = (response.data.data as ResignationTemplate[]).filter(
        (template) => template.is_active
          && (template.latest_version?.is_published || template.latest_version?.published_version),
      );
      setTemplates(published);
      setSelectedTemplateId((current) => published.some((item) => item.id === current)
        ? current
        : (published.find((item) => item.is_default) ?? published[0])?.id ?? null);
    } catch (error: unknown) {
      setTemplates([]);
      setTemplatesError(getDocumentErrorMessage(error, t("resignation_docs.template_load_error")));
    } finally {
      setTemplatesLoading(false);
    }
  }, [canReadTemplates, hasEmpId, headers, t]);

  useEffect(() => {
    if (authLoading || !hasEmpId) return;
    void loadTemplates();
  }, [authLoading, hasEmpId, loadTemplates]);

  const templateItems = useMemo<SelectorItem[]>(() => templates.map((template) => ({
    id: template.id,
    label: template.name,
    sublabel: t("resignation_docs.template_version", {
      version: template.latest_version?.published_version ?? template.latest_version?.version_number ?? "-",
    }),
    badge: template.scope === "global" ? t("documents.global") : t("documents.house"),
  })), [templates, t]);

  const requestPreview = useCallback(async () => {
    if (!hasEmpId || !selectedTemplateId || !selectedHouseId) {
      setPreviewHtml("");
      return;
    }
    const requestId = ++previewRequestId.current;
    setPreviewLoading(true);
    setPreviewError("");
    try {
      const response = await apiClient.post("v1/documents/render/preview", {
        template_id: selectedTemplateId,
        employee_id: empId,
        document_data: {},
      }, { headers });
      if (requestId !== previewRequestId.current) return;
      setPreviewHtml(response.data.data.html || "");
    } catch (error: unknown) {
      if (requestId !== previewRequestId.current) return;
      setPreviewError(getDocumentErrorMessage(error, t("resignation_docs.preview_error")));
    } finally {
      if (requestId === previewRequestId.current) setPreviewLoading(false);
    }
  }, [empId, hasEmpId, headers, selectedHouseId, selectedTemplateId, t]);

  useEffect(() => {
    if (!hasEmpId || !selectedTemplateId) {
      setPreviewHtml("");
      return;
    }
    void requestPreview();
  }, [data, hasEmpId, requestPreview, selectedTemplateId]);

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

  const generationErrorMessage = useCallback((error: unknown) => {
    const code = getDocumentErrorCode(error);
    if (code === "IMAGE_SOURCE_MISSING") {
      // The api interceptor flattens structured details to a string, so use
      // the already-loaded document status to name the missing scans.
      const missingValues: unknown[] = Array.isArray(data?.missing) ? data.missing : [];
      const missing = missingValues.filter((item): item is string =>
        typeof item === "string" && ["resignation_letter", "nid", "employee_nid"].includes(item));
      const labelFor = (source: string) =>
        source === "resignation_letter"
          ? t("resignation_docs.resignation_letter")
          : source === "employee_nid" || source === "nid"
            ? t("resignation_docs.nid")
            : source;
      const sources = missing.length > 0
        ? missing.map(labelFor)
        : [t("resignation_docs.resignation_letter"), t("resignation_docs.nid")];
      return t("resignation_docs.error_image_source_missing", { sources: sources.join(", ") });
    }
    const errorKeys: Record<string, string> = {
      EMPLOYEE_NOT_RESIGNED: "error_not_resigned",
      RESIGNATION_LETTER_MISSING: "error_letter_missing",
      NID_MISSING: "error_nid_missing",
      LETTERHEAD_NOT_CONFIGURED: "error_letterhead_missing",
      RESIGNATION_FILE_MISSING: "error_file_missing",
      PDF_GENERATION_FAILED: "error_pdf_generation",
      AUDIENCE_MISMATCH: "error_audience_mismatch",
      DOCUMENT_TYPE_UNAVAILABLE: "error_document_type_unavailable",
      DOCUMENT_NOT_DRAFT: "error_document_not_draft",
      DOCUMENT_FIELDS_REQUIRED: "error_document_fields_required",
      TEMPLATE_FORBIDDEN: "error_template_forbidden",
      TEMPLATE_NOT_FOUND: "error_template_forbidden",
      TEMPLATE_MISSING: "error_template_forbidden",
      TEMPLATE_VERSION_MISSING: "error_template_forbidden",
      HOUSE_REQUIRED: "select_house",
      HOUSE_NOT_FOUND: "select_house",
      VERSION_NOT_FOUND: "error_pdf_generation",
      PDF_NOT_FOUND: "error_file_missing",
    };
    const key = errorKeys[code];
    return key
      ? t(`resignation_docs.${key}`)
      : getDocumentErrorMessage(error, t("resignation_docs.generate_failed"));
  }, [data, t]);

  const downloadGeneratedVersion = useCallback(async (documentId: number, versionNumber: number) => {
    setDownloadError("");
    try {
      const response = await apiClient.get(
        `v1/documents/${documentId}/versions/${versionNumber}/download`,
        { headers, responseType: "blob" },
      );
      const url = window.URL.createObjectURL(new Blob([response.data], { type: "application/pdf" }));
      const anchor = window.document.createElement("a");
      anchor.href = url;
      const filenamePart = (value: string | number) =>
        String(value).trim().replace(/[\/\\:*?"<>|]+/g, "_");
      const dmsCode = filenamePart(data?.employee?.dms_code || empId);
      const employeeName = filenamePart(data?.employee?.employee_name || "Employee");
      anchor.download = `${dmsCode}_${employeeName}_Resign_Letter_v${versionNumber}.pdf`;
      window.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
      setDownloadTarget(null);
      toast.success(t("resignation_docs.download_success"));
    } catch (error: unknown) {
      setDownloadTarget({ documentId, versionNumber });
      setDownloadError(getDocumentErrorMessage(error, t("resignation_docs.download_error")));
    }
  }, [data, empId, headers, t]);

  const generateDraftVersion = useCallback(async (draftId: number) => {
    const generated = await apiClient.post(`v1/documents/${draftId}/generate`, {}, { headers });
    const versionNumber = Number(generated.data.data.version.version_number);
    if (!Number.isFinite(versionNumber) || versionNumber < 1) {
      throw new Error("Missing generated version number");
    }
    setFailedDraftId(null);
    toast.success(t("resignation_docs.generate_success"));
    if (canDownloadDocument) await downloadGeneratedVersion(draftId, versionNumber);
  }, [canDownloadDocument, downloadGeneratedVersion, headers, t]);

  const generateAndDownload = async () => {
    if (!selectedTemplateId) {
      setGenerationError(t("resignation_docs.no_template_selected"));
      return;
    }
    if (!selectedHouseId) {
      setGenerationError(t("resignation_docs.select_house"));
      return;
    }
    if (!canCreateDocument || !canGenerateDocument) {
      setGenerationError(t("resignation_docs.generate_no_permission"));
      return;
    }
    setGenerating(true);
    setGenerationError("");
    setDownloadError("");
    setDownloadTarget(null);
    setFailedDraftId(null);
    let draftId: number | null = null;
    try {
      const draftResponse = await apiClient.post("v1/documents", {
        template_id: selectedTemplateId,
        employee_id: empId,
        document_data: {},
      }, { headers });
      draftId = Number(draftResponse.data.data.id);
      if (!Number.isFinite(draftId) || draftId < 1) {
        throw new Error("Missing draft id");
      }
      // The draft is audited immediately. If generation fails it stays here
      // and the user can retry without creating a second draft.
      setFailedDraftId(draftId);
      await generateDraftVersion(draftId);
    } catch (error: unknown) {
      if (draftId !== null) setFailedDraftId(draftId);
      const message = generationErrorMessage(error);
      setGenerationError(message);
      toast.error(message);
    } finally {
      setGenerating(false);
    }
  };

  const retryGeneration = async () => {
    if (failedDraftId === null || !canGenerateDocument) return;
    setGenerating(true);
    setGenerationError("");
    setDownloadError("");
    setDownloadTarget(null);
    try {
      await generateDraftVersion(failedDraftId);
    } catch (error: unknown) {
      setFailedDraftId(failedDraftId);
      const message = generationErrorMessage(error);
      setGenerationError(message);
      toast.error(message);
    } finally {
      setGenerating(false);
    }
  };

  if (authLoading || loading) {
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

  if (!hasPermission("employees.resignation_view")) {
    return <AccessDenied />;
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
        <PageHeader
          title={t("resignation_docs.page_title")}
          subtitle={t("resignation_docs.list_subtitle")}
          t={t}
          action={(
            <Link
              href="/employees"
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-200 dark:hover:bg-slate-800"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              {t("resignation_docs.open_employees")}
            </Link>
          )}
        />

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
      <PageHeader
        title={t("resignation_docs.page_title")}
        subtitle={t("resignation_docs.subtitle")}
        t={t}
        action={(
          <button
            type="button"
            onClick={() => router.back()}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-200 dark:hover:bg-slate-800"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            {t("common.back")}
          </button>
        )}
      />

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

      {/* Template + final preview: the uploaded scans stay the source of truth. */}
      <section className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 sm:p-6">
        <div className="flex min-w-0 flex-col gap-5 lg:flex-row lg:items-start">
          <div className="min-w-0 w-full lg:max-w-[360px]">
            <div className="flex min-w-0 items-start gap-3">
              <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-400">
                <LayoutTemplate aria-hidden="true" className="size-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t("resignation_docs.template_title")}
                </h2>
                <p className="mt-1 break-words text-sm text-gray-500 dark:text-gray-400">
                  {t("resignation_docs.template_description")}
                </p>
              </div>
            </div>

            <div className="mt-4">
              {!canReadTemplates ? (
                <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                  {t("resignation_docs.template_no_permission")}
                </p>
              ) : templatesLoading ? (
                <div role="status" aria-label={t("resignation_docs.template_loading")} className="animate-pulse">
                  <div className="h-4 w-32 rounded-md bg-gray-200 dark:bg-slate-700" />
                  <div className="mt-2 h-11 w-full rounded-xl bg-gray-100 dark:bg-slate-800" />
                </div>
              ) : templatesError ? (
                <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                  <p className="break-words">{templatesError}</p>
                  <button
                    type="button"
                    onClick={() => void loadTemplates()}
                    className="mt-2 inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-sm font-semibold hover:underline"
                  >
                    <RefreshCw aria-hidden="true" className="size-4" />
                    {t("resignation_docs.template_retry")}
                  </button>
                </div>
              ) : templates.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-300 p-4 text-sm dark:border-slate-600">
                  <p className="break-words text-gray-600 dark:text-gray-300">
                    {t("resignation_docs.template_empty")}
                  </p>
                  <Link
                    href="/documents/templates"
                    className="mt-2 inline-flex min-h-11 cursor-pointer items-center gap-1.5 font-semibold text-primary-600 hover:underline dark:text-primary-400"
                  >
                    <ExternalLink aria-hidden="true" className="size-4" />
                    {t("resignation_docs.template_manage")}
                  </Link>
                </div>
              ) : (
                <EntitySelector
                  label={t("resignation_docs.template_label")}
                  items={templateItems}
                  selectedIds={selectedTemplateId === null ? [] : [selectedTemplateId]}
                  onChange={(ids) => {
                    const value = Number(ids[0]);
                    setSelectedTemplateId(ids.length > 0 && Number.isFinite(value) ? value : null);
                  }}
                  single
                  closeOnSelect
                  showSelectAll={false}
                  disabled={!canReadTemplates}
                  placeholder={t("resignation_docs.template_placeholder")}
                  searchPlaceholder={t("resignation_docs.template_search")}
                  emptyMessage={t("resignation_docs.template_empty")}
                  noResultsMessage={t("resignation_docs.template_no_results")}
                  selectedLabel={t("resignation_docs.template_selected_label")}
                  clearLabel={t("common.clear")}
                />
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void requestPreview()}
                disabled={!canReadTemplates || !selectedTemplateId || !selectedHouseId || previewLoading}
                className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-200 dark:hover:bg-slate-800"
              >
                <RefreshCw aria-hidden="true" className={`size-4 ${previewLoading ? "animate-spin motion-reduce:animate-none" : ""}`} />
                {t("resignation_docs.preview_action")}
              </button>
              {selectedTemplateId && hasPermission("documents.templates.view") && (
                <Link
                  href={`/documents/templates/${selectedTemplateId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-primary-600 hover:bg-primary-50 dark:text-primary-400 dark:hover:bg-primary-500/10"
                >
                  <ExternalLink aria-hidden="true" className="size-4" />
                  {t("resignation_docs.open_template")}
                </Link>
              )}
            </div>

            {!selectedHouseId && (
              <p className="mt-2 break-words text-xs text-gray-500 dark:text-gray-400">
                {t("resignation_docs.select_house")}
              </p>
            )}
            {previewLoading && (
              <p role="status" className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {t("resignation_docs.preview_loading")}
              </p>
            )}
            {previewError && (
              <p role="alert" className="mt-2 break-words text-xs text-red-600 dark:text-red-400">
                {previewError}
              </p>
            )}
          </div>

          <div className="min-w-0 w-full flex-1">
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-slate-800">
              <iframe
                title={t("resignation_docs.preview_frame_title")}
                srcDoc={previewHtml}
                sandbox=""
                referrerPolicy="no-referrer"
                className="h-[360px] w-full bg-white sm:h-[420px]"
              />
            </div>
            {!previewHtml && !previewLoading && !previewError && (
              <p className="mt-2 break-words text-xs text-gray-500 dark:text-gray-400">
                {t("resignation_docs.preview_empty")}
              </p>
            )}
          </div>
        </div>
      </section>

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
      <section className="min-w-0 rounded-2xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 sm:p-6">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {t("resignation_docs.actions_title")}
            </h2>
            <p className="mt-1 break-words text-xs text-gray-500 dark:text-gray-400">
              {t("resignation_docs.actions_description")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void generateAndDownload()}
            disabled={
              !data.can_generate
              || generating
              || !hasPermission("employees.resignation_generate")
              || !canCreateDocument
              || !canGenerateDocument
              || !selectedTemplateId
              || !selectedHouseId
            }
            className={cn(
              "inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold transition-colors disabled:cursor-not-allowed sm:w-auto",
              data.can_generate
                && hasPermission("employees.resignation_generate")
                && canCreateDocument
                && canGenerateDocument
                && selectedTemplateId
                && selectedHouseId
                ? "bg-primary-600 text-white hover:bg-primary-700"
                : "bg-gray-200 text-gray-500 dark:bg-slate-700 dark:text-gray-400",
            )}
          >
            {generating ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
            ) : (
              <Download aria-hidden="true" className="size-4" />
            )}
            {t(generating ? "resignation_docs.generating" : "resignation_docs.generate_pdf")}
          </button>
        </div>

        {generationError && (
          <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            <p className="break-words">{generationError}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {failedDraftId !== null && canGenerateDocument && (
                <button
                  type="button"
                  onClick={() => void retryGeneration()}
                  disabled={generating}
                  className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 font-semibold hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw aria-hidden="true" className="size-4" />
                  {t("resignation_docs.retry_generate")}
                </button>
              )}
              {failedDraftId !== null && hasPermission("documents.view") && (
                <Link
                  href={`/documents/${failedDraftId}`}
                  className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 font-semibold hover:underline"
                >
                  <ExternalLink aria-hidden="true" className="size-4" />
                  {t("resignation_docs.open_draft")}
                </Link>
              )}
            </div>
          </div>
        )}

        {downloadError && downloadTarget && (
          <div role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <p className="break-words">{downloadError}</p>
            <button
              type="button"
              onClick={() => void downloadGeneratedVersion(downloadTarget.documentId, downloadTarget.versionNumber)}
              className="mt-2 inline-flex min-h-11 cursor-pointer items-center gap-1.5 font-semibold hover:underline"
            >
              <RefreshCw aria-hidden="true" className="size-4" />
              {t("resignation_docs.retry_download")}
            </button>
          </div>
        )}
      </section>

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