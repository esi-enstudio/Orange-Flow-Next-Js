'use client';

import { useState, useEffect } from 'react';
import { X, Loader2, Plus, Trash2 } from 'lucide-react';
import apiClient from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import toast from 'react-hot-toast';

interface ProductOption {
  id: number;
  product_name: string;
  product_code: string;
  category: string;
}

interface EmployeeOption {
  id: number;
  dms_code: string;
  employee_type: string | null;
  itop_number: string | null;
  pool_number: string | null;
  user: { name: string } | null;
}

const groupLabels: Record<string, string> = {
  rso: 'RSO', bp: 'BP', cc: 'CC',
  supervisor: 'Supervisor', manager: 'Manager',
  bsp: 'BSP', rbsp: 'RBSP',
};

interface StockRow {
  productId: string;
  quantity: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editRecord?: {
    record_id: number;
    employee_name: string;
    employee_type: string;
    product_name: string;
    product_code: string;
    quantity: number;
    employee_id: number;
    product_id: number;
  } | null;
  houseId?: string;
}

export default function StockEntryModal({ open, onClose, onSuccess, editRecord, houseId }: Props) {
  const { hasPermission } = useAuth();
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [rows, setRows] = useState<StockRow[]>([{ productId: '', quantity: '' }]);
  const [houseStockMap, setHouseStockMap] = useState<Record<number, number>>({});
  const [error, setError] = useState<string | null>(null);

  const headers: Record<string, string> = {};
  if (houseId) headers['X-House-ID'] = houseId;

  const isEdit = !!editRecord;

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoading(true);

    if (isEdit && editRecord) {
      setEmployeeId(String(editRecord.employee_id));
      setRows([{ productId: String(editRecord.product_id), quantity: String(editRecord.quantity) }]);
      setLoading(false);
      return;
    }

    setEmployeeId('');
    setRows([{ productId: '', quantity: '' }]);

    Promise.all([
      apiClient.get('stock/house-stock', { headers }).then(r => {
        const stockList: any[] = r.data || [];
        const map: Record<number, number> = {};
        stockList.forEach((s: any) => { map[s.product_id] = s.quantity; });
        setHouseStockMap(map);
        setProducts(stockList.map((s: any) => ({
          id: s.product_id,
          product_name: s.product_name,
          product_code: s.product_code,
          category: s.category,
        })));
      }).catch(() => { setHouseStockMap({}); setProducts([]); }),
      apiClient.get('employees', { params: { per_page: 100, status: 'Active' }, headers }).then(r => setEmployees(r.data?.data || [])).catch(() => setEmployees([])),
    ]).finally(() => setLoading(false));
  }, [open, isEdit, editRecord]);

  const updateRow = (index: number, field: keyof StockRow, value: string) => {
    const next = rows.map((r, i) => (i === index ? { ...r, [field]: value } : r));
    setRows(next);
  };

  const addRow = () => {
    setRows([...rows, { productId: '', quantity: '' }]);
  };

  const removeRow = (index: number) => {
    if (rows.length <= 1) return;
    setRows(rows.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    setError(null);

    if (!isEdit && !employeeId) {
      setError('Please select an employee');
      return;
    }

    const validRows = rows.filter(r => r.productId && r.quantity && Number(r.quantity) >= 0);
    if (validRows.length === 0) {
      setError('Add at least one product with a valid quantity');
      return;
    }

    setSubmitting(true);
    try {
      if (isEdit && editRecord) {
        await apiClient.put(`stock/employee-stock/${editRecord.record_id}`, { quantity: Number(rows[0].quantity) }, { headers });
      } else {
        await Promise.all(
          validRows.map(r =>
            apiClient.post('stock/employee-stock', {
              employee_id: Number(employeeId),
              product_id: Number(r.productId),
              quantity: Number(r.quantity),
            }, { headers })
          )
        );
      }
      toast.success(isEdit ? 'Stock updated' : 'Stock added successfully');
      onSuccess();
      onClose();
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message || err?.response?.data?.detail || 'Failed to save stock entry';
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!editRecord) return;
    if (!confirm('Are you sure you want to delete this stock entry?')) return;

    setSubmitting(true);
    try {
      await apiClient.delete(`stock/employee-stock/${editRecord.record_id}`, { headers });
      toast.success('Stock entry deleted');
      onSuccess();
      onClose();
    } catch (err: any) {
      const msg = err?.response?.data?.error?.message || err?.response?.data?.detail || 'Failed to delete stock entry';
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
        className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold">{isEdit ? 'Edit Stock Entry' : 'Add Stock Entry'}</h2>
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
            {isEdit ? (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Employee</label>
                  <p className="px-3 py-2 rounded-md bg-gray-50 dark:bg-slate-800 text-sm">{editRecord?.employee_name} ({editRecord?.employee_type})</p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Product</label>
                  <p className="px-3 py-2 rounded-md bg-gray-50 dark:bg-slate-800 text-sm">{editRecord?.product_name} ({editRecord?.product_code})</p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Quantity</label>
                  <input
                    type="number"
                    min={0}
                    value={rows[0]?.quantity || ''}
                    onChange={(e) => updateRow(0, 'quantity', e.target.value)}
                    className="w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Employee</label>
                  <select
                    value={employeeId}
                    onChange={(e) => setEmployeeId(e.target.value)}
                    className="w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select employee</option>
                    {Object.entries(
                      employees.reduce<Record<string, EmployeeOption[]>>((acc, emp) => {
                        const key = emp.employee_type || 'other';
                        (acc[key] ||= []).push(emp);
                        return acc;
                      }, {})
                    ).map(([type, emps]) => (
                      <optgroup key={type} label={groupLabels[type] || type.toUpperCase()}>
                        {emps.map(emp => {
                          const isRso = emp.employee_type === 'rso';
                          const suffix = isRso
                            ? `(${emp.itop_number?.slice(-3) || 'N/A'})`
                            : `(${emp.pool_number || 'N/A'})`;
                          return (
                            <option key={emp.id} value={emp.id}>
                              {emp.dms_code} · {emp.user?.name || ''} {suffix}
                            </option>
                          );
                        })}
                      </optgroup>
                    ))}
                  </select>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Products</label>
                    <Button type="button" variant="outline" size="sm" onClick={addRow} className="h-8 gap-1">
                      <Plus className="h-3.5 w-3.5" /> Add Row
                    </Button>
                  </div>

                  {rows.map((row, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <div className="flex-1">
                        <select
                          value={row.productId}
                          onChange={(e) => updateRow(i, 'productId', e.target.value)}
                          className="w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="">Select product</option>
                          {products.map((prod) => (
                            <option key={prod.id} value={prod.id}>
                              {prod.product_name} ({prod.product_code}) — {prod.category}
                            </option>
                          ))}
                        </select>
                        {Number(row.productId) > 0 && (
                          <p className="text-[11px] text-gray-500 mt-1">Current Stock: {houseStockMap[Number(row.productId)] ?? 0}</p>
                        )}
                      </div>
                      <div className="w-28">
                        <input
                          type="number"
                          min={0}
                          value={row.quantity}
                          onChange={(e) => updateRow(i, 'quantity', e.target.value)}
                          className="w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="Qty"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeRow(i)}
                        disabled={rows.length <= 1}
                        className="p-2 mt-0.5 rounded-md text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </>
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
                <Button variant="destructive" onClick={handleDelete} disabled={submitting} className="shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all">
                  Delete
                </Button>
              )}
              <Button variant="outline" onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
