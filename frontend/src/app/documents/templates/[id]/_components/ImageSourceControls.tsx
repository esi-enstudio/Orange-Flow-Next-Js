"use client";

import { useRef, useState } from "react";
import { Trash2, Upload } from "lucide-react";
import EntitySelector from "@/app/zoom-in/_components/EntitySelector";
import { useLanguage } from "@/i18n/useLanguage";
import {
  DYNAMIC_SOURCES,
  inputClass,
  type AstBlock,
  type DynamicSource,
  type SourceKind,
  type TemplateAsset,
} from "./editorTypes";

const MAX_ASSET_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

interface ImageSourceControlsProps {
  block: AstBlock;
  assets: TemplateAsset[];
  onPatch: (patch: Partial<AstBlock>) => void;
  onUploadAsset: (file: File) => Promise<boolean>;
  onDeleteAsset: (assetId: number) => Promise<void>;
  onDeleteBlock: () => void;
  editable: boolean;
  saving: boolean;
  uploadError: string;
}

export default function ImageSourceControls({
  block, assets, onPatch, onUploadAsset, onDeleteAsset, onDeleteBlock,
  editable, saving, uploadError,
}: ImageSourceControlsProps) {
  const { t } = useLanguage();
  const fileRef = useRef<HTMLInputElement>(null);
  const [localError, setLocalError] = useState("");
  const disabled = !editable || saving;
  const kind: SourceKind = block.source_kind === "manual" ? "manual" : "dynamic";
  const source: DynamicSource = DYNAMIC_SOURCES.includes(block.source as DynamicSource)
    ? block.source as DynamicSource
    : "resignation_letter";
  const assetId = typeof block.asset_id === "number" ? block.asset_id : null;

  const changeKind = (nextKind: SourceKind) => {
    if (nextKind === "manual") {
      onPatch({ source_kind: "manual", source: null, asset_id: assets[0]?.id ?? null });
    } else {
      onPatch({ source_kind: "dynamic", source: "resignation_letter", asset_id: null });
    }
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || disabled) return;
    if (!ALLOWED_TYPES.includes(file.type) || file.size > MAX_ASSET_BYTES) {
      setLocalError(t("document_template_editor.asset_upload_error"));
      return;
    }
    setLocalError("");
    await onUploadAsset(file);
  };

  return (
    <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50/60 p-3 dark:border-slate-700 dark:bg-slate-950/40">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-bold text-gray-800 dark:text-gray-200">
          {t("document_template_editor.image_source")}
        </h4>
        <button
          type="button"
          onClick={onDeleteBlock}
          disabled={disabled}
          title={t("common.delete")}
          aria-label={t("common.delete")}
          className="min-h-11 min-w-11 cursor-pointer rounded-lg text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-red-950/30"
        >
          <Trash2 className="mx-auto h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
        {t("document_template_editor.source_kind")}
        <select
          value={kind}
          onChange={(event) => changeKind(event.target.value as SourceKind)}
          disabled={disabled}
          className={`${inputClass} mt-1 cursor-pointer`}
        >
          <option value="dynamic">{t("document_template_editor.source_dynamic")}</option>
          <option value="manual">{t("document_template_editor.source_manual")}</option>
        </select>
      </label>

      {kind === "dynamic" ? (
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">
          {t("document_template_editor.image_source")}
          <select
            value={source}
            onChange={(event) => onPatch({ source: event.target.value as DynamicSource })}
            disabled={disabled}
            className={`${inputClass} mt-1 cursor-pointer`}
          >
            {DYNAMIC_SOURCES.map((item) => (
              <option key={item} value={item}>
                {t(`document_template_editor.source_${item}`)}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div className="space-y-2">
          <EntitySelector
            label={t("document_template_editor.asset")}
            items={assets.map((asset) => ({ id: asset.id, label: asset.file_name }))}
            selectedIds={assetId ? [assetId] : []}
            onChange={(ids) => onPatch({ asset_id: typeof ids[0] === "number" ? ids[0] : null })}
            single
            closeOnSelect
            showSelectAll={false}
            portal
            disabled={disabled}
            placeholder={t("document_template_editor.asset_placeholder")}
            searchPlaceholder={t("document_template_editor.asset_search")}
            emptyMessage={t("document_template_editor.asset_empty")}
            noResultsMessage={t("document_template_editor.asset_no_results")}
            selectedLabel={t("document_template_editor.asset_selected")}
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept={ALLOWED_TYPES.join(",")}
              onChange={(event) => void handleFile(event)}
              disabled={disabled}
              aria-label={t("document_template_editor.asset_upload")}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={disabled}
              className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-xs font-semibold text-gray-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-gray-200 dark:hover:bg-slate-800"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              {t("document_template_editor.asset_upload")}
            </button>
            {assetId && (
              <button
                type="button"
                onClick={() => void onDeleteAsset(assetId)}
                disabled={disabled}
                className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-red-950/30"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                {t("document_template_editor.asset_delete")}
              </button>
            )}
          </div>
          {(localError || uploadError) && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {localError || uploadError}
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-gray-500 dark:text-gray-400">
          {t("document_template_editor.max_width_mm")}
          <input
            type="number"
            min={20}
            max={190}
            value={Number(block.max_width_mm ?? 170)}
            onChange={(event) => onPatch({ max_width_mm: Number(event.target.value) })}
            disabled={disabled}
            className={`${inputClass} mt-1`}
          />
        </label>
        <label className="text-xs text-gray-500 dark:text-gray-400">
          {t("document_template_editor.max_height_mm")}
          <input
            type="number"
            min={20}
            max={260}
            value={Number(block.max_height_mm ?? 240)}
            onChange={(event) => onPatch({ max_height_mm: Number(event.target.value) })}
            disabled={disabled}
            className={`${inputClass} mt-1`}
          />
        </label>
      </div>

      <label className="block text-xs text-gray-500 dark:text-gray-400">
        {t("document_template_editor.alignment")}
        <select
          value={String(block.align ?? "center")}
          onChange={(event) => onPatch({ align: event.target.value })}
          disabled={disabled}
          className={`${inputClass} mt-1 cursor-pointer`}
        >
          {["left", "center", "right"].map((item) => (
            <option key={item} value={item}>{t(`document_template_editor.${item}`)}</option>
          ))}
        </select>
      </label>

      <label className="block text-xs text-gray-500 dark:text-gray-400">
        {t("document_template_editor.fallback_text")}
        <input
          value={typeof block.fallback_text === "string" ? block.fallback_text : ""}
          onChange={(event) => onPatch({ fallback_text: event.target.value })}
          disabled={disabled}
          maxLength={200}
          className={`${inputClass} mt-1`}
        />
      </label>

      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-300">
        <input
          type="checkbox"
          checked={Boolean(block.required)}
          onChange={(event) => onPatch({ required: event.target.checked })}
          disabled={disabled}
          className="h-4 w-4 cursor-pointer rounded border-gray-300 disabled:cursor-not-allowed"
        />
        {t("document_template_editor.required_image")}
      </label>
    </div>
  );
}
