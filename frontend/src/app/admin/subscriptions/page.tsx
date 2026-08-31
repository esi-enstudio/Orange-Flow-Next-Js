"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight, Loader2, Plus, Search, Settings2 } from "lucide-react";
import { toast } from "react-hot-toast";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import PageGuideModal from "@/components/PageGuideModal";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import type { Paginated } from "@/types/billing";

interface AdminSub {
  id: number;
  house: { id: number; name?: string; code?: string };
  plan?: string | null;
  slug?: string | null;
  status: string;
  billing_interval: string;
  currency: string;
  current_period_start?: string | null;
  current_period_end?: string | null;
  trial_end?: string | null;
  grace_period_end?: string | null;
  auto_renew: boolean;
  cancel_at_period_end: boolean;
  created_at?: string | null;
}

interface SubDetail extends AdminSub {
  invoices: Array<{
    id: number;
    invoice_no: string;
    total: number;
    currency: string;
    status: string;
    due_date?: string | null;
    paid_at?: string | null;
    billing_period_start?: string | null;
    billing_period_end?: string | null;
  }>;
  payments: Array<{
    id: number;
    amount: number;
    currency: string;
    status: string;
    gateway_tran_id?: string | null;
    paid_at?: string | null;
  }>;
}

const STATUSES = ["trialing", "active", "past_due", "cancelled", "expired", "paused"];
const STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400",
  trialing: "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400",
  paid: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400",
  issued: "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400",
  unpaid: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400",
  past_due: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400",
  pending: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400",
  expired: "bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-400",
  cancelled: "bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-400",
  paused: "bg-purple-50 text-purple-600 dark:bg-purple-500/10 dark:text-purple-400",
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

