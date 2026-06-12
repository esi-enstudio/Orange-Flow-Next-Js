"use client";

import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, ArrowUpDown } from "lucide-react";
import { useState } from "react";
import type { PaginatedResponse, CommissionTransaction } from "@/types/commission";

interface Props {
  data: PaginatedResponse;
  page: number;
  onPageChange: (page: number) => void;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-BD", {
    style: "currency",
    currency: "BDT",
    minimumFractionDigits: 2,
  }).format(value);

function TransactionRow({ txn }: { txn: CommissionTransaction }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        onClick={() => setExpanded(!expanded)}
        className="border-b border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
      >
        <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
          {txn.statement_date || "-"}
        </td>
        <td className="px-4 py-3">
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {txn.house_code}
          </span>
          <p className="text-xs text-gray-400">{txn.house_name}</p>
        </td>
        <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
          {txn.campaign_name || "-"}
        </td>
        <td className="px-4 py-3">
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-400 capitalize">
            {txn.participant_type?.replace(/_/g, " ") || "-"}
          </span>
        </td>
        <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
          {txn.participant_ref || "-"}
        </td>
        <td className="px-4 py-3 text-sm font-mono text-right text-gray-900 dark:text-gray-100">
          {formatCurrency(txn.amount)}
        </td>
        <td className="px-4 py-3 text-right">
          {expanded ? (
            <ChevronUp className="w-4 h-4 inline text-gray-400" />
          ) : (
            <ChevronDown className="w-4 h-4 inline text-gray-400" />
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50 dark:bg-slate-800/30">
          <td colSpan={7} className="px-4 py-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-xs text-gray-500 block">Purpose</span>
                <span className="font-medium">{txn.purpose || "-"}</span>
              </div>
              <div>
                <span className="text-xs text-gray-500 block">Campaign Category</span>
                <span className="font-medium capitalize">{txn.campaign_category?.replace(/_/g, " ") || "-"}</span>
              </div>
              <div>
                <span className="text-xs text-gray-500 block">Participant Name</span>
                <span className="font-medium">{txn.participant_name || "-"}</span>
              </div>
              <div>
                <span className="text-xs text-gray-500 block">Employee Link</span>
                <span className="font-medium">{txn.employee_name || txn.employee_employee_id || "-"}</span>
              </div>
              <div>
                <span className="text-xs text-gray-500 block">Batch Ref</span>
                <span className="font-mono text-xs">{txn.batch_reference || "-"}</span>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function ResultsTable({ data, page, onPageChange }: Props) {
  const totalPages = data.total_pages;
  const startItem = (page - 1) * data.page_size + 1;
  const endItem = Math.min(page * data.page_size, data.total);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-800">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Showing {startItem}-{endItem} of {data.total} transactions
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 dark:bg-slate-800/50">
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">House</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Campaign</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Participant Type</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Participant Ref</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Amount</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider w-10">
                <ArrowUpDown className="w-3 h-3 inline" />
              </th>
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-sm text-gray-400">
                  No commission transactions found matching your filters
                </td>
              </tr>
            ) : (
              data.items.map((txn) => <TransactionRow key={txn.id} txn={txn} />)
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-slate-800">
          <p className="text-xs text-gray-400">Page {page} of {totalPages}</p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const start = Math.max(1, Math.min(page - 2, totalPages - 4));
              const p = start + i;
              if (p > totalPages) return null;
              return (
                <button
                  key={p}
                  onClick={() => onPageChange(p)}
                  className={`w-8 h-8 text-sm rounded ${
                    p === page
                      ? "bg-primary-600 text-white"
                      : "text-gray-600 hover:bg-gray-100 dark:hover:bg-slate-800"
                  }`}
                >
                  {p}
                </button>
              );
            })}
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
