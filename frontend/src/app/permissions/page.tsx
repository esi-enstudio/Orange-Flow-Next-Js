"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { 
  Key, 
  Plus, 
  Search, 
  Trash2, 
  X, 
  Check, 
  Loader2,
  ShieldAlert
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import { ChevronLeft, ChevronRight as ChevronRightIcon } from "lucide-react";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { useLanguage } from "@/i18n/useLanguage";

interface Permission {
  id: number;
  name: string;
  created_at?: string;
}

export default function PermissionsPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const router = useRouter();
  const { t } = useLanguage();
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newPermName, setNewPermName] = useState("");
  const [formLoading, setFormLoading] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    if (!authLoading && !hasPermission("view_permissions")) {
      const timer = setTimeout(() => {
        router.push("/");
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [authLoading, hasPermission, router]);

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 21;

  const fetchPermissions = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get("permissions");
      setPermissions(response.data);
    } catch (err) {
      toast.error(t('permissions.toast_load_failed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && hasPermission("view_permissions")) {
      fetchPermissions();
    }
  }, [authLoading, hasPermission]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPermName.trim()) return;
    setFormLoading(true);
    
    const sanitizedName = newPermName
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
      .replace(/[^a-z0-9_]/g, '')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');

    try {
      await apiClient.post("permissions", { name: sanitizedName });
      toast.success(t('permissions.toast_create_success'));
      setIsModalOpen(false);
      setNewPermName("");
      fetchPermissions();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || "Failed to create permission");
    } finally {
      setFormLoading(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingId) return;
    setFormLoading(true);
    try {
      await apiClient.delete(`permissions/${deletingId}`);
      toast.success(t('permissions.toast_delete_success'));
      setIsConfirmOpen(false);
      fetchPermissions();
    } catch (err) {
      toast.error(t('permissions.toast_delete_failed'));
    } finally {
      setFormLoading(false);
      setDeletingId(null);
    }
  };

  const filteredPermissions = permissions.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase())
  );

  const totalPages = Math.ceil(filteredPermissions.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedPermissions = filteredPermissions.slice(startIndex, startIndex + itemsPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [search]);

  const isNew = (createdAt?: string) => {
    if (!createdAt) return false;
    const created = new Date(createdAt);
    const now = new Date();
    const diffInHours = (now.getTime() - created.getTime()) / (1000 * 60 * 60);
    return diffInHours <= 24;
  };

  if (!authLoading && !hasPermission("view_permissions")) {
    return <AccessDenied />;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('permissions.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('permissions.description')}</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-bold hover:bg-primary-700 transition-colors shadow-lg"
        >
          <Plus className="w-4 h-4" /> {t('permissions.add_new')}
        </button>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col min-h-[500px]">
        <div className="p-4 border-b dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="relative max-w-md w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input 
              type="text" 
              placeholder={t('permissions.search_placeholder')}
              className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-slate-800 border-none rounded-xl text-sm outline-none dark:text-gray-100"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          
          {totalPages > 1 && (
            <div className="flex items-center gap-2 bg-gray-50 dark:bg-slate-800 p-1 rounded-xl">
              <button 
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="p-1.5 rounded-lg hover:bg-white dark:hover:bg-slate-700 disabled:opacity-30 transition-all"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs font-bold px-2 dark:text-gray-300">
                {t('permissions.page_info', { current: currentPage, total: totalPages })}
              </span>
              <button 
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="p-1.5 rounded-lg hover:bg-white dark:hover:bg-slate-700 disabled:opacity-30 transition-all"
              >
                <ChevronRightIcon className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        <div className="flex-1">
          {loading ? (
            <div className="h-full py-20 flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary-500"/></div>
          ) : paginatedPermissions.length === 0 ? (
            <div className="h-full py-20 flex items-center justify-center text-gray-500">{t('permissions.no_permissions')}</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 p-4">
              {paginatedPermissions.map((perm) => (
                <div key={perm.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-slate-800/50 rounded-xl group transition-all hover:bg-primary-50 dark:hover:bg-primary-500/5 border border-transparent hover:border-primary-200 dark:hover:border-primary-500/20">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-white dark:bg-slate-900 border dark:border-slate-700 flex items-center justify-center text-gray-400 group-hover:text-primary-500 transition-colors shadow-sm">
                      <Key className="w-4 h-4" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm font-mono font-bold text-gray-700 dark:text-gray-300 group-hover:text-primary-700 dark:group-hover:text-primary-400 transition-colors">{perm.name}</span>
                      {isNew(perm.created_at) && (
                        <span className="text-[8px] font-bold bg-green-500 text-white px-1.5 py-0.5 rounded-full w-fit animate-pulse">{t('permissions.label_new')}</span>
                      )}
                    </div>
                  </div>
                  <button 
                    onClick={() => {setDeletingId(perm.id); setIsConfirmOpen(true);}}
                    className="p-2 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t dark:border-slate-800 bg-gray-50/30 dark:bg-slate-900/30 flex items-center justify-between text-[10px] text-gray-500 uppercase tracking-widest font-bold">
          <div>{t('permissions.showing_results', { start: startIndex + 1, end: Math.min(startIndex + itemsPerPage, filteredPermissions.length), total: filteredPermissions.length })}</div>
          {totalPages > 1 && <div>{t('permissions.page_info', { current: currentPage, total: totalPages })}</div>}
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-lg font-bold dark:text-gray-100">{t('permissions.modal_title')}</h3>
              <button onClick={() => setIsModalOpen(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg"><X className="w-5 h-5"/></button>
            </div>
            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-[11px] font-bold text-gray-500 uppercase">{t('permissions.field_name')}</label>
                <input 
                  type="text"
                  placeholder={t('permissions.field_name_placeholder')}
                  className="w-full p-3 bg-gray-50 dark:bg-slate-800 border-none rounded-xl text-sm outline-none focus:ring-1 focus:ring-primary-500 dark:text-gray-100"
                  value={newPermName}
                  onChange={e => setNewPermName(e.target.value)}
                  required
                />
                <p className="text-[10px] text-gray-400 mt-1 italic">{t('permissions.field_hint')}</p>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-2.5 text-sm font-bold text-gray-500 hover:bg-gray-100 rounded-xl">{t('common.cancel')}</button>
                <button type="submit" disabled={formLoading || !newPermName} className="flex-[2] py-2.5 bg-primary-600 text-white rounded-xl text-sm font-bold hover:bg-primary-700 disabled:opacity-50 flex items-center justify-center gap-2">
                  {formLoading ? <Loader2 className="w-4 h-4 animate-spin"/> : <Check className="w-4 h-4"/>}
                  {t('permissions.btn_create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        onConfirm={handleConfirmDelete}
        title={t('permissions.delete_title')}
        message={t('permissions.delete_message')}
        type="danger"
        loading={formLoading}
      />
    </div>
  );
}