export default function AdminSubscriptionsPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const { hasPermission, loading: authLoading } = useAuth();

  const [rows, setRows] = useState<AdminSub[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Record<number, SubDetail>>({});
  const [detailLoading, setDetailLoading] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<{ kind: string; subId?: number; invNo?: string; invId?: number; status?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const canView = hasPermission("subscription.manage");
  const canManage = hasPermission("billing.manage");

  const buildQuery = useCallback(() => {
    const p = new URLSearchParams();
    p.set("page", String(page));
    p.set("per_page", "10");
    if (search) p.set("search", search);
    if (status) p.set("status", status);
    return p.toString();
  }, [page, search, status]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get(`v1/admin/subscriptions?${buildQuery()}`);
      setRows((res.data as Paginated<AdminSub>).data || []);
      setTotal(res.data.pagination?.total || 0);
      setTotalPages(res.data.pagination?.total_pages || 1);
    } catch (err: any) {
      toast.error(err?.message || t("pricing.something_went_wrong"));
    } finally {
      setLoading(false);
    }
  }, [buildQuery, t]);

  useEffect(() => {
    if (authLoading) return;
    if (!hasPermission("subscription.manage")) {
      const timer = setTimeout(() => router.push("/"), 5000);
      return () => clearTimeout(timer);
    }
    fetchRows();
  }, [authLoading, hasPermission, fetchRows, router]);

  const loadDetail = async (id: number) => {
    if (detail[id]) return;
    setDetailLoading(id);
    try {
      const res = await apiClient.get(`v1/admin/subscriptions/${id}`);
      setDetail((d) => ({ ...d, [id]: res.data.data }));
    } catch (err: any) {
      toast.error(err?.message || t("pricing.something_went_wrong"));
    } finally {
      setDetailLoading(null);
    }
  };

  const toggleExpand = (id: number) => {
    setExpandedId((prev) => (prev === id ? null : id));
    loadDetail(id);
  };

  const markPaid = async () => {
    if (!confirm?.invId) return;
    setBusy(true);
    try {
      await apiClient.post(`v1/admin/invoices/${confirm.invId}/mark-paid`, {});
      toast.success(t("subscriptions.toast_success"));
      setConfirm(null);
      setDetail({});
      await fetchRows();
    } catch (err: any) {
      toast.error(err?.message || t("pricing.something_went_wrong"));
    } finally {
      setBusy(false);
    }
  };

  const patchStatus = async (subId: number, next: string) => {
    setBusy(true);
    try {
      await apiClient.patch(`v1/admin/subscriptions/${subId}`, { status: next });
      toast.success(t("subscriptions.status_saved"));
      setDetail({});
      await fetchRows();
    } catch (err: any) {
      toast.error(err?.message || t("pricing.something_went_wrong"));
    } finally {
      setBusy(false);
    }
  };

  if (!authLoading && !canView) {
    return <AccessDenied />;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t("subscriptions.title")}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 transition-colors">{t("subscriptions.description")}</p>
        </div>
        <div className="flex items-center gap-3">
          <PageGuideModal pageKey="subscriptions" />
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={t("subscriptions.search_placeholder")}
            className="w-full h-11 pl-10 pr-4 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm text-gray-700 dark:text-gray-200"
          />
        </div>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="h-11 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 text-sm text-gray-700 dark:text-gray-200"
        >
          <option value="">{t("subscriptions.all_statuses")}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {/* Desktop table */}
      <div className="hidden lg:block rounded-3xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 overflow-hidden">
        {loading ? (
          <div className="divide-y divide-gray-50 dark:divide-slate-800">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-6 py-5 animate-pulse">
                <div className="w-10 h-10 rounded-xl bg-gray-200 dark:bg-slate-700 shrink-0" />
                <div className="space-y-2 flex-1">
                  <div className="h-3 w-40 bg-gray-200 dark:bg-slate-700 rounded-md" />
                  <div className="h-2.5 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
                </div>
                <div className="hidden md:block flex-1 space-y-2">
                  <div className="h-3 w-20 bg-gray-200 dark:bg-slate-700 rounded-md" />
                  <div className="h-2.5 w-16 bg-gray-100 dark:bg-slate-800 rounded-md" />
                </div>
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-20 text-center">
            <p className="text-sm font-semibold text-gray-400">{t("subscriptions.no_data")}</p>
            <p className="text-[11px] text-gray-400 mt-1">{t("subscriptions.empty_desc")}</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto scrollbar-custom">
              <table className="w-full text-left min-w-[900px]">
                <thead>
                  <tr className="bg-gray-50/50 dark:bg-slate-800/50 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest border-b border-gray-100 dark:border-slate-800">
                    <th className="px-6 py-4">{t("subscriptions.detail")}</th>
                    <th className="px-6 py-4">{t("subscriptions.house")}</th>
                    <th className="px-6 py-4">{t("subscriptions.plan")}</th>
                    <th className="px-6 py-4">{t("subscriptions.status")}</th>
                    <th className="px-6 py-4">{t("subscriptions.period")}</th>
                    <th className="px-6 py-4">{t("subscriptions.interval")}</th>
                    <th className="px-6 py-4">{t("subscriptions.auto_renew")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                  {rows.map((s) => (
                    <tr
                      key={s.id}
                      className="hover:bg-gray-50/30 dark:hover:bg-slate-800/30 transition-colors cursor-pointer"
                      onClick={() => toggleExpand(s.id)}
                    >
                      <td className="px-6 py-4">
                        {detailLoading === s.id ? (
                          <Loader2 className="w-4 h-4 text-primary-500 animate-spin" />
                        ) : (
                          <ChevronDown
                            className={`w-4 h-4 text-gray-400 transition-transform ${expandedId === s.id ? "rotate-180" : ""}`}
                          />
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <p className="font-bold text-gray-900 dark:text-gray-100 text-sm">{s.house.name || `#${s.house.id}`}</p>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">{s.house.code}</p>
                      </td>
                      <td className="px-6 py-4">
                        <p className="font-bold text-gray-900 dark:text-gray-100 text-sm">{s.plan || "—"}</p>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">{s.slug}</p>
                      </td>
                      <td className="px-6 py-4">
                        <Badge status={s.status} />
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">
                        {fmtDate(s.current_period_start)} → {fmtDate(s.current_period_end)}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{s.billing_interval}</td>
                      <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-300">{s.auto_renew ? "ON" : "OFF"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {expandedId && detail[expandedId] && (
              <SubDetailPanel
                d={detail[expandedId]}
                canManage={canManage}
                onMarkPaid={(invId, invNo) => setConfirm({ kind: "mark_paid", invId, invNo })}
                onStatus={(next) => setConfirm({ kind: "status", subId: expandedId, status: next })}
              />
            )}
          </>
        )}

        {/* Pagination */}
        <div className="p-4 border-t border-gray-100 dark:border-slate-800 flex items-center justify-between">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t("users.showing_results", {
              start: rows.length === 0 ? 0 : (page - 1) * 10 + 1,
              end: (page - 1) * 10 + rows.length,
              total,
            })}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-2 rounded-lg border border-gray-200 dark:border-slate-800 text-gray-600 dark:text-gray-300 disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs text-gray-500">{page} / {totalPages}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= totalPages}
              className="p-2 rounded-lg border border-gray-200 dark:border-slate-800 text-gray-600 dark:text-gray-300 disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Mobile accordion */}
      <div className="lg:hidden rounded-3xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 overflow-hidden divide-y divide-gray-50 dark:divide-slate-800">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-4 animate-pulse">
                <div className="w-9 h-9 rounded-xl bg-gray-200 dark:bg-slate-700 shrink-0" />
                <div className="space-y-2 flex-1">
                  <div className="h-3 w-28 bg-gray-200 dark:bg-slate-700 rounded-md" />
                  <div className="h-2.5 w-20 bg-gray-100 dark:bg-slate-800 rounded-md" />
                </div>
              </div>
            ))
          : rows.map((s) => (
              <div key={s.id}>
                <button
                  onClick={() => toggleExpand(s.id)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 min-h-[44px]"
                >
                  <div className="flex-1 text-left">
                    <p className="font-bold text-gray-900 dark:text-gray-100 text-sm">{s.house.name || `#${s.house.id}`}</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      {s.plan || "—"} · {s.billing_interval}
                    </p>
                  </div>
                  <Badge status={s.status} />
                  <ChevronDown
                    className={`w-4 h-4 text-gray-400 transition-transform ${expandedId === s.id ? "rotate-180" : ""}`}
                  />
                </button>
                {expandedId === s.id && (
                  <div className="px-4 pb-4 space-y-3">
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      {fmtDate(s.current_period_start)} → {fmtDate(s.current_period_end)} · {t("subscriptions.auto_renew")}:{" "}
                      {s.auto_renew ? "ON" : "OFF"}
                    </p>
                    {detail[expandedId] && (
                      <SubDetailPanel
                        d={detail[expandedId]}
                        canManage={canManage}
                        onMarkPaid={(invId, invNo) => setConfirm({ kind: "mark_paid", invId, invNo })}
                        onStatus={(next) => setConfirm({ kind: "status", subId: expandedId, status: next })}
                      />
                    )}
                  </div>
                )}
              </div>
            ))}
      </div>

      <ConfirmationModal
        isOpen={confirm?.kind === "mark_paid"}
        onClose={() => setConfirm(null)}
        onConfirm={markPaid}
        type="info"
        title={t("subscriptions.mark_paid")}
        message={t("subscriptions.mark_paid_confirm", { no: confirm?.invNo || "" })}
        confirmText={t("subscriptions.mark_paid")}
        loading={busy}
      />
      <ConfirmationModal
        isOpen={confirm?.kind === "status"}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm?.subId && confirm?.status && patchStatus(confirm.subId, confirm.status)}
        type="warning"
        title={t("subscriptions.edit_status")}
        message={`${t("subscriptions.edit_status")}: ${confirm?.status}`}
        confirmText={t("subscriptions.btn_update")}
        loading={busy}
      />
    </div>
  );
}

