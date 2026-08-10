"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
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
  Building2,
  Calendar,
  PackagePlus,
  Wallet,
  Send,
  CheckSquare,
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

interface AvailableLifting {
  id: number;
  lifting_date: string;
  itopup_amount: number;
  total_lifting_amount: number;
  product_count: number;
  total_quantity: number;
  products: { product_id: number; product_code: string; product_name: string; quantity: number; total_price: number }[];
}

interface ITopUpBalanceRow {
  id?: number;
  house_id: number;
  house_name?: string;
  employee_id?: number;
  employee_code?: string;
  name?: string;
  dms_code?: string;
  balance: number;
}

interface ITopUpLedgerEntry {
  id: number;
  house_id: number;
  employee_id?: number;
  employee_name?: string;
  movement_type: string;
  amount: number;
  balance_after: number;
  reference_type?: string;
  reference_id?: number;
  reason?: string;
  created_at?: string;
  created_by_name?: string;
}

interface ITopUpTransferRow {
  id: number;
  house_id: number;
  from_employee_id?: number;
  from_employee_name?: string;
  to_employee_id?: number;
  to_employee_name?: string;
  amount: number;
  movement: string;
  notes?: string;
  created_at?: string;
  created_by_name?: string;
}

interface EmployeeStockItem {
  product_id: number;
  product_code: string;
  product_name: string;
  category?: string;
  quantity: number;
  unit_price: number;
  total_value: number;
}

interface EmployeeStockRow {
  id: number;
  employee_id: string;
  name: string;
  dms_code?: string;
  itop_number?: string;
  employee_type: string;
  total_quantity: number;
  total_value: number;
  product_count: number;
  items: EmployeeStockItem[];
}

