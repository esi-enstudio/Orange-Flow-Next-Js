"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Eye,
  Loader2,
  PackageMinus,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { toast } from "react-hot-toast";

import axios from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import { AccessDenied } from "@/components/ui/AccessDenied";
import PageGuideModal from "@/components/PageGuideModal";
import { InventoryStatusBadge } from "@/components/inventory/InventoryStatusBadge";
import { SerialsInput, parseSerials } from "@/components/inventory/SerialsInput";
import { apiError, formatDate, houseHeaders } from "@/components/inventory/helpers";

const PER_PAGE = 20;
const TODAY = new Date().toISOString().slice(0, 10);

interface ProductOption {
  id: number;
  product_name: string;
  category: string;
}

interface EmployeeOption {
  id: number;
  employee_name?: string | null;
  employee_id?: string | null;
  dms_code?: string | null;
  employee_type?: string | null;
  assigned_count: number;
}

interface IssueRow {
  id: number;
  document_no: string | null;
  status: string;
  business_date?: string | null;
  product_name?: string | null;
  employee_name?: string | null;
  dms_code?: string | null;
  total_quantity: number;
  serials_count?: number;
  created_at?: string | null;
}

interface IssueDetail extends IssueRow {
  notes?: string | null;
  serials: { serial_number: string; status_after?: string | null }[];
}

interface PaginationMeta {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

export default function StockIssuePage() {
  const { t } = useLanguage();
  const { hasPermission, selectedHouse } = useAuth();
  const houseId = selectedHouse?.id;

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<IssueRow[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [products, setProducts] = useState<ProductOption[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    employee_id: "",
    product_id: "",
    business_date: TODAY,
    notes: "",
  });
  const [serials, setSerials] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [detail, setDetail] = useState<IssueDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canIssue = hasPermission("inventory.issue");
  const parsed = useMemo(() => parseSerials(serials), [serials]);

  const fetchIssues = useCallback(async () => {
    if (!houseId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, per_page: PER_PAGE };
      if (search) params.search = search;
      if (employeeFilter) params.employee_id = Number(employeeFilter);
      const res = await axios.get("/v1/inventory/issues", {
        params,
        headers: houseHeaders(houseId),
      });
      setRows(res.data.data || []);
      setPagination(res.data.pagination || null);
    } catch (err) {
      toast.error(apiError(err, t("inventory.common.error_generic")).message);
    } finally {
      setLoading(false);
    }
  }, [houseId, page, search, employeeFilter, t]);

  useEffect(() => {
    fetchIssues();
  }, [fetchIssues]);

  useEffect(() => {
    if (!houseId) return;
    axios
      .get("/v1/inventory/products", { headers: houseHeaders(houseId) })
      .then((res) => setProducts(res.data.data || []))
      .catch(() => setProducts([]));
    axios
      .get("/v1/inventory/employees", { headers: houseHeaders(houseId) })
      .then((res) => setEmployees(res.data.data || []))
      .catch(() => setEmployees([]));
  }, [houseId]);

