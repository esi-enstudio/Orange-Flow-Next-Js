'use client';

import { useState } from 'react';
import { Loader2, ChevronDown, ChevronUp, Pencil, Trash2 } from 'lucide-react';
import apiClient from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { ConfirmationModal } from '@/components/ui/ConfirmationModal';
import type { EmployeeStockListItem, EmployeeStockDetail } from '@/types/stock';

interface Props {
  employees: EmployeeStockListItem[];
  loading: boolean;
  onEdit: (record: {
    record_id: number;
    employee_id: number;
    product_id: number;
    employee_name: string;
    employee_type: string;
    product_name: string;
    product_code: string;
    quantity: number;
  }) => void;
  onRefresh: () => void;
  houseId?: string;
}

export default function EmployeeStockList({ employees, loading, onEdit, onRefresh, houseId }: Props) {
  const { hasPermission } = useAuth();
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<EmployeeStockDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);

  const headers: Record<string, string> = {};
  if (houseId) headers['X-House-ID'] = houseId;

  const toggleExpand = async (employeeId: number) => {
    if (expandedId === employeeId) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(employeeId);
    setDetailLoading(true);
    try {
      const res = await apiClient.get(`stock/employee/${employeeId}`, { headers });
      setDetail(res.data);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await apiClient.delete(`stock/employee-stock/${deleteTarget.id}`, { headers });
      setDeleteTarget(null);
      onRefresh();
      if (expandedId) toggleExpand(expandedId);
    } catch {
      setDeleteTarget(null);
    }
  };

  if (loading) {
    return (
      <div className="divide-y divide-gray-100 dark:divide-slate-800 animate-pulse">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-6 py-4">
            <div className="space-y-2 flex-1">
              <div className="h-3 w-32 bg-gray-200 dark:bg-slate-700 rounded-md" />
              <div className="h-2.5 w-20 bg-gray-100 dark:bg-slate-800 rounded-md" />
            </div>
            <div className="h-3 w-16 bg-gray-200 dark:bg-slate-700 rounded-md" />
            <div className="h-3 w-16 bg-gray-200 dark:bg-slate-700 rounded-md" />
          </div>
        ))}
      </div>
    );
  }

  if (employees.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500 dark:text-gray-400">
        <p className="text-lg font-medium">No employees with stock</p>
        <p className="text-sm mt-1">No employees currently have any products in stock.</p>
      </div>
    );
  }

  return (
    <>
      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-slate-700">
              <th className="px-2 py-1 text-left font-medium text-gray-500 dark:text-gray-400">Name</th>
              <th className="px-2 py-1 text-left font-medium text-gray-500 dark:text-gray-400">DMS Code</th>
              <th className="px-2 py-1 text-left font-medium text-gray-500 dark:text-gray-400">Type</th>
              <th className="px-2 py-1 text-right font-medium text-gray-500 dark:text-gray-400">Products</th>
              <th className="px-2 py-1 text-right font-medium text-gray-500 dark:text-gray-400">Total Qty</th>
              <th className="px-2 py-1 text-right font-medium text-gray-500 dark:text-gray-400"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
            {employees.map((emp) => (
              <tr key={emp.employee_id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer" onClick={() => toggleExpand(emp.employee_id)}>
                <td className="px-2 py-1">
                  <p className="font-medium">{emp.employee_name}</p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">
                    {[emp.itop_number, emp.pool_number].filter(Boolean).join(' · ')}
                  </p>
                </td>
                <td className="px-2 py-1 text-gray-500">{emp.dms_code}</td>
                <td className="px-2 py-1">
                  <span className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{emp.employee_type}</span>
                </td>
                <td className="px-2 py-1 text-right">{emp.product_count}</td>
                <td className="px-2 py-1 text-right font-semibold">{emp.total_quantity}</td>
                <td className="px-2 py-1 text-right">
                  {expandedId === emp.employee_id ? <ChevronUp className="h-4 w-4 inline" /> : <ChevronDown className="h-4 w-4 inline" />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {expandedId && detailLoading && (
          <div className="flex items-center justify-center py-6 border-t border-gray-100 dark:border-slate-800">
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          </div>
        )}

        {expandedId && detail && !detailLoading && (
          <div className="border-t border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-800/30 p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                {detail.employee_name} — Products ({detail.products.length})
              </h4>
            </div>
            {detail.products.length === 0 ? (
              <p className="text-sm text-gray-500">No products found</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-slate-700">
                    <th className="px-2 py-1 text-left font-medium text-gray-500">Product</th>
                    <th className="px-2 py-1 text-left font-medium text-gray-500">Code</th>
                    <th className="px-2 py-1 text-right font-medium text-gray-500">Qty</th>
                    <th className="px-2 py-1 text-right font-medium text-gray-500">Amount</th>
                    {(hasPermission('stock.edit') || hasPermission('stock.delete')) && (
                      <th className="px-2 py-1 text-right font-medium text-gray-500">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                  {detail.products.map((p) => (
                    <tr key={p.product_id}>
                      <td className="px-2 py-1">
                        <p className="font-medium">{p.product_name}</p>
                        <p className="text-[11px] text-gray-500">{p.category} {p.subcategory ? `· ${p.subcategory}` : ''}</p>
                      </td>
                      <td className="px-2 py-1 text-gray-500">{p.product_code}</td>
                      <td className="px-2 py-1 text-right font-medium">{p.quantity}</td>
                      <td className="px-2 py-1 text-right">
                        ৳ {p.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      {(hasPermission('stock.edit') || hasPermission('stock.delete')) && (
                        <td className="px-2 py-1 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {hasPermission('stock.edit') && (
                              <button
                                onClick={(e) => { e.stopPropagation(); onEdit({ record_id: p.record_id, employee_id: detail.employee_id, product_id: p.product_id, employee_name: detail.employee_name, employee_type: detail.employee_type, product_name: p.product_name, product_code: p.product_code, quantity: p.quantity }); }}
                                className="p-1 rounded hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-500 hover:text-blue-600"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {hasPermission('stock.delete') && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: p.record_id, name: p.product_name }); }}

                          
                                className="p-1 rounded hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-500 hover:text-red-600"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      <div className="lg:hidden space-y-2">
        {employees.map((emp) => (
          <div key={emp.employee_id} className="rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-slate-800/50"
              onClick={() => toggleExpand(emp.employee_id)}
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{emp.employee_name}</p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                  {emp.dms_code} · {emp.employee_type} · {emp.product_count} products
                </p>
              </div>
              {expandedId === emp.employee_id ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
            </button>
            {expandedId === emp.employee_id && detailLoading && (
              <div className="flex items-center justify-center py-4 border-t border-gray-100 dark:border-slate-700">
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
              </div>
            )}
            {expandedId === emp.employee_id && detail && !detailLoading && (
              <div className="px-4 pb-3 space-y-1.5 text-sm border-t border-gray-100 dark:border-slate-700 pt-2">
                {detail.products.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-2">No products</p>
                ) : (
                  detail.products.map((p) => (
                    <div key={p.product_id} className="flex justify-between items-start py-1">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{p.product_name}</p>
                        <p className="text-[11px] text-gray-500">{p.product_code}</p>
                      </div>
                      <div className="text-right shrink-0 ml-2">
                        <p className="text-sm font-medium">{p.quantity} pcs</p>
                        <p className="text-[11px] text-gray-500">৳ {p.amount.toFixed(2)}</p>
                      </div>
                      {(hasPermission('stock.edit') || hasPermission('stock.delete')) && (
                        <div className="flex items-center gap-1 ml-2 shrink-0">
                          {hasPermission('stock.edit') && (
                            <button
                              onClick={() => onEdit({ record_id: p.record_id, employee_id: detail.employee_id, product_id: p.product_id, employee_name: detail.employee_name, employee_type: detail.employee_type, product_name: p.product_name, product_code: p.product_code, quantity: p.quantity })}
                              className="p-1 rounded hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-500 hover:text-blue-600"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {hasPermission('stock.delete') && (
                            <button
                              onClick={() => setDeleteTarget({ id: p.record_id, name: p.product_name })}
                              className="p-1 rounded hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-500 hover:text-red-600"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <ConfirmationModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Stock"
        message={`Are you sure you want to delete ${deleteTarget?.name || 'this record'} from employee stock?`}
        type="danger"
        confirmText="Delete"
      />
    </>
  );
}