const TABS = [
  { key: "summary", labelKey: "stock.summary_tab" },
  { key: "items", labelKey: "stock.items_tab" },
  { key: "employee-stock", labelKey: "stock.employee_stock_tab" },
  { key: "transfers", labelKey: "stock.transfers_tab" },
  { key: "adjustments", labelKey: "stock.adjustments_tab" },
  { key: "ledger", labelKey: "stock.ledger_tab" },
  { key: "snapshots", labelKey: "stock.snapshots_tab" },
  { key: "itopup", labelKey: "stock.itopup_tab" },
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

function ModalShell({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          "w-full max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white dark:bg-slate-900 p-5 sm:p-6",
          wide ? "sm:max-w-xl" : "sm:max-w-lg"
        )}
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
              Array.from(
                filtered.reduce((acc, p) => {
                  const cat = p.category || t("stock.uncategorized");
                  const arr = acc.get(cat) ?? [];
                  arr.push(p);
                  acc.set(cat, arr);
                  return acc;
                }, new Map<string, Product[]>())
              )
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([cat, items]) => (
                  <div key={cat}>
                    <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                      {cat} <span className="text-gray-300 dark:text-gray-600">({items.length})</span>
                    </p>
                    {items.map((p) => {
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
                    })}
                  </div>
                ))
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
  rsoLabel,
}: {
  value: "warehouse" | "rso";
  onChange: (v: "warehouse" | "rso") => void;
  t: (path: string, params?: Record<string, string | number | undefined>) => string;
  rsoLabel?: string;
}) {
  const options = [
    { value: "warehouse" as const, label: t("stock.warehouse"), icon: Warehouse },
    { value: "rso" as const, label: rsoLabel || t("stock.rso"), icon: Users },
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
  const [ledgerFromDate, setLedgerFromDate] = useState("");
  const [ledgerToDate, setLedgerToDate] = useState("");

  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [snapshotsPage, setSnapshotsPage] = useState(1);
  const [snapshotsTotal, setSnapshotsTotal] = useState(0);

  const [empStock, setEmpStock] = useState<EmployeeStockRow[]>([]);
  const [empStockPage, setEmpStockPage] = useState(1);
  const [empStockTotal, setEmpStockTotal] = useState(0);
  const [empStockLoading, setEmpStockLoading] = useState(false);
  const [empStockSearch, setEmpStockSearch] = useState("");
  const [expandedEmpId, setExpandedEmpId] = useState<number | null>(null);

  const [search, setSearch] = useState("");
  const [stockFilter, setStockFilter] = useState<"in" | "out">("in");
  const [products, setProducts] = useState<Product[]>([]);
  const [employees, setEmployees] = useState<EmployeeOpt[]>([]);

  const [accessibleHouses, setAccessibleHouses] = useState<{ id: number; name: string; code: string }[]>([]);
  const [modalHouse, setModalHouse] = useState<string>("");
  const [pageHouseId, setPageHouseId] = useState<number | undefined>(undefined);
  const productReqRef = useRef(0);
  const employeeReqRef = useRef(0);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [housePrompt, setHousePrompt] = useState(false);

  const [modal, setModal] = useState<"stock" | "transfer" | "adjustment" | "fromlifting" | "itopup" | null>(null);

  const [liftings, setLiftings] = useState<AvailableLifting[]>([]);
  const [liftingsLoading, setLiftingsLoading] = useState(false);
  const [liftingCount, setLiftingCount] = useState(0);
  const [selectedLiftingIds, setSelectedLiftingIds] = useState<number[]>([]);

  const [itopupMother, setItopupMother] = useState<ITopUpBalanceRow[]>([]);
  const [itopupRso, setItopupRso] = useState<ITopUpBalanceRow[]>([]);
  const [itopupLedger, setItopupLedger] = useState<ITopUpLedgerEntry[]>([]);
  const [itopupTransfers, setItopupTransfers] = useState<ITopUpTransferRow[]>([]);
  const [itopupLoading, setItopupLoading] = useState(false);
  const [itopupForm, setItopupForm] = useState({ from_employee_id: "", to_employee_id: "", amount: "", movement: "morning", notes: "" });

  const [stockForm, setStockForm] = useState({ location_type: "warehouse", employee_id: "" });
  const [stockLines, setStockLines] = useState<{ product_id: string; quantity: string }[]>([{ product_id: "", quantity: "" }]);
  const [transferForm, setTransferForm] = useState({ from_type: "warehouse", from_employee_id: "", to_type: "rso", to_employee_id: "", notes: "" });
  const [transferLines, setTransferLines] = useState<{ product_id: string; quantity: string }[]>([{ product_id: "", quantity: "" }]);
  const [transferProducts, setTransferProducts] = useState<Product[]>([]);
  const transferProductReqRef = useRef(0);
  const [adjustForm, setAdjustForm] = useState({ product_id: "", location_type: "warehouse", employee_id: "", adjustment_type: "loss", direction: "decrease", quantity: "", reason: "", notes: "" });

  const houseId = pageHouseId ?? selectedHouse?.id;

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
      const res = await apiClient.get("stock/employees", { headers: mutationHeaders });
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
      if (ledgerFromDate) params.from_date = ledgerFromDate;
      if (ledgerToDate) params.to_date = ledgerToDate;
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

  const fetchEmployeeStock = async () => {
    setEmpStockLoading(true);
    try {
      const params: Record<string, string> = { page: String(empStockPage), per_page: "20" };
      if (empStockSearch.trim()) params.search = empStockSearch.trim();
      const res = await apiClient.get("stock/employee-stock", { params, headers });
      setEmpStock(res.data.data || []);
      setEmpStockTotal(res.data.pagination?.total || 0);
    } catch {
      toast.error(t("common.error"));
    } finally {
      setEmpStockLoading(false);
    }
  };

  const fetchLiftings = async () => {
    setLiftingsLoading(true);
    try {
      const res = await apiClient.get("stock/available-liftings", { headers: mutationHeaders });
      setLiftings(res.data.data || []);
    } catch {
      toast.error(t("common.error"));
    } finally {
      setLiftingsLoading(false);
    }
  };

  const fetchLiftingCount = async () => {
    try {
      const res = await apiClient.get("stock/available-liftings", { headers });
      setLiftingCount((res.data.data || []).length);
    } catch {
      setLiftingCount(0);
    }
  };

  const fetchITopUp = async () => {
    setItopupLoading(true);
    try {
      const res = await apiClient.get("itopup-balance", { headers });
      setItopupMother(res.data.data?.mother || []);
      setItopupRso(res.data.data?.rso || []);
    } catch {
      toast.error(t("common.error"));
    } finally {
      setItopupLoading(false);
    }
  };

  const fetchITopUpLedger = async () => {
    try {
      const res = await apiClient.get("itopup-balance/ledger", { params: { page: "1", per_page: "15" }, headers });
      setItopupLedger(res.data.data || []);
    } catch {
      // non-blocking
    }
  };

  const fetchITopUpTransfers = async () => {
    try {
      const res = await apiClient.get("itopup-balance/transfers", { params: { page: "1", per_page: "15" }, headers });
      setItopupTransfers(res.data.data || []);
    } catch {
      // non-blocking
    }
  };

  const toggleLifting = (id: number) =>
    setSelectedLiftingIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  const submitFromLifting = async () => {
    if (!mutationHouseId) {
      toast.error(t("stock.select_house_first"));
      return;
    }
    if (selectedLiftingIds.length === 0) {
      toast.error(t("stock.no_lifting_selected"));
      return;
    }
    setActionLoading(true);
    try {
      await apiClient.post("stock/from-lifting", { lifting_ids: selectedLiftingIds }, { headers: mutationHeaders });
      toast.success(t("stock.from_lifting_success"));
      setModal(null);
      setSelectedLiftingIds([]);
      fetchSummary();
      if (activeTab === "items") fetchItems();
      fetchITopUp();
      fetchLiftingCount();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || t("common.error"));
    } finally {
      setActionLoading(false);
    }
  };

  const submitITopUpTransfer = async () => {
    if (!mutationHouseId) {
      toast.error(t("stock.select_house_first"));
      return;
    }
    const from = itopupForm.from_employee_id ? Number(itopupForm.from_employee_id) : null;
    const to = itopupForm.to_employee_id ? Number(itopupForm.to_employee_id) : null;
    if (from === null && to === null) {
      toast.error(t("stock.select_employee"));
      return;
    }
    const amount = Number(itopupForm.amount);
    if (!amount || amount <= 0) {
      toast.error(t("stock.quantity_required"));
      return;
    }
    setActionLoading(true);
    try {
      await apiClient.post(
        "itopup-balance/transfers",
        { from_employee_id: from, to_employee_id: to, amount, movement: itopupForm.movement, notes: itopupForm.notes || undefined },
        { headers: mutationHeaders }
      );
      toast.success(t("stock.itopup_transfer_success"));
      setModal(null);
      setItopupForm({ from_employee_id: "", to_employee_id: "", amount: "", movement: "morning", notes: "" });
      fetchITopUp();
      fetchITopUpLedger();
      fetchITopUpTransfers();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || t("common.error"));
    } finally {
      setActionLoading(false);
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
    if (authLoading || !hasPermission("stock.view")) return;
    if (!houseId) {
      setLiftingCount(0);
      return;
    }
    fetchLiftingCount();
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
  }, [activeTab, ledgerPage, ledgerMovement, ledgerFromDate, ledgerToDate, authLoading, hasPermission, houseId]);

  useEffect(() => {
    if (!authLoading && hasPermission("stock.view") && activeTab === "snapshots") fetchSnapshots();
  }, [activeTab, snapshotsPage, authLoading, hasPermission, houseId]);

  useEffect(() => {
    if (!authLoading && hasPermission("stock.view") && activeTab === "employee-stock") fetchEmployeeStock();
  }, [activeTab, empStockPage, empStockSearch, authLoading, hasPermission, houseId]);

  useEffect(() => {
    if (modal !== "fromlifting") return;
    if (!mutationHouseId) return;
    setSelectedLiftingIds([]);
    fetchLiftings();
  }, [modal, mutationHouseId, modalHouse]);

  useEffect(() => {
    if (!authLoading && hasPermission("itopup_balance.view") && activeTab === "itopup") {
      fetchITopUp();
      fetchITopUpLedger();
      fetchITopUpTransfers();
    }
  }, [activeTab, authLoading, hasPermission, houseId]);

  useEffect(() => {
    if (modal !== "transfer") return;
    if (!mutationHouseId) return;
    if (transferForm.from_type !== "rso" && transferForm.to_type !== "rso") return;
    fetchEmployees();
  }, [modal, transferForm.from_type, transferForm.to_type, mutationHouseId]);

  useEffect(() => {
    if (modal !== "transfer") return;
    if (!mutationHouseId) return;
    if (!(transferForm.from_type === "rso" && transferForm.from_employee_id)) return;
    const reqId = ++transferProductReqRef.current;
    const h: Record<string, string> = { "X-House-ID": String(mutationHouseId) };
    apiClient.get("stock/products", { params: { employee_id: transferForm.from_employee_id }, headers: h })
      .then((res) => {
        if (reqId === transferProductReqRef.current) setTransferProducts(res.data.data || []);
      })
      .catch(() => {});
  }, [modal, mutationHouseId, transferForm.from_type, transferForm.from_employee_id]);

  const filteredSummary = useMemo(() => {
    if (!search) return summary;
    const q = search.toLowerCase();
    return summary.filter(r =>
      r.product_name.toLowerCase().includes(q) || r.product_code.toLowerCase().includes(q)
    );
  }, [summary, search]);

  const groupedSummary = useMemo(() => {
    const visible = stockFilter === "in"
      ? filteredSummary.filter((r) => r.total_quantity > 0)
      : filteredSummary.filter((r) => r.total_quantity === 0);
    const groups = new Map<string, SummaryRow[]>();
    for (const r of visible) {
      const cat = r.category || t("stock.uncategorized");
      const arr = groups.get(cat) ?? [];
      arr.push(r);
      groups.set(cat, arr);
    }
    return Array.from(groups.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([category, rows]) => ({ category, rows }));
  }, [filteredSummary, stockFilter, t]);

  const swapTransfer = () => {
    setTransferForm((prev) => ({
      ...prev,
      from_type: prev.to_type,
      to_type: prev.from_type,
      from_employee_id: prev.to_employee_id,
      to_employee_id: prev.from_employee_id,
    }));
  };

  const addTransferLine = () => setTransferLines((prev) => [...prev, { product_id: "", quantity: "" }]);

  const updateTransferLine = (idx: number, field: "product_id" | "quantity", value: string) =>
    setTransferLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));

  const removeTransferLine = (idx: number) =>
    setTransferLines((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));

  const transferLineAvailable = (i: number) => {
    const line = transferLines[i];
    if (!line || !line.product_id) return 0;
    const source =
      transferForm.from_type === "rso" && transferForm.from_employee_id ? transferProducts : products;
    const p = source.find((x) => String(x.id) === line.product_id);
    if (!p) return 0;
    return transferForm.from_type === "rso"
      ? (p.rso_quantity ?? 0)
      : (p.warehouse_quantity ?? 0);
  };

  const transferSelectableProducts = useMemo(() => {
    const isRsoSource = transferForm.from_type === "rso" && transferForm.from_employee_id;
    const source = isRsoSource ? transferProducts : products;
    return source.filter((p) =>
      isRsoSource
        ? (p.rso_quantity ?? 0) > 0
        : (p.warehouse_quantity ?? 0) > 0
    );
  }, [products, transferProducts, transferForm.from_type, transferForm.from_employee_id]);

  const openModal = (m: "stock" | "transfer" | "adjustment" | "fromlifting" | "itopup") => {
    if (!selectedHouse && accessibleHouses.length === 0) {
      setHousePrompt(true);
      return;
    }
    if (!selectedHouse && accessibleHouses.length === 1) {
      setModalHouse(String(accessibleHouses[0].id));
    }
    if (!selectedHouse && pageHouseId) {
      setModalHouse(String(pageHouseId));
    }
    setModal(m);
    if (m === "fromlifting") {
      setSelectedLiftingIds([]);
    }
    if (m === "itopup") {
      fetchITopUp();
    }
  };

  const addStockLine = () => setStockLines((prev) => [...prev, { product_id: "", quantity: "" }]);

  const updateStockLine = (idx: number, field: "product_id" | "quantity", value: string) =>
    setStockLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));

  const removeStockLine = (idx: number) =>
    setStockLines((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));

  const submitStock = async () => {
    if (!mutationHouseId) {
      toast.error(t("stock.select_house_first"));
      return;
    }
    if (stockForm.location_type === "rso" && !stockForm.employee_id) {
      toast.error(t("stock.select_employee"));
      return;
    }
    const items = stockLines
      .map((l) => ({
        product_id: Number(l.product_id),
        location_type: stockForm.location_type,
        employee_id: stockForm.location_type === "rso" ? Number(stockForm.employee_id) : undefined,
        quantity: Number(l.quantity),
      }))
      .filter((i) => i.product_id);
    if (items.length === 0) {
      toast.error(t("stock.select_product"));
      return;
    }
    if (items.some((i) => !i.quantity || i.quantity <= 0)) {
      toast.error(t("stock.quantity_required"));
      return;
    }
    setActionLoading(true);
    try {
      await apiClient.post("stock/items/bulk", { items }, { headers: mutationHeaders });
      toast.success(t("stock.stock_added"));
      setModal(null);
      setStockLines([{ product_id: "", quantity: "" }]);
      setStockForm({ location_type: "warehouse", employee_id: "" });
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
    if (transferForm.from_type === "rso" && !transferForm.from_employee_id) {
      toast.error(t("stock.select_employee"));
      return;
    }
    if (transferForm.to_type === "rso" && !transferForm.to_employee_id) {
      toast.error(t("stock.select_employee"));
      return;
    }
    const items = transferLines
      .map((l) => ({ product_id: Number(l.product_id), quantity: Number(l.quantity) }))
      .filter((i) => i.product_id);
    if (items.length === 0) {
      toast.error(t("stock.select_product"));
      return;
    }
    const invalidLine = transferLines.findIndex((l, i) => {
      const pid = Number(l.product_id);
      if (!pid) return false;
      const qty = Number(l.quantity);
      if (!qty || qty <= 0) return true;
      return qty > transferLineAvailable(i);
    });
    if (invalidLine !== -1) {
      const qty = Number(transferLines[invalidLine].quantity);
      if (!qty || qty <= 0) {
        toast.error(t("stock.quantity_required"));
      } else {
        toast.error(t("stock.quantity_exceeds"));
      }
      return;
    }
    setActionLoading(true);
    try {
      await apiClient.post("stock/transfers/bulk", {
        from_type: transferForm.from_type,
        from_employee_id: transferForm.from_type === "rso" ? Number(transferForm.from_employee_id) : undefined,
        to_type: transferForm.to_type,
        to_employee_id: transferForm.to_type === "rso" ? Number(transferForm.to_employee_id) : undefined,
        notes: transferForm.notes || undefined,
        items,
      }, { headers: mutationHeaders });
      toast.success(t("stock.transfer_success"));
      setModal(null);
      setTransferForm({ from_type: "warehouse", from_employee_id: "", to_type: "rso", to_employee_id: "", notes: "" });
      setTransferLines([{ product_id: "", quantity: "" }]);
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
    if (adjustForm.direction === "decrease" && selectedAdjustProduct && quantity > adjustSourceStock) {
      toast.error(t("stock.quantity_exceeds"));
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

  const selectedAdjustProduct = adjustForm.product_id
    ? products.find((p) => String(p.id) === adjustForm.product_id)
    : undefined;
  const adjustSourceStock =
    adjustForm.location_type === "rso"
      ? (selectedAdjustProduct?.rso_quantity ?? 0)
      : (selectedAdjustProduct?.warehouse_quantity ?? 0);

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
        <div className="flex flex-col gap-3 mb-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 shrink-0">
              <Warehouse className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl lg:text-2xl font-bold text-gray-900 dark:text-gray-100 leading-tight truncate">
                {t("stock.title")}
              </h1>
              <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 truncate">{t("stock.description")}</p>
            </div>
          </div>
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-end lg:gap-3">
            {accessibleHouses.length > 1 && (
              <div className="relative w-full lg:w-auto">
                <Building2 className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <select
                  value={pageHouseId ? String(pageHouseId) : ""}
                  onChange={(e) => setPageHouseId(e.target.value ? Number(e.target.value) : undefined)}
                  className="appearance-none pl-9 pr-8 h-9 w-full lg:w-auto lg:min-w-[200px] rounded-lg text-sm font-medium bg-white dark:bg-slate-900 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <option value="">{t("stock.all_houses")}</option>
                  {accessibleHouses.map((h) => (
                    <option key={h.id} value={h.id}>{h.name} ({h.code})</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              </div>
            )}
            {accessibleHouses.length > 1 && (
              <div className="hidden lg:block h-6 w-px bg-gray-200 dark:bg-slate-700 shrink-0" aria-hidden="true" />
            )}
            <div className="grid grid-cols-2 gap-2 lg:flex lg:flex-wrap lg:items-center lg:gap-2">
              {hasPermission("stock.create") && (
                <Button size="sm" onClick={() => openModal("stock")} className="w-full lg:w-auto">
                  <Plus className="h-4 w-4" /> {t("stock.add_stock")}
                </Button>
              )}
              {hasPermission("stock.create") && (
                <Button size="sm" variant="outline" onClick={() => openModal("fromlifting")} className="relative w-full lg:w-auto">
                  <PackagePlus className="h-4 w-4" /> {t("stock.from_lifting")}
                  {liftingCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[11px] font-semibold flex items-center justify-center leading-none">
                      {liftingCount}
                    </span>
                  )}
                </Button>
              )}
              {hasPermission("stock.transfer") && (
                <Button size="sm" variant="outline" onClick={() => openModal("transfer")} className="w-full lg:w-auto">
                  <ArrowLeftRight className="h-4 w-4" /> {t("stock.new_transfer")}
                </Button>
              )}
              {hasPermission("stock.adjust") && (
                <Button size="sm" variant="outline" onClick={() => openModal("adjustment")} className="w-full lg:w-auto">
                  <Wrench className="h-4 w-4" /> {t("stock.new_adjustment")}
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
          {TABS.filter((tab) => tab.key !== "itopup" || hasPermission("itopup_balance.view")).map((tab) => (
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
                    <div className="inline-flex items-center rounded-lg bg-gray-100 dark:bg-slate-800 p-1 sm:ml-auto">
                      {(["in", "out"] as const).map((f) => {
                        const count = f === "in"
                          ? filteredSummary.filter((r) => r.total_quantity > 0).length
                          : filteredSummary.filter((r) => r.total_quantity === 0).length;
                        return (
                          <button
                            key={f}
                            type="button"
                            onClick={() => setStockFilter(f)}
                            className={cn(
                              "px-3 py-1.5 rounded-md text-sm font-medium transition-all whitespace-nowrap",
                              stockFilter === f
                                ? "bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-sm"
                                : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
                            )}
                          >
                            {f === "in" ? t("stock.in_stock") : t("stock.out_of_stock")} ({count})
                          </button>
                        );
                      })}
                    </div>
                    <div className="relative sm:w-72">
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
                          {groupedSummary.map((g) => (
                            <Fragment key={g.category}>
                              <tr className="bg-gray-50 dark:bg-slate-900/60">
                                <td colSpan={5} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                  {g.category}
                                  <span className="ml-1.5 text-gray-400 dark:text-gray-500">({g.rows.length})</span>
                                </td>
                              </tr>
                              {g.rows.map((r) => (
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
                            </Fragment>
                          ))}
                          {groupedSummary.length === 0 && (
                            <tr>
                              <td colSpan={5} className="px-4 py-10 text-center text-gray-400">{t("stock.no_data")}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <div className="lg:hidden divide-y divide-gray-100 dark:divide-slate-800">
                      {groupedSummary.map((g) => (
                        <Fragment key={g.category}>
                          <div className="px-4 py-2 bg-gray-50 dark:bg-slate-900/60 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                            {g.category}
                            <span className="ml-1.5 text-gray-400 dark:text-gray-500">({g.rows.length})</span>
                          </div>
                          {g.rows.map((r) => {
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
                        </Fragment>
                      ))}
                      {groupedSummary.length === 0 && (
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

            {/* ---------- EMPLOYEE STOCK ---------- */}
            {activeTab === "employee-stock" && (
              <Card className="overflow-hidden">
                <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div>
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                      <Users className="h-4 w-4 text-emerald-500" /> {t("stock.employee_stock_tab")}
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t("stock.employee_stock_desc")}</p>
                  </div>
                  <div className="relative sm:ml-auto sm:w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <input
                      value={empStockSearch}
                      onChange={(e) => { setEmpStockSearch(e.target.value); setEmpStockPage(1); }}
                      placeholder={t("stock.search_employee")}
                      className={cn(inputCls, "pl-9")}
                    />
                  </div>
                </div>

                {empStockLoading ? skeleton(5) : (
                  <>
                    <div className="hidden lg:block overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-100 dark:border-slate-800 text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                            <th className="px-4 py-3">{t("stock.employee")}</th>
                            <th className="px-2 py-1">{t("stock.dms_code")}</th>
                            <th className="px-2 py-1">{t("stock.employee_type")}</th>
                            <th className="px-2 py-1">{t("stock.total_products")}</th>
                            <th className="px-2 py-1">{t("stock.total_qty")}</th>
                            <th className="px-2 py-1 text-right">{t("stock.total_value")}</th>
                            <th className="px-2 py-1" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 dark:divide-slate-800/60">
                          {empStock.map((e) => {
                            const open = expandedEmpId === e.id;
                            return (
                              <Fragment key={e.id}>
                                <tr className="hover:bg-gray-50 dark:hover:bg-slate-900/50 cursor-pointer" onClick={() => setExpandedEmpId(open ? null : e.id)}>
                                  <td className="px-4 py-2">
                                    <p className="font-medium text-gray-900 dark:text-gray-100">{e.name}</p>
                                    <p className="text-[11px] text-gray-500 dark:text-gray-400">{e.employee_id}{e.itop_number ? ` • ${e.itop_number}` : ""}</p>
                                  </td>
                                  <td className="px-2 py-1 text-gray-600 dark:text-gray-300">{e.dms_code || "-"}</td>
                                  <td className="px-2 py-1">
                                    <span className={cn(
                                      "inline-flex rounded-full px-2 py-0.5 text-xs font-medium uppercase",
                                      e.employee_type === "rso"
                                        ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300"
                                        : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                                    )}>
                                      {e.employee_type}
                                    </span>
                                  </td>
                                  <td className="px-2 py-1 text-gray-600 dark:text-gray-300">{e.product_count}</td>
                                  <td className="px-2 py-1 font-medium">{e.total_quantity}</td>
                                  <td className="px-2 py-1 text-right font-medium text-emerald-600 dark:text-emerald-400">{fmtMoney(e.total_value)}</td>
                                  <td className="px-2 py-1">
                                    {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                                  </td>
                                </tr>
                                {open && (
                                  <tr className="bg-gray-50 dark:bg-slate-900/50">
                                    <td colSpan={7} className="px-4 py-3">
                                      <div className="overflow-x-auto">
                                        <table className="w-full text-sm">
                                          <thead>
                                            <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                              <th className="px-2 py-1">{t("stock.product")}</th>
                                              <th className="px-2 py-1">{t("stock.product_code")}</th>
                                              <th className="px-2 py-1">{t("stock.category")}</th>
                                              <th className="px-2 py-1 text-right">{t("stock.unit_value")}</th>
                                              <th className="px-2 py-1 text-right">{t("stock.quantity")}</th>
                                              <th className="px-2 py-1 text-right">{t("stock.total_value")}</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-gray-100 dark:divide-slate-800/60">
                                            {e.items.map((it) => (
                                              <tr key={it.product_id}>
                                                <td className="px-2 py-1 font-medium text-gray-900 dark:text-gray-100">{it.product_name}</td>
                                                <td className="px-2 py-1 text-gray-500 dark:text-gray-400">{it.product_code}</td>
                                                <td className="px-2 py-1 text-gray-500 dark:text-gray-400">{it.category || "-"}</td>
                                                <td className="px-2 py-1 text-right text-gray-600 dark:text-gray-300">{fmtMoney(it.unit_price)}</td>
                                                <td className="px-2 py-1 text-right font-medium">{it.quantity}</td>
                                                <td className="px-2 py-1 text-right text-emerald-600 dark:text-emerald-400">{fmtMoney(it.total_value)}</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                          {empStock.length === 0 && (
                            <tr>
                              <td colSpan={7} className="px-4 py-10 text-center text-gray-400">{t("stock.no_employee_stock")}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    <div className="lg:hidden divide-y divide-gray-100 dark:divide-slate-800">
                      {empStock.map((e) => {
                        const open = expandedEmpId === e.id;
                        return (
                          <div key={e.id} className="px-4 py-3">
                            <button className="w-full flex items-center gap-3 text-left" onClick={() => setExpandedEmpId(open ? null : e.id)}>
                              <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center shrink-0">
                                <Users className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{e.name}</p>
                                <p className="text-[11px] text-gray-500 dark:text-gray-400">{e.employee_id}{e.itop_number ? ` • ${e.itop_number}` : ""}</p>
                              </div>
                              <div className="text-right">
                                <p className="font-semibold text-gray-900 dark:text-gray-100">{e.total_quantity}</p>
                                <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.total_qty")}</p>
                              </div>
                              {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                            </button>
                            {open && (
                              <div className="mt-3 bg-gray-50 dark:bg-slate-900 rounded-xl p-3">
                                <div className="grid grid-cols-2 gap-3 text-sm mb-3">
                                  <div>
                                    <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.dms_code")}</p>
                                    <p className="font-medium text-gray-900 dark:text-gray-100">{e.dms_code || "-"}</p>
                                  </div>
                                  <div>
                                    <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.employee_type")}</p>
                                    <p className="font-medium text-gray-900 dark:text-gray-100 uppercase">{e.employee_type}</p>
                                  </div>
                                  <div>
                                    <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.total_products")}</p>
                                    <p className="font-medium text-gray-900 dark:text-gray-100">{e.product_count}</p>
                                  </div>
                                  <div>
                                    <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.total_value")}</p>
                                    <p className="font-medium text-emerald-600 dark:text-emerald-400">{fmtMoney(e.total_value)}</p>
                                  </div>
                                </div>
                                <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-2">{t("stock.product_breakdown")}</p>
                                <div className="divide-y divide-gray-100 dark:divide-slate-800">
                                  {e.items.map((it) => (
                                    <div key={it.product_id} className="py-2 flex items-center justify-between gap-3">
                                      <div className="min-w-0">
                                        <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{it.product_name}</p>
                                        <p className="text-[11px] text-gray-500 dark:text-gray-400">{it.product_code}</p>
                                      </div>
                                      <div className="text-right shrink-0">
                                        <p className="font-semibold text-gray-900 dark:text-gray-100">{it.quantity}</p>
                                        <p className="text-[11px] text-emerald-600 dark:text-emerald-400">{fmtMoney(it.total_value)}</p>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {empStock.length === 0 && (
                        <div className="px-4 py-10 text-center text-gray-400">{t("stock.no_employee_stock")}</div>
                      )}
                    </div>
                    <div className="px-4 pb-4">{renderPagination(empStockPage, empStockTotal, 20, setEmpStockPage)}</div>
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
                <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center gap-3">
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    <FileClock className="h-4 w-4 text-emerald-500" /> {t("stock.ledger_tab")}
                  </h3>
                  <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <Calendar className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <input
                          type="date"
                          value={ledgerFromDate}
                          max={ledgerToDate || undefined}
                          onChange={(e) => { setLedgerFromDate(e.target.value); setLedgerPage(1); }}
                          className={cn(inputCls, "pl-8")}
                        />
                      </div>
                      <span className="text-xs text-gray-400">–</span>
                      <div className="relative">
                        <Calendar className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <input
                          type="date"
                          value={ledgerToDate}
                          min={ledgerFromDate || undefined}
                          onChange={(e) => { setLedgerToDate(e.target.value); setLedgerPage(1); }}
                          className={cn(inputCls, "pl-8")}
                        />
                      </div>
                      {(ledgerFromDate || ledgerToDate) && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 shrink-0"
                          onClick={() => { setLedgerFromDate(""); setLedgerToDate(""); setLedgerPage(1); }}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    <select
                      value={ledgerMovement}
                      onChange={(e) => { setLedgerMovement(e.target.value); setLedgerPage(1); }}
                      className={cn(inputCls, "w-40")}
                    >
                      <option value="">{t("stock.movement_all")}</option>
                      {["transfer_in", "transfer_out", "sale", "purchase", "adjustment", "return"].map((m) => (
                        <option key={m} value={m}>{movementLabel(m)}</option>
                      ))}
                    </select>
                  </div>
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

            {activeTab === "itopup" && (
              <div className="space-y-6">
                <Card className="overflow-hidden">
                  <div className="p-4 border-b border-gray-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center gap-3">
                    <h3 className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                      <Wallet className="h-4 w-4 text-emerald-500" /> {t("stock.itopup_tab")}
                    </h3>
                    {hasPermission("itopup_balance.create") && (
                      <Button size="sm" variant="outline" className="sm:ml-auto" onClick={() => openModal("itopup")}>
                        <Send className="h-4 w-4" /> {t("stock.itopup_transfer")}
                      </Button>
                    )}
                  </div>
                  {itopupLoading ? (
                    <div className="divide-y divide-gray-50 dark:divide-slate-800">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="flex items-center gap-4 px-6 py-5 animate-pulse">
                          <div className="w-10 h-10 rounded-xl bg-gray-200 dark:bg-slate-700 shrink-0" />
                          <div className="space-y-2 flex-1">
                            <div className="h-3 w-40 bg-gray-200 dark:bg-slate-700 rounded-md" />
                            <div className="h-2.5 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
                          </div>
                          <div className="h-5 w-20 bg-gray-200 dark:bg-slate-700 rounded-md" />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
                        {itopupMother.map((m) => (
                          <div key={m.house_id} className="rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-500/5 p-4">
                            <div className="flex items-center gap-2 mb-1">
                              <Wallet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                              <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">{m.house_name} · {t("stock.mother_sim")}</p>
                            </div>
                            <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{fmtMoney(m.balance)}</p>
                          </div>
                        ))}
                      </div>
                      <div className="hidden lg:block overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-gray-100 dark:border-slate-800 text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                              <th className="px-4 py-3">{t("stock.holder")}</th>
                              <th className="px-2 py-1">{t("stock.employee")}</th>
                              <th className="px-2 py-1 text-right">{t("stock.balance")}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50 dark:divide-slate-800/60">
                            {itopupRso.map((r) => (
                              <tr key={r.id ?? r.employee_id} className="hover:bg-gray-50 dark:hover:bg-slate-900/50">
                                <td className="px-4 py-2">
                                  <p className="font-medium text-gray-900 dark:text-gray-100">{r.name || "-"}</p>
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{r.dms_code || ""}</p>
                                </td>
                                <td className="px-2 py-1 text-gray-600 dark:text-gray-300">{r.employee_code || "-"}</td>
                                <td className="px-2 py-1 text-right font-semibold text-emerald-600 dark:text-emerald-400">{fmtMoney(r.balance)}</td>
                              </tr>
                            ))}
                            {itopupRso.length === 0 && (
                              <tr>
                                <td colSpan={3} className="px-4 py-10 text-center text-gray-400">{t("stock.no_itopup")}</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                      <div className="lg:hidden divide-y divide-gray-100 dark:divide-slate-800">
                        {itopupRso.map((r) => (
                          <div key={r.id ?? r.employee_id} className="flex items-center gap-3 px-4 py-3">
                            <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center shrink-0">
                              <Wallet className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{r.name || "-"}</p>
                              <p className="text-[11px] text-gray-500 dark:text-gray-400">{r.employee_code || ""}</p>
                            </div>
                            <p className="font-semibold text-emerald-600 dark:text-emerald-400">{fmtMoney(r.balance)}</p>
                          </div>
                        ))}
                        {itopupRso.length === 0 && (
                          <div className="px-4 py-10 text-center text-gray-400">{t("stock.no_itopup")}</div>
                        )}
                      </div>
                    </div>
                  )}
                </Card>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <Card className="overflow-hidden">
                    <div className="p-4 border-b border-gray-100 dark:border-slate-800">
                      <h3 className="font-semibold text-gray-900 dark:text-gray-100">{t("stock.transfers_tab")}</h3>
                    </div>
                    <div className="divide-y divide-gray-50 dark:divide-slate-800/60">
                      {itopupTransfers.slice(0, 8).map((tr) => (
                        <div key={tr.id} className="flex items-center gap-3 px-4 py-3">
                          <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/40 shrink-0">
                            <ArrowLeftRight className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-900 dark:text-gray-100 truncate">
                              {tr.from_employee_name || t("stock.mother_sim")} → {tr.to_employee_name || t("stock.mother_sim")}
                            </p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">
                              {tr.movement ? t(`stock.${tr.movement}`) : ""} · {fmtDate(tr.created_at)}
                            </p>
                          </div>
                          <p className="font-semibold text-gray-900 dark:text-gray-100">{fmtMoney(tr.amount)}</p>
                        </div>
                      ))}
                      {itopupTransfers.length === 0 && (
                        <div className="px-4 py-8 text-center text-gray-400 text-sm">{t("stock.no_data")}</div>
                      )}
                    </div>
                  </Card>
                  <Card className="overflow-hidden">
                    <div className="p-4 border-b border-gray-100 dark:border-slate-800">
                      <h3 className="font-semibold text-gray-900 dark:text-gray-100">{t("stock.ledger_tab")}</h3>
                    </div>
                    <div className="divide-y divide-gray-50 dark:divide-slate-800/60">
                      {itopupLedger.slice(0, 8).map((e) => (
                        <div key={e.id} className="flex items-center gap-3 px-4 py-3">
                          <div className={cn(
                            "p-2 rounded-lg shrink-0",
                            e.amount >= 0
                              ? "bg-emerald-100 dark:bg-emerald-900/40"
                              : "bg-red-100 dark:bg-red-900/40"
                          )}>
                            {e.amount >= 0
                              ? <ArrowUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                              : <ArrowDown className="h-4 w-4 text-red-600 dark:text-red-400" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-900 dark:text-gray-100 truncate">
                              {e.employee_name || t("stock.mother_sim")} · {movementLabel(e.movement_type)}
                            </p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">
                              {e.reason || fmtDate(e.created_at)}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className={cn(
                              "font-semibold",
                              e.amount >= 0
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-red-600 dark:text-red-400"
                            )}>
                              {e.amount >= 0 ? "+" : ""}{fmtMoney(e.amount)}
                            </p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.balance_after")}: {fmtMoney(e.balance_after)}</p>
                          </div>
                        </div>
                      ))}
                      {itopupLedger.length === 0 && (
                        <div className="px-4 py-8 text-center text-gray-400 text-sm">{t("stock.no_data")}</div>
                      )}
                    </div>
                  </Card>
                </div>
              </div>
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
                <label className={labelCls}>{t("stock.products")}</label>
                <div className="space-y-3">
                  {stockLines.map((line, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <ProductSelect
                          products={products}
                          value={line.product_id}
                          sourceType={stockForm.location_type === "rso" ? "rso" : "warehouse"}
                          onChange={(v) => updateStockLine(idx, "product_id", v)}
                        />
                      </div>
                      <div className="w-24 shrink-0">
                        <input
                          type="number"
                          min={1}
                          value={line.quantity}
                          onChange={(e) => updateStockLine(idx, "quantity", e.target.value)}
                          placeholder={t("stock.quantity")}
                          className={inputCls}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="mt-0.5 h-9 w-9 shrink-0"
                        onClick={() => removeStockLine(idx)}
                        disabled={stockLines.length === 1}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addStockLine}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 px-2 py-1.5 transition-colors"
                >
                  <Plus className="h-4 w-4" /> {t("stock.add_row")}
                </button>
                <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                  {stockLines.filter((l) => l.product_id && Number(l.quantity) > 0).length} {t("stock.items_selected")}
                </p>
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
          <ModalShell title={t("stock.new_transfer")} onClose={() => setModal(null)} wide>
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
              <div className="flex flex-col gap-2 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:gap-3">
                <div>
                  <label className={labelCls}>{t("stock.from")}</label>
                  <LocationToggle
                    value={transferForm.from_type as "warehouse" | "rso"}
                    onChange={(v) => setTransferForm({ ...transferForm, from_type: v, from_employee_id: "" })}
                    t={t}
                    rsoLabel={t("stock.employee")}
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
                    rsoLabel={t("stock.employee")}
                  />
                </div>
              </div>
              {transferForm.from_type === "rso" && (
                <div>
                  <label className={labelCls}>{t("stock.source")} ({t("stock.employee")})</label>
                  <EmployeeSelect
                    employees={employees}
                    value={transferForm.from_employee_id}
                    showStock={false}
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
                    showStock={false}
                    onChange={(v) => setTransferForm({ ...transferForm, to_employee_id: v })}
                  />
                </div>
              )}
              <div>
                <label className={labelCls}>{t("stock.products")}</label>
                <div className="space-y-3">
                  {transferLines.map((line, idx) => {
                    const avail = transferLineAvailable(idx);
                    const over = line.product_id && line.quantity !== "" && Number(line.quantity) > avail;
                    return (
                      <div key={idx} className="rounded-lg border border-gray-200 dark:border-slate-700 p-3 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                            {t("stock.transfer_record")} #{idx + 1}
                          </p>
                          <button
                            type="button"
                            disabled={transferLines.length === 1}
                            onClick={() => removeTransferLine(idx)}
                            className={cn(
                              "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                              transferLines.length === 1
                                ? "cursor-not-allowed text-gray-300 dark:text-slate-600"
                                : "text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                            )}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        <ProductSelect
                          products={transferSelectableProducts}
                          value={line.product_id}
                          sourceType={transferForm.from_type as "warehouse" | "rso"}
                          onChange={(v) => updateTransferLine(idx, "product_id", v)}
                        />
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t("stock.quantity")}</label>
                            {line.product_id && (
                              <span className="text-[11px] text-gray-500 dark:text-gray-400 tabular-nums">
                                {t("stock.max_available")}: {avail.toLocaleString("en-US")}
                              </span>
                            )}
                          </div>
                          <input
                            type="number"
                            min={1}
                            max={line.product_id ? avail || undefined : undefined}
                            value={line.quantity}
                            onChange={(e) => updateTransferLine(idx, "quantity", e.target.value)}
                            className={cn(inputCls, over && "border-red-400 dark:border-red-500/60 focus:ring-red-400/50")}
                          />
                          {over && (
                            <p className="mt-1 flex items-center gap-1 text-xs font-medium text-red-500 dark:text-red-400">
                              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                              {t("stock.quantity_exceeds")}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={addTransferLine}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 px-2 py-1.5 transition-colors"
                >
                  <Plus className="h-4 w-4" /> {t("stock.add_row")}
                </button>
                <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                  {transferLines.filter((l) => l.product_id && Number(l.quantity) > 0).length} {t("stock.items_selected")}
                </p>
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
                <ProductSelect
                  products={products}
                  value={adjustForm.product_id}
                  sourceType={adjustForm.location_type as "warehouse" | "rso"}
                  onChange={(v) => setAdjustForm({ ...adjustForm, product_id: v })}
                />
                {selectedAdjustProduct && (
                  <div className="mt-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50 p-3">
                    <div className="flex items-center justify-between mb-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="p-1.5 rounded-lg bg-amber-100 dark:bg-amber-500/10 shrink-0">
                          <Wrench className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                        </div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{selectedAdjustProduct.product_name}</p>
                      </div>
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 shrink-0">{selectedAdjustProduct.product_code}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <StockStat label={t("stock.warehouse")} value={selectedAdjustProduct.warehouse_quantity ?? 0} active={adjustForm.location_type !== "rso"} />
                      <StockStat label={t("stock.rso")} value={selectedAdjustProduct.rso_quantity ?? 0} active={adjustForm.location_type === "rso"} />
                      <StockStat label={t("stock.total_qty")} value={selectedAdjustProduct.total_quantity ?? 0} />
                    </div>
                    <div className="mt-2.5 flex items-center justify-between pt-2.5 border-t border-gray-200 dark:border-slate-700">
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {t("stock.available")} ({t(adjustForm.location_type === "rso" ? "stock.rso" : "stock.warehouse")})
                      </p>
                      <span className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums",
                        adjustSourceStock > 0
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
                          : "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400"
                      )}>
                        {adjustSourceStock > 0 ? (
                          <>
                            <Package className="h-3.5 w-3.5" /> {adjustSourceStock.toLocaleString("en-US")}
                          </>
                        ) : (
                          t("stock.out_of_stock")
                        )}
                      </span>
                    </div>
                  </div>
                )}
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
                  <input
                    type="number"
                    min={1}
                    max={adjustForm.direction === "decrease" ? adjustSourceStock || undefined : undefined}
                    value={adjustForm.quantity}
                    onChange={(e) => setAdjustForm({ ...adjustForm, quantity: e.target.value })}
                    className={inputCls}
                  />
                  {selectedAdjustProduct && adjustForm.direction === "decrease" && (() => {
                    const qty = Number(adjustForm.quantity);
                    const over = adjustForm.quantity !== "" && qty > adjustSourceStock;
                    return (
                      <p className={cn(
                        "mt-1.5 flex items-center gap-1.5 text-xs font-medium",
                        over ? "text-red-500" : "text-gray-500 dark:text-gray-400"
                      )}>
                        {over && <AlertCircle className="h-3.5 w-3.5 shrink-0" />}
                        {over
                          ? t("stock.quantity_exceeds")
                          : `${t("stock.max_available")}: ${adjustSourceStock.toLocaleString("en-US")}`}
                      </p>
                    );
                  })()}
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

        {modal === "fromlifting" && (
          <ModalShell title={t("stock.from_lifting")} onClose={() => setModal(null)} wide>
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
              <p className="text-sm text-gray-500 dark:text-gray-400">{t("stock.select_liftings")}</p>
              {liftingsLoading ? (
                <div className="divide-y divide-gray-50 dark:divide-slate-800">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-4 px-2 py-4 animate-pulse">
                      <div className="h-4 w-4 bg-gray-200 dark:bg-slate-700 rounded" />
                      <div className="space-y-2 flex-1">
                        <div className="h-3 w-40 bg-gray-200 dark:bg-slate-700 rounded-md" />
                        <div className="h-2.5 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : liftings.length === 0 ? (
                <div className="px-4 py-10 text-center text-gray-400">
                  {mutationHouseId ? t("stock.no_liftings") : t("stock.select_house_first")}
                </div>
              ) : (
                <div className="divide-y divide-gray-50 dark:divide-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl">
                  {liftings.map((l) => {
                    const checked = selectedLiftingIds.includes(l.id);
                    return (
                      <button
                        key={l.id}
                        onClick={() => toggleLifting(l.id)}
                        className="w-full flex items-center gap-3 px-3 py-3 text-left hover:bg-gray-50 dark:hover:bg-slate-800/60 transition-colors"
                      >
                        <CheckSquare className={cn("h-5 w-5 shrink-0", checked ? "text-emerald-500" : "text-gray-300 dark:text-gray-600")} />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 dark:text-gray-100">
                            {t("stock.transfer_record")} #{l.id} · {l.lifting_date}
                          </p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">
                            {l.product_count} {t("stock.products")} · {l.total_quantity.toLocaleString("en-US")} {t("stock.quantity")}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{fmtMoney(l.itopup_amount)}</p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("stock.itopup_amount")}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              {selectedLiftingIds.length > 0 && (
                <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  {selectedLiftingIds.length} {t("stock.selected_liftings")}
                </p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setModal(null)}>{t("stock.cancel")}</Button>
                <Button onClick={submitFromLifting} disabled={actionLoading || selectedLiftingIds.length === 0}>
                  {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {t("stock.submit")}
                </Button>
              </div>
            </div>
          </ModalShell>
        )}

        {modal === "itopup" && (
          <ModalShell title={t("stock.itopup_transfer")} onClose={() => setModal(null)}>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{t("stock.from")}</label>
                  <select value={itopupForm.from_employee_id} onChange={(e) => setItopupForm({ ...itopupForm, from_employee_id: e.target.value })} className={inputCls}>
                    <option value="">{t("stock.mother_sim")}</option>
                    {itopupRso.map((r) => (
                      <option key={r.employee_id} value={r.employee_id}>{r.name || r.employee_code}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>{t("stock.to")}</label>
                  <select value={itopupForm.to_employee_id} onChange={(e) => setItopupForm({ ...itopupForm, to_employee_id: e.target.value })} className={inputCls}>
                    <option value="">{t("stock.mother_sim")}</option>
                    {itopupRso.map((r) => (
                      <option key={r.employee_id} value={r.employee_id}>{r.name || r.employee_code}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>{t("stock.amount")} *</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={itopupForm.amount}
                    onChange={(e) => setItopupForm({ ...itopupForm, amount: e.target.value })}
                    className={inputCls}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className={labelCls}>{t("stock.movement")}</label>
                  <select value={itopupForm.movement} onChange={(e) => setItopupForm({ ...itopupForm, movement: e.target.value })} className={inputCls}>
                    <option value="morning">{t("stock.morning")}</option>
                    <option value="evening">{t("stock.evening")}</option>
                    <option value="other">{t("stock.other")}</option>
                  </select>
                </div>
              </div>
              <div>
                <label className={labelCls}>{t("stock.notes")}</label>
                <input type="text" value={itopupForm.notes} onChange={(e) => setItopupForm({ ...itopupForm, notes: e.target.value })} className={inputCls} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" onClick={() => setModal(null)}>{t("stock.cancel")}</Button>
                <Button onClick={submitITopUpTransfer} disabled={actionLoading}>
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
