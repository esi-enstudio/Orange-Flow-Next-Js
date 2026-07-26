'use client';

import { PackageCheck, DollarSign, ShoppingCart } from 'lucide-react';
import type { SalesSummary } from '@/types/sales';

interface Props {
  summary: SalesSummary | null;
  loading: boolean;
}

export default function SalesSummaryCards({ summary, loading }: Props) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-gray-200 dark:border-slate-700 p-4 animate-pulse">
            <div className="h-3 w-20 bg-gray-200 dark:bg-slate-700 rounded mb-3" />
            <div className="h-6 w-16 bg-gray-200 dark:bg-slate-700 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (!summary) return null;

  const cards = [
    { label: 'Total Sold', value: summary.total_sold.toLocaleString(), icon: ShoppingCart, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/30' },
    { label: 'Sales Amount', value: `৳${summary.total_sales_amount.toLocaleString()}`, icon: DollarSign, color: 'text-green-500', bg: 'bg-green-50 dark:bg-green-950/30' },
    { label: 'Entries', value: summary.entry_count.toLocaleString(), icon: PackageCheck, color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-950/30' },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div key={card.label} className={`rounded-xl border border-gray-200 dark:border-slate-700 p-4 ${card.bg}`}>
            <div className="flex items-center gap-2 mb-2">
              <Icon className={`h-4 w-4 ${card.color}`} />
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{card.label}</span>
            </div>
            <p className={`text-xl font-bold ${card.color}`}>{card.value}</p>
          </div>
        );
      })}
    </div>
  );
}
