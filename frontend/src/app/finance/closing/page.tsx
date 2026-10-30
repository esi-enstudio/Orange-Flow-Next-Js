"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CalendarCheck,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
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
  StatusPill,
  SummaryCard,
  TableSkeleton,
  apiError,
  btnIcon,
  btnPrimary,
  btnSecondary,
  cardClass,
  formatDate,
  money,
  searchInputClass,
  selectClass,
  todayISO,
  type PaginationMeta,
} from "@/components/finance/ui";

const PER_PAGE = 20;

interface EmployeeSnapshot {
  employee_id: number;
  employee_name: string | null;
  assigned: number;
}

interface TopupSnapshot {
  employee_id: number | null;
  balance: number;
}

interface ClosingRow {
  id: number;
  business_date: string;
  status: string;
  opening_cash: number;
  cash_in: number;
  cash_out: number;
  expected_cash: number;
  counted_cash: number;
  difference: number;
  stock_snapshot: Record<string, number> | null;
  employee_snapshot: EmployeeSnapshot[] | null;
  topup_snapshot: TopupSnapshot[] | null;
  notes: string | null;
  reopen_reason: string | null;
  submitted_at: string | null;
  approved_at: string | null;
}

interface CashPreview {
  opening_cash: number;
  cash_in: number;
  cash_out: number;
  expected_cash: number;
}

