"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Save, Trash2, Power, Plus, Sliders, AlertCircle, RotateCcw, Check, ChevronDown,
} from "lucide-react";
import apiClient from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import EntitySelector, { type SelectorItem } from "@/app/zoom-in/_components/EntitySelector";

const ROLES = ["HOUSE", "SUPERVISOR", "RSO", "BP"] as const;
type Role = (typeof ROLES)[number];

const ROLE_STYLE: Record<Role, { icon: string; active: string; chip: string }> = {
  HOUSE: { icon: "🏠", active: "bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300", chip: "bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300" },
  SUPERVISOR: { icon: "👔", active: "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300", chip: "bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300" },
  RSO: { icon: "👤", active: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", chip: "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  BP: { icon: "🏅", active: "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300", chip: "bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300" },
};

interface RuleType {
  id: number;
  house_id: number | null;
  context_key: string;
  rule_name: string;
  target_role: string;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
  excluded_product_codes: string[];
  excluded_retailer_types: string[];
  included_employee_ids: number[];
}

interface ProductOption { code: string; name: string }
interface RetailerTypeOption { name: string; code: string }
interface EmployeeOption { id: number; user_id: number | null; name: string; employee_type: string; dms_code: string }

interface OptionsData {
  product_codes: ProductOption[];
  retailer_types: RetailerTypeOption[];
  employees: EmployeeOption[];
  roles: string[];
  context_keys: string[];
}

interface DefineRuleModalProps {
  open: boolean;
  houseId: number;
  contextKey: string;
  initialRole?: string | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function DefineRuleModal({
  open, houseId, contextKey, initialRole, onClose, onSaved,
}: DefineRuleModalProps) {
  const { t } = useLanguage();
  const { hasPermission } = useAuth();

  const [options, setOptions] = useState<OptionsData | null>(null);
  const [rules, setRules] = useState<RuleType[]>([]);
  const [role, setRole] = useState<Role>((initialRole as Role) || "HOUSE");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [ruleName, setRuleName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [excludedCodes, setExcludedCodes] = useState<string[]>([]);
  const [excludedTypes, setExcludedTypes] = useState<string[]>([]);
  const [includedEmpUserIds, setIncludedEmpUserIds] = useState<number[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [ruleMenuOpen, setRuleMenuOpen] = useState(false);

  const canCreate = hasPermission("rule_config.create");
  const canEdit = hasPermission("rule_config.edit");
  const canDelete = hasPermission("rule_config.delete");

  const headers = useMemo(() => ({ "X-House-ID": String(houseId) }), [houseId]);

  function populateForm(r: Role, rulesList: RuleType[]) {
    const target =
      rulesList.find((x) => x.target_role === r && x.is_active) ??
      rulesList.find((x) => x.target_role === r) ??
      null;
    if (target) {
      setEditingId(target.id);
      setRuleName(target.rule_name);
      setIsActive(target.is_active);
      setExcludedCodes(target.excluded_product_codes ?? []);
      setExcludedTypes(target.excluded_retailer_types ?? []);
      setIncludedEmpUserIds(target.included_employee_ids ?? []);
    } else {
      setEditingId(null);
      setRuleName("");
      setIsActive(true);
      setExcludedCodes([]);
      setExcludedTypes([]);
      setIncludedEmpUserIds([]);
    }
    setDirty(false);
    setSaved(false);
  }

  function loadRuleFields(rule: RuleType) {
    setEditingId(rule.id);
    setRuleName(rule.rule_name);
    setIsActive(rule.is_active);
    setExcludedCodes(rule.excluded_product_codes ?? []);
    setExcludedTypes(rule.excluded_retailer_types ?? []);
    setIncludedEmpUserIds(rule.included_employee_ids ?? []);
    setDirty(false);
    setSaved(false);
  }

  async function load() {
    setLoading(true);
    setError(null);
    setSaved(false);
    try {
      const [optRes, ruleRes] = await Promise.all([
        apiClient.get<OptionsData>("/rule-config/options", { headers }),
        apiClient.get<{ data: RuleType[] }>("/rule-config", {
          params: { context_key: contextKey, per_page: 100 },
          headers,
        }),
      ]);
      const rulesList = ruleRes.data.data || [];
      setOptions(optRes.data);
      setRules(rulesList);
      populateForm(role, rulesList);
    } catch {
      setError("Failed to load rule configuration");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open || !houseId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, houseId]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const roleRules = useMemo(
    () => rules.filter((r) => r.target_role === role),
    [rules, role]
  );
  const currentRule = useMemo(
    () => roleRules.find((r) => r.is_active) ?? roleRules[0] ?? null,
    [roleRules]
  );
  const displayRule = useMemo(
    () => roleRules.find((r) => r.id === editingId) ?? currentRule,
    [roleRules, editingId, currentRule]
  );

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

  function resetFormToNew() {
    setEditingId(null);
    setRuleName("");
    setIsActive(true);
    setExcludedCodes([]);
    setExcludedTypes([]);
    setIncludedEmpUserIds([]);
    setDirty(false);
    setSaved(false);
  }

  function selectRole(next: Role) {
    setRole(next);
    populateForm(next, rules);
  }

  async function handleSave() {
    if (!ruleName.trim()) {
      setError(t("rule_config.validation.rule_name_required"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        context_key: contextKey,
        rule_name: ruleName.trim(),
        target_role: role,
        is_active: isActive,
        excluded_product_codes: excludedCodes,
        excluded_retailer_types: excludedTypes,
        included_employee_ids: includedEmpUserIds,
      };
      if (editingId != null) {
        await apiClient.patch(`/rule-config/${editingId}`, payload, { headers });
      } else {
        await apiClient.post("/rule-config", payload, { headers });
      }
      await load();
      onSaved();
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      const m = err instanceof Error ? err.message : "Failed to save rule";
      setError(m);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (editingId == null || !confirm(t("rule_config.messages.delete_confirm"))) return;
    setDeleting(true);
    setError(null);
    try {
      await apiClient.delete(`/rule-config/${editingId}`, { headers });
      setEditingId(null);
      await load();
      onSaved();
      resetFormToNew();
    } catch {
      setError("Failed to delete rule");
    } finally {
      setDeleting(false);
    }
  }

  async function handleToggleActive() {
    if (editingId == null) return;
    setSaving(true);
    setError(null);
    try {
      await apiClient.patch(`/rule-config/${editingId}`, { is_active: !isActive }, { headers });
      setIsActive(!isActive);
      await load();
      onSaved();
    } catch {
      setError("Failed to toggle rule status");
    } finally {
      setSaving(false);
    }
  }

  const selectedEmpCount = includedEmpUserIds.length;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 backdrop-blur-md p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 24 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl max-h-[92vh] bg-white dark:bg-slate-900 rounded-3xl border border-gray-200 dark:border-slate-700/80 shadow-2xl flex flex-col overflow-hidden"
          >
            <div className="relative shrink-0">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary-400 via-primary-500 to-primary-600" />
              <div className="px-6 py-5 border-b border-gray-100 dark:border-slate-700/50">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-primary-50 to-primary-100 dark:from-primary-500/15 dark:to-primary-600/10 flex items-center justify-center shrink-0 shadow-sm">
                      <Sliders className="w-5 h-5 text-primary-600 dark:text-primary-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                        {t("rule_config.list.title")}
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                        {t("rule_config.list.subtitle")}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={onClose}
                    className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors -mr-1 -mt-1"
                    aria-label={t("common.close")}
                  >
                    <X className="w-4.5 h-4.5" />
                  </button>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
              {loading ? (
                <div className="py-10 space-y-5 animate-pulse">
                  <div className="flex gap-2">
                    {ROLES.map((r) => (
                      <div key={r} className="h-9 w-20 bg-gray-200 dark:bg-slate-700 rounded-xl" />
                    ))}
                  </div>
                  <div className="h-10 w-full bg-gray-100 dark:bg-slate-800 rounded-xl" />
                  <div className="h-10 w-full bg-gray-100 dark:bg-slate-800 rounded-xl" />
                  <div className="h-10 w-full bg-gray-100 dark:bg-slate-800 rounded-xl" />
                </div>
              ) : error && !options && !rules.length ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <div className="w-14 h-14 rounded-2xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center mb-4">
                    <AlertCircle className="w-7 h-7 text-red-500" />
                  </div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">Failed to load</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">{error}</p>
                  <button
                    onClick={() => load()}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary-500 text-white text-sm font-medium hover:bg-primary-600 transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Retry
                  </button>
                </div>
              ) : (
                <>
                  {(canCreate || canEdit) && (
                    <div className="flex flex-wrap gap-2">
                      {ROLES.map((r) => {
                        const hasRule = rules.some((rule) => rule.target_role === r);
                        const isActiveRule = rules.some((rule) => rule.target_role === r && rule.is_active);
                        const meta = ROLE_STYLE[r];
                        return (
                          <button
                            key={r}
                            type="button"
                            onClick={() => selectRole(r)}
                            className={cn(
                              "flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-semibold border transition-all cursor-pointer",
                              role === r
                                ? "bg-primary-500 text-white border-primary-500 shadow-sm"
                                : "bg-white dark:bg-slate-800/60 border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-slate-600"
                            )}
                          >
                            <span aria-hidden="true">{meta.icon}</span>
                            {t(`rule_config.roles.${r}`)}
                            {hasRule && (
                              <span
                                title={isActiveRule ? "active" : "inactive"}
                                className={cn(
                                  "w-2 h-2 rounded-full shrink-0",
                                  isActiveRule ? "bg-emerald-500" : "bg-gray-400"
                                )}
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {!(canCreate || canEdit) ? (
                    <div className="flex flex-col items-center py-10 text-center bg-gray-50 dark:bg-slate-800/30 rounded-2xl border border-dashed border-gray-200 dark:border-slate-700">
                      <Sliders className="w-8 h-8 text-gray-300 dark:text-gray-600 mb-2" />
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {t("common.access_denied")}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-5">
                      {error && (
                        <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-sm text-red-600 dark:text-red-400">
                          <AlertCircle className="w-4 h-4 shrink-0" />
                          {error}
                        </div>
                      )}

                      {!currentRule && editingId == null && !roleRules.some((r) => r.is_active) && (
                        <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
                          <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                          <p className="text-xs text-amber-700 dark:text-amber-300">
                            {roleRules.length === 0
                              ? t("rule_config.messages.empty_hint")
                              : t("rule_config.messages.no_active")}
                          </p>
                        </div>
                      )}

                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <div className={cn("px-2.5 py-1 rounded-full text-xs font-semibold", ROLE_STYLE[role].chip)}>
                            {ROLE_STYLE[role].icon} {t(`rule_config.roles.${role}`)}
                          </div>
                          {roleRules.length > 0 && (
                            <span className="text-xs text-gray-400">
                              {roleRules.filter((r) => r.is_active).length} active
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {editingId != null && (
                            <button
                              type="button"
                              onClick={resetFormToNew}
                              disabled={!canCreate}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 cursor-pointer"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              {t("rule_config.list.define")}
                            </button>
                          )}
                          {editingId != null && !isActive && (
                            <button
                              type="button"
                              onClick={handleToggleActive}
                              disabled={saving || !canEdit}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors disabled:opacity-50 cursor-pointer"
                            >
                              <Power className="w-3.5 h-3.5" />
                              {t("rule_config.messages.activate_success")}
                            </button>
                          )}
                        </div>
                      </div>

                      {roleRules.length > 0 && (
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => setRuleMenuOpen((o) => !o)}
                            className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-sm text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-slate-600 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                          >
                            <span className="flex items-center gap-2 min-w-0">
                              <span className="truncate">
                                {editingId == null
                                  ? t("rule_config.list.define")
                                  : displayRule?.rule_name ?? t("rule_config.fields.rule_name_placeholder")}
                              </span>
                              {editingId != null && displayRule?.is_active && (
                                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-bold">
                                  {t("common.active")}
                                </span>
                              )}
                            </span>
                            <span className="flex items-center gap-1.5 shrink-0">
                              <span className="text-xs text-gray-400">
                                {t("rule_config.list.rule_count", { count: roleRules.length })}
                              </span>
                              <ChevronDown className={cn("w-4 h-4 text-gray-400 transition-transform", ruleMenuOpen && "rotate-180")} />
                            </span>
                          </button>
                          {ruleMenuOpen && (
                            <>
                              <div className="fixed inset-0 z-40" onClick={() => setRuleMenuOpen(false)} />
                              <div className="absolute z-50 mt-1.5 w-full max-h-48 overflow-y-auto rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 shadow-lg py-1">
                                <button
                                  type="button"
                                  onClick={() => { setRuleMenuOpen(false); resetFormToNew(); }}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                  {t("rule_config.list.define")}
                                </button>
                                <div className="h-px bg-gray-100 dark:bg-slate-800 my-1" />
                                {roleRules.map((r) => (
                                  <button
                                    key={r.id}
                                    type="button"
                                    onClick={() => { setRuleMenuOpen(false); loadRuleFields(r); }}
                                    className={cn(
                                      "w-full flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer",
                                      r.id === editingId
                                        ? "text-primary-600 dark:text-primary-400 font-semibold"
                                        : "text-gray-700 dark:text-gray-300"
                                    )}
                                  >
                                    <span className="flex items-center gap-2 min-w-0">
                                      {r.id === editingId && <Check className="w-3.5 h-3.5 shrink-0" />}
                                      <span className="truncate">{r.rule_name}</span>
                                    </span>
                                    <span className={cn(
                                      "shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-bold",
                                      r.is_active
                                        ? "bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                                        : "bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400"
                                    )}>
                                      {r.is_active ? t("common.active") : t("common.inactive")}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      )}

                      <div>
                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                          {t("rule_config.fields.rule_name")} <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={ruleName}
                          onChange={(e) => { setRuleName(e.target.value); setDirty(true); }}
                          placeholder={t("rule_config.fields.rule_name_placeholder")}
                          className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
                        />
                      </div>

                      <EntitySelector
                        label={t("rule_config.fields.excluded_product_codes")}
                        items={productItems}
                        selectedIds={excludedCodes}
                        onChange={(ids) => { setExcludedCodes(ids.map(String)); setDirty(true); }}
                        placeholder={t("rule_config.fields.excluded_product_codes")}
                        searchPlaceholder={t("common.search")}
                        emptyMessage={t("rule_config.empty.products")}
                        noResultsMessage={t("rule_config.empty.no_products_match")}
                        selectAllLabel={t("common.select_all")}
                        clearLabel={t("common.clear")}
                        selectedLabel={t("rule_config.fields.excluded_product_codes")}
                      />
                      <p className="text-[11px] text-gray-400 dark:text-gray-500 -mt-3 px-1">
                        {t("rule_config.fields.excluded_product_codes_hint")}
                      </p>

                      <EntitySelector
                        label={t("rule_config.fields.excluded_retailer_types")}
                        items={typeItems}
                        selectedIds={excludedTypes}
                        onChange={(ids) => { setExcludedTypes(ids.map(String)); setDirty(true); }}
                        placeholder={t("rule_config.fields.excluded_retailer_types")}
                        searchPlaceholder={t("common.search")}
                        emptyMessage={t("rule_config.empty.types")}
                        noResultsMessage={t("rule_config.empty.no_types_match")}
                        selectAllLabel={t("common.select_all")}
                        clearLabel={t("common.clear")}
                        selectedLabel={t("rule_config.fields.excluded_retailer_types")}
                      />
                      <p className="text-[11px] text-gray-400 dark:text-gray-500 -mt-3 px-1">
                        {t("rule_config.fields.excluded_retailer_types_hint")}
                      </p>

                      <EntitySelector
                        label={t("rule_config.fields.included_employees")}
                        items={employeeItems}
                        selectedIds={includedEmpUserIds}
                        onChange={(ids) => { setIncludedEmpUserIds(ids.map(Number)); setDirty(true); }}
                        placeholder={t("rule_config.fields.included_employees")}
                        searchPlaceholder={t("common.search")}
                        emptyMessage={t("rule_config.empty.employees")}
                        noResultsMessage={t("rule_config.empty.no_employees_match")}
                        selectAllLabel={t("common.select_all")}
                        clearLabel={t("common.clear")}
                        selectedLabel={t("common.user")}
                      />
                      <p className="text-[11px] text-gray-400 dark:text-gray-500 -mt-3 px-1">
                        {t("rule_config.fields.included_employees_hint")}
                      </p>

                      {selectedEmpCount > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {includedEmpUserIds.map((uid) => {
                            const emp = options?.employees.find((e) => e.user_id === uid);
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
                  )}
                </>
              )}
            </div>

            {(canCreate || canEdit) && !loading && (
              <div className="shrink-0 px-6 py-4 border-t border-gray-100 dark:border-slate-700/50 bg-gray-50/50 dark:bg-slate-900/50">
                <div className="flex items-center gap-3">
                  {editingId != null && canDelete && (
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors disabled:opacity-50 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                      {t("common.delete")}
                    </button>
                  )}
                  <div className="flex-1" />
                  <button
                    onClick={onClose}
                    disabled={saving}
                    className="px-5 py-2.5 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                  >
                    {t("common.cancel")}
                  </button>
                  <motion.button
                    onClick={handleSave}
                    disabled={saving || (!dirty && editingId != null && isActive)}
                    whileHover={saving ? {} : { scale: 1.02 }}
                    whileTap={saving ? {} : { scale: 0.97 }}
                    className={cn(
                      "px-7 py-2.5 rounded-xl text-sm font-bold text-white transition-all duration-200 flex items-center gap-2.5 shadow-lg cursor-pointer",
                      saved
                        ? "bg-green-500 shadow-green-500/25"
                        : saving
                          ? "bg-primary-400 cursor-not-allowed shadow-primary-400/20"
                          : "bg-primary-600 hover:bg-primary-700 shadow-primary-600/25 hover:shadow-primary-600/40",
                      saving && "opacity-80"
                    )}
                  >
                    {saving ? (
                      <>
                        <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                        {t("common.processing")}
                      </>
                    ) : saved ? (
                      <>
                        <Check className="w-4 h-4" />
                        {t("common.done")}
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        {editingId != null ? t("common.save_changes") : t("rule_config.list.define")}
                      </>
                    )}
                  </motion.button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}