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
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import { motion, AnimatePresence } from "framer-motion";
import {
  BadgeDollarSign,
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Loader2,
  X,
  Package,
  Boxes,
  Layers,
  TrendingUp,
  CalendarDays,
  Edit2,
  Trash2,
  Users,
  Warehouse,
  AlertCircle,
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

interface Sale {
  id: number;
  product_id: number;
  product_code: string;
  product_name: string;
  source_type: string;
  employee_id?: number;
  employee_name?: string;
  quantity: number;
  unit_price: number;
  total_amount: number;
  sale_date?: string;
  notes?: string;
  created_at?: string;
  created_by_name?: string;
  house_id?: number;
  house_name?: string;
  house_code?: string;
  house_region?: string;
  house_district?: string;
  house_address?: string;
  house_proprietor_name?: string;
  house_proprietor_contact?: string;
  employee_identifier?: string;
  employee_dms_code?: string;
  employee_itop_number?: string;
  employee_pool_number?: string;
  employee_personal_number?: string;
  employee_type?: string;
  employee_status?: string;
}

interface SaleGroup {
  key: string;
  type: "employee" | "house";
  id: number;
  name: string;
  number: string;
  source_type: "rso" | "warehouse";
  count: number;
  quantity: number;
  amount: number;
}

function fmtMoney(n: number) {
  return "৳" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d?: string) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function empNumber(s: Sale) {
  return s.employee_identifier || s.employee_dms_code || s.employee_itop_number || s.employee_personal_number || "";
}

function GroupDetailContent({
  loading,
  rows,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
  t,
}: {
  loading: boolean;
  rows: Sale[];
  canEdit: boolean;
  canDelete: boolean;
  onEdit: (s: Sale) => void;
  onDelete: (s: Sale) => void;
  t: (path: string, params?: Record<string, string | number | undefined>) => string;
}) {
  if (loading) {
    return (
      <div className="divide-y divide-gray-50 dark:divide-slate-800">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-3 sm:px-4 py-3 animate-pulse">
            <div className="w-9 h-9 rounded-lg bg-gray-200 dark:bg-slate-700 shrink-0" />
            <div className="space-y-2 flex-1">
              <div className="h-3 w-36 bg-gray-200 dark:bg-slate-700 rounded-md" />
              <div className="h-2.5 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
            </div>
            <div className="hidden sm:block space-y-2">
              <div className="h-3 w-16 bg-gray-200 dark:bg-slate-700 rounded-md" />
              <div className="h-2.5 w-12 bg-gray-100 dark:bg-slate-800 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-400">{t("sales.no_data")}</p>;
  }

  return (
    <div className="divide-y divide-gray-100 dark:divide-slate-800">
      {rows.map((r) => (
        <div key={r.id} className="flex items-center gap-3 px-3 sm:px-4 py-2.5">
          <div className={cn(
            "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
            r.source_type === "warehouse" ? "bg-blue-100 dark:bg-blue-900/40" : "bg-purple-100 dark:bg-purple-900/40"
          )}>
            {r.source_type === "warehouse"
              ? <Boxes className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              : <Layers className="h-4 w-4 text-purple-600 dark:text-purple-400" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{r.product_name}</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              {r.product_code} · {r.sale_date ? String(r.sale_date).slice(0, 10) : fmtDate(r.created_at)}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{fmtMoney(r.total_amount)}</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400">{r.quantity} × {fmtMoney(r.unit_price)}</p>
          </div>
          {(canEdit || canDelete) && (
            <div className="flex items-center gap-1 shrink-0">
              {canEdit && (
                <button onClick={() => onEdit(r)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 dark:text-gray-400">
                  <Edit2 className="h-4 w-4" />
                </button>
              )}
              {canDelete && (
                <button onClick={() => onDelete(r)} className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500">
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="mt-1 text-xs text-red-500 dark:text-red-400">{msg}</p>;
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
    { value: "warehouse" as const, label: t("sales.warehouse"), icon: Warehouse },
    { value: "rso" as const, label: t("sales.rso"), icon: Users },
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

function todayISO() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

const EMPTY_FORM = {
  source_type: "warehouse",
  employee_id: "",
  sale_date: todayISO(),
  notes: "",
};

const SALE_LINE = {
  product_id: "",
  quantity: "",
  unit_price: "",
};

export default function SalesPage() {
  const { hasPermission, loading: authLoading, selectedHouse } = useAuth();
  const { t } = useLanguage();

  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const perPage = 20;

  const [sales, setSales] = useState<Sale[]>([]);
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState({ count: 0, quantity: 0, amount: 0, today_amount: 0 });

  const [products, setProducts] = useState<Product[]>([]);
  const [employees, setEmployees] = useState<EmployeeOpt[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Sale | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [lines, setLines] = useState<{ product_id: string; quantity: string; unit_price: string }[]>([{ ...SALE_LINE }]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState<Sale | null>(null);

  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [groupLoading, setGroupLoading] = useState(false);
  const [groupRows, setGroupRows] = useState<Sale[]>([]);
  const [housePrompt, setHousePrompt] = useState(false);
  const [accessibleHouses, setAccessibleHouses] = useState<{ id: number; name: string; code: string }[]>([]);
  const [modalHouse, setModalHouse] = useState<string>("");

  const houseId = selectedHouse?.id;
  const headers = useMemo(() => {
    const h: Record<string, string> = {};
    if (houseId) h["X-House-ID"] = String(houseId);
    return h;
  }, [houseId]);

  const metaHouseId = modalHouse ? Number(modalHouse) : houseId;
  const metaHeaders = useMemo(() => {
    const h: Record<string, string> = {};
    if (metaHouseId) h["X-House-ID"] = String(metaHouseId);
    return h;
  }, [metaHouseId]);

  const mutationHouseId = selectedHouse?.id ?? (modalHouse ? Number(modalHouse) : undefined);
  const mutationHeaders = useMemo(() => {
    const h: Record<string, string> = {};
    if (mutationHouseId) h["X-House-ID"] = String(mutationHouseId);
    return h;
  }, [mutationHouseId]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  const fetchSales = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(page), per_page: String(perPage) };
      if (search) params.search = search;
      const res = await apiClient.get("sales", { params, headers });
      setSales(res.data.data || []);
      setTotal(res.data.pagination?.total || 0);
      setTotals(res.data.totals || { count: 0, quantity: 0, amount: 0, today_amount: 0 });
    } catch {
      toast.error(t("common.error"));
    } finally {
      setLoading(false);
    }
  };

  const fetchMeta = async () => {
    try {
      const [eRes, hRes] = await Promise.all([
        apiClient.get("stock/employees", { params: { include_stock: "true" }, headers: metaHeaders }),
        apiClient.get("houses/accessible"),
      ]);
      setEmployees(eRes.data.data || []);
      setAccessibleHouses(hRes.data || []);
    } catch {
      // non-blocking
    }
  };

  const selectedEmpId = form.source_type === "rso" && form.employee_id ? Number(form.employee_id) : undefined;

  const fetchProducts = async (empId?: number) => {
    try {
      const params: Record<string, string> = {};
      if (empId) params.employee_id = String(empId);
      const res = await apiClient.get("stock/products", { params, headers: metaHeaders });
      setProducts(res.data.data || []);
    } catch {
      // non-blocking
    }
  };

  const groups = useMemo<SaleGroup[]>(() => {
    const map = new Map<string, SaleGroup>();
    for (const s of sales) {
      const isRso = s.source_type === "rso";
      const key = isRso ? `emp:${s.employee_id ?? 0}` : `house:${s.house_id ?? 0}`;
      let g = map.get(key);
      if (!g) {
        g = {
          key,
          type: isRso ? "employee" : "house",
          id: isRso ? (s.employee_id ?? 0) : (s.house_id ?? 0),
          name: isRso ? (s.employee_name || "-") : (s.house_name || "-"),
          number: isRso ? empNumber(s) : (s.house_code || ""),
          source_type: isRso ? "rso" : "warehouse",
          count: 0,
          quantity: 0,
          amount: 0,
        };
        map.set(key, g);
      }
      g.count += 1;
      g.quantity += s.quantity;
      g.amount += s.total_amount;
    }
    return Array.from(map.values());
  }, [sales]);

  const toggleGroup = async (g: SaleGroup) => {
    if (expandedKey === g.key) {
      setExpandedKey(null);
      setGroupRows([]);
      return;
    }
    setExpandedKey(g.key);
    setGroupLoading(true);
    setGroupRows([]);
    try {
      const params: Record<string, string> = { per_page: "100" };
      if (g.type === "employee") params.employee_id = String(g.id);
      else params.house_id = String(g.id);
      const res = await apiClient.get("sales", { params, headers });
      setGroupRows(res.data.data || []);
    } catch {
      toast.error(t("common.error"));
    } finally {
      setGroupLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && hasPermission("sales.view")) {
      fetchMeta();
      fetchSales();
    }
  }, [authLoading, hasPermission, metaHouseId]);

  useEffect(() => {
    if (!authLoading && hasPermission("sales.view")) fetchProducts(selectedEmpId);
  }, [authLoading, hasPermission, metaHouseId, selectedEmpId]);

  useEffect(() => {
    if (!authLoading && hasPermission("sales.view")) fetchSales();
  }, [page, authLoading, hasPermission, houseId]);

  const houseProducts = useMemo(() => {
    if (!metaHouseId) return [];
    if (form.source_type === "rso") {
      return products.filter((p) => (p.rso_quantity ?? 0) > 0);
    }
    return products.filter((p) => ((p.warehouse_quantity ?? 0) + (p.rso_quantity ?? 0)) > 0);
  }, [products, metaHouseId, form.source_type]);

  const houseEmployees = useMemo(() => {
    if (!metaHouseId) return [];
    return employees;
  }, [employees, metaHouseId]);

  const lineAvailable = (i: number) => {
    const line = lines[i];
    if (!line || !line.product_id) return 0;
    const p = products.find((x) => String(x.id) === line.product_id);
    if (!p) return 0;
    return form.source_type === "rso"
      ? (p.rso_quantity ?? 0)
      : (p.warehouse_quantity ?? 0);
  };

  const openCreate = () => {
    if (!selectedHouse && accessibleHouses.length === 0) {
      setHousePrompt(true);
      return;
    }
    if (!selectedHouse && accessibleHouses.length === 1) {
      setModalHouse(String(accessibleHouses[0].id));
    }
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setLines([{ ...SALE_LINE }]);
    setErrors({});
    setModalOpen(true);
  };

  const openEdit = (sale: Sale) => {
    setEditing(sale);
    setForm({
      source_type: sale.source_type,
      employee_id: sale.employee_id ? String(sale.employee_id) : "",
      sale_date: sale.sale_date ? String(sale.sale_date).slice(0, 10) : todayISO(),
      notes: sale.notes || "",
    });
    setLines([{ product_id: String(sale.product_id || 0), quantity: String(sale.quantity), unit_price: String(sale.unit_price) }]);
    setErrors({});
    setModalOpen(true);
  };

  const addLine = () => {
    setLines((prev) => [...prev, { ...SALE_LINE }]);
    setErrors((prev) => {
      const next = { ...prev };
      delete next.general;
      return next;
    });
  };

  const updateLine = (index: number, patch: Partial<{ product_id: string; quantity: string; unit_price: string }>) => {
    if (patch.product_id) {
      const p = products.find((x) => String(x.id) === patch.product_id);
      if (p) patch.unit_price = String(p.ret_lifting_price ?? 0);
    }
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
    setErrors((prev) => {
      const next = { ...prev };
      const fields = Object.keys(patch);
      if (fields.includes("product_id")) delete next[`product_${index}`];
      if (fields.includes("quantity")) delete next[`quantity_${index}`];
      if (fields.includes("unit_price")) delete next[`unit_price_${index}`];
      delete next.general;
      return next;
    });
  };

  const removeLine = (index: number) => {
    setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[`product_${index}`];
      delete next[`quantity_${index}`];
      delete next[`unit_price_${index}`];
      delete next.general;
      return next;
    });
  };

  const submit = async () => {
    const nextErrors: Record<string, string> = {};
    if (!mutationHouseId) {
      nextErrors.house = t("sales.select_house_first");
    }
    if (form.source_type === "rso" && !form.employee_id) {
      nextErrors.employee = t("sales.select_employee");
    }
    let hasProduct = false;
    lines.forEach((l, i) => {
      const productId = Number(l.product_id);
      const qty = Number(l.quantity);
      const price = Number(l.unit_price);
      if (productId <= 0) {
        nextErrors[`product_${i}`] = t("sales.select_product");
      } else {
        hasProduct = true;
        if (!qty || qty <= 0) {
          nextErrors[`quantity_${i}`] = t("sales.quantity_required");
        } else if (qty > lineAvailable(i)) {
          nextErrors[`quantity_${i}`] = t("sales.insufficient_stock", { available: lineAvailable(i) });
        }
        if (isNaN(price) || price < 0) {
          nextErrors[`unit_price_${i}`] = t("sales.price_required");
        }
      }
    });
    if (!hasProduct) {
      nextErrors.product_0 = t("sales.select_product");
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const validLines = lines
      .map((l) => ({ product_id: Number(l.product_id), quantity: Number(l.quantity), unit_price: Number(l.unit_price) }))
      .filter((l) => l.product_id > 0);
    setActionLoading(true);
    try {
      if (editing) {
        const first = validLines[0];
        await apiClient.put(`sales/${editing.id}`, {
          product_id: first.product_id,
          source_type: form.source_type,
          employee_id: form.source_type === "rso" ? Number(form.employee_id) : undefined,
          quantity: first.quantity,
          unit_price: first.unit_price,
          sale_date: form.sale_date || undefined,
          notes: form.notes || undefined,
        }, { headers: mutationHeaders });
        toast.success(t("sales.toast_update_success"));
      } else {
        await apiClient.post("sales/bulk", {
          source_type: form.source_type,
          employee_id: form.source_type === "rso" ? Number(form.employee_id) : undefined,
          sale_date: form.sale_date || undefined,
          notes: form.notes || undefined,
          items: validLines,
        }, { headers: mutationHeaders });
        toast.success(t("sales.toast_create_success"));
      }
      setModalOpen(false);
      setEditing(null);
      setForm({ ...EMPTY_FORM });
      setLines([{ ...SALE_LINE }]);
      setErrors({});
      fetchSales();
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      if (Array.isArray(detail)) {
        const mapped: Record<string, string> = {};
        detail.forEach((d: any) => {
          const loc = d.loc || [];
          const field = loc[2];
          if (field === "source_type") mapped.source = d.msg;
          else if (field === "employee_id") mapped.employee = d.msg;
          else if (field === "items") mapped.general = d.msg;
          else if (typeof field === "number") {
            const sub = loc[3];
            if (sub === "quantity") mapped[`quantity_${field}`] = d.msg;
            else if (sub === "unit_price") mapped[`unit_price_${field}`] = d.msg;
            else mapped.general = d.msg;
          } else mapped.general = d.msg;
        });
        setErrors(mapped);
      } else if (typeof detail === "string") {
        setErrors({ general: detail });
      } else {
        setErrors({ general: t("common.error") });
      }
    } finally {
      setActionLoading(false);
    }
  };

  const confirmDelete = () => {
    setDeleteOpen(true);
  };

  const doDelete = async () => {
    if (!deleting) return;
    setActionLoading(true);
    try {
      await apiClient.delete(`sales/${deleting.id}`, { headers });
      toast.success(t("sales.toast_delete_success"));
      setDeleteOpen(false);
      setDeleting(null);
      fetchSales();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || t("common.error"));
    } finally {
      setActionLoading(false);
    }
  };

  if (!hasPermission("sales.view")) return <AccessDenied />;

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

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <BadgeDollarSign className="h-6 w-6 text-emerald-500" />
              {t("sales.title")}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t("sales.description")}</p>
          </div>
          {hasPermission("sales.create") && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" /> {t("sales.new_sale")}
            </Button>
          )}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-blue-100 dark:bg-blue-900/40">
                <BadgeDollarSign className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">{t("sales.total_sales")}</p>
                <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{totals.count}</p>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-purple-100 dark:bg-purple-900/40">
                <Package className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">{t("sales.total_quantity")}</p>
                <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{totals.quantity}</p>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-emerald-100 dark:bg-emerald-900/40">
                <TrendingUp className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">{t("sales.total_amount")}</p>
                <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{fmtMoney(totals.amount)}</p>
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-amber-100 dark:bg-amber-900/40">
                <CalendarDays className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">{t("sales.today_amount")}</p>
                <p className="text-xl font-bold text-gray-900 dark:text-gray-100">{fmtMoney(totals.today_amount)}</p>
              </div>
            </div>
          </Card>
        </div>

        <Card className="overflow-hidden">
          <div className="p-4 border-b border-gray-100 dark:border-slate-800">
            <div className="relative sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder={t("sales.search_placeholder")}
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
                      <th className="px-4 py-3">{t("sales.party")}</th>
                      <th className="px-2 py-1">{t("sales.source")}</th>
                      <th className="px-2 py-1 text-right">{t("sales.records")}</th>
                      <th className="px-2 py-1 text-right">{t("sales.total_quantity")}</th>
                      <th className="px-2 py-1 text-right">{t("sales.total_amount")}</th>
                      <th className="px-2 py-1 text-right">{t("common.table_actions")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-slate-800/60">
                    {groups.map((g) => {
                      const open = expandedKey === g.key;
                      return (
                        <Fragment key={g.key}>
                          <tr onClick={() => toggleGroup(g)} className="cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-900/50">
                            <td className="px-4 py-2">
                              <div className="flex items-center gap-3">
                                <div className={cn(
                                  "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
                                  g.type === "employee" ? "bg-purple-100 dark:bg-purple-900/40" : "bg-blue-100 dark:bg-blue-900/40"
                                )}>
                                  {g.type === "employee"
                                    ? <Users className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                                    : <Warehouse className="h-4 w-4 text-blue-600 dark:text-blue-400" />}
                                </div>
                                <div className="min-w-0">
                                  <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{g.name}</p>
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{g.number || "-"}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-2 py-1">
                              <span className={cn(
                                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                                g.type === "employee"
                                  ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300"
                                  : "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                              )}>
                                {g.type === "employee" ? <Layers className="h-3 w-3" /> : <Boxes className="h-3 w-3" />}
                                {g.type === "employee" ? t("sales.rso") : t("sales.warehouse")}
                              </span>
                            </td>
                            <td className="px-2 py-1 text-right tabular-nums">{g.count}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{g.quantity}</td>
                            <td className="px-2 py-1 text-right font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">{fmtMoney(g.amount)}</td>
                            <td className="px-2 py-1">
                              <div className="flex items-center justify-end">
                                {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                              </div>
                            </td>
                          </tr>
                          {open && (
                            <tr className="bg-gray-50/70 dark:bg-slate-900/60">
                              <td colSpan={6} className="px-4 py-3">
                                <div className="flex items-center justify-between mb-2 px-1">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{t("sales.sale_history")}</p>
                                  <span className="text-[11px] text-gray-400 dark:text-gray-500 tabular-nums">{groupLoading ? "..." : groupRows.length}</span>
                                </div>
                                <GroupDetailContent
                                  loading={groupLoading}
                                  rows={groupRows}
                                  canEdit={hasPermission("sales.edit")}
                                  canDelete={hasPermission("sales.delete")}
                                  onEdit={openEdit}
                                  onDelete={(s) => { setDeleting(s); confirmDelete(); }}
                                  t={t}
                                />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                    {groups.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center text-gray-400">{t("sales.no_data")}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="lg:hidden divide-y divide-gray-100 dark:divide-slate-800">
                {groups.map((g) => {
                  const open = expandedKey === g.key;
                  return (
                    <div key={g.key} className="px-4 py-3">
                      <button className="w-full flex items-center gap-3 text-left" onClick={() => toggleGroup(g)}>
                        <div className={cn(
                          "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                          g.type === "employee" ? "bg-purple-100 dark:bg-purple-900/40" : "bg-blue-100 dark:bg-blue-900/40"
                        )}>
                          {g.type === "employee"
                            ? <Users className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                            : <Warehouse className="h-5 w-5 text-blue-600 dark:text-blue-400" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{g.name}</p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{g.number || "-"}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-emerald-600 dark:text-emerald-400">{fmtMoney(g.amount)}</p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">{g.count} {t("sales.records").toLowerCase()}</p>
                        </div>
                        {open ? <ChevronUp className="h-4 w-4 text-gray-400 shrink-0" /> : <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />}
                      </button>
                      {open && (
                        <div className="mt-3 rounded-xl bg-gray-50 dark:bg-slate-900 p-2">
                          <GroupDetailContent
                            loading={groupLoading}
                            rows={groupRows}
                            canEdit={hasPermission("sales.edit")}
                            canDelete={hasPermission("sales.delete")}
                            onEdit={openEdit}
                            onDelete={(s) => { setDeleting(s); confirmDelete(); }}
                            t={t}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
                {groups.length === 0 && (
                  <div className="px-4 py-10 text-center text-gray-400">{t("sales.no_data")}</div>
                )}
              </div>

              <div className="px-4 py-4 flex items-center justify-between flex-wrap gap-3">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {total === 0 ? "0" : `${(page - 1) * perPage + 1}-${Math.min(page * perPage, total)}`} / {total}
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm text-gray-600 dark:text-gray-300">{page} / {totalPages}</span>
                  <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage(page + 1)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>

      {/* ---------- CREATE / EDIT MODAL ---------- */}
      <AnimatePresence>
        {modalOpen && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" onClick={() => setModalOpen(false)}>
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white dark:bg-slate-900 p-5 sm:p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {editing ? t("sales.edit_sale") : t("sales.new_sale")}
                </h3>
                <button onClick={() => setModalOpen(false)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800">
                  <X className="h-5 w-5 text-gray-500" />
                </button>
              </div>
              <div className="space-y-4">
                {!selectedHouse && accessibleHouses.length > 0 && (
                  <div>
                    <label className={labelCls}>{t("common.select_house")}</label>
                    <select value={modalHouse} onChange={(e) => { setModalHouse(e.target.value); setForm({ ...form, employee_id: "" }); setLines((prev) => prev.map(() => ({ ...SALE_LINE }))); setErrors((prev) => { const n = { ...prev }; delete n.house; delete n.employee; delete n.general; return n; }); }} className={inputCls}>
                      <option value="">{t("common.select_house")}</option>
                      {accessibleHouses.map((h) => (
                        <option key={h.id} value={h.id}>{h.name} ({h.code})</option>
                      ))}
                    </select>
                    <FieldError msg={errors.house} />
                  </div>
                )}
                <div>
                  <label className={labelCls}>{t("sales.source")}</label>
                  <LocationToggle
                    value={form.source_type === "rso" ? "rso" : "warehouse"}
                    onChange={(v) => { setForm({ ...form, source_type: v, employee_id: "" }); setErrors((prev) => { const n = { ...prev }; delete n.source; delete n.employee; delete n.general; return n; }); }}
                    t={t}
                  />
                  <FieldError msg={errors.source} />
                </div>
                {form.source_type === "rso" && (
                  <div>
                    <label className={labelCls}>{t("sales.employee")}</label>
                    {metaHouseId ? (
                      <EmployeeSelect
                        employees={houseEmployees}
                        value={form.employee_id}
                        showStock
                        onChange={(v) => { setForm({ ...form, employee_id: v }); setErrors((prev) => { const n = { ...prev }; delete n.employee; delete n.general; return n; }); }}
                      />
                    ) : (
                      <div className="rounded-lg border border-dashed border-gray-300 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 px-3 py-2 text-sm text-gray-400 dark:text-gray-500">
                        {t("sales.select_house_first")}
                      </div>
                    )}
                    <FieldError msg={errors.employee} />
                    {form.source_type === "rso" && form.employee_id && (
                      <div className="mt-3 rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/60 dark:bg-emerald-500/5 p-3">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                            <Boxes className="h-3.5 w-3.5" />
                            {t("sales.employee_stock")}
                          </p>
                          {houseProducts.length > 0 && (
                            <span className="text-[11px] font-medium text-emerald-700/70 dark:text-emerald-400/70 tabular-nums">
                              {houseProducts.length} {t("sales.products_label")} · {houseProducts.reduce((s, p) => s + (p.rso_quantity ?? 0), 0).toLocaleString("en-US")} {t("sales.units_label")}
                            </span>
                          )}
                        </div>
                        {houseProducts.length === 0 ? (
                          <p className="text-xs text-gray-500 dark:text-gray-400">{t("sales.no_employee_stock")}</p>
                        ) : (
                          <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
                            {houseProducts.map((p) => (
                              <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg bg-white dark:bg-slate-900 px-2.5 py-1.5">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{p.product_name}</p>
                                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{p.product_code}</p>
                                </div>
                                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold tabular-nums text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                                  <Package className="h-3 w-3" />
                                  {(p.rso_quantity ?? 0).toLocaleString("en-US")}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label className={labelCls}>{t("sales.product")}</label>
                  <div className="space-y-3">
                    {lines.map((line, i) => (
                      <div key={i} className="rounded-lg border border-gray-200 dark:border-slate-700 p-3 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                            {t("sales.sale_record")} #{i + 1}
                          </p>
                          <button
                            type="button"
                            disabled={lines.length === 1}
                            onClick={() => removeLine(i)}
                            className={cn(
                              "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                              lines.length === 1
                                ? "cursor-not-allowed text-gray-300 dark:text-slate-600"
                                : "text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"
                            )}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                        {!metaHouseId ? (
                          <div className="rounded-lg border border-dashed border-gray-300 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 px-3 py-2 text-sm text-gray-400 dark:text-gray-500">
                            {t("sales.select_house_first")}
                          </div>
                        ) : form.source_type === "rso" && !form.employee_id ? (
                          <div className="rounded-lg border border-dashed border-gray-300 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 px-3 py-2 text-sm text-gray-400 dark:text-gray-500">
                            {t("sales.select_employee")}
                          </div>
                        ) : (
                          <ProductSelect
                            products={houseProducts}
                            value={line.product_id}
                            sourceType={form.source_type === "rso" ? "rso" : "warehouse"}
                            onChange={(v) => updateLine(i, { product_id: v })}
                          />
                        )}
                        <FieldError msg={errors[`product_${i}`]} />
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t("sales.quantity")}</label>
                              {line.product_id && (
                                <span className="text-[11px] text-gray-500 dark:text-gray-400 tabular-nums">
                                  {t("sales.available_qty", { count: lineAvailable(i) })}
                                </span>
                              )}
                            </div>
                            <input
                              type="number"
                              min={1}
                              max={line.product_id ? lineAvailable(i) || undefined : undefined}
                              value={line.quantity}
                              onChange={(e) => updateLine(i, { quantity: e.target.value })}
                              className={cn(inputCls, line.product_id && Number(line.quantity) > lineAvailable(i) && "border-red-400 dark:border-red-500/60 focus:ring-red-400/50")}
                            />
                            <FieldError msg={errors[`quantity_${i}`]} />
                            {!errors[`quantity_${i}`] && line.product_id && line.quantity !== "" && Number(line.quantity) > lineAvailable(i) && (
                              <p className="mt-1 flex items-center gap-1 text-xs font-medium text-red-500 dark:text-red-400">
                                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                                {t("sales.insufficient_stock", { available: lineAvailable(i) })}
                              </p>
                            )}
                          </div>
                          <div>
                            <label className={labelCls}>{t("sales.unit_price")}</label>
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={line.unit_price}
                              placeholder={(() => {
                                const p = line.product_id ? products.find((x) => String(x.id) === line.product_id) : undefined;
                                return p ? String(p.ret_lifting_price ?? 0) : "";
                              })()}
                              onChange={(e) => updateLine(i, { unit_price: e.target.value })}
                              className={inputCls}
                            />
                            <FieldError msg={errors[`unit_price_${i}`]} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={addLine}
                    className="mt-2 inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400 transition-colors hover:bg-emerald-50 dark:hover:bg-emerald-500/10"
                  >
                    <Plus className="h-4 w-4" />
                    {t("sales.add_row")}
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>{t("sales.sale_date")}</label>
                    <input type="date" value={form.sale_date} onChange={(e) => setForm({ ...form, sale_date: e.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>{t("sales.notes")}</label>
                    <input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputCls} />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 dark:bg-slate-800 px-3 py-2">
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {t("sales.items_selected", { count: lines.filter((l) => l.product_id).length })}
                  </p>
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {t("sales.total")}: {fmtMoney(lines.reduce((sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0))}
                  </p>
                </div>

                <FieldError msg={errors.general} />

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setModalOpen(false)}>{t("sales.cancel")}</Button>
                  <Button onClick={submit} disabled={actionLoading}>
                    {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {t("sales.submit")}
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {housePrompt && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" onClick={() => setHousePrompt(false)}>
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-white dark:bg-slate-900 p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">{t("sales.select_house_first")}</h3>
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">{t("sales.no_house")}</p>
              <div className="flex justify-end">
                <Button variant="outline" onClick={() => setHousePrompt(false)}>OK</Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmationModal
        isOpen={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={doDelete}
        title={t("sales.delete_confirm")}
        message={deleting ? `${deleting.product_name} · ${deleting.quantity} × ${fmtMoney(deleting.unit_price)}` : ""}
        loading={actionLoading}
        type="danger"
      />
    </div>
  );
}