export default function DailyClosingPage() {
  const { t } = useLanguage();
  const { hasPermission, selectedHouse } = useAuth();
  const houseId = selectedHouse?.id;

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ClosingRow[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [preview, setPreview] = useState<CashPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [showSubmit, setShowSubmit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    business_date: todayISO(),
    counted_cash: "",
    notes: "",
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const [detail, setDetail] = useState<ClosingRow | null>(null);
  const [reopenTarget, setReopenTarget] = useState<ClosingRow | null>(null);
  const [reopenReason, setReopenReason] = useState("");
  const [reopenError, setReopenError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const canSubmit = hasPermission("finance.closing_submit");
  const canApprove = hasPermission("finance.closing_approve");
  const canReopen = hasPermission("finance.closing_reopen");
  const canExport = hasPermission("finance.export");

  const headers = houseId ? { "X-House-ID": String(houseId) } : {};

  const filterParams = useCallback(() => {
    const params: Record<string, string | number> = {};
    if (statusFilter) params.status = statusFilter;
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    return params;
  }, [statusFilter, dateFrom, dateTo]);

  const fetchData = useCallback(
    async (silent = false) => {
      if (!houseId) {
        setLoading(false);
        return;
      }
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const res = await apiClient.get("/v1/finance/daily-closings", {
          params: { ...filterParams(), page, per_page: PER_PAGE },
          headers,
        });
        setRows(res.data?.data || []);
        setPagination(res.data?.pagination || null);
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

  useEffect(() => {
    if (!showSubmit || !houseId) return;
    let active = true;
    setPreviewLoading(true);
    apiClient
      .get("/v1/finance/cashbook/daily", {
        params: { date: form.business_date || todayISO() },
        headers,
      })
      .then((res) => {
        if (active) {
          const data = res.data?.data;
          setPreview(
            data
              ? {
                  opening_cash: data.opening_cash,
                  cash_in: data.cash_in,
                  cash_out: data.cash_out,
                  expected_cash: data.expected_cash,
                }
              : null
          );
        }
      })
      .catch(() => active && setPreview(null))
      .finally(() => active && setPreviewLoading(false));
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSubmit, form.business_date, houseId]);

  const openSubmit = () => {
    setForm({ business_date: todayISO(), counted_cash: "", notes: "" });
    setFieldErrors({});
    setFormError(null);
    setPreview(null);
    setShowSubmit(true);
  };

  const submitClosing = async () => {
    const errors: Record<string, string> = {};
    const counted = Number(form.counted_cash);
    if (form.counted_cash === "" || Number.isNaN(counted) || counted < 0) {
      errors.counted_cash = t("finance.closing.validation.counted");
    }
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      await apiClient.post(
        "/v1/finance/daily-closings",
        {
          business_date: form.business_date || null,
          counted_cash: counted,
          notes: form.notes.trim() || null,
        },
        { headers }
      );
      toast.success(t("finance.closing.submitted"));
      setShowSubmit(false);
      await fetchData(true);
    } catch (err) {
      const { message, fields } = apiError(err, t("finance.common.error_generic"));
      setFormError(message);
      if (fields) setFieldErrors(fields);
    } finally {
      setSaving(false);
    }
  };

  const approveClosing = async (row: ClosingRow) => {
    setBusy(`approve-${row.id}`);
    try {
      await apiClient.post(`/v1/finance/daily-closings/${row.id}/approve`, {}, { headers });
      toast.success(t("finance.closing.approved"));
      setDetail(null);
      await fetchData(true);
    } catch (err) {
      toast.error(apiError(err, t("finance.common.error_generic")).message);
    } finally {
      setBusy(null);
    }
  };

  const submitReopen = async () => {
    if (!reopenTarget) return;
    if (reopenReason.trim().length < 3) {
      setReopenError(t("finance.closing.validation.reason"));
      return;
    }
    setBusy(`reopen-${reopenTarget.id}`);
    try {
      await apiClient.post(
        `/v1/finance/daily-closings/${reopenTarget.id}/reopen`,
        { reason: reopenReason.trim() },
        { headers }
      );
      toast.success(t("finance.closing.reopened"));
      setReopenTarget(null);
      setReopenReason("");
      setReopenError(null);
      await fetchData(true);
    } catch (err) {
      toast.error(apiError(err, t("finance.common.error_generic")).message);
    } finally {
      setBusy(null);
    }
  };

  const handleExport = async () => {
    if (!houseId) return;
    setExporting(true);
    try {
      const res = await apiClient.get("/v1/finance/daily-closings/export", {
        params: filterParams(),
        headers,
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.download = `daily_closings_${todayISO()}.xlsx`;
      link.click();
      window.URL.revokeObjectURL(url);
      toast.success(t("finance.common.export_success"));
    } catch (err) {
      toast.error(apiError(err, t("finance.common.error_generic")).message);
    } finally {
      setExporting(false);
    }
  };

  const differenceClass = (value: number) =>
    value === 0
      ? "text-gray-600 dark:text-gray-300"
      : value > 0
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-rose-600 dark:text-rose-400";

  const renderActions = (row: ClosingRow, compact = false) => (
    <div className={`flex flex-wrap items-center gap-1.5 ${compact ? "" : "justify-end"}`}>
      <button
        type="button"
        onClick={() => setDetail(row)}
        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-semibold hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap"
      >
        <Eye className="w-3.5 h-3.5" />
        {t("finance.common.view")}
      </button>
      {row.status === "submitted" && canApprove ? (
        <button
          type="button"
          disabled={busy === `approve-${row.id}`}
          onClick={() => approveClosing(row)}
          className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 dark:border-emerald-500/30 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 disabled:opacity-50 cursor-pointer whitespace-nowrap"
        >
          {busy === `approve-${row.id}` ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5" />
          )}
          {t("finance.common.approve")}
        </button>
      ) : null}
      {row.status === "approved" && canReopen ? (
        <button
          type="button"
          onClick={() => {
            setReopenTarget(row);
            setReopenReason("");
            setReopenError(null);
          }}
          className="inline-flex items-center gap-1 rounded-lg border border-amber-200 dark:border-amber-500/30 px-2.5 py-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-500/10 cursor-pointer whitespace-nowrap"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          {t("finance.closing.reopen")}
        </button>
      ) : null}
    </div>
  );

  if (!hasPermission("finance.view")) return <AccessDenied />;

  const counted = Number(form.counted_cash || 0);
  const liveDifference = preview ? counted - preview.expected_cash : null;

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="p-2.5 bg-violet-100 dark:bg-violet-500/20 rounded-xl">
          <CalendarCheck className="w-5 h-5 text-violet-600 dark:text-violet-300" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {t("finance.closing.title")}
            </h1>
            <PageGuideModal pageKey="finance.closing" />
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("finance.closing.description")}
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
          {canSubmit ? (
            <button type="button" onClick={openSubmit} className={btnPrimary}>
              <Plus className="w-4 h-4" />
              {t("finance.closing.new")}
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
          <div className={cardClass}>
            <div className="p-3 sm:p-4 grid grid-cols-1 sm:grid-cols-3 gap-2 border-b border-gray-50 dark:border-slate-800">
              <select
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value);
                  setPage(1);
                }}
                className={selectClass}
                aria-label={t("finance.common.status")}
              >
                <option value="">{t("finance.common.all_statuses")}</option>
                <option value="submitted">{t("finance.common.statuses.submitted")}</option>
                <option value="approved">{t("finance.common.statuses.approved")}</option>
                <option value="reopened">{t("finance.common.statuses.reopened")}</option>
              </select>
              <input
                type="date"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(event) => {
                  setDateFrom(event.target.value);
                  setPage(1);
                }}
                className={`${searchInputClass} pl-3`}
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
                className={`${searchInputClass} pl-3`}
                aria-label={t("finance.common.to")}
              />
            </div>

            {loading ? (
              <TableSkeleton rows={5} />
            ) : rows.length === 0 ? (
              <EmptyState
                title={t("finance.closing.empty")}
                description={t("finance.closing.empty_desc")}
              />
            ) : (
              <>
                <div className="hidden lg:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-slate-800/50 text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      <tr>
                        <th className="px-2 py-2">{t("finance.common.date")}</th>
                        <th className="px-2 py-2">{t("finance.common.status")}</th>
                        <th className="px-2 py-2 text-right">{t("finance.closing.opening")}</th>
                        <th className="px-2 py-2 text-right">{t("finance.closing.cash_in")}</th>
                        <th className="px-2 py-2 text-right">{t("finance.closing.cash_out")}</th>
                        <th className="px-2 py-2 text-right">{t("finance.closing.expected")}</th>
                        <th className="px-2 py-2 text-right">{t("finance.closing.counted")}</th>
                        <th className="px-2 py-2 text-right">{t("finance.closing.difference")}</th>
                        <th className="px-2 py-2 text-right">{t("finance.common.actions")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                      {rows.map((row) => (
                        <tr key={row.id} className="hover:bg-gray-50/60 dark:hover:bg-slate-800/40">
                          <td className="px-2 py-1 whitespace-nowrap font-medium">
                            {formatDate(row.business_date)}
                          </td>
                          <td className="px-2 py-1">
                            <StatusPill status={row.status} />
                          </td>
                          <td className="px-2 py-1 text-right whitespace-nowrap">{money(row.opening_cash)}</td>
                          <td className="px-2 py-1 text-right whitespace-nowrap text-emerald-600 dark:text-emerald-400">
                            {money(row.cash_in)}
                          </td>
                          <td className="px-2 py-1 text-right whitespace-nowrap text-rose-600 dark:text-rose-400">
                            {money(row.cash_out)}
                          </td>
                          <td className="px-2 py-1 text-right font-semibold whitespace-nowrap">
                            {money(row.expected_cash)}
                          </td>
                          <td className="px-2 py-1 text-right whitespace-nowrap">{money(row.counted_cash)}</td>
                          <td className={`px-2 py-1 text-right font-semibold whitespace-nowrap ${differenceClass(row.difference)}`}>
                            {money(row.difference)}
                          </td>
                          <td className="px-2 py-1">{renderActions(row)}</td>
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
                            <p className="font-semibold text-sm">{formatDate(row.business_date)}</p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">
                              {t("finance.closing.expected")}: {money(row.expected_cash)}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <StatusPill status={row.status} />
                            <p className={`text-xs font-semibold mt-0.5 ${differenceClass(row.difference)}`}>
                              {money(row.difference)}
                            </p>
                          </div>
                          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                        {open ? (
                          <div className="px-4 pb-4 space-y-2 text-sm">
                            {[
                              ["finance.closing.opening", row.opening_cash],
                              ["finance.closing.cash_in", row.cash_in],
                              ["finance.closing.cash_out", row.cash_out],
                              ["finance.closing.counted", row.counted_cash],
                            ].map(([key, value]) => (
                              <div key={String(key)} className="flex justify-between gap-3">
                                <span className="text-xs text-gray-500">{t(String(key))}</span>
                                <span className="text-sm font-medium text-right">{money(Number(value))}</span>
                              </div>
                            ))}
                            <div className="pt-1">{renderActions(row, true)}</div>
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
        open={showSubmit}
        onClose={() => setShowSubmit(false)}
        title={t("finance.closing.submit_title")}
        subtitle={t("finance.closing.submit_desc")}
        busy={saving}
        footer={
          <>
            <button
              type="button"
              onClick={() => setShowSubmit(false)}
              disabled={saving}
              className={btnSecondary}
            >
              {t("finance.common.cancel")}
            </button>
            <button type="button" onClick={submitClosing} disabled={saving} className={btnPrimary}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {saving ? t("finance.common.saving") : t("finance.closing.submit")}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label={t("finance.common.business_date")}>
            <input
              type="date"
              value={form.business_date}
              max={todayISO()}
              onChange={(event) => setForm({ ...form, business_date: event.target.value })}
              className="w-full rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm cursor-pointer outline-none focus:ring-2 focus:ring-primary-500"
            />
          </Field>

          <div className="rounded-xl border border-gray-100 dark:border-slate-800 bg-gray-50/60 dark:bg-slate-800/40 p-3">
            {previewLoading ? (
              <div className="space-y-2 animate-pulse">
                <div className="h-3 w-28 bg-gray-200 dark:bg-slate-700 rounded" />
                <div className="h-3 w-20 bg-gray-100 dark:bg-slate-800 rounded" />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-[11px] text-gray-500">
                    {t("finance.closing.opening")}
                  </p>
                  <p className="font-semibold">{money(preview?.opening_cash)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-gray-500">{t("finance.closing.expected")}</p>
                  <p className="font-semibold text-violet-700 dark:text-violet-300">
                    {money(preview?.expected_cash)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-gray-500">{t("finance.closing.cash_in")}</p>
                  <p className="font-semibold text-emerald-600 dark:text-emerald-400">
                    {money(preview?.cash_in)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-gray-500">{t("finance.closing.cash_out")}</p>
                  <p className="font-semibold text-rose-600 dark:text-rose-400">
                    {money(preview?.cash_out)}
                  </p>
                </div>
              </div>
            )}
          </div>

          <Field
            label={t("finance.closing.counted")}
            required
            error={fieldErrors.counted_cash}
          >
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              value={form.counted_cash}
              onChange={(event) => setForm({ ...form, counted_cash: event.target.value })}
              placeholder="0.00"
              className="w-full rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary-500"
            />
          </Field>

          {liveDifference !== null ? (
            <div className="flex items-center justify-between rounded-xl border border-gray-100 dark:border-slate-800 px-3 py-2">
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                {t("finance.closing.difference")}
              </span>
              <span className={`text-sm font-bold ${differenceClass(liveDifference)}`}>
                {money(liveDifference)}
              </span>
            </div>
          ) : null}

          <Field label={t("finance.common.notes")}>
            <textarea
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
              rows={2}
              maxLength={2000}
              className="w-full rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary-500"
            />
          </Field>
          <FieldError error={formError || undefined} />
        </div>
      </Modal>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail ? formatDate(detail.business_date) : ""}
        subtitle={t("finance.closing.detail_desc")}
        maxWidth="sm:max-w-2xl"
        footer={
          <>
            <button type="button" onClick={() => setDetail(null)} className={btnSecondary}>
              {t("finance.common.close")}
            </button>
            {detail?.status === "submitted" && canApprove ? (
              <button
                type="button"
                onClick={() => detail && approveClosing(detail)}
                disabled={busy === `approve-${detail?.id}`}
                className={btnPrimary}
              >
                {busy === `approve-${detail?.id}` ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" />
                )}
                {t("finance.common.approve")}
              </button>
            ) : null}
          </>
        }
      >
        {detail ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <StatusPill status={detail.status} />
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {t("finance.closing.expected")}: {money(detail.expected_cash)} •{" "}
                {t("finance.closing.counted")}: {money(detail.counted_cash)}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <SummaryCard label={t("finance.closing.opening")} value={money(detail.opening_cash)} />
              <SummaryCard label={t("finance.closing.cash_in")} value={money(detail.cash_in)} tone="emerald" />
              <SummaryCard label={t("finance.closing.cash_out")} value={money(detail.cash_out)} tone="rose" />
              <SummaryCard
                label={t("finance.closing.difference")}
                value={money(detail.difference)}
                tone={detail.difference === 0 ? "slate" : detail.difference > 0 ? "emerald" : "rose"}
              />
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">
                {t("finance.closing.stock_snapshot")}
              </p>
              {detail.stock_snapshot && Object.keys(detail.stock_snapshot).length ? (
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(detail.stock_snapshot).map(([status, count]) => (
                    <span
                      key={status}
                      className="inline-flex items-center gap-1 rounded-full border border-gray-200 dark:border-slate-700 px-2 py-0.5 text-[11px]"
                    >
                      <span className="capitalize">{status.replace(/_/g, " ")}</span>
                      <span className="font-bold">{count}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-500">—</p>
              )}
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">
                {t("finance.closing.employee_snapshot")}
              </p>
              {detail.employee_snapshot && detail.employee_snapshot.length ? (
                <div className="max-h-36 overflow-y-auto rounded-xl border border-gray-100 dark:border-slate-800 divide-y divide-gray-50 dark:divide-slate-800">
                  {detail.employee_snapshot.map((row) => (
                    <div
                      key={row.employee_id}
                      className="flex items-center justify-between px-3 py-1.5 text-xs"
                    >
                      <span>{row.employee_name || `#${row.employee_id}`}</span>
                      <span className="font-semibold">{row.assigned}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-500">—</p>
              )}
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">
                {t("finance.closing.topup_snapshot")}
              </p>
              {detail.topup_snapshot && detail.topup_snapshot.length ? (
                <div className="max-h-36 overflow-y-auto rounded-xl border border-gray-100 dark:border-slate-800 divide-y divide-gray-50 dark:divide-slate-800">
                  {detail.topup_snapshot.map((row) => (
                    <div
                      key={`${row.employee_id ?? "mother"}`}
                      className="flex items-center justify-between px-3 py-1.5 text-xs"
                    >
                      <span>
                        {row.employee_id === null ? t("finance.itopup.mother_sim") : `#${row.employee_id}`}
                      </span>
                      <span className="font-semibold">{money(row.balance)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-500">—</p>
              )}
            </div>

            {detail.notes ? (
              <p className="text-xs text-gray-500 dark:text-gray-400">{detail.notes}</p>
            ) : null}
            {detail.reopen_reason ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {t("finance.closing.reopen_reason")}: {detail.reopen_reason}
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(reopenTarget)}
        onClose={() => setReopenTarget(null)}
        title={t("finance.closing.reopen_title")}
        subtitle={reopenTarget ? formatDate(reopenTarget.business_date) : undefined}
        busy={busy === `reopen-${reopenTarget?.id}`}
        footer={
          <>
            <button type="button" onClick={() => setReopenTarget(null)} className={btnSecondary}>
              {t("finance.common.cancel")}
            </button>
            <button
              type="button"
              onClick={submitReopen}
              disabled={busy === `reopen-${reopenTarget?.id}`}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold disabled:opacity-50 cursor-pointer"
            >
              {busy === `reopen-${reopenTarget?.id}` ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RotateCcw className="w-4 h-4" />
              )}
              {t("finance.closing.reopen")}
            </button>
          </>
        }
      >
        <Field label={t("finance.closing.reopen_reason")} required error={reopenError || undefined}>
          <textarea
            value={reopenReason}
            onChange={(event) => {
              setReopenReason(event.target.value);
              setReopenError(null);
            }}
            rows={3}
            maxLength={500}
            className="w-full rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary-500"
            placeholder={t("finance.closing.reopen_reason_placeholder")}
          />
        </Field>
      </Modal>
    </div>
  );
}
