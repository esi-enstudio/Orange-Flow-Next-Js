'use client';

import { X, Users, Warehouse } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  onSelectHouse: () => void;
  onSelectEmployee: () => void;
}

export default function AddStockModal({ open, onClose, onSelectHouse, onSelectEmployee }: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 w-full max-w-sm mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">Add Stock</h2>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-slate-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Select where you want to add stock</p>

        <div className="space-y-3">
          <button
            onClick={onSelectHouse}
            className="w-full flex items-center gap-4 px-4 py-4 rounded-xl border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 transition-all text-left"
          >
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Warehouse className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-medium">House Stock</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Add stock to house inventory</p>
            </div>
          </button>

          <button
            onClick={onSelectEmployee}
            className="w-full flex items-center gap-4 px-4 py-4 rounded-xl border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 transition-all text-left"
          >
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
              <Users className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="font-medium">Employee Stock</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Add stock to employee</p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}