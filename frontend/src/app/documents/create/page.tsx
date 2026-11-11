"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Download, FilePlus2, RefreshCw, Search } from "lucide-react";
import PageGuideModal from "@/components/PageGuideModal";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import apiClient from "@/lib/api";

interface DocumentType {
  id: number;
  name: string;
  name_bn: string | null;
}

interface Template {
  id: number;
  document_type_id: number;
  name: string;
  is_active: boolean;
  latest_version: {
    published_version?: number;
    is_published: boolean;
  } | null;
}

interface VariableField {
  key: string;
  label: string;
  label_bn?: string;
  type: string;
  required: boolean;
  readonly: boolean;
  default?: string;
  options?: string[];
  source?: string;
}

interface EmployeeResult {
  id: number;
  employee_name: string | null;
  dms_code: string | null;
  employee_id: string | null;
  itop_number: string | null;
  employee_type: string | null;
}

const fieldClass =
  "min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-primary-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100";

function getErrorMessage(error: unknown, fallback: string): string {
  if (typeof error !== "object" || error === null || !("response" in error)) return fallback;
  const response = error.response;
  if (typeof response !== "object" || response === null || !("data" in response)) return fallback;
  const data = response.data;
  if (typeof data !== "object" || data === null || !("detail" in data)) return fallback;
  const detail = data.detail;
  if (typeof detail === "string") return detail;
  if (typeof detail === "object" && detail !== null && "message" in detail && typeof detail.message === "string") {
    return detail.message;
  }
  return fallback;
}

