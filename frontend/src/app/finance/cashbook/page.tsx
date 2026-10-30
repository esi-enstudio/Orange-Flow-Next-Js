"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Wallet,
} from "lucide-react";
import { toast } from "react-hot-toast";

import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import { AccessDenied } from "@/components/ui/AccessDenied";
import PageGuideModal from "@/components/PageGuideModal";
import {
  EmptyState,
  Field,
  FieldError,
  Modal,
  StatusPill,
  SummaryCard,
  TableSkeleton,
  apiError,
  btnIcon,
  btnPrimary,
  btnSecondary,
  cardClass,
  formatDateTime,
  inputClass,
  money,
  selectClass,
  todayISO,
} from "@/components/finance/ui";

interface CashTransaction {
  id: number;
  direction: string;
  amount: number;
  source_type: string;
  source_id: number | null;
  reference: string | null;
  description: string | null;
  reversal_of: number | null;
  created_at: string | null;
}

interface Cashbook {
  business_date: string;
  account: { id: number; name: string } | null;
  opening_cash: number;
  cash_in: number;
  cash_out: number;
  expected_cash: number;
  counted_cash: number | null;
  difference: number | null;
  closing_status: string | null;
  transactions: CashTransaction[];
}

const EMPTY_FORM = {
  direction: "in",
  amount: "",
  business_date: todayISO(),
  reference: "",
  description: "",
};

