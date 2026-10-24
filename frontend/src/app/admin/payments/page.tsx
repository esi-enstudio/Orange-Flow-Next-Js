"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Paperclip,
  RefreshCw,
  Search,
  XCircle,
} from "lucide-react";
import { toast } from "react-hot-toast";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import PageGuideModal from "@/components/PageGuideModal";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import type { HouseOption, Paginated } from "@/types/billing";

const STATUSES = [
  "pending",
  "needs_info",
  "succeeded",
  "failed",
  "refunded",
  "partially_refunded",
];
const METHODS = ["bkash", "nagad", "rocket", "bank", "cash", "mobilebanking", "manual"];
const STATUS_BADGE: Record<string, string> = {
  succeeded: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400",
  pending: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400",
  needs_info: "bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400",
  failed: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400",
  refunded: "bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400",
  partially_refunded: "bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400",
};

interface PaymentRow {
  id: number;
  house_id: number;
  house_name?: string | null;
  house_code?: string | null;
  invoice_id: number;
  invoice_no?: string | null;
  plan_name?: string | null;
  expected_amount?: number | null;
  amount: number;
  currency: string;
  status: string;
  gateway?: string | null;
  method?: string | null;
  gateway_tran_id?: string | null;
  reference?: string | null;
  note?: string | null;
  rejection_reason?: string | null;
  info_request_reason?: string | null;
  has_proof?: boolean;
  proof_name?: string | null;
  submitted_by?: number | null;
  submitted_by_name?: string | null;
  submitted_by_role?: string | null;
  submitted_at?: string | null;
  sender_number?: string | null;
  bank_name?: string | null;
  depositor_name?: string | null;
  payment_date?: string | null;
  paid_at?: string | null;
  created_at?: string | null;
}

interface ReviewEvent {
  action: string;
  at?: string | null;
  by?: number | null;
  by_name?: string | null;
  reason?: string | null;
}

interface RefundRow {
  id: number;
  amount: number;
  currency: string;
  status: string;
  reason?: string | null;
  created_at?: string | null;
  refunded_at?: string | null;
}

interface PaymentDetail extends PaymentRow {
  invoice_status?: string | null;
  invoice_due_date?: string | null;
  billing_period_start?: string | null;
  billing_period_end?: string | null;
  plan_interval?: string | null;
  subscription_status?: string | null;
  subscription_period_end?: string | null;
  review_history: ReviewEvent[];
  refunds?: RefundRow[];
}

interface PaymentSummary {
  total_submitted: number;
  pending_review: number;
  needs_info: number;
  approved: number;
  rejected: number;
  refunded: number;
  total_approved_amount: number;
}

