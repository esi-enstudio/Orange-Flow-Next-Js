"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { 
  Shield, 
  Plus, 
  MoreVertical, 
  X, 
  Check, 
  Search,
  ChevronRight,
  Settings2,
  Lock,
  Loader2,
  Trash2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { useLanguage } from "@/i18n/useLanguage";

interface Permission {
  id: number;
  name: string;
}

interface Role {
  id: number;
  name: string;
  permissions: Permission[];
}

export default function RolesPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const router = useRouter();
  const { t } = useLanguage();
  const [roles, setRoles] = useState<Role[]>([]);
  const [allPermissions, setAllPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRole, setEditRole] = useState<Role | null>(null);
  const [roleName, setRoleName] = useState("");
  const [selectedPermissions, setSelectedPermissions] = useState<number[]>([]);
  const [formLoading, setFormLoading] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [roleToDelete, setRoleToDelete] = useState<Role | null>(null);

  useEffect(() => {
    if (!authLoading && !hasPermission("roles.view")) {
      const timer = setTimeout(() => {
        router.push("/");
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [authLoading, hasPermission, router]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [rolesRes, permsRes] = await Promise.all([
        apiClient.get("roles"),
        apiClient.get("permissions")
      ]);
      setRoles(rolesRes.data);
      setAllPermissions(permsRes.data);
    } catch (err) {
      console.error("Failed to fetch roles/permissions", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && hasPermission("roles.view")) {
      fetchData();
    }
  }, [authLoading, hasPermission]);

  const openCreateModal = () => {
    setEditRole(null);
    setRoleName("");
    setSelectedPermissions([]);
    setIsModalOpen(true);
  };

  const openEditModal = (role: Role) => {
    setEditRole(role);
    setRoleName(role.name);
    setSelectedPermissions(role.permissions.map(p => p.id));
    setIsModalOpen(true);
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
      toast.success(t('roles.toast_delete_success'));
      setIsDeleteModalOpen(false);
      fetchData();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to delete role");
    } finally {
      setFormLoading(false);
      setRoleToDelete(null);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormLoading(true);
    try {
      const data = { name: roleName, permissions: selectedPermissions };
      if (editingRole) {
        await apiClient.put(`roles/${editingRole.id}`, data);
        toast.success(t('roles.toast_update_success'));
      } else {
        await apiClient.post("roles", data);
        toast.success(t('roles.toast_create_success'));
      }
      setIsModalOpen(false);
      fetchData();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to save role");
    } finally {
      setFormLoading(false);
    }
  };

  const togglePermission = (id: number) => {
    setSelectedPermissions(prev => 
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };

  const groupedPermissions = allPermissions.reduce((acc, perm) => {
    const parts = perm.name.split('_');
    const module = parts.length > 1 ? parts.slice(1).join(' ') : 'System';
    if (!acc[module]) acc[module] = [];
    acc[module].push(perm);
    return acc;
  }, {} as Record<string, Permission[]>);

  if (!authLoading && !hasPermission("roles.view")) {
    return <AccessDenied />;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('roles.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('roles.description')}</p>
        </div>
        <button 
          onClick={openCreateModal}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-bold hover:bg-primary-700 transition-colors shadow-lg shadow-primary-200 dark:shadow-none"
        >
          <Plus className="w-4 h-4" />
          {t('roles.create_new')}
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-48 bg-white dark:bg-slate-900 rounded-2xl animate-pulse border border-gray-100 dark:border-slate-800"></div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {roles.map((role) => (
            <div key={role.id} className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm hover:shadow-md transition-all group overflow-hidden">
              <div className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div className="w-12 h-12 bg-primary-50 dark:bg-primary-500/10 rounded-xl flex items-center justify-center text-primary-600">
                    <Shield className="w-6 h-6" />
                  </div>
                  <div className="flex gap-1">
                    <button 
                      onClick={() => openEditModal(role)}
                      className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-500/10 rounded-lg transition-colors"
                    >
                      <Settings2 className="w-4 h-4" />
                    </button>
                    {role.name.toLowerCase() !== "super admin" && (
                      <button 
                        onClick={() => openDeleteModal(role)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
                
                <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 capitalize">{role.name}</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t('roles.total_permissions', { count: role.permissions.length })}
                </p>

                <div className="mt-6 flex flex-wrap gap-1.5">
                  {role.permissions.slice(0, 3).map(p => (
                    <span key={p.id} className="text-[10px] font-bold px-2 py-0.5 bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-400 rounded-full uppercase tracking-wider">
                      {p.name.replace('view_', '').replace('create_', '').replace('edit_', '').replace('delete_', '')}
                    </span>
                  ))}
                  {role.permissions.length > 3 && (
                    <span className="text-[10px] font-bold px-2 py-0.5 bg-primary-50 dark:bg-primary-500/10 text-primary-600 rounded-full">
                      {t('roles.more_count', { count: role.permissions.length - 3 })}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {isDeleteModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-3xl shadow-2xl border border-gray-100 dark:border-slate-800 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-8 text-center">
              <div className="w-16 h-16 bg-red-50 dark:bg-red-500/10 rounded-2xl flex items-center justify-center text-red-600 mx-auto mb-6">
                <Trash2 className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">{t('roles.delete_title')}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t('roles.delete_message', { role: roleToDelete?.name })}
              </p>
            </div>
            <div className="p-6 bg-gray-50/50 dark:bg-slate-800/50 border-t border-gray-100 dark:border-slate-800 flex gap-3">
              <button 
                onClick={() => setIsDeleteModalOpen(false)}
                className="flex-1 py-3 text-sm font-bold text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button 
                onClick={handleDelete}
                disabled={formLoading}
                className="flex-1 py-3 bg-red-600 text-white rounded-xl text-sm font-bold hover:bg-red-700 transition-colors shadow-lg shadow-red-200 dark:shadow-none disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {formLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                {t('roles.delete_confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-[#F8FAFC] dark:bg-slate-950 w-full max-w-4xl max-h-[90vh] rounded-3xl shadow-2xl border border-gray-100 dark:border-slate-800 overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            <div className="p-6 bg-white dark:bg-slate-900 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                  {editingRole ? t('roles.modal_edit_title', { name: editingRole.name }) : t('roles.modal_create_title')}
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">{t('roles.modal_subtitle')}</p>
              </div>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-xl bg-gray-50 dark:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8">
              <div className="max-w-md">
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">{t('roles.field_role_name')}</label>
                <input
                  type="text"
                  required
                  placeholder={t('roles.field_role_name_placeholder')}
                  className="w-full px-4 py-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 transition-all dark:text-gray-100 outline-none shadow-sm"
                  value={roleName}
                  onChange={(e) => setRoleName(e.target.value)}
                />
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100 uppercase tracking-widest">{t('roles.section_permissions')}</h4>
                  <button 
                    type="button"
                    onClick={() => {
                      if (selectedPermissions.length === allPermissions.length) {
                        setSelectedPermissions([]);
                      } else {
                        setSelectedPermissions(allPermissions.map(p => p.id));
                      }
                    }}
                    className="text-xs font-bold text-primary-600 hover:text-primary-700 transition-colors bg-primary-50 dark:bg-primary-500/10 px-3 py-1.5 rounded-lg"
                  >
                    {selectedPermissions.length === allPermissions.length ? t('roles.deselect_all') : t('roles.select_all')}
                  </button>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {Object.entries(groupedPermissions).map(([module, perms]) => {
                    const modulePermIds = perms.map(p => p.id);
                    const isModuleFullySelected = modulePermIds.every(id => selectedPermissions.includes(id));
                    const isModulePartiallySelected = modulePermIds.some(id => selectedPermissions.includes(id)) && !isModuleFullySelected;

                    const toggleModule = () => {
                      if (isModuleFullySelected) {
                        setSelectedPermissions(prev => prev.filter(id => !modulePermIds.includes(id)));
                      } else {
                        setSelectedPermissions(prev => [...new Set([...prev, ...modulePermIds])]);
                      }
                    };

                    return (
                      <div key={module} className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 overflow-hidden shadow-sm hover:border-primary-100 dark:hover:border-primary-900/30 transition-colors">
                        <div 
                          onClick={toggleModule}
                          className="px-4 py-3 bg-gray-50/50 dark:bg-slate-800/50 border-b border-gray-50 dark:border-slate-800 flex items-center justify-between cursor-pointer group"
                        >
                          <h5 className="text-xs font-bold text-gray-600 dark:text-gray-400 capitalize group-hover:text-primary-600 transition-colors">{module}</h5>
                          <div className={cn(
                            "w-5 h-5 rounded-md flex items-center justify-center border-2 transition-all",
                            isModuleFullySelected 
                              ? "bg-primary-600 border-primary-600 text-white" 
                              : isModulePartiallySelected
                                ? "bg-primary-100 dark:bg-primary-900/30 border-primary-400 text-primary-600"
                                : "border-gray-300 dark:border-slate-700 group-hover:border-primary-300"
                          )}>
                            {isModuleFullySelected && <Check className="w-3 h-3 stroke-[4]" />}
                            {isModulePartiallySelected && <div className="w-2 h-0.5 bg-primary-600 rounded-full" />}
                          </div>
                        </div>
                        <div className="p-4 space-y-2">
                          {perms.map(perm => {
                            const isActive = selectedPermissions.includes(perm.id);
                            return (
                              <div 
                                key={perm.id}
                                onClick={() => togglePermission(perm.id)}
                                className={cn(
                                  "flex items-center justify-between p-2 rounded-xl cursor-pointer transition-all border",
                                  isActive 
                                    ? "bg-primary-50 dark:bg-primary-500/10 border-primary-200 dark:border-primary-500/20" 
                                    : "bg-white dark:bg-slate-900 border-transparent hover:border-gray-200 dark:hover:border-slate-700"
                                )}
                              >
                                <span className={cn(
                                  "text-xs font-medium",
                                  isActive ? "text-primary-700 dark:text-primary-400" : "text-gray-600 dark:text-gray-400"
                                )}>
                                  {perm.name.split('_')[0].toUpperCase()}
                                </span>
                                <div className={cn(
                                  "w-5 h-5 rounded-md flex items-center justify-center border-2 transition-all",
                                  isActive 
                                    ? "bg-primary-600 border-primary-600 text-white" 
                                    : "border-gray-300 dark:border-slate-700"
                                )}>
                                  {isActive && <Check className="w-3 h-3 stroke-[4]" />}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="p-6 bg-white dark:bg-slate-900 border-t border-gray-100 dark:border-slate-800 flex justify-end gap-3">
              <button 
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-6 py-2.5 text-sm font-bold text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button 
                onClick={handleSave}
                disabled={formLoading || !roleName}
                className="px-8 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-bold hover:bg-primary-700 transition-colors shadow-lg shadow-primary-200 dark:shadow-none disabled:opacity-50 flex items-center gap-2"
              >
                {formLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {editingRole ? t('roles.btn_update') : t('roles.btn_create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
