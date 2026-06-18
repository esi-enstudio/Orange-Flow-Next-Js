"use client";

import { useEffect, useState, useCallback } from "react";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Store, Plus, Search, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import { useLanguage } from "@/i18n/useLanguage";

export default function VisitsPage() {
  const [visits, setVisits] = useState<any[]>([]);
  const [retailers, setRetailers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ retailer_id: "", visit_date: new Date().toISOString().split("T")[0], purpose: "", notes: "", order_collected: "No", next_visit_date: "" });
  const [search, setSearch] = useState("");
  const { loading: authLoading, hasPermission } = useAuth();
  const { t } = useLanguage();

  const fetchVisits = useCallback(async () => {
    if (!hasPermission("visits.view")) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await apiClient.get("retailer-visits");
      setVisits(res.data?.data || []);
    } catch {}
    setLoading(false);
  }, [hasPermission]);

  useEffect(() => { if (!authLoading && hasPermission("visits.view")) { fetchVisits(); apiClient.get("retailers").then(r => setRetailers(r.data?.data || [])).catch(() => {}); } }, [authLoading, fetchVisits, hasPermission]);

  const handleSubmit = async () => {
    if (!form.retailer_id || !form.visit_date) return;
    try {
      await apiClient.post("retailer-visits", null, { params: form });
      toast.success(t("visits.saved"));
      setShowForm(false);
      setForm({ retailer_id: "", visit_date: new Date().toISOString().split("T")[0], purpose: "", notes: "", order_collected: "No", next_visit_date: "" });
      fetchVisits();
    } catch { toast.error("Failed to record visit"); }
  };

  const canCreate = hasPermission("visits.create");

  const filteredRetailers = retailers.filter((r: any) =>
    (r.name || "").toLowerCase().includes(search.toLowerCase()) ||
    (r.retailer_code || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">{t("visits.title")}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{visits.length} records</p>
        </div>
        {canCreate && (
          <button onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 bg-primary-500 text-white rounded-xl text-sm font-semibold flex items-center gap-2 hover:bg-primary-600 transition-colors">
            <Plus className="w-4 h-4" /> {showForm ? t("common.cancel") : t("visits.new_visit")}
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-6 space-y-4">
          <h3 className="font-bold text-gray-900 dark:text-gray-100">{t("visits.new_visit")}</h3>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("common.search")} className="w-full pl-9 pr-3 py-2 bg-gray-50 dark:bg-slate-800 border-none rounded-lg text-sm outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-3 max-h-40 overflow-y-auto">
            {filteredRetailers.map((r: any) => (
              <button key={r.id} onClick={() => { setForm(f => ({ ...f, retailer_id: r.id })); setSearch(""); }}
                className={cn("text-left px-3 py-2 rounded-lg border text-sm transition-colors", form.retailer_id === String(r.id) ? "border-primary-500 bg-primary-50 dark:bg-primary-500/10" : "border-gray-100 dark:border-slate-800 hover:bg-gray-50")}>
                <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{r.name}</p>
                <p className="text-xs text-gray-500">{r.retailer_code}</p>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">{t("visits.visit_date")}</label>
              <input type="date" value={form.visit_date} onChange={e => setForm(f => ({ ...f, visit_date: e.target.value }))} className="w-full px-3 py-2 bg-gray-50 dark:bg-slate-800 border-none rounded-lg text-sm outline-none" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">{t("visits.next_visit")}</label>
              <input type="date" value={form.next_visit_date} onChange={e => setForm(f => ({ ...f, next_visit_date: e.target.value }))} className="w-full px-3 py-2 bg-gray-50 dark:bg-slate-800 border-none rounded-lg text-sm outline-none" />
            </div>
          </div>
          <input value={form.purpose} onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))} placeholder={t("visits.purpose")} className="w-full px-3 py-2 bg-gray-50 dark:bg-slate-800 border-none rounded-lg text-sm outline-none" />
          <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder={t("visits.notes")} className="w-full px-3 py-2 bg-gray-50 dark:bg-slate-800 border-none rounded-lg text-sm outline-none resize-none" rows={2} />
          <div className="flex items-center gap-2">
            <input type="checkbox" id="order_collected" checked={form.order_collected === "Yes"} onChange={e => setForm(f => ({ ...f, order_collected: e.target.checked ? "Yes" : "No" }))} className="rounded" />
            <label htmlFor="order_collected" className="text-sm text-gray-700 dark:text-gray-300">{t("visits.order_collected")}</label>
          </div>
          <button onClick={handleSubmit} disabled={!form.retailer_id}
            className="w-full py-2.5 bg-primary-500 text-white rounded-xl text-sm font-semibold hover:bg-primary-600 transition-colors disabled:opacity-50">
            {t("visits.save")}
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-16 bg-gray-100 dark:bg-slate-800 rounded-xl animate-pulse" />
        ))}</div>
      ) : visits.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Store className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4" />
          <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">{t("visits.no_data")}</h3>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="divide-y divide-gray-50 dark:divide-slate-800">
            {visits.map((v: any) => (
              <div key={v.id} className="px-6 py-4 flex items-center gap-4 hover:bg-gray-50/50 dark:hover:bg-slate-800/50">
                <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center text-blue-600">
                  <Store className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{v.retailer?.name || `#${v.retailer_id}`}</p>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                    <span className="flex items-center gap-1"><CalendarDays className="w-3 h-3" />{v.visit_date}</span>
                    {v.purpose && <span>{v.purpose}</span>}
                    {v.order_collected === "Yes" && <span className="text-green-600 font-medium">{t("visits.order_collected")}</span>}
                  </div>
                </div>
                {v.notes && <p className="text-xs text-gray-400 max-w-[200px] truncate hidden md:block">{v.notes}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
