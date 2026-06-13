"use client";

import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp, ArrowUpDown, Pencil, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import toast from "react-hot-toast";
import { updateCommissionTransaction, deleteCommissionTransaction } from "@/lib/commission";
import type { PaginatedResponse, CommissionTransaction, CommissionTransactionUpdate } from "@/types/commission";

interface Props {
  data: PaginatedResponse;
  page: number;
  onPageChange: (page: number) => void;
  onRefresh: () => void;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-BD", {
    style: "currency",
    currency: "BDT",
    minimumFractionDigits: 2,
  }).format(value);

function EditModal({
  txn,
  open,
  onClose,
  onSuccess,
}: {
  txn: CommissionTransaction;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState<CommissionTransactionUpdate>({
    amount: txn.amount,
    purpose: txn.purpose || "",
    participant_name: txn.participant_name || "",
    participant_ref: txn.participant_ref || "",
  });
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateCommissionTransaction(txn.id, form);
      toast.success("Transaction updated");
      onSuccess();
      onClose();
    } catch {
      toast.error("Failed to update");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Edit Transaction #{txn.id}</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Amount (BDT)</label>
            <input type="number" value={form.amount ?? ""} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Purpose</label>
            <input type="text" value={form.purpose ?? ""} onChange={(e) => setForm({ ...form, purpose: e.target.value })}
              className="w-full px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Participant Name</label>
            <input type="text" value={form.participant_name ?? ""} onChange={(e) => setForm({ ...form, participant_name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Participant Ref</label>
            <input type="text" value={form.participant_ref ?? ""} onChange={(e) => setForm({ ...form, participant_ref: e.target.value })}
              className="w-full px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 outline-none" />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-50">
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirm({
  txn,
  open,
  onClose,
  onSuccess,
}: {
  txn: CommissionTransaction;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  if (!open) return null;

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteCommissionTransaction(txn.id);
      toast.success("Transaction deleted");
      onSuccess();
      onClose();
    } catch {
      toast.error("Failed to delete");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">Delete Transaction</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
          Delete transaction <strong>#{txn.id}</strong>?
          <br />
          <span className="text-gray-500">{txn.house_code} - {txn.campaign_name} - {formatCurrency(txn.amount)}</span>
          <br />
          This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg">Cancel</button>
          <button onClick={handleDelete} disabled={deleting} className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg disabled:opacity-50">
            {deleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TransactionRow({ txn, onEdit, onDelete }: { txn: CommissionTransaction; onEdit: (t: CommissionTransaction) => void; onDelete: (t: CommissionTransaction) => void }) {
  const [expanded, setExpanded] = useState(false);
  const { hasPermission } = useAuth();
  const canManage = hasPermission("commission.manage");

  return (
    <>
      <tr onClick={() => setExpanded(!expanded)} className="border-b border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors">
        <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">{txn.statement_date || "-"}</td>
        <td className="px-4 py-3">
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{txn.house_code}</span>
          <p className="text-xs text-gray-400">{txn.house_name}</p>
        </td>
        <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{txn.campaign_name || "-"}</td>
        <td className="px-4 py-3">
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-400 capitalize">{txn.participant_type?.replace(/_/g, " ") || "-"}</span>
        </td>
        <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{txn.participant_ref || "-"}</td>
        <td className="px-4 py-3 text-sm font-mono text-right text-gray-900 dark:text-gray-100">{formatCurrency(txn.amount)}</td>
        <td className="px-4 py-3 text-right">
          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {canManage && (
              <>
                <button onClick={() => onEdit(txn)} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-400 hover:text-blue-600" title="Edit">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => onDelete(txn)} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-400 hover:text-red-600" title="Delete">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
            {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50 dark:bg-slate-800/30">
          <td colSpan={7} className="px-4 py-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div><span className="text-xs text-gray-500 block">Purpose</span><span className="font-medium">{txn.purpose || "-"}</span></div>
              <div><span className="text-xs text-gray-500 block">Category</span><span className="font-medium capitalize">{txn.campaign_category?.replace(/_/g, " ") || "-"}</span></div>
              <div><span className="text-xs text-gray-500 block">Participant Name</span><span className="font-medium">{txn.participant_name || "-"}</span></div>
              <div><span className="text-xs text-gray-500 block">Employee</span><span className="font-medium">{txn.employee_name || txn.employee_employee_id || "-"}</span></div>
              <div><span className="text-xs text-gray-500 block">Batch Ref</span><span className="font-mono text-xs">{txn.batch_reference || "-"}</span></div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function ResultsTable({ data, page, onPageChange, onRefresh }: Props) {
  const totalPages = data.total_pages;
  const startItem = (page - 1) * data.page_size + 1;
  const endItem = Math.min(page * data.page_size, data.total);
  const [editTxn, setEditTxn] = useState<CommissionTransaction | null>(null);
  const [deleteTxn, setDeleteTxn] = useState<CommissionTransaction | null>(null);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-800">
        <p className="text-sm text-gray-500 dark:text-gray-400">Showing {startItem}-{endItem} of {data.total} transactions</p>
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
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider w-20"><ArrowUpDown className="w-3 h-3 inline" /></th>
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-gray-400">No transactions found</td></tr>
            ) : (
              data.items.map((txn) => <TransactionRow key={txn.id} txn={txn} onEdit={setEditTxn} onDelete={setDeleteTxn} />)
            )}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-slate-800">
          <p className="text-xs text-gray-400">Page {page} of {totalPages}</p>
          <div className="flex items-center gap-1">
            <button onClick={() => onPageChange(page - 1)} disabled={page <= 1} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed"><ChevronLeft className="w-4 h-4" /></button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const start = Math.max(1, Math.min(page - 2, totalPages - 4));
              const p = start + i;
              if (p > totalPages) return null;
              return <button key={p} onClick={() => onPageChange(p)} className={`w-8 h-8 text-sm rounded ${p === page ? "bg-primary-600 text-white" : "text-gray-600 hover:bg-gray-100 dark:hover:bg-slate-800"}`}>{p}</button>;
            })}
            <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:cursor-not-allowed"><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      )}
      {editTxn && <EditModal txn={editTxn} open={!!editTxn} onClose={() => setEditTxn(null)} onSuccess={onRefresh} />}
      {deleteTxn && <DeleteConfirm txn={deleteTxn} open={!!deleteTxn} onClose={() => setDeleteTxn(null)} onSuccess={onRefresh} />}
    </div>
  );
}
