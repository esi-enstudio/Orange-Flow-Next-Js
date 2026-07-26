'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, Plus, ArrowLeftRight, ChevronDown } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { AccessDenied } from '@/components/ui/AccessDenied';
import { Button } from '@/components/ui/button';

import apiClient from '@/lib/api';
import CategoryCards from '@/components/stock/CategoryCards';
import SubcategoryModal from '@/components/stock/SubcategoryModal';
import EmployeeStockList from '@/components/stock/EmployeeStockList';
import StockEntryModal from '@/components/stock/StockEntryModal';
import HouseStockList from '@/components/stock/HouseStockList';
import HouseStockModal from '@/components/stock/HouseStockModal';
import TransferModal from '@/components/stock/TransferModal';
import AddStockModal from '@/components/stock/AddStockModal';
import DailyStockView from '@/components/stock/DailyStockView';
import type { CategoryStockSummary, EmployeeStockListItem, StockDashboardSummary } from '@/types/stock';

interface HouseOption {
  id: number;
  name: string;
  code: string;
  display_name: string;
}

export default function StockPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const [houses, setHouses] = useState<HouseOption[]>([]);
  const [globalHouseId, setGlobalHouseId] = useState('');
  const [categories, setCategories] = useState<CategoryStockSummary[]>([]);
  const [employees, setEmployees] = useState<EmployeeStockListItem[]>([]);
  const [employeeCount, setEmployeeCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'house' | 'employee' | 'daily'>('house');
  const [modalCategory, setModalCategory] = useState<string | null>(null);
  const [editRecord, setEditRecord] = useState<any | null>(null);
  const [entryModalOpen, setEntryModalOpen] = useState(false);
  const [houseEditRecord, setHouseEditRecord] = useState<any | null>(null);
  const [houseModalOpen, setHouseModalOpen] = useState(false);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [houseListKey, setHouseListKey] = useState(0);
  const [empListKey, setEmpListKey] = useState(0);
  const [addStockOpen, setAddStockOpen] = useState(false);
  const [dailyMode, setDailyMode] = useState<'house' | 'employee'>('house');

  const buildHeaders = useCallback(() => {
    const h: Record<string, string> = {};
    if (globalHouseId) h['X-House-ID'] = globalHouseId;
    return h;
  }, [globalHouseId]);

  const fetchData = useCallback(() => {
    setLoading(true);
    apiClient.get('stock/summary', {
      params: { mode: 'house' },
      headers: buildHeaders(),
    }).then((res) => {
      const data: StockDashboardSummary = res.data;
      setCategories(data.categories || []);
      setEmployeeCount(data.employee_count || 0);
    }).catch(() => {
      setCategories([]);
      setEmployeeCount(0);
    }).finally(() => setLoading(false));
  }, [buildHeaders]);

  const fetchEmployees = useCallback(() => {
    apiClient.get('stock/employees', {
      params: { per_page: 50 },
      headers: buildHeaders(),
    }).then((res) => {
      setEmployees(res.data?.data || []);
    }).catch(() => setEmployees([]));
  }, [buildHeaders]);

  useEffect(() => {
    apiClient.get('houses/accessible').then((res) => {
      const h = res.data || [];
      setHouses(h);
      if (h.length === 1) setGlobalHouseId(String(h[0].id));
    }).catch(() => setHouses([]));
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetchEmployees(); }, [fetchEmployees]);

  const handleRefresh = () => {
    fetchData();
    fetchEmployees();
    setHouseListKey(k => k + 1);
    setEmpListKey(k => k + 1);
  };

  const handleEdit = (record: any) => {
    setEditRecord(record);
    setEntryModalOpen(true);
  };

  const handleHouseEdit = (record: any) => {
    setHouseEditRecord(record);
    setHouseModalOpen(true);
  };

  const handleAddStockHouse = () => {
    setAddStockOpen(false);
    setHouseEditRecord(null);
    setHouseModalOpen(true);
  };

  const handleAddStockEmployee = () => {
    setAddStockOpen(false);
    setEditRecord(null);
    setEntryModalOpen(true);
  };

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-8 w-8 animate-spin text-gray-400" /></div>;
  }

  if (!hasPermission('stock.view')) {
    return <AccessDenied />;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Stock</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Monitor house and employee product stock</p>
        </div>
        <div className="flex items-center gap-3">
          {houses.length > 1 && (
            <div className="relative">
              <select
                value={globalHouseId}
                onChange={(e) => setGlobalHouseId(e.target.value)}
                className="appearance-none rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 pl-3 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Houses</option>
                {houses.map((h) => (
                  <option key={h.id} value={h.id}>{h.display_name}</option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
            </div>
          )}
          {hasPermission('stock.create') && (
            <>
              <Button onClick={() => setAddStockOpen(true)} size="sm" className="shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all">
                <Plus className="h-4 w-4 mr-1.5" /> Add Stock
              </Button>
              <Button variant="outline" onClick={() => setTransferModalOpen(true)} size="sm" className="shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all">
                <ArrowLeftRight className="h-4 w-4 mr-1.5" /> Transfer
              </Button>
            </>
          )}
        </div>
      </div>

      <CategoryCards categories={categories} loading={loading} onViewDetails={setModalCategory} />

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700">
        <div className="border-b border-gray-200 dark:border-slate-700">
          <div className="flex">
            <button
              onClick={() => setActiveTab('house')}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-all ${
                activeTab === 'house'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              House Stock
            </button>
            <button
              onClick={() => setActiveTab('employee')}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-all ${
                activeTab === 'employee'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              Employee Stock
            </button>
            <button
              onClick={() => setActiveTab('daily')}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-all ${
                activeTab === 'daily'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              Daily Stock
            </button>
          </div>
        </div>

        {activeTab === 'house' && (
          <div className="p-6">
            <HouseStockList key={houseListKey} onEdit={handleHouseEdit} onAdd={() => setAddStockOpen(true)} onRefresh={handleRefresh} houseId={globalHouseId} />
          </div>
        )}

        {activeTab === 'employee' && (
          <div className="p-6">
            <EmployeeStockList
              key={empListKey}
              employees={employees}
              loading={loading}
              onEdit={handleEdit}
              onRefresh={handleRefresh}
              houseId={globalHouseId}
            />
          </div>
        )}

        {activeTab === 'daily' && (
          <div className="p-6">
            <DailyStockView houseId={globalHouseId} mode={dailyMode} onModeChange={setDailyMode} />
          </div>
        )}
      </div>

      <SubcategoryModal
        open={modalCategory !== null}
        onClose={() => setModalCategory(null)}
        category={modalCategory}
        mode="house"
        houseId={globalHouseId}
      />

      <StockEntryModal
        open={entryModalOpen}
        onClose={() => { setEntryModalOpen(false); setEditRecord(null); }}
        onSuccess={handleRefresh}
        editRecord={editRecord}
        houseId={globalHouseId}
      />

      <HouseStockModal
        open={houseModalOpen}
        onClose={() => { setHouseModalOpen(false); setHouseEditRecord(null); }}
        onSuccess={handleRefresh}
        editRecord={houseEditRecord}
        houseId={globalHouseId}
      />

      <TransferModal
        open={transferModalOpen}
        onClose={() => setTransferModalOpen(false)}
        onSuccess={handleRefresh}
        houseId={globalHouseId}
      />

      <AddStockModal
        open={addStockOpen}
        onClose={() => setAddStockOpen(false)}
        onSelectHouse={handleAddStockHouse}
        onSelectEmployee={handleAddStockEmployee}
      />
    </div>
  );
}