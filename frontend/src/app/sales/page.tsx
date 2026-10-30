"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Eye,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  X,
  XCircle,
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
  mrp?: number;
}

interface EmployeeOption {
  id: number;
  employee_name?: string | null;
  employee_type?: string | null;
  dms_code?: string | null;
  assigned_count: number;
}

interface RetailerOption {
  id: number;
  name: string;
  retailer_code?: string | null;
  route?: string | null;
  thana?: string | null;
  itop_number?: string | null;
}

interface SaleLine {
  id: number;
  product_id: number;
  product_name?: string | null;
  quantity: number;
  unit_price: number;
  total_amount: number;
  serials: { serial_number: string; status_after?: string | null }[];
}

interface SaleRow {
  id: number;
  sale_no?: string | null;
  status: string;
  business_date?: string | null;
  employee_id: number;
  employee_name?: string | null;
  dms_code?: string | null;
  retailer_id?: number | null;
  retailer_name?: string | null;
  retailer_code?: string | null;
  route?: string | null;
  payment_status: string;
  total_quantity: number;
  total_amount: number;
  paid_amount: number;
  notes?: string | null;
  reject_reason?: string | null;
  created_at?: string | null;
  approved_at?: string | null;
  lines: SaleLine[];
}

interface PaginationMeta {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

const emptyForm = {
  employee_id: "",
  product_id: "",
  retailer_id: "",
  route: "",
  business_date: TODAY,
  unit_price: "",
  paid_amount: "",
  payment_status: "cash",
  notes: "",
};

export default function DailySalesPage() {
  const { t } = useLanguage();
  const { hasPermission, selectedHouse } = useAuth();
  const houseId = selectedHouse?.id;

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<SaleRow[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [products, setProducts] = useState<ProductOption[]>([]);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [serials, setSerials] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [retailerQuery, setRetailerQuery] = useState("");
  const [retailerOptions, setRetailerOptions] = useState<RetailerOption[]>([]);
  const [retailerOpen, setRetailerOpen] = useState(false);
  const [retailerLoading, setRetailerLoading] = useState(false);
  const [selectedRetailer, setSelectedRetailer] = useState<RetailerOption | null>(null);

  const [detail, setDetail] = useState<SaleRow | null>(null);
  const [approveTarget, setApproveTarget] = useState<SaleRow | null>(null);
  const [rejectTarget, setRejectTarget] = useState<SaleRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retailerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canCreate = hasPermission("field_sales.create");
  const canEdit = hasPermission("field_sales.edit");
  const canSubmit = hasPermission("field_sales.submit");
  const canApprove = hasPermission("field_sales.approve");
  const canReject = hasPermission("field_sales.reject");

  const parsed = useMemo(() => parseSerials(serials), [serials]);
  const unitPrice = Number(form.unit_price || 0);
  const subtotal = unitPrice * parsed.valid.length;

  const fetchSales = useCallback(async () => {
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
      const res = await axios.get("/v1/sales", { params, headers: houseHeaders(houseId) });
      setRows(res.data.data || []);
      setPagination(res.data.pagination || null);
    } catch (err) {
      toast.error(apiError(err, t("field_sales.common.error_generic")).message);
    } finally {
      setLoading(false);
    }
  }, [houseId, page, search, statusFilter, employeeFilter, t]);

  useEffect(() => {
    fetchSales();
  }, [fetchSales]);

  useEffect(() => {
    if (!houseId) return;
    axios
      .get("/v1/sales/products", { headers: houseHeaders(houseId) })
      .then((res) => setProducts(res.data.data || []))
      .catch(() => setProducts([]));
    axios
      .get("/v1/sales/employees", { headers: houseHeaders(houseId) })
      .then((res) => setEmployees(res.data.data || []))
      .catch(() => setEmployees([]));
  }, [houseId]);

  useEffect(() => {
    if (!showForm || !houseId) return;
    setRetailerLoading(true);
    if (retailerTimer.current) clearTimeout(retailerTimer.current);
    retailerTimer.current = setTimeout(() => {
      axios
        .get("/v1/sales/retailers", {
          params: { search: retailerQuery || undefined },
          headers: houseHeaders(houseId),
        })
        .then((res) => setRetailerOptions(res.data.data || []))
        .catch(() => setRetailerOptions([]))
        .finally(() => setRetailerLoading(false));
    }, 300);
  }, [retailerQuery, showForm, houseId]);

  const resetForm = () => {
    setForm({ ...emptyForm });
    setSerials("");
    setRetailerQuery("");
    setSelectedRetailer(null);
    setEditingId(null);
    setFormError(null);
    setFieldErrors({});
  };

  const openCreate = () => {
    resetForm();
    setShowForm(true);
  };

  const openEdit = (sale: SaleRow) => {
    const line = sale.lines[0];
    setEditingId(sale.id);
    setForm({
      employee_id: String(sale.employee_id),
      product_id: line ? String(line.product_id) : "",
      retailer_id: sale.retailer_id ? String(sale.retailer_id) : "",
      route: sale.route || "",
      business_date: sale.business_date || TODAY,
      unit_price: line ? String(line.unit_price) : "",
      paid_amount: String(sale.paid_amount ?? ""),
      payment_status: sale.payment_status || "cash",
      notes: sale.notes || "",
    });
    setSerials(line?.serials.map((line) => line.serial_number).join("\n") || "");
    setSelectedRetailer(
      sale.retailer_id && sale.retailer_name
        ? {
            id: sale.retailer_id,
            name: sale.retailer_name,
            retailer_code: sale.retailer_code,
            route: sale.route,
          }
        : null
    );
    setRetailerQuery(sale.retailer_name || "");
    setFormError(null);
    setFieldErrors({});
    setShowForm(true);
  };

  const submitForm = async (submit: boolean) => {
    setFormError(null);
    const errors: Record<string, string> = {};
    if (!form.employee_id) errors.employee_id = t("field_sales.common.required_field");
    if (!form.product_id) errors.product_id = t("field_sales.common.required_field");
    if (parsed.valid.length === 0) errors.serials = t("field_sales.common.required_field");
    if (parsed.duplicates.length || parsed.invalid.length) {
      errors.serials = `${t("inventory.common.duplicates")}: ${parsed.duplicates.length}, ${t("inventory.common.invalid")}: ${parsed.invalid.length}`;
    }
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      return;
    }

    setSaving(true);
    try {
      const payload = {
        employee_id: Number(form.employee_id),
        retailer_id: form.retailer_id ? Number(form.retailer_id) : null,
        route: form.route || null,
        business_date: form.business_date || null,
        payment_status: form.payment_status,
        paid_amount: form.paid_amount === "" ? null : Number(form.paid_amount),
        notes: form.notes || null,
        submit,
        items: [
          {
            product_id: Number(form.product_id),
            serials: parsed.valid,
            unit_price: unitPrice,
          },
        ],
      };

      if (editingId) {
        await axios.patch(`/v1/sales/${editingId}`, payload, {
          headers: houseHeaders(houseId),
        });
      } else {
        await axios.post("/v1/sales", payload, { headers: houseHeaders(houseId) });
      }

      toast.success(
        submit ? t("field_sales.common.submitted_toast") : t("field_sales.common.created_toast")
      );
      setShowForm(false);
      resetForm();
      await fetchSales();
    } catch (err) {
      const { message, fields } = apiError(err, t("field_sales.common.error_generic"));
      setFormError(message);
      if (fields) setFieldErrors(fields);
    } finally {
      setSaving(false);
    }
  };

