"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { 
  Users, 
  Shield, 
  UserCheck, 
  UserMinus, 
  MoreVertical,
  Mail,
  Search,
  Plus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  X,
  User as UserIcon,
  Lock,
  Loader2,
  AlertCircle,
  Check,
  Phone,
  Hash,
  Trash2,
  Edit2,
  Building2,
  Briefcase,
  Eye,
  EyeOff,
  Upload,
  Download,
  FileSpreadsheet,
  SlidersHorizontal
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import { useRef } from "react";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import { useLanguage } from "@/i18n/useLanguage";
import { AccessDenied } from "@/components/ui/AccessDenied";
import UserMasterFilter, { defaultFilters } from "@/components/users/UserMasterFilter";
import type { User, Role, House, UserFilters } from "@/types/user";

export default function UsersPage() {
  const { selectedHouse, hasPermission, loading: authLoading } = useAuth();
  const router = useRouter();
  const { t } = useLanguage();
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [houses, setHouses] = useState<House[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<UserFilters>(defaultFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(0);
  
  // Modal States
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  
  // Import/Export States
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importResults, setImportResults] = useState<{success: number, error: number} | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isExporting, setIsExporting] = useState(false);

  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const limit = 5;

  const [formData, setFormData] = useState({
    username: "",
    name: "",
    email: "",
    password: "",
    phone_number: "",
    telegram_id: "",
    status: "Active",
    role_ids: [] as number[],
    house_ids: [] as number[],
    parent_id: "" as string | number,
  });

  // Permission Check
  useEffect(() => {
    if (!authLoading && !hasPermission("users.view")) {
      const timer = setTimeout(() => {
        router.push("/");
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [authLoading, hasPermission, router]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [usersRes, rolesRes, housesRes] = await Promise.all([
        apiClient.get("users"),
        apiClient.get("roles"),
        apiClient.get("houses")
      ]);
      setUsers(usersRes.data);
      setRoles(rolesRes.data);
      setHouses(housesRes.data);
    } catch (err) {
      console.error("Failed to fetch data", err);
      toast.error(t('users.toast_load_failed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && hasPermission("users.view")) {
      fetchData();
    }
  }, [selectedHouse, authLoading, hasPermission]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const handleMultiSelect = (name: "role_ids" | "house_ids", id: number) => {
    setFormData(prev => {
      const current = prev[name];
      const updated = current.includes(id) 
        ? current.filter(item => item !== id)
        : [...current, id];
      return { ...prev, [name]: updated };
    });
  };

  const openAddModal = () => {
    setEditingUser(null);
    setFormData({
      username: "",
      name: "",
      email: "",
      password: "",
      phone_number: "",
      telegram_id: "",
      status: "Active",
      role_ids: [],
      house_ids: [],
      parent_id: "",
    });
    setFormError("");
    setFieldErrors({});
    setIsFormModalOpen(true);
  };

  const openEditModal = (user: User) => {
    setEditingUser(user);
    setFormData({
      username: user.username || "",
      name: user.name || "",
      email: user.email || "",
      password: "", // Leave blank for security, only change if provided
      phone_number: user.phone_number || "",
      telegram_id: user.telegram_id?.toString() || "",
      status: user.status || "Active",
      role_ids: user.roles?.map(r => r.id) || [],
      house_ids: user.houses?.map(h => h.id) || [],
      parent_id: user.parent_id || "",
    });
    setFormError("");
    setFieldErrors({});
    setIsFormModalOpen(true);
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!formData.name.trim()) errors.name = t('users.field_error_name');
    if (!formData.username.trim()) errors.username = t('users.field_error_username');
    if (!formData.email.trim()) errors.email = t('users.field_error_email');
    if (!editingUser && !formData.password.trim()) errors.password = t('users.field_error_password');
    
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;
    
    setFormLoading(true);
    setFormError("");
    
    try {
      if (editingUser) {
        const payload: Record<string, unknown> = {
          username: formData.username,
          name: formData.name,
          password: formData.password || undefined,
          email: formData.email.trim() || null,
          phone_number: formData.phone_number.trim() || null,
          telegram_id: formData.telegram_id ? Number(formData.telegram_id) : null,
          status: formData.status,
          role_ids: formData.role_ids,
          house_ids: formData.house_ids,
          parent_id: formData.parent_id === "" ? null : Number(formData.parent_id),
        };
        await apiClient.put(`users/${editingUser.id}`, payload);
        toast.success(t('users.toast_update_success'));
      } else {
        const payload: Record<string, unknown> = {
          username: formData.username,
          name: formData.name,
          password: formData.password,
          email: formData.email.trim() || null,
          phone_number: formData.phone_number.trim() || null,
          telegram_id: formData.telegram_id ? Number(formData.telegram_id) : null,
          role_ids: formData.role_ids,
          house_ids: formData.house_ids,
          parent_id: formData.parent_id === "" ? null : Number(formData.parent_id),
        };
        await apiClient.post("auth/register", payload);
        toast.success(t('users.toast_create_success'));
      }
      setIsFormModalOpen(false);
      fetchData();
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      const errorMsg = typeof detail === "string" ? detail : t('common.action_failed');
      setFormError(errorMsg);
      toast.error(errorMsg);
    } finally {
      setFormLoading(false);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setImportProgress(20);
    setImportResults(null);
    
    const importData = new FormData();
    importData.append("file", file);
    
    try {
      setImportProgress(50);
      const response = await apiClient.post(`users/import`, importData);
      setImportProgress(100);
      setImportResults({
        success: response.data.success_count,
        error: response.data.error_count
      });
      toast.success(response.data.message);
      fetchData();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || t('users.toast_import_failed'));
    } finally {
      setTimeout(() => {
        setIsImporting(false);
        setImportProgress(0);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }, 1000);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const response = await apiClient.get("users/export", { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `users_export_${new Date().getTime()}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success(t('users.toast_export_success'));
    } catch (err) {
      toast.error(t('users.toast_export_failed'));
    } finally {
      setIsExporting(false);
    }
  };

  const handleDeleteClick = (id: number) => {
    setDeletingId(id);
    setIsConfirmOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!deletingId) return;
    setFormLoading(true);
    try {
      await apiClient.delete(`users/${deletingId}`);
      toast.success(t('users.toast_delete_success'));
      setIsConfirmOpen(false);
      fetchData();
    } catch (err) {
      toast.error(t('users.toast_delete_failed'));
    } finally {
      setFormLoading(false);
      setDeletingId(null);
    }
  };

  const filteredUsers = users.filter(u => {
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const matchesSearch = 
        u.name?.toLowerCase().includes(q) ||
        u.username?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        u.phone_number?.toLowerCase().includes(q) ||
        String(u.telegram_id ?? "").includes(q);
      if (!matchesSearch) return false;
    }
    if (filters.status && u.status !== filters.status) return false;
    if (filters.role_ids.length > 0) {
      const userRoleIds = u.roles?.map(r => r.id) || [];
      if (!filters.role_ids.some(id => userRoleIds.includes(id))) return false;
    }
    if (filters.house_ids.length > 0) {
      const userHouseIds = u.houses?.map(h => h.id) || [];
      if (!filters.house_ids.some(id => userHouseIds.includes(id))) return false;
    }
    if (filters.parent_id !== null && u.parent_id !== filters.parent_id) return false;
    if (filters.phone_number && !u.phone_number?.toLowerCase().includes(filters.phone_number.toLowerCase())) return false;
    if (filters.telegram_id && !String(u.telegram_id ?? "").includes(filters.telegram_id)) return false;
    return true;
  });

  const paginatedUsers = filteredUsers.slice(page * limit, (page + 1) * limit);
  const totalPages = Math.ceil(filteredUsers.length / limit);

  if (!authLoading && !hasPermission("users.view")) {
    return <AccessDenied />;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('users.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 transition-colors">{t('users.description')}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {hasPermission("users.export") && (
            <button 
              onClick={handleExport}
              disabled={isExporting}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-bold hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors shadow-sm disabled:opacity-50"
            >
              {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {t('users.export_list')}
            </button>
          )}
          {hasPermission("users.import") && (
            <>
              <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept=".xlsx, .xls" />
              <button 
                onClick={handleImportClick}
                disabled={isImporting}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-bold hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors shadow-sm disabled:opacity-50"
              >
                {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {t('users.import_list')}
              </button>
            </>
          )}
          {hasPermission("users.create") && (
            <button 
              onClick={openAddModal}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-bold hover:bg-primary-700 transition-colors shadow-lg shadow-primary-200 dark:shadow-none"
            >
              <Plus className="w-4 h-4" />
              {t('users.add_new')}
            </button>
          )}
        </div>
      </div>

      {/* Import Progress & Results */}
      {isImporting && (
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-primary-100 dark:border-primary-500/20 shadow-xl animate-in slide-in-from-top-4 duration-300">
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary-100 dark:bg-primary-500/20 rounded-xl text-primary-600">
                        <FileSpreadsheet className="w-5 h-5" />
                    </div>
                    <div>
                        <h4 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                          {importProgress < 100 ? t('users.import_processing') : t('users.import_done')}
                        </h4>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {importProgress < 100 ? t('users.import_wait') : t('users.import_sync_done')}
                        </p>
                    </div>
                </div>
                {importResults && (
                   <button onClick={() => setIsImporting(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg">
                      <X className="w-4 h-4 text-gray-400" />
                   </button>
                )}
            </div>
            
            <div className="w-full h-2 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden mb-4">
                <div 
                    className="h-full bg-primary-500 transition-all duration-500 ease-out shadow-[0_0_10px_rgba(249,115,22,0.5)]" 
                    style={{ width: `${importProgress}%` }}
                />
            </div>

            {importResults && (
              <div className="grid grid-cols-2 gap-4 animate-in fade-in duration-500 delay-300">
                  <div className="bg-green-50 dark:bg-green-500/5 p-3 rounded-xl border border-green-100 dark:border-green-500/10">
                      <p className="text-[10px] font-bold text-green-600 dark:text-green-400 uppercase tracking-wider mb-1">{t('users.import_success')}</p>
                      <p className="text-xl font-black text-green-700 dark:text-green-300">{importResults.success}</p>
                  </div>
                  <div className="bg-red-50 dark:bg-red-500/5 p-3 rounded-xl border border-red-100 dark:border-red-500/10">
                      <p className="text-[10px] font-bold text-red-600 dark:text-red-400 uppercase tracking-wider mb-1">{t('users.import_failed')}</p>
                      <p className="text-xl font-black text-red-700 dark:text-red-300">{importResults.error}</p>
                  </div>
              </div>
            )}
        </div>
      )}

      {/* Stats Summary */}
      <div className="grid grid-cols-3 gap-4 md:gap-6">
        <StatCard title={t('users.total_users')} value={users.length} icon={Users} color="bg-blue-500" />
        <StatCard title={t('users.active_users')} value={users.filter(u => u.status === "Active").length} icon={UserCheck} color="bg-green-500" />
        <StatCard title={t('users.system_roles')} value={roles.length} icon={Shield} color="bg-purple-500" />
      </div>

      {/* DataTable Container */}
      <div className="relative">
        {/* Filter Overlay */}
        {showFilters && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setShowFilters(false)} />
            <div className="absolute z-30 left-0 top-0 w-full md:w-80 bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
              <UserMasterFilter
                filters={filters}
                onChange={(f) => { setFilters(f); setPage(0); }}
                onClear={() => { setFilters(defaultFilters); setPage(0); }}
                houses={houses}
                roles={roles}
              />
            </div>
          </>
        )}

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden transition-colors duration-300">
        <div className="p-4 border-b border-gray-50 dark:border-slate-800 flex items-center gap-3">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              "p-2 rounded-xl border transition-all",
              showFilters
                ? "bg-primary-50 dark:bg-primary-500/10 border-primary-200 dark:border-primary-500/30 text-primary-600"
                : "bg-gray-50 dark:bg-slate-800 border-gray-200 dark:border-slate-700 text-gray-400 hover:text-gray-600"
            )}
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
            <input 
              type="text" 
              placeholder={t('users.search_placeholder')} 
              className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-slate-800 border-none rounded-xl text-sm focus:ring-2 focus:ring-primary-500 transition-all dark:text-gray-100 outline-none"
              value={filters.search}
              onChange={(e) => {
                setFilters({ ...filters, search: e.target.value });
                setPage(0);
              }}
            />
          </div>
          {filteredUsers.length > 0 && JSON.stringify(filters) !== JSON.stringify(defaultFilters) && (
            <span className="text-[10px] font-bold text-gray-400 dark:text-gray-500 whitespace-nowrap">
              {filteredUsers.length} result{filteredUsers.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center gap-4">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-500"></div>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="py-20 text-center">
            <Users className="w-12 h-12 text-gray-200 dark:text-gray-700 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400 font-medium">{t('users.no_users')}</p>
          </div>
        ) : (
          <>
            {/* Desktop Table — lg+ */}
            <div className="hidden lg:block overflow-x-auto scrollbar-custom">
              <table className="w-full text-left min-w-[800px]">
                <thead>
                  <tr className="bg-gray-50/50 dark:bg-slate-800/50 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest border-b border-gray-50 dark:border-slate-800">
                    <th className="px-6 py-4">{t('users.table_profile')}</th>
                    <th className="px-6 py-4">{t('users.table_roles')}</th>
                    <th className="px-6 py-4">{t('users.table_status')}</th>
                    <th className="px-6 py-4 text-right">{t('users.table_actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                  {paginatedUsers.map((u) => (
                    <tr key={u.id} className="hover:bg-gray-50/30 dark:hover:bg-slate-800/30 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-primary-100 dark:bg-primary-500/20 flex items-center justify-center text-primary-700 dark:text-primary-400 font-bold shadow-sm">
                            {u.name?.charAt(0) || "U"}
                          </div>
                          <div>
                            <p className="font-bold text-gray-900 dark:text-gray-100 text-sm">{u.name}</p>
                            <p className="text-[10px] text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                                <Hash className="w-2.5 h-2.5" /> @{u.username} <Mail className="w-2.5 h-2.5 ml-1" /> {u.email}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1.5">
                          {u.roles?.map(r => (
                            <span key={r.id} className="px-2 py-0.5 bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 text-[9px] font-bold uppercase rounded-full border border-blue-100 dark:border-blue-500/20">
                              {r.name}
                            </span>
                          ))}
                          {u.houses?.length ? (
                            <span className="px-2 py-0.5 bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400 text-[9px] font-bold uppercase rounded-full border border-purple-100 dark:border-purple-500/20">
                              {t('users.houses_count', { count: u.houses.length })}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={cn(
                          "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider transition-all",
                          u.status === "Active" 
                            ? "bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400"
                            : "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400"
                        )}>
                          <span className={cn("w-1 h-1 rounded-full", u.status === "Active" ? "bg-green-500" : "bg-red-500")}></span>
                          {u.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          {hasPermission("users.edit") && (
                            <button 
                              onClick={() => openEditModal(u)}
                              className="p-2 hover:bg-primary-50 dark:hover:bg-primary-500/10 rounded-xl text-gray-400 hover:text-primary-600 transition-all"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                          )}
                          {hasPermission("users.delete") && (
                            <button 
                              onClick={() => handleDeleteClick(u.id)}
                              className="p-2 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl text-gray-400 hover:text-red-600 transition-all"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Accordion — below lg */}
            <div className="lg:hidden divide-y divide-gray-50 dark:divide-slate-800">
              {paginatedUsers.map((u) => (
                <div key={u.id} className="transition-colors">
                  <button
                    onClick={() => setExpandedId(expandedId === u.id ? null : u.id)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-gray-50/30 dark:hover:bg-slate-800/30 transition-colors text-left"
                  >
                    <div className="w-9 h-9 rounded-xl bg-primary-100 dark:bg-primary-500/20 flex items-center justify-center text-primary-700 dark:text-primary-400 font-bold shadow-sm shrink-0">
                      {u.name?.charAt(0) || "U"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-gray-900 dark:text-gray-100 text-sm truncate">{u.name}</p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">@{u.username}</p>
                    </div>
                    <ChevronDown className={cn(
                      "w-4 h-4 text-gray-400 shrink-0 transition-transform duration-200",
                      expandedId === u.id && "rotate-180"
                    )} />
                  </button>
                  <div className={cn(
                    "overflow-hidden transition-all duration-200 ease-in-out",
                    expandedId === u.id ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0"
                  )}>
                    <div className="px-4 pb-4 space-y-3">
                      <div className="pt-2 border-t border-gray-50 dark:border-slate-800">
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                          <Mail className="w-3 h-3" /> {u.email || "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1.5">{t('users.table_roles')}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {u.roles?.map(r => (
                            <span key={r.id} className="px-2 py-0.5 bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 text-[9px] font-bold uppercase rounded-full border border-blue-100 dark:border-blue-500/20">
                              {r.name}
                            </span>
                          ))}
                          {(!u.roles || u.roles.length === 0) && (
                            <span className="text-[11px] text-gray-400">—</span>
                          )}
                        </div>
                      </div>
                      {u.houses?.length ? (
                        <div>
                          <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1.5">{t('users.field_assigned_houses')}</p>
                          <p className="text-[11px] text-gray-600 dark:text-gray-300">{u.houses.map(h => h.name).join(", ")}</p>
                        </div>
                      ) : null}
                      <div className="flex items-center justify-between pt-1">
                        <span className={cn(
                          "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider",
                          u.status === "Active" 
                            ? "bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400"
                            : "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400"
                        )}>
                          <span className={cn("w-1 h-1 rounded-full", u.status === "Active" ? "bg-green-500" : "bg-red-500")}></span>
                          {u.status}
                        </span>
                        <div className="flex gap-2">
                          {hasPermission("users.edit") && (
                            <button 
                              onClick={(e) => { e.stopPropagation(); openEditModal(u); }}
                              className="p-2 hover:bg-primary-50 dark:hover:bg-primary-500/10 rounded-xl text-gray-400 hover:text-primary-600 transition-all"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                          )}
                          {hasPermission("users.delete") && (
                            <button 
                              onClick={(e) => { e.stopPropagation(); handleDeleteClick(u.id); }}
                              className="p-2 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl text-gray-400 hover:text-red-600 transition-all"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-4 border-t border-gray-50 dark:border-slate-800 flex items-center justify-between">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t('users.showing_results', { start: filteredUsers.length === 0 ? 0 : (page * limit) + 1, end: Math.min((page + 1) * limit, filteredUsers.length), total: filteredUsers.length })}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="p-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"><ChevronLeft className="w-4 h-4"/></button>
                <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1} className="p-2 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"><ChevronRight className="w-4 h-4"/></button>
              </div>
            </div>
          </>
        )}
      </div>
      </div>

      {/* User Add/Edit Modal */}
      {isFormModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white dark:bg-slate-900 w-full max-w-4xl h-full md:h-auto md:max-h-[95vh] md:rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-gray-50 dark:border-slate-800 flex items-center justify-between flex-shrink-0">
              <div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">{editingUser ? t('users.modal_edit_title') : t('users.modal_create_title')}</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t('users.modal_subtitle')}</p>
              </div>
              <button onClick={() => setIsFormModalOpen(false)} className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-xl bg-gray-50 dark:bg-slate-800 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="flex-1 overflow-y-auto p-6 md:p-8 scrollbar-hide">
              {formError && (
                <div className="mb-6 bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 text-red-600 dark:text-red-400 p-4 rounded-2xl flex items-center gap-3 text-sm animate-shake">
                  <AlertCircle className="h-5 w-5 shrink-0" />
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Section 1: Identity & Security */}
                <div className="space-y-5">
                  <h4 className="text-xs font-bold text-primary-600 uppercase tracking-widest flex items-center gap-2"><UserIcon className="w-4 h-4"/> {t('users.section_identity')}</h4>
                  <div className="space-y-4">
                    <InputField label={t('users.field_full_name')} required value={formData.name} onChange={(v: string) => setFormData({...formData, name: v})} placeholder={t('users.field_full_name_placeholder')} leftIcon={UserIcon} error={fieldErrors.name} />
                    <div className="grid grid-cols-2 gap-4">
                      <InputField label={t('users.field_username')} required value={formData.username} onChange={(v: string) => setFormData({...formData, username: v.toLowerCase()})} placeholder={t('users.field_username_placeholder')} leftIcon={Hash} error={fieldErrors.username} />
                      <InputField label={t('users.field_phone')} type="number" value={formData.phone_number} onChange={(v: string) => setFormData({...formData, phone_number: v})} placeholder={t('users.field_phone_placeholder')} leftIcon={Phone} />
                    </div>
                    <InputField label={t('users.field_email')} required type="email" value={formData.email} onChange={(v: string) => setFormData({...formData, email: v})} placeholder={t('users.field_email_placeholder')} leftIcon={Mail} error={fieldErrors.email} />
                    <InputField label={t('users.field_password')} required={!editingUser} type="password" value={formData.password} onChange={(v: string) => setFormData({...formData, password: v})} placeholder={t('users.field_password_placeholder')} leftIcon={Lock} error={fieldErrors.password} />
                    
                    <div className="grid grid-cols-2 gap-4">
                      <InputField label={t('users.field_telegram_id')} value={formData.telegram_id} onChange={(v: string) => setFormData({...formData, telegram_id: v})} placeholder={t('users.field_telegram_id_placeholder')} leftIcon={Hash} />
                      <div className="space-y-1.5">
                        <label className="block text-[11px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-0.5 ml-1">{t('users.field_status')}</label>
                        <select
                          name="status"
                          className="w-full py-3 px-4 bg-gray-50 dark:bg-slate-800/50 border border-transparent focus:border-primary-500/30 rounded-2xl text-sm outline-none transition-all dark:text-gray-100"
                          value={formData.status}
                          onChange={handleInputChange}
                        >
                          <option value="Active">{t('common.active')}</option>
                          <option value="Inactive">{t('common.inactive')}</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section 2: Roles & Permissions */}
                <div className="space-y-5">
                  <h4 className="text-xs font-bold text-blue-600 uppercase tracking-widest flex items-center gap-2"><Shield className="w-4 h-4"/> {t('users.section_access')}</h4>
                  <div className="space-y-6">
                    <div>
                      <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2.5 ml-1">{t('users.field_reporting_line')}</label>
                      <select
                        name="parent_id"
                        className="w-full py-3 px-4 bg-gray-50 dark:bg-slate-800/50 border border-transparent focus:border-primary-500/30 rounded-2xl text-sm outline-none transition-all dark:text-gray-100 appearance-none"
                        value={formData.parent_id}
                        onChange={handleInputChange}
                      >
                        <option value="">{t('users.field_no_parent')}</option>
                        {users.filter(u => u.id !== editingUser?.id).map(u => (
                          <option key={u.id} value={u.id}>{u.name} (@{u.username})</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2.5 ml-1">{t('users.field_system_roles')}</label>
                      <div className="flex flex-wrap gap-2 p-3 bg-gray-50 dark:bg-slate-800/50 rounded-2xl border border-dashed border-gray-200 dark:border-slate-700">
                        {roles.map(role => {
                          const isSelected = formData.role_ids.includes(role.id);
                          return (
                            <button
                              key={role.id}
                              type="button"
                              onClick={() => handleMultiSelect("role_ids", role.id)}
                              className={cn(
                                "px-3 py-1.5 rounded-xl text-[10px] font-bold transition-all border",
                                isSelected 
                                  ? "bg-primary-500 border-primary-500 text-white shadow-lg shadow-primary-200 dark:shadow-none" 
                                  : "bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700 text-gray-500 hover:border-primary-300"
                              )}
                            >
                              {role.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2.5 ml-1">{t('users.field_assigned_houses')}</label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-3 bg-gray-50 dark:bg-slate-800/50 rounded-2xl border border-dashed border-gray-200 dark:border-slate-700 max-h-[160px] overflow-y-auto custom-scrollbar">
                        {houses.map(house => {
                          const isSelected = formData.house_ids.includes(house.id);
                          return (
                            <button
                              key={house.id}
                              type="button"
                              onClick={() => handleMultiSelect("house_ids", house.id)}
                              className={cn(
                                "flex items-center justify-between px-3 py-2.5 rounded-xl text-[10px] font-bold transition-all border text-left",
                                isSelected 
                                  ? "bg-blue-500 border-blue-500 text-white shadow-lg shadow-blue-200 dark:shadow-none" 
                                  : "bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700 text-gray-500 hover:border-blue-300"
                              )}
                            >
                              <span className="truncate">{house.name}</span>
                              {isSelected && <Check className="w-3 h-3 shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-10 pt-6 border-t border-gray-50 dark:border-slate-800 flex gap-4">
                <button type="button" onClick={() => setIsFormModalOpen(false)} className="flex-1 py-3 text-sm font-bold text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 rounded-2xl transition-all">{t('users.btn_cancel')}</button>
                <button type="submit" disabled={formLoading} className="flex-[2] py-3 bg-primary-600 text-white rounded-2xl text-sm font-bold hover:bg-primary-700 transition-all shadow-xl shadow-primary-200 dark:shadow-none flex items-center justify-center gap-2 group">
                  {formLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {editingUser ? t('users.btn_update') : t('users.btn_create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        onConfirm={handleConfirmDelete}
        type="danger"
        title={t('users.delete_title')}
        message={t('users.delete_message')}
        confirmText={t('users.delete_confirm')}
        loading={formLoading}
      />
    </div>
  );
}

// Stats Card Component
function StatCard({ title, value, icon: Icon, color }: any) {
  return (
    <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm flex items-center gap-4 transition-all hover:shadow-md">
      <div className={cn("p-3 rounded-xl text-white shadow-lg", color)}>
        <Icon className="w-6 h-6" />
      </div>
      <div>
        <p className="text-xs text-gray-500 dark:text-gray-400 font-bold uppercase tracking-widest">{title}</p>
        <p className="text-2xl font-black text-gray-900 dark:text-gray-100">{value}</p>
      </div>
    </div>
  );
}

// Reusable Input Field Component
function InputField({ label, value, onChange, placeholder, required = false, type = "text", disabled = false, leftIcon: Icon, error }: any) {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === "password";
  const inputType = isPassword ? (showPassword ? "text" : "password") : type;

  return (
    <div className="space-y-1.5 text-left">
      <label className="block text-[11px] font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider mb-0.5 ml-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <div className="relative group/input">
        {Icon && (
          <div className={cn(
            "absolute left-4 top-1/2 -translate-y-1/2 transition-colors z-10",
            error ? "text-red-500" : "text-gray-400 group-focus-within/input:text-primary-500"
          )}>
            <Icon className="w-4 h-4" />
          </div>
        )}
        <input
          type={inputType}
          required={required}
          disabled={disabled}
          className={cn(
            "w-full py-3 bg-gray-50 dark:bg-slate-800/50 border transition-all dark:text-gray-100 outline-none disabled:opacity-50 rounded-2xl text-sm",
            Icon ? "pl-11" : "pl-4",
            isPassword ? "pr-12" : "pr-4",
            error 
              ? "border-red-500/50 focus:border-red-500 ring-1 ring-red-500/10" 
              : "border-transparent focus:border-primary-500/30"
          )}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-primary-500 transition-colors"
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </div>
      {error && <p className="text-[10px] text-red-500 font-bold ml-1 animate-in slide-in-from-top-1 duration-200">{error}</p>}
    </div>
  );
}
