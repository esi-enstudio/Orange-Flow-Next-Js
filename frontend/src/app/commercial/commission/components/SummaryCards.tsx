"use client";

import {
  TrendingUp,
  Users,
  Receipt,
} from "lucide-react";
import type { CommissionSummary } from "@/types/commission";

interface Props {
  summary: CommissionSummary;
}

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat("en-BD", {
    style: "currency",
    currency: "BDT",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

const formatNumber = (value: number) => {
  return new Intl.NumberFormat("en-BD").format(value);
};

export default function SummaryCards({ summary }: Props) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 p-4 shadow-sm hover:shadow-md transition-shadow">
        <div className="inline-flex p-2 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 mb-3">
          <TrendingUp className="w-4 h-4 text-indigo-600" />
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
          Campaign Total
        </p>
        <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">
          {formatCurrency(summary.total_campaign_amount)}
        </p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 p-4 shadow-sm hover:shadow-md transition-shadow">
        <div className="inline-flex p-2 rounded-lg bg-cyan-50 dark:bg-cyan-900/20 mb-3">
          <Receipt className="w-4 h-4 text-cyan-600" />
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Transactions</p>
        <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
          {formatNumber(summary.transaction_count)}
        </p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 p-4 shadow-sm hover:shadow-md transition-shadow">
        <div className="inline-flex p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 mb-3">
          <Users className="w-4 h-4 text-amber-600" />
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">Houses</p>
        <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
          {formatNumber(summary.house_count)}
        </p>
      </div>
    </div>
  );
}
