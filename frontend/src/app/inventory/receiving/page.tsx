"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
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
  parseSerialsWithRanges,
  SerialsInput,
} from "@/components/inventory/SerialsInput";
import { apiError, formatDate, houseHeaders } from "@/components/inventory/helpers";
import EntitySelector from "@/app/zoom-in/_components/EntitySelector";

const PER_PAGE = 10;
// Serial list inside the detail modal: pages of 500 (the API cap) fetched on
// demand and windowed to the ~10 rows that are actually visible.
const SERIAL_PAGE_SIZE = 500;
const SERIAL_ROW_HEIGHT = 28;
const SERIAL_VIEWPORT_HEIGHT = 288;
const SERIAL_OVERSCAN = 6;
const MAX_RECEIPT_SERIALS = 100000;
const TODAY = new Date().toISOString().slice(0, 10);

interface ProductOption {
  id: number;
  product_code: string;
  product_name: string;
  category: string;
}

interface ReceiptLine {
  id: number;
  product_id: number;
  product_name?: string | null;
  product_code?: string | null;
  category?: string | null;
  quantity: number;
}

interface ReceiptRow {
  id: number;
  document_no: string | null;
  status: string;
  business_date?: string | null;
  product_name?: string | null;
  product_code?: string | null;
  product_count?: number;
  supplier?: string | null;
  invoice_number?: string | null;
  batch_number?: string | null;
  expected_quantity: number;
  total_quantity: number;
  discrepancy: number;
  serials_count?: number;
  created_at?: string | null;
}

