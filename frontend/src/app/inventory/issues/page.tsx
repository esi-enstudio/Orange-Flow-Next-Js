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
  Trash2,
  X,
} from "lucide-react";
import { toast } from "react-hot-toast";

import axios from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import { AccessDenied } from "@/components/ui/AccessDenied";
import PageGuideModal from "@/components/PageGuideModal";
import { InventoryStatusBadge } from "@/components/inventory/InventoryStatusBadge";
import {
  countSerialsWithRanges,
  parseSerials,
  parseSerialsWithRanges,
  SerialsInput,
} from "@/components/inventory/SerialsInput";
import { apiError, formatDate, houseHeaders } from "@/components/inventory/helpers";
import EntitySelector from "@/app/zoom-in/_components/EntitySelector";

const PER_PAGE = 20;
const TODAY = new Date().toISOString().slice(0, 10);
const SERIAL_MODE_RANGE = "range";
const SERIAL_MODE_LIST = "list";
type SerialMode = typeof SERIAL_MODE_RANGE | typeof SERIAL_MODE_LIST;

interface ProductOption {
  id: number;
  product_code?: string | null;
  product_name: string;
  category: string;
  available_qty?: number;
}

interface EmployeeOption {
  id: number;
  employee_name?: string | null;
  employee_id?: string | null;
  dms_code?: string | null;
  employee_type?: string | null;
  assigned_count: number;
}

interface HouseOption {
  id: number;
  name: string;
  code: string;
  display_name?: string;
}

interface IssueLine {
  id: number;
  product_id: number;
  product_name?: string | null;
  product_code?: string | null;
  category?: string | null;
  quantity: number;
}

interface IssueRow {
  id: number;
  document_no: string | null;
  status: string;
  business_date?: string | null;
  product_name?: string | null;
  product_count?: number;
  employee_name?: string | null;
  dms_code?: string | null;
  total_quantity: number;
  serials_count?: number;
  created_at?: string | null;
}

interface IssueDetail extends IssueRow {
  notes?: string | null;
  lines?: IssueLine[];
  serials: { serial_number: string; product_id?: number | null; status_after?: string | null }[];
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
  const { hasPermission, selectedHouse, user } = useAuth();
  const houseId = selectedHouse?.id;

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<IssueRow[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // List filter employees (always scoped to the globally selected house).
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);

