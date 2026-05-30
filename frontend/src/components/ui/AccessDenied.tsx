"use client";

import { Lock, ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/i18n/useLanguage";

export function AccessDenied() {
  const router = useRouter();
  const { t } = useLanguage();

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4 animate-in fade-in zoom-in duration-500">
      <div className="w-20 h-20 bg-red-50 dark:bg-red-500/10 rounded-full flex items-center justify-center mb-6 border border-red-100 dark:border-red-500/20 shadow-xl shadow-red-500/5">
        <Lock className="w-10 h-10 text-red-500" />
      </div>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">{t('common.access_denied')}</h2>
      <p className="text-gray-500 dark:text-gray-400 max-w-sm mb-8 font-medium">
        {t('common.unauthorized_msg')}
      </p>
      <button 
        onClick={() => router.push("/")}
        className="px-8 py-3 bg-primary-600 text-white rounded-2xl font-bold hover:bg-primary-700 transition-all shadow-xl shadow-primary-200 dark:shadow-none flex items-center gap-2 group"
      >
        <ChevronLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
        {t('common.go_home')}
      </button>
    </div>
  );
}
