"use client";

import { useEffect, useState, useCallback } from "react";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Crosshair, Plus, Loader2, Building2 } from "lucide-react";
import { toast } from "react-hot-toast";
import { useLanguage } from "@/i18n/useLanguage";

export default function BPTargetsPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [houses, setHouses] = useState<any[]>([]);
  const [selectedHouseId, setSelectedHouseId] = useState("");
  const [distributing, setDistributing] = useState(false);
  const { loading: authLoading, hasPermission } = useAuth();
  const { t } = useLanguage();
  const today = new Date();
  const monthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;

  const fetchData = useCallback(async () => {
    if (!hasPermission("bp_targets.view")) { setLoading(false); return; }
    setLoading(true);
    try {
      const params: Record<string, string> = { target_date: monthStr };
      if (selectedHouseId) params.house_id = selectedHouseId;
      const res = await apiClient.get("bp-targets", { params });
      setData(res.data?.data || []);
    } catch {}
    setLoading(false);
  }, [selectedHouseId, hasPermission, monthStr]);

  useEffect(() => {
    if (authLoading) return;
    apiClient.get("houses/accessible").then(res => setHouses(res.data || [])).catch(() => {});
  }, [authLoading]);

  useEffect(() => { if (!authLoading) fetchData(); }, [fetchData, authLoading]);

  const handleDistribute = async () => {
    setDistributing(true);
    try {
      const params: Record<string, string> = { target_date: monthStr };
      if (selectedHouseId) params.house_id = selectedHouseId;
      const res = await apiClient.post("bp-targets/distribute", null, { params });
      toast.success(res.data?.message || t("bp_targets.distribute_success"));
      fetchData();
    } catch { toast.error("Failed to distribute"); }
    setDistributing(false);
  };

  const canEdit = hasPermission("bp_targets.edit");

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">{t("bp_targets.title")}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t("bp_targets.manage_for", { month: monthStr })}</p>
        </div>
        <div className="flex items-center gap-3">
          {houses.length > 1 && (
            <div className="relative">
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <select value={selectedHouseId} onChange={e => setSelectedHouseId(e.target.value)}
                className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-primary-500 appearance-none cursor-pointer">
                <option value="">{t("bp_targets.all_houses")}</option>
                {houses.map((h: any) => <option key={h.id} value={h.id}>{h.display_name}</option>)}
              </select>
            </div>
          )}
          {canEdit && (
            <button onClick={handleDistribute} disabled={distributing}
              className="px-4 py-2 bg-primary-500 text-white rounded-xl text-sm font-semibold flex items-center gap-2 hover:bg-primary-600 transition-colors disabled:opacity-50">
              {distributing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {t("bp_targets.auto_distribute")}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 bg-gray-100 dark:bg-slate-800 rounded-xl animate-pulse" />
        ))}</div>
      ) : data.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Crosshair className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4" />
          <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">{t("bp_targets.no_data")}</h3>
          <p className="text-sm text-gray-500 mt-2">{t("bp_targets.no_data_desc")}</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-50 dark:border-slate-800">
                <th className="text-left px-6 py-4 font-semibold text-gray-700 dark:text-gray-300">{t("bp_targets.bp")}</th>
                <th className="text-left px-6 py-4 font-semibold text-gray-700 dark:text-gray-300">{t("bp_targets.house")}</th>
                <th className="text-right px-6 py-4 font-semibold text-gray-700 dark:text-gray-300">{t("bp_targets.ga_target")}</th>
                <th className="text-right px-6 py-4 font-semibold text-gray-700 dark:text-gray-300">{t("bp_targets.ev_target")}</th>
                <th className="text-right px-6 py-4 font-semibold text-gray-700 dark:text-gray-300">{t("bp_targets.sc_target")}</th>
                <th className="text-right px-6 py-4 font-semibold text-gray-700 dark:text-gray-300">{t("bp_targets.recharge")}</th>
                <th className="text-center px-6 py-4 font-semibold text-gray-700 dark:text-gray-300">{t("bp_targets.date")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
              {data.map((bt: any) => (
                <tr key={bt.id} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/50">
                  <td className="px-6 py-4 font-medium text-gray-900 dark:text-gray-100">
                    {bt.employee?.employee_id || `BP #${bt.employee_id}`}
                  </td>
                  <td className="px-6 py-4 text-gray-500">{bt.house?.display_name || ""}</td>
                  <td className="px-6 py-4 text-right font-semibold text-gray-900 dark:text-gray-100">{bt.ga_target}</td>
                  <td className="px-6 py-4 text-right text-gray-500">{bt.ev_secondary}</td>
                  <td className="px-6 py-4 text-right text-gray-500">{bt.sc_secondary}</td>
                  <td className="px-6 py-4 text-right text-gray-500">{bt.total_recharge}</td>
                  <td className="px-6 py-4 text-center text-gray-400 text-xs">{bt.target_date?.split("T")[0]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
