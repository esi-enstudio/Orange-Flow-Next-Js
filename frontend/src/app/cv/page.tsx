"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { FileText, Plus, Search, Eye, Edit2, Trash2, FileDown, Loader2 } from "lucide-react";
import { useLanguage } from "@/i18n/useLanguage";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import { toast } from "react-hot-toast";
import type { CV } from "@/types/cv";

export default function CVListPage() {
  const { selectedHouse, hasPermission, loading: authLoading } = useAuth();
  const router = useRouter();
  const { t } = useLanguage();
  const [cvs, setCvs] = useState<CV[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const perPage = 10;

  useEffect(() => {
    if (!authLoading && !hasPermission("cv.view")) {
      router.push("/");
    }
  }, [authLoading, hasPermission, router]);

  const fetchCVs = async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, per_page: perPage };
      if (selectedHouse?.id) params["X-House-ID"] = selectedHouse.id;
      if (search) params.search = search;
      const res = await apiClient.get("cv", { params });
      setCvs(res.data.data || []);
      const pag = res.data.pagination;
      setTotalPages(pag?.total_pages || 1);
      setTotal(pag?.total || 0);
    } catch (err) {
      toast.error("Failed to load CVs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && hasPermission("cv.view")) fetchCVs();
  }, [page, selectedHouse, authLoading]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchCVs();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await apiClient.delete(`cv/${deleteId}`);
      toast.success("CV deleted successfully");
      setShowDeleteModal(false);
      setDeleteId(null);
      fetchCVs();
    } catch {
      toast.error("Failed to delete CV");
    } finally {
      setDeleting(false);
    }
  };

  const handleExportWord = async (cv: CV) => {
    try {
      const res = await apiClient.get(`cv/${cv.slug}/export/word`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `CV_${cv.slug || cv.name.replace(/\s+/g, "_")}.docx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success("Word file downloaded");
    } catch (err: any) {
      const msg = err?.response?.data?.detail || "Failed to export Word";
      toast.error(msg);
    }
  };

  if (!authLoading && !hasPermission("cv.view")) return <AccessDenied />;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {t("cv.list.title") || "CV Management"}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t("cv.list.description") || "Create and manage curriculum vitae"}
          </p>
        </div>
        {hasPermission("cv.create") && (
          <button
            onClick={() => router.push("/cv/create")}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            {t("cv.list.create") || "Create CV"}
          </button>
        )}
      </div>

      <form onSubmit={handleSearch} className="mb-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("cv.list.search_placeholder") || "Search by name, mobile or NID..."}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
          />
        </div>
      </form>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 bg-gray-100 dark:bg-slate-800 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : cvs.length === 0 ? (
        <div className="text-center py-16">
          <FileText className="w-12 h-12 mx-auto text-gray-300 dark:text-gray-600 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">
            {t("cv.list.no_data") || "No CVs found"}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("cv.list.no_data_desc") || "Create your first CV to get started."}
          </p>
        </div>
      ) : (
        <>
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50">
                    <th className="px-2 py-1 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Name</th>
                    <th className="px-2 py-1 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden sm:table-cell">Mobile</th>
                    <th className="px-2 py-1 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden md:table-cell">NID</th>
                    <th className="px-2 py-1 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                  {cvs.map((cv) => (
                    <tr key={cv.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors">
                      <td className="px-2 py-1">
                        <p className="font-medium text-gray-900 dark:text-white">{cv.name}</p>
                      </td>
                      <td className="px-2 py-1 hidden sm:table-cell text-sm text-gray-500 dark:text-gray-400">{cv.mobile || "-"}</td>
                      <td className="px-2 py-1 hidden md:table-cell text-sm text-gray-500 dark:text-gray-400">{cv.nid_number || "-"}</td>
                      <td className="px-2 py-1 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => router.push(`/cv/${cv.slug}`)}
                            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
                            title="View"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {hasPermission("cv.edit") && (
                            <button
                              onClick={() => router.push(`/cv/${cv.slug}/edit`)}
                              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500 dark:text-gray-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                              title="Edit"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                          )}
                          {hasPermission("cv.export") && (
                            <button
                              onClick={() => handleExportWord(cv)}
                              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                              title="Export Word"
                            >
                              <FileDown className="w-4 h-4" />
                            </button>
                          )}
                          {hasPermission("cv.delete") && (
                            <button
                              onClick={() => { setDeleteId(cv.id); setShowDeleteModal(true); }}
                              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                              title="Delete"
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
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Page {page} of {totalPages} ({total} total)
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 text-sm border border-gray-200 dark:border-slate-700 rounded-lg disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                >
                  Prev
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1.5 text-sm border border-gray-200 dark:border-slate-700 rounded-lg disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <ConfirmationModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
        title="Delete CV?"
        message="Are you sure you want to delete this CV? This action cannot be undone."
        confirmText={deleting ? "Deleting..." : "Yes, Delete"}
        loading={deleting}
        type="danger"
      />
    </div>
  );
}
