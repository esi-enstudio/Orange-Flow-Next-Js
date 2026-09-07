"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  Shield,
  Plus,
  X,
  Check,
  Search,
  ChevronDown,
  Settings2,
  Trash2,
  Loader2,
  FolderOpen,
  CheckSquare,
  Square,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { useLanguage } from "@/i18n/useLanguage";
import PageGuideModal from "@/components/PageGuideModal";

interface Permission {
  id: number;
  name: string;
}

interface Role {
  id: number;
  name: string;
  permissions: Permission[];
}

interface ReportsSubmenuGroup {
  key: string;
  label: string;
  perms: Permission[];
}

interface ModuleGroup {
  key: string;
  displayName: string;
  perms: Permission[];
  submenus?: ReportsSubmenuGroup[];
}

const MODULE_DISPLAY_OVERRIDES: Record<string, string> = {
  houses: "Houses",
  users: "Users",
  roles: "Roles",
  permissions: "Permissions",
  retailers: "Retailers",
  employees: "Employees",
  bts: "BTS",
  lifting: "Lifting",
  reports: "Reports",
  products: "Products",
  commission: "Commission",
  sim_status: "SIM Status Check",
  activations: "Activations",
  itopup: "iTopUp Details",
  live_activations: "Live Activations",
  scratch_card: "Scratch Card Issues",
  scratch_card_serials: "SC Serial Management",
  sim_issues: "SIM Issues",
  targets: "Targets",
  bp_targets: "BP Targets",
  visits: "Retailer Visits",
  orders: "Orders",
  dms: "DMS Automation",
  app_settings: "App Settings",
  bp_retailer_codes: "BP Retailer Codes",
  ga_section_configs: "Section Configs",
  filters: "Filters",
  automation: "Automation",
  shifts: "Shifts",
  mela: "Mela",
  navigation: "Navigation",
  zoom_in: "Zoom In",
  cv: "CV Management",
  recharge_dashboard: "Recharge Dashboard",
  sim_replacement: "SIM Replacement",
  sim_inventory: "SIM Inventory",
  ev_kit: "EV Kit Inventory",
  sales: "Sales",
  stock: "Stock",
  itopup_balance: "iTopUp Balance",
  active_lso: "Active LSO Report",
  active_sso: "Active SSO Report",
  transactions: "Transactions",
  ga_report_builder: "GA Report Builder",
  whatsapp: "WhatsApp Gateway",
  telegram: "Telegram Bots",
  otp: "OTP Monitor",
  system_logs: "System Logs",
  subscription: "Subscription",
  billing: "Billing",
  plans: "Plans",
  payments: "Payments",
  webhooks: "Webhook Events",
  deploy: "Deploy",
  imports: "Imports",
  settings: "Settings",
  expenses: "Expenses",
};

interface ReportsSubmenuDef {
  key: string;
  labelKey: string;
  moduleKey: string;
}

const REPORTS_SUBMENUS: ReportsSubmenuDef[] = [
  { key: "activations", labelKey: "nav.report_activations", moduleKey: "activations" },
  { key: "recharge", labelKey: "nav.report_recharge", moduleKey: "recharge_dashboard" },
  { key: "transactions", labelKey: "nav.report_transactions", moduleKey: "transactions" },
  { key: "active_lso", labelKey: "nav.report_active_lso", moduleKey: "active_lso" },
  { key: "active_sso", labelKey: "nav.report_active_sso", moduleKey: "active_sso" },
  { key: "live_activations", labelKey: "nav.report_live_activations", moduleKey: "live_activations" },
  { key: "ga_report_builder", labelKey: "nav.report_ga_builder", moduleKey: "ga_report_builder" },
  { key: "scratch_card", labelKey: "nav.report_scratch_card", moduleKey: "scratch_card" },
  { key: "sim_issues", labelKey: "nav.report_sim_issue", moduleKey: "sim_issues" },
  { key: "visits", labelKey: "nav.visits", moduleKey: "visits" },
  { key: "orders", labelKey: "nav.orders", moduleKey: "orders" },
];

const ACRONYM_WORDS = new Set(["ga", "dms", "sim", "otp", "ev", "bp", "sc", "lso", "sso", "cc"]);

