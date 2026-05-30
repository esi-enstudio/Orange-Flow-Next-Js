"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { Rocket, ShieldCheck, Database, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";

export default function SetupWizard() {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { refreshStatus } = useAuth();
  const { t } = useLanguage();

  const handleInitialize = async () => {
    setStatus("loading");
    setError(null);
    try {
      await apiClient.post("admin/setup/initialize-system");
      setStatus("success");
      
      await refreshStatus();
      
      setTimeout(() => {
        router.push("/login");
      }, 2000);
    } catch (err: any) {
      console.error("Initialization failed", err);
      setStatus("error");
      setError(err.response?.data?.detail || t('setup.init_error'));
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-3xl shadow-xl shadow-slate-200/50 dark:shadow-none border border-slate-100 dark:border-slate-800 p-8 md:p-10 transition-all duration-300">
        <div className="text-center space-y-4">
          <div className="w-20 h-20 bg-primary-100 dark:bg-primary-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6 animate-bounce">
            <Rocket className="w-10 h-10 text-primary-600 dark:text-primary-400" />
          </div>
          
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white">{t('setup.title')}</h1>
          <p className="text-slate-500 dark:text-slate-400">
            {t('setup.description')}
          </p>
        </div>

        <div className="mt-10 space-y-4">
          <div className="flex items-start gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
            <ShieldCheck className="w-5 h-5 text-green-600 mt-1 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">{t('setup.step1_title')}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{t('setup.step1_desc')}</p>
            </div>
          </div>

          <div className="flex items-start gap-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
            <Database className="w-5 h-5 text-blue-600 mt-1 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">{t('setup.step2_title')}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{t('setup.step2_desc')}</p>
            </div>
          </div>
        </div>

        <div className="mt-10">
          {status === "idle" || status === "error" ? (
            <button
              onClick={handleInitialize}
              className="w-full py-4 bg-primary-600 hover:bg-primary-700 text-white rounded-2xl font-bold shadow-lg shadow-primary-200 dark:shadow-none transition-all duration-300 flex items-center justify-center gap-2 group"
            >
              {t('setup.init_button')}
              <Rocket className="w-5 h-5 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
            </button>
          ) : status === "loading" ? (
            <div className="w-full py-4 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-2xl font-bold flex items-center justify-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              {t('setup.init_loading')}
            </div>
          ) : (
            <div className="w-full py-4 bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400 rounded-2xl font-bold flex items-center justify-center gap-2">
              <CheckCircle2 className="w-5 h-5" />
              {t('setup.init_success')}
            </div>
          )}

          {status === "error" && error && (
            <div className="mt-4 p-4 rounded-xl bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}
        </div>

        <p className="text-center text-xs text-slate-400 mt-8">
          {t('setup.version')}
        </p>
      </div>
    </div>
  );
}