  const openDetail = async (id: number) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await axios.get(`/v1/inventory/issues/${id}`, {
        headers: houseHeaders(houseId),
      });
      setDetail(res.data.data);
    } catch (err) {
      toast.error(apiError(err, t("inventory.common.error_generic")).message);
    } finally {
      setDetailLoading(false);
    }
  };

  const resetForm = () => {
    setForm({ employee_id: "", product_id: "", business_date: TODAY, notes: "" });
    setSerials("");
    setFormError(null);
    setFieldErrors({});
  };

  const submitIssue = async () => {
    setFormError(null);
    const errors: Record<string, string> = {};
    if (!form.employee_id) errors.employee_id = t("inventory.common.required_field");
    if (!form.product_id) errors.product_id = t("inventory.common.required_field");
    if (parsed.valid.length === 0) errors.serials = t("inventory.common.required_field");
    if (parsed.duplicates.length || parsed.invalid.length) {
      errors.serials = `${t("inventory.common.duplicates")}: ${parsed.duplicates.length}, ${t("inventory.common.invalid")}: ${parsed.invalid.length}`;
    }
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      return;
    }

    setSaving(true);
    try {
      const res = await axios.post(
        "/v1/inventory/issues",
        {
          employee_id: Number(form.employee_id),
          product_id: Number(form.product_id),
          business_date: form.business_date || null,
          notes: form.notes || null,
          serials: parsed.valid,
        },
        { headers: houseHeaders(houseId) }
      );
      toast.success(t("inventory.issues.issued_toast"));
      setShowCreate(false);
      resetForm();
      await fetchIssues();
      if (res.data?.data?.id) await openDetail(res.data.data.id);
    } catch (err) {
      const { message, fields } = apiError(err, t("inventory.common.error_generic"));
      setFormError(message);
      if (fields) setFieldErrors(fields);
    } finally {
      setSaving(false);
    }
  };

  const handleSearch = (value: string) => {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setPage(1), 400);
  };

  if (!hasPermission("inventory.view")) return <AccessDenied />;

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="p-2.5 bg-indigo-100 dark:bg-indigo-500/20 rounded-xl">
          <PackageMinus className="w-5 h-5 text-indigo-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {t("inventory.issues.title")}
            </h1>
            <PageGuideModal pageKey="inventory.issues" />
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("inventory.issues.description")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchIssues}
            className="p-2.5 rounded-xl border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer"
            title={t("inventory.common.refresh")}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          {canIssue ? (
            <button
              onClick={() => {
                resetForm();
                setShowCreate(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              {t("inventory.common.new_issue")}
            </button>
          ) : null}
        </div>
      </div>

      {!houseId ? (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
          {t("inventory.common.require_house")}
        </div>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(event) => handleSearch(event.target.value)}
                placeholder={t("inventory.common.search_placeholder")}
                className="w-full rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 pl-9 pr-3 py-2.5 text-sm cursor-text outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <select
              value={employeeFilter}
              onChange={(event) => {
                setEmployeeFilter(event.target.value);
                setPage(1);
              }}
              className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm cursor-pointer outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">{t("inventory.common.all_employees")}</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.employee_name} ({employee.assigned_count})
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-2xl border border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            {loading ? (
              <div className="divide-y divide-gray-50 dark:divide-slate-800">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="flex items-center gap-4 px-4 py-4 animate-pulse">
                    <div className="space-y-2 flex-1">
                      <div className="h-3 w-32 bg-gray-200 dark:bg-slate-700 rounded-md" />
                      <div className="h-2.5 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
                    </div>
                    <div className="h-5 w-16 bg-gray-100 dark:bg-slate-800 rounded-full" />
                  </div>
                ))}
              </div>
            ) : rows.length === 0 ? (
              <div className="p-10 text-center">
                <PackageMinus className="w-10 h-10 mx-auto text-gray-300 dark:text-slate-600" />
                <p className="mt-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
                  {t("inventory.issues.empty")}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("inventory.issues.empty_desc")}
                </p>
              </div>
            ) : (
              <>
                <div className="hidden lg:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-slate-800/50 text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      <tr>
                        <th className="px-2 py-2">{t("inventory.common.document_no")}</th>
                        <th className="px-2 py-2">{t("inventory.common.employee")}</th>
                        <th className="px-2 py-2">{t("inventory.common.product")}</th>
                        <th className="px-2 py-2 text-right">{t("inventory.common.quantity")}</th>
                        <th className="px-2 py-2">{t("inventory.common.status")}</th>
                        <th className="px-2 py-2 text-right">{t("inventory.common.details")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                      {rows.map((row) => (
                        <tr key={row.id} className="hover:bg-gray-50/60 dark:hover:bg-slate-800/40">
                          <td className="px-2 py-1">
                            <p className="font-semibold">{row.document_no}</p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">
                              {formatDate(row.business_date)}
                            </p>
                          </td>
                          <td className="px-2 py-1">
                            <p className="font-medium">{row.employee_name}</p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">{row.dms_code}</p>
                          </td>
                          <td className="px-2 py-1">{row.product_name}</td>
                          <td className="px-2 py-1 text-right font-semibold">{row.total_quantity}</td>
                          <td className="px-2 py-1">
                            <InventoryStatusBadge status={row.status} />
                          </td>
                          <td className="px-2 py-1 text-right">
                            <button
                              onClick={() => openDetail(row.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 text-xs font-semibold hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              {t("inventory.common.view")}
                            </button>
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
                          onClick={() => setExpandedId(open ? null : row.id)}
                          className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm truncate">{row.document_no}</p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                              {row.employee_name} • {row.product_name}
                            </p>
                          </div>
                          <span className="text-sm font-bold">{row.total_quantity}</span>
                          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                        {open ? (
                          <div className="px-4 pb-4 space-y-1.5 text-sm">
                            <div className="flex justify-between gap-3">
                              <span className="text-xs text-gray-500">{t("inventory.common.date")}</span>
                              <span className="text-sm font-medium">{formatDate(row.business_date)}</span>
                            </div>
                            <button
                              onClick={() => openDetail(row.id)}
                              className="mt-2 inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" /> {t("inventory.common.view")}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {pagination && pagination.total_pages > 1 ? (
            <div className="flex items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span>
                {pagination.page} / {pagination.total_pages} • {pagination.total}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  disabled={!pagination.has_prev}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {t("inventory.common.previous")}
                </button>
                <button
                  onClick={() => setPage((value) => value + 1)}
                  disabled={!pagination.has_next}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {t("inventory.common.next")}
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}

      {showCreate ? (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="fixed inset-0 bg-black/40" onClick={() => !saving && setShowCreate(false)} />
          <div className="relative w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl shadow-2xl border border-gray-100 dark:border-slate-800 p-4 sm:p-6">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  {t("inventory.issues.create_title")}
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("inventory.issues.create_desc")}
                </p>
              </div>
              <button
                onClick={() => !saving && setShowCreate(false)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 cursor-pointer"
                aria-label={t("inventory.common.close")}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                  {t("inventory.common.employee")} <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.employee_id}
                  onChange={(event) => setForm({ ...form, employee_id: event.target.value })}
                  className="w-full rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm cursor-pointer outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">{t("inventory.common.select_employee")}</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.employee_name} — {employee.employee_type} ({employee.assigned_count})
                    </option>
                  ))}
                </select>
                {fieldErrors.employee_id ? (
                  <p className="text-xs text-red-600 mt-1">{fieldErrors.employee_id}</p>
                ) : null}
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                  {t("inventory.common.product")} <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.product_id}
                  onChange={(event) => setForm({ ...form, product_id: event.target.value })}
                  className="w-full rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm cursor-pointer outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">{t("inventory.common.select_product")}</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.product_name} ({product.category})
                    </option>
                  ))}
                </select>
                {fieldErrors.product_id ? (
                  <p className="text-xs text-red-600 mt-1">{fieldErrors.product_id}</p>
                ) : null}
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                  {t("inventory.common.business_date")}
                </label>
                <input
                  type="date"
                  value={form.business_date}
                  max={TODAY}
                  onChange={(event) => setForm({ ...form, business_date: event.target.value })}
                  className="w-full rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm cursor-pointer outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                  {t("inventory.common.notes")}
                </label>
                <input
                  value={form.notes}
                  onChange={(event) => setForm({ ...form, notes: event.target.value })}
                  className="w-full rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm cursor-text outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div className="md:col-span-2">
                <SerialsInput
                  value={serials}
                  onChange={(value) => {
                    setSerials(value);
                    setFieldErrors((current) => ({ ...current, serials: "" }));
                  }}
                  error={fieldErrors.serials || null}
                  disabled={saving}
                />
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                  {t("inventory.issues.select_serials_hint")}
                </p>
              </div>
            </div>

            {formError ? (
              <p className="mt-3 text-sm text-red-600 dark:text-red-400">{formError}</p>
            ) : null}

            <div className="flex items-center justify-between gap-2 mt-5 flex-wrap">
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                {t("inventory.common.serials")}: {parsed.valid.length}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowCreate(false)}
                  disabled={saving}
                  className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                >
                  {t("inventory.common.cancel")}
                </button>
                <button
                  onClick={submitIssue}
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold disabled:opacity-50 cursor-pointer"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {saving ? t("inventory.common.saving") : t("inventory.common.submit")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {detail || detailLoading ? (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="fixed inset-0 bg-black/40" onClick={() => setDetail(null)} />
          <div className="relative w-full sm:max-w-lg max-h-[92vh] overflow-y-auto bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl shadow-2xl border border-gray-100 dark:border-slate-800 p-4 sm:p-6">
            {detailLoading || !detail ? (
              <div className="space-y-3 animate-pulse">
                <div className="h-4 w-40 bg-gray-200 dark:bg-slate-700 rounded" />
                <div className="h-20 bg-gray-100 dark:bg-slate-800 rounded-xl" />
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                      {detail.document_no}
                    </h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {detail.employee_name} • {formatDate(detail.business_date)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <InventoryStatusBadge status={detail.status} />
                    <button
                      onClick={() => setDetail(null)}
                      className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 cursor-pointer"
                      aria-label={t("inventory.common.close")}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                  <div>
                    <p className="text-[11px] text-gray-500">{t("inventory.common.product")}</p>
                    <p className="font-medium">{detail.product_name}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-gray-500">{t("inventory.common.quantity")}</p>
                    <p className="font-medium">{detail.total_quantity}</p>
                  </div>
                </div>

                <p className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 mb-1.5">
                  {t("inventory.common.serials")} ({detail.serials.length})
                </p>
                <div className="max-h-64 overflow-y-auto rounded-xl border border-gray-100 dark:border-slate-800 divide-y divide-gray-50 dark:divide-slate-800">
                  {detail.serials.map((line) => (
                    <div key={line.serial_number} className="flex items-center justify-between px-3 py-1.5 text-xs font-mono">
                      <span>{line.serial_number}</span>
                      <InventoryStatusBadge status={line.status_after || "assigned"} />
                    </div>
                  ))}
                </div>
                {detail.notes ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">{detail.notes}</p>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
