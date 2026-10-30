"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  PackageSearch,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
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
type Decision = "accept" | "damaged" | "reject";

interface ProductOption {
  id: number;
  product_name: string;
  category: string;
}

interface EmployeeOption {
  id: number;
  employee_name?: string | null;
  employee_type?: string | null;
  assigned_count: number;
}

interface ReturnRow {
  id: number;
  document_no: string | null;
  status: string;
  business_date?: string | null;
  product_name?: string | null;
  employee_name?: string | null;
  dms_code?: string | null;
  total_quantity: number;
  created_at?: string | null;
}

interface ReturnDetail extends ReturnRow {
  reason?: string | null;
  notes?: string | null;
  serials: { serial_number: string; status_after?: string | null; action: string }[];
}

interface PaginationMeta {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

export default function StockReturnsPage() {
  const { t } = useLanguage();
  const { hasPermission, selectedHouse } = useAuth();
  const houseId = selectedHouse?.id;

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ReturnRow[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
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
    reason: "",
    notes: "",
  });
  const [serials, setSerials] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [verifyDoc, setVerifyDoc] = useState<ReturnDetail | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [verifyNotes, setVerifyNotes] = useState("");
  const [verifying, setVerifying] = useState(false);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canReturn = hasPermission("inventory.return");
  const canVerify = hasPermission("inventory.verify");
  const parsed = useMemo(() => parseSerials(serials), [serials]);