  const approveSale = async () => {
    if (!approveTarget) return;
    setActionLoading(true);
    try {
      await axios.post(
        `/v1/sales/${approveTarget.id}/approve`,
        {},
        { headers: houseHeaders(houseId) }
      );
      toast.success(t("field_sales.common.approved_toast"));
      setApproveTarget(null);
      await fetchSales();
    } catch (err) {
      toast.error(apiError(err, t("field_sales.common.error_generic")).message);
    } finally {
      setActionLoading(false);
    }
  };

  const rejectSale = async () => {
    if (!rejectTarget) return;
    if (rejectReason.trim().length < 3) {
      toast.error(t("field_sales.common.reject_reason"));
      return;
    }
    setActionLoading(true);
    try {
      await axios.post(
        `/v1/sales/${rejectTarget.id}/reject`,
        { reason: rejectReason.trim() },
        { headers: houseHeaders(houseId) }
      );
      toast.success(t("field_sales.common.rejected_toast"));
      setRejectTarget(null);
      setRejectReason("");
      await fetchSales();
    } catch (err) {
      toast.error(apiError(err, t("field_sales.common.error_generic")).message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleSearch = (value: string) => {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setPage(1), 400);
  };

  if (!hasPermission("field_sales.view")) return <AccessDenied />;

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="p-2.5 bg-emerald-100 dark:bg-emerald-500/20 rounded-xl">
          <ClipboardList className="w-5 h-5 text-emerald-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {t("field_sales.daily.title")}
            </h1>
            <PageGuideModal pageKey="field_sales.daily" />
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("field_sales.daily.description")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchSales}
            className="p-2.5 rounded-xl border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer"
            title={t("field_sales.common.refresh")}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          {canCreate ? (
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              {t("field_sales.common.new_sale")}
            </button>
          ) : null}
        </div>
      </div>

      {!houseId ? (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
          {t("field_sales.common.require_house")}
        </div>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(event) => handleSearch(event.target.value)}
                placeholder={t("field_sales.common.search_placeholder")}
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
              <option value="">{t("field_sales.common.all_employees")}</option>
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
              <option value="">{t("field_sales.common.all_status")}</option>
              {["draft", "submitted", "approved", "rejected"].map((status) => (
                <option key={status} value={status}>
                  {t(`field_sales.status.${status}`)}
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
                <ClipboardList className="w-10 h-10 mx-auto text-gray-300 dark:text-slate-600" />
                <p className="mt-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
                  {t("field_sales.common.no_data")}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("field_sales.common.no_data_desc")}
                </p>
              </div>
            ) : (
              <>
                <div className="hidden lg:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-slate-800/50 text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      <tr>
                        <th className="px-2 py-2">{t("field_sales.common.detail_title")}</th>
                        <th className="px-2 py-2">{t("field_sales.common.employee")}</th>
                        <th className="px-2 py-2">{t("field_sales.common.retailer")}</th>
                        <th className="px-2 py-2 text-right">{t("field_sales.common.quantity")}</th>
                        <th className="px-2 py-2 text-right">{t("field_sales.common.total_amount")}</th>
                        <th className="px-2 py-2">{t("inventory.common.status")}</th>
                        <th className="px-2 py-2 text-right">{t("field_sales.common.view")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                      {rows.map((row) => (
                        <tr key={row.id} className="hover:bg-gray-50/60 dark:hover:bg-slate-800/40">
                          <td className="px-2 py-1">
                            <p className="font-semibold">{row.sale_no}</p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">
                              {formatDate(row.business_date)}
                            </p>
                          </td>
                          <td className="px-2 py-1">
                            <p className="font-medium">{row.employee_name}</p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">{row.dms_code}</p>
                          </td>
                          <td className="px-2 py-1">
                            <p>{row.retailer_name || "-"}</p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">
                              {row.route || row.retailer_code || "-"}
                            </p>
                          </td>
                          <td className="px-2 py-1 text-right font-semibold">{row.total_quantity}</td>
                          <td className="px-2 py-1 text-right">
                            <p className="font-semibold">{row.total_amount.toFixed(2)}</p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">
                              {t(`field_sales.payment.${row.payment_status}`)}
                            </p>
                          </td>
                          <td className="px-2 py-1">
                            <InventoryStatusBadge status={row.status} />
                          </td>
                          <td className="px-2 py-1 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {(row.status === "draft" || row.status === "rejected") && canEdit ? (
                                <button
                                  onClick={() => openEdit(row)}
                                  className="p-1.5 rounded-lg border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer"
                                  title={t("inventory.common.edit")}
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                              ) : null}
                              {row.status === "submitted" && canApprove ? (
                                <button
                                  onClick={() => setApproveTarget(row)}
                                  className="p-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white cursor-pointer"
                                  title={t("field_sales.common.approve")}
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                </button>
                              ) : null}
                              {row.status === "submitted" && canReject ? (
                                <button
                                  onClick={() => {
                                    setRejectTarget(row);
                                    setRejectReason("");
                                  }}
                                  className="p-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white cursor-pointer"
                                  title={t("field_sales.common.reject")}
                                >
                                  <XCircle className="w-3.5 h-3.5" />
                                </button>
                              ) : null}
                              <button
                                onClick={() => setDetail(row)}
                                className="p-1.5 rounded-lg border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer"
                                title={t("field_sales.common.view")}
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                            </div>
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
                            <p className="font-semibold text-sm truncate">{row.sale_no}</p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                              {row.employee_name} • {row.total_quantity} • {row.total_amount.toFixed(2)}
                            </p>
                          </div>
                          <InventoryStatusBadge status={row.status} />
                          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                        {open ? (
                          <div className="px-4 pb-4 space-y-2 text-sm">
                            <InfoRow label={t("field_sales.common.retailer")} value={row.retailer_name || "-"} />
                            <InfoRow label={t("field_sales.common.route")} value={row.route || "-"} />
                            <InfoRow
                              label={t("field_sales.common.payment_status")}
                              value={t(`field_sales.payment.${row.payment_status}`)}
                            />
                            <InfoRow label={t("field_sales.common.paid_amount")} value={row.paid_amount.toFixed(2)} />
                            {row.reject_reason ? (
                              <p className="text-[11px] text-red-500">{row.reject_reason}</p>
                            ) : null}
                            <div className="flex flex-wrap gap-2 pt-1">
                              <button
                                onClick={() => setDetail(row)}
                                className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5" /> {t("field_sales.common.view")}
                              </button>
                              {row.status === "submitted" && canApprove ? (
                                <button
                                  onClick={() => setApproveTarget(row)}
                                  className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-green-600 text-white text-xs font-semibold cursor-pointer"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" /> {t("field_sales.common.approve")}
                                </button>
                              ) : null}
                              {row.status === "submitted" && canReject ? (
                                <button
                                  onClick={() => {
                                    setRejectTarget(row);
                                    setRejectReason("");
                                  }}
                                  className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-red-600 text-white text-xs font-semibold cursor-pointer"
                                >
                                  <XCircle className="w-3.5 h-3.5" /> {t("field_sales.common.reject")}
                                </button>
                              ) : null}
                            </div>
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
                  {t("field_sales.common.previous")}
                </button>
                <button
                  onClick={() => setPage((value) => value + 1)}
                  disabled={!pagination.has_next}
                  className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {t("field_sales.common.next")}
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}

      {showForm ? (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="fixed inset-0 bg-black/40" onClick={() => !saving && setShowForm(false)} />
          <div className="relative w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl shadow-2xl border border-gray-100 dark:border-slate-800 p-4 sm:p-6">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  {t("field_sales.daily.create_title")}
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("field_sales.daily.create_desc")}
                </p>
              </div>
              <button
                onClick={() => !saving && setShowForm(false)}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 cursor-pointer"
                aria-label={t("field_sales.common.close")}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label={t("field_sales.common.employee")} required error={fieldErrors.employee_id}>
                <select
                  value={form.employee_id}
                  onChange={(event) => setForm({ ...form, employee_id: event.target.value })}
                  className="w-full rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm cursor-pointer outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">{t("field_sales.common.select_employee")}</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.employee_name} ({employee.assigned_count})
                    </option>
                  ))}
                </select>
              </Field>

              <Field label={t("field_sales.common.business_date")}>
                <input
                  type="date"
                  value={form.business_date}
                  max={TODAY}
                  onChange={(event) => setForm({ ...form, business_date: event.target.value })}
                  className="w-full rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm cursor-pointer outline-none focus:ring-2 focus:ring-primary-500"
                />
              </Field>

              <div className="relative md:col-span-2">
                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                  {t("field_sales.common.retailer")}
                </label>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    value={retailerQuery}
                    onFocus={() => setRetailerOpen(true)}
                    onChange={(event) => {
                      setRetailerQuery(event.target.value);
                      setSelectedRetailer(null);
                      setForm({ ...form, retailer_id: "" });
                      setRetailerOpen(true);
                    }}
                    placeholder={t("field_sales.common.retailer_search")}
                    className="w-full rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 pl-9 pr-3 py-2.5 text-sm cursor-text outline-none focus:ring-2 focus:ring-primary-500"
                  />
                  {retailerLoading ? (
                    <Loader2 className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-gray-400" />
                  ) : null}
                </div>
                {retailerOpen ? (
                  <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setRetailerOpen(false)}
                  />
                  <div className="absolute z-50 mt-1.5 w-full rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-lg max-h-48 overflow-y-auto">
                    {retailerOptions.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                        {t("field_sales.common.no_retailers")}
                      </p>
                    ) : (
                      retailerOptions.map((retailer) => (
                        <button
                          key={retailer.id}
                          type="button"
                          onClick={() => {
                            setSelectedRetailer(retailer);
                            setRetailerQuery(retailer.name);
                            setForm((current) => ({
                              ...current,
                              retailer_id: String(retailer.id),
                              route: current.route || retailer.route || "",
                            }));
                            setRetailerOpen(false);
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer"
                        >
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {retailer.name}
                          </p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">
                            {retailer.retailer_code} • {retailer.route || retailer.thana || "-"}
                          </p>
                        </button>
                      ))
                    )}
                  </div>
                  </>
                ) : null}
                {selectedRetailer ? (
                  <p className="text-[11px] text-green-600 dark:text-green-400 mt-1">
                    {selectedRetailer.retailer_code}
                  </p>
                ) : null}
              </div>

              <Field label={t("field_sales.common.route")}>
                <input
                  value={form.route}
                  onChange={(event) => setForm({ ...form, route: event.target.value })}
                  className="w-full rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm cursor-text outline-none focus:ring-2 focus:ring-primary-500"
                />
              </Field>

              <Field label={t("field_sales.common.product")} required error={fieldErrors.product_id}>
                <select
                  value={form.product_id}
                  onChange={(event) => setForm({ ...form, product_id: event.target.value })}
                  className="w-full rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm cursor-pointer outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">{t("field_sales.common.select_product")}</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.product_name} ({product.category})
                    </option>
                  ))}
                </select>
              </Field>

