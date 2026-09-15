"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  ArrowDownUp,
  Check,
  CheckCircle2,
  Loader2,
  Pencil,
  Plus,
  Settings2,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import apiClient from "@/lib/api";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/useLanguage";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import {
  CONTEXT_ICON_CHOICES,
  CONTEXT_META,
  DEFAULT_CONTEXT_META,
  resolveContextIcon,
  type RuleContextOption,
} from "./types";

interface ManageContextsModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

interface FormState {
  context_key: string;
  name_en: string;
  name_bn: string;
  icon: string;
  sort_order: number;
  is_active: boolean;
}

const EMPTY_FORM: FormState = {
  context_key: "",
  name_en: "",
  name_bn: "",
  icon: "activity",
  sort_order: 0,
  is_active: true,
};

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export default function ManageContextsModal({ open, onClose, onSaved }: ManageContextsModalProps) {
  const { t, language } = useLanguage();
  const [contexts, setContexts] = useState<RuleContextOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RuleContextOption | null>(null);
  const [editing, setEditing] = useState<RuleContextOption | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const tM = useCallback(
    (path: string, params?: Record<string, string | number | undefined>) =>
      t(`rule_config.manage.${path}`, params),
    [t]
  );

  const label = useCallback(
    (c: RuleContextOption) => {
      const localized = language === "bn" ? c.name_bn : c.name_en;
      if (localized && localized.trim()) return localized.trim();
      const keyLabel = t(`rule_config.contexts.${c.context_key}`);
      return keyLabel === `rule_config.contexts.${c.context_key}` ? c.context_key : keyLabel;
    },
    [language, t]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setFormError(null);
    try {
      const res = await apiClient.get<{ data: RuleContextOption[] }>("/rule-config/contexts");
      setContexts(res.data.data ?? []);
    } catch {
      setContexts([]);
      setFormError(tM("messages.load_failed"));
    } finally {
      setLoading(false);
    }
  }, [tM]);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    load();
    setEditing(null);
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setFormError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const metaFor = (c: { context_key: string; icon: string | null }) =>
    CONTEXT_META[c.context_key] ?? DEFAULT_CONTEXT_META;

  const sorted = useMemo(
    () =>
      [...(contexts ?? [])].sort(
        (a, b) => a.sort_order - b.sort_order || a.context_key.localeCompare(b.context_key)
      ),
    [contexts]
  );

  const handleEdit = (c: RuleContextOption) => {
    setEditing(c);
    setForm({
      context_key: c.context_key,
      name_en: c.name_en,
      name_bn: c.name_bn ?? "",
      icon: c.icon ?? "",
      sort_order: c.sort_order,
      is_active: c.is_active,
    });
    setFieldErrors({});
    setFormError(null);
  };

  const startCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setFormError(null);
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    const key = form.context_key.trim().toLowerCase();
    if (!key) {
      errs.context_key = tM("validation.key_required");
    } else if (!KEY_PATTERN.test(key)) {
      errs.context_key = tM("validation.key_format");
    }
    if (!form.name_en.trim()) {
      errs.name_en = tM("validation.name_required");
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (saving) return;
    if (!validate()) return;
    setSaving(true);
    setFormError(null);
    const payload = {
      context_key: form.context_key.trim().toLowerCase(),
      name_en: form.name_en.trim(),
      name_bn: form.name_bn.trim() || null,
      icon: form.icon.trim().toLowerCase() || null,
      sort_order: Number.isFinite(Number(form.sort_order)) ? Number(form.sort_order) : 0,
      is_active: form.is_active,
    };
    try {
      if (editing) {
        await apiClient.patch(`/rule-config/contexts/${editing.id}`, {
          name_en: payload.name_en,
          name_bn: payload.name_bn,
          icon: payload.icon,
          sort_order: payload.sort_order,
          is_active: payload.is_active,
        });
      } else {
        await apiClient.post("/rule-config/contexts", payload);
      }
      await load();
      onSaved();
      setEditing(null);
      setForm(EMPTY_FORM);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : tM("messages.save_failed")
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setFormError(null);
    try {
      await apiClient.delete(`/rule-config/contexts/${deleteTarget.id}`);
      await load();
      onSaved();
      setDeleteTarget(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : tM("messages.delete_failed"));
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
          className="fixed inset-0 z-[210] flex items-start md:items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-sm"
        >
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={{ scale: 0.96, opacity: 0, y: 12 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: 12 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="w-full md:max-w-2xl my-auto bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-slate-800 flex flex-col overflow-hidden max-h-[92vh]"
          >
            <div className="flex items-start justify-between gap-4 px-5 sm:px-6 py-4 border-b border-gray-100 dark:border-slate-800 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-500/15 flex items-center justify-center shrink-0">
                  <Settings2 className="w-5 h-5 text-primary-600 dark:text-primary-400" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {tM("title")}
                  </h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{tM("subtitle")}</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-11 h-11 rounded-xl flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
                aria-label={t("common.close")}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
              {formError && (
                <div className="flex items-start gap-2 px-3.5 py-2.5 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-sm text-red-600 dark:text-red-400">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0 text-left whitespace-pre-wrap">
                    {formError}
                  </div>
                  <button
                    onClick={() => setFormError(null)}
                    className="ml-2 text-red-400 hover:text-red-600 dark:hover:text-red-300 cursor-pointer"
                    aria-label={t("common.close")}
                  >
                    ×
                  </button>
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
                  {tM("list_title")}
                </p>
                <button
                  onClick={startCreate}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-colors shadow-sm cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  {tM("new_context")}
                </button>
              </div>

              {loading && !contexts ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="w-5 h-5 text-primary-500 animate-spin" />
                </div>
              ) : sorted.length === 0 ? (
                <div className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">
                  {tM("messages.no_data")}
                </div>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-slate-800 border border-gray-200 dark:border-slate-800 rounded-xl overflow-hidden">
                  {sorted.map((c) => {
                    const Icon = resolveContextIcon(c.context_key, c.icon);
                    const meta = metaFor(c);
                    return (
                      <div key={c.id} className="flex items-center gap-3 px-4 py-3">
                        <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0", meta.iconBg)}>
                          <Icon className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                              {label(c)}
                            </p>
                            {c.is_system && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400 text-[10px] font-semibold">
                                <ShieldCheck className="w-3 h-3" />
                                {tM("system")}
                              </span>
                            )}
                            {c.is_active ? (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold">
                                <CheckCircle2 className="w-3 h-3" />
                                {tM("active")}
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400 text-[10px] font-semibold">
                                {tM("inactive")}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate mt-0.5">
                            {c.context_key} · {tM("sort_label")}: {c.sort_order}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => handleEdit(c)}
                            className="p-2 rounded-lg text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                            aria-label={t("common.edit")}
                            title={t("common.edit")}
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          {!c.is_system && (
                            <button
                              onClick={() => setDeleteTarget(c)}
                              className="p-2 rounded-lg text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors cursor-pointer"
                              aria-label={t("common.delete")}
                              title={t("common.delete")}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {editing !== null || (contexts && contexts.length === 0 && !editing) ? (
                <div className="border border-gray-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5">
                  <p className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-4">
                    {editing ? tM("edit_title") : tM("create_title")}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                        {tM("fields.context_key")}
                      </label>
                      <input
                        type="text"
                        value={form.context_key}
                        disabled={!!editing}
                        onChange={(e) => setForm({ ...form, context_key: e.target.value })}
                        placeholder="e.g. sales_report"
                        className={cn(
                          "w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-sm text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-50",
                          fieldErrors.context_key ? "border-red-400 dark:border-red-500" : ""
                        )}
                      />
                      {fieldErrors.context_key && (
                        <p className="text-xs text-red-500 mt-1">{fieldErrors.context_key}</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                        {tM("fields.sort_order")}
                      </label>
                      <input
                        type="number"
                        value={form.sort_order}
                        onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) || 0 })}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-sm text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                        {tM("fields.name_en")}
                      </label>
                      <input
                        type="text"
                        value={form.name_en}
                        onChange={(e) => setForm({ ...form, name_en: e.target.value })}
                        placeholder={tM("placeholders.name_en")}
                        className={cn(
                          "w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-sm text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary-500",
                          fieldErrors.name_en ? "border-red-400 dark:border-red-500" : ""
                        )}
                      />
                      {fieldErrors.name_en && (
                        <p className="text-xs text-red-500 mt-1">{fieldErrors.name_en}</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                        {tM("fields.name_bn")}
                      </label>
                      <input
                        type="text"
                        value={form.name_bn}
                        onChange={(e) => setForm({ ...form, name_bn: e.target.value })}
                        placeholder={tM("placeholders.name_bn")}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-sm text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                        {tM("fields.icon")}
                      </label>
                      <select
                        value={form.icon}
                        onChange={(e) => setForm({ ...form, icon: e.target.value })}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-sm text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary-500 appearance-none cursor-pointer"
                      >
                        <option value="">{tM("fields.no_icon")}</option>
                        {CONTEXT_ICON_CHOICES.map((choice) => (
                          <option key={choice.value} value={choice.value}>
                            {choice.value}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-end pb-1">
                      <label className="flex items-center gap-2.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={form.is_active}
                          onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                          className="w-4 h-4 rounded border-2 border-gray-300 dark:border-slate-600 accent-primary-500 cursor-pointer"
                        />
                        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                          {tM("fields.is_active")}
                        </span>
                      </label>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-3 mt-5">
                    <button
                      onClick={() => { setEditing(null); setForm(EMPTY_FORM); setFieldErrors({}); }}
                      className="px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-semibold hover:bg-primary-600 transition-colors shadow-sm cursor-pointer disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      {t("common.save_changes")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-3.5 py-3 rounded-xl bg-gray-50 dark:bg-slate-800/60 text-xs text-gray-500 dark:text-gray-400">
                  <ArrowDownUp className="w-4 h-4 shrink-0" />
                  <span>{tM("hint")}</span>
                </div>
              )}
            </div>
          </motion.div>

          <ConfirmationModal
            isOpen={deleteTarget !== null}
            type="danger"
            title={tM("delete_title")}
            message={
              deleteTarget
                ? tM("delete_message", { name: label(deleteTarget) })
                : ""
            }
            confirmText={tM("delete_button") || t("common.delete")}
            loading={deleting}
            onClose={() => { if (!deleting) setDeleteTarget(null); }}
            onConfirm={handleDelete}
          />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}