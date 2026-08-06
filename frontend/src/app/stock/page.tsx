"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import { toast } from "react-hot-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { motion, AnimatePresence } from "framer-motion";
import {
  Warehouse,
  Package,
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Loader2,
  X,
  ArrowLeftRight,
  Wrench,
  ArrowUp,
  ArrowDown,
  Boxes,
  AlertCircle,
  FileClock,
  Layers,
  TrendingUp,
  CalendarCheck,
  Users,
} from "lucide-react";

interface Product {
  id: number;
  product_code: string;
  product_name: string;
  category?: string;
  mrp: number;
  dd_lifting_price: number;
  ret_lifting_price: number;
  warehouse_quantity?: number;
  rso_quantity?: number;
  total_quantity?: number;
}

interface EmployeeOpt {
  id: number;
  employee_id: string;
  name: string;
  dms_code?: string;
  employee_type?: string;
  house_id: number;
  stock_quantity?: number;
}

interface SummaryRow {
  product_id: number;
  product_code: string;
  product_name: string;
  category?: string;
  unit_price: number;
  warehouse_quantity: number;
  rso_quantity: number;
  total_quantity: number;
  warehouse_value: number;
  rso_value: number;
  total_value: number;
}

interface StockItemRow {
  id: number;
  product_code: string;
  product_name: string;
  product_category?: string;
  location_type: string;
  employee_name?: string;
  quantity: number;
  unit_price: number;
  total_value: number;
}

interface Transfer {
  id: number;
  product_code: string;
  product_name: string;
  from_type: string;
  to_type: string;
  from_employee_name?: string;
  to_employee_name?: string;
  quantity: number;
  notes?: string;
  created_at?: string;
  created_by_name?: string;
}

interface Adjustment {
  id: number;
  product_code: string;
  product_name: string;
  location_type: string;
  employee_name?: string;
  adjustment_type: string;
  direction: string;
  quantity: number;
  reason: string;
  created_at?: string;
  created_by_name?: string;
}

interface LedgerEntry {
  id: number;
  product_code: string;
  product_name: string;
  location_type: string;
  employee_name?: string;
  movement_type: string;
  quantity: number;
  balance_after: number;
  reason?: string;
  created_at?: string;
  created_by_name?: string;
}

interface SnapshotRow {
  id: number;
  snapshot_date: string;
  product_code: string;
  product_name: string;
  location_type: string;
  employee_name?: string;
  quantity: number;
  unit_value: number;
  total_value: number;
}

const TABS = [
  { key: "summary", labelKey: "stock.summary_tab" },
  { key: "items", labelKey: "stock.items_tab" },
  { key: "transfers", labelKey: "stock.transfers_tab" },
  { key: "adjustments", labelKey: "stock.adjustments_tab" },
  { key: "ledger", labelKey: "stock.ledger_tab" },
  { key: "snapshots", labelKey: "stock.snapshots_tab" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function fmtMoney(n: number) {
  return "৳" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d?: string) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) +
    " " + new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white dark:bg-slate-900 p-5 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>
        {children}
      </motion.div>
    </div>
  );
}