  // Issue modal state. The house inside the modal is independent from the page
  // filter, so an admin can create an issue for any accessible house.
  const [houses, setHouses] = useState<HouseOption[]>([]);
  const [formHouseId, setFormHouseId] = useState("");
  const [formEmployees, setFormEmployees] = useState<EmployeeOption[]>([]);
  const [formProducts, setFormProducts] = useState<ProductOption[]>([]);
  const [formDataLoading, setFormDataLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    employee_id: "",
    business_date: TODAY,
    notes: "",
  });
  const [selectedProductIds, setSelectedProductIds] = useState<(string | number)[]>([]);
  const [lineModes, setLineModes] = useState<Record<number, SerialMode>>({});
  const [rangeValues, setRangeValues] = useState<Record<number, string>>({});
  const [listValues, setListValues] = useState<Record<number, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [detail, setDetail] = useState<IssueDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canIssue = hasPermission("inventory.issue");

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
      .get("/v1/inventory/employees", { headers: houseHeaders(houseId) })
      .then((res) => setEmployees(res.data.data || []))
      .catch(() => setEmployees([]));
  }, [houseId]);

  // House picker data for the issue modal (admins see every accessible house).
  useEffect(() => {
    if (!canIssue) return;
    let cancelled = false;
    axios
      .get("/houses/accessible")
      .then((res) => {
        if (!cancelled) setHouses(Array.isArray(res.data) ? res.data : []);
      })
      .catch(() => {
        if (!cancelled) {
          setHouses(
            (user?.houses ?? []).map((house) => ({
              id: house.id,
              name: house.name,
              code: house.code,
            }))
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canIssue, user]);

  // Employees and active products always follow the house chosen in the modal.
  useEffect(() => {
    if (!showCreate || !formHouseId) {
      setFormEmployees([]);
      setFormProducts([]);
      setFormDataLoading(false);
      return;
    }
    let cancelled = false;
    const headers = houseHeaders(Number(formHouseId));
    setFormDataLoading(true);
    Promise.all([
      axios.get("/v1/inventory/employees", { headers }),
      // Only products that still hold available serials in this house can be issued.
      axios.get("/v1/inventory/products", {
        headers,
        params: { in_stock_only: true },
      }),
    ])
      .then(([employeeRes, productRes]) => {
        if (cancelled) return;
        setFormEmployees(employeeRes.data.data || []);
        setFormProducts(productRes.data.data || []);
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error(apiError(err, t("inventory.common.error_generic")).message);
        setFormEmployees([]);
        setFormProducts([]);
      })
      .finally(() => {
        if (!cancelled) setFormDataLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showCreate, formHouseId, t]);

  const houseItems = useMemo(
    () =>
      houses.map((house) => ({
        id: house.id,
        label: house.display_name || house.name,
        sublabel: house.code,
      })),
    [houses]
  );

  const employeeItems = useMemo(
    () =>
      formEmployees.map((employee) => ({
        id: employee.id,
        label: employee.employee_name || employee.dms_code || `#${employee.id}`,
        sublabel: [employee.dms_code, employee.employee_type].filter(Boolean).join(" • "),
        badge: String(employee.assigned_count),
      })),
    [formEmployees]
  );

  const productItems = useMemo(
    () =>
      formProducts.map((product) => ({
        id: product.id,
        label: product.product_name,
        sublabel: product.product_code || undefined,
        badge: t("inventory.issues.stock_badge", {
          qty: product.available_qty ?? 0,
        }),
        group: product.category,
      })),
    [formProducts, t]
  );

  const selectedProducts = useMemo(
    () =>
      selectedProductIds
        .map((id) => formProducts.find((product) => product.id === Number(id)))
        .filter((product): product is ProductOption => Boolean(product)),
    [selectedProductIds, formProducts]
  );

  const totalSerials = useMemo(
    () =>
      selectedProducts.reduce((sum, product) => {
        const mode = lineModes[product.id] ?? SERIAL_MODE_RANGE;
        const text =
          mode === SERIAL_MODE_RANGE
            ? rangeValues[product.id] || ""
            : listValues[product.id] || "";
        return (
          sum +
          (mode === SERIAL_MODE_RANGE
            ? countSerialsWithRanges(text)
            : parseSerials(text).valid.length)
        );
      }, 0),
    [selectedProducts, lineModes, rangeValues, listValues]
  );

  const openDetail = async (id: number, forHouseId: number | undefined = houseId) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await axios.get(`/v1/inventory/issues/${id}`, {
        headers: houseHeaders(forHouseId),
      });
      setDetail(res.data.data);
    } catch (err) {
      toast.error(apiError(err, t("inventory.common.error_generic")).message);
    } finally {
      setDetailLoading(false);
    }
  };

  const resetForm = (initialHouseId = "") => {
    setForm({ employee_id: "", business_date: TODAY, notes: "" });
    setFormHouseId(initialHouseId);
    setSelectedProductIds([]);
    setLineModes({});
    setRangeValues({});
    setListValues({});
    setFormError(null);
    setFieldErrors({});
  };

  const openCreateModal = () => {
    const defaultHouse = houseId
      ? String(houseId)
      : houses.length === 1
        ? String(houses[0].id)
        : "";
    resetForm(defaultHouse);
    setShowCreate(true);
  };

  const changeFormHouse = (value: string | number | undefined) => {
    const nextHouseId = value === undefined ? "" : String(value);
    setFormHouseId(nextHouseId);
    setForm((current) => ({ ...current, employee_id: "" }));
    setFormEmployees([]);
    setFormProducts([]);
    setSelectedProductIds([]);
    setLineModes({});
    setRangeValues({});
    setListValues({});
    setFormError(null);
    setFieldErrors({});
  };

  const handleProductSelection = (ids: (string | number)[]) => {
    setSelectedProductIds(ids);
    setLineModes((current) => {
      const next: Record<number, SerialMode> = {};
      for (const id of ids) {
        next[Number(id)] = current[Number(id)] ?? SERIAL_MODE_RANGE;
      }
      return next;
    });
    setRangeValues((current) => {
      const next: Record<number, string> = {};
      for (const id of ids) next[Number(id)] = current[Number(id)] || "";
      return next;
    });
    setListValues((current) => {
      const next: Record<number, string> = {};
      for (const id of ids) next[Number(id)] = current[Number(id)] || "";
      return next;
    });
    setFieldErrors((current) => {
      const next: Record<string, string> = { ...current, products: "" };
      for (const key of Object.keys(next)) {
        if (key.startsWith("serials_")) delete next[key];
      }
      return next;
    });
  };

  const setLineMode = (productId: number, mode: SerialMode) => {
    setLineModes((current) => ({ ...current, [productId]: mode }));
    setFieldErrors((current) => ({ ...current, [`serials_${productId}`]: "" }));
  };

  const submitIssue = async () => {
    setFormError(null);
    const errors: Record<string, string> = {};
    if (!formHouseId) errors.house = t("inventory.common.required_house");
    if (!form.employee_id) errors.employee_id = t("inventory.common.required_employee");
    if (selectedProducts.length === 0) errors.products = t("inventory.common.required_product");

    const lines: { product_id: number; serials: string[] }[] = [];
    const seenSerials = new Set<string>();
    const crossDuplicates = new Set<string>();

    for (const product of selectedProducts) {
      const mode = lineModes[product.id] ?? SERIAL_MODE_RANGE;
      const text =
        mode === SERIAL_MODE_RANGE
          ? rangeValues[product.id] || ""
          : listValues[product.id] || "";
      const parsedLine =
        mode === SERIAL_MODE_RANGE
          ? parseSerialsWithRanges(text)
          : parseSerials(text);

      for (const serial of parsedLine.valid) {
        if (seenSerials.has(serial)) crossDuplicates.add(serial);
        else seenSerials.add(serial);
      }

      if (parsedLine.invalid.length > 0) {
        errors[`serials_${product.id}`] = t(
          "inventory.common.invalid_serial_examples",
          { serials: parsedLine.invalid.slice(0, 5).join(", ") }
        );
      } else if (parsedLine.duplicates.length > 0) {
        errors[`serials_${product.id}`] = t(
          "inventory.common.duplicate_serial_examples",
          { serials: parsedLine.duplicates.slice(0, 5).join(", ") }
        );
      } else if (parsedLine.valid.length === 0) {
        errors[`serials_${product.id}`] = t(
          "inventory.common.required_serials_product",
          { product: product.product_name }
        );
      } else {
        lines.push({ product_id: product.id, serials: parsedLine.valid });
      }
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    if (crossDuplicates.size > 0) {
      setFormError(
        t("inventory.common.duplicate_across_products", {
          serials: Array.from(crossDuplicates).slice(0, 5).join(", "),
        })
      );
      return;
    }

    setSaving(true);
    try {
      const targetHouseId = Number(formHouseId);
      const res = await axios.post(
        "/v1/inventory/issues",
        {
          employee_id: Number(form.employee_id),
          business_date: form.business_date || null,
          notes: form.notes || null,
          lines,
        },
        { headers: houseHeaders(targetHouseId), timeout: 300000 }
      );
      toast.success(t("inventory.issues.issued_toast"));
      setShowCreate(false);
      resetForm();
      if (houseId === targetHouseId) await fetchIssues();
      if (res.data?.data?.id) await openDetail(res.data.data.id, targetHouseId);
    } catch (err) {
      const { message, fields } = apiError(err, t("inventory.common.error_generic"));
      const serialDetail = fields?.serials;
      setFormError(serialDetail ? `${message} — ${serialDetail}` : message);
      const mapped: Record<string, string> = {};
      if (fields?.employee_id) mapped.employee_id = fields.employee_id;
      if (fields?.product_id) mapped.products = fields.product_id;
      if (Object.keys(mapped).length > 0) setFieldErrors(mapped);
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
              onClick={openCreateModal}
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
                          <td className="px-2 py-1">
                            <p className="font-medium">{row.product_name}</p>
                            {row.product_count && row.product_count > 1 ? (
                              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                                +{row.product_count - 1} {t("inventory.receiving.more_products")}
                              </p>
                            ) : null}
                          </td>
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
                              {row.product_count && row.product_count > 1
                                ? ` • +${row.product_count - 1} ${t("inventory.receiving.more_products")}`
                                : ""}
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
                <EntitySelector
                  label={t("inventory.common.house")}
                  items={houseItems}
                  selectedIds={formHouseId ? [Number(formHouseId)] : []}
                  onChange={(ids) => changeFormHouse(ids[0])}
                  placeholder={t("inventory.common.select_house")}
                  searchPlaceholder={t("inventory.common.house_search")}
                  emptyMessage={t("inventory.issues.no_houses")}
                  noResultsMessage={t("inventory.issues.no_houses_search")}
                  clearLabel={t("inventory.common.clear")}
                  error={fieldErrors.house}
                  disabled={saving}
                  required
                  single
                  portal
                />
              </div>

              <div>
                <EntitySelector
                  label={t("inventory.common.employee")}
                  items={employeeItems}
                  selectedIds={form.employee_id ? [Number(form.employee_id)] : []}
                  onChange={(ids) => {
                    setForm((current) => ({
                      ...current,
                      employee_id: ids.length > 0 ? String(ids[0]) : "",
                    }));
                    setFieldErrors((current) => ({ ...current, employee_id: "" }));
                  }}
                  placeholder={
                    formHouseId
                      ? t("inventory.common.select_employee")
                      : t("inventory.issues.select_house_first")
                  }
                  searchPlaceholder={t("inventory.common.employee_search")}
                  emptyMessage={
                    formDataLoading
                      ? t("inventory.common.loading")
                      : t("inventory.issues.no_employees")
                  }
                  noResultsMessage={t("inventory.issues.no_employees_search")}
                  clearLabel={t("inventory.common.clear")}
                  error={fieldErrors.employee_id}
                  disabled={saving || !formHouseId || formDataLoading}
                  required
                  single
                  portal
                />
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
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(event) => setForm({ ...form, notes: event.target.value })}
                  className="w-full rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-sm cursor-text outline-none focus:ring-2 focus:ring-primary-500"
                />
              </div>

              <div className="md:col-span-2">
                <EntitySelector
                  label={t("inventory.issues.products_label")}
                  items={productItems}
                  selectedIds={selectedProductIds}
                  onChange={handleProductSelection}
                  placeholder={
                    formHouseId
                      ? t("inventory.issues.products_placeholder")
                      : t("inventory.issues.select_house_first")
                  }
                  searchPlaceholder={t("inventory.issues.product_search")}
                  emptyMessage={
                    formDataLoading
                      ? t("inventory.common.loading")
                      : t("inventory.issues.no_products")
                  }
                  noResultsMessage={t("inventory.issues.no_products_search")}
                  selectAllLabel={t("inventory.common.select_all")}
                  clearLabel={t("inventory.common.clear")}
                  selectedLabel={t("inventory.issues.products_selected")}
                  error={fieldErrors.products}
                  disabled={saving || !formHouseId || formDataLoading}
                  required
                  portal
                />
                <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5">
                  {t("inventory.issues.products_help")}
                </p>
              </div>

              <div className="md:col-span-2">
                {selectedProducts.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-gray-200 dark:border-slate-700 p-5 text-center">
                    <PackageMinus className="w-8 h-8 mx-auto text-gray-300 dark:text-slate-600" />
                    <p className="mt-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
                      {t("inventory.issues.products_empty")}
                    </p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      {t("inventory.issues.products_empty_desc")}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {selectedProducts.map((product, index) => {
                      const mode = lineModes[product.id] ?? SERIAL_MODE_RANGE;
                      const errorKey = `serials_${product.id}`;
                      return (
                        <div
                          key={product.id}
                          className="rounded-2xl border border-gray-200 dark:border-slate-800 bg-gray-50/40 dark:bg-slate-800/20 p-3"
                        >
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-md bg-primary-100 dark:bg-primary-900/30 text-[11px] font-bold text-primary-700 dark:text-primary-300">
                                  {index + 1}
                                </span>
                                <p className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">
                                  {product.product_name}
                                </p>
                                <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-gray-400 rounded-md">
                                  {product.category}
                                </span>
                                <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300 rounded-md">
                                  {t("inventory.issues.stock_available", {
                                    qty: product.available_qty ?? 0,
                                  })}
                                </span>
                              </div>
                              {product.product_code ? (
                                <p className="text-[11px] font-mono text-gray-500 dark:text-gray-400 mt-0.5">
                                  {product.product_code}
                                </p>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                handleProductSelection(
                                  selectedProductIds.filter((id) => Number(id) !== product.id)
                                )
                              }
                              disabled={saving}
                              title={t("inventory.issues.remove_product")}
                              aria-label={t("inventory.issues.remove_product")}
                              className="p-2 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>

                          <div className="flex items-center justify-between gap-2 mb-2">
                            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                              {t("inventory.issues.serial_input_mode")}
                            </p>
                            <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-gray-100 dark:bg-slate-800">
                              <button
                                type="button"
                                onClick={() => setLineMode(product.id, SERIAL_MODE_RANGE)}
                                disabled={saving}
                                className={`px-2.5 py-1 text-[11px] font-semibold rounded-md cursor-pointer disabled:cursor-not-allowed ${
                                  mode === SERIAL_MODE_RANGE
                                    ? "bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 shadow-sm"
                                    : "text-gray-500 dark:text-gray-400"
                                }`}
                              >
                                {t("inventory.issues.mode_range")}
                              </button>
                              <button
                                type="button"
                                onClick={() => setLineMode(product.id, SERIAL_MODE_LIST)}
                                disabled={saving}
                                className={`px-2.5 py-1 text-[11px] font-semibold rounded-md cursor-pointer disabled:cursor-not-allowed ${
                                  mode === SERIAL_MODE_LIST
                                    ? "bg-white dark:bg-slate-900 text-gray-900 dark:text-gray-100 shadow-sm"
                                    : "text-gray-500 dark:text-gray-400"
                                }`}
                              >
                                {t("inventory.issues.mode_single")}
                              </button>
                            </div>
                          </div>

                          {mode === SERIAL_MODE_RANGE ? (
                            <SerialsInput
                              value={rangeValues[product.id] || ""}
                              onChange={(value) => {
                                setRangeValues((current) => ({
                                  ...current,
                                  [product.id]: value,
                                }));
                                setFieldErrors((current) => ({ ...current, [errorKey]: "" }));
                              }}
                              error={fieldErrors[errorKey] || null}
                              disabled={saving}
                              expandRanges
                            />
                          ) : (
                            <SerialsInput
                              value={listValues[product.id] || ""}
                              onChange={(value) => {
                                setListValues((current) => ({
                                  ...current,
                                  [product.id]: value,
                                }));
                                setFieldErrors((current) => ({ ...current, [errorKey]: "" }));
                              }}
                              error={fieldErrors[errorKey] || null}
                              disabled={saving}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {formError ? (
              <p className="mt-3 text-sm text-red-600 dark:text-red-400">{formError}</p>
            ) : null}

            <div className="flex items-center justify-between gap-2 mt-5 flex-wrap">
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                {selectedProducts.length} {t("inventory.issues.products_unit")} •{" "}
                {t("inventory.common.serials")}: {totalSerials}
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

                <div className="mb-3">
                  <p className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 mb-1.5">
                    {t("inventory.issues.products_label")} ({detail.lines?.length || 0})
                  </p>
                  <div className="rounded-xl border border-gray-100 dark:border-slate-800 divide-y divide-gray-50 dark:divide-slate-800">
                    {(detail.lines || []).map((line) => (
                      <div key={line.id} className="flex items-center justify-between gap-3 px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                            {line.product_name}
                          </p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">
                            {line.product_code} • {line.category}
                          </p>
                        </div>
                        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {line.quantity}
                        </span>
                      </div>
                    ))}
                  </div>
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
