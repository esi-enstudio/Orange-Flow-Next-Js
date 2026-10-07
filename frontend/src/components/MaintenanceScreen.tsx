"use client";

import { useEffect } from "react";
import { Wrench, RefreshCw, Clock } from "lucide-react";
import { useLanguage } from "@/i18n/useLanguage";
import { useBrand } from "@/context/BrandContext";
import { useMaintenance } from "@/context/MaintenanceContext";
import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";

/**
 * Full-screen maintenance notice.
 *
 * - `standalone` — mounted directly by the /maintenance route or by the
 *   enforced-phase gate; sets the browser tab title itself (the app shell,
 *   sidebar and DynamicPageTitle are not rendered in that state).
 */
export function MaintenanceScreen({ standalone = false }: { standalone?: boolean }) {
  const { t, language } = useLanguage();
  const { brand } = useBrand();
  const { phase, timeLeft, status, refresh } = useMaintenance();

  const appName = brand.app_name || "OrangeFlow";
  const enforced = phase === "enforced";
  const message = status.message || t("maintenance.default_message");

  useEffect(() => {
    if (!standalone) return;
    document.title = `${t("maintenance.screen.title")} | ${appName}`;
  }, [standalone, t, appName, language]);

  return (
    <div className="min-h-screen w-full bg-[#F8FAFC] dark:bg-slate-950 flex items-center justify-center p-4 relative">
      <div className="absolute top-3 right-3 sm:top-4 sm:right-4">
        <LanguageSwitcher />
      </div>

      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-3xl border border-gray-100 dark:border-slate-800 shadow-xl p-6 sm:p-8 text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-500/10">
          {brand.logo ? (
            <img
              src={brand.logo}
              alt={appName}
              className="h-16 w-16 rounded-2xl object-cover"
            />
          ) : (
            <Wrench className="h-8 w-8 text-amber-600 dark:text-amber-400" />
          )}
        </div>

        <p className="text-xs font-bold uppercase tracking-widest text-primary-600 dark:text-primary-400">
          {appName}
        </p>
        <h1 className="mt-2 text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100">
          {enforced
            ? t("maintenance.screen.title")
            : t("maintenance.screen.grace_title")}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-gray-600 dark:text-gray-400 break-words">
          {message}
        </p>

        {phase === "grace" && timeLeft !== null && (
          <div className="mt-6 inline-flex flex-col items-center gap-1 rounded-2xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 px-6 py-4">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
              <Clock className="w-3.5 h-3.5" />
              {t("maintenance.screen.countdown")}
            </span>
            <span className="text-3xl font-bold tabular-nums text-gray-900 dark:text-gray-100">
              {timeLeft}
            </span>
          </div>
        )}

        <div className="mt-7 flex flex-col items-center gap-3">
          <button
            onClick={() => refresh()}
            className="inline-flex min-h-[44px] w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-primary-500 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-600 cursor-pointer disabled:cursor-not-allowed"
          >
            <RefreshCw className="w-4 h-4" />
            {t("maintenance.screen.retry")}
          </button>
          <p className="text-[11px] text-gray-400 dark:text-gray-500">
            {t("maintenance.screen.contact")}
          </p>
        </div>
      </div>
    </div>
  );
}
