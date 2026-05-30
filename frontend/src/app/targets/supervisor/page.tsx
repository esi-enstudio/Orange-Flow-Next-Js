"use client";
import { useState, useEffect, useCallback } from "react";
import { useLanguage } from "@/i18n/useLanguage";
import { Search, ChevronLeft, ChevronRight, Loader2, Crosshair } from "lucide-react";
import { toast } from "react-hot-toast";
import axios from "@/lib/api";

interface Record {
  id: number; ev_secondary: number; sc_secondary: number; total_recharge: number;
  total_ga: number; bp_ga: number; rso_ga: number; sso: number; lso: number; bso: number; ddso: number;
  target_date: string; employee_id: number;
  house?: { id: number; name: string; code: string };
}

export default function SupervisorTargetsPage() {
  const { t } = useLanguage();
  const [data, setData] = useState<Record[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const limit = 50;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get("/supervisor-targets", { params: { skip: page * limit, limit } });
      setData(res.data || []);
    } catch { toast.error("Failed to load"); }
    finally { setLoading(false); }
  }, [page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-rose-100 dark:bg-rose-500/20 rounded-xl">
          <Crosshair className="w-5 h-5 text-rose-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t('nav.supervisor_targets')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Monthly supervisor target records</p>
        </div>
      </div>
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-slate-800">
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">Emp ID</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">House</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">EV Sec</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">SC Sec</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">Recharge</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">GA</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">SSO</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-400 text-xs uppercase">Date</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-12 text-gray-400"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-gray-400">No targets found</td></tr>
              ) : data.map((r) => (
                <tr key={r.id} className="border-b border-gray-50 dark:border-slate-800/50 hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="px-4 py-3 text-gray-900 dark:text-gray-100">{r.employee_id}</td>
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{r.house?.code || "-"}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.ev_secondary}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.sc_secondary}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.total_recharge}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.total_ga}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.sso}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{r.target_date ? new Date(r.target_date).toLocaleDateString() : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <span className="text-xs text-gray-400">{data.length} records</span>
            <div className="flex items-center gap-3">
              <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-50">
                <ChevronLeft className="w-3.5 h-3.5" /> Prev
              </button>
              <span className="text-sm font-medium text-gray-900">{page + 1}</span>
              <button onClick={() => setPage(p => p + 1)} disabled={data.length < limit}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-50">
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
