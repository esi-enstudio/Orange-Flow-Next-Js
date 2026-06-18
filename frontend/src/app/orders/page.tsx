"use client";

import { useEffect, useState, useCallback } from "react";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Package, Plus, Search, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import { useLanguage } from "@/i18n/useLanguage";

export default function OrdersPage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [retailers, setRetailers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ retailer_id: "", order_date: new Date().toISOString().split("T")[0], total_amount: "", notes: "" });
  const { loading: authLoading, hasPermission } = useAuth();
  const { t } = useLanguage();

  const fetchOrders = useCallback(async () => {
    if (!hasPermission("orders.view")) { setLoading(false); return; }
    setLoading(true);
    try { const res = await apiClient.get("orders"); setOrders(res.data?.data || []); } catch {}
    setLoading(false);
  }, [hasPermission]);

  useEffect(() => { if (!authLoading && hasPermission("orders.view")) { fetchOrders(); apiClient.get("retailers").then(r => setRetailers(r.data?.data || [])).catch(() => {}); } }, [authLoading, fetchOrders, hasPermission]);

  const handleSubmit = async () => {
    if (!form.retailer_id || !form.order_date || !form.total_amount) return;
    try {
      await apiClient.post("orders", null, { params: { ...form, total_amount: parseFloat(form.total_amount) } });
      toast.success(t("orders.saved"));
      setShowForm(false);
      setForm({ retailer_id: "", order_date: new Date().toISOString().split("T")[0], total_amount: "", notes: "" });
      fetchOrders();
    } catch { toast.error("Failed to record order"); }
  };

  const canCreate = hasPermission("orders.create");

  const filteredRetailers = retailers.filter((r: any) =>
    (r.name || "").toLowerCase().includes(search.toLowerCase()) ||
    (r.retailer_code || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">{t("orders.title")}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{orders.length} records</p>
        </div>
        {canCreate && (
          <button onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 bg-primary-500 text-white rounded-xl text-sm font-semibold flex items-center gap-2 hover:bg-primary-600 transition-colors">
            <Plus className="w-4 h-4" /> {showForm ? t("common.cancel") : t("orders.new_order")}
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-6 space-y-4">
          <h3 className="font-bold text-gray-900 dark:text-gray-100">{t("orders.new_order")}</h3>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("common.search")} className="w-full pl-9 pr-3 py-2 bg-gray-50 dark:bg-slate-800 border-none rounded-lg text-sm outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-3 max-h-40 overflow-y-auto">
            {filteredRetailers.map((r: any) => (
              <button key={r.id} onClick={() => { setForm(f => ({ ...f, retailer_id: r.id })); setSearch(""); }}
                className={cn("text-left px-3 py-2 rounded-lg border text-sm transition-colors", form.retailer_id === String(r.id) ? "border-primary-500 bg-primary-50" : "border-gray-100 dark:border-slate-800 hover:bg-gray-50")}>
                <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{r.name}</p>
                <p className="text-xs text-gray-500">{r.retailer_code}</p>
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">{t("orders.order_date")}</label>
              <input type="date" value={form.order_date} onChange={e => setForm(f => ({ ...f, order_date: e.target.value }))} className="w-full px-3 py-2 bg-gray-50 dark:bg-slate-800 border-none rounded-lg text-sm outline-none" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">{t("orders.total_amount")}</label>
              <input type="number" step="0.01" value={form.total_amount} onChange={e => setForm(f => ({ ...f, total_amount: e.target.value }))} placeholder="0.00" className="w-full px-3 py-2 bg-gray-50 dark:bg-slate-800 border-none rounded-lg text-sm outline-none" />
            </div>
          </div>
          <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder={t("orders.notes")} className="w-full px-3 py-2 bg-gray-50 dark:bg-slate-800 border-none rounded-lg text-sm outline-none resize-none" rows={2} />
          <button onClick={handleSubmit} disabled={!form.retailer_id || !form.total_amount}
            className="w-full py-2.5 bg-primary-500 text-white rounded-xl text-sm font-semibold hover:bg-primary-600 transition-colors disabled:opacity-50">
            {t("orders.save")}
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 bg-gray-100 dark:bg-slate-800 rounded-xl animate-pulse" />
        ))}</div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Package className="w-16 h-16 text-gray-300 dark:text-gray-600 mb-4" />
          <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">{t("orders.no_data")}</h3>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="divide-y divide-gray-50 dark:divide-slate-800">
            {orders.map((o: any) => (
              <div key={o.id} className="px-6 py-4 flex items-center gap-4 hover:bg-gray-50/50 dark:hover:bg-slate-800/50">
                <div className="w-9 h-9 rounded-full bg-green-100 dark:bg-green-500/20 flex items-center justify-center text-green-600">
                  <Package className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{o.retailer?.name || `#${o.retailer_id}`}</p>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                    <CalendarDays className="w-3 h-3" />{o.order_date}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-gray-900 dark:text-gray-100">৳{o.total_amount?.toLocaleString()}</p>
                  <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full", o.status === "completed" ? "bg-green-50 text-green-600" : "bg-amber-50 text-amber-600")}>
                    {o.status === "completed" ? t("orders.status_completed") : t("orders.status_pending")}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