function todayInBangladesh(): string {
  return new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default function CreateDocumentPage() {
  const { t, language } = useLanguage();
  const { hasPermission, loading: authLoading, selectedHouse } = useAuth();
  const selectedHouseId = selectedHouse?.id;
  const canCreate = hasPermission("documents.create");
  const canDownload = hasPermission("documents.download");
  const headers = useMemo(
    () => selectedHouseId ? { "X-House-ID": String(selectedHouseId) } : {},
    [selectedHouseId],
  );
  const [types, setTypes] = useState<DocumentType[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTypeId, setSelectedTypeId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [fields, setFields] = useState<VariableField[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [employeeResults, setEmployeeResults] = useState<EmployeeResult[]>([]);
  const [employee, setEmployee] = useState<EmployeeResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [draftId, setDraftId] = useState<number | null>(null);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const [downloadTarget, setDownloadTarget] = useState<{ documentId: number; versionNumber: number } | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const previewRequestId = useRef(0);

  const loadTypes = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const response = await apiClient.get("v1/documents/types");
      setTypes(response.data.data);
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error, t("document_create.load_error")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (authLoading || !canCreate || !selectedHouseId) {
      setLoading(false);
      return;
    }
    void loadTypes();
  }, [authLoading, canCreate, selectedHouseId, loadTypes]);

  useEffect(() => {
    if (!selectedTypeId || !selectedHouseId) {
      setTemplates([]);
      setTemplateId("");
      setFields([]);
      return;
    }
    let active = true;
    setLoading(true);
    setErrorMessage("");
    apiClient.get("v1/documents/templates", {
      params: { document_type_id: selectedTypeId, per_page: 100 },
      headers,
    }).then((response) => {
      if (!active) return;
      const publishedTemplates = (response.data.data as Template[]).filter(
        (template) => template.is_active
          && (template.latest_version?.is_published || template.latest_version?.published_version),
      );
      setTemplates(publishedTemplates);
      setTemplateId(publishedTemplates[0] ? String(publishedTemplates[0].id) : "");
    }).catch((error: unknown) => {
      if (active) setErrorMessage(getErrorMessage(error, t("document_create.load_error")));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [headers, selectedHouseId, selectedTypeId, t]);

  useEffect(() => {
    if (!templateId) {
      setFields([]);
      setValues({});
      setPreviewHtml("");
      setDraftId(null);
      return;
    }
    let active = true;
    setSchemaLoading(true);
    setErrorMessage("");
    setSuccessMessage("");
    apiClient.get(`v1/documents/templates/${templateId}/schema`, { headers }).then((response) => {
      if (!active) return;
      const schemaFields = (response.data.data.variables_schema?.fields || []) as VariableField[];
      setFields(schemaFields);
      const initial: Record<string, string> = {};
      for (const field of schemaFields) {
        initial[field.key] = field.default || "";
      }
      if (schemaFields.some((field) => field.key === "document_date")) {
        initial.document_date = todayInBangladesh();
      }
      setValues(initial);
      setDraftId(null);
    }).catch((error: unknown) => {
      if (active) setErrorMessage(getErrorMessage(error, t("document_create.load_error")));
    }).finally(() => {
      if (active) setSchemaLoading(false);
    });
    return () => { active = false; };
  }, [headers, templateId, t]);

  useEffect(() => {
    if (employeeQuery.trim().length < 2 || !selectedHouseId) {
      setEmployeeResults([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      apiClient.get("v1/documents/employees/search", {
        params: { q: employeeQuery.trim(), limit: 15 },
        headers,
      }).then((response) => {
        if (active) setEmployeeResults(response.data.data);
      }).catch((error: unknown) => {
        if (active) setErrorMessage(getErrorMessage(error, t("document_create.employee_search_error")));
      });
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [employeeQuery, headers, selectedHouseId, t]);

  const requestPreview = useCallback(async () => {
    if (!templateId || !selectedHouseId || schemaLoading) {
      setPreviewHtml("");
      return;
    }
    const requestId = ++previewRequestId.current;
    setPreviewLoading(true);
    setPreviewError("");
    try {
      const response = await apiClient.post("v1/documents/render/preview", {
        template_id: Number(templateId),
        employee_id: employee?.id || null,
        document_data: values,
      }, { headers });
      if (previewRequestId.current === requestId) {
        setPreviewHtml(response.data.data.html);
      }
    } catch (error: unknown) {
      if (previewRequestId.current === requestId) {
        setPreviewError(getErrorMessage(error, t("document_create.preview_error")));
      }
    } finally {
      if (previewRequestId.current === requestId) setPreviewLoading(false);
    }
  }, [employee, headers, schemaLoading, selectedHouseId, templateId, t, values]);

  useEffect(() => {
    if (!templateId || schemaLoading) return;
    const timer = window.setTimeout(() => void requestPreview(), 500);
    return () => window.clearTimeout(timer);
  }, [requestPreview, schemaLoading, templateId]);

  const chooseEmployee = async (item: EmployeeResult) => {
    setEmployee(item);
    setEmployeeQuery(item.employee_name || item.dms_code || "");
    setEmployeeResults([]);
    setErrorMessage("");
    try {
      const response = await apiClient.get(`v1/documents/employees/${item.id}`, { headers });
      const employeeData = response.data.data as Record<string, unknown>;
      setValues((current) => {
        const next = { ...current };
        for (const field of fields) {
          if (field.source?.startsWith("employee.") && !field.readonly) {
            delete next[field.key];
          }
        }
        for (const field of fields) {
          if (field.source?.startsWith("employee.") && !field.readonly) {
            const key = field.source.slice("employee.".length);
            const employeeValue = employeeData[key];
            if (employeeValue !== null && employeeValue !== undefined && String(employeeValue).trim()) {
              next[field.key] = String(employeeValue);
            }
          }
        }
        return next;
      });
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error, t("document_create.employee_search_error")));
    }
  };

  const persistDraft = async (): Promise<number | null> => {
    if (!templateId) {
      setErrorMessage(t("document_create.select_template"));
      return null;
    }
    const payload = {
      template_id: Number(templateId),
      employee_id: employee?.id || null,
      document_data: values,
    };
    try {
      const response = draftId
        ? await apiClient.patch(`v1/documents/${draftId}`, payload, { headers })
        : await apiClient.post("v1/documents", payload, { headers });
      const id = response.data.data.id as number;
      setDraftId(id);
      return id;
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error, t("document_create.save_error")));
      return null;
    }
  };

  const saveDraft = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setErrorMessage("");
    setSuccessMessage("");
    const id = await persistDraft();
    if (id !== null) setSuccessMessage(t("document_create.draft_saved"));
    setSaving(false);
  };

  const downloadGeneratedVersion = async (documentId: number, versionNumber: number) => {
    setDownloadError("");
    try {
      const response = await apiClient.get(
        `v1/documents/${documentId}/versions/${versionNumber}/download`,
        { headers, responseType: "blob" },
      );
      const url = window.URL.createObjectURL(response.data);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = `document-${documentId}-v${versionNumber}.pdf`;
      anchor.click();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
      setDownloadTarget(null);
    } catch (error: unknown) {
      setDownloadTarget({ documentId, versionNumber });
      setDownloadError(getErrorMessage(error, t("document_create.download_error")));
    }
  };

  const generate = async () => {
    if (!selectedHouseId) {
      setErrorMessage(t("document_create.select_house"));
      return;
    }
    setGenerating(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const id = await persistDraft();
      if (id === null) return;
      const response = await apiClient.post(`v1/documents/${id}/generate`, {}, { headers });
      const versionNumber = response.data.data.version.version_number as number;
      setDraftId(id);
      setSuccessMessage(t("document_create.generate_success"));
      if (canDownload) {
        setDownloadTarget({ documentId: id, versionNumber });
        await downloadGeneratedVersion(id, versionNumber);
      }
    } catch (error: unknown) {
      setErrorMessage(getErrorMessage(error, t("document_create.generate_error")));
    } finally {
      setGenerating(false);
    }
  };

  const displayLabel = (field: VariableField) => (
    language === "bn" ? field.label_bn || field.label : field.label
  );

  if (!authLoading && !canCreate) return <AccessDenied />;

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-2.5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400">
          <FilePlus2 className="h-5 w-5" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t("document_create.title")}</h1>
        <PageGuideModal pageKey="document_create" />
      </header>

      {!selectedHouseId && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{t("document_create.select_house")}</p>}
      {errorMessage && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{errorMessage}</p>}
      {successMessage && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">{successMessage}</p>}
      {downloadError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          <span>{downloadError}</span>
          {downloadTarget && (
            <button
              type="button"
              onClick={() => void downloadGeneratedVersion(downloadTarget.documentId, downloadTarget.versionNumber)}
              className="min-h-11 cursor-pointer rounded-lg px-3 font-semibold underline"
            >
              {t("document_create.retry_download")}
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.9fr)]">
        <form onSubmit={saveDraft} className="space-y-5 rounded-2xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 sm:p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("document_create.document_type")}
              <select
                value={selectedTypeId}
                onChange={(event) => {
                  setSelectedTypeId(event.target.value);
                  setDraftId(null);
                }}
                disabled={loading || !types.length}
                className={`${fieldClass} cursor-pointer disabled:cursor-not-allowed`}
              >
                <option value="">{t("document_create.choose_type")}</option>
                {types.map((type) => <option key={type.id} value={type.id}>{language === "bn" ? type.name_bn || type.name : type.name}</option>)}
              </select>
            </label>
            <label className="space-y-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("document_create.template")}
              <select
                value={templateId}
                onChange={(event) => {
                  setTemplateId(event.target.value);
                  setDraftId(null);
                }}
                disabled={loading || !templates.length}
                className={`${fieldClass} cursor-pointer disabled:cursor-not-allowed`}
              >
                <option value="">{t("document_create.choose_template")}</option>
                {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
            </label>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="document-employee-search" className="text-sm font-medium text-gray-700 dark:text-gray-300">{t("document_create.employee")}</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                id="document-employee-search"
                type="search"
                value={employeeQuery}
                onChange={(event) => {
                  setEmployeeQuery(event.target.value);
                  setEmployee(null);
                  setValues((current) => {
                    const next = { ...current };
                    for (const field of fields) {
                      if (field.source?.startsWith("employee.") && !field.readonly) {
                        delete next[field.key];
                      }
                    }
                    return next;
                  });
                }}
                placeholder={t("document_create.employee_search")}
                className={`${fieldClass} cursor-text pl-10`}
              />
            </div>
            {employeeResults.length > 0 && (
              <div className="max-h-56 overflow-y-auto rounded-xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                {employeeResults.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void chooseEmployee(item)}
                    className="flex min-h-11 w-full cursor-pointer flex-col items-start border-b border-gray-100 px-3 py-2 text-left last:border-0 hover:bg-gray-50 dark:border-slate-800 dark:hover:bg-slate-800"
                  >
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.employee_name || item.dms_code || `#${item.id}`}</span>
                    <span className="text-[11px] text-gray-500 dark:text-gray-400">{[item.dms_code, item.itop_number, item.employee_type?.toUpperCase()].filter(Boolean).join(" · ")}</span>
                  </button>
                ))}
              </div>
            )}
            {employee && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-800 dark:bg-sky-950/30 dark:text-sky-200">
                <span>{employee.employee_name} · {employee.dms_code || employee.employee_id}</span>
                <button type="button" onClick={() => { setEmployee(null); setEmployeeQuery(""); }} className="min-h-9 cursor-pointer px-2 text-xs font-semibold">{t("document_create.clear_employee")}</button>
              </div>
            )}
          </div>

          {schemaLoading ? (
            <div className="space-y-3 animate-pulse">
              {Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-11 rounded-xl bg-gray-100 dark:bg-slate-800" />)}
            </div>
          ) : fields.filter((field) => !field.readonly).length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {fields.filter((field) => !field.readonly).map((field) => (
                <label key={field.key} className="space-y-1.5 text-sm font-medium text-gray-700 dark:text-gray-300">
                  <span>{displayLabel(field)}{field.required && <span className="ml-1 text-red-500">*</span>}</span>
                  {field.type === "select" ? (
                    <select required={field.required} value={values[field.key] || ""} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} className={`${fieldClass} cursor-pointer`}>
                      <option value="">{t("document_create.choose_value")}</option>
                      {(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  ) : (
                    <input
                      type={field.type === "date" ? "date" : field.type === "number" ? "number" : "text"}
                      required={field.required}
                      value={values[field.key] || ""}
                      onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                      className={fieldClass}
                    />
                  )}
                  {field.source?.startsWith("employee.") && <span className="block text-[11px] font-normal text-gray-500 dark:text-gray-400">{t("document_create.employee_autofill_hint")}</span>}
                </label>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-4 dark:border-slate-800">
            <button type="submit" disabled={saving || generating || schemaLoading || !templateId || !selectedHouseId} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-gray-200 dark:hover:bg-slate-800">
              <RefreshCw className={`h-4 w-4 ${saving ? "animate-spin" : ""}`} />
              {saving ? t("document_create.saving") : t("document_create.save_draft")}
            </button>
            <button type="button" onClick={() => void generate()} disabled={saving || generating || schemaLoading || !templateId || !selectedHouseId} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-primary-600 px-4 text-sm font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50">
              <Download className="h-4 w-4" />
              {generating ? t("document_create.generating") : t("document_create.generate")}
            </button>
          </div>
        </form>

        <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <div className="flex min-h-14 items-center justify-between gap-3 border-b border-gray-100 px-4 dark:border-slate-800">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">{t("document_create.preview")}</h2>
            <span className="text-xs text-gray-500 dark:text-gray-400">{previewLoading ? t("document_create.refreshing_preview") : t("document_create.auto_preview")}</span>
          </div>
          {previewError ? (
            <p role="alert" className="p-6 text-sm text-red-700 dark:text-red-300">{previewError}</p>
          ) : previewHtml ? (
            <iframe title={t("document_create.preview")} srcDoc={previewHtml} sandbox="" className="h-[720px] w-full bg-white" />
          ) : (
            <div className="flex h-[420px] items-center justify-center p-8 text-center text-sm text-gray-500 dark:text-gray-400">
              {loading ? t("document_create.loading") : t("document_create.preview_empty")}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
