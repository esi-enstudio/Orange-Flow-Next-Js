"use client";
import { useAuth } from "@/context/AuthContext";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { useLanguage } from "@/i18n/useLanguage";

export default function ScratchCardReportPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const { t } = useLanguage();
  if (!authLoading && !hasPermission("scratch_card.view")) {
    return <AccessDenied />;
  }
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
        {t('nav.report_scratch_card')}
      </h1>
    </div>
  );
}
