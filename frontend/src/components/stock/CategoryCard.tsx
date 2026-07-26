'use client';

import { Smartphone, CreditCard, Monitor, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CategoryStockSummary } from '@/types/stock';

const categoryConfig: Record<string, { icon: typeof Smartphone; color: string; bg: string }> = {
  SIM: { icon: Smartphone, color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/30' },
  'Scratch Card': { icon: CreditCard, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/30' },
  Device: { icon: Monitor, color: 'text-purple-600', bg: 'bg-purple-50 dark:bg-purple-950/30' },
  Other: { icon: Package, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/30' },
};

interface Props {
  summary: CategoryStockSummary;
  onViewDetails: (category: string) => void;
}

export default function CategoryCard({ summary, onViewDetails }: Props) {
  const config = categoryConfig[summary.category] || categoryConfig.Other;
  const Icon = config.icon;

  return (
    <div className={`rounded-xl border border-gray-200 dark:border-slate-700 p-4 ${config.bg} transition-all hover:shadow-md`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <Icon className={`h-6 w-6 ${config.color}`} />
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mt-1">
            {summary.category}
          </h3>
        </div>
        <span className="text-[11px] text-gray-400 dark:text-gray-500 bg-white/60 dark:bg-slate-800/60 px-2 py-0.5 rounded-full">
          {summary.subcategories.length} types
        </span>
      </div>

      <div className="space-y-1 mb-3">
        <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {summary.total_quantity.toLocaleString()}
          <span className="text-xs font-normal text-gray-500 dark:text-gray-400 ml-1">pcs</span>
        </p>
        <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
          ৳ {summary.total_amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-full text-xs"
        onClick={() => onViewDetails(summary.category)}
      >
        View Details
      </Button>
    </div>
  );
}