  const fetchReturns = useCallback(async () => {
    if (!houseId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, per_page: PER_PAGE };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (employeeFilter) params.employee_id = Number(employeeFilter);
      const res = await axios.get("/v1/inventory/returns", {
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
  }, [houseId, page, search, statusFilter, employeeFilter, t]);

  useEffect(() => {
    fetchReturns();
  }, [fetchReturns]);

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

  const resetForm = () => {
    setForm({ employee_id: "", product_id: "", business_date: TODAY, reason: "", notes: "" });
    setSerials("");
    setFormError(null);
    setFieldErrors({});
  };

  const submitReturn = async () => {
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
      await axios.post(
        "/v1/inventory/returns",
        {
          employee_id: Number(form.employee_id),
          product_id: Number(form.product_id),
          business_date: form.business_date || null,
          reason: form.reason || null,
          notes: form.notes || null,
          serials: parsed.valid,
        },
        { headers: houseHeaders(houseId) }
      );
      toast.success(t("inventory.returns.created_toast"));
      setShowCreate(false);
      resetForm();
      await fetchReturns();
    } catch (err) {
      const { message, fields } = apiError(err, t("inventory.common.error_generic"));
      setFormError(message);
      if (fields) setFieldErrors(fields);
    } finally {
      setSaving(false);
    }
  };

  const openVerify = async (id: number) => {
    setVerifyLoading(true);
    setVerifyDoc(null);
    try {
      const res = await axios.get(`/v1/inventory/returns/${id}`, {
        headers: houseHeaders(houseId),
      });
      const data: ReturnDetail = res.data.data;
      setVerifyDoc(data);
      setVerifyNotes(data.notes || "");
      setDecisions(
        Object.fromEntries(data.serials.map((line) => [line.serial_number, "accept" as Decision]))
      );
    } catch (err) {
      toast.error(apiError(err, t("inventory.common.error_generic")).message);
    } finally {
      setVerifyLoading(false);
    }
  };

  const submitVerify = async () => {
    if (!verifyDoc) return;
    setVerifying(true);
    try {
      await axios.post(
        `/v1/inventory/returns/${verifyDoc.id}/verify`,
        {
          decisions: verifyDoc.serials.map((line) => ({
            serial_number: line.serial_number,
            decision: decisions[line.serial_number] || "accept",
          })),
          notes: verifyNotes || null,
        },
        { headers: houseHeaders(houseId) }
      );
      toast.success(t("inventory.returns.verified_toast"));
      setVerifyDoc(null);
      await fetchReturns();
    } catch (err) {
      toast.error(apiError(err, t("inventory.common.error_generic")).message);
    } finally {
      setVerifying(false);
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
        <div className="p-2.5 bg-amber-100 dark:bg-amber-500/20 rounded-xl">
          <PackageSearch className="w-5 h-5 text-amber-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {t("inventory.returns.title")}
            </h1>
            <PageGuideModal pageKey="inventory.returns" />
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("inventory.returns.description")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchReturns}
            className="p-2.5 rounded-xl border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer"
            title={t("inventory.common.refresh")}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          {canReturn ? (
            <button
              onClick={() => {
                resetForm();
                setShowCreate(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              {t("inventory.common.new_return")}
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
                  {employee.employee_name}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value);
                setPage(1);
              }}
              className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm cursor-pointer outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">{t("inventory.common.all_status")}</option>
              <option value="submitted">{t("inventory.status.submitted")}</option>
              <option value="verified">{t("inventory.status.verified")}</option>
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
                <PackageSearch className="w-10 h-10 mx-auto text-gray-300 dark:text-slate-600" />
                <p className="mt-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
                  {t("inventory.returns.empty")}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("inventory.returns.empty_desc")}
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
                            {row.status === "submitted" && canVerify ? (
                              <button
                                onClick={() => openVerify(row.id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold cursor-pointer"
                              >
                                <ShieldCheck className="w-3.5 h-3.5" />
                                {t("inventory.returns.verify")}
                              </button>
                            ) : (
                              <button
                                onClick={() => openVerify(row.id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 text-xs font-semibold hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer"
                              >
                                {t("inventory.common.view")}
                              </button>
                            )}
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
                              {row.employee_name} • {row.total_quantity}
                            </p>
                          </div>
                          <InventoryStatusBadge status={row.status} />
                          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                        {open ? (
                          <div className="px-4 pb-4 space-y-2">
                            <p className="text-xs text-gray-500 dark:text-gray-400">{row.product_name}</p>
                            <button
                              onClick={() => openVerify(row.id)}
                              className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
                            >
                              <ShieldCheck className="w-3.5 h-3.5" />
                              {row.status === "submitted" && canVerify
                                ? t("inventory.returns.verify")
                                : t("inventory.common.view")}
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
                  {t("inventory.returns.create_title")}
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("inventory.returns.create_desc")}
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
                      {employee.employee_name} ({employee.assigned_count})
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
                  {t("inventory.common.reason")}
                </label>
                <input
                  value={form.reason}
                  onChange={(event) => setForm({ ...form, reason: event.target.value })}
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
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                  {t("inventory.returns.pending_notice")}
                </p>
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                  {t("inventory.common.notes")}
                </label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(event) => setForm({ ...form, notes: event.target.value })}
                  className="w-full rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-sm cursor-text outline-none focus:ring-2 focus:ring-primary-500"
                />
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
                  onClick={submitReturn}
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

      {verifyDoc || verifyLoading ? (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="fixed inset-0 bg-black/40" onClick={() => !verifying && setVerifyDoc(null)} />
          <div className="relative w-full sm:max-w-xl max-h-[92vh] overflow-y-auto bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl shadow-2xl border border-gray-100 dark:border-slate-800 p-4 sm:p-6">
            {verifyLoading || !verifyDoc ? (
              <div className="space-y-3 animate-pulse">
                <div className="h-4 w-40 bg-gray-200 dark:bg-slate-700 rounded" />
                <div className="h-24 bg-gray-100 dark:bg-slate-800 rounded-xl" />
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                      {verifyDoc.status === "submitted" && canVerify
                        ? t("inventory.returns.verify_title")
                        : verifyDoc.document_no}
                    </h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {verifyDoc.employee_name} • {verifyDoc.product_name} • {verifyDoc.total_quantity}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <InventoryStatusBadge status={verifyDoc.status} />
                    <button
                      onClick={() => setVerifyDoc(null)}
                      className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 cursor-pointer"
                      aria-label={t("inventory.common.close")}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {verifyDoc.status === "submitted" && canVerify ? (
                  <>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                      {t("inventory.returns.verify_desc")}
                    </p>
                    <div className="rounded-xl border border-gray-100 dark:border-slate-800 divide-y divide-gray-50 dark:divide-slate-800">
                      {verifyDoc.serials.map((line) => (
                        <div key={line.serial_number} className="px-3 py-2">
                          <p className="font-mono text-xs">{line.serial_number}</p>
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {(["accept", "damaged", "reject"] as Decision[]).map((decision) => (
                              <button
                                key={decision}
                                onClick={() =>
                                  setDecisions((current) => ({
                                    ...current,
                                    [line.serial_number]: decision,
                                  }))
                                }
                                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border cursor-pointer ${
                                  (decisions[line.serial_number] || "accept") === decision
                                    ? decision === "accept"
                                      ? "bg-green-600 border-green-600 text-white"
                                      : decision === "damaged"
                                        ? "bg-red-600 border-red-600 text-white"
                                        : "bg-amber-500 border-amber-500 text-white"
                                    : "border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300"
                                }`}
                              >
                                {t(`inventory.returns.${decision}`)}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    <textarea
                      rows={2}
                      value={verifyNotes}
                      onChange={(event) => setVerifyNotes(event.target.value)}
                      placeholder={t("inventory.common.notes")}
                      className="w-full mt-3 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-sm cursor-text outline-none focus:ring-2 focus:ring-primary-500"
                    />

                    <div className="flex gap-2 mt-4">
                      <button
                        onClick={() => setVerifyDoc(null)}
                        disabled={verifying}
                        className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 text-sm font-semibold cursor-pointer"
                      >
                        {t("inventory.common.cancel")}
                      </button>
                      <button
                        onClick={submitVerify}
                        disabled={verifying}
                        className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm font-semibold disabled:opacity-50 cursor-pointer"
                      >
                        {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                        {t("inventory.returns.verify")}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="space-y-1.5">
                    {verifyDoc.serials.map((line) => (
                      <div
                        key={line.serial_number}
                        className="flex items-center justify-between px-3 py-1.5 text-xs font-mono rounded-lg border border-gray-100 dark:border-slate-800"
                      >
                        <span>{line.serial_number}</span>
                        <InventoryStatusBadge status={line.status_after || "returned"} />
                      </div>
                    ))}
                    {verifyDoc.notes ? (
                      <p className="text-xs text-gray-500 dark:text-gray-400 pt-2">{verifyDoc.notes}</p>
                    ) : null}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