function moduleKeyOfPermission(name: string): string {
  const dot = name.indexOf(".");
  return dot === -1 ? "__default__" : name.slice(0, dot);
}

function actionOfPermission(name: string): string {
  const dot = name.indexOf(".");
  return dot === -1 ? name : name.slice(dot + 1);
}

function titleCaseWords(input: string): string {
  return input
    .split(/[._\-\s]+/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      if (lower === "itopup") return "iTopUp";
      if (ACRONYM_WORDS.has(lower)) return lower.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function displayNameForModule(key: string): string {
  if (key === "__default__") return "";
  return MODULE_DISPLAY_OVERRIDES[key] || titleCaseWords(key);
}

type ActionKind = "view" | "create" | "edit" | "delete" | "import" | "export" | "manage" | "other";

function actionKindOf(action: string): ActionKind {
  const a = action.toLowerCase();
  if (a === "view" || a.startsWith("view")) return "view";
  if (a === "create" || a.startsWith("create") || a === "add") return "create";
  if (
    a.startsWith("edit") ||
    a.startsWith("update") ||
    a.startsWith("config") ||
    a.startsWith("settings") ||
    a.startsWith("transfer") ||
    a.startsWith("adjust") ||
    a.startsWith("assign") ||
    a.startsWith("approve") ||
    a.startsWith("issue") ||
    a.startsWith("activate") ||
    a.startsWith("allocate") ||
    a.startsWith("marking")
  )
    return "edit";
  if (a.startsWith("delete")) return "delete";
  if (a.startsWith("import")) return "import";
  if (
    a.startsWith("export") ||
    a.startsWith("download") ||
    a.startsWith("print") ||
    a.startsWith("send") ||
    a.startsWith("share")
  )
    return "export";
  return "manage";
}

const ACTION_CHIP_STYLES: Record<ActionKind, string> = {
  view: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400",
  create: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  edit: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  delete: "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400",
  import: "bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-400",
  export: "bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-400",
  manage: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  other: "bg-gray-100 text-gray-600 dark:bg-slate-800/70 dark:text-gray-400",
};

interface ApiError {
  response?: { data?: { detail?: string } };
}

function errorMessage(err: unknown, fallback: string): string {
  if (typeof err === "object" && err !== null && "response" in err) {
    const detail = (err as ApiError).response?.data?.detail;
    if (detail) return detail;
  }
  return fallback;
}

function Checkbox({
  checked,
  indeterminate,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={cn(
        "w-5 h-5 rounded-md flex items-center justify-center border-2 transition-all shrink-0",
        checked
          ? "bg-primary-600 border-primary-600 text-white"
          : indeterminate
            ? "bg-primary-100 dark:bg-primary-900/30 border-primary-400 text-primary-600"
            : "border-gray-300 dark:border-slate-700"
      )}
    >
      {checked && <Check className="w-3 h-3 stroke-[4]" />}
      {!checked && indeterminate && <div className="w-2 h-0.5 bg-primary-600 rounded-full" />}
    </button>
  );
}

function PermissionRow({
  perm,
  selected,
  onToggle,
}: {
  perm: Permission;
  selected: boolean;
  onToggle: () => void;
}) {
  const action = actionOfPermission(perm.name);
  const kind = actionKindOf(action);
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left rounded-xl transition-all border",
        selected
          ? "bg-primary-50/60 dark:bg-primary-500/[0.08] border-primary-200 dark:border-primary-500/20"
          : "bg-white dark:bg-slate-900 border-transparent hover:border-gray-200 dark:hover:border-slate-700 hover:bg-gray-50/60 dark:hover:bg-slate-800/40"
      )}
    >
      <span className="min-w-0">
        <span
          className={cn(
            "inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md",
            ACTION_CHIP_STYLES[kind]
          )}
        >
          {titleCaseWords(action)}
        </span>
        <span className="block mt-1 text-[11px] font-mono text-gray-400 dark:text-gray-500 truncate">
          {perm.name}
        </span>
      </span>
      <span
        className={cn(
          "w-5 h-5 rounded-md shrink-0 flex items-center justify-center border-2 transition-all",
          selected
            ? "bg-primary-600 border-primary-600 text-white"
            : "border-gray-300 dark:border-slate-700"
        )}
      >
        {selected && <Check className="w-3 h-3 stroke-[4]" />}
      </span>
    </button>
  );
}