              <Field label={t("field_sales.common.unit_price")}>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.unit_price}
                  onChange={(event) => setForm({ ...form, unit_price: event.target.value })}
                  className="w-full rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm cursor-text outline-none focus:ring-2 focus:ring-primary-500"
                />
              </Field>

              <Field label={t("field_sales.common.payment_status")}>
                <select
                  value={form.payment_status}
                  onChange={(event) => setForm({ ...form, payment_status: event.target.value })}
                  className="w-full rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm cursor-pointer outline-none focus:ring-2 focus:ring-primary-500"
                >
                  {["cash", "due", "partial", "other"].map((status) => (
                    <option key={status} value={status}>
                      {t(`field_sales.payment.${status}`)}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label={t("field_sales.common.paid_amount")}>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.paid_amount}
                  onChange={(event) => setForm({ ...form, paid_amount: event.target.value })}
                  placeholder={String(subtotal || "")}
                  className="w-full rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm cursor-text outline-none focus:ring-2 focus:ring-primary-500"
                />
              </Field>

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
                  {t("field_sales.common.serials_hint")}
                </p>
              </div>

              <div className="md:col-span-2">
                <Field label={t("field_sales.common.notes")}>
                  <textarea
                    rows={2}
                    value={form.notes}
                    onChange={(event) => setForm({ ...form, notes: event.target.value })}
                    className="w-full rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-sm cursor-text outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </Field>
              </div>
            </div>

            <div className="mt-3 rounded-xl bg-gray-50 dark:bg-slate-800/50 px-3 py-2 flex items-center justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">
                {t("field_sales.common.subtotal")} ({parsed.valid.length})
              </span>
              <span className="font-bold">{subtotal.toFixed(2)}</span>
            </div>

            {formError ? (
              <p className="mt-3 text-sm text-red-600 dark:text-red-400">{formError}</p>
            ) : null}

            <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2">
              {t("field_sales.common.pending_notice")}
            </p>

            <div className="flex flex-wrap justify-end gap-2 mt-4">
              <button
                onClick={() => setShowForm(false)}
                disabled={saving}
                className="px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
              >
                {t("field_sales.common.cancel")}
              </button>
              <button
                onClick={() => submitForm(false)}
                disabled={saving}
                className="px-4 py-2.5 rounded-xl border border-primary-200 dark:border-primary-700 text-primary-700 dark:text-primary-300 text-sm font-semibold hover:bg-primary-50 dark:hover:bg-primary-500/10 disabled:opacity-50 cursor-pointer"
              >
                {t("field_sales.common.save_draft")}
              </button>
              {canSubmit ? (
                <button
                  onClick={() => submitForm(true)}
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold disabled:opacity-50 cursor-pointer"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {t("field_sales.common.submit_now")}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {detail ? (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="fixed inset-0 bg-black/40" onClick={() => setDetail(null)} />
          <div className="relative w-full sm:max-w-lg max-h-[92vh] overflow-y-auto bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl shadow-2xl border border-gray-100 dark:border-slate-800 p-4 sm:p-6">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  {detail.sale_no}
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
                  aria-label={t("field_sales.common.close")}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <InfoRow label={t("field_sales.common.retailer")} value={detail.retailer_name || "-"} />
              <InfoRow label={t("field_sales.common.route")} value={detail.route || "-"} />
              <InfoRow label={t("field_sales.common.quantity")} value={detail.total_quantity} />
              <InfoRow label={t("field_sales.common.total_amount")} value={detail.total_amount.toFixed(2)} />
              <InfoRow
                label={t("field_sales.common.payment_status")}
                value={t(`field_sales.payment.${detail.payment_status}`)}
              />
              <InfoRow label={t("field_sales.common.paid_amount")} value={detail.paid_amount.toFixed(2)} />
            </div>

            {detail.reject_reason ? (
              <p className="mt-2 text-xs text-red-500">{detail.reject_reason}</p>
            ) : null}

            <div className="mt-3 space-y-2">
              {detail.lines.map((line) => (
                <div key={line.id} className="rounded-xl border border-gray-100 dark:border-slate-800 p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{line.product_name}</span>
                    <span className="font-semibold">
                      {line.quantity} × {line.unit_price.toFixed(2)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {line.serials.map((serial) => (
                      <span
                        key={serial.serial_number}
                        className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-slate-800 font-mono text-[10px]"
                      >
                        {serial.serial_number}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {detail.notes ? (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">{detail.notes}</p>
            ) : null}

            {detail.status === "submitted" ? (
              <div className="flex gap-2 mt-4">
                {canApprove ? (
                  <button
                    onClick={() => {
                      setDetail(null);
                      setApproveTarget(detail);
                    }}
                    className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2.5 rounded-xl bg-green-600 text-white text-sm font-semibold cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" /> {t("field_sales.common.approve")}
                  </button>
                ) : null}
                {canReject ? (
                  <button
                    onClick={() => {
                      setDetail(null);
                      setRejectTarget(detail);
                      setRejectReason("");
                    }}
                    className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold cursor-pointer"
                  >
                    <XCircle className="w-4 h-4" /> {t("field_sales.common.reject")}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {approveTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/40" onClick={() => !actionLoading && setApproveTarget(null)} />
          <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-slate-800 p-6 w-full max-w-sm mx-4">
            <div className="text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-green-100 dark:bg-green-500/20 flex items-center justify-center mb-4">
                <CheckCircle2 className="w-6 h-6 text-green-600" />
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">
                {t("field_sales.common.confirm_approve_title")}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                {t("field_sales.common.confirm_approve_desc")}
              </p>
              <p className="text-xs text-gray-400 mb-4">{approveTarget.sale_no}</p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => setApproveTarget(null)}
                  disabled={actionLoading}
                  className="px-4 py-2 text-sm rounded-xl border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                >
                  {t("field_sales.common.cancel")}
                </button>
                <button
                  onClick={approveSale}
                  disabled={actionLoading}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-xl bg-green-600 text-white font-semibold disabled:opacity-50 cursor-pointer"
                >
                  {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {t("field_sales.common.approve")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {rejectTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/40" onClick={() => !actionLoading && setRejectTarget(null)} />
          <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-slate-800 p-6 w-full max-w-sm mx-4">
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">
              {t("field_sales.common.reject_title")}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{rejectTarget.sale_no}</p>
            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
              {t("field_sales.common.reject_reason")}
            </label>
            <textarea
              rows={3}
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              placeholder={t("field_sales.common.reject_placeholder")}
              className="w-full rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-sm cursor-text outline-none focus:ring-2 focus:ring-primary-500"
            />
            <div className="flex gap-3 justify-end mt-4">
              <button
                onClick={() => setRejectTarget(null)}
                disabled={actionLoading}
                className="px-4 py-2 text-sm rounded-xl border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
              >
                {t("field_sales.common.cancel")}
              </button>
              <button
                onClick={rejectSale}
                disabled={actionLoading}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-xl bg-red-600 text-white font-semibold disabled:opacity-50 cursor-pointer"
              >
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {t("field_sales.common.reject")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
        {label}
        {required ? <span className="text-red-500"> *</span> : null}
      </label>
      {children}
      {error ? <p className="text-xs text-red-600 dark:text-red-400 mt-1">{error}</p> : null}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-sm font-medium text-gray-900 dark:text-gray-100 text-right">{value}</span>
    </div>
  );
}
