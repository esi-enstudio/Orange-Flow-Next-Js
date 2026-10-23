"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Loader2, Upload, X } from "lucide-react";
import { toast } from "react-hot-toast";
import apiClient from "@/lib/api";
import { useLanguage } from "@/i18n/useLanguage";
import { cn } from "@/lib/utils";
import type { Invoice } from "@/types/billing";

const METHODS = ["bkash", "nagad", "rocket", "bank", "cash", "mobilebanking", "manual"] as const;

interface Props {
  open: boolean;
  invoice: Invoice | null;
  houseId: number | null;
  onClose: () => void;
  onSubmitted: () => void;
}

export default function PaymentRequestModal({ open, invoice, houseId, onClose, onSubmitted }: Props) {
  const { t } = useLanguage();
  const [method, setMethod] = useState<string>("bkash");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setMethod("bkash");
    setAmount(invoice ? String(invoice.total) : "");
    setReference("");
    setNote("");
    setProof(null);
    setError(null);
    setFieldErrors({});
  }, [open, invoice]);

  if (!open || !invoice) return null;

  const submit = async () => {
    if (!houseId) return;
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      const form = new FormData();
      form.append("invoice_id", String(invoice.id));
      form.append("method", method);
      form.append("amount", amount);
      if (reference.trim()) form.append("reference", reference.trim());
      if (note.trim()) form.append("note", note.trim());
      if (proof) form.append("proof", proof);

      await apiClient.post("v1/billing/payments/request", form, {
        headers: { "X-House-ID": String(houseId) },
      });
      toast.success(t("billing.request_submitted"));
      onSubmitted();
      onClose();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      if (detail && typeof detail === "object") {
        setError(detail.message || t("common.error"));
        if (detail.fields && typeof detail.fields === "object") setFieldErrors(detail.fields);
      } else {
        setError(typeof detail === "string" ? detail : err?.message || t("common.error"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("billing.request_payment_title")}
        className="w-full sm:max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 px-5 sm:px-6 pt-5 sm:pt-6">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
              {t("billing.request_payment_title")}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t("billing.request_payment_desc")}
            </p>
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1.5">
              {t("billing.invoice_ref", { no: invoice.invoice_no })} · {t("billing.invoice_total")}:{" "}
              <span className="font-bold text-gray-700 dark:text-gray-200">
                ৳{Number(invoice.total).toLocaleString()}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="shrink-0 p-2 -mr-1 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 sm:px-6 py-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 px-3 py-2.5 text-sm text-red-600 dark:text-red-400">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
              {t("billing.payment_method_label")}
            </label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="w-full min-h-11 px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 cursor-pointer"
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
              {t("billing.amount")} <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={cn(
                "w-full min-h-11 px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-900 border text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400",
                fieldErrors.amount ? "border-red-400" : "border-gray-200 dark:border-slate-700"
              )}
            />
            {fieldErrors.amount ? (
              <p className="text-xs text-red-500 mt-1">{fieldErrors.amount}</p>
            ) : (
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">{t("billing.amount_hint")}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
              {t("billing.reference")}
            </label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              maxLength={120}
              placeholder="e.g. BKX1234567"
              className={cn(
                "w-full min-h-11 px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-900 border text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400",
                fieldErrors.reference ? "border-red-400" : "border-gray-200 dark:border-slate-700"
              )}
            />
            {fieldErrors.reference && <p className="text-xs text-red-500 mt-1">{fieldErrors.reference}</p>}
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
              {t("billing.note_optional")}
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={500}
              className="w-full rounded-xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 px-3.5 py-2.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400"
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
              {t("billing.proof_optional")}
            </label>
            <label className="flex items-center gap-2.5 min-h-11 px-3.5 py-2.5 rounded-xl border border-dashed border-gray-300 dark:border-slate-700 bg-gray-50/60 dark:bg-slate-800/40 text-sm text-gray-600 dark:text-gray-300 cursor-pointer">
              <Upload className="w-4 h-4 shrink-0 text-gray-400" />
              <span className="truncate">{proof ? proof.name : t("billing.proof_hint")}</span>
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.webp,.pdf"
                className="sr-only"
                onChange={(e) => setProof(e.target.files?.[0] ?? null)}
              />
            </label>
            {fieldErrors.proof && <p className="text-xs text-red-500 mt-1">{fieldErrors.proof}</p>}
          </div>
        </div>

        <div className="sticky bottom-0 px-5 sm:px-6 py-4 bg-white dark:bg-slate-900 border-t border-gray-100 dark:border-slate-800 flex flex-col-reverse sm:flex-row gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="min-h-11 px-4 py-2.5 rounded-xl text-sm font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="flex-1 inline-flex items-center justify-center gap-2 min-h-11 px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 cursor-pointer"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {t("billing.submit_for_approval")}
          </button>
        </div>
      </div>
    </div>
  );
}
