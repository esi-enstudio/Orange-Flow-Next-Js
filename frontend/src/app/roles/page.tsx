"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  Shield,
  Plus,
  X,
  Loader2,
  KeyRound,
  Trash2,
  Pencil,
} from "lucide-react";
import { toast } from "react-hot-toast";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { useLanguage } from "@/i18n/useLanguage";
import PageGuideModal from "@/components/PageGuideModal";
import {
  moduleKeyOfPermission,
  displayNameForModule,
} from "@/lib/permissionGroups";

interface Permission {
  id: number;
  name: string;
}

interface Role {
  id: number;
  name: string;
  permissions: Permission[];
}

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

export default function RolesPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const router = useRouter();
  const { t } = useLanguage();

  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [roleName, setRoleName] = useState("");
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
      const res = await apiClient.get("roles");
      setRoles(res.data);
    } catch {
      toast.error(t("roles.toast_fetch_failed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (authLoading) return;
    if (!hasPermission("roles.view")) return;
    apiClient
      .get("roles")
      .then((res) => setRoles(res.data))
      .catch(() => toast.error(t("roles.toast_fetch_failed")))
      .finally(() => setLoading(false));
  }, [authLoading, hasPermission, t]);

  const openCreateModal = () => {
    setEditingRole(null);
    setRoleName("");
    setModalOpen(true);
  };

  const openEditModal = (role: Role) => {
    setEditingRole(role);
    setRoleName(role.name);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (formLoading) return;
    setModalOpen(false);
    setRoleName("");
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
      if (editingRole) {
        const data = {
          name: roleName.trim(),
          permissions: editingRole.permissions.map((p) => p.id),
        };
        await apiClient.put(`roles/${editingRole.id}`, data);
        toast.success(t("roles.toast_update_success"));
      } else {
        await apiClient.post("roles", { name: roleName.trim(), permissions: [] });
        toast.success(t("roles.toast_create_success"));
      }
      setModalOpen(false);
      fetchData();
    } catch (err) {
      toast.error(
        errorMessage(err, editingRole ? t("roles.toast_update_failed") : t("roles.toast_create_failed"))
      );
    } finally {
      setFormLoading(false);
      setRoleName("");
    }
  };

  const openPermissionsPage = (role: Role) => {
    router.push(`/permissions?role=${role.id}`);
  };

  const moduleStatsForRole = useCallback((role: Role) => {
    const map = new Map<string, number>();
    for (const perm of role.permissions) {
      const key = moduleKeyOfPermission(perm.name);
      map.set(key, (map.get(key) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
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
              onClick={openCreateModal}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 text-white rounded-lg text-sm font-bold hover:bg-primary-700 transition-colors shadow-lg shadow-primary-200 dark:shadow-none cursor-pointer"
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
              onClick={openCreateModal}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-bold hover:bg-primary-700 transition-colors cursor-pointer"
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
            const canManage = hasPermission("roles.edit") || hasPermission("permissions.view");
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
                          onClick={() => openEditModal(role)}
                          className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-500/10 rounded-lg transition-colors cursor-pointer"
                          aria-label={t("roles.btn_update")}
                          title={t("roles.btn_update")}
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                      {role.name.toLowerCase() !== "super admin" && hasPermission("roles.delete") && (
                        <button
                          onClick={() => openDeleteModal(role)}
                          className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                          aria-label={t("roles.delete_confirm")}
                          title={t("roles.delete_confirm")}
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

                  {canManage && (
                    <button
                      onClick={() => openPermissionsPage(role)}
                      className="mt-5 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-50 dark:bg-slate-800/60 border border-gray-100 dark:border-slate-800 rounded-xl text-sm font-bold text-primary-700 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-colors cursor-pointer"
                    >
                      <KeyRound className="w-4 h-4" />
                      {t("roles.manage_permissions")}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-3xl shadow-2xl border border-gray-100 dark:border-slate-800 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-gray-100 dark:border-slate-800 flex items-start justify-between gap-4">
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
                onClick={closeModal}
                className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-xl bg-gray-50 dark:bg-slate-800 transition-colors cursor-pointer"
                aria-label={t("common.close")}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-5">
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
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={formLoading}
                  className="flex-1 py-3 text-sm font-bold text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={formLoading || !roleName.trim()}
                  className="flex-[2] py-3 bg-primary-600 text-white rounded-xl text-sm font-bold hover:bg-primary-700 transition-colors shadow-lg shadow-primary-200 dark:shadow-none disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
                >
                  {formLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {editingRole ? t("roles.btn_update") : t("roles.btn_create")}
                </button>
              </div>
              {editingRole && (
                <p className="text-[11px] text-gray-400 dark:text-gray-500">
                  {t("roles.permissions_note")}
                </p>
              )}
            </form>
          </div>
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
                className="flex-1 py-3 text-sm font-bold text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleDelete}
                disabled={formLoading}
                className="flex-1 py-3 bg-red-600 text-white rounded-xl text-sm font-bold hover:bg-red-700 transition-colors shadow-lg shadow-red-200 dark:shadow-none disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
              >
                {formLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                {t("roles.delete_confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}