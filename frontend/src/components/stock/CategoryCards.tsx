'use client';

import CategoryCard from './CategoryCard';
import type { CategoryStockSummary } from '@/types/stock';

interface Props {
  categories: CategoryStockSummary[];
  loading: boolean;
  onViewDetails: (category: string) => void;
}

export default function CategoryCards({ categories, loading, onViewDetails }: Props) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-gray-200 dark:border-slate-700 p-4 animate-pulse">
            <div className="h-4 w-16 bg-gray-200 dark:bg-slate-700 rounded mb-3" />
            <div className="h-8 w-24 bg-gray-200 dark:bg-slate-700 rounded mb-2" />
            <div className="h-4 w-20 bg-gray-100 dark:bg-slate-800 rounded mb-3" />
            <div className="h-8 w-full bg-gray-100 dark:bg-slate-800 rounded" />
          </div>
        ))}
      </div>
    );
  }

  if (categories.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500 dark:text-gray-400">
        <p className="text-lg font-medium">No stock data found</p>
        <p className="text-sm mt-1">No products with stock available for the selected mode.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {categories.map((cat) => (
        <CategoryCard key={cat.category} summary={cat} onViewDetails={onViewDetails} />
      ))}
    </div>
  );
}
