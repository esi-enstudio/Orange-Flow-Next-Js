"use client";

import { useMemo, useState } from "react";
import { AlertCircle, Check, Columns3, LayoutGrid, Loader2, Power, Save, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/useLanguage";
import EntitySelector, { type SelectorItem } from "@/app/zoom-in/_components/EntitySelector";
import { GA_LIVE_SECTIONS, RULE_COLUMNS, RULE_SECTIONS, ROLE_STYLE, type EmployeeOption, type OptionsData, type Role, type RuleType } from "./types";

interface RuleFormPanelProps {
  rule: RuleType | null;
  isNew: boolean;
  options: OptionsData | null;
  role: Role;
  contextKey: string;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  saving: boolean;
  deleting: boolean;
  error: string | null;
  onSaveDraft: (payload: DraftPayload) => Promise<boolean>;
  onDelete: (rule: RuleType) => void;
  onToggleActive: (rule: RuleType) => void;
}

export interface DraftPayload {
  rule_name: string;
  apply_to: string;
  column_key: string;
  is_active: boolean;
  excluded_product_codes: string[];
  excluded_retailer_types: string[];
  included_employee_ids: number[];
}

export default function RuleFormPanel({
  rule,
  isNew,
  options,
  role,
  contextKey,
  canCreate,
  canEdit,
  canDelete,
  saving,
  deleting,
  error,
  onSaveDraft,
  onDelete,
  onToggleActive,
}: RuleFormPanelProps) {
  const { t } = useLanguage();

  const [draft, setDraft] = useState<DraftPayload>(() => {
    if (!rule) return { rule_name: "", apply_to: "all", column_key: "all", is_active: true, excluded_product_codes: [], excluded_retailer_types: [], included_employee_ids: [] };
    return {
      rule_name: rule.rule_name ?? "",
      apply_to: rule.apply_to ?? "all",
      column_key: rule.column_key ?? "all",
      is_active: rule.is_active,
      excluded_product_codes: rule.excluded_product_codes ?? [],
      excluded_retailer_types: rule.excluded_retailer_types ?? [],
      included_employee_ids: rule.included_employee_ids ?? [],
    };
  });
  const [dirty, setDirty] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [ruleNameError, setRuleNameError] = useState<string | null>(null);

  const editingId = rule?.id ?? null;
  const canWrite = isNew ? canCreate : canEdit;
  const displayContext = rule ? rule.context_key : contextKey;
  const contextLabel = (ctx: string) => {
    const label = t(`rule_config.contexts.${ctx}`);
    return label === `rule_config.contexts.${ctx}` ? ctx : label;
  };

  const productItems: SelectorItem[] = useMemo(
    () => (options?.product_codes ?? []).map((p) => ({ id: p.code, label: p.code, sublabel: p.name === p.code ? undefined : p.name })),
    [options]
  );
  const typeItems: SelectorItem[] = useMemo(
    () => (options?.retailer_types ?? []).map((rt) => ({ id: rt.name, label: rt.name, badge: rt.code })),
    [options]
  );
  const employeeItems: SelectorItem[] = useMemo(
    () => (options?.employees ?? [])
      .filter((e) => e.user_id != null)
      .map((e) => ({ id: e.user_id as number, label: e.name, sublabel: e.dms_code || undefined, badge: e.employee_type?.toUpperCase() })),
    [options]
  );

  const selectedEmpCount = draft.included_employee_ids.length;

  async function handleSave() {
    if (!draft.rule_name.trim()) {
      setRuleNameError(t("rule_config.validation.rule_name_required"));
      return;
    }
    setRuleNameError(null);
    const ok = await onSaveDraft(draft);
    if (ok) {
      setDirty(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn("px-2.5 py-1 rounded-full text-xs font-semibold", ROLE_STYLE[role].chip)}>
            {ROLE_STYLE[role].icon} {t(`rule_config.roles.${role}`)}
          </span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400 font-semibold">
            {contextLabel(displayContext)}
          </span>
          <span className="text-sm font-bold text-gray-700 dark:text-gray-300">
            {isNew ? t("rule_config.page.new_rule") : t("rule_config.page.edit_rule")}
          </span>
        </div>
        {editingId != null && !draft.is_active && canEdit && (
          <button
            type="button"
            onClick={() => onToggleActive(rule!)}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <Power className="w-3.5 h-3.5" />
            {t("rule_config.messages.activate_success")}
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-sm text-red-600 dark:text-red-400 mb-4">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {isNew && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 mb-4">
          <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700 dark:text-amber-300">
            {t("rule_config.messages.empty_hint")}
          </p>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-4">
        <div>
          <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
            {t("rule_config.fields.rule_name")} <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={draft.rule_name}
            onChange={(e) => { setDraft((d) => ({ ...d, rule_name: e.target.value })); setDirty(true); setRuleNameError(null); }}
            placeholder={t("rule_config.fields.rule_name_placeholder")}
            className={cn(
              "w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-900 border text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400",
              ruleNameError ? "border-red-400" : "border-gray-200 dark:border-slate-700"
            )}
          />
          {ruleNameError && (
            <p className="text-xs text-red-500 mt-1">{ruleNameError}</p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700">
          <div>
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">
              {t("rule_config.fields.is_active")}
            </p>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
              {draft.is_active
                ? t("rule_config.page.active_rule_wins")
                : t("rule_config.messages.no_active")}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={draft.is_active}
            onClick={() => { setDraft((d) => ({ ...d, is_active: !d.is_active })); setDirty(true); }}
            className={cn(
              "relative w-11 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500/40 cursor-pointer",
              draft.is_active ? "bg-emerald-500" : "bg-gray-300 dark:bg-slate-700"
            )}
          >
            <span className={cn(
              "absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform",
              draft.is_active ? "left-[22px]" : "left-0.5"
            )} />
          </button>
        </div>

        {(contextKey === "activation_report" || contextKey === "ga_live") && (
          <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700">
            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
              {t("rule_config.fields.apply_to")}
            </label>
            <div className="relative">
              <LayoutGrid className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <select
                value={draft.apply_to}
                onChange={(e) => { setDraft((d) => ({ ...d, apply_to: e.target.value })); setDirty(true); }}
                disabled={!canWrite}
                className="w-full pl-9 pr-10 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm font-medium text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors outline-none focus:ring-2 focus:ring-primary-500 appearance-none cursor-pointer disabled:opacity-50"
              >
                {(contextKey === "ga_live" ? GA_LIVE_SECTIONS : RULE_SECTIONS).map((s) => (
                  <option key={s} value={s}>{t(`rule_config.sections.${s}`)}</option>
                ))}
              </select>
            </div>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1.5 px-1">
              {t("rule_config.fields.apply_to_hint")}
            </p>
          </div>
        )}

        {contextKey === "activation_report" && draft.apply_to === "rso" && (
          <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700">
            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
              {t("rule_config.fields.column_key")}
            </label>
            <div className="relative">
              <Columns3 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <select
                value={draft.column_key}
                onChange={(e) => { setDraft((d) => ({ ...d, column_key: e.target.value })); setDirty(true); }}
                disabled={!canWrite}
                className="w-full pl-9 pr-10 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm font-medium text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors outline-none focus:ring-2 focus:ring-primary-500 appearance-none cursor-pointer disabled:opacity-50"
              >
                {RULE_COLUMNS.map((c) => (
                  <option key={c} value={c}>{t(`rule_config.columns.${c}`)}</option>
                ))}
              </select>
            </div>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1.5 px-1">
              {t("rule_config.fields.column_key_hint")}
            </p>
          </div>
        )}

        <EntitySelector
          label={t("rule_config.fields.excluded_product_codes")}
          items={productItems}
          selectedIds={draft.excluded_product_codes}
          onChange={(ids) => { setDraft((d) => ({ ...d, excluded_product_codes: ids.map(String) })); setDirty(true); }}
          placeholder={t("rule_config.fields.excluded_product_codes")}
          searchPlaceholder={t("common.search")}
          emptyMessage={t("rule_config.empty.products")}
          noResultsMessage={t("rule_config.empty.no_products_match")}
          selectAllLabel={t("common.select_all")}
          clearLabel={t("common.clear")}
          selectedLabel={t("rule_config.fields.excluded_product_codes")}
          disabled={!canWrite}
        />
        <p className="text-[11px] text-gray-400 dark:text-gray-500 -mt-3 px-1">
          {t("rule_config.fields.excluded_product_codes_hint")}
        </p>

        <EntitySelector
          label={t("rule_config.fields.excluded_retailer_types")}
          items={typeItems}
          selectedIds={draft.excluded_retailer_types}
          onChange={(ids) => { setDraft((d) => ({ ...d, excluded_retailer_types: ids.map(String) })); setDirty(true); }}
          placeholder={t("rule_config.fields.excluded_retailer_types")}
          searchPlaceholder={t("common.search")}
          emptyMessage={t("rule_config.empty.types")}
          noResultsMessage={t("rule_config.empty.no_types_match")}
          selectAllLabel={t("common.select_all")}
          clearLabel={t("common.clear")}
          selectedLabel={t("rule_config.fields.excluded_retailer_types")}
          disabled={!canWrite}
        />
        <p className="text-[11px] text-gray-400 dark:text-gray-500 -mt-3 px-1">
          {t("rule_config.fields.excluded_retailer_types_hint")}
        </p>

        <EntitySelector
          label={t("rule_config.fields.included_employees")}
          items={employeeItems}
          selectedIds={draft.included_employee_ids}
          onChange={(ids) => { setDraft((d) => ({ ...d, included_employee_ids: ids.map(Number) })); setDirty(true); }}
          placeholder={t("rule_config.fields.included_employees")}
          searchPlaceholder={t("common.search")}
          emptyMessage={t("rule_config.empty.employees")}
          noResultsMessage={t("rule_config.empty.no_employees_match")}
          selectAllLabel={t("common.select_all")}
          clearLabel={t("common.clear")}
          selectedLabel={t("common.user")}
          disabled={!canWrite}
        />
        <p className="text-[11px] text-gray-400 dark:text-gray-500 -mt-3 px-1">
          {t("rule_config.fields.included_employees_hint")}
        </p>

        {selectedEmpCount > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {draft.included_employee_ids.map((uid) => {
              const emp: EmployeeOption | undefined = options?.employees.find((e) => e.user_id === uid);
              if (!emp) return null;
              const meta = ROLE_STYLE[emp.employee_type?.toUpperCase() as Role] ?? ROLE_STYLE.HOUSE;
              return (
                <span key={uid} className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium", meta.chip)}>
                  {emp.name}
                  {emp.employee_type && <span className="opacity-70">· {emp.employee_type.toUpperCase()}</span>}
                </span>
              );
            })}
          </div>
        )}
      </div>

      <div className="shrink-0 pt-4 mt-4 border-t border-gray-100 dark:border-slate-700/50 flex items-center gap-3">
        {editingId != null && canDelete && (
          <button
            type="button"
            onClick={() => onDelete(rule!)}
            disabled={deleting}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            {t("common.delete")}
          </button>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !canWrite || (!dirty && editingId != null)}
          className={cn(
            "inline-flex items-center gap-2.5 px-7 py-2.5 rounded-xl text-sm font-bold text-white transition-all duration-200 shadow-lg cursor-pointer",
            savedFlash
              ? "bg-green-500 shadow-green-500/25"
              : saving
                ? "bg-primary-400 cursor-not-allowed shadow-primary-400/20"
                : canWrite
                  ? "bg-primary-600 hover:bg-primary-700 shadow-primary-600/25 hover:shadow-primary-600/40"
                  : "bg-primary-400"
          )}
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {t("common.processing")}
            </>
          ) : savedFlash ? (
            <>
              <Check className="w-4 h-4" />
              {t("common.done")}
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              {editingId != null ? t("common.save_changes") : t("rule_config.page.create_rule")}
            </>
          )}
        </button>
      </div>
    </div>
  );
}