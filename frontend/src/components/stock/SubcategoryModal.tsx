'use client';

import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import apiClient from '@/lib/api';
import type { SubcategoryStock } from '@/types/stock';

interface Props {
  open: boolean;
  onClose: () => void;
  category: string | null;
  mode: 'house' | 'employee';
  houseId?: string;
}

export default function SubcategoryModal({ open, onClose, category, mode, houseId }: Props) {
  const [data, setData] = useState<SubcategoryStock[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !category) return;

    const headers: Record<string, string> = {};
    if (houseId) headers['X-House-ID'] = houseId;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    let cancelled = false;

    apiClient
      .get(`stock/subcategories/${encodeURIComponent(category)}`, {
        params: { mode },
        headers,
      })
      .then((res) => { if (!cancelled) setData(res.data || []); })
      .catch(() => { if (!cancelled) setData([]); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [open, category, mode, houseId]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 w-full max-w-lg mx-4 max-h-[80vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold">{category} — Subcategory Details</h2>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-slate-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto max-h-[60vh]">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : data.length === 0 ? (
            <p className="text-center text-gray-500 dark:text-gray-400 py-8">No subcategory data found</p>
          ) : (
            <div className="space-y-3">
              {data.map((item) => (
                <div
                  key={item.subcategory}
                  className="flex items-center justify-between p-3 rounded-lg border border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-800/50"
                >
                  <div>
                    <p className="font-medium text-sm">{item.subcategory}</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">{item.product_count} product(s)</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-sm">{item.quantity.toLocaleString()} pcs</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      ৳ {item.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
