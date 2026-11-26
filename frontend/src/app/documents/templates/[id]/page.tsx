"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Home,
  RefreshCw,
} from "lucide-react";
import PageGuideModal from "@/components/PageGuideModal";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import apiClient from "@/lib/api";
import { getDocumentErrorMessage } from "@/lib/documents";
import TemplateDeleteButton from "../_components/TemplateDeleteButton";
import OptionsPanel from "./_components/OptionsPanel";
import {
  EMPTY_AST,
  splitPages,
  type DocumentAst,
  type TemplateAsset,
  type TemplateInfo,
  type TemplateVersion,
  type VariableField,
  type VariableOption,
} from "./_components/editorTypes";
import type { SelectorItem } from "@/app/zoom-in/_components/EntitySelector";

interface DocumentEmployee {
  id: number;
  employee_name: string;
  dms_code: string | null;
  employee_id: string | null;
  itop_number: string | null;
  employee_type: string | null;
  house_id: number | null;
}

function parseTemplateId(value: string | string[] | undefined): number | null {
  const id = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export default function DocumentTemplateEditorPage() {
  const { t } = useLanguage();
  const { hasPermission, loading: authLoading, selectedHouse, user } = useAuth();
  const selectedHouseId = selectedHouse?.id;
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const templateId = parseTemplateId(params.id);
  const handleTemplateDeleted = useCallback(
    () => router.replace("/documents/templates"),
    [router],
  );
  const canView = hasPermission("documents.templates.view");
  const canManage = hasPermission("documents.templates.manage");
  const isSuperAdmin = Boolean(user?.roles?.some((role) => {
    const roleName = role.name.toLowerCase();
    return roleName === "super admin" || roleName === "super_admin";
  }));
  const headers = useMemo<Record<string, string>>(() => {
    const result: Record<string, string> = {};
    if (selectedHouseId) result["X-House-ID"] = String(selectedHouseId);
    return result;
  }, [selectedHouseId]);

  const [template, setTemplate] = useState<TemplateInfo | null>(null);
  const [ast, setAst] = useState<DocumentAst>(EMPTY_AST);
  const [fields, setFields] = useState<VariableField[]>([]);
  const [variables, setVariables] = useState<VariableOption[]>([]);
  const [versions, setVersions] = useState<TemplateVersion[]>([]);
  const [assets, setAssets] = useState<TemplateAsset[]>([]);
  const [sourceVersion, setSourceVersion] = useState<number | null>(null);
  const [selectedPage, setSelectedPage] = useState(0);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [versionNotes, setVersionNotes] = useState("");
  const [previewValues] = useState<Record<string, string>>({});
  const [liveHtml, setLiveHtml] = useState("");
  const [savedHtml, setSavedHtml] = useState("");
  const [previewMode, setPreviewMode] = useState<"live" | "saved">("live");
  const [liveError, setLiveError] = useState("");
  const [savedError, setSavedError] = useState("");
  const [missingImages, setMissingImages] = useState<string[]>([]);
  const [employees, setEmployees] = useState<DocumentEmployee[]>([]);
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);
  const [assetUploadError, setAssetUploadError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const previewRequest = useRef(0);

  const loadVersions = useCallback(async () => {
    if (!templateId) return [] as TemplateVersion[];
    const response = await apiClient.get(`v1/documents/templates/${templateId}/versions`, { headers });
    const rows = response.data.data as TemplateVersion[];
    setVersions(rows);
    return rows;
  }, [headers, templateId]);

  const loadAssets = useCallback(async () => {
    if (!templateId) return;
    try {
      const response = await apiClient.get(`v1/documents/templates/${templateId}/assets`, { headers });
      setAssets(response.data.data as TemplateAsset[]);
    } catch {
      // Asset listing is optional for read-only users; the editor still renders.
    }
  }, [headers, templateId]);

  const loadTemplate = useCallback(async () => {
    if (!templateId) {
      setLoading(false);
      setErrorMessage(t("document_template_editor.load_error"));
      return;
    }
    setLoading(true);
    setErrorMessage("");
    try {
      const [templateResponse, variablesResponse] = await Promise.all([
        apiClient.get(`v1/documents/templates/${templateId}`, { headers }),
        apiClient.get("v1/documents/variables"),
      ]);
      const loaded = templateResponse.data.data as TemplateInfo;
      setTemplate(loaded);
      setVariables(variablesResponse.data.data);
      await Promise.all([loadVersions(), loadAssets()]);
      const latestVersion = loaded.latest_version?.version_number;
      if (latestVersion) {
        const versionResponse = await apiClient.get(
          `v1/documents/templates/${templateId}/versions/${latestVersion}`,
          { headers },
        );
        const version = versionResponse.data.data;
        setAst(version.content_json);
        setFields(version.variables_schema?.fields || []);
        setSourceVersion(latestVersion);
        setSelectedBlockId(version.content_json.blocks[0]?.id || null);
      } else {
        setAst(loaded.content_json || EMPTY_AST);
        setFields([]);
        setSourceVersion(null);
        setSelectedBlockId(loaded.content_json?.blocks?.[0]?.id || null);
      }
      setSelectedPage(0);
    } catch (error: unknown) {
      setErrorMessage(getDocumentErrorMessage(error, t("document_template_editor.load_error")));
    } finally {
      setLoading(false);
    }
  }, [headers, loadAssets, loadVersions, t, templateId]);

  useEffect(() => {
    if (authLoading || !canView) return;
    void loadTemplate();
  }, [authLoading, canView, loadTemplate]);

  // Live unsaved preview: never writes a version or an audit row.
  useEffect(() => {
    if (!template || loading || !templateId) return;
    const requestId = ++previewRequest.current;
    const timer = window.setTimeout(() => {
      apiClient.post("v1/documents/render/preview-ast", {
        template_id: templateId,
        content_json: ast,
        variables_schema: { fields },
        employee_id: selectedEmployeeId,
        document_data: previewValues,
      }, { headers })
        .then((response) => {
          if (requestId !== previewRequest.current) return;
          const data = response.data.data;
          setLiveHtml(data.html || "");
          setMissingImages(Array.isArray(data.missing_images) ? data.missing_images : []);
          setLiveError("");
        })
        .catch((error: unknown) => {
          if (requestId !== previewRequest.current) return;
          setLiveError(getDocumentErrorMessage(error, t("document_template_editor.preview_error")));
        });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [ast, fields, headers, loading, previewValues, refreshToken, selectedEmployeeId, t, template, templateId]);

  // Preview employee search is preview-only and never stored in the template.
  useEffect(() => {
    if (employeeQuery.trim().length < 2 || !selectedHouseId) {
      setEmployees([]);
      return;
    }
    const timer = window.setTimeout(() => {
      apiClient.get("v1/documents/employees/search", {
        params: { q: employeeQuery.trim(), limit: 20 },
        headers,
      })
        .then((response) => setEmployees(response.data.data as DocumentEmployee[]))
        .catch(() => setEmployees([]));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [employeeQuery, headers, selectedHouseId]);

  if (!authLoading && !canView) return <AccessDenied />;

  const globalReadOnly = template?.scope === "global" && !isSuperAdmin;
  const editable = canManage && !globalReadOnly;
  const pages = splitPages(ast.blocks);
  const pageCount = Math.max(1, pages.length);
  const currentPage = Math.min(selectedPage + 1, pageCount);
  const selectedAudience = ast.audience ?? "all";

  const employeeItems: SelectorItem[] = employees
    .filter((employee) => selectedAudience === "all"
      || employee.employee_type === selectedAudience)
    .map((employee) => ({
      id: employee.id,
      label: employee.employee_name,
      sublabel: [employee.dms_code, employee.itop_number].filter(Boolean).join(" · "),
    }));

  const loadSavedPreview = async (versionNumber: number) => {
    if (!templateId) return;
    setSavedError("");
    try {
      const response = await apiClient.post("v1/documents/render/preview", {
        template_id: templateId,
        version_number: versionNumber,
        document_data: previewValues,
      }, { headers });
      setSavedHtml(response.data.data.html || "");
      setPreviewMode("saved");
    } catch (error: unknown) {
      setSavedError(getDocumentErrorMessage(error, t("document_template_editor.preview_error")));
    }
  };

  const loadSavedVersion = async (versionNumber: number) => {
    if (!templateId) return;
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const response = await apiClient.get(
        `v1/documents/templates/${templateId}/versions/${versionNumber}`,
        { headers },
      );
      const version = response.data.data;
      setAst(version.content_json);
      setFields(version.variables_schema?.fields || []);
      setSourceVersion(versionNumber);
      setSelectedBlockId(version.content_json.blocks[0]?.id || null);
      setSelectedPage(0);
      await loadSavedPreview(versionNumber);
    } catch (error: unknown) {
      setErrorMessage(getDocumentErrorMessage(error, t("document_template_editor.load_error")));
    }
  };

  const saveVersion = async (publish: boolean) => {
    if (!templateId || !editable) return;
    setSaving(true);
    setErrorMessage("");
    setSuccessMessage("");
    setLiveError("");
    try {
      const response = await apiClient.post(
        `v1/documents/templates/${templateId}/versions`,
        {
          content_json: ast,
          variables_schema: { fields },
          version_notes: versionNotes || null,
          publish,
        },
        { headers },
      );
      const saved = response.data.data as TemplateVersion;
      setSourceVersion(saved.version_number);
      setVersionNotes("");
      await loadVersions();
      setSuccessMessage(publish
        ? t("document_template_editor.published_success")
        : t("document_template_editor.saved"));
      await loadSavedPreview(saved.version_number);
    } catch (error: unknown) {
      setErrorMessage(getDocumentErrorMessage(error, t(
        publish ? "document_template_editor.publish_error" : "document_template_editor.save_error",
      )));
    } finally {
      setSaving(false);
    }
  };

  const publishVersion = async (versionNumber: number) => {
    if (!templateId || !editable) return;
    setSaving(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await apiClient.post(
        `v1/documents/templates/${templateId}/versions/${versionNumber}/publish`,
        {},
        { headers },
      );
      await loadVersions();
      setSuccessMessage(t("document_template_editor.published_success"));
    } catch (error: unknown) {
      setErrorMessage(getDocumentErrorMessage(error, t("document_template_editor.publish_error")));
    } finally {
      setSaving(false);
    }
  };

  const uploadAsset = async (file: File): Promise<boolean> => {
    if (!templateId || !editable) return false;
    setAssetUploadError("");
    const body = new FormData();
    body.append("file", file);
    try {
      await apiClient.post(`v1/documents/templates/${templateId}/assets`, body, { headers });
      await loadAssets();
      setRefreshToken((value) => value + 1);
      return true;
    } catch (error: unknown) {
      setAssetUploadError(getDocumentErrorMessage(error, t("document_template_editor.asset_upload_error")));
      return false;
    }
  };

  const deleteAsset = async (assetId: number) => {
    if (!templateId || !editable) return;
    setAssetUploadError("");
    try {
      await apiClient.delete(`v1/documents/templates/${templateId}/assets/${assetId}`, { headers });
      setAst((current) => ({
        ...current,
        blocks: current.blocks.map((block) =>
          block.type === "image" && block.asset_id === assetId
            ? { ...block, asset_id: null }
            : block),
      }));
      await loadAssets();
      setRefreshToken((value) => value + 1);
    } catch (error: unknown) {
      setAssetUploadError(getDocumentErrorMessage(error, t("document_template_editor.asset_upload_error")));
    }
  };

  const selectPage = (index: number) => {
    setSelectedPage(index);
    const nextPage = splitPages(ast.blocks)[index] ?? [];
    const firstEditable = nextPage.find((block) => block.type !== "page_break");
    setSelectedBlockId(firstEditable?.id ?? null);
  };

  const previewHtml = previewMode === "live" ? liveHtml : savedHtml;
  const previewErrorMessage = previewMode === "live" ? liveError : savedError;

  return (
    <div className="space-y-4">
      <nav aria-label={t("document_template_editor.breadcrumb_label")} className="text-[13px]">
        <ol className="flex flex-wrap items-center gap-1.5 text-gray-500 dark:text-gray-400">
          <li>
            <Link href="/" className="inline-flex min-h-11 items-center gap-1.5 transition-colors hover:text-gray-700 dark:hover:text-gray-200">
              <Home aria-hidden="true" className="size-4" />
              {t("document_template_editor.breadcrumb_home")}
            </Link>
          </li>
          <li aria-hidden="true"><ChevronRight className="size-3.5" /></li>
          <li>{t("document_template_editor.breadcrumb_documents")}</li>
          <li aria-hidden="true"><ChevronRight className="size-3.5" /></li>
          <li>
            <Link href="/documents/templates" className="inline-flex min-h-11 items-center transition-colors hover:text-gray-700 dark:hover:text-gray-200">
              {t("document_template_editor.breadcrumb_templates")}
            </Link>
          </li>
          <li aria-hidden="true"><ChevronRight className="size-3.5" /></li>
          <li aria-current="page" className="font-medium text-gray-700 dark:text-gray-300">
            {t("document_template_editor.title")}
          </li>
        </ol>
      </nav>
      <header className="border-b border-gray-200 pb-4 dark:border-slate-700">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-950/40 dark:text-primary-300">
              <FileText aria-hidden="true" className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {t("document_template_editor.title")}
                </h1>
                <PageGuideModal pageKey="document_template_editor" />
              </div>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {t("document_template_editor.subtitle")}
              </p>
            </div>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <Link href="/documents/templates" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-gray-200 dark:hover:bg-slate-800">
              {t("common.back")}
            </Link>
            {template && (
              <TemplateDeleteButton
                templateId={template.id}
                templateName={template.name}
                scope={template.scope}
                isDefault={template.is_default}
                canManage={canManage}
                isSuperAdmin={isSuperAdmin}
                headers={headers}
                onDeleted={handleTemplateDeleted}
                variant="full"
              />
            )}
          </div>
        </div>
      </header>

      {errorMessage && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{errorMessage}</p>}
      {successMessage && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">{successMessage}</p>}
      {!selectedHouseId && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{t("document_template_editor.select_house")}</p>}

      {loading ? (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="order-2 h-[720px] animate-pulse rounded-2xl bg-gray-100 dark:bg-slate-800 lg:order-1" />
          <div className="order-1 h-[720px] animate-pulse rounded-2xl bg-gray-100 dark:bg-slate-800 lg:order-2" />
        </div>
      ) : !template ? (
        <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
          {errorMessage || t("document_template_editor.load_error")}
        </p>
      ) : (
        <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="order-2 min-w-0 space-y-3 lg:order-1">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-gray-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900 sm:p-4">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-bold text-gray-900 dark:text-gray-100">
                  {t("document_template_editor.live_preview")}
                </h2>
                <p className="truncate text-xs text-gray-500 dark:text-gray-400">{template.name}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPreviewMode("live")}
                  className={`min-h-11 cursor-pointer rounded-lg px-3 text-xs font-semibold ${
                    previewMode === "live"
                      ? "bg-primary-600 text-white"
                      : "border border-gray-200 text-gray-700 dark:border-slate-700 dark:text-gray-200"
                  }`}
                >
                  {t("document_template_editor.live_preview")}
                </button>
                <button
                  type="button"
                  onClick={() => sourceVersion && void loadSavedPreview(sourceVersion)}
                  disabled={!sourceVersion}
                  className={`min-h-11 cursor-pointer rounded-lg px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
                    previewMode === "saved"
                      ? "bg-primary-600 text-white"
                      : "border border-gray-200 text-gray-700 dark:border-slate-700 dark:text-gray-200"
                  }`}
                >
                  {t("document_template_editor.saved_preview")}
                </button>
                <button
                  type="button"
                  onClick={() => setRefreshToken((value) => value + 1)}
                  title={t("document_template_editor.refresh_preview")}
                  aria-label={t("document_template_editor.refresh_preview")}
                  className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:text-gray-300 dark:hover:bg-slate-800"
                >
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                </button>
                <div className="flex items-center gap-0.5 rounded-lg border border-gray-200 p-0.5 dark:border-slate-700">
                  <button
                    type="button"
                    onClick={() => selectPage(Math.max(0, selectedPage - 1))}
                    disabled={currentPage <= 1}
                    aria-label={t("common.prev")}
                    title={t("common.prev")}
                    className="min-h-11 min-w-11 cursor-pointer rounded-lg text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-300 dark:hover:bg-slate-800"
                  >
                    <ChevronLeft className="mx-auto h-4 w-4" aria-hidden="true" />
                  </button>
                  <span className="min-w-20 px-1 text-center text-xs font-semibold text-gray-700 dark:text-gray-200">
                    {t("document_template_editor.page_counter", { current: currentPage, total: pageCount })}
                  </span>
                  <button
                    type="button"
                    onClick={() => selectPage(Math.min(pageCount - 1, selectedPage + 1))}
                    disabled={currentPage >= pageCount}
                    aria-label={t("common.next")}
                    title={t("common.next")}
                    className="min-h-11 min-w-11 cursor-pointer rounded-lg text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-300 dark:hover:bg-slate-800"
                  >
                    <ChevronRight className="mx-auto h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>

            {missingImages.length > 0 && previewMode === "live" && (
              <p role="status" className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                {t("document_template_editor.missing_images", { sources: missingImages.join(", ") })}
              </p>
            )}

            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-100 p-3 dark:border-slate-700 dark:bg-slate-950 sm:p-6">
              {previewErrorMessage ? (
                <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
                  {previewErrorMessage}
                </p>
              ) : previewHtml ? (
                <iframe
                  title={t("document_template_editor.live_preview")}
                  srcDoc={previewHtml}
                  sandbox=""
                  className="mx-auto aspect-[210/297] w-full min-w-0 max-w-[794px] bg-white shadow-lg"
                />
              ) : (
                <div className="flex min-h-96 items-center justify-center rounded-xl bg-white p-6 text-center text-sm text-gray-500 dark:bg-slate-900 dark:text-gray-400">
                  {t("document_template_editor.preview_loading")}
                </div>
              )}
            </div>
          </section>

          <div className="order-1 min-w-0 lg:order-2">
            <OptionsPanel
              template={template}
              ast={ast}
              fields={fields}
              variables={variables}
              versions={versions}
              sourceVersion={sourceVersion}
              assets={assets}
              employeeItems={employeeItems}
              employeeQuery={employeeQuery}
              selectedEmployeeId={selectedEmployeeId}
              onEmployeeSearchChange={setEmployeeQuery}
              onSelectEmployee={setSelectedEmployeeId}
              selectedPage={selectedPage}
              onSelectPage={selectPage}
              selectedBlockId={selectedBlockId}
              onSelectBlock={setSelectedBlockId}
              onAstChange={setAst}
              onFieldsChange={setFields}
              versionNotes={versionNotes}
              onVersionNotesChange={setVersionNotes}
              onSave={(publish) => void saveVersion(publish)}
              onPublishVersion={(versionNumber) => void publishVersion(versionNumber)}
              onLoadVersion={(versionNumber) => void loadSavedVersion(versionNumber)}
              onUploadAsset={uploadAsset}
              onDeleteAsset={deleteAsset}
              uploadError={assetUploadError}
              editable={editable}
              saving={saving}
              globalReadOnly={globalReadOnly}
              canManage={canManage}
            />
          </div>
        </div>
      )}
    </div>
  );
}
