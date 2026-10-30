"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Download,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Wallet,
  XCircle,
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
  inputClass,
  money,
  searchInputClass,
  selectClass,
  todayISO,
  type PaginationMeta,
} from "@/components/finance/ui";

const PER_PAGE = 20;

interface ExpenseRow {
  id: number;
  business_date: string | null;
  source: string;
  category_id: number | null;
  category_name: string | null;
  employee_id: number | null;
  employee_name: string | null;
  description: string;
  amount: number;
  status: string;
  rejection_reason: string | null;
  payment_reference: string | null;
  notes: string | null;
  created_at: string | null;
  approved_at: string | null;
  paid_at: string | null;
}

interface CategoryOption {
  id: number;
  name: string;
  source: string;
}

interface EmployeeOption {
  id: number;
  employee_name: string | null;
  employee_id: string | null;
  dms_code: string | null;
  employee_type: string | null;
}

interface CashAccountOption {
  id: number;
  name: string;
  account_type: string;
}

type Summary = {
  total: { count: number; amount: number };
  by_status: Record<string, { count: number; amount: number }>;
};

const EMPTY_FORM = {
  source: "house",
  category_id: "",
  employee_id: "",
  business_date: todayISO(),
  description: "",
  amount: "",
  notes: "",
};

export default function ExpensesPage() {
  const { t } = useLanguage();
  const { hasPermission, selectedHouse } = useAuth();
  const houseId = selectedHouse?.id;

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [accounts, setAccounts] = useState<CashAccountOption[]>([]);

  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const [rejectTarget, setRejectTarget] = useState<ExpenseRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [payTarget, setPayTarget] = useState<ExpenseRow | null>(null);
  const [payAccount, setPayAccount] = useState("");
  const [payReference, setPayReference] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canCreate = hasPermission("finance.expense_create");
  const canApprove = hasPermission("finance.expense_approve");
  const canPay = hasPermission("finance.expense_pay");
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
    if (statusFilter) params.status = statusFilter;
    if (sourceFilter) params.source = sourceFilter;
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    return params;
  }, [debouncedSearch, statusFilter, sourceFilter, dateFrom, dateTo]);

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
          apiClient.get("/v1/finance/expenses", { params, headers }),
          apiClient
            .get("/v1/finance/expenses/summary", { params: filterParams(), headers })
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

  useEffect(() => {
    if (!houseId) return;
    apiClient
      .get("/v1/finance/expense-categories", { headers })
      .then((res) => setCategories(res.data?.data || []))
      .catch(() => setCategories([]));
    apiClient
      .get("/v1/finance/employees", { headers })
      .then((res) => setEmployees(res.data?.data || []))
      .catch(() => setEmployees([]));
    apiClient
      .get("/v1/finance/cash-accounts", { headers })
      .then((res) => setAccounts(res.data?.data || []))
      .catch(() => setAccounts([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [houseId]);

  const openCreate = () => {
    setForm({ ...EMPTY_FORM });
    setFieldErrors({});
    setFormError(null);
    setShowCreate(true);
  };

  const submitExpense = async () => {
    const errors: Record<string, string> = {};
    if (form.description.trim().length < 3) {
      errors.description = t("finance.expenses.validation.description");
    }
    const amount = Number(form.amount);
    if (!form.amount || Number.isNaN(amount) || amount <= 0) {
      errors.amount = t("finance.expenses.validation.amount");
    }
    if (!form.source) errors.source = t("finance.common.required_field");
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      await apiClient.post(
        "/v1/finance/expenses",
        {
          source: form.source,
          category_id: form.category_id ? Number(form.category_id) : null,
          employee_id: form.employee_id ? Number(form.employee_id) : null,
          business_date: form.business_date || null,
          description: form.description.trim(),
          amount,
          notes: form.notes.trim() || null,
        },
        { headers }
      );
      toast.success(t("finance.expenses.created"));
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

  const runAction = async (
    key: string,
    id: number,
    action: "approve" | "reject" | "pay",
    payload?: Record<string, unknown>,
    successKey?: string
  ) => {
    setBusy(key);
    try {
      await apiClient.post(`/v1/finance/expenses/${id}/${action}`, payload || {}, { headers });
      toast.success(t(successKey || "finance.common.saved"));
      await fetchData(true);
      return true;
    } catch (err) {
      toast.error(apiError(err, t("finance.common.error_generic")).message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const submitReject = async () => {
    if (!rejectTarget) return;
    if (rejectReason.trim().length < 3) {
      setRejectError(t("finance.expenses.validation.reason"));
      return;
    }
    const ok = await runAction(
      `reject-${rejectTarget.id}`,
      rejectTarget.id,
      "reject",
      { reason: rejectReason.trim() },
      "finance.expenses.rejected"
    );
    if (ok) {
      setRejectTarget(null);
      setRejectReason("");
      setRejectError(null);
    }
  };

  const submitPay = async () => {
    if (!payTarget) return;
    const ok = await runAction(
      `pay-${payTarget.id}`,
      payTarget.id,
      "pay",
      {
        account_id: payAccount ? Number(payAccount) : null,
        reference: payReference.trim() || null,
      },
      "finance.expenses.paid"
    );
    if (ok) {
      setPayTarget(null);
      setPayAccount("");
      setPayReference("");
    }
  };

  const handleExport = async () => {
    if (!houseId) return;
    setExporting(true);
    try {
      const res = await apiClient.get("/v1/finance/expenses/export", {
        params: filterParams(),
        headers,
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.download = `finance_expenses_${todayISO()}.xlsx`;
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
    setStatusFilter("");
    setSourceFilter("");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  };

  const sourceLabel = (source: string) => t(`finance.common.sources.${source}`);
  const filteredCategories = categories.filter((item) => item.source === form.source);

  const renderActions = (row: ExpenseRow, compact = false) => {
    const buttons = [];
    if (row.status === "pending" && canApprove) {
      buttons.push(
        <button
          key="approve"
          type="button"
          disabled={busy === `approve-${row.id}`}
          onClick={() => runAction(`approve-${row.id}`, row.id, "approve", {}, "finance.expenses.approved")}
          className={`inline-flex items-center gap-1 rounded-lg border border-emerald-200 dark:border-emerald-500/30 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 disabled:opacity-50 cursor-pointer ${
            compact ? "" : "whitespace-nowrap"
          }`}
        >
          {busy === `approve-${row.id}` ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5" />
          )}
          {t("finance.common.approve")}
        </button>
      );
    }
    if (row.status === "approved" && canPay) {
      buttons.push(
        <button
          key="pay"
          type="button"
          onClick={() => {
            setPayTarget(row);
            setPayAccount(accounts[0]?.id ? String(accounts[0].id) : "");
            setPayReference("");
          }}
          className="inline-flex items-center gap-1 rounded-lg border border-primary-200 dark:border-primary-500/30 px-2.5 py-1.5 text-xs font-semibold text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-500/10 cursor-pointer whitespace-nowrap"
        >
          <CreditCard className="w-3.5 h-3.5" />
          {t("finance.common.pay")}
        </button>
      );
    }
    if ((row.status === "pending" || row.status === "approved") && canApprove) {
      buttons.push(
        <button
          key="reject"
          type="button"
          onClick={() => {
            setRejectTarget(row);
            setRejectReason("");
            setRejectError(null);
          }}
          className="inline-flex items-center gap-1 rounded-lg border border-rose-200 dark:border-rose-500/30 px-2.5 py-1.5 text-xs font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-500/10 cursor-pointer whitespace-nowrap"
        >
          <XCircle className="w-3.5 h-3.5" />
          {t("finance.common.reject")}
        </button>
      );
    }
    if (!buttons.length) {
      return <span className="text-[11px] text-gray-400">—</span>;
    }
    return <div className="flex flex-wrap items-center gap-1.5">{buttons}</div>;
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
              {t("finance.expenses.title")}
            </h1>
            <PageGuideModal pageKey="finance.expenses" />
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("finance.expenses.description")}
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
              {t("finance.expenses.new")}
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
            <SummaryCard
              label={t("finance.common.statuses.pending")}
              value={money(summary?.by_status.pending?.amount)}
              hint={`${summary?.by_status.pending?.count ?? 0} ${t("finance.common.records")}`}
              tone="amber"
            />
            <SummaryCard
              label={t("finance.common.statuses.approved")}
              value={money(summary?.by_status.approved?.amount)}
              hint={`${summary?.by_status.approved?.count ?? 0} ${t("finance.common.records")}`}
              tone="blue"
            />
            <SummaryCard
              label={t("finance.common.statuses.paid")}
              value={money(summary?.by_status.paid?.amount)}
              hint={`${summary?.by_status.paid?.count ?? 0} ${t("finance.common.records")}`}
              tone="emerald"
            />
            <SummaryCard
              label={t("finance.expenses.filtered_total")}
              value={money(summary?.total?.amount)}
              hint={`${summary?.total?.count ?? 0} ${t("finance.common.records")}`}
              tone="slate"
            />
          </div>

          <div className={cardClass}>
            <div className="p-3 sm:p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 border-b border-gray-50 dark:border-slate-800">
              <div className="relative lg:col-span-2">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t("finance.expenses.search_placeholder")}
                  className={searchInputClass}
                />
              </div>
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
                <option value="pending">{t("finance.common.statuses.pending")}</option>
                <option value="approved">{t("finance.common.statuses.approved")}</option>
                <option value="paid">{t("finance.common.statuses.paid")}</option>
                <option value="rejected">{t("finance.common.statuses.rejected")}</option>
              </select>
              <select
                value={sourceFilter}
                onChange={(event) => {
                  setSourceFilter(event.target.value);
                  setPage(1);
                }}
                className={selectClass}
                aria-label={t("finance.common.source")}
              >
                <option value="">{t("finance.common.all_sources")}</option>
                <option value="house">{t("finance.common.sources.house")}</option>
                <option value="route">{t("finance.common.sources.route")}</option>
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

            {(search || statusFilter || sourceFilter || dateFrom || dateTo) && (
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
                title={t("finance.expenses.empty")}
                description={t("finance.expenses.empty_desc")}
              />
            ) : (
              <>
                <div className="hidden lg:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-slate-800/50 text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      <tr>
                        <th className="px-2 py-2">{t("finance.common.date")}</th>
                        <th className="px-2 py-2">{t("finance.common.description")}</th>
                        <th className="px-2 py-2">{t("finance.common.employee")}</th>
                        <th className="px-2 py-2 text-right">{t("finance.common.amount")}</th>
                        <th className="px-2 py-2">{t("finance.common.status")}</th>
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
                            <p className="font-medium">{row.description}</p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">
                              {row.category_name || t("finance.common.uncategorized")} •{" "}
                              {sourceLabel(row.source)}
                            </p>
                            {row.rejection_reason ? (
                              <p className="text-[11px] text-rose-600 dark:text-rose-400">
                                {t("finance.expenses.reason")}: {row.rejection_reason}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-2 py-1">
                            <p>{row.employee_name || "—"}</p>
                          </td>
                          <td className="px-2 py-1 text-right font-semibold whitespace-nowrap">
                            {money(row.amount)}
                          </td>
                          <td className="px-2 py-1">
                            <StatusPill status={row.status} />
                          </td>
                          <td className="px-2 py-1 text-right">{renderActions(row)}</td>
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
                            <p className="font-semibold text-sm truncate">{row.description}</p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                              {formatDate(row.business_date)} • {sourceLabel(row.source)}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-bold">{money(row.amount)}</p>
                            <StatusPill status={row.status} />
                          </div>
                          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                        {open ? (
                          <div className="px-4 pb-4 space-y-2 text-sm">
                            <div className="flex justify-between gap-3">
                              <span className="text-xs text-gray-500">{t("finance.common.employee")}</span>
                              <span className="text-sm font-medium">{row.employee_name || "—"}</span>
                            </div>
                            <div className="flex justify-between gap-3">
                              <span className="text-xs text-gray-500">{t("finance.common.category")}</span>
                              <span className="text-sm font-medium">
                                {row.category_name || t("finance.common.uncategorized")}
                              </span>
                            </div>
                            {row.rejection_reason ? (
                              <div className="flex justify-between gap-3">
                                <span className="text-xs text-gray-500">{t("finance.expenses.reason")}</span>
                                <span className="text-sm font-medium text-rose-600 dark:text-rose-400 text-right">
                                  {row.rejection_reason}
                                </span>
                              </div>
                            ) : null}
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
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title={t("finance.expenses.create_title")}
        subtitle={t("finance.expenses.create_desc")}
        busy={saving}
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
            <button type="button" onClick={submitExpense} disabled={saving} className={btnPrimary}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {saving ? t("finance.common.saving") : t("finance.common.save")}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label={t("finance.common.source")} required error={fieldErrors.source}>
            <select
              value={form.source}
              onChange={(event) =>
                setForm({ ...form, source: event.target.value, category_id: "" })
              }
              className={selectClass}
            >
              <option value="house">{t("finance.common.sources.house")}</option>
              <option value="route">{t("finance.common.sources.route")}</option>
            </select>
          </Field>
          <Field label={t("finance.common.category")}>
            <select
              value={form.category_id}
              onChange={(event) => setForm({ ...form, category_id: event.target.value })}
              className={selectClass}
            >
              <option value="">{t("finance.common.uncategorized")}</option>
              {filteredCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("finance.common.employee")}>
            <select
              value={form.employee_id}
              onChange={(event) => setForm({ ...form, employee_id: event.target.value })}
              className={selectClass}
            >
              <option value="">{t("finance.common.no_employee")}</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.employee_name} ({employee.employee_type})
                </option>
              ))}
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
          <div className="md:col-span-2">
            <Field
              label={t("finance.common.description")}
              required
              error={fieldErrors.description}
            >
              <input
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                placeholder={t("finance.expenses.description_placeholder")}
                maxLength={500}
                className={inputClass}
              />
            </Field>
          </div>
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
        </div>
        <FieldError error={formError || undefined} />
      </Modal>

      <Modal
        open={Boolean(rejectTarget)}
        onClose={() => setRejectTarget(null)}
        title={t("finance.expenses.reject_title")}
        subtitle={rejectTarget?.description}
        busy={busy === `reject-${rejectTarget?.id}`}
        footer={
          <>
            <button type="button" onClick={() => setRejectTarget(null)} className={btnSecondary}>
              {t("finance.common.cancel")}
            </button>
            <button
              type="button"
              onClick={submitReject}
              disabled={busy === `reject-${rejectTarget?.id}`}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold disabled:opacity-50 cursor-pointer"
            >
              {busy === `reject-${rejectTarget?.id}` ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <XCircle className="w-4 h-4" />
              )}
              {t("finance.common.reject")}
            </button>
          </>
        }
      >
        <Field label={t("finance.expenses.reason")} required error={rejectError || undefined}>
          <textarea
            value={rejectReason}
            onChange={(event) => {
              setRejectReason(event.target.value);
              setRejectError(null);
            }}
            rows={3}
            maxLength={500}
            className={inputClass}
            placeholder={t("finance.expenses.reason_placeholder")}
          />
        </Field>
      </Modal>

      <Modal
        open={Boolean(payTarget)}
        onClose={() => setPayTarget(null)}
        title={t("finance.expenses.pay_title")}
        subtitle={`${payTarget?.description || ""} • ${money(payTarget?.amount)}`}
        busy={busy === `pay-${payTarget?.id}`}
        footer={
          <>
            <button type="button" onClick={() => setPayTarget(null)} className={btnSecondary}>
              {t("finance.common.cancel")}
            </button>
            <button
              type="button"
              onClick={submitPay}
              disabled={busy === `pay-${payTarget?.id}`}
              className={btnPrimary}
            >
              {busy === `pay-${payTarget?.id}` ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CreditCard className="w-4 h-4" />
              )}
              {t("finance.common.pay")}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3">
          <Field label={t("finance.cashbook.account")}>
            <select
              value={payAccount}
              onChange={(event) => setPayAccount(event.target.value)}
              className={selectClass}
            >
              {accounts.length === 0 ? <option value="">{t("finance.cashbook.default_account")}</option> : null}
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("finance.common.reference")}>
            <input
              value={payReference}
              onChange={(event) => setPayReference(event.target.value)}
              maxLength={120}
              className={inputClass}
              placeholder={t("finance.common.optional")}
            />
          </Field>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {t("finance.expenses.pay_hint")}
          </p>
        </div>
      </Modal>
    </div>
  );
}
