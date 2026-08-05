"use client";

import { useEffect, useMemo, useState } from "react";
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
} from "lucide-react";

interface Product {
  id: number;
  product_code: string;
  product_name: string;
  category?: string;
  mrp: number;
  dd_lifting_price: number;
  ret_lifting_price: number;
}

interface EmployeeOpt {
  id: number;
  employee_id: string;
  name: string;
  dms_code?: string;
  employee_type?: string;
  house_id: number;
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
}

function fmtMoney(n: number) {
  return "৳" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d?: string) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

const EMPTY_FORM = {
  product_id: "",
  source_type: "warehouse",
  employee_id: "",
  quantity: "",
  unit_price: "",
  sale_date: "",
  notes: "",
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

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState<Sale | null>(null);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [housePrompt, setHousePrompt] = useState(false);
  const [accessibleHouses, setAccessibleHouses] = useState<{ id: number; name: string; code: string }[]>([]);
  const [modalHouse, setModalHouse] = useState<string>("");

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
      const [pRes, eRes, hRes] = await Promise.all([
        apiClient.get("stock/products"),
        apiClient.get("stock/employees", { headers }),
        apiClient.get("houses/accessible"),
      ]);
      setProducts(pRes.data.data || []);
      setEmployees(eRes.data.data || []);
      setAccessibleHouses(hRes.data || []);
    } catch {
      // non-blocking
    }
  };

  useEffect(() => {
    if (!authLoading && hasPermission("sales.view")) {
      fetchMeta();
      fetchSales();
    }
  }, [authLoading, hasPermission, houseId]);

  useEffect(() => {
    if (!authLoading && hasPermission("sales.view")) fetchSales();
  }, [page, authLoading, hasPermission, houseId]);

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
    setModalOpen(true);
  };

  const openEdit = (sale: Sale) => {
    setEditing(sale);
    setForm({
      product_id: String(sale.product_id || 0),
      source_type: sale.source_type,
      employee_id: sale.employee_id ? String(sale.employee_id) : "",
      quantity: String(sale.quantity),
      unit_price: String(sale.unit_price),
      sale_date: sale.sale_date ? String(sale.sale_date).slice(0, 10) : "",
      notes: sale.notes || "",
    });
    setModalOpen(true);
  };

  const submit = async () => {
    if (!mutationHouseId) {
      toast.error(t("sales.select_house_first"));
      return;
    }
    if (!form.product_id) {
      toast.error(t("sales.select_product"));
      return;
    }
    if (!form.source_type) {
      toast.error(t("sales.select_source"));
      return;
    }
    const quantity = Number(form.quantity);
    if (!quantity || quantity <= 0) {
      toast.error(t("sales.quantity_required"));
      return;
    }
    const unitPrice = Number(form.unit_price);
    if (isNaN(unitPrice) || unitPrice < 0) {
      toast.error(t("sales.price_required"));
      return;
    }
    if (form.source_type === "rso" && !form.employee_id) {
      toast.error(t("sales.select_employee"));
      return;
    }
    const payload = {
      product_id: Number(form.product_id),
      source_type: form.source_type,
      employee_id: form.source_type === "rso" ? Number(form.employee_id) : undefined,
      quantity,
      unit_price: unitPrice,
      sale_date: form.sale_date || undefined,
      notes: form.notes || undefined,
    };
    setActionLoading(true);
    try {
      if (editing) {
        await apiClient.put(`sales/${editing.id}`, payload, { headers: mutationHeaders });
        toast.success(t("sales.toast_update_success"));
      } else {
        await apiClient.post("sales", payload, { headers: mutationHeaders });
        toast.success(t("sales.toast_create_success"));
      }
      setModalOpen(false);
      setEditing(null);
      setForm({ ...EMPTY_FORM });
      fetchSales();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || t("common.error"));
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
                      <th className="px-4 py-3">{t("sales.product")}</th>
                      <th className="px-2 py-1">{t("sales.source")}</th>
                      <th className="px-2 py-1">{t("sales.employee")}</th>
                      <th className="px-2 py-1">{t("sales.quantity")}</th>
                      <th className="px-2 py-1 text-right">{t("sales.unit_price")}</th>
                      <th className="px-2 py-1 text-right">{t("sales.total")}</th>
                      <th className="px-2 py-1">{t("sales.sale_date")}</th>
                      <th className="px-2 py-1 text-right">{t("common.actions")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-slate-800/60">
                    {sales.map((s) => (
                      <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-slate-900/50">
                        <td className="px-4 py-2">
                          <p className="font-medium text-gray-900 dark:text-gray-100">{s.product_name}</p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">{s.product_code}</p>
                        </td>
                        <td className="px-2 py-1">
                          <span className={cn(
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                            s.source_type === "warehouse"
                              ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                              : "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300"
                          )}>
                            {s.source_type === "warehouse" ? <Boxes className="h-3 w-3" /> : <Layers className="h-3 w-3" />}
                            {s.source_type === "warehouse" ? t("sales.warehouse") : t("sales.rso")}
                          </span>
                        </td>
                        <td className="px-2 py-1 text-gray-600 dark:text-gray-300">{s.employee_name || "-"}</td>
                        <td className="px-2 py-1 font-medium">{s.quantity}</td>
                        <td className="px-2 py-1 text-right">{fmtMoney(s.unit_price)}</td>
                        <td className="px-2 py-1 text-right font-semibold text-emerald-600 dark:text-emerald-400">{fmtMoney(s.total_amount)}</td>
                        <td className="px-2 py-1 text-gray-500 dark:text-gray-400">{s.sale_date ? String(s.sale_date).slice(0, 10) : fmtDate(s.created_at)}</td>
                        <td className="px-2 py-1">
                          <div className="flex items-center justify-end gap-1">
                            {hasPermission("sales.edit") && (
                              <button onClick={() => openEdit(s)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 dark:text-gray-400">
                                <Edit2 className="h-4 w-4" />
                              </button>
                            )}
                            {hasPermission("sales.delete") && (
                              <button onClick={() => { setDeleting(s); confirmDelete(); }} className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500">
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {sales.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-4 py-10 text-center text-gray-400">{t("sales.no_data")}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="lg:hidden divide-y divide-gray-100 dark:divide-slate-800">
                {sales.map((s) => {
                  const open = expandedId === s.id;
                  return (
                    <div key={s.id} className="px-4 py-3">
                      <button className="w-full flex items-center gap-3 text-left" onClick={() => setExpandedId(open ? null : s.id)}>
                        <div className={cn(
                          "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                          s.source_type === "warehouse" ? "bg-blue-100 dark:bg-blue-900/40" : "bg-purple-100 dark:bg-purple-900/40"
                        )}>
                          {s.source_type === "warehouse"
                            ? <Boxes className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                            : <Layers className="h-5 w-5 text-purple-600 dark:text-purple-400" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{s.product_name}</p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">{s.product_code} · {fmtDate(s.sale_date || s.created_at)}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-emerald-600 dark:text-emerald-400">{fmtMoney(s.total_amount)}</p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">{s.quantity} × {fmtMoney(s.unit_price)}</p>
                        </div>
                        {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                      </button>
                      {open && (
                        <div className="mt-3 grid grid-cols-2 gap-3 text-sm bg-gray-50 dark:bg-slate-900 rounded-xl p-3">
                          <div>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("sales.source")}</p>
                            <p className="font-medium text-gray-900 dark:text-gray-100">
                              {s.source_type === "warehouse" ? t("sales.warehouse") : t("sales.rso")}
                            </p>
                          </div>
                          <div>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("sales.employee")}</p>
                            <p className="font-medium text-gray-900 dark:text-gray-100">{s.employee_name || "-"}</p>
                          </div>
                          <div>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("sales.quantity")}</p>
                            <p className="font-medium text-gray-900 dark:text-gray-100">{s.quantity}</p>
                          </div>
                          <div>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400">{t("sales.unit_price")}</p>
                            <p className="font-medium text-gray-900 dark:text-gray-100">{fmtMoney(s.unit_price)}</p>
                          </div>
                          <div className="col-span-2 flex items-center justify-end gap-2 pt-1 border-t border-gray-200 dark:border-slate-800">
                            {hasPermission("sales.edit") && (
                              <Button size="sm" variant="outline" onClick={() => openEdit(s)}>
                                <Edit2 className="h-3.5 w-3.5" /> {t("common.edit")}
                              </Button>
                            )}
                            {hasPermission("sales.delete") && (
                              <Button size="sm" variant="destructive" onClick={() => { setDeleting(s); confirmDelete(); }}>
                                <Trash2 className="h-3.5 w-3.5" /> {t("common.delete")}
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {sales.length === 0 && (
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
              className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white dark:bg-slate-900 p-5 sm:p-6"
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
                    <select value={modalHouse} onChange={(e) => setModalHouse(e.target.value)} className={inputCls}>
                      <option value="">{t("common.select_house")}</option>
                      {accessibleHouses.map((h) => (
                        <option key={h.id} value={h.id}>{h.name} ({h.code})</option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className={labelCls}>{t("sales.product")}</label>
                  <select value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })} className={inputCls}>
                    <option value="">{t("sales.select_product")}</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.product_name} ({p.product_code})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>{t("sales.source")}</label>
                  <select value={form.source_type} onChange={(e) => setForm({ ...form, source_type: e.target.value, employee_id: "" })} className={inputCls}>
                    <option value="warehouse">{t("sales.warehouse")}</option>
                    <option value="rso">{t("sales.rso")}</option>
                  </select>
                </div>
                {form.source_type === "rso" && (
                  <div>
                    <label className={labelCls}>{t("sales.employee")}</label>
                    <select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })} className={inputCls}>
                      <option value="">{t("sales.select_employee")}</option>
                      {employees.map((e) => (
                        <option key={e.id} value={e.id}>{e.name} {e.employee_id ? `(${e.employee_id})` : ""}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>{t("sales.quantity")}</label>
                    <input type="number" min={1} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>{t("sales.unit_price")}</label>
                    <input type="number" min={0} step="0.01" value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: e.target.value })} className={inputCls} />
                  </div>
                </div>
                <div>
                  <label className={labelCls}>{t("sales.sale_date")}</label>
                  <input type="date" value={form.sale_date} onChange={(e) => setForm({ ...form, sale_date: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>{t("sales.notes")}</label>
                  <input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputCls} />
                </div>
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
