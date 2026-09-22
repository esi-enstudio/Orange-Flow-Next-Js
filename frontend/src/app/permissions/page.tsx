"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  CheckSquare,
  Square,
  Search,
  ChevronDown,
  Loader2,
  Shield,
  KeyRound,
  Save,
  AlertTriangle,
  LayoutGrid,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { useLanguage } from "@/i18n/useLanguage";
import PageGuideModal from "@/components/PageGuideModal";
import PermissionKeysTab from "@/components/permissions/PermissionKeysTab";
import {
  buildPermissionGroups,
  permissionLabel,
  permissionLabels,
  ACTION_CHIP_STYLES,
  type PagePermissionGroup,
  type PermissionItem,
} from "@/lib/permissionGroups";

interface Role {
  id: number;
  name: string;
  permissions: { id: number; name: string }[];
}

type Tab = "manager" | "keys";

function PermissionCheckbox({
  checked,
  indeterminate,
  onToggle,
  label,
  className,
}: {
  checked: boolean;
  indeterminate: boolean;
  onToggle: () => void;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        "w-5 h-5 rounded-md flex items-center justify-center border-2 transition-all shrink-0 cursor-pointer",
        checked
          ? "bg-primary-600 border-primary-600 text-white"
          : indeterminate
            ? "bg-primary-100 dark:bg-primary-900/30 border-primary-400 text-primary-600"
            : "border-gray-300 dark:border-slate-700",
        className
      )}
    >
      {checked && <CheckSquare className="w-3 h-3 stroke-[3]" />}
      {!checked && indeterminate && <Square className="w-2 h-2 fill-current stroke-[3]" />}
    </button>
  );
}

