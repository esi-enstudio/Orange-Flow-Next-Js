"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from "lucide-react";
import EntitySelector, { type SelectorItem } from "@/app/zoom-in/_components/EntitySelector";
import { useLanguage } from "@/i18n/useLanguage";
import ImageSourceControls from "./ImageSourceControls";
import PageList from "./PageList";
import {
  AST_V2,
  AUDIENCES,
  inputClass,
  makeBlock,
  splitPages,
  type AstBlock,
  type Audience,
  type BlockType,
  type DocumentAst,
  type TemplateAsset,
  type TemplateInfo,
  type TemplateVersion,
  type VariableField,
  type VariableOption,
} from "./editorTypes";

interface OptionsPanelProps {
  template: TemplateInfo;
  ast: DocumentAst;
  fields: VariableField[];
  variables: VariableOption[];
  versions: TemplateVersion[];
  sourceVersion: number | null;
  assets: TemplateAsset[];
  employeeItems: SelectorItem[];
  employeeQuery: string;
  selectedEmployeeId: number | null;
  onEmployeeSearchChange: (query: string) => void;
  onSelectEmployee: (id: number | null) => void;
  selectedPage: number;
  onSelectPage: (index: number) => void;
  selectedBlockId: string | null;
  onSelectBlock: (id: string | null) => void;
  onAstChange: (updater: (current: DocumentAst) => DocumentAst) => void;
  onFieldsChange: (updater: (current: VariableField[]) => VariableField[]) => void;
  versionNotes: string;
  onVersionNotesChange: (value: string) => void;
  onSave: (publish: boolean) => void;
  onPublishVersion: (versionNumber: number) => void;
  onLoadVersion: (versionNumber: number) => void;
  onUploadAsset: (file: File) => Promise<boolean>;
  onDeleteAsset: (assetId: number) => Promise<void>;
  uploadError: string;
  editable: boolean;
  saving: boolean;
  globalReadOnly: boolean;
  canManage: boolean;
}

const alignmentOptions = ["left", "center", "right", "justify"] as const;
const addOptions: BlockType[] = ["heading", "paragraph", "spacer", "divider", "signature", "page_break"];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900 sm:p-4">
      <h3 className="mb-2 text-sm font-bold text-gray-900 dark:text-gray-100">{title}</h3>
      {children}
    </section>
  );
}

