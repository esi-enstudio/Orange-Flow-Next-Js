'use client';

import { useState, useEffect } from 'react';
import { X, Loader2, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import apiClient from '@/lib/api';
import type { ProductOption, SalesBatchEntry } from '@/types/sales';

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  date: string;
}

const emptyEntry = (): SalesBatchEntry => ({
  product_id: 0,
  sold_quantity: 0,
  unit_price: 0,
});

export default function SalesEditModal({ open, onClose, onSuccess, date }: Props) {
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [entries, setEntries] = useState<SalesBatchEntry[]>([emptyEntry()]);
  const [submitting, setSubmitting] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(true);

  useEffect(() => {
    if (!open) return;
    setLoadingProducts(true);
    apiClient.get('sales/products')
      .then((res) => setProducts(res.data || []))
      .catch(() => toast.error('Failed to load products'))
      .finally(() => setLoadingProducts(false));
  }, [open]);

  const addEntry = () => setEntries([...entries, emptyEntry()]);
  const removeEntry = (idx: number) => {
    if (entries.length <= 1) return;
    setEntries(entries.filter((_, i) => i !== idx));
  };
  const updateEntry = (idx: number, field: keyof SalesBatchEntry, value: number) => {
    setEntries(entries.map((e, i) => (i === idx ? { ...e, [field]: value } : e)));
  };

  const handleSubmit = async () => {
    for (const e of entries) {
      if (!e.product_id) {
        toast.error('Please select a product for all entries');
        return;
      }
    }
    setSubmitting(true);
    try {
      await apiClient.post('sales/batch', { date, entries });
      toast.success('Sales data saved successfully');
      onSuccess();
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Failed to save data';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-slate-700">
          <div>
            <h2 className="text-lg font-semibold">Edit Sales</h2>
            <p className="text-sm text-gray-500">Date: {date}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-5 w-5" /></Button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loadingProducts ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>
          ) : (
            <div className="space-y-3">
              <div className="hidden md:grid grid-cols-3 gap-2 text-xs font-medium text-gray-500 px-1">
                <div>Product</div>
                <div>Sold Qty</div>
                <div>Unit Price</div>
              </div>
              {entries.map((entry, idx) => (
                <div key={idx} className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end p-3 rounded-lg border border-gray-100 dark:border-slate-800">
                  <div>
                    <label className="md:hidden text-xs text-gray-500 mb-1 block">Product</label>
                    <select
                      className="w-full h-9 rounded-md border border-gray-300 dark:border-slate-600 bg-transparent px-2 text-sm"
                      value={entry.product_id || ''}
                      onChange={(e) => updateEntry(idx, 'product_id', Number(e.target.value))}
                    >
                      <option value="">Select product</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>{p.product_name} ({p.product_code})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="md:hidden text-xs text-gray-500 mb-1 block">Sold Qty</label>
                    <input type="number" min={0} className="w-full h-9 rounded-md border border-gray-300 dark:border-slate-600 bg-transparent px-2 text-sm" value={entry.sold_quantity} onChange={(e) => updateEntry(idx, 'sold_quantity', Math.max(0, Number(e.target.value)))} />
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="md:hidden text-xs text-gray-500 mb-1 block">Unit Price</label>
                      <input type="number" min={0} step="0.01" className="w-full h-9 rounded-md border border-gray-300 dark:border-slate-600 bg-transparent px-2 text-sm" value={entry.unit_price} onChange={(e) => updateEntry(idx, 'unit_price', Math.max(0, Number(e.target.value)))} />
                    </div>
                    {entries.length > 1 && (
                      <button className="flex items-center justify-center h-9 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-md shrink-0" onClick={() => removeEntry(idx)}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addEntry} className="w-full"><Plus className="h-4 w-4 mr-1" /> Add Product Row</Button>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-slate-700">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting || loadingProducts}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Save All ({entries.length} entries)
          </Button>
        </div>
      </div>
    </div>
  );
}
