"use client";

import { useAuth } from "@/context/AuthContext";
import { Loader2, Calculator } from "lucide-react";

export default function CommissionPage() {
  const { loading: authLoading } = useAuth();

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary-50 text-primary-600 shadow-sm">
            <Calculator className="w-5 h-5" />
          </div>
          Commission
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 ml-1">
          View and manage commission calculations and payouts.
        </p>
      </div>

      {/* Placeholder */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-12">
        <div className="flex flex-col items-center justify-center text-center">
          <div className="p-4 rounded-2xl bg-gray-50 dark:bg-slate-800 mb-4">
            <Calculator className="w-12 h-12 text-gray-300 dark:text-gray-600" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
            Commission Module
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md">
            This module is under development. Commission calculation and payout features will be available here.
          </p>
        </div>
      </div>
    </div>
  );
}
