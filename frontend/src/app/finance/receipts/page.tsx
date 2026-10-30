"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
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
  Pagination,
  TableSkeleton,
  apiError,
  btnIcon,
  btnPrimary,
  btnSecondary,
  cardClass,
  formatDate,
  inputClass,
  money,
  searchInputClass,
  selectClass,
  todayISO,
  type PaginationMeta,
} from "@/components/finance/ui";

const PER_PAGE = 20;

interface ReceiptRow {
  id: number;
  business_date: string | null;
  receipt_type: string;
  source_name: string | null;
  related_party: string | null;
  related_due_reference: string | null;
  amount: number;
  payment_method: string;
  reference: string | null;
  notes: string | null;
  created_at: string | null;
}

type Summary = {
  total: { count: number; amount: number };
  by_method: Record<string, { count: number; amount: number }>;
};

const EMPTY_FORM = {
  business_date: todayISO(),
  receipt_type: "",
  source_name: "",
  related_party: "",
  related_due_reference: "",
  amount: "",
  payment_method: "cash",
  reference: "",
  notes: "",
};

const METHOD_BADGE: Record<string, string> = {
  cash: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30",
  bank: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/30",
  mobile: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:border-violet-500/30",
  other: "bg-gray-50 text-gray-700 border-gray-200 dark:bg-slate-800 dark:text-gray-300 dark:border-slate-700",
};

