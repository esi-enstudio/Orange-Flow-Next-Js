"use client";

import { useEffect, useState } from "react";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import { Activity, Building2, ShieldAlert } from "lucide-react";
import OtpPanel from "@/components/OtpPanel";
import SystemLogsPanel from "@/components/SystemLogsPanel";

interface House {
  id: number;
  name: string;
  code: string;
  display_name: string;
}

export default function LiveMonitorPage() {
  const { loading: authLoading, hasPermission } = useAuth();
  const { t } = useLanguage();
  const [houses, setHouses] = useState<House[]>([]);
  const [selectedHouseId, setSelectedHouseId] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const canMonitor =
    hasPermission("otp.view") || hasPermission("system_logs.view");

  useEffect(() => {
    if (authLoading) return;
    if (!canMonitor) {
      setLoading(false);
      return;
    }
    apiClient
      .get("houses/accessible")
      .then((res) => {
        const h = res.data || [];
        setHouses(h);
        if (h.length === 1) setSelectedHouseId(String(h[0].id));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [authLoading, canMonitor]);

  if (!authLoading && !canMonitor) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
        <ShieldAlert className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <p className="text-gray-500 dark:text-gray-400">{t("common.access_denied")}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6 p-4 md:p-6 max-w-7xl mx-auto animate-pulse">
        <div className="h-8 w-64 bg-gray-200 dark:bg-slate-700 rounded-lg" />
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-[480px] bg-gray-200 dark:bg-slate-700 rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400">
              <Activity className="w-5 h-5" />
            </span>
            {t("nav.live_monitor")}
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
            {t("monitor.subtitle")}
          </p>
        </div>
        {houses.length > 1 && (
          <div className="relative">
            <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <select
              value={selectedHouseId}
              onChange={(e) => setSelectedHouseId(e.target.value)}
              className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg text-sm font-medium text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors shadow-sm outline-none focus:ring-2 focus:ring-primary-500 appearance-none cursor-pointer"
            >
              <option value="">{t("common.all")}</option>
              {houses.map((h) => (
                <option key={h.id} value={h.id}>{h.display_name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Panels */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        {hasPermission("otp.view") && <OtpPanel houseId={selectedHouseId} />}
        {hasPermission("system_logs.view") && <SystemLogsPanel />}
      </div>
    </div>
  );
}