function ProductSelect({
  products,
  value,
  sourceType,
  onChange,
}: {
  products: Product[];
  value: string;
  sourceType: "warehouse" | "rso";
  onChange: (v: string) => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const selected = products.find((p) => String(p.id) === value);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.product_name.toLowerCase().includes(q) ||
        p.product_code.toLowerCase().includes(q)
    );
  }, [products, query]);

  const sourceCount = (p: Product) =>
    sourceType === "rso" ? (p.rso_quantity ?? 0) : (p.warehouse_quantity ?? 0);

  const badgeCls = (count: number) =>
    count > 0
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
      : "bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-gray-500";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "w-full flex items-center justify-between gap-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 text-left",
          !selected && "text-gray-400 dark:text-gray-500"
        )}
      >
        {selected ? (
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate font-medium text-gray-900 dark:text-gray-100">{selected.product_name}</span>
            <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">{selected.product_code}</span>
          </span>
        ) : (
          <span className="truncate">{t("stock.select_product")}</span>
        )}
        <span className="flex shrink-0 items-center gap-1.5">
          {selected && (
            <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums", badgeCls(sourceCount(selected)))}>
              <Package className="h-3 w-3" />
              {sourceCount(selected).toLocaleString("en-US")}
            </span>
          )}
          <ChevronDown className={cn("h-4 w-4 text-gray-400 transition-transform", open && "rotate-180")} />
        </span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1.5 w-full overflow-hidden rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl">
          <div className="border-b border-gray-100 dark:border-slate-800 p-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("stock.search_placeholder")}
                className="w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 pl-8 pr-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-gray-400 dark:text-gray-500">{t("stock.no_products")}</p>
            ) : (
              filtered.map((p) => {
                const count = sourceCount(p);
                const isSelected = String(p.id) === value;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      onChange(String(p.id));
                      setOpen(false);
                      setQuery("");
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition-colors",
                      "hover:bg-gray-50 dark:hover:bg-slate-800",
                      isSelected && "bg-emerald-50 dark:bg-emerald-500/10"
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">{p.product_name}</span>
                      <span className="block text-[11px] text-gray-500 dark:text-gray-400">{p.product_code}</span>
                    </span>
                    <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", badgeCls(count))}>
                      <Package className="h-3 w-3" />
                      {count.toLocaleString("en-US")}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EmployeeSelect({
  employees,
  value,
  showStock,
  onChange,
}: {
  employees: EmployeeOpt[];
  value: string;
  showStock: boolean;
  onChange: (v: string) => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const selected = employees.find((e) => String(e.id) === value);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.employee_id.toLowerCase().includes(q) ||
        (e.dms_code || "").toLowerCase().includes(q)
    );
  }, [employees, query]);

  const stockBadgeCls = (stock: number) =>
    stock > 0
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
      : "bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-gray-500";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "w-full flex items-center justify-between gap-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 text-left",
          !selected && "text-gray-400 dark:text-gray-500"
        )}
      >
        {selected ? (
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate font-medium text-gray-900 dark:text-gray-100">{selected.name}</span>
            <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">{selected.employee_id}</span>
          </span>
        ) : (
          <span className="truncate">{t("stock.select_employee")}</span>
        )}
        <span className="flex shrink-0 items-center gap-1.5">
          {selected && (
            <span className="inline-flex items-center rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase text-gray-500 dark:bg-slate-800 dark:text-gray-400">
              {selected.employee_type || "-"}
            </span>
          )}
          {selected && showStock && (
            <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums", stockBadgeCls(selected.stock_quantity ?? 0))}>
              <Package className="h-3 w-3" />
              {(selected.stock_quantity ?? 0).toLocaleString("en-US")}
            </span>
          )}
          <ChevronDown className={cn("h-4 w-4 text-gray-400 transition-transform", open && "rotate-180")} />
        </span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1.5 w-full overflow-hidden rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl">
          <div className="border-b border-gray-100 dark:border-slate-800 p-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("stock.search_employee")}
                className="w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 pl-8 pr-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>
          <div className="max-h-60 overflow-y-auto p-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-gray-400 dark:text-gray-500">{t("stock.no_employees")}</p>
            ) : (
              filtered.map((e) => {
                const stock = e.stock_quantity ?? 0;
                const isSelected = String(e.id) === value;
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => {
                      onChange(String(e.id));
                      setOpen(false);
                      setQuery("");
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left transition-colors",
                      "hover:bg-gray-50 dark:hover:bg-slate-800",
                      isSelected && "bg-emerald-50 dark:bg-emerald-500/10"
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{e.name}</span>
                        <span className="inline-flex shrink-0 items-center rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase text-gray-500 dark:bg-slate-800 dark:text-gray-400">
                          {e.employee_type || "-"}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-[11px] text-gray-500 dark:text-gray-400">
                        {e.employee_id}
                        {e.dms_code ? ` · ${e.dms_code}` : ""}
                      </span>
                    </span>
                    {showStock && (
                      <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", stockBadgeCls(stock))}>
                        <Package className="h-3 w-3" />
                        {stock.toLocaleString("en-US")}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StockStat({ label, value, active }: { label: string; value: number; active?: boolean }) {
  return (
    <div className={cn(
      "rounded-lg border px-2.5 py-2 text-center",
      active
        ? "border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/10"
        : "border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900"
    )}>
      <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400">{label}</p>
      <p className={cn("mt-0.5 text-base font-bold tabular-nums", active ? "text-emerald-600 dark:text-emerald-400" : "text-gray-900 dark:text-gray-100")}>
        {value.toLocaleString("en-US")}
      </p>
    </div>
  );
}

function LocationToggle({
  value,
  onChange,
  t,
}: {
  value: "warehouse" | "rso";
  onChange: (v: "warehouse" | "rso") => void;
  t: (path: string, params?: Record<string, string | number | undefined>) => string;
}) {
  const options = [
    { value: "warehouse" as const, label: t("stock.warehouse"), icon: Warehouse },
    { value: "rso" as const, label: t("stock.rso"), icon: Users },
  ];
  return (
    <div className="flex rounded-lg border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 p-0.5">
      {options.map((opt) => {
        const Icon = opt.icon;
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-all",
              active
                ? "bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
            )}
          >
            <Icon className="h-4 w-4" />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function ScopeBadge({ house, t }: { house: { id: number; name: string; code: string } | null; t: (path: string, params?: Record<string, string | number | undefined>) => string }) {
  if (!house) {
    return (
      <span className="inline-flex items-center rounded-md bg-gray-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-medium text-gray-500 dark:text-gray-400">
        {t("stock.no_house_scope")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 dark:bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
      {t("stock.scope_house")}: {house.name} ({house.code})
    </span>
  );
}

export default function StockPage() {
  const { hasPermission, loading: authLoading, selectedHouse } = useAuth();
  const { t } = useLanguage();

  const [activeTab, setActiveTab] = useState<TabKey>("summary");
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [summaryTotals, setSummaryTotals] = useState({ warehouse_quantity: 0, rso_quantity: 0, total_quantity: 0, total_value: 0 });

  const [items, setItems] = useState<StockItemRow[]>([]);
  const [itemsPage, setItemsPage] = useState(1);
  const [itemsTotal, setItemsTotal] = useState(0);
  const [itemsPerPage, setItemsPerPage] = useState(20);
  const [itemsLocation, setItemsLocation] = useState<string>("");

  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [transfersPage, setTransfersPage] = useState(1);
  const [transfersTotal, setTransfersTotal] = useState(0);

  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [adjustmentsPage, setAdjustmentsPage] = useState(1);
  const [adjustmentsTotal, setAdjustmentsTotal] = useState(0);

  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerTotal, setLedgerTotal] = useState(0);
  const [ledgerMovement, setLedgerMovement] = useState<string>("");

  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [snapshotsPage, setSnapshotsPage] = useState(1);
  const [snapshotsTotal, setSnapshotsTotal] = useState(0);

  const [search, setSearch] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [employees, setEmployees] = useState<EmployeeOpt[]>([]);

  const [accessibleHouses, setAccessibleHouses] = useState<{ id: number; name: string; code: string }[]>([]);
  const [modalHouse, setModalHouse] = useState<string>("");
  const productReqRef = useRef(0);
  const employeeReqRef = useRef(0);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [housePrompt, setHousePrompt] = useState(false);

  const [modal, setModal] = useState<"stock" | "transfer" | "adjustment" | null>(null);

  const [stockForm, setStockForm] = useState({ product_id: "", location_type: "warehouse", employee_id: "", quantity: "" });
  const [transferForm, setTransferForm] = useState({ product_id: "", from_type: "warehouse", from_employee_id: "", to_type: "rso", to_employee_id: "", quantity: "", notes: "" });
  const [adjustForm, setAdjustForm] = useState({ product_id: "", location_type: "warehouse", employee_id: "", adjustment_type: "loss", direction: "decrease", quantity: "", reason: "", notes: "" });

  const houseId = selectedHouse?.id;

  const headers = useMemo(() => {
    const h: Record<string, string> = {};
    if (houseId) h["X-House-ID"] = String(houseId);
    return h;
  }, [houseId]);

  const mutationHouseId = selectedHouse?.id ?? (modalHouse ? Number(modalHouse) : undefined);

  const mutationHeaders = useMemo(() => {
    const h: Record<string, string> = {};
    if (mutationHouseId) h["X-House-ID"] = String(mutationHouseId);
    return h;
  }, [mutationHouseId]);

  const effectiveHouse = useMemo(() => {
    if (!mutationHouseId) return null;
    return accessibleHouses.find((h) => h.id === mutationHouseId) ?? null;
  }, [mutationHouseId, accessibleHouses]);

  const totalPages = (total: number, perPage: number) => Math.max(1, Math.ceil(total / perPage));

  const fetchHouses = async () => {
    try {
      const res = await apiClient.get("houses/accessible");
      setAccessibleHouses(res.data || []);
    } catch {
      // non-blocking
    }
  };

  const fetchMeta = async (houseIdParam: number) => {
    const pReqId = ++productReqRef.current;
    const eReqId = ++employeeReqRef.current;
    try {
      const h: Record<string, string> = { "X-House-ID": String(houseIdParam) };
      const [pRes, eRes] = await Promise.all([
        apiClient.get("stock/products", { headers: h }),
        apiClient.get("stock/employees", { headers: h }),
      ]);
      if (pReqId === productReqRef.current) setProducts(pRes.data.data || []);
      if (eReqId === employeeReqRef.current) setEmployees(eRes.data.data || []);
    } catch {
      // non-blocking
    }
  };

  const fetchEmployees = async () => {
    const eReqId = ++employeeReqRef.current;
    try {
      const params: Record<string, string> = {};
      if (transferForm.product_id) params.product_id = transferForm.product_id;
      const res = await apiClient.get("stock/employees", { params, headers: mutationHeaders });
      if (eReqId !== employeeReqRef.current) return;
      setEmployees(res.data.data || []);
    } catch {
      // non-blocking
    }
  };

  const fetchSummary = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get("stock/summary", { headers });
      setSummary(res.data.data || []);
      setSummaryTotals(res.data.totals || {});
    } catch {
      toast.error(t("common.error"));
    } finally {
      setLoading(false);
    }
  };

  const fetchItems = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(itemsPage), per_page: String(itemsPerPage) };
      if (itemsLocation) params.location_type = itemsLocation;
      const res = await apiClient.get("stock/items", { params, headers });
      setItems(res.data.data || []);
      setItemsTotal(res.data.pagination?.total || 0);
    } catch {
      toast.error(t("common.error"));
    } finally {
      setLoading(false);
    }
  };

  const fetchTransfers = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get("stock/transfers", { params: { page: String(transfersPage), per_page: "20" }, headers });
      setTransfers(res.data.data || []);
      setTransfersTotal(res.data.pagination?.total || 0);
    } catch {
      toast.error(t("common.error"));
    } finally {
      setLoading(false);
    }
  };

  const fetchAdjustments = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get("stock/adjustments", { params: { page: String(adjustmentsPage), per_page: "20" }, headers });
      setAdjustments(res.data.data || []);
      setAdjustmentsTotal(res.data.pagination?.total || 0);
    } catch {
      toast.error(t("common.error"));
    } finally {
      setLoading(false);
    }
  };

  const fetchLedger = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(ledgerPage), per_page: "20" };
      if (ledgerMovement) params.movement_type = ledgerMovement;
      const res = await apiClient.get("stock/ledger", { params, headers });
      setLedger(res.data.data || []);
      setLedgerTotal(res.data.pagination?.total || 0);
    } catch {
      toast.error(t("common.error"));
    } finally {
      setLoading(false);
    }
  };

  const fetchSnapshots = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get("stock/snapshots", { params: { page: String(snapshotsPage), per_page: "20" }, headers });
      setSnapshots(res.data.data || []);
      setSnapshotsTotal(res.data.pagination?.total || 0);
    } catch {
      toast.error(t("common.error"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && hasPermission("stock.view")) fetchHouses();
  }, [authLoading, hasPermission]);

  useEffect(() => {
    if (!modal) return;
    const targetHouseId = selectedHouse?.id ?? (modalHouse ? Number(modalHouse) : undefined);
    setProducts([]);
    setEmployees([]);
    if (!targetHouseId) return;
    fetchMeta(targetHouseId);
  }, [modal, modalHouse, selectedHouse?.id]);

  useEffect(() => {
    if (!authLoading && hasPermission("stock.view")) fetchSummary();
  }, [authLoading, hasPermission, houseId]);

  useEffect(() => {
    if (!authLoading && hasPermission("stock.view") && activeTab === "items") fetchItems();
  }, [activeTab, itemsPage, itemsLocation, authLoading, hasPermission, houseId]);

  useEffect(() => {
    if (!authLoading && hasPermission("stock.view") && activeTab === "transfers") fetchTransfers();
  }, [activeTab, transfersPage, authLoading, hasPermission, houseId]);

  useEffect(() => {
    if (!authLoading && hasPermission("stock.view") && activeTab === "adjustments") fetchAdjustments();
  }, [activeTab, adjustmentsPage, authLoading, hasPermission, houseId]);

  useEffect(() => {
    if (!authLoading && hasPermission("stock.view") && activeTab === "ledger") fetchLedger();
  }, [activeTab, ledgerPage, ledgerMovement, authLoading, hasPermission, houseId]);

  useEffect(() => {
    if (!authLoading && hasPermission("stock.view") && activeTab === "snapshots") fetchSnapshots();
  }, [activeTab, snapshotsPage, authLoading, hasPermission, houseId]);

  useEffect(() => {
    if (modal !== "transfer") return;
    if (!mutationHouseId) return;
    if (transferForm.from_type !== "rso" && transferForm.to_type !== "rso") return;
    fetchEmployees();
  }, [modal, transferForm.product_id, transferForm.from_type, transferForm.to_type, mutationHouseId]);

  const filteredSummary = useMemo(() => {
    if (!search) return summary;
    const q = search.toLowerCase();
    return summary.filter(r =>
      r.product_name.toLowerCase().includes(q) || r.product_code.toLowerCase().includes(q)
    );
  }, [summary, search]);

  const swapTransfer = () => {
    setTransferForm((prev) => ({
      ...prev,
      from_type: prev.to_type,
      to_type: prev.from_type,
      from_employee_id: prev.to_employee_id,
      to_employee_id: prev.from_employee_id,
    }));
  };

  const openModal = (m: "stock" | "transfer" | "adjustment") => {
    if (!selectedHouse && accessibleHouses.length === 0) {
      setHousePrompt(true);
      return;
    }
    if (!selectedHouse && accessibleHouses.length === 1) {
      setModalHouse(String(accessibleHouses[0].id));
    }
    setModal(m);
  };

  const submitStock = async () => {
    if (!mutationHouseId) {
      toast.error(t("stock.select_house_first"));
      return;
    }
    if (!stockForm.product_id) {
      toast.error(t("stock.select_product"));
      return;
    }
    const quantity = Number(stockForm.quantity);
    if (!quantity || quantity <= 0) {
      toast.error(t("stock.quantity_required"));
      return;
    }
    if (stockForm.location_type === "rso" && !stockForm.employee_id) {
      toast.error(t("stock.select_employee"));
      return;
    }
    setActionLoading(true);
    try {
      await apiClient.post("stock/items", {
        product_id: Number(stockForm.product_id),
        location_type: stockForm.location_type,
        employee_id: stockForm.location_type === "rso" ? Number(stockForm.employee_id) : undefined,
        quantity,
      }, { headers: mutationHeaders });
      toast.success(t("stock.stock_added"));
      setModal(null);
      setStockForm({ product_id: "", location_type: "warehouse", employee_id: "", quantity: "" });
      fetchSummary();
      if (activeTab === "items") fetchItems();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || t("common.error"));
    } finally {
      setActionLoading(false);
    }
  };

  const submitTransfer = async () => {
    if (!mutationHouseId) {
      toast.error(t("stock.select_house_first"));
      return;
    }
    if (!transferForm.product_id) {
      toast.error(t("stock.select_product"));
      return;
    }
    const quantity = Number(transferForm.quantity);
    if (!quantity || quantity <= 0) {
      toast.error(t("stock.quantity_required"));
      return;
    }
    if (selectedTransferProduct && quantity > transferSourceStock) {
      toast.error(t("stock.quantity_exceeds"));
      return;
    }
    if (transferForm.from_type === "rso" && !transferForm.from_employee_id) {
      toast.error(t("stock.select_employee"));
      return;
    }
    if (transferForm.to_type === "rso" && !transferForm.to_employee_id) {
      toast.error(t("stock.select_employee"));
      return;
    }
    setActionLoading(true);
    try {
      await apiClient.post("stock/transfers", {
        product_id: Number(transferForm.product_id),
        from_type: transferForm.from_type,
        from_employee_id: transferForm.from_type === "rso" ? Number(transferForm.from_employee_id) : undefined,
        to_type: transferForm.to_type,
        to_employee_id: transferForm.to_type === "rso" ? Number(transferForm.to_employee_id) : undefined,
        quantity,
        notes: transferForm.notes || undefined,
      }, { headers: mutationHeaders });
      toast.success(t("stock.transfer_success"));
      setModal(null);
      setTransferForm({ product_id: "", from_type: "warehouse", from_employee_id: "", to_type: "rso", to_employee_id: "", quantity: "", notes: "" });
      fetchSummary();
      if (activeTab === "transfers") fetchTransfers();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || t("common.error"));
    } finally {
      setActionLoading(false);
    }
  };

  const submitAdjustment = async () => {
    if (!mutationHouseId) {
      toast.error(t("stock.select_house_first"));
      return;
    }
    if (!adjustForm.product_id) {
      toast.error(t("stock.select_product"));
      return;
    }
    const quantity = Number(adjustForm.quantity);
    if (!quantity || quantity <= 0) {
      toast.error(t("stock.quantity_required"));
      return;
    }
    if (!adjustForm.reason || adjustForm.reason.trim().length < 3) {
      toast.error(t("stock.reason_required"));
      return;
    }
    if (adjustForm.location_type === "rso" && !adjustForm.employee_id) {
      toast.error(t("stock.select_employee"));
      return;
    }
    setActionLoading(true);
    try {
      await apiClient.post("stock/adjustments", {
        product_id: Number(adjustForm.product_id),
        location_type: adjustForm.location_type,
        employee_id: adjustForm.location_type === "rso" ? Number(adjustForm.employee_id) : undefined,
        adjustment_type: adjustForm.adjustment_type,
        direction: adjustForm.direction,
        quantity,
        reason: adjustForm.reason,
        notes: adjustForm.notes || undefined,
      }, { headers: mutationHeaders });
      toast.success(t("stock.adjustment_success"));
      setModal(null);
      setAdjustForm({ product_id: "", location_type: "warehouse", employee_id: "", adjustment_type: "loss", direction: "decrease", quantity: "", reason: "", notes: "" });
      fetchSummary();
      if (activeTab === "adjustments") fetchAdjustments();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || t("common.error"));
    } finally {
      setActionLoading(false);
    }
  };

  const generateSnapshot = async () => {
    if (!mutationHouseId) {
      toast.error(t("stock.select_house_first"));
      return;
    }
    setActionLoading(true);
    try {
      await apiClient.post("stock/snapshots/generate", null, { headers: mutationHeaders });
      toast.success(t("stock.snapshot_generated"));
      fetchSnapshots();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || t("common.error"));
    } finally {
      setActionLoading(false);
    }
  };

  if (!hasPermission("stock.view")) return <AccessDenied />;

  const renderPagination = (page: number, total: number, perPage: number, setPage: (n: number) => void) => {
    const tp = totalPages(total, perPage);
    return (
      <div className="flex items-center justify-between gap-4 pt-4 flex-wrap">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {total === 0 ? "0" : `${(page - 1) * perPage + 1}-${Math.min(page * perPage, total)}`} / {total}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-gray-600 dark:text-gray-300">{page} / {tp}</span>
          <Button variant="outline" size="sm" disabled={page >= tp || loading} onClick={() => setPage(page + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  };

  const skeleton = (rows: number) => (
    <div className="divide-y divide-gray-100 dark:divide-slate-800">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-4 animate-pulse">
          <div className="w-10 h-10 rounded-xl bg-gray-200 dark:bg-slate-700 shrink-0" />
          <div className="space-y-2 flex-1">
            <div className="h-3 w-40 bg-gray-200 dark:bg-slate-700 rounded-md" />
            <div className="h-2.5 w-28 bg-gray-100 dark:bg-slate-800 rounded-md" />
          </div>
          <div className="hidden sm:block flex-1 space-y-2">
            <div className="h-3 w-20 bg-gray-200 dark:bg-slate-700 rounded-md" />
            <div className="h-2.5 w-16 bg-gray-100 dark:bg-slate-800 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );

  const inputCls = "w-full rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary/50";
  const labelCls = "block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5";

  const selectedTransferProduct = transferForm.product_id
    ? products.find((p) => String(p.id) === transferForm.product_id)
    : undefined;
  const transferSourceStock =
    transferForm.from_type === "rso"
      ? (selectedTransferProduct?.rso_quantity ?? 0)
      : (selectedTransferProduct?.warehouse_quantity ?? 0);

  const movementLabel = (m: string) => {
    const map: Record<string, string> = {
      transfer_in: t("stock.transfer_in"),
      transfer_out: t("stock.transfer_out"),
      sale: t("stock.sale"),
      purchase: t("stock.purchase"),
      adjustment: t("stock.adjustment"),
      return: t("stock.return"),
    };
    return map[m] || m;
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Warehouse className="h-6 w-6 text-emerald-500" />
              {t("stock.title")}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t("stock.description")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {hasPermission("stock.create") && (
              <Button size="sm" onClick={() => openModal("stock")}>
                <Plus className="h-4 w-4" /> {t("stock.add_stock")}
              </Button>
            )}
            {hasPermission("stock.transfer") && (
              <Button size="sm" variant="outline" onClick={() => openModal("transfer")}>
                <ArrowLeftRight className="h-4 w-4" /> {t("stock.new_transfer")}
              </Button>
            )}
            {hasPermission("stock.adjust") && (
              <Button size="sm" variant="outline" onClick={() => openModal("adjustment")}>
                <Wrench className="h-4 w-4" /> {t("stock.new_adjustment")}
              </Button>
            )}
          </div>
        </div>

        <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                activeTab === tab.key
                  ? "bg-emerald-500 text-white"
                  : "bg-white dark:bg-slate-900 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800 border border-gray-200 dark:border-slate-700"
              )}
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={activeTab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {/* ---------- SUMMARY ---------- */}
            {activeTab === "summary" && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <Card className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-blue-100 dark:bg-blue-900/40">
                        <Boxes className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{t("stock.warehouse_qty")}</p>
                        <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{summaryTotals.warehouse_quantity || 0}</p>
                      </div>
                    </div>
                  </Card>
                  <Card className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-purple-100 dark:bg-purple-900/40">
                        <Layers className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{t("stock.rso_qty")}</p>
                        <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{summaryTotals.rso_quantity || 0}</p>
                      </div>
                    </div>
                  </Card>
                  <Card className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-emerald-100 dark:bg-emerald-900/40">
                        <Package className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{t("stock.total_qty")}</p>
                        <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{summaryTotals.total_quantity || 0}</p>
                      </div>
                    </div>
                  </Card>
                  <Card className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-amber-100 dark:bg-amber-900/40">
                        <TrendingUp className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                      </div>
                      <div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{t("stock.total_value")}</p>
                        <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{fmtMoney(summaryTotals.total_value || 0)}</p>
                      </div>
                    </div>
                  </Card>
                </div>

                <Card className="overflow-hidden">
                  <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center gap-3">
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                      <FileClock className="h-4 w-4 text-emerald-500" /> {t("stock.summary_tab")}
                    </h3>
                    <div className="relative sm:ml-auto sm:w-72">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={t("stock.search_placeholder")}
                        className={cn(inputCls, "pl-9")}
                      />
                    </div>
                  </div>

                  {loading ? skeleton(5) : (
                    <>
                    <div className="hidden lg:block overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-100 dark:border-slate-800 text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                            <th className="px-4 py-3">{t("stock.product")}</th>
                            <th className="px-2 py-1 hidden sm:table-cell">{t("stock.warehouse_qty")}</th>
                            <th className="px-2 py-1">{t("stock.rso_qty")}</th>
                            <th className="px-2 py-1">{t("stock.total_qty")}</th>
                            <th className="px-2 py-1 text-right">{t("stock.total_value")}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 dark:divide-slate-800/60">
                          {filteredSummary.map((r) => (
                            <tr key={r.product_id} className="hover:bg-gray-50 dark:hover:bg-slate-900/50">
                              <td className="px-4 py-2">
                                <p className="font-medium text-gray-900 dark:text-gray-100">{r.product_name}</p>
                                <p className="text-[11px] text-gray-500 dark:text-gray-400">{r.product_code}</p>
                              </td>
                              <td className="px-2 py-1 hidden sm:table-cell">{r.warehouse_quantity}</td>
                              <td className="px-2 py-1">{r.rso_quantity}</td>
                              <td className="px-2 py-1 font-medium">{r.total_quantity}</td>
                              <td className="px-2 py-1 text-right font-medium">{fmtMoney(r.total_value)}</td>
                            </tr>
                          ))}
                          {filteredSummary.length === 0 && (
                            <tr>
                              <td colSpan={5} className="px-4 py-10 text-center text-gray-400">{t("stock.no_data")}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <div className="lg:hidden divide-y divide-gray-100 dark:divide-slate-800">
                      {filteredSummary.map((r) => {
                        const open = expandedId === r.product_id;
                        return (
                          <div key={r.product_id} className="px-4 py-3">
                            <button className="w-full flex items-center gap-3 text-left" onClick={() => setExpandedId(open ? null : r.product_id)}>
                              <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center shrink-0">
                                <Package className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{r.product_name}</p>
                                <p className="text-[11px] text-gray-500 dark:text-gray-400">{r.product_code}</p>
                              </div>
                              <div className="text-right">
                                <p className="font-semibold text-gray-900 dark:text-gray-100">{r.total_quantity}</p>
                                <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.total_qty")}</p>
                              </div>
                              {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                            </button>
                            {open && (
                              <div className="mt-3 grid grid-cols-2 gap-3 text-sm bg-gray-50 dark:bg-slate-900 rounded-xl p-3">
                                <div>
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.warehouse_qty")}</p>
                                  <p className="font-medium text-gray-900 dark:text-gray-100">{r.warehouse_quantity}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.rso_qty")}</p>
                                  <p className="font-medium text-gray-900 dark:text-gray-100">{r.rso_quantity}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.unit_value")}</p>
                                  <p className="font-medium text-gray-900 dark:text-gray-100">{fmtMoney(r.unit_price)}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.total_value")}</p>
                                  <p className="font-medium text-emerald-600 dark:text-emerald-400">{fmtMoney(r.total_value)}</p>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {filteredSummary.length === 0 && (
                        <div className="px-4 py-10 text-center text-gray-400">{t("stock.no_data")}</div>
                      )}
                    </div>
                    </>
                  )}
                </Card>
              </div>
            )}

            {/* ---------- ITEMS ---------- */}
            {activeTab === "items" && (
              <Card className="overflow-hidden">
                <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center gap-3">
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    <Boxes className="h-4 w-4 text-emerald-500" /> {t("stock.items_tab")}
                  </h3>
                  <select
                    value={itemsLocation}
                    onChange={(e) => { setItemsLocation(e.target.value); setItemsPage(1); }}
                    className={cn(inputCls, "sm:ml-auto sm:w-48")}
                  >
                    <option value="">{t("stock.movement_all")}</option>
                    <option value="warehouse">{t("stock.warehouse")}</option>
                    <option value="rso">{t("stock.rso")}</option>
                  </select>
                </div>

                {loading ? skeleton(5) : (
                  <>
                    <div className="hidden lg:block overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-100 dark:border-slate-800 text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                            <th className="px-4 py-3">{t("stock.product")}</th>
                            <th className="px-2 py-1">{t("stock.location")}</th>
                            <th className="px-2 py-1">{t("stock.employee")}</th>
                            <th className="px-2 py-1">{t("stock.quantity")}</th>
                            <th className="px-2 py-1 text-right">{t("stock.value")}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 dark:divide-slate-800/60">
                          {items.map((it) => (
                            <tr key={it.id} className="hover:bg-gray-50 dark:hover:bg-slate-900/50">
                              <td className="px-4 py-2">
                                <p className="font-medium text-gray-900 dark:text-gray-100">{it.product_name}</p>
                                <p className="text-[11px] text-gray-500 dark:text-gray-400">{it.product_code}</p>
                              </td>
                              <td className="px-2 py-1">
                                <span className={cn(
                                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                                  it.location_type === "warehouse"
                                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                                    : "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300"
                                )}>
                                  {it.location_type === "warehouse" ? <Boxes className="h-3 w-3" /> : <Layers className="h-3 w-3" />}
                                  {it.location_type === "warehouse" ? t("stock.warehouse") : t("stock.rso")}
                                </span>
                              </td>
                              <td className="px-2 py-1 text-gray-600 dark:text-gray-300">{it.employee_name || "-"}</td>
                              <td className="px-2 py-1 font-medium">{it.quantity}</td>
                              <td className="px-2 py-1 text-right">{fmtMoney(it.total_value)}</td>
                            </tr>
                          ))}
                          {items.length === 0 && (
                            <tr>
                              <td colSpan={5} className="px-4 py-10 text-center text-gray-400">{t("stock.no_items")}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <div className="lg:hidden divide-y divide-gray-100 dark:divide-slate-800">
                      {items.map((it) => {
                        const open = expandedId === it.id;
                        return (
                          <div key={it.id} className="px-4 py-3">
                            <button className="w-full flex items-center gap-3 text-left" onClick={() => setExpandedId(open ? null : it.id)}>
                              <div className={cn(
                                "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                                it.location_type === "warehouse"
                                  ? "bg-blue-100 dark:bg-blue-900/40"
                                  : "bg-purple-100 dark:bg-purple-900/40"
                              )}>
                                {it.location_type === "warehouse"
                                  ? <Boxes className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                                  : <Layers className="h-5 w-5 text-purple-600 dark:text-purple-400" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{it.product_name}</p>
                                <p className="text-[11px] text-gray-500 dark:text-gray-400">{it.product_code}</p>
                              </div>
                              <div className="text-right">
                                <p className="font-semibold text-gray-900 dark:text-gray-100">{it.quantity}</p>
                                <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.quantity")}</p>
                              </div>
                              {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                            </button>
                            {open && (
                              <div className="mt-3 grid grid-cols-2 gap-3 text-sm bg-gray-50 dark:bg-slate-900 rounded-xl p-3">
                                <div>
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.location")}</p>
                                  <p className="font-medium text-gray-900 dark:text-gray-100">
                                    {it.location_type === "warehouse" ? t("stock.warehouse") : t("stock.rso")}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.employee")}</p>
                                  <p className="font-medium text-gray-900 dark:text-gray-100">{it.employee_name || "-"}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.unit_value")}</p>
                                  <p className="font-medium text-gray-900 dark:text-gray-100">{fmtMoney(it.unit_price)}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.total_value")}</p>
                                  <p className="font-medium text-emerald-600 dark:text-emerald-400">{fmtMoney(it.total_value)}</p>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {items.length === 0 && (
                        <div className="px-4 py-10 text-center text-gray-400">{t("stock.no_items")}</div>
                      )}
                    </div>
                    <div className="px-4 pb-4">{renderPagination(itemsPage, itemsTotal, itemsPerPage, setItemsPage)}</div>
                  </>
                )}
              </Card>
            )}

            {/* ---------- TRANSFERS ---------- */}
            {activeTab === "transfers" && (
              <Card className="overflow-hidden">
                <div className="p-4 border-b border-gray-100 dark:border-slate-800">
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    <ArrowLeftRight className="h-4 w-4 text-emerald-500" /> {t("stock.transfers_tab")}
                  </h3>
                </div>
                {loading ? skeleton(5) : (
                  <>
                    <div className="hidden lg:block overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-100 dark:border-slate-800 text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                            <th className="px-4 py-3">{t("stock.product")}</th>
                            <th className="px-2 py-1">{t("stock.from")}</th>
                            <th className="px-2 py-1">{t("stock.to")}</th>
                            <th className="px-2 py-1">{t("stock.quantity")}</th>
                            <th className="px-2 py-1">{t("stock.created_at")}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 dark:divide-slate-800/60">
                          {transfers.map((tr) => (
                            <tr key={tr.id} className="hover:bg-gray-50 dark:hover:bg-slate-900/50">
                              <td className="px-4 py-2">
                                <p className="font-medium text-gray-900 dark:text-gray-100">{tr.product_name}</p>
                                <p className="text-[11px] text-gray-500 dark:text-gray-400">{tr.product_code}</p>
                              </td>
                              <td className="px-2 py-1 text-gray-600 dark:text-gray-300">
                                {tr.from_type === "warehouse" ? t("stock.warehouse") : tr.from_employee_name || t("stock.rso")}
                              </td>
                              <td className="px-2 py-1 text-gray-600 dark:text-gray-300">
                                {tr.to_type === "warehouse" ? t("stock.warehouse") : tr.to_employee_name || t("stock.rso")}
                              </td>
                              <td className="px-2 py-1 font-medium">{tr.quantity}</td>
                              <td className="px-2 py-1 text-gray-500 dark:text-gray-400">{fmtDate(tr.created_at)}</td>
                            </tr>
                          ))}
                          {transfers.length === 0 && (
                            <tr>
                              <td colSpan={5} className="px-4 py-10 text-center text-gray-400">{t("stock.no_data")}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <div className="lg:hidden divide-y divide-gray-100 dark:divide-slate-800">
                      {transfers.map((tr) => {
                        const open = expandedId === tr.id;
                        return (
                          <div key={tr.id} className="px-4 py-3">
                            <button className="w-full flex items-center gap-3 text-left" onClick={() => setExpandedId(open ? null : tr.id)}>
                              <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center shrink-0">
                                <ArrowLeftRight className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{tr.product_name}</p>
                                <p className="text-[11px] text-gray-500 dark:text-gray-400">{tr.product_code}</p>
                              </div>
                              <div className="text-right">
                                <p className="font-semibold text-gray-900 dark:text-gray-100">{tr.quantity}</p>
                                <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.quantity")}</p>
                              </div>
                              {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                            </button>
                            {open && (
                              <div className="mt-3 grid grid-cols-2 gap-3 text-sm bg-gray-50 dark:bg-slate-900 rounded-xl p-3">
                                <div>
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.from")}</p>
                                  <p className="font-medium text-gray-900 dark:text-gray-100">
                                    {tr.from_type === "warehouse" ? t("stock.warehouse") : tr.from_employee_name || t("stock.rso")}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.to")}</p>
                                  <p className="font-medium text-gray-900 dark:text-gray-100">
                                    {tr.to_type === "warehouse" ? t("stock.warehouse") : tr.to_employee_name || t("stock.rso")}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.quantity")}</p>
                                  <p className="font-medium text-gray-900 dark:text-gray-100">{tr.quantity}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.created_at")}</p>
                                  <p className="font-medium text-gray-900 dark:text-gray-100">{fmtDate(tr.created_at)}</p>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {transfers.length === 0 && (
                        <div className="px-4 py-10 text-center text-gray-400">{t("stock.no_data")}</div>
                      )}
                    </div>
                    <div className="px-4 pb-4">{renderPagination(transfersPage, transfersTotal, 20, setTransfersPage)}</div>
                  </>
                )}
              </Card>
            )}

            {/* ---------- ADJUSTMENTS ---------- */}
            {activeTab === "adjustments" && (
              <Card className="overflow-hidden">
                <div className="p-4 border-b border-gray-100 dark:border-slate-800">
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    <Wrench className="h-4 w-4 text-emerald-500" /> {t("stock.adjustments_tab")}
                  </h3>
                </div>
                {loading ? skeleton(5) : (
                  <>
                    <div className="hidden lg:block overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-100 dark:border-slate-800 text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                            <th className="px-4 py-3">{t("stock.product")}</th>
                            <th className="px-2 py-1">{t("stock.location")}</th>
                            <th className="px-2 py-1">{t("stock.adjustment_type")}</th>
                            <th className="px-2 py-1">{t("stock.direction")}</th>
                            <th className="px-2 py-1">{t("stock.quantity")}</th>
                            <th className="px-2 py-1">{t("stock.reason")}</th>
                            <th className="px-2 py-1">{t("stock.created_at")}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 dark:divide-slate-800/60">
                          {adjustments.map((a) => (
                            <tr key={a.id} className="hover:bg-gray-50 dark:hover:bg-slate-900/50">
                              <td className="px-4 py-2">
                                <p className="font-medium text-gray-900 dark:text-gray-100">{a.product_name}</p>
                                <p className="text-[11px] text-gray-500 dark:text-gray-400">{a.product_code}</p>
                              </td>
                              <td className="px-2 py-1 text-gray-600 dark:text-gray-300">
                                {a.location_type === "warehouse" ? t("stock.warehouse") : a.employee_name || t("stock.rso")}
                              </td>
                              <td className="px-2 py-1">
                                <span className="rounded-full bg-gray-100 dark:bg-slate-800 px-2 py-0.5 text-xs capitalize text-gray-700 dark:text-gray-300">
                                  {t(`stock.${a.adjustment_type}`)}
                                </span>
                              </td>
                              <td className="px-2 py-1">
                                <span className={cn(
                                  "inline-flex items-center gap-1 text-xs font-medium",
                                  a.direction === "increase" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                                )}>
                                  {a.direction === "increase" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                                  {a.direction === "increase" ? t("stock.increase") : t("stock.decrease")}
                                </span>
                              </td>
                              <td className="px-2 py-1 font-medium">{a.quantity}</td>
                              <td className="px-2 py-1 text-gray-600 dark:text-gray-300 max-w-[200px] truncate">{a.reason}</td>
                              <td className="px-2 py-1 text-gray-500 dark:text-gray-400">{fmtDate(a.created_at)}</td>
                            </tr>
                          ))}
                          {adjustments.length === 0 && (
                            <tr>
                              <td colSpan={7} className="px-4 py-10 text-center text-gray-400">{t("stock.no_data")}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <div className="lg:hidden divide-y divide-gray-100 dark:divide-slate-800">
                      {adjustments.map((a) => {
                        const open = expandedId === a.id;
                        return (
                          <div key={a.id} className="px-4 py-3">
                            <button className="w-full flex items-center gap-3 text-left" onClick={() => setExpandedId(open ? null : a.id)}>
                              <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-900/40 flex items-center justify-center shrink-0">
                                <Wrench className="h-5 w-5 text-rose-600 dark:text-rose-400" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{a.product_name}</p>
                                <p className="text-[11px] text-gray-500 dark:text-gray-400">{a.product_code} · {t(`stock.${a.adjustment_type}`)}</p>
                              </div>
                              <div className="text-right">
                                <p className={cn("font-semibold", a.direction === "increase" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
                                  {a.direction === "increase" ? "+" : "-"}{a.quantity}
                                </p>
                                <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.quantity")}</p>
                              </div>
                              {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                            </button>
                            {open && (
                              <div className="mt-3 grid grid-cols-2 gap-3 text-sm bg-gray-50 dark:bg-slate-900 rounded-xl p-3">
                                <div>
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.location")}</p>
                                  <p className="font-medium text-gray-900 dark:text-gray-100">
                                    {a.location_type === "warehouse" ? t("stock.warehouse") : a.employee_name || t("stock.rso")}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.adjustment_type")}</p>
                                  <p className="font-medium text-gray-900 dark:text-gray-100 capitalize">{t(`stock.${a.adjustment_type}`)}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.direction")}</p>
                                  <p className="font-medium text-gray-900 dark:text-gray-100">
                                    {a.direction === "increase" ? t("stock.increase") : t("stock.decrease")}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.created_at")}</p>
                                  <p className="font-medium text-gray-900 dark:text-gray-100">{fmtDate(a.created_at)}</p>
                                </div>
                                <div className="col-span-2">
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.reason")}</p>
                                  <p className="font-medium text-gray-900 dark:text-gray-100">{a.reason}</p>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {adjustments.length === 0 && (
                        <div className="px-4 py-10 text-center text-gray-400">{t("stock.no_data")}</div>
                      )}
                    </div>
                    <div className="px-4 pb-4">{renderPagination(adjustmentsPage, adjustmentsTotal, 20, setAdjustmentsPage)}</div>
                  </>
                )}
              </Card>
            )}

            {/* ---------- LEDGER ---------- */}
            {activeTab === "ledger" && (
              <Card className="overflow-hidden">
                <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center gap-3">
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    <FileClock className="h-4 w-4 text-emerald-500" /> {t("stock.ledger_tab")}
                  </h3>
                  <select
                    value={ledgerMovement}
                    onChange={(e) => { setLedgerMovement(e.target.value); setLedgerPage(1); }}
                    className={cn(inputCls, "sm:ml-auto sm:w-48")}
                  >
                    <option value="">{t("stock.movement_all")}</option>
                    {["transfer_in", "transfer_out", "sale", "purchase", "adjustment", "return"].map((m) => (
                      <option key={m} value={m}>{movementLabel(m)}</option>
                    ))}
                  </select>
                </div>
                {loading ? skeleton(5) : (
                  <>
                    <div className="hidden lg:block overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-100 dark:border-slate-800 text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                            <th className="px-4 py-3">{t("stock.product")}</th>
                            <th className="px-2 py-1">{t("stock.location")}</th>
                            <th className="px-2 py-1">{t("stock.movement_type")}</th>
                            <th className="px-2 py-1">{t("stock.quantity")}</th>
                            <th className="px-2 py-1">{t("stock.balance_after")}</th>
                            <th className="px-2 py-1">{t("stock.created_at")}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 dark:divide-slate-800/60">
                          {ledger.map((e) => (
                            <tr key={e.id} className="hover:bg-gray-50 dark:hover:bg-slate-900/50">
                              <td className="px-4 py-2">
                                <p className="font-medium text-gray-900 dark:text-gray-100">{e.product_name}</p>
                                <p className="text-[11px] text-gray-500 dark:text-gray-400">{e.product_code}</p>
                              </td>
                              <td className="px-2 py-1 text-gray-600 dark:text-gray-300">
                                {e.location_type === "warehouse" ? t("stock.warehouse") : e.employee_name || t("stock.rso")}
                              </td>
                              <td className="px-2 py-1">
                                <span className="rounded-full bg-gray-100 dark:bg-slate-800 px-2 py-0.5 text-xs text-gray-700 dark:text-gray-300">
                                  {movementLabel(e.movement_type)}
                                </span>
                              </td>
                              <td className={cn("px-2 py-1 font-medium", e.quantity > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
                                {e.quantity > 0 ? `+${e.quantity}` : e.quantity}
                              </td>
                              <td className="px-2 py-1">{e.balance_after}</td>
                              <td className="px-2 py-1 text-gray-500 dark:text-gray-400">{fmtDate(e.created_at)}</td>
                            </tr>
                          ))}
                          {ledger.length === 0 && (
                            <tr>
                              <td colSpan={6} className="px-4 py-10 text-center text-gray-400">{t("stock.no_data")}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <div className="lg:hidden divide-y divide-gray-100 dark:divide-slate-800">
                      {ledger.map((e) => {
                        const open = expandedId === e.id;
                        return (
                          <div key={e.id} className="px-4 py-3">
                            <button className="w-full flex items-center gap-3 text-left" onClick={() => setExpandedId(open ? null : e.id)}>
                              <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center shrink-0">
                                <FileClock className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{e.product_name}</p>
                                <p className="text-[11px] text-gray-500 dark:text-gray-400">{e.product_code} · {movementLabel(e.movement_type)}</p>
                              </div>
                              <div className="text-right">
                                <p className={cn("font-semibold", e.quantity > 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
                                  {e.quantity > 0 ? `+${e.quantity}` : e.quantity}
                                </p>
                                <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.balance_after")}: {e.balance_after}</p>
                              </div>
                              {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                            </button>
                            {open && (
                              <div className="mt-3 grid grid-cols-2 gap-3 text-sm bg-gray-50 dark:bg-slate-900 rounded-xl p-3">
                                <div>
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.location")}</p>
                                  <p className="font-medium text-gray-900 dark:text-gray-100">
                                    {e.location_type === "warehouse" ? t("stock.warehouse") : e.employee_name || t("stock.rso")}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.movement_type")}</p>
                                  <p className="font-medium text-gray-900 dark:text-gray-100">{movementLabel(e.movement_type)}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.balance_after")}</p>
                                  <p className="font-medium text-gray-900 dark:text-gray-100">{e.balance_after}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.created_at")}</p>
                                  <p className="font-medium text-gray-900 dark:text-gray-100">{fmtDate(e.created_at)}</p>
                                </div>
                                {e.reason && (
                                  <div className="col-span-2">
                                    <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.reason")}</p>
                                    <p className="font-medium text-gray-900 dark:text-gray-100">{e.reason}</p>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {ledger.length === 0 && (
                        <div className="px-4 py-10 text-center text-gray-400">{t("stock.no_data")}</div>
                      )}
                    </div>
                    <div className="px-4 pb-4">{renderPagination(ledgerPage, ledgerTotal, 20, setLedgerPage)}</div>
                  </>
                )}
              </Card>
            )}

            {/* ---------- SNAPSHOTS ---------- */}
            {activeTab === "snapshots" && (
              <Card className="overflow-hidden">
                <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center gap-3">
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    <CalendarCheck className="h-4 w-4 text-emerald-500" /> {t("stock.snapshots_tab")}
                  </h3>
                  <Button size="sm" variant="outline" className="sm:ml-auto" onClick={generateSnapshot} disabled={actionLoading || !mutationHouseId}>
                    {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarCheck className="h-4 w-4" />}
                    {t("stock.generate_snapshot")}
                  </Button>
                </div>
                {loading ? skeleton(5) : (
                  <>
                    <div className="hidden lg:block overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-100 dark:border-slate-800 text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                            <th className="px-4 py-3">{t("stock.product")}</th>
                            <th className="px-2 py-1">{t("stock.location")}</th>
                            <th className="px-2 py-1">{t("stock.snapshot_date")}</th>
                            <th className="px-2 py-1">{t("stock.quantity")}</th>
                            <th className="px-2 py-1 text-right">{t("stock.total_value")}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 dark:divide-slate-800/60">
                          {snapshots.map((s) => (
                            <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-slate-900/50">
                              <td className="px-4 py-2">
                                <p className="font-medium text-gray-900 dark:text-gray-100">{s.product_name}</p>
                                <p className="text-[11px] text-gray-500 dark:text-gray-400">{s.product_code}</p>
                              </td>
                              <td className="px-2 py-1 text-gray-600 dark:text-gray-300">
                                {s.location_type === "warehouse" ? t("stock.warehouse") : s.employee_name || t("stock.rso")}
                              </td>
                              <td className="px-2 py-1">{s.snapshot_date}</td>
                              <td className="px-2 py-1 font-medium">{s.quantity}</td>
                              <td className="px-2 py-1 text-right font-medium">{fmtMoney(s.total_value)}</td>
                            </tr>
                          ))}
                          {snapshots.length === 0 && (
                            <tr>
                              <td colSpan={5} className="px-4 py-10 text-center text-gray-400">{t("stock.no_data")}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <div className="lg:hidden divide-y divide-gray-100 dark:divide-slate-800">
                      {snapshots.map((s) => {
                        const open = expandedId === s.id;
                        return (
                          <div key={s.id} className="px-4 py-3">
                            <button className="w-full flex items-center gap-3 text-left" onClick={() => setExpandedId(open ? null : s.id)}>
                              <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center shrink-0">
                                <CalendarCheck className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{s.product_name}</p>
                                <p className="text-[11px] text-gray-500 dark:text-gray-400">{s.product_code} · {s.snapshot_date}</p>
                              </div>
                              <div className="text-right">
                                <p className="font-semibold text-gray-900 dark:text-gray-100">{s.quantity}</p>
                                <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.quantity")}</p>
                              </div>
                              {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                            </button>
                            {open && (
                              <div className="mt-3 grid grid-cols-2 gap-3 text-sm bg-gray-50 dark:bg-slate-900 rounded-xl p-3">
                                <div>
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.location")}</p>
                                  <p className="font-medium text-gray-900 dark:text-gray-100">
                                    {s.location_type === "warehouse" ? t("stock.warehouse") : s.employee_name || t("stock.rso")}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.snapshot_date")}</p>
                                  <p className="font-medium text-gray-900 dark:text-gray-100">{s.snapshot_date}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.unit_value")}</p>
                                  <p className="font-medium text-gray-900 dark:text-gray-100">{fmtMoney(s.unit_value)}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.total_value")}</p>
                                  <p className="font-medium text-emerald-600 dark:text-emerald-400">{fmtMoney(s.total_value)}</p>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {snapshots.length === 0 && (
                        <div className="px-4 py-10 text-center text-gray-400">{t("stock.no_data")}</div>
                      )}
                    </div>
                    <div className="px-4 pb-4">{renderPagination(snapshotsPage, snapshotsTotal, 20, setSnapshotsPage)}</div>
                  </>
                )}
              </Card>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ---------- MODALS ---------- */}
      <AnimatePresence>
        {modal === "stock" && (
          <ModalShell title={t("stock.add_stock")} onClose={() => setModal(null)}>
            <div className="space-y-4">
              {!selectedHouse && accessibleHouses.length > 0 && (
                <div>
                  <label className={labelCls}>{t("common.select_house")}</label>
                  <select value={modalHouse} onChange={(e) => setModalHouse(e.target.value)} className={inputCls}>
                    <option value="">{t("common.select_house")}</option>
                    {accessibleHouses.map((h) => (
                      <option key={h.id} value={h.id}>{h.name} ({h.code})</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <ScopeBadge house={effectiveHouse} t={t} />
              </div>
              <div>
                <label className={labelCls}>{t("stock.product")}</label>
                <select value={stockForm.product_id} onChange={(e) => setStockForm({ ...stockForm, product_id: e.target.value })} className={inputCls}>
                  <option value="">{t("stock.select_product")}</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.product_name} ({p.product_code})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>{t("stock.location")}</label>
                <select value={stockForm.location_type} onChange={(e) => setStockForm({ ...stockForm, location_type: e.target.value, employee_id: "" })} className={inputCls}>
                  <option value="warehouse">{t("stock.warehouse")}</option>
                  <option value="rso">{t("stock.rso")}</option>
                </select>
              </div>
              {stockForm.location_type === "rso" && (
                <div>
                  <label className={labelCls}>{t("stock.employee")}</label>
                  <select value={stockForm.employee_id} onChange={(e) => setStockForm({ ...stockForm, employee_id: e.target.value })} className={inputCls}>
                    <option value="">{t("stock.select_employee")}</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>{e.name} {e.employee_id ? `(${e.employee_id})` : ""}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className={labelCls}>{t("stock.quantity")}</label>
                <input type="number" min={1} value={stockForm.quantity} onChange={(e) => setStockForm({ ...stockForm, quantity: e.target.value })} className={inputCls} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setModal(null)}>{t("stock.cancel")}</Button>
                <Button onClick={submitStock} disabled={actionLoading}>
                  {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {t("stock.submit")}
                </Button>
              </div>
            </div>
          </ModalShell>
        )}

        {modal === "transfer" && (
          <ModalShell title={t("stock.new_transfer")} onClose={() => setModal(null)}>
            <div className="space-y-4">
              {!selectedHouse && accessibleHouses.length > 0 && (
                <div>
                  <label className={labelCls}>{t("common.select_house")}</label>
                  <select value={modalHouse} onChange={(e) => setModalHouse(e.target.value)} className={inputCls}>
                    <option value="">{t("common.select_house")}</option>
                    {accessibleHouses.map((h) => (
                      <option key={h.id} value={h.id}>{h.name} ({h.code})</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <ScopeBadge house={effectiveHouse} t={t} />
              </div>
              <div>
                <label className={labelCls}>{t("stock.product")}</label>
                <ProductSelect
                  products={products}
                  value={transferForm.product_id}
                  sourceType={transferForm.from_type as "warehouse" | "rso"}
                  onChange={(v) => setTransferForm({ ...transferForm, product_id: v })}
                />
                {selectedTransferProduct && (
                  <div className="mt-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50 p-3">
                    <div className="flex items-center justify-between mb-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-500/10 shrink-0">
                          <Boxes className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{selectedTransferProduct.product_name}</p>
                      </div>
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 shrink-0">{selectedTransferProduct.product_code}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <StockStat label={t("stock.warehouse")} value={selectedTransferProduct.warehouse_quantity ?? 0} active={transferForm.from_type !== "rso"} />
                      <StockStat label={t("stock.rso")} value={selectedTransferProduct.rso_quantity ?? 0} active={transferForm.from_type === "rso"} />
                      <StockStat label={t("stock.total_qty")} value={selectedTransferProduct.total_quantity ?? 0} />
                    </div>
                    <div className="mt-2.5 flex items-center justify-between pt-2.5 border-t border-gray-200 dark:border-slate-700">
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t("stock.available")} ({t(transferForm.from_type === "rso" ? "stock.rso" : "stock.warehouse")})
                      </p>
                      <span className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums",
                        transferSourceStock > 0
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
                          : "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400"
                      )}>
                        {transferSourceStock > 0 ? (
                          <>
                            <Package className="h-3.5 w-3.5" /> {transferSourceStock.toLocaleString("en-US")}
                          </>
                        ) : (
                          t("stock.out_of_stock")
                        )}
                      </span>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:gap-3">
                <div>
                  <label className={labelCls}>{t("stock.from")}</label>
                  <LocationToggle
                    value={transferForm.from_type as "warehouse" | "rso"}
                    onChange={(v) => setTransferForm({ ...transferForm, from_type: v, from_employee_id: "" })}
                    t={t}
                  />
                </div>
                <button
                  type="button"
                  onClick={swapTransfer}
                  title={t("stock.swap")}
                  className="mx-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-400 shadow-sm transition-colors hover:border-emerald-300 dark:hover:border-emerald-500/50 hover:text-emerald-600 dark:hover:text-emerald-400 sm:mx-0"
                >
                  <ArrowLeftRight className="h-4 w-4 rotate-90 sm:rotate-0" />
                </button>
                <div>
                  <label className={labelCls}>{t("stock.to")}</label>
                  <LocationToggle
                    value={transferForm.to_type as "warehouse" | "rso"}
                    onChange={(v) => setTransferForm({ ...transferForm, to_type: v, to_employee_id: "" })}
                    t={t}
                  />
                </div>
              </div>
              {transferForm.from_type === "rso" && (
                <div>
                  <label className={labelCls}>{t("stock.source")} ({t("stock.employee")})</label>
                  <EmployeeSelect
                    employees={employees}
                    value={transferForm.from_employee_id}
                    showStock={!!transferForm.product_id}
                    onChange={(v) => setTransferForm({ ...transferForm, from_employee_id: v })}
                  />
                </div>
              )}
              {transferForm.to_type === "rso" && (
                <div>
                  <label className={labelCls}>{t("stock.destination")} ({t("stock.employee")})</label>
                  <EmployeeSelect
                    employees={employees}
                    value={transferForm.to_employee_id}
                    showStock={!!transferForm.product_id}
                    onChange={(v) => setTransferForm({ ...transferForm, to_employee_id: v })}
                  />
                </div>
              )}
              <div>
                <label className={labelCls}>{t("stock.quantity")}</label>
                <input
                  type="number"
                  min={1}
                  max={transferSourceStock || undefined}
                  value={transferForm.quantity}
                  onChange={(e) => setTransferForm({ ...transferForm, quantity: e.target.value })}
                  className={inputCls}
                />
                {selectedTransferProduct && (() => {
                  const qty = Number(transferForm.quantity);
                  const over = transferForm.quantity !== "" && qty > transferSourceStock;
                  return (
                    <p className={cn(
                      "mt-1.5 flex items-center gap-1.5 text-xs font-medium",
                      over ? "text-red-500" : "text-gray-500 dark:text-gray-400"
                    )}>
                      {over && <AlertCircle className="h-3.5 w-3.5 shrink-0" />}
                      {over
                        ? t("stock.quantity_exceeds")
                        : `${t("stock.max_available")}: ${transferSourceStock.toLocaleString("en-US")}`}
                    </p>
                  );
                })()}
              </div>
              <div>
                <label className={labelCls}>{t("stock.notes")}</label>
                <input type="text" value={transferForm.notes} onChange={(e) => setTransferForm({ ...transferForm, notes: e.target.value })} className={inputCls} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setModal(null)}>{t("stock.cancel")}</Button>
                <Button onClick={submitTransfer} disabled={actionLoading}>
                  {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {t("stock.submit")}
                </Button>
              </div>
            </div>
          </ModalShell>
        )}

        {modal === "adjustment" && (
          <ModalShell title={t("stock.new_adjustment")} onClose={() => setModal(null)}>
            <div className="space-y-4">
              {!selectedHouse && accessibleHouses.length > 0 && (
                <div>
                  <label className={labelCls}>{t("common.select_house")}</label>
                  <select value={modalHouse} onChange={(e) => setModalHouse(e.target.value)} className={inputCls}>
                    <option value="">{t("common.select_house")}</option>
                    {accessibleHouses.map((h) => (
                      <option key={h.id} value={h.id}>{h.name} ({h.code})</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <ScopeBadge house={effectiveHouse} t={t} />
              </div>
              <div>
                <label className={labelCls}>{t("stock.product")}</label>
                <select value={adjustForm.product_id} onChange={(e) => setAdjustForm({ ...adjustForm, product_id: e.target.value })} className={inputCls}>
                  <option value="">{t("stock.select_product")}</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.product_name} ({p.product_code})</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{t("stock.location")}</label>
                  <select value={adjustForm.location_type} onChange={(e) => setAdjustForm({ ...adjustForm, location_type: e.target.value, employee_id: "" })} className={inputCls}>
                    <option value="warehouse">{t("stock.warehouse")}</option>
                    <option value="rso">{t("stock.rso")}</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>{t("stock.adjustment_type")}</label>
                  <select value={adjustForm.adjustment_type} onChange={(e) => setAdjustForm({ ...adjustForm, adjustment_type: e.target.value })} className={inputCls}>
                    <option value="loss">{t("stock.loss")}</option>
                    <option value="damage">{t("stock.damage")}</option>
                    <option value="correction">{t("stock.correction")}</option>
                  </select>
                </div>
              </div>
              {adjustForm.location_type === "rso" && (
                <div>
                  <label className={labelCls}>{t("stock.employee")}</label>
                  <select value={adjustForm.employee_id} onChange={(e) => setAdjustForm({ ...adjustForm, employee_id: e.target.value })} className={inputCls}>
                    <option value="">{t("stock.select_employee")}</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>{e.name} {e.employee_id ? `(${e.employee_id})` : ""}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{t("stock.direction")}</label>
                  <select value={adjustForm.direction} onChange={(e) => setAdjustForm({ ...adjustForm, direction: e.target.value })} className={inputCls}>
                    <option value="decrease">{t("stock.decrease")}</option>
                    <option value="increase">{t("stock.increase")}</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>{t("stock.quantity")}</label>
                  <input type="number" min={1} value={adjustForm.quantity} onChange={(e) => setAdjustForm({ ...adjustForm, quantity: e.target.value })} className={inputCls} />
                </div>
              </div>
              <div>
                <label className={labelCls}>{t("stock.reason")} *</label>
                <input type="text" value={adjustForm.reason} onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })} className={inputCls} placeholder="e.g. Damaged during delivery" />
              </div>
              <div>
                <label className={labelCls}>{t("stock.notes")}</label>
                <input type="text" value={adjustForm.notes} onChange={(e) => setAdjustForm({ ...adjustForm, notes: e.target.value })} className={inputCls} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setModal(null)}>{t("stock.cancel")}</Button>
                <Button onClick={submitAdjustment} disabled={actionLoading}>
                  {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {t("stock.submit")}
                </Button>
              </div>
            </div>
          </ModalShell>
        )}

        {housePrompt && (
          <ModalShell title={t("stock.select_house_first")} onClose={() => setHousePrompt(false)}>
            <p className="text-sm text-gray-600 dark:text-gray-300">{t("stock.select_house_first")}</p>
            <div className="flex justify-end pt-4">
              <Button variant="outline" onClick={() => setHousePrompt(false)}>{t("common.ok") ?? "OK"}</Button>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>
    </div>
  );
}