export default function CashbookPage() {
  const { t } = useLanguage();
  const { hasPermission, selectedHouse } = useAuth();
  const houseId = selectedHouse?.id;

  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [book, setBook] = useState<Cashbook | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [showEntry, setShowEntry] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const [reverseTarget, setReverseTarget] = useState<CashTransaction | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [reversing, setReversing] = useState(false);

  const canEntry = hasPermission("finance.cash_entry");
  const canReverse = hasPermission("finance.cash_reverse");
  const canExport = hasPermission("finance.export");

  const headers = houseId ? { "X-House-ID": String(houseId) } : {};

  const fetchBook = useCallback(
    async (silent = false) => {
      if (!houseId) {
        setLoading(false);
        return;
      }
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const res = await apiClient.get("/v1/finance/cashbook/daily", {
          params: { date: selectedDate },
          headers,
        });
        setBook(res.data?.data || null);
      } catch (err) {
        toast.error(apiError(err, t("finance.common.error_generic")).message);
        setBook(null);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [houseId, selectedDate, t]
  );

  useEffect(() => {
    fetchBook();
  }, [fetchBook]);

  const openEntry = () => {
    setForm({ ...EMPTY_FORM, business_date: selectedDate });
    setFieldErrors({});
    setFormError(null);
    setShowEntry(true);
  };

  const submitEntry = async () => {
    const errors: Record<string, string> = {};
    const amount = Number(form.amount);
    if (!form.amount || Number.isNaN(amount) || amount <= 0) {
      errors.amount = t("finance.cashbook.validation.amount");
    }
    if (!form.direction) errors.direction = t("finance.common.required_field");
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      await apiClient.post(
        "/v1/finance/cash/entries",
        {
          direction: form.direction,
          amount,
          business_date: form.business_date || null,
          reference: form.reference.trim() || null,
          description: form.description.trim() || null,
        },
        { headers }
      );
      toast.success(t("finance.cashbook.entry_created"));
      setShowEntry(false);
      setForm({ ...EMPTY_FORM });
      if (form.business_date && form.business_date !== selectedDate) {
        setSelectedDate(form.business_date);
      } else {
        await fetchBook(true);
      }
    } catch (err) {
      const { message, fields } = apiError(err, t("finance.common.error_generic"));
      setFormError(message);
      if (fields) setFieldErrors(fields);
    } finally {
      setSaving(false);
    }
  };

  const submitReverse = async () => {
    if (!reverseTarget) return;
    setReversing(true);
    try {
      await apiClient.post(
        `/v1/finance/cash/transactions/${reverseTarget.id}/reverse`,
        { reason: reverseReason.trim() || null },
        { headers }
      );
      toast.success(t("finance.cashbook.reversed"));
      setReverseTarget(null);
      setReverseReason("");
      await fetchBook(true);
    } catch (err) {
      toast.error(apiError(err, t("finance.common.error_generic")).message);
    } finally {
      setReversing(false);
    }
  };

  const handleExport = async () => {
    if (!houseId) return;
    setExporting(true);
    try {
      const res = await apiClient.get("/v1/finance/cashbook/export", {
        params: { date: selectedDate },
        headers,
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.download = `cashbook_${selectedDate}.xlsx`;
      link.click();
      window.URL.revokeObjectURL(url);
      toast.success(t("finance.common.export_success"));
    } catch (err) {
      toast.error(apiError(err, t("finance.common.error_generic")).message);
    } finally {
      setExporting(false);
    }
  };

  const transactions = book?.transactions || [];
  const reversedIds = new Set(
    transactions.filter((tx) => tx.reversal_of).map((tx) => tx.reversal_of as number)
  );
  const isClosed = book?.closing_status === "approved";

  const canReverseRow = (tx: CashTransaction) =>
    !tx.reversal_of && tx.source_type !== "reversal" && !reversedIds.has(tx.id);

  const sourceLabel = (source: string) => {
    const key = `finance.cashbook.sources.${source}`;
    const label = t(key);
    return label === key ? source.replace(/_/g, " ") : label;
  };

  if (!hasPermission("finance.view")) return <AccessDenied />;

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="p-2.5 bg-violet-100 dark:bg-violet-500/20 rounded-xl">
          <Wallet className="w-5 h-5 text-violet-600 dark:text-violet-300" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {t("finance.cashbook.title")}
            </h1>
            <PageGuideModal pageKey="finance.cashbook" />
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("finance.cashbook.description")}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => fetchBook(true)}
            className={btnIcon}
            title={t("finance.common.refresh")}
            aria-label={t("finance.common.refresh")}
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
          {canExport ? (
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting || !houseId}
              className={btnSecondary}
            >
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              {t("finance.common.export")}
            </button>
          ) : null}
          {canEntry ? (
            <button type="button" onClick={openEntry} className={btnPrimary}>
              <Plus className="w-4 h-4" />
              {t("finance.cashbook.new_entry")}
            </button>
          ) : null}
        </div>
      </div>

      {!houseId ? (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
          {t("finance.common.require_house")}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-semibold text-gray-500 dark:text-gray-400">
              {t("finance.common.business_date")}
            </label>
            <input
              type="date"
              value={selectedDate}
              max={todayISO()}
              onChange={(event) => setSelectedDate(event.target.value || todayISO())}
              className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-sm cursor-pointer outline-none focus:ring-2 focus:ring-primary-500"
            />
            {book?.account ? (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {t("finance.cashbook.account")}:{" "}
                <span className="font-semibold text-gray-700 dark:text-gray-200">
                  {book.account.name}
                </span>
              </span>
            ) : null}
            {book?.closing_status ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                {t("finance.cashbook.closing")}:
                <StatusPill status={book.closing_status} />
              </span>
            ) : null}
          </div>

          {isClosed ? (
            <div className="rounded-2xl border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
              {t("finance.cashbook.date_closed")}
            </div>
          ) : null}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <SummaryCard label={t("finance.cashbook.opening")} value={money(book?.opening_cash)} />
            <SummaryCard
              label={t("finance.cashbook.cash_in")}
              value={money(book?.cash_in)}
              tone="emerald"
            />
            <SummaryCard
              label={t("finance.cashbook.cash_out")}
              value={money(book?.cash_out)}
              tone="rose"
            />
            <SummaryCard
              label={t("finance.cashbook.expected")}
              value={money(book?.expected_cash)}
              tone="violet"
            />
          </div>

          <div className={cardClass}>
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-50 dark:border-slate-800">
              <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
                {t("finance.cashbook.transactions")}
              </p>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {transactions.length} {t("finance.common.records")}
              </span>
            </div>

            {loading ? (
              <TableSkeleton rows={5} />
            ) : transactions.length === 0 ? (
              <EmptyState
                title={t("finance.cashbook.empty")}
                description={t("finance.cashbook.empty_desc")}
              />
            ) : (
              <>
                <div className="hidden lg:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-slate-800/50 text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      <tr>
                        <th className="px-2 py-2">#</th>
                        <th className="px-2 py-2">{t("finance.common.direction")}</th>
                        <th className="px-2 py-2 text-right">{t("finance.common.amount")}</th>
                        <th className="px-2 py-2">{t("finance.cashbook.source")}</th>
                        <th className="px-2 py-2">{t("finance.common.description")}</th>
                        <th className="px-2 py-2">{t("finance.common.reference")}</th>
                        <th className="px-2 py-2">{t("finance.common.time")}</th>
                        <th className="px-2 py-2 text-right">{t("finance.common.actions")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                      {transactions.map((tx) => (
                        <tr key={tx.id} className="hover:bg-gray-50/60 dark:hover:bg-slate-800/40">
                          <td className="px-2 py-1 text-xs text-gray-500">#{tx.id}</td>
                          <td className="px-2 py-1">
                            <span
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                                tx.direction === "in"
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30"
                                  : "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30"
                              }`}
                            >
                              {tx.direction === "in" ? (
                                <ArrowDownLeft className="w-3 h-3" />
                              ) : (
                                <ArrowUpRight className="w-3 h-3" />
                              )}
                              {t(`finance.common.directions.${tx.direction}`)}
                            </span>
                          </td>
                          <td className="px-2 py-1 text-right font-semibold whitespace-nowrap">
                            {money(tx.amount)}
                          </td>
                          <td className="px-2 py-1">
                            <p className="text-xs font-medium capitalize">{sourceLabel(tx.source_type)}</p>
                            {tx.source_id ? (
                              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                                #{tx.source_id}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-2 py-1">
                            <p className="text-xs">{tx.description || "—"}</p>
                            {tx.reversal_of ? (
                              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                                {t("finance.cashbook.reversal_of")} #{tx.reversal_of}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400">
                            {tx.reference || "—"}
                          </td>
                          <td className="px-2 py-1 text-[11px] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                            {formatDateTime(tx.created_at)}
                          </td>
                          <td className="px-2 py-1 text-right">
                            {canReverse ? (
                              canReverseRow(tx) ? (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setReverseTarget(tx);
                                    setReverseReason("");
                                  }}
                                  className="inline-flex items-center gap-1 rounded-lg border border-amber-200 dark:border-amber-500/30 px-2.5 py-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-500/10 cursor-pointer"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                  {t("finance.cashbook.reverse")}
                                </button>
                              ) : (
                                <span className="text-[11px] text-gray-400">—</span>
                              )
                            ) : (
                              <span className="text-[11px] text-gray-400">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="lg:hidden divide-y divide-gray-100 dark:divide-slate-800">
                  {transactions.map((tx) => {
                    const open = expandedId === tx.id;
                    return (
                      <div key={tx.id}>
                        <button
                          type="button"
                          onClick={() => setExpandedId(open ? null : tx.id)}
                          className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer"
                        >
                          <span
                            className={`p-1.5 rounded-lg shrink-0 ${
                              tx.direction === "in"
                                ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300"
                                : "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300"
                            }`}
                          >
                            {tx.direction === "in" ? (
                              <ArrowDownLeft className="w-4 h-4" />
                            ) : (
                              <ArrowUpRight className="w-4 h-4" />
                            )}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm truncate">
                              {tx.description || sourceLabel(tx.source_type)}
                            </p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                              {formatDateTime(tx.created_at)}
                            </p>
                          </div>
                          <p
                            className={`text-sm font-bold shrink-0 ${
                              tx.direction === "in"
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-rose-600 dark:text-rose-400"
                            }`}
                          >
                            {tx.direction === "in" ? "+" : "−"}
                            {money(tx.amount)}
                          </p>
                          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                        {open ? (
                          <div className="px-4 pb-4 space-y-2 text-sm">
                            <div className="flex justify-between gap-3">
                              <span className="text-xs text-gray-500">{t("finance.cashbook.source")}</span>
                              <span className="text-sm font-medium capitalize text-right">
                                {sourceLabel(tx.source_type)}
                                {tx.source_id ? ` #${tx.source_id}` : ""}
                              </span>
                            </div>
                            <div className="flex justify-between gap-3">
                              <span className="text-xs text-gray-500">{t("finance.common.reference")}</span>
                              <span className="text-sm font-medium text-right">{tx.reference || "—"}</span>
                            </div>
                            {tx.reversal_of ? (
                              <div className="flex justify-between gap-3">
                                <span className="text-xs text-gray-500">
                                  {t("finance.cashbook.reversal_of")}
                                </span>
                                <span className="text-sm font-medium text-right">#{tx.reversal_of}</span>
                              </div>
                            ) : null}
                            {canReverse && canReverseRow(tx) ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setReverseTarget(tx);
                                  setReverseReason("");
                                }}
                                className="mt-1 inline-flex items-center gap-1 rounded-lg border border-amber-200 dark:border-amber-500/30 px-3 py-2 text-xs font-semibold text-amber-700 dark:text-amber-300 cursor-pointer"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                {t("finance.cashbook.reverse")}
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </>
      )}

      <Modal
        open={showEntry}
        onClose={() => setShowEntry(false)}
        title={t("finance.cashbook.entry_title")}
        subtitle={t("finance.cashbook.entry_desc")}
        busy={saving}
        footer={
          <>
            <button
              type="button"
              onClick={() => setShowEntry(false)}
              disabled={saving}
              className={btnSecondary}
            >
              {t("finance.common.cancel")}
            </button>
            <button type="button" onClick={submitEntry} disabled={saving} className={btnPrimary}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {saving ? t("finance.common.saving") : t("finance.common.save")}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label={t("finance.common.direction")} required error={fieldErrors.direction}>
            <select
              value={form.direction}
              onChange={(event) => setForm({ ...form, direction: event.target.value })}
              className={selectClass}
            >
              <option value="in">{t("finance.common.directions.in")}</option>
              <option value="out">{t("finance.common.directions.out")}</option>
            </select>
          </Field>
          <Field label={t("finance.common.business_date")}>
            <input
              type="date"
              value={form.business_date}
              max={todayISO()}
              onChange={(event) => setForm({ ...form, business_date: event.target.value })}
              className={`${inputClass} cursor-pointer`}
            />
          </Field>
          <Field label={t("finance.common.amount")} required error={fieldErrors.amount}>
            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              value={form.amount}
              onChange={(event) => setForm({ ...form, amount: event.target.value })}
              placeholder="0.00"
              className={inputClass}
            />
          </Field>
          <Field label={t("finance.common.reference")}>
            <input
              value={form.reference}
              onChange={(event) => setForm({ ...form, reference: event.target.value })}
              maxLength={120}
              className={inputClass}
            />
          </Field>
          <div className="md:col-span-2">
            <Field label={t("finance.common.description")}>
              <textarea
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                rows={2}
                maxLength={500}
                className={inputClass}
              />
            </Field>
          </div>
        </div>
        <FieldError error={formError || undefined} />
      </Modal>

      <Modal
        open={Boolean(reverseTarget)}
        onClose={() => setReverseTarget(null)}
        title={t("finance.cashbook.reverse_title")}
        subtitle={
          reverseTarget
            ? `#${reverseTarget.id} • ${money(reverseTarget.amount)} • ${formatDateTime(reverseTarget.created_at)}`
            : undefined
        }
        busy={reversing}
        footer={
          <>
            <button type="button" onClick={() => setReverseTarget(null)} className={btnSecondary}>
              {t("finance.common.cancel")}
            </button>
            <button
              type="button"
              onClick={submitReverse}
              disabled={reversing}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold disabled:opacity-50 cursor-pointer"
            >
              {reversing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RotateCcw className="w-4 h-4" />
              )}
              {t("finance.cashbook.reverse")}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label={t("finance.common.reason")}>
            <textarea
              value={reverseReason}
              onChange={(event) => setReverseReason(event.target.value)}
              rows={3}
              maxLength={500}
              className={inputClass}
              placeholder={t("finance.cashbook.reverse_reason_placeholder")}
            />
          </Field>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {t("finance.cashbook.reverse_hint")}
          </p>
        </div>
      </Modal>
    </div>
  );
}
