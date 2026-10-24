"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  Download,
  Loader2,
  Pencil,
  Receipt,
  RefreshCw,
  Trash2,
  Wallet,
} from "lucide-react";
import { toast } from "react-hot-toast";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useEntitlements } from "@/context/EntitlementsContext";
import { useLanguage } from "@/i18n/useLanguage";
import PageGuideModal from "@/components/PageGuideModal";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import PaymentRequestModal from "./_components/PaymentRequestModal";
import type {
  Subscription,
  Invoice,
  Payment,
  PaymentMethod,
  HouseOption,
  Paginated,
  BillingOverview,
} from "@/types/billing";

const STATUS_BADGE: Record<string, string> = {
  paid: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400",
  issued: "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400",
  unpaid: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400",
  past_due: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400",
  cancelled: "bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-400",
  void: "bg-gray-100 text-gray-400 dark:bg-slate-800 dark:text-slate-500",
  needs_info: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400",
  pending: "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400",
  failed: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400",
  succeeded: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400",
};

function Badge({ status }: { status?: string | null }) {
  const s = status || "unknown";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold capitalize ${
        STATUS_BADGE[s] || "bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-400"
      }`}
    >
      {s.replace("_", " ")}
    </span>
  );
}

const fmtDate = (v?: string | null) => (v ? String(v).slice(0, 10) : "—");
const fmtMoney = (n: number) => `৳${Number(n).toLocaleString()}`;

// "24 Oct 2026, 07:15 PM" — tenants read the review note with its timestamp.
const fmtDateTime12 = (v?: string | null) => {
  if (!v) return "";
  const parsed = new Date(String(v));
  if (Number.isNaN(parsed.getTime())) return "";
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

export default function BillingPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const { hasPermission, loading: authLoading, selectedHouse } = useAuth();
  const { refresh: refreshEntitlements } = useEntitlements();

  const [houses, setHouses] = useState<HouseOption[]>([]);
  const [houseId, setHouseId] = useState<number | null>(selectedHouse?.id ?? null);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [overview, setOverview] = useState<BillingOverview | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [action, setAction] = useState<{ kind: string; id?: number; no?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState<number | null>(null);
  const [requestInvoice, setRequestInvoice] = useState<Invoice | null>(null);
  const [editingMethodId, setEditingMethodId] = useState<number | null>(null);

  // Payment method form
  const [methodForm, setMethodForm] = useState({
    method_type: "bank",
    label: "",
    bank_name: "",
    account_name: "",
    account_number: "",
    routing_number: "",
    bkash_number: "",
    nagad_number: "",
    instructions: "",
  });

  const canView = useMemo(
    () => ["subscription.view", "billing.view", "payments.view"].some(hasPermission),
    [hasPermission]
  );
  const canAct = useMemo(
    () =>
      ["subscription.renew", "subscription.cancel", "subscription.edit", "subscription.upgrade"].some(hasPermission),
    [hasPermission]
  );

  const houseHeader = useMemo(
    () => (houseId ? { "X-House-ID": String(houseId) } : {}),
    [houseId]
  );

  const loadHouses = useCallback(async () => {
    try {
      const res = await apiClient.get("houses/accessible");
      const list: HouseOption[] = res.data || [];
      setHouses(list);
      if (!houseId && list.length > 0) setHouseId(selectedHouse?.id ?? list[0].id);
    } catch {
      /* ignore */
    }
  }, [houseId, selectedHouse]);

  const loadData = useCallback(async () => {
    if (!houseId) return;
    setLoading(true);
    try {
      const headers = { "X-House-ID": String(houseId) };
      const [subRes, ovRes, invRes, payRes, methRes] = await Promise.all([
        apiClient.get("v1/subscription/current", { headers }).catch(() => ({ data: null })),
        apiClient.get("v1/billing/overview", { headers }).catch(() => ({ data: null })),
        apiClient.get("v1/billing/invoices", { headers }).catch(() => ({ data: { data: [], pagination: {} } })),
        apiClient.get("v1/billing/payments", { headers }).catch(() => ({ data: { data: [], pagination: {} } })),
        apiClient.get("v1/billing/payment-methods", { headers }).catch(() => ({ data: { data: [] } })),
      ]);
      const subData = subRes.data;
      setSub(subData && typeof subData === "object" && Object.keys(subData).length ? subData : null);
      setOverview(ovRes.data?.data || null);
      setInvoices((invRes.data as Paginated<Invoice>)?.data || []);
      setPayments((payRes.data as Paginated<Payment>)?.data || []);
      setMethods((methRes.data as { data: PaymentMethod[] })?.data || []);
    } finally {
      setLoading(false);
    }
  }, [houseId]);

  useEffect(() => {
    if (authLoading) return;
    loadHouses();
  }, [authLoading, loadHouses]);

  useEffect(() => {
    if (authLoading) return;
    loadData();
  }, [authLoading, houseId, loadData]);

  useEffect(() => {
    if (!authLoading && !canView) {
      const timer = setTimeout(() => router.push("/"), 5000);
      return () => clearTimeout(timer);
    }
  }, [authLoading, canView, router]);

  const runAction = async (
    path: string,
    body: Record<string, unknown>,
    successMsg: string
  ) => {
    setBusy(true);
    try {
      await apiClient.post(path, body, { headers: houseHeader });
      toast.success(successMsg);
      setAction(null);
      await loadData();
      // Select / renew / cancel all change what the house is entitled to.
      void refreshEntitlements();
    } catch (err: any) {
      toast.error(err?.message || t("pricing.something_went_wrong"));
    } finally {
      setBusy(false);
    }
  };

  const handleInvoicePdf = async (invoice: Invoice) => {
    setPdfBusy(invoice.id);
    try {
      const res = await apiClient.get(`v1/billing/invoices/${invoice.id}/pdf`, {
        headers: houseHeader,
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(
        new Blob([res.data], { type: "application/pdf" })
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `${invoice.invoice_no}.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      // Error bodies arrive as a Blob because of responseType: "blob".
      let message = t("common.error");
      const data = err?.response?.data;
      if (data instanceof Blob) {
        try {
          const parsed = JSON.parse(await data.text());
          message = parsed?.detail || parsed?.error?.message || message;
        } catch {
          /* keep the generic message */
        }
      } else if (data?.detail) {
        message = data.detail;
      }
      toast.error(message);
    } finally {
      setPdfBusy(null);
    }
  };

  const pendingPaymentFor = (invoiceId: number) =>
    payments.find((p) => p.invoice_id === invoiceId && p.status === "pending") || null;
  const canRequestPayment = hasPermission("billing.request_payment");
  const isPayable = (inv: Invoice) => inv.status === "issued" || inv.status === "unpaid";

  const activeActions = useMemo(() => {
    if (!sub) return { show: [] as string[] };
    const s = sub.status;
    const show: string[] = [];
    if (s === "active" || s === "trialing") {
      show.push("renew", "cancel");
    }
    if (s === "paused") show.push("resume");
    if (s === "active" || s === "trialing") show.push("pause");
    if (s === "cancelled" || s === "expired") show.push("reactivate");
    return { show };
  }, [sub]);

  if (!authLoading && !canView) {
    return <AccessDenied />;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t("billing.title")}</h1>
            <PageGuideModal pageKey="billing" />
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 transition-colors">{t("billing.description")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={houseId ?? ""}
            onChange={(e) => setHouseId(e.target.value ? Number(e.target.value) : null)}
            className="h-10 rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 text-sm text-gray-700 dark:text-gray-200"
          >
            {houses.length === 0 && <option value="">{t("billing.select_house_first")}</option>}
            {houses.map((h) => (
              <option key={h.id} value={h.id}>
                {h.display_name || `${h.name} (${h.code})`}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!houseId ? (
        <div className="rounded-2xl border border-amber-200 dark:border-slate-800 bg-amber-50 dark:bg-slate-900 p-8 text-center text-amber-600 dark:text-amber-400 text-sm font-semibold">
          {t("billing.select_house_first")}
        </div>
      ) : loading ? (
        <div className="space-y-6">
          <div className="rounded-3xl border border-gray-100 dark:border-slate-800 p-6 animate-pulse space-y-4">
            <div className="h-5 w-40 bg-gray-200 dark:bg-slate-700 rounded-md" />
            <div className="h-4 w-64 bg-gray-100 dark:bg-slate-800 rounded-md" />
            <div className="flex gap-3">
              {[0, 1, 2].map((n) => (
                <div key={n} className="h-10 w-28 bg-gray-200 dark:bg-slate-700 rounded-xl" />
              ))}
            </div>
          </div>
          {[0, 1, 2, 3, 4].map((n) => (
            <div key={n} className="flex items-center gap-4 px-6 py-5 animate-pulse">
              <div className="w-10 h-10 rounded-xl bg-gray-200 dark:bg-slate-700 shrink-0" />
              <div className="space-y-2 flex-1">
                <div className="h-3 w-32 bg-gray-200 dark:bg-slate-700 rounded-md" />
                <div className="h-2.5 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
              </div>
              <div className="hidden sm:block flex-1 space-y-2">
                <div className="h-3 w-20 bg-gray-200 dark:bg-slate-700 rounded-md" />
                <div className="h-2.5 w-16 bg-gray-100 dark:bg-slate-800 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* Overview cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {[
              { label: t("billing.overview"), value: overview?.effective_status || "—", icon: Building2 },
              { label: t("billing.plan"), value: overview?.plan_name || "—", icon: Receipt },
              { label: t("billing.outstanding"), value: fmtMoney(overview?.amount_due_now || 0), icon: Wallet },
              { label: t("billing.next_billing_date"), value: fmtDate(overview?.next_billing_date), icon: CreditCard },
            ].map((c) => (
              <div
                key={c.label}
                className="rounded-2xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 p-5"
              >
                <c.icon className="w-5 h-5 text-primary-500 mb-3" />
                <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider">{c.label}</p>
                <p className="text-lg font-bold text-gray-900 dark:text-gray-100 capitalize mt-1">{c.value}</p>
              </div>
            ))}
          </div>

          {/* No plan assigned — access is deny-by-default, so give the tenant a
              one-click route into the plan catalogue instead of a dead end. */}
          {!sub && (
            <div className="rounded-3xl border border-amber-200 bg-amber-50/70 p-6 dark:border-amber-500/30 dark:bg-amber-500/5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="flex flex-1 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400">
                    <CreditCard className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
                      {t("billing.no_plan_title")}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-gray-600 dark:text-gray-400">
                      {t("billing.no_plan_hint")}
                    </p>
                  </div>
                </div>
                <a
                  href="/pricing"
                  className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
                >
                  {t("billing.choose_plan")}
                </a>
              </div>
            </div>
          )}

          {/* Current subscription + actions */}
          {sub && (
            <div className="rounded-3xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 p-6">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    {t("billing.current_subscription")}
                    <Badge status={sub.effective_status || sub.status} />
                  </p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                    {sub.package?.name || "—"} · {sub.billing_interval} ·{" "}
                    {fmtDate(sub.start_date)} → {fmtDate(sub.end_date)}
                  </p>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
                    {t("billing.auto_renew")}: {sub.auto_renew ? "ON" : "OFF"} · {t("billing.next_billing_date")}:{" "}
                    {fmtDate(sub.current_period_end || sub.end_date)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {activeActions.show.includes("renew") && (
                    <button
                      onClick={() => setAction({ kind: "renew" })}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-bold hover:bg-primary-700 transition-colors"
                    >
                      <RefreshCw className="w-4 h-4" /> {t("billing.renew")}
                    </button>
                  )}
                  {activeActions.show.includes("pause") && (
                    <button
                      onClick={() => setAction({ kind: "pause" })}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-bold hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                    >
                      {t("billing.pause")}
                    </button>
                  )}
                  {activeActions.show.includes("resume") && (
                    <button
                      onClick={() => setAction({ kind: "resume" })}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-bold hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                    >
                      {t("billing.resume")}
                    </button>
                  )}
                  {activeActions.show.includes("reactivate") && (
                    <button
                      onClick={() => setAction({ kind: "reactivate" })}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-bold hover:bg-primary-700 transition-colors"
                    >
                      {t("billing.reactivate")}
                    </button>
                  )}
                  {activeActions.show.includes("cancel") && (
                    <button
                      onClick={() => setAction({ kind: "cancel" })}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 rounded-lg text-sm font-bold hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors"
                    >
                      {t("billing.cancel")}
                    </button>
                  )}
                  {canAct && (
                    <a
                      href="/pricing"
                      className="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-200 rounded-lg text-sm font-bold hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                    >
                      {t("billing.change_plan_link")}
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            {/* Invoices / Payments */}
            <div className="xl:col-span-2 space-y-6">
              {/* Invoices */}
              <div className="rounded-3xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-800 flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-primary-500" />
                  <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{t("billing.invoices")}</h3>
                </div>
                <div className="px-6 py-3 border-b border-amber-100 dark:border-slate-800 bg-amber-50/70 dark:bg-amber-500/5">
                  <p className="text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
                    {t("billing.manual_payment_notice")}
                  </p>
                </div>

                {/* Desktop */}
                <div className="hidden lg:block overflow-x-auto scrollbar-custom">
                  <table className="w-full text-left min-w-[700px]">
                    <thead>
                      <tr className="bg-gray-50/50 dark:bg-slate-800/50 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest border-b border-gray-100 dark:border-slate-800">
                        <th className="px-6 py-4">{t("billing.invoice_no")}</th>
                        <th className="px-6 py-4">{t("billing.due_date")}</th>
                        <th className="px-6 py-4">{t("billing.total")}</th>
                        <th className="px-6 py-4">{t("billing.status")}</th>
                        <th className="px-6 py-4 text-right">{""}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                      {invoices.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-6 py-12 text-center text-gray-400 text-sm">
                            {t("billing.no_invoices")}
                          </td>
                        </tr>
                      )}
                      {invoices.map((inv) => (
                        <tr key={inv.id} className="hover:bg-gray-50/30 dark:hover:bg-slate-800/30 transition-colors">
                          <td className="px-6 py-4">
                            <p className="font-bold text-gray-900 dark:text-gray-100 text-sm">{inv.invoice_no}</p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">{inv.description}</p>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{fmtDate(inv.due_date)}</td>
                          <td className="px-6 py-4">
                            <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
                              {fmtMoney(inv.total)}
                              {inv.status === "paid" && (
                                <span className="ml-1 text-[11px] text-emerald-500">· {fmtDate(inv.paid_at)}</span>
                              )}
                            </p>
                          </td>
                          <td className="px-6 py-4">
                            <Badge status={inv.status} />
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="inline-flex flex-wrap items-center justify-end gap-2">
                              {isPayable(inv) && pendingPaymentFor(inv.id) && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400">
                                  {t("billing.pending_approval")}
                                </span>
                              )}
                              {isPayable(inv) && !pendingPaymentFor(inv.id) && canRequestPayment && (
                                <button
                                  onClick={() => setRequestInvoice(inv)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
                                >
                                  <Wallet className="w-3.5 h-3.5" />
                                  {t("billing.request_payment")}
                                </button>
                              )}
                              <button
                                onClick={() => handleInvoicePdf(inv)}
                                disabled={pdfBusy === inv.id}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-200 rounded-lg text-xs font-bold hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 cursor-pointer"
                              >
                                {pdfBusy === inv.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Download className="w-3.5 h-3.5" />
                                )}
                                {t("billing.invoice_pdf")}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile accordion */}
                <div className="lg:hidden divide-y divide-gray-50 dark:divide-slate-800">
                  {invoices.length === 0 && (
                    <div className="px-6 py-12 text-center text-gray-400 text-sm">{t("billing.no_invoices")}</div>
                  )}
                  {invoices.map((inv) => (
                    <div key={inv.id}>
                      <button
                        onClick={() => setExpandedId(expandedId === inv.id ? null : inv.id)}
                        className="w-full flex items-center gap-3 px-4 py-3.5 min-h-[44px]"
                      >
                        <div className="flex-1 text-left">
                          <p className="font-bold text-gray-900 dark:text-gray-100 text-sm">{inv.invoice_no}</p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">{fmtMoney(inv.total)} · {fmtDate(inv.due_date)}</p>
                        </div>
                        <Badge status={inv.status} />
                        <ChevronDown
                          className={`w-4 h-4 text-gray-400 transition-transform ${expandedId === inv.id ? "rotate-180" : ""}`}
                        />
                      </button>
                      <div
                        className={`overflow-hidden transition-all duration-200 px-4 pb-4 ${
                          expandedId === inv.id ? "max-h-[300px] opacity-100" : "max-h-0 opacity-0"
                        }`}
                      >
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">{inv.description}</p>
                        <div className="space-y-2">
                          {isPayable(inv) && pendingPaymentFor(inv.id) && (
                            <p className="text-[11px] font-bold text-amber-600 dark:text-amber-400">
                              {t("billing.pending_approval")}
                            </p>
                          )}
                          {isPayable(inv) && !pendingPaymentFor(inv.id) && canRequestPayment && (
                            <button
                              onClick={() => setRequestInvoice(inv)}
                              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 min-h-[44px] bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-bold cursor-pointer"
                            >
                              <Wallet className="w-4 h-4" />
                              {t("billing.request_payment")}
                            </button>
                          )}
                          <button
                            onClick={() => handleInvoicePdf(inv)}
                            disabled={pdfBusy === inv.id}
                            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 min-h-[44px] bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-200 rounded-xl text-sm font-bold disabled:opacity-50 cursor-pointer"
                          >
                            {pdfBusy === inv.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Download className="w-4 h-4" />
                            )}
                            {t("billing.invoice_pdf")}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Payments */}
              <div className="rounded-3xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-800 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">{t("billing.payments")}</h3>
                </div>
                {payments.length === 0 ? (
                  <div className="px-6 py-12 text-center text-gray-400 text-sm">{t("billing.no_payments")}</div>
                ) : (
                  <div className="overflow-x-auto scrollbar-custom">
                    <table className="w-full text-left min-w-[600px]">
                      <thead>
                        <tr className="bg-gray-50/50 dark:bg-slate-800/50 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest border-b border-gray-100 dark:border-slate-800">
                          <th className="px-6 py-4">{t("billing.gateway")}</th>
                          <th className="px-6 py-4">{t("billing.tran_id")}</th>
                          <th className="px-6 py-4">{t("billing.amount")}</th>
                          <th className="px-6 py-4">{t("billing.paid_at")}</th>
                          <th className="px-6 py-4">{t("billing.status")}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                        {payments.map((p) => (
                          <Fragment key={p.id}>
                          <tr className="hover:bg-gray-50/30 dark:hover:bg-slate-800/30 transition-colors">
                            <td className="px-6 py-4">
                              <p className="text-sm font-bold text-gray-900 dark:text-gray-100 capitalize">{p.gateway || "manual"}</p>
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
                              <p>{p.reference || p.gateway_tran_id || "—"}</p>
                              {p.invoice_no && (
                                <p className="text-[11px] text-gray-400 dark:text-gray-500">{p.invoice_no}</p>
                              )}
                              {p.status === "failed" && p.rejection_reason && (
                                <p className="text-[11px] text-red-500">{p.rejection_reason}</p>
                              )}
                            </td>
                            <td className="px-6 py-4 text-sm font-bold text-gray-900 dark:text-gray-100">{fmtMoney(p.amount)}</td>
                            <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{fmtDate(p.paid_at)}</td>
                            <td className="px-6 py-4">
                              <Badge status={p.status} />
                            </td>
                          </tr>
                          {p.status === "needs_info" && p.info_request_reason && (
                            <tr className="bg-amber-50/60 dark:bg-amber-500/5">
                              <td colSpan={5} className="px-2 py-1">
                                <div className="rounded-lg border border-amber-200/70 dark:border-amber-500/20 px-3 py-2.5">
                                  <p className="text-[11px] font-bold text-amber-700 dark:text-amber-400">
                                    {t("billing.needs_info_note_title")}
                                  </p>
                                  <p className="mt-0.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
                                    {p.info_request_reason}
                                  </p>
                                  <p className="mt-1 text-[10px] text-amber-600/80 dark:text-amber-400/70">
                                    {t("billing.needs_info_resubmit_hint")}
                                    {p.info_requested_at
                                      ? ` · ${fmtDateTime12(p.info_requested_at)}`
                                      : ""}
                                  </p>
                                </div>
                              </td>
                            </tr>
                          )}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Manual payment method */}
            <div className="space-y-6">
              <div className="rounded-3xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 p-6">
                <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-1">{t("billing.payment_method")}</h3>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-4">{t("billing.manual_pay_note")}</p>

                {methods.map((m) => (
                  <div key={m.id} className="mb-3 rounded-xl border border-gray-100 dark:border-slate-800 p-4 text-sm flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-gray-900 dark:text-gray-100 capitalize">{m.label || m.method_type}</p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                        {[m.bank_name, m.account_name, m.account_number, m.bkash_number || m.nagad_number]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {m.instructions && <p className="text-[11px] text-gray-400 mt-1">{m.instructions}</p>}
                    </div>
                    {hasPermission("billing.edit") && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingMethodId(m.id);
                            setMethodForm({
                              method_type: m.method_type || "bank",
                              label: m.label || "",
                              bank_name: m.bank_name || "",
                              account_name: m.account_name || "",
                              account_number: m.account_number || "",
                              routing_number: m.routing_number || "",
                              bkash_number: m.bkash_number || "",
                              nagad_number: m.nagad_number || "",
                              instructions: m.instructions || "",
                            });
                          }}
                          className="p-1.5 rounded-lg text-gray-500 hover:text-primary-600 hover:bg-gray-100 dark:hover:bg-slate-800 cursor-pointer"
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAction({ kind: "delete_method", id: m.id, no: m.label || m.method_type });
                          }}
                          className="p-1.5 rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-slate-800 cursor-pointer"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}

                {hasPermission("billing.edit") && (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setBusy(true);
                      try {
                        if (editingMethodId) {
                          await apiClient.put(`v1/billing/payment-methods/${editingMethodId}`, methodForm, { headers: houseHeader });
                          toast.success("Payment method updated successfully");
                        } else {
                          await apiClient.post("v1/billing/payment-methods", methodForm, { headers: houseHeader });
                          toast.success(t("billing.payment_method_saved"));
                        }
                        setEditingMethodId(null);
                        setMethodForm({
                          method_type: "bank",
                          label: "",
                          bank_name: "",
                          account_name: "",
                          account_number: "",
                          routing_number: "",
                          bkash_number: "",
                          nagad_number: "",
                          instructions: "",
                        });
                        await loadData();
                      } catch (err: any) {
                        toast.error(err?.message || t("pricing.something_went_wrong"));
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="space-y-3 mt-4 pt-4 border-t border-gray-100 dark:border-slate-800"
                  >
                    <select
                      value={methodForm.method_type}
                      onChange={(e) => setMethodForm({ ...methodForm, method_type: e.target.value })}
                      className="w-full h-10 rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 text-sm text-gray-700 dark:text-gray-200"
                    >
                      {["bank", "bkash", "nagad", "rocket", "card", "mobilebanking"].map((mt) => (
                        <option key={mt} value={mt}>
                          {mt}
                        </option>
                      ))}
                    </select>
                    <input
                      value={methodForm.label}
                      onChange={(e) => setMethodForm({ ...methodForm, label: e.target.value })}
                      placeholder="Label (e.g. Bank deposit)"
                      required
                      className="w-full h-10 rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 text-sm text-gray-700 dark:text-gray-200"
                    />
                    {methodForm.method_type === "bank" && (
                      <>
                        <input
                          value={methodForm.bank_name}
                          onChange={(e) => setMethodForm({ ...methodForm, bank_name: e.target.value })}
                          placeholder="Bank name"
                          className="w-full h-10 rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 text-sm text-gray-700 dark:text-gray-200"
                        />
                        <input
                          value={methodForm.account_name}
                          onChange={(e) => setMethodForm({ ...methodForm, account_name: e.target.value })}
                          placeholder="Account name"
                          className="w-full h-10 rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 text-sm text-gray-700 dark:text-gray-200"
                        />
                        <input
                          value={methodForm.account_number}
                          onChange={(e) => setMethodForm({ ...methodForm, account_number: e.target.value })}
                          placeholder="Account number"
                          className="w-full h-10 rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 text-sm text-gray-700 dark:text-gray-200"
                        />
                      </>
                    )}
                    {(methodForm.method_type === "bkash" || methodForm.method_type === "nagad") && (
                      <input
                        value={methodForm.bkash_number || methodForm.nagad_number}
                        onChange={(e) =>
                          setMethodForm({
                            ...methodForm,
                            bkash_number: methodForm.method_type === "bkash" ? e.target.value : methodForm.bkash_number,
                            nagad_number: methodForm.method_type === "nagad" ? e.target.value : methodForm.nagad_number,
                          })
                        }
                        placeholder={`${methodForm.method_type} number`}
                        className="w-full h-10 rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 text-sm text-gray-700 dark:text-gray-200"
                      />
                    )}
                    <textarea
                      value={methodForm.instructions}
                      onChange={(e) => setMethodForm({ ...methodForm, instructions: e.target.value })}
                      placeholder="Instructions"
                      rows={2}
                      className="w-full rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-gray-700 dark:text-gray-200"
                    />
                    <div className="flex items-center gap-2">
                      {editingMethodId && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingMethodId(null);
                            setMethodForm({
                              method_type: "bank",
                              label: "",
                              bank_name: "",
                              account_name: "",
                              account_number: "",
                              routing_number: "",
                              bkash_number: "",
                              nagad_number: "",
                              instructions: "",
                            });
                          }}
                          className="px-4 py-2.5 min-h-[44px] bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-bold hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                        >
                          Cancel
                        </button>
                      )}
                      <button
                        type="submit"
                        disabled={busy}
                        className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] bg-primary-600 text-white rounded-lg text-sm font-bold hover:bg-primary-700 transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
                        {editingMethodId ? "Update Payment Method" : t("billing.save_payment_method")}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      <PaymentRequestModal
        open={requestInvoice !== null}
        invoice={requestInvoice}
        houseId={houseId}
        onClose={() => setRequestInvoice(null)}
        onSubmitted={loadData}
      />

      {/* Confirmation modals */}
      <ConfirmationModal
        isOpen={action?.kind === "cancel"}
        onClose={() => setAction(null)}
        onConfirm={() =>
          runAction("v1/subscription/cancel", { reason: "", at_period_end: true }, t("billing.cancel"))
        }
        type="danger"
        title={t("billing.cancel")}
        message={t("billing.cancel_confirm")}
        confirmText={t("billing.cancel")}
        loading={busy}
      />
      <ConfirmationModal
        isOpen={action?.kind === "renew"}
        onClose={() => setAction(null)}
        onConfirm={() => {
          if (!hasPermission("subscription.renew")) {
            toast.error(t("pricing.something_went_wrong"));
            setAction(null);
            return;
          }
          runAction("v1/subscription/renew", {}, t("billing.renew"));
        }}
        type="info"
        title={t("billing.renew")}
        message={t("billing.renew_confirm")}
        confirmText={t("billing.renew")}
        loading={busy}
      />
      <ConfirmationModal
        isOpen={action?.kind === "reactivate"}
        onClose={() => setAction(null)}
        onConfirm={() => runAction("v1/subscription/reactivate", {}, t("billing.reactivate_invoice_created"))}
        type="info"
        title={t("billing.reactivate")}
        message={t("billing.reactivate_confirm")}
        confirmText={t("billing.reactivate")}
        loading={busy}
      />
      <ConfirmationModal
        isOpen={action?.kind === "pause"}
        onClose={() => setAction(null)}
        onConfirm={() => runAction("v1/subscription/pause", {}, t("billing.pause"))}
        type="info"
        title={t("billing.pause")}
        message={t("billing.pause_confirm")}
        confirmText={t("billing.pause")}
        loading={busy}
      />
      <ConfirmationModal
        isOpen={action?.kind === "delete_method"}
        onClose={() => setAction(null)}
        onConfirm={async () => {
          if (!action?.id) return;
          setBusy(true);
          try {
            await apiClient.delete(`v1/billing/payment-methods/${action.id}`, { headers: houseHeader });
            toast.success("Payment method deleted successfully");
            if (editingMethodId === action.id) {
              setEditingMethodId(null);
              setMethodForm({
                method_type: "bank",
                label: "",
                bank_name: "",
                account_name: "",
                account_number: "",
                routing_number: "",
                bkash_number: "",
                nagad_number: "",
                instructions: "",
              });
            }
            setAction(null);
            await loadData();
          } catch (err: any) {
            toast.error(err?.message || "Failed to delete payment method");
          } finally {
            setBusy(false);
          }
        }}
        type="danger"
        title="Delete Payment Method"
        message={`Are you sure you want to delete payment method "${action?.no || ""}"?`}
        confirmText="Delete"
        loading={busy}
      />
    </div>
  );
}