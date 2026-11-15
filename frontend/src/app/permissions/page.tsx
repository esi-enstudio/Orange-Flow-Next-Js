"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  Check,
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
type RouteFilter = "all" | "enabled" | "unassigned";

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
  const [routeFilter, setRouteFilter] = useState<RouteFilter>("all");
  const [selectedGroupKey, setSelectedGroupKey] = useState("");
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
    () => [...new Set(groups.flatMap((group) => group.perms.map((perm) => perm.id)))],
    [groups]
  );

  const titleOf = useCallback(
    (group: PagePermissionGroup): string => {
      if (group.pages?.length) {
        return group.pages
          .map((page) => t(page.translationKey || "") || page.title)
          .join(" / ");
      }
      return t(group.translationKey || "") || group.title;
    },
    [t]
  );

  const parentOf = useCallback(
    (group: PagePermissionGroup): string => {
      if (group.pages?.length) {
        const parents = [...new Set(
          group.pages
            .map((page) =>
              page.parentTitle
                ? t(page.parentTranslationKey || "") || page.parentTitle
                : ""
            )
            .filter(Boolean)
        )];
        return [...parents, ...group.pages.map((page) => page.href)].join(" · ");
      }
      return t(group.parentTranslationKey || "") || group.parentTitle || "";
    },
    [t]
  );

  const normalizedSearch = search.trim().toLowerCase();

  const filteredGroups = useMemo(() => {
    if (!normalizedSearch) return groups;
    return groups
      .map((group) => {
        const pageText = [
          titleOf(group),
          parentOf(group),
          group.href,
          ...(group.pages || []).map((page) => `${page.title} ${page.href}`),
        ]
          .join(" ")
          .toLowerCase();
        if (pageText.includes(normalizedSearch)) return group;
        const perms = group.perms.filter(
          (p) =>
            p.name.toLowerCase().includes(normalizedSearch) ||
            permissionLabel(p.name).toLowerCase().includes(normalizedSearch)
        );
        return { ...group, perms };
      })
      .filter(
        (group) =>
          group.perms.length > 0 ||
          [
            titleOf(group),
            parentOf(group),
            group.href,
            ...(group.pages || []).map((page) => `${page.title} ${page.href}`),
          ]
            .join(" ")
            .toLowerCase()
            .includes(normalizedSearch)
      );
  }, [groups, normalizedSearch, parentOf, titleOf]);

  const selectedCount = allGroupPermIds.filter((id) => workingIds.has(id)).length;

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

  const groupState = useCallback(
    (group: PagePermissionGroup) => {
      const ids = group.perms.map((p) => p.id);
      const sel = ids.filter((id) => workingIds.has(id)).length;
      return {
        count: ids.length,
        selected: sel,
        full: ids.length > 0 && sel === ids.length,
        partial: sel > 0 && sel < ids.length,
      };
    },
    [workingIds]
  );

  const visibleGroups = useMemo(() => {
    return filteredGroups
      .map((filteredGroup) => groups.find((group) => group.key === filteredGroup.key))
      .filter((group): group is PagePermissionGroup => Boolean(group))
      .filter((group) => {
        const { selected } = groupState(group);
        return routeFilter === "all" || (routeFilter === "enabled" ? selected > 0 : selected === 0);
      });
  }, [filteredGroups, groupState, groups, routeFilter]);

  const selectedGroup =
    visibleGroups.find((group) => group.key === selectedGroupKey) || visibleGroups[0] || null;

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
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {t("permissions.manager_title")}
            </h1>
            <PageGuideModal pageKey="permissions" />
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t("permissions.manager_description")}
          </p>
        </div>
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
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {[
              { label: t("permissions.stats_routes"), value: groups.reduce((count, group) => count + (group.pages?.length || 1), 0) },
              { label: t("permissions.stats_permission_keys"), value: allPerms.length },
              { label: t("permissions.stats_active_role"), value: selectedRole?.name || t("permissions.selector_placeholder"), compact: true },
              { label: t("permissions.stats_enabled"), value: selectedCount, suffix: t("permissions.stats_enabled_suffix") },
            ].map((stat) => (
              <div
                key={stat.label}
                className="min-w-0 rounded-2xl border border-gray-100 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-4"
              >
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  {stat.label}
                </p>
                <p className={cn("mt-1 truncate text-xl font-bold tracking-tight text-gray-900 dark:text-gray-100 sm:text-2xl", stat.compact && "text-base sm:text-lg")}>
                  {stat.value}
                  {stat.suffix && (
                    <span className="ml-1 text-[10px] font-semibold text-gray-500 dark:text-gray-400">
                      {stat.suffix}
                    </span>
                  )}
                </p>
              </div>
            ))}
          </div>

          <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(270px,330px)_minmax(0,1fr)]">
            <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-4 dark:border-slate-800">
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100">
                    {t("permissions.routes_title")}
                  </h2>
                  <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                    {t("permissions.routes_count", { count: visibleGroups.length })}
                  </p>
                </div>
                <LayoutGrid className="h-4 w-4 shrink-0 text-gray-400" />
              </div>

              <div className="space-y-3 border-b border-gray-100 p-3 dark:border-slate-800">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t("permissions.search_pages")}
                    aria-label={t("permissions.search_pages_label")}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-primary-300 focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-100"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("permissions.route_filters")}>
                  {(["all", "enabled", "unassigned"] as const).map((filter) => (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => setRouteFilter(filter)}
                      aria-pressed={routeFilter === filter}
                      className={cn(
                        "min-h-9 rounded-full border px-3 text-[11px] font-bold transition-colors cursor-pointer",
                        routeFilter === filter
                          ? "border-primary-200 bg-primary-50 text-primary-700 dark:border-primary-500/30 dark:bg-primary-500/10 dark:text-primary-300"
                          : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-400 dark:hover:bg-slate-800"
                      )}
                    >
                      {t(`permissions.filter_${filter}`)}
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={clearAllGroups}
                    className="min-h-9 rounded-lg px-2 text-xs font-bold text-gray-500 transition-colors hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    {t("permissions.clear_all")}
                  </button>
                  <button
                    type="button"
                    onClick={selectAllGroups}
                    className="min-h-9 rounded-lg px-2 text-xs font-bold text-primary-600 transition-colors hover:bg-primary-50 dark:hover:bg-primary-500/10 cursor-pointer"
                  >
                    {t("permissions.select_all")}
                  </button>
                </div>
              </div>

              <div className="max-h-[min(60vh,680px)] overflow-y-auto p-2">
                {loading ? (
                  <div className="space-y-2 p-1" aria-label={t("permissions.loading")}>
                    {Array.from({ length: 6 }).map((_, index) => (
                      <div key={index} className="flex h-[60px] animate-pulse items-center gap-3 rounded-xl bg-gray-50 p-3 dark:bg-slate-800/60">
                        <div className="h-5 w-5 rounded-md bg-gray-200 dark:bg-slate-700" />
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="h-3 w-2/3 rounded bg-gray-200 dark:bg-slate-700" />
                          <div className="h-2.5 w-1/2 rounded bg-gray-100 dark:bg-slate-700/70" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : !selectedRole ? (
                  <div className="px-3 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                    {t("permissions.no_roles")}
                  </div>
                ) : visibleGroups.length === 0 ? (
                  <div className="px-3 py-10 text-center">
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      {t("permissions.no_results")}
                    </p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {t("permissions.no_results_hint")}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {visibleGroups.map((group) => {
                      const state = groupState(group);
                      const title = titleOf(group);
                      const selected = selectedGroup?.key === group.key;
                      return (
                        <div
                          key={group.key}
                          className={cn(
                            "flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2.5 transition-colors",
                            selected
                              ? "border-primary-200 bg-primary-50/80 dark:border-primary-500/30 dark:bg-primary-500/10"
                              : "border-transparent hover:bg-gray-50 dark:hover:bg-slate-800/70"
                          )}
                        >
                          <PermissionCheckbox
                            checked={state.full}
                            indeterminate={state.partial}
                            onToggle={() => toggleGroup(group)}
                            label={title}
                          />
                          <button
                            type="button"
                            onClick={() => setSelectedGroupKey(group.key)}
                            aria-current={selected ? "page" : undefined}
                            className="flex min-h-10 min-w-0 flex-1 items-center justify-between gap-2 text-left cursor-pointer"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-xs font-bold text-gray-800 dark:text-gray-100">
                                {title}
                              </span>
                              <span className="mt-1 block truncate font-mono text-[10px] text-gray-500 dark:text-gray-400">
                                {group.pages?.length
                                  ? group.pages.map((page) => page.href).join(" · ")
                                  : group.href}
                              </span>
                            </span>
                            <span
                              className={cn(
                                "shrink-0 rounded-md px-1.5 py-1 text-[10px] font-bold tabular-nums",
                                state.selected > 0
                                  ? "bg-primary-100 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300"
                                  : "bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-gray-400"
                              )}
                            >
                              {t("permissions.group_count", { selected: state.selected, total: state.count })}
                            </span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>

            <section className="min-w-0 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="border-b border-gray-100 px-4 py-4 dark:border-slate-800 sm:px-5">
                {selectedGroup ? (
                  <>
                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
                      {t("permissions.selected_route")}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                      <h2 className="min-w-0 break-words font-mono text-base font-bold text-gray-900 dark:text-gray-100 sm:text-lg">
                        {selectedGroup.pages?.length ? titleOf(selectedGroup) : selectedGroup.href}
                      </h2>
                      <span className="shrink-0 rounded-full bg-green-50 px-2.5 py-1 text-[10px] font-bold text-green-700 dark:bg-green-500/10 dark:text-green-400">
                        {t("permissions.route_badge")}
                      </span>
                    </div>
                    <p className="mt-1 break-words text-xs text-gray-500 dark:text-gray-400">
                      {selectedGroup.pages?.length
                        ? selectedGroup.pages.map((page) => page.href).join(" · ")
                        : [parentOf(selectedGroup), selectedGroup.href].filter(Boolean).join(" · ")}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
                      {t("permissions.selected_route")}
                    </p>
                    <h2 className="mt-1 text-base font-bold text-gray-900 dark:text-gray-100">
                      {t("permissions.no_page_selected")}
                    </h2>
                  </>
                )}
              </div>

              <div className="flex flex-col gap-3 border-b border-gray-100 bg-gray-50/70 px-4 py-4 dark:border-slate-800 dark:bg-slate-800/30 sm:flex-row sm:items-center sm:px-5">
                <div className="min-w-0 flex-1">
                  <label className="mb-1.5 block text-[11px] font-bold text-gray-500 dark:text-gray-400">
                    {t("permissions.selector_label")}
                  </label>
                  <div ref={roleMenuRef} className="relative">
                    <button
                      type="button"
                      onClick={() => setRoleMenuOpen((open) => !open)}
                      className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-3.5 text-sm font-bold text-gray-800 outline-none transition-colors hover:border-gray-300 focus:ring-2 focus:ring-primary-500 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100 dark:hover:border-slate-600 cursor-pointer"
                      aria-haspopup="listbox"
                      aria-expanded={roleMenuOpen}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Shield className="h-4 w-4 shrink-0 text-primary-500" />
                        <span className="truncate capitalize">
                          {selectedRole?.name || t("permissions.selector_placeholder")}
                        </span>
                      </span>
                      <ChevronDown className={cn("h-4 w-4 shrink-0 text-gray-400 transition-transform", roleMenuOpen && "rotate-180")} />
                    </button>
                    {roleMenuOpen && (
                      <div
                        role="listbox"
                        className="absolute z-50 mt-1.5 w-full overflow-hidden rounded-xl border border-gray-100 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900"
                      >
                        <div className="max-h-60 overflow-y-auto py-1">
                          {roles.map((role) => {
                            const active = role.id === selectedRoleId;
                            return (
                              <button
                                key={role.id}
                                type="button"
                                role="option"
                                aria-selected={active}
                                onClick={() => selectRole(role)}
                                className={cn(
                                  "flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm transition-colors cursor-pointer",
                                  active
                                    ? "bg-primary-50 font-bold text-primary-700 dark:bg-primary-500/10 dark:text-primary-300"
                                    : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-slate-800"
                                )}
                              >
                                <span className="truncate capitalize">{role.name}</span>
                                <span className="shrink-0 text-[10px] font-bold tabular-nums text-gray-400">
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
                <div className="min-w-0 text-[11px] text-gray-500 dark:text-gray-400 sm:pb-3">
                  {dirty ? (
                    <span className="inline-flex items-center gap-1.5 font-bold text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {t("permissions.unsaved")}
                    </span>
                  ) : (
                    t("permissions.selected_count", { count: selectedCount, total: allGroupPermIds.length })
                  )}
                </div>
              </div>

              {loading ? (
                <div className="grid grid-cols-1 gap-2 p-4 sm:grid-cols-2 sm:p-5">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <div key={index} className="h-[68px] animate-pulse rounded-xl bg-gray-100 dark:bg-slate-800" />
                  ))}
                </div>
              ) : !selectedRole ? (
                <div className="px-4 py-16 text-center text-sm text-gray-500 dark:text-gray-400">
                  {t("permissions.no_roles")}
                </div>
              ) : !selectedGroup ? (
                <div className="px-4 py-16 text-center text-sm text-gray-500 dark:text-gray-400">
                  {t("permissions.no_results_hint")}
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-slate-800 sm:px-5">
                    <div>
                      <h3 className="text-sm font-bold text-gray-800 dark:text-gray-100">
                        {t("permissions.page_permissions_title")}
                      </h3>
                      <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                        {t("permissions.group_count", {
                          selected: groupState(selectedGroup).selected,
                          total: selectedGroup.perms.length,
                        })}
                      </p>
                    </div>
                    {selectedGroup.perms.length > 0 && (
                      <button
                        type="button"
                        onClick={() => toggleGroup(selectedGroup)}
                        className="min-h-10 rounded-lg px-3 text-xs font-bold text-primary-600 transition-colors hover:bg-primary-50 dark:hover:bg-primary-500/10 cursor-pointer"
                      >
                        {groupState(selectedGroup).full
                          ? t("permissions.clear")
                          : t("permissions.select_all_short")}
                      </button>
                    )}
                  </div>
                  {selectedGroup.perms.length === 0 ? (
                    <div className="px-4 py-10 text-center text-sm text-gray-500 dark:text-gray-400">
                      {t("permissions.no_page_permissions")}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 sm:p-5">
                      {selectedGroup.perms.map((perm) => {
                        const selected = workingIds.has(perm.id);
                        const labels = permissionLabels(perm.name);
                        return (
                          <button
                            key={perm.id}
                            type="button"
                            aria-pressed={selected}
                            aria-label={`${permissionLabel(perm.name)} (${perm.name})`}
                            onClick={() => togglePermission(perm.id)}
                            className={cn(
                              "group flex min-h-[68px] w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-3 text-left transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900",
                              selected
                                ? "border-primary-200 bg-primary-50/70 shadow-sm shadow-primary-900/[0.03] dark:border-primary-500/30 dark:bg-primary-500/[0.08]"
                                : "border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50/80 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 dark:hover:bg-slate-800/50"
                            )}
                          >
                            <span className="flex min-w-0 items-center gap-3">
                              <span
                                className={cn(
                                  "inline-flex h-7 shrink-0 items-center rounded-lg px-2 text-[10px] font-bold uppercase tracking-wider",
                                  ACTION_CHIP_STYLES[labels.kind]
                                )}
                              >
                                {labels.kind}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-semibold text-gray-800 dark:text-gray-100">
                                  {permissionLabel(perm.name)}
                                </span>
                                <span className="mt-0.5 block truncate font-mono text-[11px] text-gray-500 dark:text-gray-400">
                                  {perm.name}
                                </span>
                              </span>
                            </span>
                            <span
                              aria-hidden="true"
                              className={cn(
                                "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all duration-150",
                                selected
                                  ? "border-primary-600 bg-primary-600 text-white shadow-sm"
                                  : "border-gray-300 bg-white text-transparent group-hover:border-primary-400 dark:border-slate-600 dark:bg-slate-900 dark:group-hover:border-primary-500"
                              )}
                            >
                              <Check className="h-3.5 w-3.5 stroke-[3]" />
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </section>
          </div>

          <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-stretch gap-3 rounded-2xl border border-gray-100 bg-white p-3 shadow-xl dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between sm:p-4 md:bottom-4">
            <div className="flex min-w-0 items-center justify-between gap-2 sm:justify-start">
              <div className="flex min-w-0 items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full bg-primary-500" />
                <p className="truncate text-xs font-bold capitalize text-gray-700 dark:text-gray-200">
                  {t("permissions.editing_role", { role: selectedRole?.name || "" })}
                </p>
              </div>
              <span className="shrink-0 rounded-lg bg-primary-50 px-2.5 py-1.5 text-[11px] font-bold tabular-nums text-primary-700 dark:bg-primary-500/10 dark:text-primary-300 sm:ml-2">
                {t("permissions.selected_count", { count: selectedCount, total: allGroupPermIds.length })}
              </span>
              {dirty && (
                <span className="hidden text-[10px] font-bold uppercase text-amber-600 dark:text-amber-400 sm:inline">
                  {t("permissions.unsaved")}
                </span>
              )}
            </div>
            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto md:gap-3">
              {canSave && (
                <button
                  type="button"
                  onClick={resetChanges}
                  disabled={!dirty || saving}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold text-gray-500 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-400 dark:hover:bg-slate-800 cursor-pointer sm:px-5"
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
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-slate-800 cursor-pointer sm:px-5"
              >
                {t("permissions.back_to_roles")}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={!canSave || !dirty || saving}
                className="col-span-2 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-primary-200 transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-40 dark:shadow-none cursor-pointer sm:col-span-1 sm:px-7"
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