function SubDetailPanel({
  d,
  canManage,
  onMarkPaid,
  onStatus,
}: {
  d: SubDetail;
  canManage: boolean;
  onMarkPaid: (invId: number, invNo: string) => void;
  onStatus: (next: string) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="px-6 py-5 border-t border-gray-100 dark:border-slate-800 bg-gray-50/40 dark:bg-slate-800/30">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          #{d.id} · {d.house.name}
        </p>
        {canManage && (
          <div className="flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-gray-400" />
            <select
              value={d.status}
              onChange={(e) => onStatus(e.target.value)}
              className="h-9 rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-2 text-xs text-gray-700 dark:text-gray-200"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">{t("subscriptions.invoices")}</p>
          {d.invoices.length === 0 ? (
            <p className="text-xs text-gray-400">—</p>
          ) : (
            <div className="space-y-2">
              {d.invoices.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 dark:border-slate-800 px-3 py-2.5 bg-white dark:bg-slate-900">
                  <div>
                    <p className="text-xs font-bold text-gray-900 dark:text-gray-100">{inv.invoice_no}</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      {fmtDate(inv.billing_period_start)} → {fmtDate(inv.billing_period_end)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-bold text-gray-900 dark:text-gray-100">{fmtMoney(inv.total)}</p>
                    <Badge status={inv.status} />
                    {canManage && inv.status !== "paid" && inv.status !== "void" && (
                      <button
                        onClick={() => onMarkPaid(inv.id, inv.invoice_no)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 min-h-[36px] bg-emerald-600 text-white rounded-lg text-[11px] font-bold hover:bg-emerald-700 transition-colors"
                      >
                        <Plus className="w-3 h-3" /> {t("subscriptions.mark_paid")}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">{t("subscriptions.payments")}</p>
          {d.payments.length === 0 ? (
            <p className="text-xs text-gray-400">—</p>
          ) : (
            <div className="space-y-2">
              {d.payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 dark:border-slate-800 px-3 py-2.5 bg-white dark:bg-slate-900">
                  <div>
                    <p className="text-xs font-bold text-gray-900 dark:text-gray-100">{fmtMoney(p.amount)}</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">{p.gateway_tran_id || "—"}</p>
                  </div>
                  <Badge status={p.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}