export default function ReceiptsPage() {
  const { t } = useLanguage();
  const { hasPermission, selectedHouse } = useAuth();
  const houseId = selectedHouse?.id;

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ReceiptRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [methodFilter, setMethodFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canCreate = hasPermission("finance.receipt_create");
  const canExport = hasPermission("finance.export");

  const headers = houseId ? { "X-House-ID": String(houseId) } : {};

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 400);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [search]);

  const filterParams = useCallback(() => {
    const params: Record<string, string | number> = {};
    if (debouncedSearch) params.search = debouncedSearch;
    if (methodFilter) params.payment_method = methodFilter;
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    return params;
  }, [debouncedSearch, methodFilter, dateFrom, dateTo]);

  const fetchData = useCallback(
    async (silent = false) => {
      if (!houseId) {
        setLoading(false);
        return;
      }
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const params = { ...filterParams(), page, per_page: PER_PAGE };
        const [listRes, summaryRes] = await Promise.all([
          apiClient.get("/v1/finance/receipts", { params, headers }),
          apiClient
            .get("/v1/finance/receipts/summary", { params: filterParams(), headers })
            .catch(() => null),
        ]);
        setRows(listRes.data?.data || []);
        setPagination(listRes.data?.pagination || null);
        setSummary(summaryRes?.data?.data || null);
      } catch (err) {
        toast.error(apiError(err, t("finance.common.error_generic")).message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [houseId, page, filterParams, t]
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openCreate = () => {
    setForm({ ...EMPTY_FORM });
    setFieldErrors({});
    setFormError(null);
    setShowCreate(true);
  };

  const submitReceipt = async () => {
    const errors: Record<string, string> = {};
    if (form.receipt_type.trim().length < 2) {
      errors.receipt_type = t("finance.receipts.validation.type");
    }
    const amount = Number(form.amount);
    if (!form.amount || Number.isNaN(amount) || amount <= 0) {
      errors.amount = t("finance.receipts.validation.amount");
    }
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      await apiClient.post(
        "/v1/finance/receipts",
        {
          business_date: form.business_date || null,
          receipt_type: form.receipt_type.trim(),
          source_name: form.source_name.trim() || null,
          related_party: form.related_party.trim() || null,
          related_due_reference: form.related_due_reference.trim() || null,
          amount,
          payment_method: form.payment_method,
          reference: form.reference.trim() || null,
          notes: form.notes.trim() || null,
        },
        { headers }
      );
      toast.success(t("finance.receipts.created"));
      setShowCreate(false);
      setForm({ ...EMPTY_FORM });
      await fetchData(true);
    } catch (err) {
      const { message, fields } = apiError(err, t("finance.common.error_generic"));
      setFormError(message);
      if (fields) setFieldErrors(fields);
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async () => {
    if (!houseId) return;
    setExporting(true);
    try {
      const res = await apiClient.get("/v1/finance/receipts/export", {
        params: filterParams(),
        headers,
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.download = `finance_receipts_${todayISO()}.xlsx`;
      link.click();
      window.URL.revokeObjectURL(url);
      toast.success(t("finance.common.export_success"));
    } catch (err) {
      toast.error(apiError(err, t("finance.common.error_generic")).message);
    } finally {
      setExporting(false);
    }
  };

  const clearFilters = () => {
    setSearch("");
    setDebouncedSearch("");
    setMethodFilter("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  const methodLabel = (method: string) => t(`finance.common.methods.${method}`);
  const methodBadge = (method: string) =>
    METHOD_BADGE[method] || METHOD_BADGE.other;

  if (!hasPermission("finance.view")) return <AccessDenied />;

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="p-2.5 bg-violet-100 dark:bg-violet-500/20 rounded-xl">
          <ReceiptText className="w-5 h-5 text-violet-600 dark:text-violet-300" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {t("finance.receipts.title")}
            </h1>
            <PageGuideModal pageKey="finance.receipts" />
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("finance.receipts.description")}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => fetchData(true)}
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
          {canCreate ? (
            <button type="button" onClick={openCreate} className={btnPrimary}>
              <Plus className="w-4 h-4" />
              {t("finance.receipts.new")}
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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className={`rounded-2xl border bg-white dark:bg-slate-900 px-4 py-3 border-violet-100 dark:border-violet-500/20`}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {t("finance.receipts.filtered_total")}
              </p>
              <p className="text-lg font-bold mt-0.5 break-words text-violet-700 dark:text-violet-300">
                {money(summary?.total?.amount)}
              </p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                {summary?.total?.count ?? 0} {t("finance.common.records")}
              </p>
            </div>
            {["cash", "bank", "mobile"].map((method) => (
              <div
                key={method}
                className="rounded-2xl border bg-white dark:bg-slate-900 px-4 py-3 border-gray-100 dark:border-slate-800"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {methodLabel(method)}
                </p>
                <p className="text-lg font-bold mt-0.5 break-words text-gray-900 dark:text-gray-100">
                  {money(summary?.by_method?.[method]?.amount)}
                </p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                  {summary?.by_method?.[method]?.count ?? 0} {t("finance.common.records")}
                </p>
              </div>
            ))}
          </div>

          <div className={cardClass}>
            <div className="p-3 sm:p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 border-b border-gray-50 dark:border-slate-800">
              <div className="relative lg:col-span-2">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t("finance.receipts.search_placeholder")}
                  className={searchInputClass}
                />
              </div>
              <select
                value={methodFilter}
                onChange={(event) => {
                  setMethodFilter(event.target.value);
                  setPage(1);
                }}
                className={selectClass}
                aria-label={t("finance.common.method")}
              >
                <option value="">{t("finance.common.all_methods")}</option>
                <option value="cash">{t("finance.common.methods.cash")}</option>
                <option value="bank">{t("finance.common.methods.bank")}</option>
                <option value="mobile">{t("finance.common.methods.mobile")}</option>
                <option value="other">{t("finance.common.methods.other")}</option>
              </select>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={dateFrom}
                  max={dateTo || undefined}
                  onChange={(event) => {
                    setDateFrom(event.target.value);
                    setPage(1);
                  }}
                  className={`${inputClass} cursor-pointer`}
                  aria-label={t("finance.common.from")}
                />
                <input
                  type="date"
                  value={dateTo}
                  min={dateFrom || undefined}
                  onChange={(event) => {
                    setDateTo(event.target.value);
                    setPage(1);
                  }}
                  className={`${inputClass} cursor-pointer`}
                  aria-label={t("finance.common.to")}
                />
              </div>
            </div>

            {(search || methodFilter || dateFrom || dateTo) && (
              <div className="px-3 sm:px-4 py-2 border-b border-gray-50 dark:border-slate-800">
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-xs font-semibold text-primary-600 hover:text-primary-700 cursor-pointer"
                >
                  {t("finance.common.clear_filters")}
                </button>
              </div>
            )}

            {loading ? (
              <TableSkeleton rows={5} />
            ) : rows.length === 0 ? (
              <EmptyState
                title={t("finance.receipts.empty")}
                description={t("finance.receipts.empty_desc")}
              />
            ) : (
              <>
                <div className="hidden lg:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-slate-800/50 text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      <tr>
                        <th className="px-2 py-2">{t("finance.common.date")}</th>
                        <th className="px-2 py-2">{t("finance.common.receipt_type")}</th>
                        <th className="px-2 py-2">{t("finance.receipts.party")}</th>
                        <th className="px-2 py-2 text-right">{t("finance.common.amount")}</th>
                        <th className="px-2 py-2">{t("finance.common.method")}</th>
                        <th className="px-2 py-2">{t("finance.common.reference")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                      {rows.map((row) => (
                        <tr key={row.id} className="hover:bg-gray-50/60 dark:hover:bg-slate-800/40">
                          <td className="px-2 py-1 whitespace-nowrap font-medium">
                            {formatDate(row.business_date)}
                          </td>
                          <td className="px-2 py-1">
                            <p className="font-medium">{row.receipt_type}</p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">
                              {row.source_name || "—"}
                            </p>
                          </td>
                          <td className="px-2 py-1">
                            <p>{row.related_party || "—"}</p>
                            {row.related_due_reference ? (
                              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                                {row.related_due_reference}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-2 py-1 text-right font-semibold whitespace-nowrap">
                            {money(row.amount)}
                          </td>
                          <td className="px-2 py-1">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-semibold ${methodBadge(row.payment_method)}`}
                            >
                              {methodLabel(row.payment_method)}
                            </span>
                          </td>
                          <td className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400">
                            {row.reference || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="lg:hidden divide-y divide-gray-100 dark:divide-slate-800">
                  {rows.map((row) => {
                    const open = expandedId === row.id;
                    return (
                      <div key={row.id}>
                        <button
                          type="button"
                          onClick={() => setExpandedId(open ? null : row.id)}
                          className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm truncate">{row.receipt_type}</p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                              {formatDate(row.business_date)} • {methodLabel(row.payment_method)}
                            </p>
                          </div>
                          <p className="text-sm font-bold shrink-0">{money(row.amount)}</p>
                          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                        {open ? (
                          <div className="px-4 pb-4 space-y-2 text-sm">
                            <div className="flex justify-between gap-3">
                              <span className="text-xs text-gray-500">{t("finance.receipts.source")}</span>
                              <span className="text-sm font-medium text-right">
                                {row.source_name || "—"}
                              </span>
                            </div>
                            <div className="flex justify-between gap-3">
                              <span className="text-xs text-gray-500">{t("finance.receipts.party")}</span>
                              <span className="text-sm font-medium text-right">
                                {row.related_party || "—"}
                              </span>
                            </div>
                            <div className="flex justify-between gap-3">
                              <span className="text-xs text-gray-500">
                                {t("finance.receipts.due_reference")}
                              </span>
                              <span className="text-sm font-medium text-right">
                                {row.related_due_reference || "—"}
                              </span>
                            </div>
                            <div className="flex justify-between gap-3">
                              <span className="text-xs text-gray-500">{t("finance.common.reference")}</span>
                              <span className="text-sm font-medium text-right">
                                {row.reference || "—"}
                              </span>
                            </div>
                            {row.notes ? (
                              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                                {row.notes}
                              </p>
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

          <Pagination meta={pagination} onPage={setPage} />
        </>
      )}

      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title={t("finance.receipts.create_title")}
        subtitle={t("finance.receipts.create_desc")}
        busy={saving}
        maxWidth="sm:max-w-2xl"
        footer={
          <>
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              disabled={saving}
              className={btnSecondary}
            >
              {t("finance.common.cancel")}
            </button>
            <button type="button" onClick={submitReceipt} disabled={saving} className={btnPrimary}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {saving ? t("finance.common.saving") : t("finance.common.save")}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label={t("finance.common.business_date")}>
            <input
              type="date"
              value={form.business_date}
              max={todayISO()}
              onChange={(event) => setForm({ ...form, business_date: event.target.value })}
              className={`${inputClass} cursor-pointer`}
            />
          </Field>
          <Field label={t("finance.common.receipt_type")} required error={fieldErrors.receipt_type}>
            <input
              list="finance-receipt-types"
              value={form.receipt_type}
              onChange={(event) => setForm({ ...form, receipt_type: event.target.value })}
              maxLength={60}
              placeholder={t("finance.receipts.type_placeholder")}
              className={inputClass}
            />
            <datalist id="finance-receipt-types">
              <option value={t("finance.receipts.types.old_due")} />
              <option value={t("finance.receipts.types.supplier_refund")} />
              <option value={t("finance.receipts.types.misc_income")} />
              <option value={t("finance.receipts.types.advance_recovery")} />
              <option value={t("finance.receipts.types.other")} />
            </datalist>
          </Field>
          <Field label={t("finance.receipts.source")}>
            <input
              value={form.source_name}
              onChange={(event) => setForm({ ...form, source_name: event.target.value })}
              maxLength={200}
              className={inputClass}
            />
          </Field>
          <Field label={t("finance.receipts.party")}>
            <input
              value={form.related_party}
              onChange={(event) => setForm({ ...form, related_party: event.target.value })}
              maxLength={200}
              className={inputClass}
            />
          </Field>
          <Field label={t("finance.receipts.due_reference")}>
            <input
              value={form.related_due_reference}
              onChange={(event) =>
                setForm({ ...form, related_due_reference: event.target.value })
              }
              maxLength={120}
              className={inputClass}
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
          <Field label={t("finance.common.method")}>
            <select
              value={form.payment_method}
              onChange={(event) => setForm({ ...form, payment_method: event.target.value })}
              className={selectClass}
            >
              <option value="cash">{t("finance.common.methods.cash")}</option>
              <option value="bank">{t("finance.common.methods.bank")}</option>
              <option value="mobile">{t("finance.common.methods.mobile")}</option>
              <option value="other">{t("finance.common.methods.other")}</option>
            </select>
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
            <Field label={t("finance.common.notes")}>
              <textarea
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
                rows={2}
                maxLength={2000}
                className={inputClass}
              />
            </Field>
          </div>
          <p className="md:col-span-2 text-[11px] text-gray-500 dark:text-gray-400">
            {t("finance.receipts.cash_hint")}
          </p>
        </div>
        <FieldError error={formError || undefined} />
      </Modal>
    </div>
  );
}