export default function RolesPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const router = useRouter();
  const { t } = useLanguage();

  const [roles, setRoles] = useState<Role[]>([]);
  const [allPermissions, setAllPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [roleName, setRoleName] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [reportsExpanded, setReportsExpanded] = useState<Record<string, boolean>>({});
  const [formLoading, setFormLoading] = useState(false);

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [roleToDelete, setRoleToDelete] = useState<Role | null>(null);

  useEffect(() => {
    if (!authLoading && !hasPermission("roles.view")) {
      const timer = setTimeout(() => router.push("/"), 5000);
      return () => clearTimeout(timer);
    }
  }, [authLoading, hasPermission, router]);

  const fetchData = useCallback(async () => {
      try {
        const [rolesRes, permsRes] = await Promise.all([
          apiClient.get("roles"),
          apiClient.get("permissions"),
        ]);
        setRoles(rolesRes.data);
        setAllPermissions(permsRes.data);
      } catch (err) {
        console.error("Failed to fetch roles/permissions", err);
        toast.error(t("roles.toast_fetch_failed"));
      } finally {
        setLoading(false);
      }
    }, [t]);

  useEffect(() => {
    if (!authLoading && hasPermission("roles.view")) {
      const load = async () => {
        await Promise.resolve();
        await fetchData();
      };
      void load();
    }
  }, [authLoading, hasPermission, fetchData]);

  useEffect(() => {
    if (!drawerOpen) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [drawerOpen]);

  const groupedModules = useMemo<ModuleGroup[]>(() => {
    const map: Record<string, Permission[]> = {};
    for (const perm of allPermissions) {
      const key = moduleKeyOfPermission(perm.name);
      (map[key] = map[key] || []).push(perm);
    }

    const folded = new Set(REPORTS_SUBMENUS.map((d) => d.moduleKey));
    folded.add("reports");

    const modules: ModuleGroup[] = Object.entries(map)
      .filter(([key]) => !folded.has(key))
      .map(([key, perms]) => ({
        key,
        displayName: displayNameForModule(key) || t("roles.others_module"),
        perms,
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    const submenus: ReportsSubmenuGroup[] = REPORTS_SUBMENUS.map((def) => ({
      key: def.key,
      label: t(def.labelKey),
      perms: map[def.moduleKey] || [],
    }));
    submenus.push({
      key: "reports",
      label: t("roles.reports_general"),
      perms: map["reports"] || [],
    });

    const reportSubmenus = submenus.filter((s) => s.perms.length > 0);
    if (reportSubmenus.length > 0) {
      modules.push({
        key: "reports",
        displayName: displayNameForModule("reports") || t("roles.others_module"),
        perms: [],
        submenus: reportSubmenus,
      });
    }

    return modules.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [allPermissions, t]);

  const normalizedSearch = search.trim().toLowerCase();

  const filteredModules = useMemo<ModuleGroup[]>(() => {
    if (!normalizedSearch) return groupedModules;
    const result: ModuleGroup[] = [];
    for (const mod of groupedModules) {
      if (mod.submenus) {
        const submenus = mod.submenus
          .map((sub) => ({
            ...sub,
            perms: sub.perms.filter((p) => p.name.toLowerCase().includes(normalizedSearch)),
          }))
          .filter((sub) => sub.perms.length > 0);
        if (submenus.length) result.push({ ...mod, perms: [], submenus });
      } else {
        const matching = mod.perms.filter((p) => p.name.toLowerCase().includes(normalizedSearch));
        if (matching.length) result.push({ ...mod, perms: matching });
      }
    }
    return result;
  }, [groupedModules, normalizedSearch]);

  const selectedSet = useMemo(() => new Set(selectedPermissions), [selectedPermissions]);
  const totalPerms = allPermissions.length;
  const selectedCount = selectedPermissions.length;
  const allSelected = totalPerms > 0 && selectedCount === totalPerms;

  const openCreateDrawer = () => {
    setEditingRole(null);
    setRoleName("");
    setSelectedPermissions([]);
    setSearch("");
    setExpanded({});
    setDrawerOpen(true);
  };

  const openEditDrawer = (role: Role) => {
    const ids = role.permissions.map((p) => p.id);
    const exp: Record<string, boolean> = {};
    const expReports: Record<string, boolean> = {};
    for (const mod of groupedModules) {
      if (mod.submenus) {
        for (const sub of mod.submenus) {
          if (sub.perms.some((p) => ids.includes(p.id))) {
            exp[mod.key] = true;
            expReports[sub.key] = true;
          }
        }
      } else if (mod.perms.some((p) => ids.includes(p.id))) {
        exp[mod.key] = true;
      }
    }
    setEditingRole(role);
    setRoleName(role.name);
    setSelectedPermissions(ids);
    setSearch("");
    setExpanded(exp);
    setReportsExpanded(expReports);
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    if (formLoading) return;
    setDrawerOpen(false);
    setSearch("");
  };

  const openDeleteModal = (role: Role) => {
    setRoleToDelete(role);
    setIsDeleteModalOpen(true);
  };

  const handleDelete = async () => {
    if (!roleToDelete) return;
    setFormLoading(true);
    try {
      await apiClient.delete(`roles/${roleToDelete.id}`);
      toast.success(t("roles.toast_delete_success"));
      setIsDeleteModalOpen(false);
      fetchData();
    } catch (err) {
      toast.error(errorMessage(err, t("roles.toast_delete_failed")));
    } finally {
      setFormLoading(false);
      setRoleToDelete(null);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleName.trim()) return;
    setFormLoading(true);
    try {
      const data = { name: roleName.trim(), permissions: selectedPermissions };
      if (editingRole) {
        await apiClient.put(`roles/${editingRole.id}`, data);
        toast.success(t("roles.toast_update_success"));
      } else {
        await apiClient.post("roles", data);
        toast.success(t("roles.toast_create_success"));
      }
      setDrawerOpen(false);
      fetchData();
    } catch (err) {
      toast.error(
        errorMessage(err, editingRole ? t("roles.toast_update_failed") : t("roles.toast_create_failed"))
      );
    } finally {
      setFormLoading(false);
    }
  };

  const togglePermission = (id: number) => {
    setSelectedPermissions((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleModule = (permIds: number[]) => {
    setSelectedPermissions((prev) => {
      const set = new Set(prev);
      const selectAll = permIds.every((id) => set.has(id));
      permIds.forEach((id) => (selectAll ? set.delete(id) : set.add(id)));
      return [...set];
    });
  };

  const moduleState = (permIds: number[]) => {
    const selectedInModule = permIds.filter((id) => selectedSet.has(id)).length;
    return {
      selectedInModule,
      isFullySelected: selectedInModule === permIds.length && permIds.length > 0,
      isPartiallySelected: selectedInModule > 0 && selectedInModule < permIds.length,
    };
  };

  const moduleStatsForRole = useMemo(() => {
    return (role: Role) => {
      const map = new Map<string, number>();
      for (const perm of role.permissions) {
        const key = moduleKeyOfPermission(perm.name);
        map.set(key, (map.get(key) || 0) + 1);
      }
      return [...map.entries()].sort((a, b) => b[1] - a[1]);
    };
  }, []);

  if (!authLoading && !hasPermission("roles.view")) {
    return <AccessDenied />;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t("roles.title")}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t("roles.description")}</p>
        </div>
        <div className="flex items-center gap-2">
          {hasPermission("roles.create") && (
            <button
              onClick={openCreateDrawer}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-bold hover:bg-primary-700 transition-colors shadow-lg shadow-primary-200 dark:shadow-none"
            >
              <Plus className="w-4 h-4" />
              {t("roles.create_new")}
            </button>
          )}
          <PageGuideModal pageKey="roles" />
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-48 bg-white dark:bg-slate-900 rounded-2xl animate-pulse border border-gray-100 dark:border-slate-800"
            />
          ))}
        </div>
      ) : roles.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm py-20 text-center">
          <div className="w-16 h-16 bg-primary-50 dark:bg-primary-500/10 rounded-2xl flex items-center justify-center text-primary-600 mx-auto mb-4">
            <Shield className="w-8 h-8" />
          </div>
          <p className="font-bold text-gray-700 dark:text-gray-300">{t("roles.no_roles")}</p>
          {hasPermission("roles.create") && (
            <button
              onClick={openCreateDrawer}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-bold hover:bg-primary-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              {t("roles.create_new")}
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {roles.map((role) => {
            const stats = moduleStatsForRole(role);
            return (
              <div
                key={role.id}
                className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm hover:shadow-md transition-all group overflow-hidden"
              >
                <div className="p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div className="w-12 h-12 bg-primary-50 dark:bg-primary-500/10 rounded-xl flex items-center justify-center text-primary-600">
                      <Shield className="w-6 h-6" />
                    </div>
                    <div className="flex gap-1 items-center">
                      {hasPermission("roles.edit") && (
                        <button
                          onClick={() => openEditDrawer(role)}
                          className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-500/10 rounded-lg transition-colors"
                          aria-label={t("roles.btn_update")}
                        >
                          <Settings2 className="w-4 h-4" />
                        </button>
                      )}
                      {role.name.toLowerCase() !== "super admin" && hasPermission("roles.delete") && (
                        <button
                          onClick={() => openDeleteModal(role)}
                          className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                          aria-label={t("roles.delete_confirm")}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 capitalize">
                    {role.name}
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {t("roles.total_permissions", { count: role.permissions.length })}
                    <span className="mx-1.5">·</span>
                    {t("roles.module_diversity", { count: stats.length })}
                  </p>

                  <div className="mt-5 flex flex-wrap gap-1.5">
                    {stats.slice(0, 3).map(([moduleKey, count]) => (
                      <span
                        key={moduleKey}
                        className="text-[10px] font-bold px-2 py-1 bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-400 rounded-full"
                      >
                        {displayNameForModule(moduleKey) || moduleKey}
                        <span className="text-primary-600 dark:text-primary-400"> · {count}</span>
                      </span>
                    ))}
                    {stats.length > 3 && (
                      <span className="text-[10px] font-bold px-2 py-1 bg-primary-50 dark:bg-primary-500/10 text-primary-600 rounded-full">
                        {t("roles.more_count", { count: stats.length - 3 })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {isDeleteModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-3xl shadow-2xl border border-gray-100 dark:border-slate-800 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-8 text-center">
              <div className="w-16 h-16 bg-red-50 dark:bg-red-500/10 rounded-2xl flex items-center justify-center text-red-600 mx-auto mb-6">
                <Trash2 className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                {t("roles.delete_title")}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t("roles.delete_message", { role: roleToDelete?.name })}
              </p>
            </div>
            <div className="p-6 bg-gray-50/50 dark:bg-slate-800/50 border-t border-gray-100 dark:border-slate-800 flex gap-3">
              <button
                onClick={() => setIsDeleteModalOpen(false)}
                className="flex-1 py-3 text-sm font-bold text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleDelete}
                disabled={formLoading}
                className="flex-1 py-3 bg-red-600 text-white rounded-xl text-sm font-bold hover:bg-red-700 transition-colors shadow-lg shadow-red-200 dark:shadow-none disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {formLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                {t("roles.delete_confirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      <AnimatePresence>
        {drawerOpen && (
          <div className="fixed inset-0 z-[70]">
            <motion.div
              key="drawer-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={closeDrawer}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
              key="drawer-panel"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "tween", duration: 0.28, ease: "easeOut" }}
              role="dialog"
              aria-modal="true"
              aria-label={editingRole ? t("roles.modal_edit_title", { name: editingRole.name }) : t("roles.modal_create_title")}
              className="absolute top-0 right-0 h-full w-full sm:max-w-2xl lg:max-w-4xl bg-[#F8FAFC] dark:bg-slate-950 shadow-2xl flex flex-col overflow-hidden"
            >
              <div className="p-5 sm:p-6 bg-white dark:bg-slate-900 border-b border-gray-100 dark:border-slate-800 shrink-0">
                <div className="flex items-start justify-between gap-4 mb-5">
                  <div>
                    <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                      {editingRole
                        ? t("roles.modal_edit_title", { name: editingRole.name })
                        : t("roles.modal_create_title")}
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {t("roles.modal_subtitle")}
                    </p>
                  </div>
                  <button
                    onClick={closeDrawer}
                    className="w-11 h-11 flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-xl bg-gray-50 dark:bg-slate-800 transition-colors"
                    aria-label={t("common.cancel")}
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <form
                  id="role-form"
                  onSubmit={handleSave}
                  className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end"
                >
                  <div>
                    <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
                      {t("roles.field_role_name")}
                    </label>
                    <input
                      type="text"
                      required
                      placeholder={t("roles.field_role_name_placeholder")}
                      className="w-full px-4 py-3 bg-white dark:bg-slate-950 border border-gray-200 dark:border-slate-800 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 transition-all dark:text-gray-100 outline-none shadow-sm"
                      value={roleName}
                      onChange={(e) => setRoleName(e.target.value)}
                    />
                  </div>
                </form>
              </div>

              <div className="px-5 sm:px-6 py-4 bg-white dark:bg-slate-900 border-b border-gray-100 dark:border-slate-800 shrink-0 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder={t("roles.search_permissions")}
                    className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-slate-800 border-none rounded-xl text-sm outline-none dark:text-gray-100"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => {
                      setExpanded(
                        Object.fromEntries(filteredModules.map((m) => [m.key, true]))
                      );
                      setReportsExpanded(
                        Object.fromEntries(
                          filteredModules.flatMap((m) =>
                            m.submenus ? m.submenus.map((s) => [s.key, true]) : []
                          )
                        )
                      );
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    <ChevronDown className="w-3.5 h-3.5 rotate-180" />
                    {t("roles.expand_all")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setExpanded({});
                      setReportsExpanded({});
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                    {t("roles.collapse_all")}
                  </button>
                  <span className="hidden sm:block w-px h-5 bg-gray-200 dark:bg-slate-700 mx-1" />
                  <button
                    type="button"
                    onClick={() =>
                      allSelected
                        ? setSelectedPermissions([])
                        : setSelectedPermissions(allPermissions.map((p) => p.id))
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-colors"
                  >
                    {allSelected ? (
                      <Square className="w-3.5 h-3.5" />
                    ) : (
                      <CheckSquare className="w-3.5 h-3.5" />
                    )}
                    {allSelected ? t("roles.deselect_all") : t("roles.select_all")}
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
                {filteredModules.length === 0 ? (
                  <div className="py-20 text-center">
                    <div className="w-14 h-14 bg-gray-100 dark:bg-slate-800 rounded-2xl flex items-center justify-center text-gray-400 mx-auto mb-4">
                      <Search className="w-6 h-6" />
                    </div>
                    <p className="font-bold text-gray-700 dark:text-gray-300">
                      {t("roles.no_results")}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {t("roles.no_results_hint")}
                    </p>
                  </div>
                ) : (
                  filteredModules.map((mod) => {
                    const parentPermIds = mod.submenus
                      ? mod.submenus.flatMap((s) => s.perms.map((p) => p.id))
                      : mod.perms.map((p) => p.id);
                    const parentState = moduleState(parentPermIds);
                    const isExpanded = normalizedSearch ? true : !!expanded[mod.key];

                    return (
                      <div
                        key={mod.key}
                        className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden"
                      >
                        <div
                          onClick={() =>
                            setExpanded((prev) => ({ ...prev, [mod.key]: !isExpanded }))
                          }
                          className="min-h-[52px] px-4 py-3 bg-gray-50/60 dark:bg-slate-800/40 flex items-center gap-3 cursor-pointer select-none"
                        >
                          <Checkbox
                            checked={parentState.isFullySelected}
                            indeterminate={parentState.isPartiallySelected}
                            onChange={() => toggleModule(parentPermIds)}
                            label={mod.displayName}
                          />
                          <span className="flex-1 min-w-0 flex items-center gap-2">
                            <FolderOpen className="w-4 h-4 text-gray-400 shrink-0" />
                            <span className="text-sm font-bold text-gray-700 dark:text-gray-300 capitalize truncate">
                              {mod.displayName}
                            </span>
                          </span>
                          <span
                            className={cn(
                              "text-[10px] font-bold tabular-nums px-2 py-1 rounded-md",
                              parentState.selectedInModule > 0
                                ? "bg-primary-100 dark:bg-primary-500/15 text-primary-700 dark:text-primary-400"
                                : "bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400"
                            )}
                          >
                            {t("roles.module_count", {
                              selected: parentState.selectedInModule,
                              total: parentPermIds.length,
                            })}
                          </span>
                          <ChevronDown
                            className={cn(
                              "w-4 h-4 text-gray-400 transition-transform shrink-0",
                              isExpanded && "rotate-180"
                            )}
                          />
                        </div>

                        {isExpanded && mod.submenus && (
                          <div className="p-2 sm:p-3 space-y-2">
                            {mod.submenus.map((sub) => {
                              const subIds = sub.perms.map((p) => p.id);
                              const subState = moduleState(subIds);
                              const subExpanded = normalizedSearch ? true : !!reportsExpanded[sub.key];
                              return (
                                <div
                                  key={sub.key}
                                  className="bg-gray-50/40 dark:bg-slate-800/20 rounded-xl border border-gray-100 dark:border-slate-800/60 overflow-hidden"
                                >
                                  <div
                                    onClick={() =>
                                      setReportsExpanded((prev) => ({ ...prev, [sub.key]: !subExpanded }))
                                    }
                                    className="min-h-[44px] px-3 py-2 flex items-center gap-3 cursor-pointer select-none"
                                  >
                                    <Checkbox
                                      checked={subState.isFullySelected}
                                      indeterminate={subState.isPartiallySelected}
                                      onChange={() => toggleModule(subIds)}
                                      label={sub.label}
                                    />
                                    <span className="flex-1 min-w-0 flex items-center gap-2">
                                      <span className="text-sm font-semibold text-gray-600 dark:text-gray-300 truncate">
                                        {sub.label}
                                      </span>
                                    </span>
                                    <span
                                      className={cn(
                                        "text-[10px] font-bold tabular-nums px-2 py-1 rounded-md",
                                        subState.selectedInModule > 0
                                          ? "bg-primary-100 dark:bg-primary-500/15 text-primary-700 dark:text-primary-400"
                                          : "bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400"
                                      )}
                                    >
                                      {t("roles.module_count", {
                                        selected: subState.selectedInModule,
                                        total: subIds.length,
                                      })}
                                    </span>
                                    <ChevronDown
                                      className={cn(
                                        "w-4 h-4 text-gray-400 transition-transform shrink-0",
                                        subExpanded && "rotate-180"
                                      )}
                                    />
                                  </div>
                                  {subExpanded && (
                                    <div className="p-2 sm:p-3 space-y-2 border-t border-gray-100 dark:border-slate-800/60">
                                      {sub.perms.map((perm) => (
                                        <PermissionRow
                                          key={perm.id}
                                          perm={perm}
                                          selected={selectedSet.has(perm.id)}
                                          onToggle={() => togglePermission(perm.id)}
                                        />
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {isExpanded && !mod.submenus && (
                          <div className="p-3 space-y-2">
                            {mod.perms.map((perm) => (
                              <PermissionRow
                                key={perm.id}
                                perm={perm}
                                selected={selectedSet.has(perm.id)}
                                onToggle={() => togglePermission(perm.id)}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              <div className="p-5 sm:p-6 bg-white dark:bg-slate-900 border-t border-gray-100 dark:border-slate-800 shrink-0 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3 flex-1 min-w-[160px]">
                  <div className="h-1.5 flex-1 max-w-[140px] bg-gray-200 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary-600 rounded-full transition-all duration-300"
                      style={{
                        width: `${totalPerms ? (selectedCount / totalPerms) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="text-xs font-bold text-gray-600 dark:text-gray-400 tabular-nums">
                    {t("roles.selected_count", { count: selectedCount, total: totalPerms })}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={closeDrawer}
                    disabled={formLoading}
                    className="px-6 py-2.5 text-sm font-bold text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors disabled:opacity-50"
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="submit"
                    form="role-form"
                    disabled={formLoading || !roleName.trim()}
                    className="px-8 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-bold hover:bg-primary-700 transition-colors shadow-lg shadow-primary-200 dark:shadow-none disabled:opacity-50 flex items-center gap-2"
                  >
                    {formLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {editingRole ? t("roles.btn_update") : t("roles.btn_create")}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}