"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Loader2, Upload, X } from "lucide-react";
import { toast } from "react-hot-toast";
import apiClient from "@/lib/api";
import { useLanguage } from "@/i18n/useLanguage";
import { cn } from "@/lib/utils";
import type { Invoice } from "@/types/billing";

const METHODS = ["bkash", "nagad", "rocket", "bank", "cash"] as const;
const METHOD_LABEL_KEYS: Record<string, string> = {
  bkash: "billing.method_bkash",
  nagad: "billing.method_nagad",
  rocket: "billing.method_rocket",
  bank: "billing.method_bank",
  cash: "billing.method_cash",
};
const MFS_METHODS = new Set(["bkash", "nagad", "rocket"]);
const REFERENCE_REQUIRED = new Set(["bkash", "nagad", "rocket", "bank"]);
const BD_MOBILE_RE = /^01[3-9]\d{8}$/;

// Payment proofs are phone screenshots: they must stay readable, so the image
// is only re-encoded above this size, and never below a 2400px long edge.
const PROOF_MAX_DIMENSION = 2400;
const PROOF_COMPRESS_THRESHOLD = 500 * 1024;

async function compressProofImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size <= PROOF_COMPRESS_THRESHOLD) {
    return file;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const longestEdge = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, PROOF_MAX_DIMENSION / longestEdge);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    // JPEG has no alpha channel: paint white first so a transparent PNG does
    // not turn into black boxes.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85)
    );
    if (!blob || blob.size >= file.size) return file;
    const baseName = file.name.replace(/\.[^.]+$/, "") || "payment-proof";
    return new File([blob], `${baseName}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch {
    // An unsupported browser must never block the upload.
    return file;
  }
}

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
  const [senderNumber, setSenderNumber] = useState("");
  const [bankName, setBankName] = useState("");
  const [depositorName, setDepositorName] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [note, setNote] = useState("");
  const [proof, setProof] = useState<File | null>(null);
  const [proofBusy, setProofBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setMethod("bkash");
    setAmount(invoice ? String(invoice.total) : "");
    setReference("");
    setSenderNumber("");
    setBankName("");
    setDepositorName("");
    setPaymentDate("");
    setNote("");
    setProof(null);
    setProofBusy(false);
    setError(null);
    setFieldErrors({});
  }, [open, invoice]);

  if (!open || !invoice) return null;

  const isMfs = MFS_METHODS.has(method);
  const isBank = method === "bank";
  const needsReference = REFERENCE_REQUIRED.has(method);

  const validate = (): Record<string, string> => {
    const errors: Record<string, string> = {};
    if (!amount || Number(amount) <= 0) errors.amount = t("billing.amount_required");
    if (needsReference && reference.trim().length < 4) {
      errors.reference = t("billing.reference_required");
    }
    if (isMfs && !BD_MOBILE_RE.test(senderNumber.replace(/[^0-9]/g, ""))) {
      errors.sender_number = t("billing.sender_number_invalid");
    }
    if (isBank && !bankName.trim()) errors.bank_name = t("billing.bank_name_required");
    if (isBank && !depositorName.trim()) {
      errors.depositor_name = t("billing.depositor_name_required");
    }
    if (!paymentDate) {
      errors.payment_date = t("billing.payment_date_required");
    } else {
      const picked = new Date(`${paymentDate}T00:00:00`);
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      if (picked.getTime() > today.getTime()) {
        errors.payment_date = t("billing.payment_date_future");
      }
    }
    return errors;
  };

  const submit = async () => {
    if (!houseId) return;
    const clientErrors = validate();
    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
      return;
    }
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      const form = new FormData();
      form.append("invoice_id", String(invoice.id));
      form.append("method", method);
      form.append("amount", amount);
      if (reference.trim()) form.append("reference", reference.trim());
      if (isMfs) form.append("sender_number", senderNumber.replace(/[^0-9]/g, ""));
      if (isBank) {
        form.append("bank_name", bankName.trim());
        form.append("depositor_name", depositorName.trim());
      }
      form.append("payment_date", paymentDate);
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
                  {t(METHOD_LABEL_KEYS[m])}
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
              {needsReference && <span className="text-red-500"> *</span>}
            </label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              maxLength={120}
              required={needsReference}
              placeholder="e.g. BKX1234567"
              className={cn(
                "w-full min-h-11 px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-900 border text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400",
                fieldErrors.reference ? "border-red-400" : "border-gray-200 dark:border-slate-700"
              )}
            />
            {fieldErrors.reference && <p className="text-xs text-red-500 mt-1">{fieldErrors.reference}</p>}
          </div>

          {isMfs && (
            <div>
              <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                {t("billing.sender_number")} <span className="text-red-500">*</span>
              </label>
              <input
                type="tel"
                inputMode="tel"
                value={senderNumber}
                onChange={(e) => setSenderNumber(e.target.value)}
                maxLength={14}
                required
                placeholder="01XXXXXXXXX"
                className={cn(
                  "w-full min-h-11 px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-900 border text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400",
                  fieldErrors.sender_number ? "border-red-400" : "border-gray-200 dark:border-slate-700"
                )}
              />
              {fieldErrors.sender_number ? (
                <p className="text-xs text-red-500 mt-1">{fieldErrors.sender_number}</p>
              ) : (
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                  {t("billing.sender_number_hint")}
                </p>
              )}
            </div>
          )}

          {isBank && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                  {t("billing.bank_name")} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  maxLength={120}
                  required
                  className={cn(
                    "w-full min-h-11 px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-900 border text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400",
                    fieldErrors.bank_name ? "border-red-400" : "border-gray-200 dark:border-slate-700"
                  )}
                />
                {fieldErrors.bank_name && <p className="text-xs text-red-500 mt-1">{fieldErrors.bank_name}</p>}
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                  {t("billing.depositor_name")} <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={depositorName}
                  onChange={(e) => setDepositorName(e.target.value)}
                  maxLength={120}
                  required
                  className={cn(
                    "w-full min-h-11 px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-900 border text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400",
                    fieldErrors.depositor_name ? "border-red-400" : "border-gray-200 dark:border-slate-700"
                  )}
                />
                {fieldErrors.depositor_name && (
                  <p className="text-xs text-red-500 mt-1">{fieldErrors.depositor_name}</p>
                )}
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
              {t("billing.payment_date")} <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              max={new Date().toISOString().slice(0, 10)}
              required
              className={cn(
                "w-full min-h-11 px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-900 border text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 cursor-pointer",
                fieldErrors.payment_date ? "border-red-400" : "border-gray-200 dark:border-slate-700"
              )}
            />
            {fieldErrors.payment_date ? (
              <p className="text-xs text-red-500 mt-1">{fieldErrors.payment_date}</p>
            ) : (
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                {t("billing.payment_date_hint")}
              </p>
            )}
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
              {proofBusy ? (
                <Loader2 className="w-4 h-4 shrink-0 text-gray-400 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 shrink-0 text-gray-400" />
              )}
              <span className="truncate">
                {proof ? proof.name : t("billing.proof_hint")}
              </span>
              {proof && !proofBusy && (
                <span className="ml-auto shrink-0 text-[11px] text-gray-400 dark:text-gray-500">
                  {proof.size >= 1024 * 1024
                    ? `${(proof.size / (1024 * 1024)).toFixed(1)} MB`
                    : `${Math.max(1, Math.round(proof.size / 1024))} KB`}
                </span>
              )}
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.webp,.pdf"
                className="sr-only"
                onChange={async (e) => {
                  const picked = e.target.files?.[0] ?? null;
                  if (!picked) {
                    setProof(null);
                    return;
                  }
                  setProofBusy(true);
                  const optimized = await compressProofImage(picked);
                  setProof(optimized);
                  setProofBusy(false);
                  setFieldErrors((prev) => {
                    if (!prev.proof) return prev;
                    const { proof: _removed, ...rest } = prev;
                    return rest;
                  });
                }}
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
            disabled={submitting || proofBusy}
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