function PermissionsManager() {
  const { hasPermission, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useLanguage();

  const [tab, setTab] = useState<Tab>("manager");
  const [roles, setRoles] = useState<Role[]>([]);
  const [allPerms, setAllPerms] = useState<PermissionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [workingIds, setWorkingIds] = useState<Set<number>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());

  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const roleMenuRef = useRef<HTMLDivElement>(null);

  const canSave = hasPermission("roles.edit");

  const selectedRole = useMemo(
    () => roles.find((r) => r.id === selectedRoleId) || null,
    [roles, selectedRoleId]
  );

  useEffect(() => {
    if (!authLoading && !hasPermission("permissions.view") && !hasPermission("roles.view")) {
      const timer = setTimeout(() => router.push("/"), 5000);
      return () => clearTimeout(timer);
    }
  }, [authLoading, hasPermission, router]);

  useEffect(() => {
    if (authLoading || !(hasPermission("permissions.view") || hasPermission("roles.view"))) return;
    Promise.all([apiClient.get("roles"), apiClient.get("permissions")])
      .then(([rolesRes, permsRes]) => {
        setRoles(rolesRes.data);
        setAllPerms(permsRes.data);
        const paramRole = searchParams.get("role");
        const target =
          rolesRes.data.find((r: { id: number }) => String(r.id) === String(paramRole)) ||
          rolesRes.data[0] ||
          null;
        if (target) {
          setSelectedRoleId(target.id);
          setWorkingIds(new Set(target.permissions.map((p: { id: number }) => p.id)));
          setSavedIds(new Set(target.permissions.map((p: { id: number }) => p.id)));
        }
      })
      .catch(() => toast.error(t("permissions.load_failed")))
      .finally(() => setLoading(false));
  }, [authLoading, hasPermission, searchParams, t]);

  useEffect(() => {
    if (!roleMenuOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (roleMenuRef.current && !roleMenuRef.current.contains(e.target as Node)) {
        setRoleMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [roleMenuOpen]);

  const selectRole = (role: Role) => {
    setSelectedRoleId(role.id);
    setWorkingIds(new Set(role.permissions.map((p) => p.id)));
    setSavedIds(new Set(role.permissions.map((p) => p.id)));
    setRoleMenuOpen(false);
  };

  const dirty = useMemo(() => {
    if (workingIds.size !== savedIds.size) return true;
    for (const id of workingIds) if (!savedIds.has(id)) return true;
    return false;
  }, [workingIds, savedIds]);

  const groups = useMemo<PagePermissionGroup[]>(() => buildPermissionGroups(allPerms), [allPerms]);

  const allGroupPermIds = useMemo(
    () =>
      groups.reduce<number[]>((acc, g) => {
        for (const p of g.perms) acc.push(p.id);
        return acc;
      }, []),
    [groups]
  );

  const titleOf = useCallback(
    (group: PagePermissionGroup): string => {
      return t(group.translationKey || "") || group.title;
    },
    [t]
  );

  const parentOf = useCallback(
    (group: PagePermissionGroup): string => {
      return t(group.parentTranslationKey || "") || group.parentTitle || "";
    },
    [t]
  );

  const normalizedSearch = search.trim().toLowerCase();

  const filteredGroups = useMemo(() => {
    if (!normalizedSearch) return groups;
    return groups
      .map((group) => {
        const titleMatch = titleOf(group).toLowerCase().includes(normalizedSearch);
        if (titleMatch) return group;
        const perms = group.perms.filter(
          (p) =>
            p.name.toLowerCase().includes(normalizedSearch) ||
            permissionLabel(p.name).toLowerCase().includes(normalizedSearch)
        );
        return { ...group, perms };
      })
      .filter((group) => group.perms.length > 0 || titleOf(group).toLowerCase().includes(normalizedSearch));
  }, [groups, normalizedSearch, titleOf]);

  const selectedCount = workingIds.size;

  const togglePermission = (id: number) => {
    setWorkingIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleGroup = (group: PagePermissionGroup) => {
    const ids = group.perms.map((p) => p.id);
    setWorkingIds((prev) => {
      const next = new Set(prev);
      const allSel = ids.length > 0 && ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allSel) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const groupState = (group: PagePermissionGroup) => {
    const ids = group.perms.map((p) => p.id);
    const sel = ids.filter((id) => workingIds.has(id)).length;
    return {
      count: ids.length,
      selected: sel,
      full: ids.length > 0 && sel === ids.length,
      partial: sel > 0 && sel < ids.length,
    };
  };

  const selectAllGroups = () => {
    setWorkingIds(new Set(allGroupPermIds));
  };

  const clearAllGroups = () => {
    setWorkingIds(new Set());
  };

  const handleSave = async () => {
    if (!selectedRole) return;
    setSaving(true);
    try {
      await apiClient.put(`roles/${selectedRole.id}`, {
        name: selectedRole.name,
        permissions: [...workingIds],
      });
      toast.success(t("permissions.save_success"));
      setSavedIds(new Set(workingIds));
      setRoles((prev) =>
        prev.map((r) =>
          r.id === selectedRole.id
            ? { ...r, permissions: [...workingIds].map((id) => allPerms.find((p) => p.id === id) || { id, name: "" }).filter((p) => p.name) }
            : r
        )
      );
    } catch {
      toast.error(t("permissions.save_failed"));
    } finally {
      setSaving(false);
    }
  };

  const resetChanges = () => {
    setWorkingIds(new Set(savedIds));
  };

  const canNavigateAway = () => !dirty || window.confirm(t("permissions.unsaved_confirm"));

  if (!authLoading && !hasPermission("permissions.view") && !hasPermission("roles.view")) {
    return <AccessDenied />;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t("permissions.manager_title")}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t("permissions.manager_description")}
          </p>
        </div>
        <PageGuideModal pageKey="permissions" />
      </div>

      <div className="flex gap-1.5 items-center p-1 bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-2xl w-full sm:w-fit">
        <button
          onClick={() => setTab("manager")}
          className={cn(
            "flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-colors flex-1 sm:flex-none cursor-pointer",
            tab === "manager"
              ? "bg-primary-600 text-white shadow-lg shadow-primary-200 dark:shadow-none"
              : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800"
          )}
        >
          <ShieldCheck className="w-4 h-4" />
          {t("permissions.tab_role_permissions")}
        </button>
        <button
          onClick={() => setTab("keys")}
          className={cn(
            "flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold transition-colors flex-1 sm:flex-none cursor-pointer",
            tab === "keys"
              ? "bg-primary-600 text-white shadow-lg shadow-primary-200 dark:shadow-none"
              : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800"
          )}
        >
          <KeyRound className="w-4 h-4" />
          {t("permissions.tab_permission_keys")}
        </button>
      </div>

      {tab === "keys" ? (
        <PermissionKeysTab />
      ) : (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-4 sm:p-5">
            <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                  {t("permissions.selector_label")}
                </label>
                <div ref={roleMenuRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setRoleMenuOpen((o) => !o)}
                    className="w-full flex items-center justify-between gap-2 px-4 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-sm font-bold text-gray-800 dark:text-gray-100 hover:border-gray-300 dark:hover:border-slate-700 transition-colors outline-none focus:ring-2 focus:ring-primary-500 cursor-pointer"
                    aria-haspopup="listbox"
                    aria-expanded={roleMenuOpen}
                  >
                    <span className="flex items-center gap-2 min-w-0 truncate">
                      <Shield className="w-4 h-4 text-primary-500 shrink-0" />
                      <span className="capitalize truncate">
                        {selectedRole?.name || t("permissions.selector_placeholder")}
                      </span>
                    </span>
                    <ChevronDown
                      className={cn("w-4 h-4 text-gray-400 transition-transform shrink-0", roleMenuOpen && "rotate-180")}
                    />
                  </button>
                  {roleMenuOpen && (
                    <div
                      role="listbox"
                      className="absolute z-50 mt-1.5 w-full rounded-xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 shadow-xl overflow-hidden"
                    >
                      <div className="max-h-60 overflow-y-auto py-1">
                        {roles.map((role) => {
                          const active = role.id === selectedRoleId;
                          return (
                            <button
                              key={role.id}
                              role="option"
                              aria-selected={active}
                              onClick={() => selectRole(role)}
                              className={cn(
                                "w-full flex items-center justify-between gap-2 px-4 py-2.5 text-sm text-left hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors cursor-pointer",
                                active ? "bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-primary-300 font-bold" : "text-gray-700 dark:text-gray-300"
                              )}
                            >
                              <span className="capitalize truncate">{role.name}</span>
                              <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 tabular-nums shrink-0">
                                {role.permissions.length}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                    {t("permissions.search_pages_label")}
                  </label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={t("permissions.search_pages")}
                      className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-slate-800 border-none rounded-xl text-sm outline-none dark:text-gray-100"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setExpanded(Object.fromEntries(filteredGroups.map((g) => [g.key, true])))
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    <ChevronDown className="w-3.5 h-3.5 rotate-180" />
                    {t("permissions.expand_all")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpanded({})}
                    className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                    {t("permissions.collapse_all")}
                  </button>
                  <span className="hidden sm:block w-px h-5 bg-gray-200 dark:bg-slate-700" />
                  <button
                    type="button"
                    onClick={clearAllGroups}
                    className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    <Square className="w-3.5 h-3.5" />
                    {t("permissions.clear_all")}
                  </button>
                  <button
                    type="button"
                    onClick={selectAllGroups}
                    className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-bold text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-colors cursor-pointer"
                  >
                    <CheckSquare className="w-3.5 h-3.5" />
                    {t("permissions.select_all")}
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <div className="h-1.5 flex-1 max-w-xs bg-gray-200 dark:bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary-600 rounded-full transition-all duration-300"
                  style={{ width: `${allGroupPermIds.length ? (selectedCount / allGroupPermIds.length) * 100 : 0}%` }}
                />
              </div>
              <span className="text-xs font-bold text-gray-600 dark:text-gray-400 tabular-nums">
                {t("permissions.selected_count", { count: selectedCount, total: allGroupPermIds.length })}
              </span>
              {dirty && (
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {t("permissions.unsaved")}
                </span>
              )}
            </div>
          </div>

          {loading ? (
            <div className="space-y-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 p-4 animate-pulse"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-5 h-5 bg-gray-200 dark:bg-slate-700 rounded-md" />
                    <div className="h-4 w-40 bg-gray-200 dark:bg-slate-700 rounded-md" />
                    <div className="ml-auto h-4 w-12 bg-gray-100 dark:bg-slate-800 rounded-md" />
                  </div>
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-2">
                    {[1, 2, 3, 4].map((n) => (
                      <div key={n} className="h-9 bg-gray-50 dark:bg-slate-800/50 rounded-lg" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : !selectedRole ? (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm py-20 text-center">
              <div className="w-16 h-16 bg-primary-50 dark:bg-primary-500/10 rounded-2xl flex items-center justify-center text-primary-600 mx-auto mb-4">
                <Shield className="w-8 h-8" />
              </div>
              <p className="font-bold text-gray-700 dark:text-gray-300">{t("permissions.no_roles")}</p>
            </div>
          ) : filteredGroups.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm py-20 text-center">
              <div className="w-14 h-14 bg-gray-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center text-gray-400 mx-auto mb-4">
                <Search className="w-6 h-6" />
              </div>
              <p className="font-bold text-gray-700 dark:text-gray-300">{t("permissions.no_results")}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t("permissions.no_results_hint")}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredGroups.map((group) => {
                const st = groupState(group);
                const title = titleOf(group);
                const parent = parentOf(group);
                const isExpanded = normalizedSearch ? true : !!expanded[group.key];
                return (
                  <div
                    key={group.key}
                    className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden"
                  >
                    <div
                      onClick={() =>
                        setExpanded((prev) => ({ ...prev, [group.key]: !isExpanded }))
                      }
                      className="min-h-[56px] px-4 py-3 bg-gray-50/60 dark:bg-slate-800/40 flex items-center gap-3 cursor-pointer select-none"
                      role="button"
                      aria-expanded={isExpanded}
                    >
                      <PermissionCheckbox
                        checked={st.full}
                        indeterminate={st.partial}
                        onToggle={() => toggleGroup(group)}
                        label={title}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-gray-700 dark:text-gray-300 capitalize truncate flex items-center gap-2">
                          <LayoutGrid className="w-4 h-4 text-gray-400 shrink-0" />
                          {title}
                        </p>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                          {[parent, group.href].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleGroup(group);
                          }}
                          className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-colors cursor-pointer"
                        >
                          {st.full ? t("permissions.clear") : t("permissions.select_all_short")}
                        </button>
                        <span
                          className={cn(
                            "text-[10px] font-bold tabular-nums px-2 py-1 rounded-md",
                            st.selected > 0
                              ? "bg-primary-100 dark:bg-primary-500/15 text-primary-700 dark:text-primary-400"
                              : "bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400"
                          )}
                        >
                          {t("permissions.group_count", { selected: st.selected, total: st.count })}
                        </span>
                        <ChevronDown
                          className={cn("w-4 h-4 text-gray-400 transition-transform shrink-0", isExpanded && "rotate-180")}
                        />
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t border-gray-100 dark:border-slate-800/60">
                        {group.perms.length === 0 ? (
                          <div className="px-4 py-6 text-center text-xs text-gray-400 dark:text-gray-500">
                            {t("permissions.no_page_permissions")}
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-1 p-2 sm:p-3">
                            {group.perms.map((perm) => {
                              const selected = workingIds.has(perm.id);
                              const labels = permissionLabels(perm.name);
                              return (
                                <div
                                key={perm.id}
                                role="button"
                                tabIndex={0}
                                onClick={() => togglePermission(perm.id)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    togglePermission(perm.id);
                                  }
                                }}
                                className={cn(
                                  "w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left rounded-xl transition-all border cursor-pointer",
                                  selected
                                    ? "bg-primary-50/60 dark:bg-primary-500/[0.08] border-primary-200 dark:border-primary-500/20"
                                    : "bg-white dark:bg-slate-900 border-transparent hover:border-gray-200 dark:hover:border-slate-700 hover:bg-gray-50/60 dark:hover:bg-slate-800/40"
                                )}
                              >
                                  <span className="min-w-0 flex items-center gap-2.5">
                                    <span
                                      className={cn(
                                        "inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md shrink-0",
                                        ACTION_CHIP_STYLES[labels.kind]
                                      )}
                                    >
                                      {labels.kind}
                                    </span>
                                    <span className="min-w-0">
                                      <span className="block text-sm font-medium text-gray-700 dark:text-gray-200 truncate">
                                        {permissionLabel(perm.name)}
                                      </span>
                                      <span className="block text-[11px] font-mono text-gray-400 dark:text-gray-500 truncate">
                                        {perm.name}
                                      </span>
                                    </span>
                                  </span>
                                  <PermissionCheckbox
                                    checked={selected}
                                    indeterminate={false}
                                    onToggle={() => togglePermission(perm.id)}
                                    label={permissionLabel(perm.name)}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="sticky bottom-4 z-30 bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-xl p-3 sm:p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full shrink-0 bg-primary-500" />
              <p className="text-xs font-bold text-gray-700 dark:text-gray-200 capitalize truncate">
                {t("permissions.editing_role", { role: selectedRole?.name || "" })}
              </p>
              {dirty && (
                <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase hidden sm:inline">
                  {t("permissions.unsaved")}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 md:gap-3">
              {canSave && (
                <button
                  type="button"
                  onClick={resetChanges}
                  disabled={!dirty || saving}
                  className="inline-flex items-center gap-2 px-4 sm:px-5 py-2.5 text-sm font-bold text-gray-500 dark:text-gray-400 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                >
                  {t("common.cancel")}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (canNavigateAway()) {
                    resetChanges();
                    router.push("/roles");
                  }
                }}
                className="inline-flex items-center gap-2 px-4 sm:px-5 py-2.5 text-sm font-bold text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
              >
                {t("permissions.back_to_roles")}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!canSave || !dirty || saving}
                className="inline-flex items-center justify-center gap-2 px-5 sm:px-7 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-bold hover:bg-primary-700 transition-colors shadow-lg shadow-primary-200 dark:shadow-none disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {t("permissions.save_changes")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PermissionsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[60vh] flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      }
    >
      <PermissionsManager />
    </Suspense>
  );
}