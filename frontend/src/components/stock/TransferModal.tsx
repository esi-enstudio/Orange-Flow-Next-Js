'use client';

import { useState, useEffect } from 'react';
import { X, Loader2 } from 'lucide-react';
import apiClient from '@/lib/api';
import { Button } from '@/components/ui/button';

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
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  houseId?: string;
}

type TransferType = 'emp_to_emp' | 'emp_to_house' | 'house_to_emp';

export default function TransferModal({ open, onClose, onSuccess, houseId }: Props) {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [transferType, setTransferType] = useState<TransferType>('emp_to_emp');
  const [fromEmployeeId, setFromEmployeeId] = useState('');
  const [toEmployeeId, setToEmployeeId] = useState('');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const headers: Record<string, string> = {};
  if (houseId) headers['X-House-ID'] = houseId;

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoading(true);
    setFromEmployeeId('');
    setToEmployeeId('');
    setProductId('');
    setQuantity('');
    setNote('');
    setTransferType('emp_to_emp');

    Promise.all([
      apiClient.get('sales/products', { headers }).then(r => setProducts(r.data || [])).catch(() => setProducts([])),
      apiClient.get('employees', { params: { per_page: 200 }, headers }).then(r => setEmployees(r.data?.data || [])).catch(() => setEmployees([])),
    ]).finally(() => setLoading(false));
  }, [open, houseId]);

  const handleSubmit = async () => {
    setError(null);
    if (!productId) { setError('Select a product'); return; }
    if (!quantity || Number(quantity) <= 0) { setError('Quantity must be greater than 0'); return; }

    let from_type: string;
    let from_id: number;
    let to_type: string;
    let to_id: number;

    if (transferType === 'emp_to_emp') {
      if (!fromEmployeeId) { setError('Select source employee'); return; }
      if (!toEmployeeId) { setError('Select destination employee'); return; }
      if (fromEmployeeId === toEmployeeId) { setError('Source and destination cannot be the same'); return; }
      from_type = 'employee'; from_id = Number(fromEmployeeId);
      to_type = 'employee'; to_id = Number(toEmployeeId);
    } else if (transferType === 'emp_to_house') {
      if (!fromEmployeeId) { setError('Select source employee'); return; }
      from_type = 'employee'; from_id = Number(fromEmployeeId);
      to_type = 'house'; to_id = houseId ? Number(houseId) : 0;
    } else {
      if (!toEmployeeId) { setError('Select destination employee'); return; }
      from_type = 'house'; from_id = houseId ? Number(houseId) : 0;
      to_type = 'employee'; to_id = Number(toEmployeeId);
    }

    setSubmitting(true);
    try {
      await apiClient.post('stock/transfer', {
        from_type, from_id, to_type, to_id,
        product_id: Number(productId),
        quantity: Number(quantity),
        note: note || null,
      }, { headers });
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || err?.response?.data?.detail || 'Transfer failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold">Transfer Stock</h2>
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
            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Transfer Type</label>
              <select
                value={transferType}
                onChange={(e) => setTransferType(e.target.value as TransferType)}
                className="w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="emp_to_emp">Employee → Employee</option>
                <option value="emp_to_house">Employee → House</option>
                <option value="house_to_emp">House → Employee</option>
              </select>
            </div>

            {(transferType === 'emp_to_emp' || transferType === 'emp_to_house') && (
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">From Employee</label>
                <select
                  value={fromEmployeeId}
                  onChange={(e) => setFromEmployeeId(e.target.value)}
                  className="w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select employee</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>{emp.dms_code} ({emp.employee_type || 'N/A'})</option>
                  ))}
                </select>
              </div>
            )}

            {(transferType === 'emp_to_emp' || transferType === 'house_to_emp') && (
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">To Employee</label>
                <select
                  value={toEmployeeId}
                  onChange={(e) => setToEmployeeId(e.target.value)}
                  className="w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select employee</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>{emp.dms_code} ({emp.employee_type || 'N/A'})</option>
                  ))}
                </select>
              </div>
            )}

            {(transferType === 'emp_to_house') && (
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">To House</label>
                <p className="px-3 py-2 rounded-md bg-gray-50 dark:bg-slate-800 text-sm text-gray-600 dark:text-gray-400">
                  Current selected house {houseId ? `(ID: ${houseId})` : '(none selected)'}
                </p>
              </div>
            )}

            {(transferType === 'house_to_emp') && (
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">From House</label>
                <p className="px-3 py-2 rounded-md bg-gray-50 dark:bg-slate-800 text-sm text-gray-600 dark:text-gray-400">
                  Current selected house {houseId ? `(ID: ${houseId})` : '(none selected)'}
                </p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Product</label>
              <select
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
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

            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Quantity</label>
              <input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter quantity"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Note (optional)</label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Add a note"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-md">{error}</p>
            )}

            <div className="flex items-center gap-3 pt-2">
              <Button onClick={handleSubmit} disabled={submitting} className="flex-1 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Transfer Stock
              </Button>
              <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
