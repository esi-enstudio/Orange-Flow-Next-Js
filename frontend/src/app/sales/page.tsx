'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Edit3, ChevronLeft, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { ConfirmationModal } from '@/components/ui/ConfirmationModal';
import apiClient from '@/lib/api';
import SalesSummaryCards from '@/components/sales/SalesSummaryCards';
import SalesTable from '@/components/sales/SalesTable';
import SalesEditModal from '@/components/sales/SalesEditModal';
import type { SalesRecord, SalesSummary } from '@/types/sales';

export default function SalesPage() {
  const { hasPermission, loading: authLoading, selectedHouse } = useAuth();
  const today = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState(today);
  const [records, setRecords] = useState<SalesRecord[]>([]);
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [batchOpen, setBatchOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);

  const headers: Record<string, string> = {};
  if (selectedHouse?.id) headers['X-House-ID'] = String(selectedHouse.id);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = { date: selectedDate };
      const [recordsRes, summaryRes] = await Promise.all([
        apiClient.get('sales', { params, headers }),
        apiClient.get('sales/summary', { params, headers }),
      ]);
      setRecords(recordsRes.data?.data || []);
      setSummary(summaryRes.data || null);
    } catch {
      setRecords([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [selectedDate, selectedHouse?.id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const changeDate = (delta: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + delta);
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await apiClient.delete(`sales/${deleteTarget}`, { headers });
      toast.success('Record deleted');
      setDeleteTarget(null);
      fetchData();
    } catch {
      toast.error('Failed to delete record');
    }
  };

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-8 w-8 animate-spin text-gray-400" /></div>;
  }

  if (!hasPermission('sales.view')) {
    return <AccessDenied />;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Daily Sales</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Track product sales and revenue</p>
        </div>
      </div>

      <div className="flex items-center justify-between bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 px-4 py-3">
        <Button variant="ghost" size="icon" onClick={() => changeDate(-1)}><ChevronLeft className="h-5 w-5" /></Button>
        <div className="flex items-center gap-3">
          <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="rounded-md border border-gray-300 dark:border-slate-600 bg-transparent px-3 py-1.5 text-sm" />
          {selectedDate !== today && <Button variant="outline" size="sm" onClick={() => setSelectedDate(today)}>Today</Button>}
        </div>
        <Button variant="ghost" size="icon" onClick={() => changeDate(1)}><ChevronRight className="h-5 w-5" /></Button>
      </div>

      <SalesSummaryCards summary={summary} loading={loading} />

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold">Product-wise Sales</h2>
          {hasPermission('sales.create') && (
            <Button onClick={() => setBatchOpen(true)}><Edit3 className="h-4 w-4 mr-1" /> Edit Sales</Button>
          )}
        </div>
        <div className="p-6">
          <SalesTable
            records={records}
            loading={loading}
            canEdit={hasPermission('sales.edit')}
            canDelete={hasPermission('sales.delete')}
            onEdit={() => setBatchOpen(true)}
            onDelete={(id) => setDeleteTarget(id)}
          />
        </div>
      </div>

      <SalesEditModal open={batchOpen} onClose={() => setBatchOpen(false)} onSuccess={fetchData} date={selectedDate} />
      <ConfirmationModal open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} onConfirm={handleDelete} title="Delete Record" message="Are you sure you want to delete this sales record?" />
    </div>
  );
}
