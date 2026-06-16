"use client";

import { useEffect, useState, useMemo } from "react";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { motion, AnimatePresence } from "framer-motion";
import {
  Ban,
  Plus,
  Loader2,
  Hash,
  Search,
  Trash2,
  CalendarDays,
} from "lucide-react";
import { toast } from "react-hot-toast";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import { useLanguage } from "@/i18n/useLanguage";
import { cn } from "@/lib/utils";

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
  const [search, setSearch] = useState("");

  const filteredCodes = useMemo(
    () => codes.filter(c => c.product_code.toLowerCase().includes(search.toLowerCase())),
    [codes, search]
  );

  const fetchCodes = () => {
    setLoading(true);
    apiClient.get("product-exclusions")
      .then(res => setCodes(res.data))
      .catch(() => toast.error(t("product_exclusions.toast_load_failed")))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!authLoading && hasPermission("reports.view")) fetchCodes();
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

  if (!hasPermission("reports.view")) {
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
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className="p-2 rounded-xl bg-gradient-to-br from-red-50 to-red-100 dark:from-red-500/10 dark:to-red-600/5 shadow-sm">
              <Hash className="w-4 h-4 text-red-600 dark:text-red-400" />
            </div>
            <span className="font-semibold text-gray-900 dark:text-gray-100">{t("product_exclusions.title")}</span>
            <span className={cn(
              "text-xs font-bold px-2.5 py-0.5 rounded-full transition-colors",
              codes.length > 0
                ? "bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300"
                : "bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-gray-400"
            )}>
              {codes.length}
            </span>
          </div>
          {codes.length > 0 && (
            <div className="relative w-full sm:w-56">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search codes..."
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-gray-50 dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400 dark:focus:border-red-500 transition-all"
              />
            </div>
          )}
        </div>

        {loading ? (
          <div className="p-12 text-center">
            <Loader2 className="w-7 h-7 animate-spin text-primary-500 mx-auto" />
          </div>
        ) : codes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-gray-50 to-gray-100 dark:from-slate-800 dark:to-slate-700/50 flex items-center justify-center mb-5 shadow-sm border border-gray-200/50 dark:border-slate-700/50">
              <Ban className="w-7 h-7 text-gray-400 dark:text-gray-500" />
            </div>
            <p className="text-base font-semibold text-gray-900 dark:text-gray-100">{t("product_exclusions.no_codes")}</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1 max-w-xs text-center">{t("product_exclusions.no_codes_hint")}</p>
          </div>
        ) : filteredCodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6">
            <div className="w-14 h-14 rounded-2xl bg-gray-50 dark:bg-slate-800/50 flex items-center justify-center mb-4">
              <Search className="w-6 h-6 text-gray-400" />
            </div>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">No codes match &ldquo;{search}&rdquo;</p>
            <button onClick={() => setSearch("")} className="mt-3 text-sm text-primary-600 dark:text-primary-400 hover:underline">Clear search</button>
          </div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-slate-800">
            <AnimatePresence initial={false}>
              {filteredCodes.map((code, i) => (
                <motion.div
                  key={code.id}
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.25, delay: i * 0.03, ease: "easeOut" }}
                  className="group relative flex items-center justify-between px-6 py-3.5 hover:bg-gradient-to-r hover:from-gray-50/80 hover:to-transparent dark:hover:from-slate-800/50 dark:hover:to-transparent transition-all duration-200"
                >
                  {/* Left accent bar */}
                  <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-transparent group-hover:bg-red-400/40 dark:group-hover:bg-red-500/30 transition-all duration-200" />

                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-50 to-red-100 dark:from-red-500/10 dark:to-red-600/5 flex items-center justify-center shrink-0 shadow-sm ring-1 ring-red-100/50 dark:ring-red-500/10 group-hover:shadow group-hover:ring-red-200/50 dark:group-hover:ring-red-500/20 transition-all">
                      <Ban className="w-4 h-4 text-red-500" />
                    </div>
                    <div className="min-w-0">
                      <span className="text-sm font-bold text-gray-900 dark:text-gray-100 font-mono tracking-wide">
                        {code.product_code}
                      </span>
                      {code.created_at && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <CalendarDays className="w-3 h-3 text-gray-400" />
                          <span className="text-[11px] text-gray-400 dark:text-gray-500 font-medium">
                            {new Date(code.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => setDeleteTarget(code)}
                    className="p-2 rounded-xl text-gray-400 hover:text-white hover:bg-red-500 dark:hover:bg-red-500 opacity-0 group-hover:opacity-100 transition-all duration-200 -mr-1"
                    title={t("product_exclusions.delete_code")}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>
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
