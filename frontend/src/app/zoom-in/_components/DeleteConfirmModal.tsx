"use client";

import { useLanguage } from "@/i18n/useLanguage";
import { Loader2, Trash2, AlertTriangle, X } from "lucide-react";

interface DeleteConfirmModalProps {
  isOpen: boolean;
  deleting: { id: number; label: string } | null;
  loading: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export default function DeleteConfirmModal({ isOpen, deleting, loading, onConfirm, onClose }: DeleteConfirmModalProps) {
  const { t } = useLanguage();

  if (!isOpen || !deleting) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-2xl shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden">
        <div className="flex items-center justify-end p-4 pb-0">
          <button
            onClick={onClose}
            disabled={loading}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-8 pb-2 flex flex-col items-center text-center">
          <div className="w-20 h-20 rounded-full bg-red-100 dark:bg-red-500/20 flex items-center justify-center mb-6">
            <AlertTriangle className="w-10 h-10 text-red-600 dark:text-red-400" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            {t("zoom_in.messages.delete_confirm")}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            <span className="font-semibold text-gray-700 dark:text-gray-300">{deleting.label}</span>
          </p>
        </div>

        <div className="px-8 pb-8 pt-6 flex flex-col gap-3">
          <button
            onClick={onConfirm}
            disabled={loading}
            className="w-full py-3.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
            {loading ? t("common.processing") : t("common.delete")}
          </button>
          <button
            onClick={onClose}
            disabled={loading}
            className="w-full py-3.5 rounded-xl text-gray-500 dark:text-gray-400 font-bold hover:bg-gray-50 dark:hover:bg-slate-800 transition-all"
          >
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