interface PaginationMeta {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

interface ReceiptDetail extends ReceiptRow {
  purchase_reference?: string | null;
  notes?: string | null;
  lines: ReceiptLine[];
}

interface ReceiptSerial {
  serial_number: string;
  serial_unit_id: number;
  status_before?: string | null;
  status_after?: string | null;
  action: string;
}

const emptyForm = {
  supplier: "Banglalink",
  purchase_reference: "",
  invoice_number: "",
  business_date: TODAY,
  notes: "",
};

export default function StockReceivingPage() {
  const { t } = useLanguage();
  const { hasPermission, selectedHouse } = useAuth();
  const houseId = selectedHouse?.id;

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ReceiptRow[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [productsById, setProductsById] = useState<Record<number, ProductOption>>({});
  const [productResultIds, setProductResultIds] = useState<number[]>([]);
  const productSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const productSearchRequest = useRef(0);
  const [form, setForm] = useState({ ...emptyForm });
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState<(string | number)[]>([]);
  const [lineSerials, setLineSerials] = useState<Record<number, string>>({});

  const [detail, setDetail] = useState<ReceiptDetail | null>(null);
  // Serial rows are kept per loaded page and rendered through a fixed-height
  // window, so a 50,000-serial receipt never mounts 50,000 DOM nodes.
  const [serialPages, setSerialPages] = useState<Record<number, ReceiptSerial[]>>({});
  const [serialTotal, setSerialTotal] = useState(0);
  const [serialScrollTop, setSerialScrollTop] = useState(0);
  const serialPagesRef = useRef<Set<number>>(new Set());
  const serialPageRequests = useRef<Set<number>>(new Set());
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirmPost, setConfirmPost] = useState(false);
  const [posting, setPosting] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canReceive = hasPermission("inventory.receive");

  const productItems = useMemo(
    () =>
      productResultIds
        .map((id) => productsById[id])
        .filter((product): product is ProductOption => Boolean(product))
        .map((product) => ({
          id: product.id,
          label: product.product_name,
          sublabel: product.product_code,
          badge: product.category,
          group: product.category,
        })),
    [productResultIds, productsById]
  );

  const selectedProducts = useMemo(
    () =>
      selectedProductIds
        .map((id) => productsById[Number(id)])
        .filter((product): product is ProductOption => Boolean(product)),
    [selectedProductIds, productsById]
  );

  const [totalSerials, setTotalSerials] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      setTotalSerials(
        selectedProducts.reduce(
          (sum, product) => sum + countSerialsWithRanges(lineSerials[product.id] || ""),
          0
        )
      );
    }, 250);
    return () => clearTimeout(timer);
  }, [lineSerials, selectedProducts]);

  const fetchReceipts = useCallback(async () => {
    if (!houseId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params: Record<string, string | number> = {
        page,
        per_page: PER_PAGE,
      };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      const res = await axios.get("/v1/inventory/receipts", {
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
  }, [houseId, page, search, statusFilter, t]);

  useEffect(() => {
    fetchReceipts();
  }, [fetchReceipts]);

  useEffect(() => {
    productSearchRequest.current += 1;
    if (productSearchTimer.current) clearTimeout(productSearchTimer.current);
    setProductsById({});
    setProductResultIds([]);
    return () => {
      productSearchRequest.current += 1;
      if (productSearchTimer.current) clearTimeout(productSearchTimer.current);
    };
  }, [houseId]);

  const searchProducts = (value: string) => {
    const requestId = ++productSearchRequest.current;
    if (productSearchTimer.current) clearTimeout(productSearchTimer.current);
    setProductResultIds([]);
    const query = value.trim();
    if (!houseId || !query) return;

    productSearchTimer.current = setTimeout(async () => {
      try {
        const res = await axios.get("/v1/inventory/products", {
          params: { search: query, limit: 30 },
          headers: houseHeaders(houseId),
        });
        if (requestId !== productSearchRequest.current) return;
        const options = (res.data.data || []) as ProductOption[];
        setProductsById((current) => ({
          ...current,
          ...Object.fromEntries(options.map((product) => [product.id, product])),
        }));
        setProductResultIds(options.map((product) => product.id));
      } catch (err) {
        if (requestId === productSearchRequest.current) {
          toast.error(apiError(err, t("inventory.common.error_generic")).message);
        }
      }
    }, 250);
  };

  const handleSearch = (value: string) => {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setPage(1), 400);
  };

  const loadSerialPage = useCallback(
    async (docId: number, page: number) => {
      if (!houseId) return;
      if (serialPagesRef.current.has(page) || serialPageRequests.current.has(page)) return;
      serialPageRequests.current.add(page);
      try {
        const res = await axios.get(`/v1/inventory/receipts/${docId}/serials`, {
          params: { page, per_page: SERIAL_PAGE_SIZE },
          headers: houseHeaders(houseId),
        });
        serialPagesRef.current.add(page);
        setSerialPages((current) => ({ ...current, [page]: res.data.data || [] }));
        setSerialTotal(res.data.pagination?.total ?? 0);
      } catch (err) {
        toast.error(apiError(err, t("inventory.common.error_generic")).message);
      } finally {
        serialPageRequests.current.delete(page);
      }
    },
    [houseId, t]
  );

  const openDetail = async (id: number) => {
    setDetailLoading(true);
    setDetail(null);
    serialPagesRef.current = new Set();
    serialPageRequests.current = new Set();
    setSerialPages({});
    setSerialTotal(0);
    setSerialScrollTop(0);
    try {
      // The voucher and its first serial page are independent — fetch them in
      // parallel instead of paying two sequential round trips.
      const [res] = await Promise.all([
        axios.get(`/v1/inventory/receipts/${id}`, {
          headers: houseHeaders(houseId),
        }),
        loadSerialPage(id, 1),
      ]);
      setDetail(res.data.data);
    } catch (err) {
      toast.error(apiError(err, t("inventory.common.error_generic")).message);
    } finally {
      setDetailLoading(false);
    }
  };

  const serialRowCount =
    serialTotal || Number(detail?.serials_count || detail?.total_quantity || 0);
  const serialFirstRow = Math.max(
    0,
    Math.floor(serialScrollTop / SERIAL_ROW_HEIGHT) - SERIAL_OVERSCAN
  );
  const serialRowsPerView = Math.ceil(SERIAL_VIEWPORT_HEIGHT / SERIAL_ROW_HEIGHT);
  const serialLastRow = Math.min(
    serialRowCount,
    serialFirstRow + serialRowsPerView + SERIAL_OVERSCAN * 2
  );
  const serialVisibleRows = useMemo(() => {
    const rows: { index: number; line: ReceiptSerial | null }[] = [];
    for (let index = serialFirstRow; index < serialLastRow; index += 1) {
      const page = serialPages[Math.floor(index / SERIAL_PAGE_SIZE)];
      rows.push({ index, line: page?.[index % SERIAL_PAGE_SIZE] ?? null });
    }
    return rows;
  }, [serialFirstRow, serialLastRow, serialPages]);

  useEffect(() => {
    if (!detail || serialLastRow <= serialFirstRow) return;
    const firstPage = Math.floor(serialFirstRow / SERIAL_PAGE_SIZE) + 1;
    const lastPage = Math.floor((serialLastRow - 1) / SERIAL_PAGE_SIZE) + 1;
    for (let page = firstPage; page <= lastPage; page += 1) {
      void loadSerialPage(detail.id, page);
    }
  }, [detail, serialFirstRow, serialLastRow, loadSerialPage]);

  const resetCreate = () => {
    setForm({ ...emptyForm });
    setSelectedProductIds([]);
    setLineSerials({});
    setTotalSerials(0);
    setFormError(null);
    setFieldErrors({});
  };

  const handleProductSelection = (ids: (string | number)[]) => {
    setSelectedProductIds(ids);
    setLineSerials((current) => {
      const next: Record<number, string> = {};
      for (const id of ids) {
        const key = Number(id);
        next[key] = current[key] || "";
      }
      return next;
    });
    setFieldErrors((current) => ({ ...current, products: "" }));
  };

  const submitReceipt = async () => {
    setFieldErrors({});
    setFormError(null);

    if (selectedProducts.length === 0) {
      setFieldErrors({ products: t("inventory.common.required_field") });
      return;
    }

    const enteredSerialCount = selectedProducts.reduce(
      (sum, product) => sum + countSerialsWithRanges(lineSerials[product.id] || ""),
      0
    );
    if (enteredSerialCount > MAX_RECEIPT_SERIALS) {
      setFormError(t("inventory.receiving.max_serials", { count: MAX_RECEIPT_SERIALS }));
      return;
    }

    const nextFieldErrors: Record<string, string> = {};
    const lines: {
      product_id: number;
      serials: string[];
    }[] = [];
    const seenSerials = new Set<string>();
    const crossDuplicates = new Set<string>();
    for (const product of selectedProducts) {
      const parsed = parseSerialsWithRanges(lineSerials[product.id] || "");
      for (const serial of parsed.valid) {
        if (seenSerials.has(serial)) crossDuplicates.add(serial);
        else seenSerials.add(serial);
      }
      if (parsed.duplicates.length > 0 || parsed.invalid.length > 0) {
        nextFieldErrors[`serials_${product.id}`] =
          `${t("inventory.common.duplicates")}: ${parsed.duplicates.length}, ${t("inventory.common.invalid")}: ${parsed.invalid.length}`;
      } else if (parsed.valid.length === 0) {
        nextFieldErrors[`serials_${product.id}`] = t("inventory.common.required_field");
      } else {
        lines.push({
          product_id: product.id,
          serials: parsed.valid,
        });
      }
    }

    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      return;
    }
    if (crossDuplicates.size > 0) {
      setFormError(
        `${t("inventory.receiving.duplicate_across_products")}: ${Array.from(crossDuplicates).slice(0, 5).join(", ")}`
      );
      return;
    }

    setSaving(true);
    try {
      const res = await axios.post(
        "/v1/inventory/receipts",
        {
          supplier: form.supplier || null,
          purchase_reference: form.purchase_reference || null,
          invoice_number: form.invoice_number || null,
          business_date: form.business_date || null,
          expected_quantity: lines.reduce((sum, line) => sum + line.serials.length, 0),
          notes: form.notes || null,
          lines,
        },
        { headers: houseHeaders(houseId), timeout: 300000 }
      );
      toast.success(t("inventory.receiving.created_toast"));
      setShowCreate(false);
      resetCreate();
      // Refresh the list in the background: the new voucher's detail is what
      // the user is waiting for, not the list re-read.
      void fetchReceipts();
      if (res.data?.data?.id) await openDetail(res.data.data.id);
    } catch (err) {
      const { message, fields } = apiError(err, t("inventory.common.error_generic"));
      setFormError(message);
      if (fields) setFieldErrors(fields);
    } finally {
      setSaving(false);
    }
  };

  const postReceipt = async () => {
    if (!detail) return;
    setPosting(true);
    try {
      await axios.post(
        `/v1/inventory/receipts/${detail.id}/post`,
        {},
        { headers: houseHeaders(houseId), timeout: 300000 }
      );
      toast.success(t("inventory.receiving.posted"));
      setConfirmPost(false);
      await openDetail(detail.id);
      await fetchReceipts();
    } catch (err) {
      toast.error(apiError(err, t("inventory.common.error_generic")).message);
    } finally {
      setPosting(false);
    }
  };

  if (!hasPermission("inventory.view")) return <AccessDenied />;

  const header = (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="p-2.5 bg-amber-100 dark:bg-amber-500/20 rounded-xl">
        <Boxes className="w-5 h-5 text-amber-600" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2.5">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
            {t("inventory.receiving.title")}
          </h1>
          <PageGuideModal pageKey="inventory.receiving" />
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t("inventory.receiving.description")}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={fetchReceipts}
          className="p-2.5 rounded-xl border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer"
          title={t("inventory.common.refresh")}
        >
          <RefreshCw className="w-4 h-4" />
        </button>
        {canReceive ? (
          <button
            onClick={() => {
              resetCreate();
              setShowCreate(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            {t("inventory.common.new_receiving")}
          </button>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {header}

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
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value);
                setPage(1);
              }}
              className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm cursor-pointer outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">{t("inventory.common.all_status")}</option>
              <option value="draft">{t("inventory.status.draft")}</option>
              <option value="posted">{t("inventory.status.posted")}</option>
            </select>
          </div>

          <div className="rounded-2xl border border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            {loading ? (
              <div className="divide-y divide-gray-50 dark:divide-slate-800">
                {Array.from({ length: PER_PAGE }).map((_, index) => (
                  <div key={index} className="flex items-center gap-4 px-4 py-4 animate-pulse">
                    <div className="space-y-2 flex-1">
                      <div className="h-3 w-32 bg-gray-200 dark:bg-slate-700 rounded-md" />
                      <div className="h-2.5 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
                    </div>
                    <div className="hidden sm:block h-3 w-24 bg-gray-200 dark:bg-slate-700 rounded-md" />
                    <div className="h-5 w-16 bg-gray-100 dark:bg-slate-800 rounded-full" />
                  </div>
                ))}
              </div>
            ) : rows.length === 0 ? (
              <div className="p-10 text-center">
                <Boxes className="w-10 h-10 mx-auto text-gray-300 dark:text-slate-600" />
                <p className="mt-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
                  {t("inventory.receiving.empty")}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("inventory.receiving.empty_desc")}
                </p>
              </div>
            ) : (
              <>
                <div className="hidden lg:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-slate-800/50 text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      <tr>
                        <th className="px-2 py-2">{t("inventory.common.document_no")}</th>
                        <th className="px-2 py-2">{t("inventory.common.product")}</th>
                        <th className="px-2 py-2">{t("inventory.common.supplier")}</th>
                        <th className="px-2 py-2 text-right">{t("inventory.common.expected_quantity")}</th>
                        <th className="px-2 py-2 text-right">{t("inventory.common.accepted_quantity")}</th>
                        <th className="px-2 py-2">{t("inventory.common.status")}</th>
                        <th className="px-2 py-2 text-right">{t("inventory.common.details")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                      {rows.map((row) => (
                        <tr key={row.id} className="hover:bg-gray-50/60 dark:hover:bg-slate-800/40">
                          <td className="px-2 py-1">
                            <p className="font-semibold text-gray-900 dark:text-gray-100">
                              {row.document_no}
                            </p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">
                              {formatDate(row.business_date)}
                            </p>
                          </td>
                          <td className="px-2 py-1">
                            <p className="font-medium">{row.product_name}</p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">
                              {row.product_code}
                              {row.product_count && row.product_count > 1
                                ? ` • +${row.product_count - 1} ${t("inventory.receiving.more_products")}`
                                : ""}
                            </p>
                          </td>
                          <td className="px-2 py-1">
                            <p>{row.supplier || "-"}</p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">
                              {row.invoice_number || "-"}
                            </p>
                          </td>
                          <td className="px-2 py-1 text-right">{row.expected_quantity}</td>
                          <td className="px-2 py-1 text-right">
                            <p className="font-semibold">{row.total_quantity}</p>
                            {row.discrepancy ? (
                              <p className="text-[11px] text-red-500">
                                {t("inventory.common.discrepancy")}: {row.discrepancy}
                              </p>
                            ) : null}
                          </td>
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
                              {row.product_name}
                              {row.product_count && row.product_count > 1
                                ? ` • +${row.product_count - 1} ${t("inventory.receiving.more_products")}`
                                : ""}{" "}
                              • {formatDate(row.business_date)}
                            </p>
                          </div>
                          <InventoryStatusBadge status={row.status} />
                          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                        {open ? (
                          <div className="px-4 pb-4 space-y-1.5 text-sm">
                            <Row label={t("inventory.common.expected_quantity")} value={row.expected_quantity} />
                            <Row label={t("inventory.common.accepted_quantity")} value={row.total_quantity} />
                            <Row label={t("inventory.common.discrepancy")} value={row.discrepancy} />
                            <Row label={t("inventory.common.supplier")} value={row.supplier || "-"} />
                            <Row label={t("inventory.common.invoice_number")} value={row.invoice_number || "-"} />
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

      {/* Create modal */}
      {showCreate ? (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="fixed inset-0 bg-black/40" onClick={() => !saving && setShowCreate(false)} />
          <div className="relative w-full sm:max-w-3xl max-h-[92vh] overflow-y-auto bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl shadow-2xl border border-gray-100 dark:border-slate-800 p-4 sm:p-6">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  {t("inventory.receiving.create_title")}
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("inventory.receiving.create_desc")}
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

            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={t("inventory.common.business_date")}>
                  <input
                    type="date"
                    value={form.business_date}
                    max={TODAY}
                    onChange={(event) => setForm({ ...form, business_date: event.target.value })}
                    className="w-full rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm cursor-pointer outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </Field>

                <Field label={t("inventory.common.supplier")}>
                  <input
                    value={form.supplier}
                    onChange={(event) => setForm({ ...form, supplier: event.target.value })}
                    className="w-full rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm cursor-text outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </Field>

                <Field label={t("inventory.common.invoice_number")}>
                  <input
                    value={form.invoice_number}
                    onChange={(event) => setForm({ ...form, invoice_number: event.target.value })}
                    className="w-full rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm cursor-text outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </Field>

                <Field label={t("inventory.common.purchase_reference")}>
                  <input
                    value={form.purchase_reference}
                    onChange={(event) => setForm({ ...form, purchase_reference: event.target.value })}
                    className="w-full rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm cursor-text outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </Field>

                

              </div>

              <div className="space-y-3">
                <div>
                  <EntitySelector
                    label={t("inventory.receiving.products_label")}
                    items={productItems}
                    selectedIds={selectedProductIds}
                    onChange={handleProductSelection}
                    onSearchChange={searchProducts}
                    remoteSearch
                    placeholder={t("inventory.receiving.products_placeholder")}
                    searchPlaceholder={t("inventory.receiving.product_search")}
                    emptyMessage={t("inventory.receiving.no_products")}
                    noResultsMessage={t("inventory.receiving.no_products_search")}
                    selectAllLabel={t("inventory.common.select_all")}
                    clearLabel={t("inventory.common.clear")}
                    selectedLabel={t("inventory.receiving.products_selected")}
                    showSelectAll={false}
                    closeOnSelect
                    error={fieldErrors.products || undefined}
                    disabled={saving}
                    required
                    portal
                  />
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5">
                    {t("inventory.receiving.products_help")}
                  </p>
                </div>

                {selectedProducts.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-gray-200 dark:border-slate-700 p-5 text-center">
                    <Boxes className="w-8 h-8 mx-auto text-gray-300 dark:text-slate-600" />
                    <p className="mt-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
                      {t("inventory.receiving.products_empty")}
                    </p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      {t("inventory.receiving.products_empty_desc")}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {selectedProducts.map((product, index) => {
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
                              </div>
                              <p className="text-[11px] font-mono text-gray-500 dark:text-gray-400 mt-0.5">
                                {product.product_code}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleProductSelection(selectedProductIds.filter((id) => Number(id) !== product.id))}
                              disabled={saving}
                              title={t("inventory.receiving.remove_product")}
                              aria-label={t("inventory.receiving.remove_product")}
                              className="p-2 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>

                          <SerialsInput
                            value={lineSerials[product.id] || ""}
                            onChange={(value) => {
                              setLineSerials((current) => ({ ...current, [product.id]: value }));
                              setFieldErrors((current) => ({
                                ...current,
                                [`serials_${product.id}`]: "",
                              }));
                            }}
                            error={fieldErrors[`serials_${product.id}`] || null}
                            disabled={saving}
                            expandRanges
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <Field label={t("inventory.common.notes")}>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(event) => setForm({ ...form, notes: event.target.value })}
                  className="w-full rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-sm cursor-text outline-none focus:ring-2 focus:ring-primary-500"
                />
              </Field>
            </div>

            {formError ? (
              <p className="mt-3 text-sm text-red-600 dark:text-red-400">{formError}</p>
            ) : null}

            <div className="flex items-center justify-between gap-2 mt-5 flex-wrap">
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                {selectedProducts.length} {t("inventory.receiving.products_unit")} •{" "}
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
                  onClick={submitReceipt}
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

      {/* Detail modal */}
      {detail || detailLoading ? (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="fixed inset-0 bg-black/40" onClick={() => { setDetail(null); setConfirmPost(false); }} />
          <div className="relative w-full sm:max-w-xl max-h-[92vh] overflow-y-auto bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl shadow-2xl border border-gray-100 dark:border-slate-800 p-4 sm:p-6">
            {detailLoading || !detail ? (
              <div className="space-y-3 animate-pulse">
                <div className="h-4 w-40 bg-gray-200 dark:bg-slate-700 rounded" />
                <div className="h-3 w-24 bg-gray-100 dark:bg-slate-800 rounded" />
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
                      {t("inventory.common.business_date")}: {formatDate(detail.business_date)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <InventoryStatusBadge status={detail.status} />
                    <button
                      onClick={() => { setDetail(null); setConfirmPost(false); }}
                      className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 cursor-pointer"
                      aria-label={t("inventory.common.close")}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <Row label={t("inventory.common.expected_quantity")} value={detail.expected_quantity} />
                  <Row label={t("inventory.common.accepted_quantity")} value={detail.total_quantity} />
                  <Row label={t("inventory.common.discrepancy")} value={detail.discrepancy} />
                  <Row label={t("inventory.common.invoice_number")} value={detail.invoice_number || "-"} />
                  <Row label={t("inventory.common.supplier")} value={detail.supplier || "-"} />
                </div>

                <div className="mt-4">
                  <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1.5">
                    {t("inventory.receiving.products_label")} ({detail.lines?.length || 0})
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

                <div className="mt-4">
                  <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-1.5">
                    {t("inventory.common.serials")} ({serialRowCount})
                  </p>
                  {/* Windowed list: only the rows inside the viewport are mounted,
                      so a 50,000-serial receipt scrolls as smoothly as 20 rows. */}
                  <div
                    className="overflow-y-auto rounded-xl border border-gray-100 dark:border-slate-800"
                    style={{ height: SERIAL_VIEWPORT_HEIGHT }}
                    onScroll={(event) => setSerialScrollTop(event.currentTarget.scrollTop)}
                  >
                    <div style={{ height: serialRowCount * SERIAL_ROW_HEIGHT, position: "relative" }}>
                      {serialVisibleRows.map(({ index, line }) => (
                        <div
                          key={index}
                          style={{
                            position: "absolute",
                            top: index * SERIAL_ROW_HEIGHT,
                            left: 0,
                            right: 0,
                            height: SERIAL_ROW_HEIGHT,
                          }}
                          className="flex items-center justify-between gap-2 px-3 text-xs font-mono border-b border-gray-50 dark:border-slate-800"
                        >
                          {line ? (
                            <>
                              <span className="truncate">{line.serial_number}</span>
                              <InventoryStatusBadge status={line.status_after || "received"} />
                            </>
                          ) : (
                            <span className="h-2.5 w-40 rounded bg-gray-100 dark:bg-slate-800 animate-pulse" />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {detail.status === "draft" && canReceive ? (
                  <div className="mt-4">
                    {!confirmPost ? (
                      <button
                        onClick={() => setConfirmPost(true)}
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 text-white text-sm font-semibold cursor-pointer"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        {t("inventory.receiving.post")}
                      </button>
                    ) : (
                      <div className="rounded-xl border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-500/10 p-3">
                        <p className="text-sm font-bold text-amber-800 dark:text-amber-200">
                          {t("inventory.receiving.confirm_post_title")}
                        </p>
                        <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                          {t("inventory.receiving.confirm_post_desc")}
                        </p>
                        <div className="flex gap-2 mt-3">
                          <button
                            onClick={() => setConfirmPost(false)}
                            disabled={posting}
                            className="flex-1 px-3 py-2 rounded-lg border border-amber-300 dark:border-amber-600 text-xs font-semibold cursor-pointer"
                          >
                            {t("inventory.common.cancel")}
                          </button>
                          <button
                            onClick={postReceipt}
                            disabled={posting}
                            className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-green-600 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
                          >
                            {posting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                            {t("inventory.common.confirm")}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-sm font-medium text-gray-900 dark:text-gray-100 text-right">{value ?? "-"}</span>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
        {label}
        {required ? <span className="text-red-500"> *</span> : null}
      </label>
      {children}
    </div>
  );
}
