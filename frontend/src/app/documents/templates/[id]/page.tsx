"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowDown, ArrowUp, Eye, Plus, Save, Trash2 } from "lucide-react";
import PageGuideModal from "@/components/PageGuideModal";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import apiClient from "@/lib/api";
import { getDocumentErrorMessage } from "@/lib/documents";

type BlockType = "heading" | "paragraph" | "spacer" | "divider" | "signature" | "page_break";
type Orientation = "portrait" | "landscape";
type AstBlock = Record<string, unknown> & { id: string; type: BlockType };

interface DocumentAst {
  schema_version: number;
  page: {
    format: "A4";
    orientation: Orientation;
    margins: { top: number; right: number; bottom: number; left: number };
    font_size: number;
    line_height: number;
  };
  blocks: AstBlock[];
}

interface VariableField {
  key: string;
  label: string;
  label_bn: string;
  type: string;
  required: boolean;
  source: string | null;
  readonly: boolean;
  default: string;
  options: string[];
}

interface VariableOption {
  key: string;
  label: string;
  label_bn: string;
  type: string;
  source: string | null;
  readonly: boolean;
}

interface TemplateInfo {
  id: number;
  name: string;
  scope: "global" | "house";
  latest_version: { version_number: number } | null;
  content_json: DocumentAst;
}

interface TemplateVersion {
  id: number;
  version_number: number;
  is_published: boolean;
  published_at: string | null;
  created_at: string | null;
  version_notes: string | null;
}

const EMPTY_AST: DocumentAst = {
  schema_version: 1,
  page: {
    format: "A4",
    orientation: "portrait",
    margins: { top: 18, right: 18, bottom: 18, left: 18 },
    font_size: 12,
    line_height: 1.7,
  },
  blocks: [],
};
const inputClass =
  "min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-primary-500/30 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-gray-100";

