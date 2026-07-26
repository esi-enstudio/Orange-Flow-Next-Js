'use client';

import { useState, useEffect } from 'react';
import { X, Loader2, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import apiClient from '@/lib/api';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { ConfirmationModal } from '@/components/ui/ConfirmationModal';

interface ProductOption {
  id: number;
  product_name: string;
  product_code: string;
  category: string;
}

interface HouseOption {
  id: number;
  name: string;
  code: string;
  display_name: string;
}

interface StockRow {
  product_id: string;
  quantity: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  houseId?: string;
  editRecord?: {
    record_id: number;
    product_id: number;
    product_name: string;
    product_code: string;
    quantity: number;
  } | null;
}

export default function HouseStockModal({ open, onClose, onSuccess, editRecord }: Props) {
  const { hasPermission } = useAuth();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [houses, setHouses] = useState<HouseOption[]>([]);
  const [selectedHouseId, setSelectedHouseId] = useState('');
  const [rows, setRows] = useState<StockRow[]>([{ product_id: '', quantity: '' }]);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const isEdit = !!editRecord;

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoading(true);

    if (isEdit && editRecord) {
      setRows([{ product_id: String(editRecord.product_id), quantity: String(editRecord.quantity) }]);
      setSelectedHouseId('');
      setLoading(false);
      return;
    }

    setRows([{ product_id: '', quantity: '' }]);
    setSelectedHouseId('');

    Promise.all([
      apiClient.get('sales/products'),
      apiClient.get('houses/accessible'),
    ])
      .then(([prodRes, houseRes]) => {
        setProducts(prodRes.data || []);
        setHouses(houseRes.data || []);
        if (houseRes.data?.length === 1) {
          setSelectedHouseId(String(houseRes.data[0].id));
        }
      })
      .catch(() => {
        setProducts([]);
        setHouses([]);
      })
      .finally(() => setLoading(false));
  }, [open, isEdit, editRecord]);

  const handleRowChange = (index: number, field: keyof StockRow, value: string) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  const addRow = () => {
    setRows((prev) => [...prev, { product_id: '', quantity: '' }]);
  };

  const removeRow = (index: number) => {
    setRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  };

  const handleSubmit = async () => {
    setError(null);

    if (!isEdit) {
      if (!selectedHouseId) {
        setError('Please select a house');
        return;
      }

      const validRows = rows.filter((r) => r.product_id && r.quantity !== '');
      if (validRows.length === 0) {
        setError('Add at least one product with quantity');
        return;
      }

      for (const row of validRows) {
        if (Number(row.quantity) < 0) {
          setError('Quantity must be 0 or more');
          return;
        }
      }
    } else {
      if (!rows[0].quantity || Number(rows[0].quantity) < 0) {
        setError('Quantity must be 0 or more');
        return;
      }
    }

    setSubmitting(true);
    try {
      const ctxId = isEdit ? houseId : String(selectedHouseId);
      const headers: Record<string, string> = {};
      if (ctxId) headers['X-House-ID'] = ctxId;

      if (isEdit && editRecord) {
        await apiClient.put(`stock/house-stock/${editRecord.record_id}`, { quantity: Number(rows[0].quantity) }, { headers });
        toast.success('Stock updated');
      } else {
        const validRows = rows.filter((r) => r.product_id && r.quantity !== '');
        await apiClient.post('stock/house-stock/bulk', {
          items: validRows.map((r) => ({ product_id: Number(r.product_id), quantity: Number(r.quantity) })),
        }, { headers });
        toast.success('Stock added successfully');
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message || err?.response?.data?.detail || 'Failed to save';
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!editRecord) return;
    setConfirmDeleteOpen(false);
    setSubmitting(true);
    try {
      const headers: Record<string, string> = {};
      if (houseId) headers['X-House-ID'] = houseId;
      await apiClient.delete(`stock/house-stock/${editRecord.record_id}`, { headers });
      toast.success('Stock deleted');
      onSuccess();
      onClose();
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message || err?.response?.data?.detail || 'Failed to delete';
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 w-full max-w-2xl mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold">{isEdit ? 'Edit House Stock' : 'Add House Stock'}</h2>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-slate-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : (
          <div className="p-6 space-y-4">
            {!isEdit && (
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">House</label>
                <select
                  value={selectedHouseId}
                  onChange={(e) => setSelectedHouseId(e.target.value)}
                  className="w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select house</option>
                  {houses.map((h) => (
                    <option key={h.id} value={h.id}>{h.display_name}</option>
                  ))}
                </select>
              </div>
            )}

            {isEdit ? (
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Product</label>
                <p className="px-3 py-2 rounded-md bg-gray-50 dark:bg-slate-800 text-sm">{editRecord?.product_name} ({editRecord?.product_code})</p>
                <div className="mt-4">
                  <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Quantity</label>
                  <input
                    type="number"
                    min={0}
                    value={rows[0]?.quantity || ''}
                    onChange={(e) => handleRowChange(0, 'quantity', e.target.value)}
                    className="w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Enter quantity"
                  />
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Products</label>
                  <Button type="button" variant="outline" size="sm" onClick={addRow} className="shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all">
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Row
                  </Button>
                </div>

                <div className="space-y-2">
                  {rows.map((row, index) => (
                    <div key={index} className="flex items-start gap-2">
                      <div className="flex-1">
                        <select
                          value={row.product_id}
                          onChange={(e) => handleRowChange(index, 'product_id', e.target.value)}
                          className="w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Select product</option>
                          {products.map((prod) => (
                            <option key={prod.id} value={prod.id}>
                              {prod.product_name} ({prod.product_code}) — {prod.category}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="w-28 shrink-0">
                        <input
                          type="number"
                          min={0}
                          value={row.quantity}
                          onChange={(e) => handleRowChange(index, 'quantity', e.target.value)}
                          className="w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Qty"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeRow(index)}
                        disabled={rows.length <= 1}
                        className="p-2 mt-0.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && (
              <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-md">{error}</p>
            )}

            <div className="flex items-center gap-3 pt-2">
              <Button onClick={handleSubmit} disabled={submitting} className="flex-1 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {isEdit ? 'Update Stock' : 'Save Stock'}
              </Button>
              {isEdit && hasPermission('stock.delete') && (
                <Button variant="destructive" onClick={() => setConfirmDeleteOpen(true)} disabled={submitting} className="shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all">
                  Delete
                </Button>
              )}
              <Button variant="outline" onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        <ConfirmationModal
          isOpen={confirmDeleteOpen}
          onClose={() => setConfirmDeleteOpen(false)}
          onConfirm={handleDelete}
          title="Delete Stock"
          message="Are you sure you want to delete this house stock record?"
          type="danger"
          confirmText="Delete"
        />
      </div>
    </div>
  );
}

