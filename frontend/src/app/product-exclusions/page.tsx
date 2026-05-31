"use client";

import { useEffect, useState } from "react";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  Ban,
  Plus,
  X,
  Loader2,
  Hash,
} from "lucide-react";
import { toast } from "react-hot-toast";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import { useLanguage } from "@/i18n/useLanguage";

interface ExcludedCode {
  id: number;
  product_code: string;
  created_at: string | null;
}

export default function ProductExclusionsPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const { t } = useLanguage();

  const [codes, setCodes] = useState<ExcludedCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCode, setNewCode] = useState("");
  const [adding, setAdding] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ExcludedCode | null>(null);

  const fetchCodes = () => {
    setLoading(true);
    apiClient.get("product-exclusions")
      .then(res => setCodes(res.data))
      .catch(() => toast.error(t("product_exclusions.toast_load_failed")))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!authLoading && hasPermission("view_reports")) fetchCodes();
  }, [authLoading, hasPermission]);

  const handleAdd = async () => {
    const code = newCode.trim().toUpperCase();
    if (!code) return;
    setAdding(true);
    try {
      await apiClient.post("product-exclusions", { product_code: code });
      toast.success(t("product_exclusions.toast_added"));
      setNewCode("");
      fetchCodes();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || t("common.error"));
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = () => {
    const target = deleteTarget;
    if (!target) return;
    apiClient.delete(`product-exclusions/${target.id}`)
      .then(() => {
        toast.success(t("product_exclusions.toast_deleted"));
        setDeleteTarget(null);
        fetchCodes();
      })
      .catch(() => toast.error(t("common.error")));
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  if (!hasPermission("view_reports")) {
    return <AccessDenied />;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-red-500 text-white shadow-lg shadow-red-200 dark:shadow-none">
            <Ban className="w-5 h-5" />
          </div>
          {t("product_exclusions.title")}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 ml-12">
          {t("product_exclusions.description")}
        </p>
      </div>

      {/* Add form */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-6">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              {t("product_exclusions.code_label")}
            </label>
            <input
              type="text"
              value={newCode}
              onChange={e => setNewCode(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAdd()}
              placeholder={t("product_exclusions.code_placeholder")}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all text-sm"
            />
          </div>
          <button
            onClick={handleAdd}
            disabled={adding || !newCode.trim()}
            className="px-5 py-2.5 bg-primary-600 text-white rounded-lg text-sm font-semibold hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {t("product_exclusions.create_code")}
          </button>
        </div>
      </div>

      {/* Codes list */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm">
        <div className="px-6 py-4 border-b border-gray-50 dark:border-slate-800 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Hash className="w-4 h-4 text-gray-400" />
            {t("product_exclusions.title")}
            {codes.length > 0 && (
              <span className="text-xs font-bold bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 px-2 py-0.5 rounded-full">
                {codes.length}
              </span>
            )}
          </h2>
        </div>

        {loading ? (
          <div className="p-8 text-center">
            <Loader2 className="w-6 h-6 animate-spin text-primary-500 mx-auto" />
          </div>
        ) : codes.length === 0 ? (
          <div className="p-8 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-50 dark:bg-slate-800 mb-3">
              <Ban className="w-6 h-6 text-gray-300 dark:text-gray-600" />
            </div>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{t("product_exclusions.no_codes")}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t("product_exclusions.no_codes_hint")}</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-slate-800">
            {codes.map(code => (
              <div key={code.id} className="flex items-center justify-between px-6 py-3.5 hover:bg-gray-50/50 dark:hover:bg-slate-800/50 transition-colors group">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-red-50 dark:bg-red-500/10 flex items-center justify-center">
                    <Ban className="w-4 h-4 text-red-500" />
                  </div>
                  <span className="text-sm font-medium text-gray-900 dark:text-gray-100 font-mono">
                    {code.product_code}
                  </span>
                </div>
                <button
                  onClick={() => setDeleteTarget(code)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all"
                  title={t("product_exclusions.delete_code")}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={t("product_exclusions.delete_code")}
        message={`Are you sure you want to remove "${deleteTarget?.product_code}" from the exclusion list?`}
        confirmText={t("product_exclusions.delete_code")}
        type="danger"
      />
    </div>
  );
}
