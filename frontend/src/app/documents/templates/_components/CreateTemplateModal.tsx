"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { FilePlus2, Loader2, X } from "lucide-react";
import { useLanguage } from "@/i18n/useLanguage";
import apiClient from "@/lib/api";
import { getDocumentErrorMessage, getDocumentFieldErrors } from "@/lib/documents";

interface DocumentType {
  id: number;
  code: string;
  name: string;
  name_bn: string | null;
}

interface CreateTemplateModalProps {
  open: boolean;
  onClose: () => void;
  types: DocumentType[];
  selectedHouseId?: number;
  selectedHouseName?: string;
  canCreateGlobal: boolean;
  onCreated: (templateId: number) => void;
}

type FormState = {
  document_type_id: string;
  name: string;
  description: string;
  scope: "house" | "global";
  template_mode: "PREDEFINED" | "VISUAL";
  is_default: boolean;
  publish: boolean;
  version_notes: string;
};

type FieldErrors = Record<string, string>;

const fieldClass =
  "min-h-11 w-full cursor-pointer rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100";

export default function CreateTemplateModal({
  open,
  onClose,
  types,
  selectedHouseId,
  selectedHouseName,
  canCreateGlobal,
  onCreated,
}: CreateTemplateModalProps) {
  const { t, language } = useLanguage();
  const [form, setForm] = useState<FormState>({
    document_type_id: "",
    name: "",
    description: "",
    scope: selectedHouseId ? "house" : canCreateGlobal ? "global" : "house",
    template_mode: "PREDEFINED",
    is_default: false,
    publish: true,
    version_notes: "",
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState("");
  const [saving, setSaving] = useState(false);
  const typeRef = useRef<HTMLSelectElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement as HTMLElement | null;
    setForm({
      document_type_id: "",
      name: "",
      description: "",
      scope: selectedHouseId ? "house" : canCreateGlobal ? "global" : "house",
      template_mode: "PREDEFINED",
      is_default: false,
      publish: true,
      version_notes: "",
    });
    setErrors({});
    setSubmitError("");
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    typeRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      triggerRef.current?.focus();
      triggerRef.current = null;
    };
  }, [open, selectedHouseId, canCreateGlobal]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, saving, onClose]);

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const validate = (): FieldErrors => {
    const next: FieldErrors = {};
    if (!form.document_type_id) next.document_type_id = t("documents.validation_type_required");
    if (!form.name.trim()) next.name = t("documents.validation_name_required");
    else if (form.name.trim().length > 200) next.name = t("documents.validation_name_long");
    if (form.description.length > 2000) next.description = t("documents.validation_description_long");
    if (form.version_notes.length > 1000) next.version_notes = t("documents.validation_notes_long");
    if (form.scope === "house" && !selectedHouseId) next.scope = t("documents.validation_house_required");
    return next;
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const nextErrors = validate();
    setErrors(nextErrors);
    setSubmitError("");
    if (Object.keys(nextErrors).length > 0) return;

    setSaving(true);
    try {
      const response = await apiClient.post(
        "v1/documents/templates",
        {
          document_type_id: Number(form.document_type_id),
          scope: form.scope,
          name: form.name.trim(),
          template_mode: form.template_mode,
          description: form.description.trim() || null,
          is_default: form.is_default,
          content_json: { blocks: [] },
          variables_schema: { fields: [] },
          version_notes: form.version_notes.trim() || null,
          publish: form.publish,
        },
        {
          headers: form.scope === "house" && selectedHouseId ? { "X-House-ID": String(selectedHouseId) } : {},
        },
      );
      const createdId = Number(response.data?.data?.id);
      if (!Number.isFinite(createdId) || createdId < 1) {
        throw new Error("Missing created template id");
      }
      onCreated(createdId);
    } catch (error: unknown) {
      setSubmitError(getDocumentErrorMessage(error, t("documents.create_error")));
      setErrors(getDocumentFieldErrors(error));
    } finally {
      setSaving(false);
    }
  };

  const fieldError = (key: keyof FormState) => errors[key];

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="create-template-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) onClose();
          }}
          className="fixed inset-0 z-[110] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
        >
          <motion.div
            key="create-template-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-template-title"
            aria-busy={saving}
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ type: "spring", damping: 26, stiffness: 260 }}
            className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-gray-100 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900 sm:max-w-lg sm:rounded-2xl"
          >
            <div className="flex shrink-0 items-start gap-3 border-b border-gray-100 px-5 py-4 dark:border-slate-800">
              <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-400">
                <FilePlus2 aria-hidden="true" className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="create-template-title" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t("documents.create_title")}
                </h2>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{t("documents.create_subtitle")}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                aria-label={t("common.close")}
                title={t("common.close")}
                className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-slate-800"
              >
                <X aria-hidden="true" className="size-5" />
              </button>
            </div>

            <form onSubmit={(event) => void submit(event)} noValidate className="flex min-h-0 flex-1 flex-col">
              <div className="flex flex-col gap-4 overflow-y-auto px-5 py-5">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t("documents.type")}
                  <span className="ml-1 text-red-500">*</span>
                  <select
                    ref={typeRef}
                    value={form.document_type_id}
                    onChange={(event) => setField("document_type_id", event.target.value)}
                    aria-invalid={Boolean(fieldError("document_type_id"))}
                    aria-describedby={fieldError("document_type_id") ? "create-template-type-error" : undefined}
                    className={`${fieldClass} mt-1.5`}
                  >
                    <option value="">{t("documents.select_type")}</option>
                    {types.map((type) => (
                      <option key={type.id} value={type.id}>
                        {language === "bn" ? type.name_bn || type.name : type.name}
                      </option>
                    ))}
                  </select>
                  {fieldError("document_type_id") && (
                    <span id="create-template-type-error" role="alert" className="mt-1 block text-xs text-red-600 dark:text-red-400">
                      {fieldError("document_type_id")}
                    </span>
                  )}
                </label>

                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t("documents.template_name")}
                  <span className="ml-1 text-red-500">*</span>
                  <input
                    type="text"
                    maxLength={200}
                    value={form.name}
                    onChange={(event) => setField("name", event.target.value)}
                    placeholder={t("documents.template_name_placeholder")}
                    aria-invalid={Boolean(fieldError("name"))}
                    aria-describedby={fieldError("name") ? "create-template-name-error" : undefined}
                    className={`${fieldClass} mt-1.5 cursor-text`}
                  />
                  {fieldError("name") && (
                    <span id="create-template-name-error" role="alert" className="mt-1 block text-xs text-red-600 dark:text-red-400">
                      {fieldError("name")}
                    </span>
                  )}
                </label>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      {t("documents.scope")}
                      <select
                        value={form.scope}
                        onChange={(event) => setField("scope", event.target.value as FormState["scope"])}
                        aria-invalid={Boolean(fieldError("scope"))}
                        aria-describedby={fieldError("scope") ? "create-template-scope-error" : undefined}
                        className={`${fieldClass} mt-1.5`}
                      >
                        <option value="house">{t("documents.house")}</option>
                        {canCreateGlobal && <option value="global">{t("documents.global")}</option>}
                      </select>
                      {fieldError("scope") && (
                        <span id="create-template-scope-error" role="alert" className="mt-1 block text-xs text-red-600 dark:text-red-400">
                          {fieldError("scope")}
                        </span>
                      )}
                    </label>
                    {form.scope === "house" && selectedHouseName && (
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {t("documents.house_scope_hint", { house: selectedHouseName })}
                      </p>
                    )}
                  </div>

                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t("documents.template_mode")}
                    <select
                      value={form.template_mode}
                      onChange={(event) => setField("template_mode", event.target.value as FormState["template_mode"])}
                      className={`${fieldClass} mt-1.5`}
                    >
                      <option value="PREDEFINED">{t("documents.predefined")}</option>
                      <option value="VISUAL">{t("documents.visual")}</option>
                    </select>
                  </label>
                </div>

                {form.scope === "global" && canCreateGlobal && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">{t("documents.global_hint")}</p>
                )}

                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t("documents.template_description")}
                  <textarea
                    rows={3}
                    maxLength={2000}
                    value={form.description}
                    onChange={(event) => setField("description", event.target.value)}
                    placeholder={t("documents.template_description_placeholder")}
                    aria-invalid={Boolean(fieldError("description"))}
                    aria-describedby={fieldError("description") ? "create-template-description-error" : undefined}
                    className={`${fieldClass} mt-1.5 cursor-text resize-y py-2.5`}
                  />
                  {fieldError("description") && (
                    <span id="create-template-description-error" role="alert" className="mt-1 block text-xs text-red-600 dark:text-red-400">
                      {fieldError("description")}
                    </span>
                  )}
                </label>

                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t("documents.version_notes")}
                  <input
                    type="text"
                    maxLength={1000}
                    value={form.version_notes}
                    onChange={(event) => setField("version_notes", event.target.value)}
                    placeholder={t("documents.version_notes_placeholder")}
                    aria-invalid={Boolean(fieldError("version_notes"))}
                    aria-describedby={fieldError("version_notes") ? "create-template-notes-error" : undefined}
                    className={`${fieldClass} mt-1.5 cursor-text`}
                  />
                  {fieldError("version_notes") && (
                    <span id="create-template-notes-error" role="alert" className="mt-1 block text-xs text-red-600 dark:text-red-400">
                      {fieldError("version_notes")}
                    </span>
                  )}
                </label>

                <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={form.is_default}
                    onChange={(event) => setField("is_default", event.target.checked)}
                    className="size-4 cursor-pointer rounded border-gray-300"
                  />
                  {t("documents.default")}
                </label>
                <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={form.publish}
                    onChange={(event) => setField("publish", event.target.checked)}
                    className="size-4 cursor-pointer rounded border-gray-300"
                  />
                  {t("documents.publish_now")}
                </label>

                <p className="text-xs text-gray-500 dark:text-gray-400">{t("documents.create_hint")}</p>
                {submitError && (
                  <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
                    {submitError}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 flex-col gap-2 border-t border-gray-100 px-5 py-4 dark:border-slate-800 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={saving}
                  className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl border border-gray-200 px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-gray-200 dark:hover:bg-slate-800"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 text-sm font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving && <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />}
                  {saving ? t("documents.creating") : t("documents.create")}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
