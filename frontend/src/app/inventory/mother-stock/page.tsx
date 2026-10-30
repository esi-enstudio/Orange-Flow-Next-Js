"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  History,
  PackageCheck,
  RefreshCw,
  Search,
  UserRound,
  Warehouse,
  X,
} from "lucide-react";
import { toast } from "react-hot-toast";

import axios from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import { AccessDenied } from "@/components/ui/AccessDenied";
import PageGuideModal from "@/components/PageGuideModal";
import { InventoryStatusBadge } from "@/components/inventory/InventoryStatusBadge";
import { apiError, formatDate, houseHeaders } from "@/components/inventory/helpers";

const PER_PAGE = 20;
const SERIAL_STATUSES = [
  "received",
  "available",
  "assigned",
  "sold",
  "returned",
  "damaged",
  "quarantine",
  "adjusted",
];

interface ProductOption {
  id: number;
  product_code: string;
  product_name: string;
  category: string;
}

interface ProductStock {
  product_id: number;
  product_name?: string | null;
  product_code?: string | null;
  category?: string | null;
  available: number;
  assigned: number;
  returned: number;
  damaged: number;
  sold: number;
  total: number;
}

interface Summary {
  house: {
    available: number;
    assigned: number;
    returned: number;
    damaged: number;
    quarantine: number;
    sold: number;
    total: number;
  };
  by_product: ProductStock[];
  by_employee: {
    employee_id: number;
    employee_name?: string | null;
    dms_code?: string | null;
    assigned: number;
    returned: number;
  }[];
}

interface SerialRow {
  id: number;
  serial_number: string;
  product_name?: string | null;
  category?: string | null;
  status: string;
  employee_id?: number | null;
  employee_name?: string | null;
  dms_code?: string | null;
  received_at?: string | null;
}

interface HistoryPayload {
  serial: SerialRow;
  movements: {
    id: number;
    document_id: number;
    action: string;
    status_before?: string | null;
    status_after?: string | null;
    created_at?: string | null;
  }[];
  ledger: {
    id: number;
    movement_type: string;
    quantity: number;
    document_no?: string | null;
    status_after?: string | null;
    created_at?: string | null;
  }[];
}

interface PaginationMeta {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
}

