'use client';

import { useState, useEffect } from 'react';
import { Loader2, Pencil, Trash2, Plus } from 'lucide-react';
import apiClient from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { ConfirmationModal } from '@/components/ui/ConfirmationModal';

interface HouseStockItem {
  id: number;
  product_id: number;
  quantity: number;
  product_name: string | null;
  product_code: string | null;
  category: string | null;
  house_name: string | null;
  house_code: string | null;
}

interface Props {
  onEdit: (record: { record_id: number; product_id: number; product_name: string; product_code: string; quantity: number }) => void;
  onAdd: () => void;
  onRefresh: () => void;
  houseId?: string;
}

export default function HouseStockList({ onEdit, onAdd, onRefresh, houseId }: Props) {
  const { hasPermission } = useAuth();
  const [data, setData] = useState<HouseStockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);

  const headers: Record<string, string> = {};
  if (houseId) headers['X-House-ID'] = houseId;

  const fetchData = () => {
    setLoading(true);
    apiClient.get('stock/house-stock', { headers })
      .then((res) => setData(res.data || []))
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, [houseId]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await apiClient.delete(`stock/house-stock/${deleteTarget.id}`, { headers });
      setDeleteTarget(null);
      onRefresh();
      fetchData();
    } catch {
      setDeleteTarget(null);
    }
  };

  const showHouseCol = data.some(d => d.house_name);

  if (loading) {
    return (
      <div className="divide-y divide-gray-100 dark:divide-slate-800 animate-pulse">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-6 py-4">
            <div className="space-y-2 flex-1">
              <div className="h-3 w-32 bg-gray-200 dark:bg-slate-700 rounded-md" />
              <div className="h-2.5 w-20 bg-gray-100 dark:bg-slate-800 rounded-md" />
            </div>
            <div className="h-3 w-16 bg-gray-200 dark:bg-slate-700 rounded-md" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-slate-700">
              {showHouseCol && (
                <>
                  <th className="px-2 py-1 text-left font-medium text-gray-500 dark:text-gray-400">House</th>
                  <th className="px-2 py-1 text-left font-medium text-gray-500 dark:text-gray-400">Code</th>
                </>
              )}
              <th className="px-2 py-1 text-left font-medium text-gray-500 dark:text-gray-400">Product</th>
              <th className="px-2 py-1 text-left font-medium text-gray-500 dark:text-gray-400">Code</th>
              <th className="px-2 py-1 text-right font-medium text-gray-500 dark:text-gray-400">Category</th>
              <th className="px-2 py-1 text-right font-medium text-gray-500 dark:text-gray-400">Qty</th>
              {(hasPermission('stock.edit') || hasPermission('stock.delete')) && (
                <th className="px-2 py-1 text-right font-medium text-gray-500 dark:text-gray-400">Actions</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
            {data.length === 0 ? (
              <tr>
                <td colSpan={showHouseCol ? 7 : 5} className="px-2 py-8 text-center text-gray-500 dark:text-gray-400">
                  No house stock records found
                </td>
              </tr>
            ) : (
              data.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors">
                  {showHouseCol && (
                    <>
                      <td className="px-2 py-1">
                        <p className="font-medium">{item.house_name || 'Unknown'}</p>
                      </td>
                      <td className="px-2 py-1 text-gray-500">{item.house_code}</td>
                    </>
                  )}
                  <td className="px-2 py-1">
                    <p className="font-medium">{item.product_name || 'Unknown'}</p>
                  </td>
                  <td className="px-2 py-1 text-gray-500">{item.product_code}</td>
                  <td className="px-2 py-1 text-right">
                    <span className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{item.category}</span>
                  </td>
                  <td className="px-2 py-1 text-right font-semibold">{item.quantity}</td>
                  {(hasPermission('stock.edit') || hasPermission('stock.delete')) && (
                    <td className="px-2 py-1 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {hasPermission('stock.edit') && (
                          <button
                            onClick={() => onEdit({ record_id: item.id, product_id: item.product_id, product_name: item.product_name || '', product_code: item.product_code || '', quantity: item.quantity })}
                            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-500 hover:text-blue-600"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {hasPermission('stock.delete') && (
                          <button
                            onClick={() => setDeleteTarget({ id: item.id, name: item.product_name || '' })}
                            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-slate-700 text-gray-500 hover:text-red-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ConfirmationModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Stock"
        message={`Are you sure you want to delete ${deleteTarget?.name || 'this record'} from house stock?`}
        type="danger"
        confirmText="Delete"
      />
    </div>
  );
}