export default function OptionsPanel({
  template, ast, fields, variables, versions, sourceVersion, assets,
  employeeItems, employeeQuery, selectedEmployeeId, onEmployeeSearchChange,
  onSelectEmployee, selectedPage, onSelectPage, selectedBlockId, onSelectBlock,
  onAstChange, onFieldsChange, versionNotes, onVersionNotesChange, onSave,
  onPublishVersion, onLoadVersion, onUploadAsset, onDeleteAsset, uploadError,
  editable, saving, globalReadOnly, canManage,
}: OptionsPanelProps) {
  const { t, language } = useLanguage();
  const [selectedVariableKey, setSelectedVariableKey] = useState("");
  const disabled = !editable || saving;
  const pages = splitPages(ast.blocks);
  const pageBlocks = (pages[selectedPage] ?? []).filter((block) => block.type !== "page_break");
  const selectedBlock = ast.blocks.find((block) => block.id === selectedBlockId) ?? null;

  const patchBlock = (blockId: string, patch: Partial<AstBlock>) => {
    onAstChange((current) => ({
      ...current,
      blocks: current.blocks.map((block) => block.id === blockId ? { ...block, ...patch } : block),
    }));
  };

  const patchPage = (patch: Partial<DocumentAst["page"]>) => {
    onAstChange((current) => ({ ...current, page: { ...current.page, ...patch } }));
  };

  const addBlock = (type: BlockType) => {
    if (disabled) return;
    const page = pages[selectedPage] ?? [];
    const breakIndex = page.findIndex((block) => block.type === "page_break");
    const anchor = breakIndex >= 0 ? page[breakIndex] : page[page.length - 1];
    const block = makeBlock(type);
    onAstChange((current) => {
      const next = [...current.blocks];
      const anchorIndex = anchor ? next.findIndex((item) => item.id === anchor.id) : -1;
      const insertAt = breakIndex >= 0
        ? anchorIndex
        : anchorIndex >= 0 ? anchorIndex + 1 : next.length;
      next.splice(insertAt < 0 ? next.length : insertAt, 0, block);
      return {
        ...current,
        schema_version: type === "image" ? AST_V2 : current.schema_version,
        blocks: next,
      };
    });
    onSelectBlock(block.id);
  };

  const moveBlock = (index: number, direction: -1 | 1) => {
    if (disabled) return;
    const target = index + direction;
    if (target < 0 || target >= pageBlocks.length) return;
    const source = pageBlocks[index];
    const targetBlock = pageBlocks[target];
    onAstChange((current) => {
      const next = [...current.blocks];
      const from = next.findIndex((block) => block.id === source.id);
      const to = next.findIndex((block) => block.id === targetBlock.id);
      if (from < 0 || to < 0) return current;
      [next[from], next[to]] = [next[to], next[from]];
      return { ...current, blocks: next };
    });
  };

  const removeBlock = (blockId: string) => {
    if (disabled) return;
    onAstChange((current) => ({ ...current, blocks: current.blocks.filter((block) => block.id !== blockId) }));
    if (selectedBlockId === blockId) onSelectBlock(null);
  };

  const insertVariable = (key: string) => {
    if (disabled || !key) return;
    if (!selectedBlock || !["heading", "paragraph", "signature"].includes(selectedBlock.type)) return;
    const option = variables.find((item) => item.key === key);
    const token = `{{ ${key} }}`;
    if (selectedBlock.type === "signature") {
      const fallback = (selectedBlock.fallback && typeof selectedBlock.fallback === "object"
        ? selectedBlock.fallback : {}) as Record<string, unknown>;
      const currentName = typeof fallback.name === "string" ? fallback.name : "";
      patchBlock(selectedBlock.id, {
        fallback: { ...fallback, name: `${currentName}${currentName ? " " : ""}${token}` },
      });
    } else {
      const text = typeof selectedBlock.text === "string" ? selectedBlock.text : "";
      patchBlock(selectedBlock.id, { text: `${text}${text ? " " : ""}${token}` });
    }
    onFieldsChange((current) => current.some((field) => field.key === key)
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
  };

  return (
    <aside className="min-w-0 space-y-3">
      <Section title={t("document_template_editor.panel_title")}>
        <div className="space-y-3">
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
            {t("document_template_editor.audience")}
            <select
              value={ast.audience ?? "all"}
              onChange={(event) => onAstChange((current) => ({
                ...current, audience: event.target.value as Audience,
              }))}
              disabled={disabled}
              className={`${inputClass} mt-1 cursor-pointer`}
            >
              {AUDIENCES.map((item) => (
                <option key={item} value={item}>
                  {t(`document_template_editor.audience_${item}`)}
                </option>
              ))}
            </select>
          </label>

          <EntitySelector
            label={t("document_template_editor.preview_employee")}
            items={employeeItems}
            selectedIds={selectedEmployeeId ? [selectedEmployeeId] : []}
            onChange={(ids) => onSelectEmployee(typeof ids[0] === "number" ? ids[0] : null)}
            onSearchChange={onEmployeeSearchChange}
            remoteSearch
            single
            closeOnSelect
            showSelectAll={false}
            portal
            placeholder={t("document_template_editor.preview_employee_placeholder")}
            searchPlaceholder={t("document_template_editor.preview_employee_search")}
            emptyMessage={employeeQuery.trim().length < 2
              ? t("document_template_editor.preview_employee_search_short")
              : t("document_template_editor.preview_employee_empty")}
            noResultsMessage={t("document_template_editor.preview_employee_no_results")}
            selectedLabel={t("document_template_editor.preview_employee_selected")}
          />
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {t("document_template_editor.preview_employee_hint")}
          </p>

          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
            {t("document_template_editor.orientation")}
            <select
              value={ast.page.orientation}
              onChange={(event) => patchPage({ orientation: event.target.value as DocumentAst["page"]["orientation"] })}
              disabled={disabled}
              className={`${inputClass} mt-1 cursor-pointer`}
            >
              <option value="portrait">{t("document_template_editor.portrait")}</option>
              <option value="landscape">{t("document_template_editor.landscape")}</option>
            </select>
          </label>
        </div>
      </Section>

      <Section title={t("document_template_editor.version_history")}>
        <p className="mb-2 text-[11px] text-gray-500 dark:text-gray-400">
          {sourceVersion ? t("document_template_editor.version", { version: sourceVersion }) : "-"}
          {globalReadOnly && ` · ${t("document_template_editor.read_only_global")}`}
          {!canManage && ` · ${t("document_template_editor.read_only_permission")}`}
        </p>
        <div className="max-h-52 space-y-1.5 overflow-y-auto">
          {versions.map((version) => (
            <div key={version.id} className="flex items-center gap-2 rounded-xl border border-gray-100 p-2 dark:border-slate-800">
              <button
                type="button"
                onClick={() => onLoadVersion(version.version_number)}
                className="min-h-11 min-w-0 flex-1 cursor-pointer text-left"
              >
                <span className="block font-semibold text-gray-800 dark:text-gray-200">
                  {t("document_template_editor.version", { version: version.version_number })}
                </span>
                <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                  {version.is_published ? t("document_template_editor.published") : t("document_template_editor.unpublished")}
                  {" · "}{version.version_notes || "-"}
                </span>
              </button>
              {!version.is_published && editable && (
                <button
                  type="button"
                  onClick={() => onPublishVersion(version.version_number)}
                  disabled={saving}
                  className="min-h-11 cursor-pointer rounded-lg px-2 text-xs font-semibold text-primary-700 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-primary-300 dark:hover:bg-primary-950/30"
                >
                  {t("document_template_editor.publish_saved")}
                </button>
              )}
            </div>
          ))}
        </div>
      </Section>

      <PageList
        blocks={ast.blocks}
        selectedPage={selectedPage}
        onSelectPage={onSelectPage}
        onAstChange={onAstChange}
        editable={editable}
        saving={saving}
      />

      <Section title={t("document_template_editor.blocks")}>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {addOptions.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => addBlock(type)}
              disabled={disabled || ast.blocks.length >= 300}
              className="inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-lg border border-gray-200 px-2 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-gray-200 dark:hover:bg-slate-800"
            >
              <Plus className="h-3 w-3" aria-hidden="true" />
              {t(`document_template_editor.${type}`)}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {pageBlocks.length === 0 && (
            <p className="rounded-xl bg-gray-50 p-3 text-xs text-gray-500 dark:bg-slate-950 dark:text-gray-400">
              {t("document_template_editor.page_empty")}
            </p>
          )}
          {pageBlocks.map((block, index) => {
            const fallback = (block.fallback && typeof block.fallback === "object"
              ? block.fallback : {}) as Record<string, unknown>;
            const isSelected = selectedBlockId === block.id;
            return (
              <article
                key={block.id}
                className={`space-y-2 rounded-xl border p-2.5 ${
                  isSelected ? "border-primary-400 ring-1 ring-primary-400/30" : "border-gray-200 dark:border-slate-700"
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <button
                    type="button"
                    onClick={() => onSelectBlock(block.id)}
                    className="min-h-11 min-w-0 flex-1 cursor-pointer text-left text-xs font-semibold text-gray-800 dark:text-gray-200"
                  >
                    {index + 1}. {t(`document_template_editor.${block.type}`)}
                  </button>
                  <button
                    type="button"
                    aria-label={t("common.move_up")}
                    title={t("common.move_up")}
                    disabled={disabled || index === 0}
                    onClick={() => moveBlock(index, -1)}
                    className="min-h-11 min-w-11 cursor-pointer rounded-lg text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-300 dark:hover:bg-slate-800"
                  >
                    <ArrowUp className="mx-auto h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={t("common.move_down")}
                    title={t("common.move_down")}
                    disabled={disabled || index === pageBlocks.length - 1}
                    onClick={() => moveBlock(index, 1)}
                    className="min-h-11 min-w-11 cursor-pointer rounded-lg text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-300 dark:hover:bg-slate-800"
                  >
                    <ArrowDown className="mx-auto h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={t("common.delete")}
                    title={t("common.delete")}
                    disabled={disabled}
                    onClick={() => removeBlock(block.id)}
                    className="min-h-11 min-w-11 cursor-pointer rounded-lg text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-red-950/30"
                  >
                    <Trash2 className="mx-auto h-4 w-4" aria-hidden="true" />
                  </button>
                </div>

                {!isSelected ? null : (
                  <>
                    {(block.type === "heading" || block.type === "paragraph") && (
                      <>
                        <textarea
                          value={typeof block.text === "string" ? block.text : ""}
                          onChange={(event) => patchBlock(block.id, { text: event.target.value })}
                          disabled={disabled}
                          maxLength={20000}
                          rows={4}
                          className={`${inputClass} min-h-0 resize-y`}
                          aria-label={t("document_template_editor.block_text")}
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <label className="text-[11px] text-gray-500 dark:text-gray-400">
                            {t("document_template_editor.alignment")}
                            <select
                              value={String(block.align ?? "left")}
                              onChange={(event) => patchBlock(block.id, { align: event.target.value })}
                              disabled={disabled}
                              className={`${inputClass} mt-1 cursor-pointer`}
                            >
                              {alignmentOptions.map((item) => (
                                <option key={item} value={item}>{t(`document_template_editor.${item}`)}</option>
                              ))}
                            </select>
                          </label>
                          <label className="text-[11px] text-gray-500 dark:text-gray-400">
                            {t("document_template_editor.font_size")}
                            <input
                              type="number"
                              min={6}
                              max={40}
                              value={Number(block.size ?? 12)}
                              onChange={(event) => patchBlock(block.id, { size: Number(event.target.value) })}
                              disabled={disabled}
                              className={`${inputClass} mt-1`}
                            />
                          </label>
                        </div>
                      </>
                    )}

                    {block.type === "spacer" && (
                      <label className="block text-[11px] text-gray-500 dark:text-gray-400">
                        {t("document_template_editor.spacer_height")}
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={Number(block.height ?? 8)}
                          onChange={(event) => patchBlock(block.id, { height: Number(event.target.value) })}
                          disabled={disabled}
                          className={`${inputClass} mt-1`}
                        />
                      </label>
                    )}

                    {block.type === "divider" && (
                      <label className="block text-[11px] text-gray-500 dark:text-gray-400">
                        {t("document_template_editor.divider_size")}
                        <input
                          type="number"
                          min={0.5}
                          max={4}
                          step={0.5}
                          value={Number(block.size ?? 1)}
                          onChange={(event) => patchBlock(block.id, { size: Number(event.target.value) })}
                          disabled={disabled}
                          className={`${inputClass} mt-1`}
                        />
                      </label>
                    )}

                    {block.type === "signature" && (
                      <>
                        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                          <input
                            type="checkbox"
                            checked={Boolean(block.show_image)}
                            onChange={(event) => patchBlock(block.id, { show_image: event.target.checked })}
                            disabled={disabled}
                            className="h-4 w-4 cursor-pointer rounded border-gray-300 disabled:cursor-not-allowed"
                          />
                          {t("document_template_editor.show_signature_image")}
                        </label>
                        <div className="grid grid-cols-1 gap-2">
                          {(["name", "designation", "organization", "phone"] as const).map((key) => (
                            <label key={key} className="text-[11px] text-gray-500 dark:text-gray-400">
                              {t(`document_template_editor.fallback_${key}`)}
                              <input
                                value={typeof fallback[key] === "string" ? fallback[key] as string : ""}
                                onChange={(event) => patchBlock(block.id, { fallback: { ...fallback, [key]: event.target.value } })}
                                disabled={disabled}
                                className={`${inputClass} mt-1`}
                              />
                            </label>
                          ))}
                        </div>
                      </>
                    )}

                    {block.type === "image" && (
                      <ImageSourceControls
                        block={block}
                        assets={assets}
                        onPatch={(patch) => patchBlock(block.id, patch)}
                        onUploadAsset={onUploadAsset}
                        onDeleteAsset={onDeleteAsset}
                        onDeleteBlock={() => removeBlock(block.id)}
                        editable={editable}
                        saving={saving}
                        uploadError={uploadError}
                      />
                    )}
                  </>
                )}
              </article>
            );
          })}
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 border-t border-gray-100 pt-3 dark:border-slate-800 sm:grid-cols-[minmax(0,1fr)_auto]">
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
            {t("document_template_editor.available_variables")}
            <select
              value={selectedVariableKey}
              onChange={(event) => setSelectedVariableKey(event.target.value)}
              disabled={disabled || !variables.length}
              className={`${inputClass} mt-1 cursor-pointer disabled:cursor-not-allowed`}
            >
              <option value="">—</option>
              {variables.map((variable) => (
                <option key={variable.key} value={variable.key}>
                  {language === "bn" ? variable.label_bn || variable.label : variable.label} · {variable.key}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => insertVariable(selectedVariableKey)}
            disabled={disabled || !selectedVariableKey}
            className="min-h-11 cursor-pointer rounded-xl border border-gray-200 px-3 text-xs font-semibold text-gray-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-gray-200"
          >
            {t("document_template_editor.insert_variable")}
          </button>
        </div>

        <div className="mt-3 space-y-2 border-t border-gray-100 pt-3 dark:border-slate-800">
          <h4 className="text-xs font-bold text-gray-800 dark:text-gray-200">
            {t("document_template_editor.variables")}
          </h4>
          {fields.length === 0 ? (
            <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("document_template_editor.no_variables")}</p>
          ) : fields.map((field) => (
            <div key={field.key} className="rounded-xl bg-gray-50 p-2.5 dark:bg-slate-950">
              <p className="truncate font-mono text-[11px] font-semibold text-gray-800 dark:text-gray-200">
                {`{{ ${field.key} }}`}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <input
                  value={field.default || ""}
                  onChange={(event) => onFieldsChange((current) => current.map((item) =>
                    item.key === field.key ? { ...item, default: event.target.value } : item))}
                  disabled={disabled || field.readonly}
                  placeholder={t("document_template_editor.default_value")}
                  className={`${inputClass} min-h-11`}
                />
                <label className="flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-400">
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(event) => onFieldsChange((current) => current.map((item) =>
                      item.key === field.key ? { ...item, required: event.target.checked } : item))}
                    disabled={disabled || field.readonly}
                    className="h-4 w-4 cursor-pointer rounded border-gray-300 disabled:cursor-not-allowed"
                  />
                  {t("document_template_editor.required")}
                </label>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title={t("document_template_editor.page_settings")}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(["top", "right", "bottom", "left"] as const).map((side) => (
            <label key={side} className="text-[11px] text-gray-500 dark:text-gray-400">
              {side}
              <input
                type="number"
                min={5}
                max={50}
                value={Number(ast.page.margins[side])}
                onChange={(event) => patchPage({ margins: { ...ast.page.margins, [side]: Number(event.target.value) } })}
                disabled={disabled}
                className={`${inputClass} mt-1`}
              />
            </label>
          ))}
        </div>
      </Section>

      <Section title={t("document_template_editor.version_notes")}>
        <input
          value={versionNotes}
          onChange={(event) => onVersionNotesChange(event.target.value)}
          disabled={disabled}
          maxLength={1000}
          className={inputClass}
        />
        <div className="mt-3 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => onSave(false)}
            disabled={disabled}
            className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-gray-200"
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            {t("document_template_editor.save_draft")}
          </button>
          <button
            type="button"
            onClick={() => onSave(true)}
            disabled={disabled}
            className="min-h-11 w-full cursor-pointer rounded-xl bg-primary-600 px-4 text-sm font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("document_template_editor.publish_version")}
          </button>
        </div>
        <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
          {template.name}
        </p>
      </Section>
    </aside>
  );
}