// Reviewers read dates, not ISO strings: "24 October 2026".
const parseDateValue = (v?: string | null): Date | null => {
  if (!v) return null;
  const raw = String(v);
  const parsed = new Date(raw.length <= 10 ? `${raw.slice(0, 10)}T00:00:00` : raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const fmtLongDate = (v?: string | null) => {
  const parsed = parseDateValue(v);
  if (!parsed) return "—";
  return parsed.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

// "24 Oct 2026, 07:04 PM" — 12-hour clock with an explicit meridiem.
const fmtDateTime12 = (v?: string | null) => {
  const parsed = parseDateValue(v);
  if (!parsed) return "—";
  const date = parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const time = parsed.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  return `${date}, ${time}`;
};
const fmtMoney = (n?: number | null) =>
  n === null || n === undefined ? "—" : `৳${Number(n).toLocaleString()}`;

function Badge({ status }: { status?: string | null }) {
  const s = status || "unknown";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold capitalize ${
        STATUS_BADGE[s] || "bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-400"
      }`}
    >
      {s.replace("_", " ")}
    </span>
  );
}

export default function AdminPaymentsPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const { hasPermission, loading: authLoading } = useAuth();

  const [summary, setSummary] = useState<PaymentSummary | null>(null);
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [houses, setHouses] = useState<HouseOption[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [perPage] = useState(20);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Record<number, PaymentDetail>>({});
  const [detailLoading, setDetailLoading] = useState<number | null>(null);
  const [proofBusy, setProofBusy] = useState<number | null>(null);

  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [status, setStatus] = useState("");
  const [method, setMethod] = useState("");
  const [houseId, setHouseId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [approveTarget, setApproveTarget] = useState<PaymentRow | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PaymentRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [infoTarget, setInfoTarget] = useState<PaymentRow | null>(null);
  const [infoReason, setInfoReason] = useState("");
  const [refundTarget, setRefundTarget] = useState<PaymentDetail | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [completeRefundTarget, setCompleteRefundTarget] = useState<
    { paymentId: number; refundId: number } | null
  >(null);
  const [rejectRefundTarget, setRejectRefundTarget] = useState<
    { paymentId: number; refundId: number } | null
  >(null);
  const [refundRejectReason, setRefundRejectReason] = useState("");

  const canView = hasPermission("payments.manage");
  const canApprove = hasPermission("billing.approve_payment");
  const canReject = hasPermission("billing.reject_payment");
  const canRefund = hasPermission("billing.refund");

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    if (method) params.set("method", method);
    if (houseId) params.set("house_id", houseId);
    if (fromDate) params.set("from_date", fromDate);
    if (toDate) params.set("to_date", toDate);
    return params.toString();
  }, [page, perPage, search, status, method, houseId, fromDate, toDate]);

  const fetchRows = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    try {
      const res = await apiClient.get(`v1/admin/payments?${query}`);
      const payload = res.data as Paginated<PaymentRow>;
      setRows(payload.data || []);
      setTotal(payload.pagination?.total || 0);
      setTotalPages(payload.pagination?.total_pages || 1);
    } catch (err: any) {
      toast.error(err?.message || t("pricing.something_went_wrong"));
    } finally {
      setLoading(false);
    }
  }, [canView, query, t]);

  const fetchSummary = useCallback(async () => {
    if (!canView) return;
    try {
      const params = new URLSearchParams();
      if (houseId) params.set("house_id", houseId);
      if (fromDate) params.set("from_date", fromDate);
      if (toDate) params.set("to_date", toDate);
      const res = await apiClient.get(`v1/admin/payments/summary?${params.toString()}`);
      setSummary(res.data?.data || null);
    } catch {
      /* the cards keep their last value; the table still works */
    }
  }, [canView, houseId, fromDate, toDate]);

  useEffect(() => {
    if (authLoading) return;
    if (!canView) {
      const timer = setTimeout(() => router.push("/"), 5000);
      return () => clearTimeout(timer);
    }
    fetchRows();
    fetchSummary();
  }, [authLoading, canView, fetchRows, fetchSummary, router]);

  useEffect(() => {
    if (authLoading || !canView) return;
    apiClient
      .get("houses/accessible")
      .then((res) => setHouses(res.data || []))
      .catch(() => setHouses([]));
  }, [authLoading, canView]);

  const loadDetail = useCallback(
    async (id: number) => {
      if (detail[id]) return;
      setDetailLoading(id);
      try {
        const res = await apiClient.get(`v1/admin/payments/${id}`);
        setDetail((d) => ({ ...d, [id]: res.data.data as PaymentDetail }));
      } catch (err: any) {
        toast.error(err?.message || t("pricing.something_went_wrong"));
      } finally {
        setDetailLoading(null);
      }
    },
    [detail, t]
  );

  const toggleExpand = (id: number) => {
    setExpandedId((prev) => (prev === id ? null : id));
    loadDetail(id);
  };

  const refreshAfterAction = async () => {
    setDetail({});
    await Promise.all([fetchRows(), fetchSummary()]);
  };

  const approvePayment = async () => {
    if (!approveTarget) return;
    setBusy(true);
    try {
      // The idempotency key makes a double-click / retried request safe.
      await apiClient.post(
        `v1/admin/payments/${approveTarget.id}/approve`,
        {},
        { headers: { "Idempotency-Key": `approve-${approveTarget.id}-${Date.now()}` } }
      );
      toast.success(t("admin_payments.approve_success"));
      setApproveTarget(null);
      await refreshAfterAction();
    } catch (err: any) {
      toast.error(err?.message || t("pricing.something_went_wrong"));
    } finally {
      setBusy(false);
    }
  };

  const rejectPayment = async () => {
    if (!rejectTarget) return;
    setBusy(true);
    try {
      await apiClient.post(`v1/admin/payments/${rejectTarget.id}/reject`, {
        reason: rejectReason.trim(),
      });
      toast.success(t("admin_payments.reject_success"));
      setRejectTarget(null);
      setRejectReason("");
      await refreshAfterAction();
    } catch (err: any) {
      toast.error(err?.message || t("pricing.something_went_wrong"));
    } finally {
      setBusy(false);
    }
  };

  const requestInfo = async () => {
    if (!infoTarget) return;
    setBusy(true);
    try {
      await apiClient.post(`v1/admin/payments/${infoTarget.id}/request-info`, {
        reason: infoReason.trim(),
      });
      toast.success(t("admin_payments.request_info_success"));
      setInfoTarget(null);
      setInfoReason("");
      await refreshAfterAction();
    } catch (err: any) {
      toast.error(err?.message || t("pricing.something_went_wrong"));
    } finally {
      setBusy(false);
    }
  };

  const submitRefund = async () => {
    if (!refundTarget) return;
    setBusy(true);
    try {
      await apiClient.post(`v1/admin/payments/${refundTarget.id}/refund`, {
        amount: refundAmount ? Number(refundAmount) : null,
        reason: refundReason.trim(),
      });
      toast.success(t("admin_payments.refund_recorded"));
      setRefundTarget(null);
      setRefundReason("");
      setDetail({});
      await Promise.all([fetchRows(), fetchSummary()]);
    } catch (err: any) {
      toast.error(err?.message || t("pricing.something_went_wrong"));
    } finally {
      setBusy(false);
    }
  };

  const completeRefund = async () => {
    if (!completeRefundTarget) return;
    setBusy(true);
    try {
      await apiClient.post(`v1/admin/refunds/${completeRefundTarget.refundId}/complete`, {});
      toast.success(t("admin_payments.refund_completed"));
      setCompleteRefundTarget(null);
      setDetail({});
      await Promise.all([fetchRows(), fetchSummary()]);
    } catch (err: any) {
      toast.error(err?.message || t("pricing.something_went_wrong"));
    } finally {
      setBusy(false);
    }
  };

  const rejectRefund = async () => {
    if (!rejectRefundTarget) return;
    setBusy(true);
    try {
      await apiClient.post(`v1/admin/refunds/${rejectRefundTarget.refundId}/reject`, {
        reason: refundRejectReason.trim(),
      });
      toast.success(t("admin_payments.refund_rejected"));
      setRejectRefundTarget(null);
      setRefundRejectReason("");
      setDetail({});
      await Promise.all([fetchRows(), fetchSummary()]);
    } catch (err: any) {
      toast.error(err?.message || t("pricing.something_went_wrong"));
    } finally {
      setBusy(false);
    }
  };

  const openProof = async (payment: PaymentRow) => {
    setProofBusy(payment.id);
    try {
      const res = await apiClient.get(`v1/admin/payments/${payment.id}/proof`, {
        responseType: "blob",
      });
      // The blob type decides how the new tab renders it — without the server
      // content-type the browser shows raw bytes as text.
      const contentType =
        (res.headers?.["content-type"] as string | undefined) || "application/octet-stream";
      const url = window.URL.createObjectURL(new Blob([res.data], { type: contentType }));
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
    } catch {
      toast.error(t("admin_payments.proof_missing"));
    } finally {
      setProofBusy(null);
    }
  };

  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setStatus("");
    setMethod("");
    setHouseId("");
    setFromDate("");
    setToDate("");
    setPage(1);
  };

  const summaryCards = [
    { key: "total_submitted", value: summary?.total_submitted ?? 0, tone: "text-gray-900 dark:text-gray-100" },
    { key: "pending_review", value: summary?.pending_review ?? 0, tone: "text-amber-600 dark:text-amber-400" },
    { key: "approved", value: summary?.approved ?? 0, tone: "text-emerald-600 dark:text-emerald-400" },
    { key: "rejected", value: summary?.rejected ?? 0, tone: "text-red-600 dark:text-red-400" },
    {
      key: "total_approved_amount",
      value: fmtMoney(summary?.total_approved_amount ?? 0),
      tone: "text-primary-600 dark:text-primary-400",
    },
  ] as const;

  if (!authLoading && !canView) {
    return <AccessDenied />;
  }

  const reasonInvalid = (value: string) => value.trim().length < 3;

  const detailPanel = (p: PaymentRow) => {
    const d = detail[p.id];
    return (
      <div className="border-t border-gray-100 bg-gray-50/40 px-4 py-4 dark:border-slate-800 dark:bg-slate-800/30">
        {detailLoading === p.id && !d ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-gray-200 dark:bg-slate-700" />
            ))}
          </div>
        ) : !d ? (
          <p className="text-xs text-gray-400">{t("common.error")}</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label={t("admin_payments.plan")} value={d.plan_name || "—"} />
              <Field label={t("admin_payments.invoice")} value={d.invoice_no || "—"} />
              <Field label={t("admin_payments.expected")} value={fmtMoney(d.expected_amount)} />
              <Field label={t("admin_payments.submitted_at")} value={fmtDateTime12(d.submitted_at)} />
              <Field
                label={t("admin_payments.period")}
                value={`${fmtLongDate(d.billing_period_start)} → ${fmtLongDate(d.billing_period_end)}`}
              />
              <Field label={t("admin_payments.subscription_status")} value={d.subscription_status || "—"} />
              <Field label={t("admin_payments.payment_date")} value={fmtLongDate(d.payment_date)} />
              <Field label={t("admin_payments.sender_number")} value={d.sender_number || "—"} />
              <Field label={t("admin_payments.bank_name")} value={d.bank_name || "—"} />
              <Field label={t("admin_payments.depositor_name")} value={d.depositor_name || "—"} />
              <Field label={t("admin_payments.note")} value={d.note || "—"} />
              <Field
                label={t("admin_payments.submitted_by")}
                value={
                  d.submitted_by_name
                    ? `${d.submitted_by_name}${d.submitted_by_role ? ` (${d.submitted_by_role})` : ""}`
                    : d.submitted_by
                      ? `#${d.submitted_by}`
                      : "—"
                }
              />
            </div>

            {d.has_proof && (
              <button
                type="button"
                onClick={() => openProof(d)}
                disabled={proofBusy === d.id}
                className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-200 dark:hover:bg-slate-700"
              >
                {proofBusy === d.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Paperclip className="h-3.5 w-3.5" />
                )}
                {t("admin_payments.view_proof")}
              </button>
            )}

            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-400">
                {t("admin_payments.review_history")}
              </p>
              {d.review_history.length === 0 ? (
                <p className="text-xs text-gray-400">{t("admin_payments.no_history")}</p>
              ) : (
                <ol className="space-y-2 border-l-2 border-gray-200 pl-3 dark:border-slate-700">
                  {d.review_history.map((ev, idx) => (
                    <li key={`${ev.action}-${idx}`} className="text-xs text-gray-600 dark:text-gray-300">
                      <span className="font-bold capitalize">{ev.action.replace("_", " ")}</span>
                      <span className="text-gray-400"> · {fmtDateTime12(ev.at)}</span>
                      {ev.by_name || ev.by ? (
                        <span className="text-gray-400"> · {ev.by_name || `#${ev.by}`}</span>
                      ) : null}
                      {ev.reason ? (
                        <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">{ev.reason}</p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </div>

            {(d.refunds?.length ?? 0) > 0 && (
              <div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-400">
                  {t("admin_payments.refunds")}
                </p>
                <ul className="space-y-2">
                  {d.refunds!.map((r) => (
                    <li
                      key={r.id}
                      className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-100 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900"
                    >
                      <span className="text-xs font-bold text-gray-800 dark:text-gray-200">
                        {fmtMoney(r.amount)}
                      </span>
                      <Badge status={r.status} />
                      <span className="flex-1 truncate text-[11px] text-gray-500 dark:text-gray-400">
                        {r.reason || "—"}
                      </span>
                      {r.status === "processing" && canRefund && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setCompleteRefundTarget({ paymentId: d.id, refundId: r.id })}
                            className="min-h-9 cursor-pointer rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-emerald-700"
                          >
                            {t("admin_payments.complete_refund")}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRejectRefundTarget({ paymentId: d.id, refundId: r.id });
                              setRefundRejectReason("");
                            }}
                            className="min-h-9 cursor-pointer rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] font-bold text-red-600 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400"
                          >
                            {t("admin_payments.fail_refund")}
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {canRefund && (d.status === "succeeded" || d.status === "partially_refunded") && (
              <button
                type="button"
                onClick={() => {
                  setRefundTarget(d);
                  setRefundAmount(String(d.amount));
                  setRefundReason("");
                }}
                className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-lg bg-violet-50 px-3.5 py-2 text-xs font-bold text-violet-600 hover:bg-violet-100 dark:bg-violet-500/10 dark:text-violet-400 dark:hover:bg-violet-500/20"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {t("admin_payments.record_refund")}
              </button>
            )}

            {(d.status === "pending" || d.status === "needs_info") && (
              <div className="flex flex-wrap gap-2">
                {canApprove && (
                  <button
                    type="button"
                    onClick={() => setApproveTarget(d)}
                    className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-700"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {t("admin_payments.approve")}
                  </button>
                )}
                {canApprove && d.status === "pending" && (
                  <button
                    type="button"
                    onClick={() => {
                      setInfoTarget(d);
                      setInfoReason("");
                    }}
                    className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-600 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-400 dark:hover:bg-amber-500/20"
                  >
                    <AlertCircle className="h-3.5 w-3.5" />
                    {t("admin_payments.request_info")}
                  </button>
                )}
                {canReject && d.status === "pending" && (
                  <button
                    type="button"
                    onClick={() => {
                      setRejectTarget(d);
                      setRejectReason("");
                    }}
                    className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-lg bg-red-50 px-3.5 py-2 text-xs font-bold text-red-600 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    {t("admin_payments.reject")}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="animate-in fade-in space-y-6 duration-500">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {t("admin_payments.title")}
            </h1>
            <PageGuideModal pageKey="admin_payments" />
          </div>
          <p className="mt-1 text-sm text-gray-500 transition-colors dark:text-gray-400">
            {t("admin_payments.description")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            fetchRows();
            fetchSummary();
          }}
          className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50 dark:border-slate-800 dark:bg-slate-900 dark:text-gray-200 dark:hover:bg-slate-800"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {t("common.refresh")}
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {summaryCards.map((card) => (
          <div
            key={card.key}
            className="rounded-2xl border border-gray-100 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
          >
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              {t(`admin_payments.${card.key}`)}
            </p>
            {summary === null ? (
              <div className="mt-2 h-5 w-16 animate-pulse rounded-md bg-gray-200 dark:bg-slate-700" />
            ) : (
              <p className={`mt-1 text-lg font-bold ${card.tone}`}>{card.value}</p>
            )}
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <form
          className="relative sm:col-span-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchInput.trim());
            setPage(1);
          }}
        >
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("admin_payments.search_placeholder")}
            className="h-11 w-full rounded-xl border border-gray-200 bg-white pl-10 pr-4 text-sm text-gray-700 dark:border-slate-800 dark:bg-slate-900 dark:text-gray-200"
          />
        </form>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="h-11 cursor-pointer rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-700 dark:border-slate-800 dark:bg-slate-900 dark:text-gray-200"
        >
          <option value="">{t("admin_payments.all_statuses")}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace("_", " ")}
            </option>
          ))}
        </select>
        <select
          value={method}
          onChange={(e) => {
            setMethod(e.target.value);
            setPage(1);
          }}
          className="h-11 cursor-pointer rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-700 dark:border-slate-800 dark:bg-slate-900 dark:text-gray-200"
        >
          <option value="">{t("admin_payments.all_methods")}</option>
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select
          value={houseId}
          onChange={(e) => {
            setHouseId(e.target.value);
            setPage(1);
          }}
          className="h-11 cursor-pointer rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-700 dark:border-slate-800 dark:bg-slate-900 dark:text-gray-200"
        >
          <option value="">{t("admin_payments.all_houses")}</option>
          {houses.map((h) => (
            <option key={h.id} value={h.id}>
              {h.display_name || `${h.name} (${h.code})`}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={fromDate}
            max={toDate || undefined}
            onChange={(e) => {
              setFromDate(e.target.value);
              setPage(1);
            }}
            aria-label={t("admin_payments.date_from")}
            className="h-11 w-full cursor-pointer rounded-xl border border-gray-200 bg-white px-2 text-xs text-gray-700 dark:border-slate-800 dark:bg-slate-900 dark:text-gray-200"
          />
          <input
            type="date"
            value={toDate}
            min={fromDate || undefined}
            onChange={(e) => {
              setToDate(e.target.value);
              setPage(1);
            }}
            aria-label={t("admin_payments.date_to")}
            className="h-11 w-full cursor-pointer rounded-xl border border-gray-200 bg-white px-2 text-xs text-gray-700 dark:border-slate-800 dark:bg-slate-900 dark:text-gray-200"
          />
        </div>
        <button
          type="button"
          onClick={clearFilters}
          className="h-11 cursor-pointer rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold text-gray-600 hover:bg-gray-50 dark:border-slate-800 dark:bg-slate-900 dark:text-gray-300 dark:hover:bg-slate-800"
        >
          {t("admin_payments.clear_filters")}
        </button>
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-3xl border border-gray-100 bg-white dark:border-slate-800 dark:bg-slate-900 lg:block">
        {loading ? (
          <div className="divide-y divide-gray-50 dark:divide-slate-800">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-6 py-5 animate-pulse">
                <div className="h-3 w-28 rounded-md bg-gray-200 dark:bg-slate-700" />
                <div className="h-3 w-32 rounded-md bg-gray-100 dark:bg-slate-800" />
                <div className="ml-auto h-3 w-20 rounded-md bg-gray-200 dark:bg-slate-700" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-20 text-center">
            <p className="text-sm font-semibold text-gray-400">{t("admin_payments.no_data")}</p>
            <p className="mt-1 text-[11px] text-gray-400">{t("admin_payments.empty_desc")}</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto scrollbar-custom">
              <table className="w-full min-w-[900px] text-left">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50 text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:border-slate-800 dark:bg-slate-800/50 dark:text-gray-500">
                    <th className="px-2 py-3">{t("admin_payments.order_ref")}</th>
                    <th className="px-2 py-3">{t("admin_payments.house")}</th>
                    <th className="px-2 py-3">{t("admin_payments.method")}</th>
                    <th className="px-2 py-3">{t("admin_payments.amount")}</th>
                    <th className="px-2 py-3">{t("admin_payments.submitted_at")}</th>
                    <th className="px-2 py-3">{t("admin_payments.status")}</th>
                    <th className="px-2 py-3 text-right">{t("admin_payments.actions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                  {rows.map((p) => (
                    <tr
                      key={p.id}
                      onClick={() => toggleExpand(p.id)}
                      className="cursor-pointer transition-colors hover:bg-gray-50/30 dark:hover:bg-slate-800/30"
                    >
                      <td className="px-2 py-1">
                        <div className="px-2 py-3">
                          <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
                            {p.invoice_no || `#${p.invoice_id}`}
                          </p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">
                            #{p.id} · {p.plan_name || "—"}
                          </p>
                        </div>
                      </td>
                      <td className="px-2 py-1">
                        <div className="px-2 py-3">
                          <p className="text-sm text-gray-700 dark:text-gray-200">{p.house_name || "—"}</p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">{p.house_code || ""}</p>
                        </div>
                      </td>
                      <td className="px-2 py-1">
                        <div className="px-2 py-3">
                          <p className="text-sm capitalize text-gray-700 dark:text-gray-200">{p.method || p.gateway}</p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">{p.reference || p.gateway_tran_id}</p>
                        </div>
                      </td>
                      <td className="px-2 py-1">
                        <div className="px-2 py-3">
                          <p className="text-sm font-bold text-gray-900 dark:text-gray-100">{fmtMoney(p.amount)}</p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">
                            {t("admin_payments.expected")}: {fmtMoney(p.expected_amount)}
                          </p>
                        </div>
                      </td>
                      <td className="px-2 py-1">
                        <div className="px-2 py-3 text-sm text-gray-600 dark:text-gray-300">
                          {fmtDateTime12(p.submitted_at || p.created_at)}
                        </div>
                      </td>
                      <td className="px-2 py-1">
                        <div className="px-2 py-3">
                          <Badge status={p.status} />
                        </div>
                      </td>
                      <td className="px-2 py-1">
                        <div className="flex items-center justify-end gap-2 px-2 py-3">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openProof(p);
                            }}
                            disabled={!p.has_proof || proofBusy === p.id}
                            aria-label={t("admin_payments.view_proof")}
                            className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-gray-300 dark:hover:bg-slate-800"
                          >
                            {proofBusy === p.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Paperclip className="h-3.5 w-3.5" />
                            )}
                          </button>
                          <ChevronDown
                            className={`h-4 w-4 text-gray-400 transition-transform ${
                              expandedId === p.id ? "rotate-180" : ""
                            }`}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {expandedId && rows.some((r) => r.id === expandedId) ? (
              <div>{detailPanel(rows.find((r) => r.id === expandedId)!)}</div>
            ) : null}
          </>
        )}

        <div className="flex items-center justify-between border-t border-gray-100 p-4 dark:border-slate-800">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t("users.showing_results", {
              start: rows.length === 0 ? 0 : (page - 1) * perPage + 1,
              end: (page - 1) * perPage + rows.length,
              total,
            })}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="cursor-pointer rounded-lg border border-gray-200 p-2 text-gray-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-800 dark:text-gray-300"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs text-gray-500">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= totalPages}
              className="cursor-pointer rounded-lg border border-gray-200 p-2 text-gray-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-800 dark:text-gray-300"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Mobile accordion */}
      <div className="divide-y divide-gray-50 overflow-hidden rounded-3xl border border-gray-100 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900 lg:hidden">
        {loading
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-4 animate-pulse">
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-28 rounded-md bg-gray-200 dark:bg-slate-700" />
                  <div className="h-2.5 w-20 rounded-md bg-gray-100 dark:bg-slate-800" />
                </div>
                <div className="h-4 w-16 rounded-md bg-gray-100 dark:bg-slate-800" />
              </div>
            ))
          : rows.map((p) => (
              <div key={p.id}>
                <button
                  type="button"
                  onClick={() => toggleExpand(p.id)}
                  className="flex min-h-[44px] w-full cursor-pointer items-center gap-3 px-4 py-3.5"
                >
                  <div className="flex-1 text-left">
                    <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
                      {p.invoice_no || `#${p.invoice_id}`}
                    </p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      {p.house_name || "—"} · {p.method || p.gateway} · {fmtMoney(p.amount)}
                    </p>
                  </div>
                  <Badge status={p.status} />
                  <ChevronDown
                    className={`h-4 w-4 text-gray-400 transition-transform ${
                      expandedId === p.id ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {expandedId === p.id && detailPanel(p)}
              </div>
            ))}
        <div className="flex items-center justify-between border-t border-gray-100 p-4 dark:border-slate-800">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {page} / {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="cursor-pointer rounded-lg border border-gray-200 p-2 text-gray-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-800 dark:text-gray-300"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= totalPages}
              className="cursor-pointer rounded-lg border border-gray-200 p-2 text-gray-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-800 dark:text-gray-300"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <ConfirmationModal
        isOpen={!!approveTarget}
        onClose={() => setApproveTarget(null)}
        onConfirm={approvePayment}
        type="info"
        title={t("admin_payments.approve")}
        message={t("admin_payments.approve_confirm", { id: approveTarget?.id ?? "" })}
        confirmText={t("admin_payments.approve")}
        loading={busy}
      />
      <ConfirmationModal
        isOpen={!!rejectTarget}
        onClose={() => {
          setRejectTarget(null);
          setRejectReason("");
        }}
        onConfirm={rejectPayment}
        type="danger"
        title={t("admin_payments.reject")}
        message={t("admin_payments.reject_confirm", { id: rejectTarget?.id ?? "" })}
        confirmText={t("admin_payments.reject")}
        loading={busy}
        confirmDisabled={reasonInvalid(rejectReason)}
      >
        <textarea
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          rows={2}
          maxLength={500}
          required
          minLength={3}
          placeholder={t("admin_payments.reason_placeholder")}
          className="mt-4 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100"
        />
        <p className="mt-1.5 w-full text-left text-[11px] text-gray-500 dark:text-gray-400">
          {t("admin_payments.reason_required_hint")}
        </p>
      </ConfirmationModal>
      <ConfirmationModal
        isOpen={!!infoTarget}
        onClose={() => {
          setInfoTarget(null);
          setInfoReason("");
        }}
        onConfirm={requestInfo}
        type="warning"
        title={t("admin_payments.request_info")}
        message={t("admin_payments.request_info_confirm", { id: infoTarget?.id ?? "" })}
        confirmText={t("admin_payments.request_info")}
        loading={busy}
        confirmDisabled={reasonInvalid(infoReason)}
      >
        <textarea
          value={infoReason}
          onChange={(e) => setInfoReason(e.target.value)}
          rows={2}
          maxLength={500}
          required
          minLength={3}
          placeholder={t("admin_payments.reason_placeholder")}
          className="mt-4 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100"
        />
        <p className="mt-1.5 w-full text-left text-[11px] text-gray-500 dark:text-gray-400">
          {t("admin_payments.reason_required_hint")}
        </p>
      </ConfirmationModal>

      <ConfirmationModal
        isOpen={!!refundTarget}
        onClose={() => {
          setRefundTarget(null);
          setRefundReason("");
        }}
        onConfirm={submitRefund}
        type="warning"
        title={t("admin_payments.record_refund")}
        message={t("admin_payments.refund_confirm", { id: refundTarget?.id ?? "" })}
        confirmText={t("admin_payments.record_refund")}
        loading={busy}
        confirmDisabled={refundReason.trim().length < 3}
      >
        <input
          type="number"
          min="0"
          step="0.01"
          value={refundAmount}
          onChange={(e) => setRefundAmount(e.target.value)}
          placeholder={t("admin_payments.refund_amount")}
          className="mt-4 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100"
        />
        <textarea
          value={refundReason}
          onChange={(e) => setRefundReason(e.target.value)}
          rows={2}
          maxLength={500}
          required
          minLength={3}
          placeholder={t("admin_payments.refund_reason")}
          className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100"
        />
        <p className="mt-1.5 w-full text-left text-[11px] text-gray-500 dark:text-gray-400">
          {t("admin_payments.refund_note")}
        </p>
      </ConfirmationModal>

      <ConfirmationModal
        isOpen={!!completeRefundTarget}
        onClose={() => setCompleteRefundTarget(null)}
        onConfirm={completeRefund}
        type="info"
        title={t("admin_payments.complete_refund")}
        message={t("admin_payments.complete_refund_confirm")}
        confirmText={t("admin_payments.complete_refund")}
        loading={busy}
      />

      <ConfirmationModal
        isOpen={!!rejectRefundTarget}
        onClose={() => {
          setRejectRefundTarget(null);
          setRefundRejectReason("");
        }}
        onConfirm={rejectRefund}
        type="danger"
        title={t("admin_payments.fail_refund")}
        message={t("admin_payments.fail_refund_confirm")}
        confirmText={t("admin_payments.fail_refund")}
        loading={busy}
        confirmDisabled={refundRejectReason.trim().length < 3}
      >
        <textarea
          value={refundRejectReason}
          onChange={(e) => setRefundRejectReason(e.target.value)}
          rows={2}
          maxLength={500}
          required
          minLength={3}
          placeholder={t("admin_payments.reason_placeholder")}
          className="mt-4 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100"
        />
      </ConfirmationModal>
    </div>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</p>
      <p className="mt-0.5 truncate text-xs font-semibold text-gray-800 dark:text-gray-200">{value}</p>
    </div>
  );
}
