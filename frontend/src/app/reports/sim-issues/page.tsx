"use client";
import { useLanguage } from "@/i18n/useLanguage";

export default function SimIssuesReportPage() {
  const { t } = useLanguage();
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
        {t('nav.report_sim_issue')}
      </h1>
    </div>
  );
}
