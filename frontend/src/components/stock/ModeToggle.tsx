'use client';

import { Warehouse, Users } from 'lucide-react';
import type { StockMode } from '@/types/stock';

interface Props {
  mode: StockMode;
  onChange: (mode: StockMode) => void;
}

export default function ModeToggle({ mode, onChange }: Props) {
  return (
    <div className="inline-flex items-center rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1">
      <button
        onClick={() => onChange('house')}
        className={`inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
          mode === 'house'
            ? 'bg-primary text-white shadow-sm'
            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
        }`}
      >
        <Warehouse className="h-4 w-4" />
        House Stock
      </button>
      <button
        onClick={() => onChange('employee')}
        className={`inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
          mode === 'employee'
            ? 'bg-primary text-white shadow-sm'
            : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
        }`}
      >
        <Users className="h-4 w-4" />
        Employee Stock
      </button>
    </div>
  );
}
