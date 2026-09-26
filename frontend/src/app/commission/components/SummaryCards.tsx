"use client";

import {
  TrendingUp,
  Users,
  Receipt,
  DollarSign,
} from "lucide-react";
import type { CommissionSummary } from "@/types/commission";

interface Props {
  summary: CommissionSummary;
}

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat("en-BD", {
    style: "currency",
    currency: "BDT",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

const formatNumber = (value: number) => {
  return new Intl.NumberFormat("en-BD").format(value);
};

export default function SummaryCards({ summary }: Props) {
  const cards = [
    {
      label: "Total Campaign Amount",
      value: formatCurrency(summary.total_campaign_amount),
      icon: DollarSign,
      gradient: "from-violet-500 to-purple-600",
      bgLight: "bg-violet-50 dark:bg-violet-500/10",
      textColor: "text-violet-600 dark:text-violet-400",
      shadowColor: "shadow-violet-500/20",
    },
    {
      label: "Total Transactions",
      value: formatNumber(summary.transaction_count),
      icon: Receipt,
      gradient: "from-cyan-500 to-blue-600",
      bgLight: "bg-cyan-50 dark:bg-cyan-500/10",
      textColor: "text-cyan-600 dark:text-cyan-400",
      shadowColor: "shadow-cyan-500/20",
    },
    {
      label: "Active Houses",
      value: formatNumber(summary.house_count),
      icon: Users,
      gradient: "from-amber-500 to-orange-600",
      bgLight: "bg-amber-50 dark:bg-amber-500/10",
      textColor: "text-amber-600 dark:text-amber-400",
      shadowColor: "shadow-amber-500/20",
    },
    {
      label: "Avg per Transaction",
      value: formatCurrency(
        summary.transaction_count > 0
          ? summary.total_campaign_amount / summary.transaction_count
          : 0
      ),
      icon: TrendingUp,
      gradient: "from-emerald-500 to-green-600",
      bgLight: "bg-emerald-50 dark:bg-emerald-500/10",
      textColor: "text-emerald-600 dark:text-emerald-400",
      shadowColor: "shadow-emerald-500/20",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card, index) => {
        const Icon = card.icon;
        return (
          <div
            key={index}
            className="group relative bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 p-5 shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden"
          >
            {/* Gradient background on hover */}
            <div className={`absolute inset-0 bg-gradient-to-br ${card.gradient} opacity-0 group-hover:opacity-5 transition-opacity duration-300`} />

            <div className="relative">
              <div className="flex items-center justify-between mb-4">
                <div className={`inline-flex p-2.5 rounded-xl ${card.bgLight} ${card.shadowColor} shadow-sm`}>
                  <Icon className={`w-5 h-5 ${card.textColor}`} />
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wider">
                  {card.label}
                </p>
                <p className="text-xl font-bold text-gray-900 dark:text-gray-100 truncate">
                  {card.value}
                </p>
              </div>
            </div>

            {/* Bottom accent line */}
            <div className={`absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r ${card.gradient} transform scale-x-0 group-hover:scale-x-100 transition-transform duration-300`} />
          </div>
        );
      })}
    </div>
  );
}
