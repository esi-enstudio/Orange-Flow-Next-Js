'use client';

import { useState } from 'react';
import { Pencil, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SalesRecord } from '@/types/sales';

interface Props {
  records: SalesRecord[];
  loading: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: (record: SalesRecord) => void;
  onDelete: (id: number) => void;
}

export default function SalesTable({ records, loading, canEdit, canDelete, onEdit, onDelete }: Props) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (loading) {
    return (
      <div className="divide-y divide-gray-100 dark:divide-slate-800 animate-pulse">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-6 py-4">
            <div className="space-y-2 flex-1">
              <div className="h-3 w-32 bg-gray-200 dark:bg-slate-700 rounded-md" />
              <div className="h-2.5 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500 dark:text-gray-400">
        <p className="text-lg font-medium">No sales data found</p>
        <p className="text-sm mt-1">Add sales entries for this date to get started.</p>
      </div>
    );
  }

  const toggleExpand = (id: number) => setExpandedId(expandedId === id ? null : id);

  return (
    <>
      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-slate-700">
              <th className="px-2 py-1 text-left font-medium text-gray-500 dark:text-gray-400">Product</th>
              <th className="px-2 py-1 text-right font-medium text-gray-500 dark:text-gray-400">Sold</th>
              <th className="px-2 py-1 text-right font-medium text-gray-500 dark:text-gray-400">Unit Price</th>
              <th className="px-2 py-1 text-right font-medium text-gray-500 dark:text-gray-400">Total Amount</th>
              {(canEdit || canDelete) && <th className="px-2 py-1 text-right font-medium text-gray-500 dark:text-gray-400">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
            {records.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                <td className="px-2 py-1">
                  <p className="font-medium">{r.product?.product_name || `Product #${r.product_id}`}</p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{r.product?.product_code} · {r.product?.category}</p>
                </td>
                <td className="px-2 py-1 text-right">{r.sold_quantity}</td>
                <td className="px-2 py-1 text-right">৳{r.unit_price.toLocaleString()}</td>
                <td className="px-2 py-1 text-right font-semibold text-green-600 dark:text-green-400">৳{r.total_sales_amount.toLocaleString()}</td>
                {(canEdit || canDelete) && (
                  <td className="px-2 py-1 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {canEdit && (
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEdit(r)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {canDelete && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => onDelete(r.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="lg:hidden space-y-2">
        {records.map((r) => (
          <div key={r.id} className="rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-slate-800/50"
              onClick={() => toggleExpand(r.id)}
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{r.product?.product_name || `Product #${r.product_id}`}</p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{r.product?.product_code}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-sm font-semibold">৳{r.total_sales_amount.toLocaleString()}</span>
                {expandedId === r.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </button>
            {expandedId === r.id && (
              <div className="px-4 pb-3 space-y-1.5 text-sm border-t border-gray-100 dark:border-slate-700 pt-2">
                <div className="flex justify-between"><span className="text-gray-500">Sold:</span><span>{r.sold_quantity}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Unit Price:</span><span>৳{r.unit_price.toLocaleString()}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Total Amount:</span><span className="font-semibold text-green-600">৳{r.total_sales_amount.toLocaleString()}</span></div>
                {(canEdit || canDelete) && (
                  <div className="flex gap-2 pt-2">
                    {canEdit && <Button variant="outline" size="sm" className="flex-1" onClick={() => onEdit(r)}><Pencil className="h-3.5 w-3.5 mr-1" /> Edit</Button>}
                    {canDelete && <Button variant="outline" size="sm" className="flex-1 text-red-500" onClick={() => onDelete(r.id)}><Trash2 className="h-3.5 w-3.5 mr-1" /> Delete</Button>}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
