"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle, Building2, ChevronRight, Loader2, Settings2, Sliders,
} from "lucide-react";
import apiClient from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import PageGuideModal from "@/components/PageGuideModal";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import type { DraftPayload } from "./_components/RuleFormPanel";
import RuleListPanel from "./_components/RuleListPanel";
import RuleFormPanel from "./_components/RuleFormPanel";
import {
  CONTEXT_META,
  DEFAULT_CONTEXT_META,
  ROLE_STYLE,
  ROLES,
  type OptionsData,
  type Role,
  type RuleType,
} from "./_components/types";

export default function RuleConfigPage() {
  const { t } = useLanguage();
  const { hasPermission, selectedHouse } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const canView = hasPermission("rule_config.view");
  const canCreate = hasPermission("rule_config.create");
  const canEdit = hasPermission("rule_config.edit");
  const canDelete = hasPermission("rule_config.delete");
  const [houses, setHouses] = useState<{ id: number; name: string; code: string; display_name: string }[]>([]);
  const [selectedHouseId, setSelectedHouseId] = useState<string>(
    selectedHouse?.id ? String(selectedHouse.id) : ""
  );
  const houseId: number | null = selectedHouseId ? Number(selectedHouseId) : null;
  const headers = useMemo(() => (houseId ? { "X-House-ID": String(houseId) } : {} as Record<string, string>), [houseId]);

  const paramCtx = searchParams.get("context");
  const paramRole = searchParams.get("role");

  const [options, setOptions] = useState<OptionsData | null>(null);
  const [allRules, setAllRules] = useState<RuleType[]>([]);

  const [activeContext, setActiveContext] = useState<string>(() => {
    const p = paramCtx;
    return p ?? "";
  });
  const [activeRole, setActiveRole] = useState<Role>(() => {
    const p = paramRole?.toUpperCase();
    return ROLES.includes(p as Role) ? (p as Role) : "HOUSE";
  });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creatingNew, setCreatingNew] = useState(true);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RuleType | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [authRedirect, setAuthRedirect] = useState(false);

  useEffect(() => {
    if (!canView && !authRedirect) {
      const timer = setTimeout(() => { router.push("/"); setAuthRedirect(true); }, 400);
      return () => clearTimeout(timer);
    }
  }, [canView, authRedirect, router]);

  useEffect(() => {
    if (canView) {
      apiClient.get("houses/accessible").then((res) => {
        setHouses(res.data);
        const data = res.data as { id: number; display_name?: string }[];
        if (data.length === 1 && !selectedHouseId) {
          setSelectedHouseId(String(data[0].id));
        } else if (data.length === 0) {
          setSelectedHouseId("");
        }
      }).catch(() => {});
    }
  }, [canView, selectedHouseId]);

  const contextKeys = useMemo(() => options?.context_keys ?? [], [options]);
  const validRoles = useMemo(() => ROLES.filter((r) => (options?.roles ?? ROLES).includes(r)), [options]);

  const roleRules = useMemo(
    () => allRules.filter((r) => r.target_role === activeRole),
    [allRules, activeRole]
  );

  const selectedRule = useMemo(
    () => creatingNew ? null : roleRules.find((r) => r.id === selectedId) ?? null,
    [roleRules, selectedId, creatingNew]
  );

  const formKey = useMemo(
    () => creatingNew ? `new-${activeRole}-${activeContext}` : `rule-${selectedId}-${activeContext}`,
    [creatingNew, selectedId, activeRole, activeContext]
  );

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (paramCtx) {
      setActiveContext(paramCtx);
      setSelectedId(null);
      setCreatingNew(true);
    }
    if (paramRole) {
      const r = paramRole.toUpperCase();
      if (ROLES.includes(r as Role)) setActiveRole(r as Role);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [paramCtx, paramRole]);

  const load = useCallback(async () => {
    if (!houseId || !canView) return;
    setLoading(true);
    setError(null);
    try {
      const [optRes, ruleRes] = await Promise.all([
        apiClient.get<OptionsData>("/rule-config/options", { headers }),
        apiClient.get<{ data: RuleType[] }>("/rule-config", {
          params: { per_page: 100 },
          headers,
        }),
      ]);
      setOptions(optRes.data);
      setAllRules(ruleRes.data.data ?? []);
      if (!activeContext && optRes.data.context_keys.length > 0) {
        setActiveContext(optRes.data.context_keys[0]);
      }
    } catch {
      setError("Failed to load rule configuration");
    } finally {
      setLoading(false);
    }
  }, [houseId, canView, headers]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (canView && houseId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      load();
    }
  }, [canView, houseId, load]);

  function handleSelectRule(rule: RuleType) {
    setSelectedId(rule.id);
    setCreatingNew(false);
  }

  function handleCreateNew() {
    setSelectedId(null);
    setCreatingNew(true);
    setError(null);
  }

  async function handleSave(payload: DraftPayload): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      const body = {
        context_key: activeContext,
        rule_name: payload.rule_name.trim(),
        target_role: activeRole,
        is_active: payload.is_active,
        excluded_product_codes: payload.excluded_product_codes,
        excluded_retailer_types: payload.excluded_retailer_types,
        included_employee_ids: payload.included_employee_ids,
      };
      if (!creatingNew && selectedId != null) {
        await apiClient.patch(`/rule-config/${selectedId}`, body, { headers });
      } else {
        const res = await apiClient.post<{ id: number; updated_at: string | null }>("/rule-config", body, { headers });
        setSelectedId(res.data.id);
        setCreatingNew(false);
      }
      await load();
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save rule";
      setError(msg);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(rule: RuleType) {
    setDeleting(true);
    setError(null);
    try {
      await apiClient.delete(`/rule-config/${rule.id}`, { headers });
      setSelectedId(null);
      setCreatingNew(true);
      await load();
    } catch {
      setError("Failed to delete rule");
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  async function handleToggleActive(rule: RuleType) {
    setSaving(true);
    setError(null);
    try {
      await apiClient.patch(`/rule-config/${rule.id}`, { is_active: true }, { headers });
      await load();
    } catch {
      setError("Failed to toggle rule status");
    } finally {
      setSaving(false);
    }
  }

  if (authRedirect || !canView) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
        <div className="w-16 h-16 rounded-2xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center mb-4">
          <AlertCircle className="w-8 h-8 text-red-500" />
        </div>
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">{t("common.access_denied")}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center max-w-md">{t("common.unauthorized_msg")}</p>
      </div>
    );
  }

  if (!houseId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
        <Sliders className="w-12 h-12 text-gray-300 dark:text-gray-600 mb-3" />
        <p className="text-sm text-gray-500 dark:text-gray-400 font-medium mb-4">{t("common.select_house")}</p>
        {houses.length > 0 && (
          <div className="relative">
            <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <select
              value={selectedHouseId}
              onChange={(e) => setSelectedHouseId(e.target.value)}
              className="pl-9 pr-10 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-sm font-medium text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors shadow-sm outline-none focus:ring-2 focus:ring-primary-500 appearance-none cursor-pointer min-w-[220px]"
            >
              <option value="">{t("common.select_house")}</option>
              {houses.map((h) => (
                <option key={h.id} value={h.id}>{h.display_name || h.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>
    );
  }

  if (loading && !options) {
    return (
      <div className="p-4 lg:p-6 space-y-4">
        <div className="h-10 w-64 bg-gray-200 dark:bg-slate-700 rounded-xl animate-pulse" />
        <div className="flex gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-10 w-32 bg-gray-200 dark:bg-slate-700 rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="flex gap-6 mt-4">
          <div className="w-48 space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-12 bg-gray-200 dark:bg-slate-700 rounded-xl animate-pulse" />
            ))}
          </div>
          <div className="flex-1 grid grid-cols-1 xl:grid-cols-[340px_1fr] gap-6">
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-16 bg-gray-200 dark:bg-slate-700 rounded-xl animate-pulse" />
              ))}
            </div>
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-10 bg-gray-200 dark:bg-slate-700 rounded-xl animate-pulse" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 flex flex-col min-h-[calc(100dvh-5rem)]">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-primary-50 to-primary-100 dark:from-primary-500/15 dark:to-primary-600/10 flex items-center justify-center shrink-0 shadow-sm">
            <Sliders className="w-5 h-5 text-primary-600 dark:text-primary-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">
              {t("rule_config.list.title")}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              {t("rule_config.list.subtitle")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {houses.length > 1 && (
            <div className="relative">
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <select
                value={selectedHouseId}
                onChange={(e) => { setSelectedHouseId(e.target.value); setSelectedId(null); setCreatingNew(true); setError(null); }}
                className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg text-sm font-medium text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors shadow-sm outline-none focus:ring-2 focus:ring-primary-500 appearance-none cursor-pointer min-w-[160px]"
              >
                <option value="">{t("common.select_house")}</option>
                {houses.map((h) => (
                  <option key={h.id} value={h.id}>{h.display_name || h.name}</option>
                ))}
              </select>
            </div>
          )}
          <PageGuideModal pageKey="rule_config" />
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-sm text-red-600 dark:text-red-400 mb-4">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-400 hover:text-red-600 dark:hover:text-red-300"
          >
            ×
          </button>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-5 flex-1 min-h-0">
        <aside className="hidden lg:flex flex-col w-64 shrink-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2 px-1">
            {t("rule_config.page.contexts_title")}
          </p>
          <div className="space-y-1.5">
            {contextKeys.map((ctx) => {
              const meta = CONTEXT_META[ctx] ?? DEFAULT_CONTEXT_META;
              const IconComp = meta.icon ?? Settings2;
              const isActive = ctx === activeContext;
              const count = allRules.filter((r) => r.context_key === ctx).length;
              const activeCount = allRules.filter((r) => r.context_key === ctx && r.is_active).length;
              const ctxLabel = t(`rule_config.contexts.${ctx}`);
              return (
                <button
                  key={ctx}
                  onClick={() => { setActiveContext(ctx); setSelectedId(null); setCreatingNew(true); setError(null); }}
                  className={cn(
                    "w-full flex items-center gap-3 px-3.5 py-3 rounded-xl border text-left transition-all cursor-pointer",
                    isActive
                      ? `${meta.active} border-current shadow-sm`
                      : "bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-slate-600"
                  )}
                >
                  <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0", meta.iconBg)}>
                    <IconComp className="w-4.5 h-4.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{ctxLabel}</p>
                    <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
                      {count === 0
                        ? t("rule_config.messages.no_data")
                        : `${activeCount} / ${count} ${t("common.active")}`}
                    </p>
                  </div>
                  <ChevronRight className={cn("w-4 h-4 shrink-0", isActive ? "opacity-60" : "opacity-30")} />
                </button>
              );
            })}
            {contextKeys.length === 0 && (
              <div className="text-sm text-gray-400 dark:text-gray-500 py-6 text-center">
                {t("rule_config.messages.no_data")}
              </div>
            )}
          </div>
        </aside>

        <div className="flex lg:hidden gap-2 overflow-x-auto pb-2 -mx-4 px-4">
          {contextKeys.map((ctx) => {
            const meta = CONTEXT_META[ctx] ?? DEFAULT_CONTEXT_META;
            const IconComp = meta.icon ?? Settings2;
            const isActive = ctx === activeContext;
            const ctxLabel = t(`rule_config.contexts.${ctx}`);
            return (
              <button
                key={ctx}
                onClick={() => { setActiveContext(ctx); setSelectedId(null); setCreatingNew(true); setError(null); }}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-semibold whitespace-nowrap shrink-0 transition-all cursor-pointer",
                  isActive
                    ? `${meta.active} border-current shadow-sm`
                    : "bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-300"
                )}
              >
                <IconComp className="w-4 h-4" />
                {ctxLabel}
              </button>
            );
          })}
        </div>

        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <div className="flex gap-2 overflow-x-auto pb-2 mb-4 -mx-1 px-1">
            {validRoles.map((r) => {
              const meta = ROLE_STYLE[r as Role] ?? ROLE_STYLE.HOUSE;
              const isActive = r === activeRole;
              const hasRule = allRules.some((rule) => rule.target_role === r && rule.context_key === activeContext);
              return (
                <button
                  key={r}
                  onClick={() => setActiveRole(r as Role)}
                  className={cn(
                    "flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold border transition-all whitespace-nowrap cursor-pointer",
                    isActive
                      ? "bg-primary-500 text-white border-primary-500 shadow-sm"
                      : "bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-slate-600"
                  )}
                >
                  <span aria-hidden="true">{meta.icon}</span>
                  {t(`rule_config.roles.${r}`)}
                  {hasRule && (
                    <span className={cn(
                      "w-2 h-2 rounded-full shrink-0",
                      allRules.some((rule) => rule.target_role === r && rule.context_key === activeContext && rule.is_active)
                        ? "bg-emerald-500"
                        : "bg-gray-400 dark:bg-gray-500"
                    )} />
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)] gap-5">
            <div className="min-h-[280px] xl:min-h-0 flex flex-col">
              <RuleListPanel
                rules={roleRules}
                selectedId={creatingNew ? null : selectedId}
                canCreate={canCreate || canEdit}
                onCreate={handleCreateNew}
                onSelect={handleSelectRule}
              />
            </div>
            <div className="min-h-[320px] xl:min-h-0 flex flex-col bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 p-4 shadow-sm">
              {(loading && allRules.length === 0) ? (
                <div className="flex-1 flex flex-col items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 text-primary-500 animate-spin mb-3" />
                  <p className="text-sm text-gray-500 dark:text-gray-400">{t("common.loading")}</p>
                </div>
              ) : (
                <RuleFormPanel
                  key={formKey}
                  rule={selectedRule}
                  isNew={creatingNew}
                  options={options}
                  role={activeRole}
                  canCreate={canCreate}
                  canEdit={canEdit}
                  canDelete={canDelete}
                  saving={saving}
                  deleting={deleting}
                  error={error}
                  onSaveDraft={handleSave}
                  onDelete={setDeleteTarget}
                  onToggleActive={handleToggleActive}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      <ConfirmationModal
        isOpen={deleteTarget !== null}
        type="danger"
        title={t("rule_config.messages.delete_title")}
        message={deleteTarget ? t("rule_config.messages.delete_message", { name: deleteTarget.rule_name }) : ""}
        confirmText={t("rule_config.messages.delete_button") || t("common.delete")}
        loading={deleting}
        onClose={() => { if (!deleting) setDeleteTarget(null); }}
        onConfirm={() => { if (deleteTarget) handleDelete(deleteTarget); }}
      />
    </div>
  );
}