function makeBlock(type: BlockType): AstBlock {
  const id = `block-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  if (type === "heading") return { id, type, text: "", align: "center", size: 14, bold: true, line_height: 1.7 };
  if (type === "paragraph") return { id, type, text: "", align: "left", size: 12, bold: false, line_height: 1.7 };
  if (type === "spacer") return { id, type, height: 8 };
  if (type === "divider") return { id, type, size: 1 };
  if (type === "signature") {
    return {
      id, type, align: "left", size: 12, show_image: true,
      fallback: { name: "", designation: "", organization: "", phone: "" },
    };
  }
  return { id, type: "page_break" };
}

function parseTemplateId(value: string | string[] | undefined): number | null {
  const id = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export default function DocumentTemplateEditorPage() {
  const { t, language } = useLanguage();
  const { hasPermission, loading: authLoading, selectedHouse, user } = useAuth();
  const selectedHouseId = selectedHouse?.id;
  const params = useParams<{ id: string }>();
  const templateId = parseTemplateId(params.id);
  const canView = hasPermission("documents.templates.view");
  const canManage = hasPermission("documents.templates.manage");
  const isSuperAdmin = Boolean(user?.roles?.some((role) => {
    const roleName = role.name.toLowerCase();
    return roleName === "super admin" || roleName === "super_admin";
  }));
  const headers = useMemo(
    () => selectedHouseId ? { "X-House-ID": String(selectedHouseId) } : {},
    [selectedHouseId],
  );
  const [template, setTemplate] = useState<TemplateInfo | null>(null);
  const [ast, setAst] = useState<DocumentAst>(EMPTY_AST);
  const [fields, setFields] = useState<VariableField[]>([]);
  const [variables, setVariables] = useState<VariableOption[]>([]);
  const [versions, setVersions] = useState<TemplateVersion[]>([]);
  const [sourceVersion, setSourceVersion] = useState<number | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [selectedVariableKey, setSelectedVariableKey] = useState("");
  const [versionNotes, setVersionNotes] = useState("");
  const [previewValues, setPreviewValues] = useState<Record<string, string>>({});
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const loadVersionHistory = useCallback(async () => {
    if (!templateId) return [];
    const response = await apiClient.get(`v1/documents/templates/${templateId}/versions`, { headers });
    const rows = response.data.data as TemplateVersion[];
    setVersions(rows);
    return rows;
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
      const history = await loadVersionHistory();
      const latestVersion = loaded.latest_version?.version_number;
      if (latestVersion) {
        const latestResponse = await apiClient.get(
          `v1/documents/templates/${templateId}/versions/${latestVersion}`,
          { headers },
        );
        const version = latestResponse.data.data;
        setAst(version.content_json);
        setFields(version.variables_schema?.fields || []);
        setSourceVersion(latestVersion);
        setSelectedBlockId(version.content_json.blocks[0]?.id || null);
      } else {
        setAst(loaded.content_json || EMPTY_AST);
        setFields([]);
        setSourceVersion(history[0]?.version_number || null);
      }
    } catch (error: unknown) {
      setErrorMessage(getDocumentErrorMessage(error, t("document_template_editor.load_error")));
    } finally {
      setLoading(false);
    }
  }, [headers, loadVersionHistory, t, templateId]);

  useEffect(() => {
    if (authLoading || !canView) return;
    void loadTemplate();
  }, [authLoading, canView, loadTemplate]);

  if (!authLoading && !canView) return <AccessDenied />;

  const globalReadOnly = template?.scope === "global" && !isSuperAdmin;
  const editable = canManage && !globalReadOnly;
  const selectedBlockIndex = ast.blocks.findIndex((block) => block.id === selectedBlockId);
  const selectedBlock = selectedBlockIndex >= 0 ? ast.blocks[selectedBlockIndex] : null;
  const patchBlock = (blockId: string, patch: Partial<AstBlock>) => {
    setAst((current) => ({
      ...current,
      blocks: current.blocks.map((block) => block.id === blockId ? { ...block, ...patch } : block),
    }));
  };

  const patchPage = (patch: Partial<DocumentAst["page"]>) => {
    setAst((current) => ({ ...current, page: { ...current.page, ...patch } }));
  };

  const moveBlock = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= ast.blocks.length) return;
    const blocks = [...ast.blocks];
    [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
    setAst((current) => ({ ...current, blocks }));
  };

  const addBlock = (type: BlockType) => {
    const block = makeBlock(type);
    setAst((current) => ({ ...current, blocks: [...current.blocks, block] }));
    setSelectedBlockId(block.id);
  };

  const removeBlock = (blockId: string) => {
    const index = ast.blocks.findIndex((block) => block.id === blockId);
    const next = ast.blocks.filter((block) => block.id !== blockId);
    setAst((current) => ({ ...current, blocks: next }));
    if (selectedBlockId === blockId) setSelectedBlockId(next[Math.max(0, index - 1)]?.id || next[0]?.id || null);
  };

  const insertVariable = (key: string) => {
    const option = variables.find((item) => item.key === key);
    if (!selectedBlock) {
      setErrorMessage(t("document_template_editor.select_text_block"));
      return;
    }
    const token = `{{ ${key} }}`;
    if (selectedBlock.type === "heading" || selectedBlock.type === "paragraph") {
      const text = typeof selectedBlock.text === "string" ? selectedBlock.text : "";
      patchBlock(selectedBlock.id, { text: `${text}${text ? " " : ""}${token}` });
    } else if (selectedBlock.type === "signature") {
      const fallback = (selectedBlock.fallback && typeof selectedBlock.fallback === "object"
        ? selectedBlock.fallback
        : {}) as Record<string, unknown>;
      const currentName = typeof fallback.name === "string" ? fallback.name : "";
      patchBlock(selectedBlock.id, {
        fallback: { ...fallback, name: `${currentName}${currentName ? " " : ""}${token}` },
      });
    } else {
      setErrorMessage(t("document_template_editor.select_text_block"));
      return;
    }
    setFields((current) => current.some((field) => field.key === key)
      ? current
      : [...current, {
          key,
          label: option?.label || key,
          label_bn: option?.label_bn || "",
          type: option?.type || "text",
          required: !option?.readonly,
          source: option?.source || null,
          readonly: option?.readonly || false,
          default: "",
          options: [],
        }]);
    setErrorMessage("");
  };

  const updateVariable = (key: string, patch: Partial<VariableField>) => {
    setFields((current) => current.map((field) => field.key === key ? { ...field, ...patch } : field));
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
      setAst(response.data.data.content_json);
      setFields(response.data.data.variables_schema?.fields || []);
      setSourceVersion(versionNumber);
      setSelectedBlockId(response.data.data.content_json.blocks[0]?.id || null);
      setPreviewHtml("");
    } catch (error: unknown) {
      setErrorMessage(getDocumentErrorMessage(error, t("document_template_editor.load_error")));
    }
  };

  const loadPreview = async (versionNumber: number) => {
    if (!templateId) return;
    setPreviewError("");
    try {
      const response = await apiClient.post("v1/documents/render/preview", {
        template_id: templateId,
        version_number: versionNumber,
        document_data: previewValues,
      }, { headers });
      setPreviewHtml(response.data.data.html);
    } catch (error: unknown) {
      setPreviewError(getDocumentErrorMessage(error, t("document_template_editor.preview_error")));
    }
  };

  const saveVersion = async (publish: boolean) => {
    if (!templateId || !editable) return;
    setSaving(true);
    setErrorMessage("");
    setSuccessMessage("");
    setPreviewError("");
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
      await loadVersionHistory();
      setSuccessMessage(publish ? t("document_template_editor.published_success") : t("document_template_editor.saved"));
      await loadPreview(saved.version_number);
    } catch (error: unknown) {
      setErrorMessage(getDocumentErrorMessage(error, t(publish ? "document_template_editor.publish_error" : "document_template_editor.save_error")));
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
      await loadVersionHistory();
      setSuccessMessage(t("document_template_editor.published_success"));
    } catch (error: unknown) {
      setErrorMessage(getDocumentErrorMessage(error, t("document_template_editor.publish_error")));
    } finally {
      setSaving(false);
    }
  };

  const blockTypeLabel = (type: BlockType) => t(`document_template_editor.${type}`);
  const alignmentOptions = ["left", "center", "right", "justify"] as const;
  const addOptions: BlockType[] = ["heading", "paragraph", "spacer", "divider", "signature", "page_break"];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t("document_template_editor.title")}</h1>
          <PageGuideModal pageKey="document_template_editor" />
        </div>
        <Link href="/documents/templates" className="inline-flex min-h-11 items-center rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-gray-200 dark:hover:bg-slate-800">{t("common.back")}</Link>
      </header>
      {errorMessage && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{errorMessage}</p>}
      {successMessage && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">{successMessage}</p>}
      {!selectedHouseId && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{t("document_template_editor.select_house")}</p>}
      {loading ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
          <div className="h-[620px] animate-pulse rounded-2xl bg-gray-100 dark:bg-slate-800" />
          <div className="h-[620px] animate-pulse rounded-2xl bg-gray-100 dark:bg-slate-800" />
        </div>
      ) : !template ? (
        <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-700 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">{errorMessage || t("document_template_editor.load_error")}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
            <div>
              <p className="font-semibold text-gray-900 dark:text-gray-100">{template.name}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t(`documents.${template.scope}`)} · {sourceVersion ? t("document_template_editor.version", { version: sourceVersion }) : "-"}</p>
            </div>
            {globalReadOnly && <p className="text-sm text-amber-700 dark:text-amber-300">{t("document_template_editor.read_only_global")}</p>}
            {!canManage && <p className="text-sm text-gray-500 dark:text-gray-400">{t("document_template_editor.read_only_permission")}</p>}
          </div>

          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
            <section className="space-y-5 rounded-2xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 sm:p-6">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <label className="space-y-1.5 text-sm font-semibold text-gray-700 dark:text-gray-300">
                  {t("document_template_editor.orientation")}
                  <select
                    value={ast.page.orientation}
                    onChange={(event) => patchPage({ orientation: event.target.value as Orientation })}
                    disabled={!editable}
                    className={`${inputClass} cursor-pointer disabled:cursor-not-allowed`}
                  >
                    <option value="portrait">{t("document_template_editor.portrait")}</option>
                    <option value="landscape">{t("document_template_editor.landscape")}</option>
                  </select>
                </label>
                <div className="flex flex-wrap gap-2">
                  {addOptions.map((type) => (
                    <button key={type} type="button" onClick={() => addBlock(type)} disabled={!editable || ast.blocks.length >= 300} className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-gray-200 dark:hover:bg-slate-800">
                      <Plus className="h-3.5 w-3.5" />{blockTypeLabel(type)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">{t("document_template_editor.blocks")}</h2>
                {ast.blocks.length === 0 && <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-500 dark:bg-slate-950 dark:text-gray-400">{t("documents.no_templates")}</p>}
                {ast.blocks.map((block, index) => {
                  const fallback = (block.fallback && typeof block.fallback === "object" ? block.fallback : {}) as Record<string, unknown>;
                  return (
                    <article key={block.id} className={`space-y-3 rounded-xl border p-3 ${selectedBlockId === block.id ? "border-primary-400 ring-1 ring-primary-400/30" : "border-gray-200 dark:border-slate-700"}`} onClick={() => setSelectedBlockId(block.id)}>
                      <div className="flex items-center justify-between gap-2">
                        <button type="button" onClick={(event) => { event.stopPropagation(); setSelectedBlockId(block.id); }} className="min-h-11 cursor-pointer text-sm font-semibold text-gray-900 dark:text-gray-100">{index + 1}. {blockTypeLabel(block.type)}</button>
                        <div className="flex items-center gap-1">
                          <button type="button" aria-label={t("common.move_up")} title={t("common.move_up")} disabled={!editable || index === 0} onClick={(event) => { event.stopPropagation(); moveBlock(index, -1); }} className="min-h-11 min-w-11 cursor-pointer rounded-lg text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-300 dark:hover:bg-slate-800"><ArrowUp className="mx-auto h-4 w-4" /></button>
                          <button type="button" aria-label={t("common.move_down")} title={t("common.move_down")} disabled={!editable || index === ast.blocks.length - 1} onClick={(event) => { event.stopPropagation(); moveBlock(index, 1); }} className="min-h-11 min-w-11 cursor-pointer rounded-lg text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-300 dark:hover:bg-slate-800"><ArrowDown className="mx-auto h-4 w-4" /></button>
                          <button type="button" aria-label={t("common.delete")} title={t("common.delete")} disabled={!editable} onClick={(event) => { event.stopPropagation(); removeBlock(block.id); }} className="min-h-11 min-w-11 cursor-pointer rounded-lg text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-red-950/30"><Trash2 className="mx-auto h-4 w-4" /></button>
                        </div>
                      </div>

                      {(block.type === "heading" || block.type === "paragraph") && (
                        <>
                          <textarea value={typeof block.text === "string" ? block.text : ""} onChange={(event) => patchBlock(block.id, { text: event.target.value })} disabled={!editable} maxLength={20000} rows={block.type === "heading" ? 2 : 4} className={`${inputClass} min-h-0 resize-y`} aria-label={t("document_template_editor.block_text")} />
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <label className="text-xs text-gray-500 dark:text-gray-400">{t("document_template_editor.alignment")}<select value={String(block.align || "left")} onChange={(event) => patchBlock(block.id, { align: event.target.value })} disabled={!editable} className={`${inputClass} mt-1 cursor-pointer`}>{alignmentOptions.map((item) => <option key={item} value={item}>{t(`document_template_editor.${item}`)}</option>)}</select></label>
                            <label className="text-xs text-gray-500 dark:text-gray-400">{t("document_template_editor.font_size")}<input type="number" min={6} max={40} value={Number(block.size || 12)} onChange={(event) => patchBlock(block.id, { size: Number(event.target.value) })} disabled={!editable} className={`${inputClass} mt-1`} /></label>
                            <label className="text-xs text-gray-500 dark:text-gray-400">{t("document_template_editor.line_height")}<input type="number" min={1} max={3} step={0.1} value={Number(block.line_height || 1.7)} onChange={(event) => patchBlock(block.id, { line_height: Number(event.target.value) })} disabled={!editable} className={`${inputClass} mt-1`} /></label>
                            <label className="flex min-h-11 cursor-pointer items-center gap-2 pt-4 text-sm text-gray-700 dark:text-gray-300"><input type="checkbox" checked={Boolean(block.bold)} onChange={(event) => patchBlock(block.id, { bold: event.target.checked })} disabled={!editable} className="h-4 w-4 cursor-pointer rounded border-gray-300 disabled:cursor-not-allowed" />{t("document_template_editor.bold")}</label>
                          </div>
                        </>
                      )}

                      {block.type === "spacer" && <label className="block max-w-xs text-xs text-gray-500 dark:text-gray-400">{t("document_template_editor.spacer_height")}<input type="number" min={1} max={100} value={Number(block.height || 8)} onChange={(event) => patchBlock(block.id, { height: Number(event.target.value) })} disabled={!editable} className={`${inputClass} mt-1`} /></label>}
                      {block.type === "divider" && <label className="block max-w-xs text-xs text-gray-500 dark:text-gray-400">{t("document_template_editor.divider_size")}<input type="number" min={0.5} max={4} step={0.5} value={Number(block.size || 1)} onChange={(event) => patchBlock(block.id, { size: Number(event.target.value) })} disabled={!editable} className={`${inputClass} mt-1`} /></label>}
                      {block.type === "signature" && (
                        <>
                          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300"><input type="checkbox" checked={Boolean(block.show_image)} onChange={(event) => patchBlock(block.id, { show_image: event.target.checked })} disabled={!editable} className="h-4 w-4 cursor-pointer rounded border-gray-300 disabled:cursor-not-allowed" />{t("document_template_editor.show_signature_image")}</label>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            {(["name", "designation", "organization", "phone"] as const).map((key) => (
                              <label key={key} className="text-xs text-gray-500 dark:text-gray-400">{t(`document_template_editor.fallback_${key}`)}<input value={typeof fallback[key] === "string" ? fallback[key] as string : ""} onChange={(event) => patchBlock(block.id, { fallback: { ...fallback, [key]: event.target.value } })} disabled={!editable} className={`${inputClass} mt-1`} /></label>
                            ))}
                          </div>
                        </>
                      )}
                    </article>
                  );
                })}
              </div>

              <div className="grid grid-cols-1 items-end gap-3 border-t border-gray-100 pt-4 dark:border-slate-800 sm:grid-cols-[minmax(0,1fr)_auto]">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t("document_template_editor.available_variables")}
                  <select value={selectedVariableKey} onChange={(event) => setSelectedVariableKey(event.target.value)} disabled={!editable || !variables.length} className={`${inputClass} mt-1 cursor-pointer disabled:cursor-not-allowed`}>
                    <option value="">—</option>
                    {variables.map((variable) => <option key={variable.key} value={variable.key}>{language === "bn" ? variable.label_bn || variable.label : variable.label} · {variable.key}</option>)}
                  </select>
                </label>
                <button type="button" onClick={() => selectedVariableKey && insertVariable(selectedVariableKey)} disabled={!editable || !selectedVariableKey} className="min-h-11 cursor-pointer rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-gray-200">{t("document_template_editor.insert_variable")}</button>
              </div>

              <div className="space-y-3 border-t border-gray-100 pt-4 dark:border-slate-800">
                <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100">{t("document_template_editor.variables")}</h2>
                {fields.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400">{t("document_template_editor.no_variables")}</p>
                ) : fields.map((field) => (
                  <div key={field.key} className="grid grid-cols-1 items-center gap-3 rounded-xl bg-gray-50 p-3 dark:bg-slate-950 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs font-semibold text-gray-800 dark:text-gray-200">{`{{ ${field.key} }}`}{field.readonly && <span className="ml-2 font-sans font-normal text-gray-500">· {language === "bn" ? "স্বয়ংক্রিয়" : "auto"}</span>}</p>
                      <label className="mt-2 block text-xs text-gray-500 dark:text-gray-400">{t("document_template_editor.default_value")}<input value={field.default || ""} onChange={(event) => updateVariable(field.key, { default: event.target.value })} disabled={!editable || field.readonly} className={`${inputClass} mt-1`} /></label>
                    </div>
                    <label className={`flex min-h-11 cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300 ${field.readonly ? "opacity-50" : ""}`}>
                      <input type="checkbox" checked={field.required} onChange={(event) => updateVariable(field.key, { required: event.target.checked })} disabled={!editable || field.readonly} className="h-4 w-4 cursor-pointer rounded border-gray-300 disabled:cursor-not-allowed" />
                      {t("document_template_editor.required")}
                    </label>
                  </div>
                ))}
              </div>

              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t("document_template_editor.version_notes")}<input value={versionNotes} onChange={(event) => setVersionNotes(event.target.value)} disabled={!editable} maxLength={1000} className={`${inputClass} mt-1`} /></label>
              <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-4 dark:border-slate-800">
                <button type="button" onClick={() => void saveVersion(false)} disabled={!editable || saving} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-gray-200"><Save className="h-4 w-4" />{saving ? t("document_template_editor.saving") : t("document_template_editor.save_draft")}</button>
                <button type="button" onClick={() => void saveVersion(true)} disabled={!editable || saving} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-primary-600 px-4 text-sm font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50">{t("document_template_editor.publish_version")}</button>
              </div>
            </section>

            <aside className="space-y-5">
              <section className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 sm:p-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="font-semibold text-gray-900 dark:text-gray-100">{t("document_template_editor.version_history")}</h2>
                  <span className="text-xs text-gray-500">{sourceVersion ? t("document_template_editor.version", { version: sourceVersion }) : "-"}</span>
                </div>
                <div className="space-y-2">
                  {versions.map((version) => (
                    <div key={version.id} className="flex items-center gap-2 rounded-xl border border-gray-100 p-2.5 dark:border-slate-800">
                      <button type="button" onClick={() => void loadSavedVersion(version.version_number)} className="min-h-11 min-w-0 flex-1 cursor-pointer text-left">
                        <span className="block font-semibold text-gray-800 dark:text-gray-200">{t("document_template_editor.version", { version: version.version_number })}</span>
                        <span className="text-[11px] text-gray-500 dark:text-gray-400">{version.is_published ? t("document_template_editor.published") : t("document_template_editor.unpublished")} · {version.version_notes || "-"}</span>
                      </button>
                      {!version.is_published && editable && <button type="button" onClick={() => void publishVersion(version.version_number)} disabled={saving} className="min-h-11 cursor-pointer rounded-lg px-2 text-xs font-semibold text-primary-700 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-primary-300 dark:hover:bg-primary-950/30">{t("document_template_editor.publish_saved")}</button>}
                    </div>
                  ))}
                </div>
              </section>

              <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 p-4 dark:border-slate-800">
                  <h2 className="font-semibold text-gray-900 dark:text-gray-100">{t("document_template_editor.preview")}</h2>
                  <button type="button" onClick={() => sourceVersion && void loadPreview(sourceVersion)} disabled={!sourceVersion || !selectedHouseId} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-sky-50 px-3 text-xs font-semibold text-sky-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-sky-950/40 dark:text-sky-200"><Eye className="h-4 w-4" />{t("document_template_editor.preview")}</button>
                </div>
                {fields.filter((field) => !field.readonly).length > 0 && (
                  <div className="grid grid-cols-1 gap-2 border-b border-gray-100 p-4 dark:border-slate-800 sm:grid-cols-2">
                    {fields.filter((field) => !field.readonly).map((field) => (
                      <label key={field.key} className="text-xs text-gray-500 dark:text-gray-400">{language === "bn" ? field.label_bn || field.label : field.label}<input value={previewValues[field.key] || ""} onChange={(event) => setPreviewValues((current) => ({ ...current, [field.key]: event.target.value }))} placeholder={field.default || ""} className={`${inputClass} mt-1`} /></label>
                    ))}
                  </div>
                )}
                {previewError ? (
                  <p role="alert" className="p-4 text-sm text-red-700 dark:text-red-300">{previewError}</p>
                ) : previewHtml ? (
                  <iframe title={t("document_template_editor.preview")} srcDoc={previewHtml} sandbox="" className="h-[640px] w-full bg-white" />
                ) : (
                  <div className="flex min-h-48 items-center justify-center p-6 text-center text-sm text-gray-500 dark:text-gray-400">{t("document_template_editor.preview_empty")}</div>
                )}
              </section>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
