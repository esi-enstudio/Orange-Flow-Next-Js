'use client';

import { useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import apiClient from '@/lib/api';
import type { DailyStockEntry } from '@/types/stock';

interface DailyStockViewProps {
  houseId: string;
  mode: 'house' | 'employee';
  onModeChange?: (mode: 'house' | 'employee') => void;
}

export default function DailyStockView({ houseId, mode, onModeChange }: DailyStockViewProps) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [entries, setEntries] = useState<DailyStockEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [search, setSearch] = useState('');

  const fetchDaily = async () => {
    if (!date) return;
    setLoading(true);
    setSearched(true);
    try {
      const headers: Record<string, string> = {};
      if (houseId) headers['X-House-ID'] = houseId;
      const res = await apiClient.get('stock/daily', {
        params: { date, mode },
        headers,
      });
      const all = res.data?.entries || [];
      setEntries(all.filter((e: DailyStockEntry) => e.opening_qty || e.quantity_in || e.quantity_out || e.closing_qty));
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  const handleModeChange = (newMode: 'house' | 'employee') => {
    onModeChange?.(newMode);
    setEntries([]);
    setSearched(false);
  };

  const filtered = search.trim()
    ? entries.filter(
        (e) =>
          e.product_name.toLowerCase().includes(search.toLowerCase()) ||
          e.product_code.toLowerCase().includes(search.toLowerCase()),
      )
    : entries;

  const totalOpening = filtered.reduce((s, e) => s + e.opening_qty, 0);
  const totalIn = filtered.reduce((s, e) => s + e.quantity_in, 0);
  const totalOut = filtered.reduce((s, e) => s + e.quantity_out, 0);
  const totalClosing = filtered.reduce((s, e) => s + e.closing_qty, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="flex items-center rounded-lg border border-gray-300 dark:border-slate-600 overflow-hidden">
          <button
            onClick={() => handleModeChange('house')}
            className={`px-3 py-2 text-sm font-medium transition-colors ${
              mode === 'house'
                ? 'bg-primary text-primary-foreground'
                : 'bg-white dark:bg-slate-900 text-gray-600 dark:text-gray-300'
            }`}
          >
            House
          </button>
          <button
            onClick={() => handleModeChange('employee')}
            className={`px-3 py-2 text-sm font-medium transition-colors ${
              mode === 'employee'
                ? 'bg-primary text-primary-foreground'
                : 'bg-white dark:bg-slate-900 text-gray-600 dark:text-gray-300'
            }`}
          >
            Employee
          </button>
        </div>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
        />
        <button
          onClick={fetchDaily}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          Load
        </button>
        <div className="relative flex-1 max-w-xs">
          <input
            type="text"
            placeholder="Search product..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 pl-8 pr-3 py-2 text-sm"
          />
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      )}

      {!loading && searched && filtered.length === 0 && (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          No stock data for the selected date
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-slate-800 border-b border-gray-200 dark:border-slate-700">
                  <th className="text-left px-2 py-3 font-medium text-gray-600 dark:text-gray-300">Product</th>
                  <th className="text-left px-2 py-3 font-medium text-gray-600 dark:text-gray-300">Code</th>
                  <th className="text-right px-2 py-3 font-medium text-gray-600 dark:text-gray-300">Opening</th>
                  <th className="text-right px-2 py-3 font-medium text-green-600">In</th>
                  <th className="text-right px-2 py-3 font-medium text-red-600">Out</th>
                  <th className="text-right px-2 py-3 font-medium text-gray-600 dark:text-gray-300">Closing</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {filtered.map((e) => (
                  <tr key={e.product_id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                    <td className="px-2 py-1">
                      <p className="font-medium">{e.product_name}</p>
                      {e.category && <p className="text-[11px] text-gray-500 dark:text-gray-400">{e.category}{e.subcategory ? ` / ${e.subcategory}` : ''}</p>}
                    </td>
                    <td className="px-2 py-1 text-gray-500">{e.product_code}</td>
                    <td className="px-2 py-1 text-right">{e.opening_qty}</td>
                    <td className="px-2 py-1 text-right text-green-600 font-medium">+{e.quantity_in}</td>
                    <td className="px-2 py-1 text-right text-red-600 font-medium">-{e.quantity_out}</td>
                    <td className="px-2 py-1 text-right font-semibold">{e.closing_qty}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 dark:bg-slate-800 font-semibold border-t-2 border-gray-300 dark:border-slate-600">
                  <td colSpan={2} className="px-2 py-3">Total</td>
                  <td className="px-2 py-3 text-right">{totalOpening}</td>
                  <td className="px-2 py-3 text-right text-green-600">+{totalIn}</td>
                  <td className="px-2 py-3 text-right text-red-600">-{totalOut}</td>
                  <td className="px-2 py-3 text-right">{totalClosing}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="text-xs text-gray-400 text-right">{filtered.length} products</div>
        </>
      )}
    </div>
  );
}