export default function MotherStockPage() {
  const { t } = useLanguage();
  const { hasPermission, selectedHouse } = useAuth();
  const houseId = selectedHouse?.id;

  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [rows, setRows] = useState<SerialRow[]>([]);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [history, setHistory] = useState<HistoryPayload | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSummary = useCallback(async () => {
    if (!houseId) return;
    try {
      const res = await axios.get("/v1/inventory/summary", {
        headers: houseHeaders(houseId),
      });
      setSummary(res.data.data);
    } catch (err) {
      toast.error(apiError(err, t("inventory.common.error_generic")).message);
    }
  }, [houseId, t]);

  const fetchSerials = useCallback(async () => {
    if (!houseId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, per_page: PER_PAGE };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      if (productFilter) params.product_id = Number(productFilter);
      const res = await axios.get("/v1/inventory/serials", {
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
  }, [houseId, page, search, statusFilter, productFilter, t]);

  useEffect(() => {
    fetchSerials();
  }, [fetchSerials]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  useEffect(() => {
    if (!houseId) return;
    axios
      .get("/v1/inventory/products", { headers: houseHeaders(houseId) })
      .then((res) => setProducts(res.data.data || []))
      .catch(() => setProducts([]));
  }, [houseId]);

  const openHistory = async (serialId: number) => {
    setHistoryLoading(true);
    setHistory(null);
    try {
      const res = await axios.get(`/v1/inventory/serials/${serialId}/history`, {
        headers: houseHeaders(houseId),
      });
      setHistory(res.data.data);
    } catch (err) {
      toast.error(apiError(err, t("inventory.common.error_generic")).message);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleSearch = (value: string) => {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setPage(1), 400);
  };

  if (!hasPermission("inventory.view")) return <AccessDenied />;

  const cards = [
    {
      key: "available",
      label: t("inventory.mother_stock.available_stock"),
      value: summary?.house.available ?? 0,
      icon: PackageCheck,
      tone: "text-green-600 bg-green-50 dark:bg-green-500/10",
    },
    {
      key: "assigned",
      label: t("inventory.mother_stock.assigned_stock"),
      value: summary?.house.assigned ?? 0,
      icon: UserRound,
      tone: "text-indigo-600 bg-indigo-50 dark:bg-indigo-500/10",
    },
    {
      key: "returned",
      label: t("inventory.mother_stock.pending_returns"),
      value: summary?.house.returned ?? 0,
      icon: History,
      tone: "text-amber-600 bg-amber-50 dark:bg-amber-500/10",
    },
    {
      key: "damaged",
      label: t("inventory.mother_stock.damaged_stock"),
      value: (summary?.house.damaged ?? 0) + (summary?.house.quarantine ?? 0),
      icon: AlertTriangle,
      tone: "text-red-600 bg-red-50 dark:bg-red-500/10",
    },
    {
      key: "total",
      label: t("inventory.mother_stock.total_serials"),
      value: summary?.house.total ?? 0,
      icon: Warehouse,
      tone: "text-gray-600 bg-gray-100 dark:bg-slate-800",
    },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="p-2.5 bg-green-100 dark:bg-green-500/20 rounded-xl">
          <Warehouse className="w-5 h-5 text-green-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              {t("inventory.mother_stock.title")}
            </h1>
            <PageGuideModal pageKey="inventory.mother_stock" />
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("inventory.mother_stock.description")}
          </p>
        </div>
        <button
          onClick={() => {
            fetchSerials();
            fetchSummary();
          }}
          className="p-2.5 rounded-xl border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer"
          title={t("inventory.common.refresh")}
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {!houseId ? (
        <div className="rounded-2xl border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-200">
          {t("inventory.common.require_house")}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {cards.map((card) => (
              <div
                key={card.key}
                className="rounded-2xl border border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-3"
              >
                <div className={`inline-flex p-2 rounded-xl ${card.tone}`}>
                  <card.icon className="w-4 h-4" />
                </div>
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-2">
                  {card.value}
                </p>
                <p className="text-[11px] text-gray-500 dark:text-gray-400">{card.label}</p>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-2">
              {t("inventory.mother_stock.by_product_title")}
            </h2>
            {summary?.by_product?.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-[11px] uppercase text-gray-500 dark:text-gray-400">
                    <tr>
                      <th className="px-2 py-1.5">{t("inventory.common.product")}</th>
                      <th className="px-2 py-1.5 text-right">{t("inventory.status.available")}</th>
                      <th className="px-2 py-1.5 text-right">{t("inventory.status.assigned")}</th>
                      <th className="px-2 py-1.5 text-right">{t("inventory.status.returned")}</th>
                      <th className="px-2 py-1.5 text-right">{t("inventory.status.damaged")}</th>
                      <th className="px-2 py-1.5 text-right">{t("inventory.status.sold")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                    {summary.by_product.map((product) => (
                      <tr key={product.product_id}>
                        <td className="px-2 py-1">
                          <p className="font-medium">{product.product_name}</p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">
                            {product.product_code}
                          </p>
                        </td>
                        <td className="px-2 py-1 text-right font-semibold text-green-600">{product.available}</td>
                        <td className="px-2 py-1 text-right">{product.assigned}</td>
                        <td className="px-2 py-1 text-right">{product.returned}</td>
                        <td className="px-2 py-1 text-right">{product.damaged}</td>
                        <td className="px-2 py-1 text-right">{product.sold}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-gray-500 dark:text-gray-400">{t("inventory.mother_stock.empty")}</p>
            )}
          </div>

          {summary?.by_employee?.length ? (
            <div className="rounded-2xl border border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
              <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-2">
                {t("inventory.mother_stock.by_employee_title")}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {summary.by_employee.map((employee) => (
                  <div
                    key={employee.employee_id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 dark:border-slate-800 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{employee.employee_name}</p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                        {employee.dms_code}
                      </p>
                    </div>
                    <div className="text-right text-xs">
                      <p className="font-bold text-indigo-600">{employee.assigned}</p>
                      {employee.returned ? (
                        <p className="text-[11px] text-amber-600">+{employee.returned}</p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(event) => handleSearch(event.target.value)}
                placeholder={t("inventory.common.serial_search")}
                className="w-full rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 pl-9 pr-3 py-2.5 text-sm cursor-text outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <select
              value={productFilter}
              onChange={(event) => {
                setProductFilter(event.target.value);
                setPage(1);
              }}
              className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm cursor-pointer outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">{t("inventory.common.all_products")}</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.product_name}
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
              {SERIAL_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(`inventory.status.${status}`)}
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
                      <div className="h-3 w-36 bg-gray-200 dark:bg-slate-700 rounded-md" />
                      <div className="h-2.5 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
                    </div>
                    <div className="h-5 w-16 bg-gray-100 dark:bg-slate-800 rounded-full" />
                  </div>
                ))}
              </div>
            ) : rows.length === 0 ? (
              <div className="p-10 text-center">
                <Warehouse className="w-10 h-10 mx-auto text-gray-300 dark:text-slate-600" />
                <p className="mt-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
                  {t("inventory.mother_stock.empty")}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("inventory.mother_stock.empty_desc")}
                </p>
              </div>
            ) : (
              <>
                <div className="hidden lg:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-slate-800/50 text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      <tr>
                        <th className="px-2 py-2">{t("inventory.common.serial_numbers")}</th>
                        <th className="px-2 py-2">{t("inventory.common.product")}</th>
                        <th className="px-2 py-2">{t("inventory.common.status")}</th>
                        <th className="px-2 py-2">{t("inventory.common.employee")}</th>
                        <th className="px-2 py-2">{t("inventory.common.date")}</th>
                        <th className="px-2 py-2 text-right">{t("inventory.common.history")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                      {rows.map((row) => (
                        <tr key={row.id} className="hover:bg-gray-50/60 dark:hover:bg-slate-800/40">
                          <td className="px-2 py-1 font-mono text-xs">{row.serial_number}</td>
                          <td className="px-2 py-1">
                            <p className="font-medium">{row.product_name}</p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">{row.category}</p>
                          </td>
                          <td className="px-2 py-1">
                            <InventoryStatusBadge status={row.status} />
                          </td>
                          <td className="px-2 py-1">
                            {row.employee_name ? (
                              <>
                                <p>{row.employee_name}</p>
                                <p className="text-[11px] text-gray-500 dark:text-gray-400">{row.dms_code}</p>
                              </>
                            ) : (
                              "-"
                            )}
                          </td>
                          <td className="px-2 py-1 text-xs">{formatDate(row.received_at)}</td>
                          <td className="px-2 py-1 text-right">
                            <button
                              onClick={() => openHistory(row.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 text-xs font-semibold hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer"
                            >
                              <History className="w-3.5 h-3.5" />
                              {t("inventory.common.history")}
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
                            <p className="font-mono text-sm truncate">{row.serial_number}</p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                              {row.product_name}
                            </p>
                          </div>
                          <InventoryStatusBadge status={row.status} />
                          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                        {open ? (
                          <div className="px-4 pb-4 space-y-1.5 text-sm">
                            <InfoRow label={t("inventory.common.employee")} value={row.employee_name || "-"} />
                            <InfoRow label="DMS" value={row.dms_code || "-"} />
                            <InfoRow label={t("inventory.common.date")} value={formatDate(row.received_at)} />
                            <button
                              onClick={() => openHistory(row.id)}
                              className="mt-2 inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-200 dark:border-slate-700 text-xs font-semibold cursor-pointer"
                            >
                              <History className="w-3.5 h-3.5" /> {t("inventory.common.history")}
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

      {history || historyLoading ? (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="fixed inset-0 bg-black/40" onClick={() => setHistory(null)} />
          <div className="relative w-full sm:max-w-lg max-h-[92vh] overflow-y-auto bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl shadow-2xl border border-gray-100 dark:border-slate-800 p-4 sm:p-6">
            {historyLoading || !history ? (
              <div className="space-y-3 animate-pulse">
                <div className="h-4 w-40 bg-gray-200 dark:bg-slate-700 rounded" />
                <div className="h-20 bg-gray-100 dark:bg-slate-800 rounded-xl" />
                <div className="h-20 bg-gray-100 dark:bg-slate-800 rounded-xl" />
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <h2 className="text-base font-bold font-mono text-gray-900 dark:text-gray-100">
                      {history.serial.serial_number}
                    </h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {history.serial.product_name}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <InventoryStatusBadge status={history.serial.status} />
                    <button
                      onClick={() => setHistory(null)}
                      className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 cursor-pointer"
                      aria-label={t("inventory.common.close")}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <p className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 mb-1.5">
                  {t("inventory.common.movements")}
                </p>
                <div className="rounded-xl border border-gray-100 dark:border-slate-800 divide-y divide-gray-50 dark:divide-slate-800">
                  {history.movements.map((movement) => (
                    <div key={movement.id} className="px-3 py-2 text-xs flex items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold text-gray-800 dark:text-gray-100">
                          {t(`inventory.movement.${movement.action}`)}
                        </p>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">
                          {formatDate(movement.created_at)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {movement.status_before ? <InventoryStatusBadge status={movement.status_before} /> : null}
                        <span className="text-gray-400">→</span>
                        {movement.status_after ? <InventoryStatusBadge status={movement.status_after} /> : null}
                      </div>
                    </div>
                  ))}
                </div>

                <p className="text-[11px] font-bold uppercase text-gray-500 dark:text-gray-400 mt-4 mb-1.5">
                  {t("inventory.common.ledger")}
                </p>
                <div className="rounded-xl border border-gray-100 dark:border-slate-800 divide-y divide-gray-50 dark:divide-slate-800">
                  {history.ledger.map((entry) => (
                    <div key={entry.id} className="px-3 py-2 text-xs flex items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold text-gray-800 dark:text-gray-100">
                          {t(`inventory.movement.${entry.movement_type}`)}
                        </p>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400">
                          {entry.document_no} • {formatDate(entry.created_at)}
                        </p>
                      </div>
                      <span
                        className={`font-bold ${entry.quantity > 0 ? "text-green-600" : "text-red-500"}`}
                      >
                        {entry.quantity > 0 ? `+${entry.quantity}` : entry.quantity}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
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
