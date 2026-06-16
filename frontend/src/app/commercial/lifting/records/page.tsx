"use client";

import { Fragment, useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { toast } from "react-hot-toast";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { Loader2, ClipboardList, Search, ChevronDown, ChevronUp, Plus, X, Filter } from "lucide-react";
import { cn } from "@/lib/utils";

type House = {
    id: number;
    name: string;
    code: string;
    display_name: string;
};

type LiftingProduct = {
    id: number;
    product_code: string;
    product_name: string;
    quantity: number;
    unit_price: number;
    total_price: number;
};

type LiftingRecord = {
    id: number;
    house_id: number;
    lifting_date: string;
    payment_method: string;
    total_bank_deposit: number;
    total_lifting_amount: number;
    remaining_amount: number;
    itopup_amount: number;
    status: string;
    notes: string | null;
    house: House | null;
    products: LiftingProduct[];
};

function getMonthRange() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const from = `${y}-${m}-01`;
    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
    const to = `${y}-${m}-${String(lastDay).padStart(2, "0")}`;
    return { from, to };
}

const statusColors: Record<string, string> = {
    Confirmed: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
    Approved: "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",
    Draft: "bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-gray-300",
    Cancelled: "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300",
};

export default function LiftingRecordsPage() {
    const router = useRouter();
    const { hasPermission, loading: authLoading } = useAuth();
    const { t } = useLanguage();

    const [records, setRecords] = useState<LiftingRecord[]>([]);
    const [loading, setLoading] = useState(true);

    const [houses, setHouses] = useState<House[]>([]);
    const [houseId, setHouseId] = useState<number | "">("");
    const [dateFrom, setDateFrom] = useState(getMonthRange().from);
    const [dateTo, setDateTo] = useState(getMonthRange().to);
    const [statusFilter, setStatusFilter] = useState("");
    const [search, setSearch] = useState("");

    const [expandedId, setExpandedId] = useState<number | null>(null);

    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const searchRef = useRef("");
    const fetchingRef = useRef(false);

    const fetchHouses = async () => {
        try {
            const res = await apiClient.get("houses/accessible");
            setHouses(res.data);
        } catch { }
    };

    const fetchRecords = useCallback(async (overrides?: { search?: string; silent?: boolean }) => {
        if (fetchingRef.current) return;
        fetchingRef.current = true;
        setLoading(true);
        try {
            const params: Record<string, any> = {
                limit: 10,
                offset: 0,
            };
            if (houseId) params.house_id = houseId;
            if (dateFrom) params.date_from = dateFrom;
            if (dateTo) params.date_to = dateTo;
            if (statusFilter) params.status = statusFilter;
            const s = overrides?.search !== undefined ? overrides.search : search;
            if (s.trim()) params.search = s.trim();

            const res = await apiClient.get("lifting", { params });
            setRecords(res.data);
        } catch (err: any) {
            if (!overrides?.silent) {
                toast.error(err?.response?.data?.detail || t("common.error"));
            }
        } finally {
            setLoading(false);
            fetchingRef.current = false;
        }
    }, [houseId, dateFrom, dateTo, statusFilter, search, t]);

    useEffect(() => {
        if (!authLoading && hasPermission("lifting.view")) {
            fetchHouses();
            fetchRecords({ silent: true });
        }
    }, [authLoading]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleSearchChange = (value: string) => {
        setSearch(value);
        searchRef.current = value;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            if (fetchingRef.current) return;
            fetchingRef.current = true;
            const params: Record<string, any> = { limit: 10, offset: 0 };
            if (houseId) params.house_id = houseId;
            if (dateFrom) params.date_from = dateFrom;
            if (dateTo) params.date_to = dateTo;
            if (statusFilter) params.status = statusFilter;
            if (searchRef.current.trim()) params.search = searchRef.current.trim();

            setLoading(true);
            apiClient.get("lifting", { params }).then((res) => {
                setRecords(res.data);
            }).catch((err) => {
                toast.error(err?.response?.data?.detail || t("common.error"));
            }).finally(() => {
                setLoading(false);
                fetchingRef.current = false;
            });
        }, 400);
    };

    const handleViewDetail = (recordId: number) => {
        setExpandedId((prev) => (prev === recordId ? null : recordId));
    };

    const formatNumber = (n: number) =>
        n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const formatDate = (dateStr: string) => {
        const d = new Date(dateStr + "T00:00:00");
        return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    };

    const activeFilterCount = [houseId, dateFrom, dateTo, statusFilter, search.trim()].filter(Boolean).length;

    const activeFilterChips: { label: string; onRemove: () => void }[] = [];
    const selectedHouse = houses.find((h) => h.id === houseId);
    if (selectedHouse) activeFilterChips.push({ label: `House: ${selectedHouse.display_name}`, onRemove: () => setHouseId("") });
    if (dateFrom) activeFilterChips.push({ label: `From: ${dateFrom}`, onRemove: () => setDateFrom("") });
    if (dateTo) activeFilterChips.push({ label: `To: ${dateTo}`, onRemove: () => setDateTo("") });
    if (statusFilter) activeFilterChips.push({ label: `Status: ${statusFilter}`, onRemove: () => setStatusFilter("") });
    if (search.trim()) activeFilterChips.push({ label: `Search: "${search.trim()}"`, onRemove: () => { setSearch(""); searchRef.current = ""; fetchRecords({ search: "", silent: true }); } });

    if (authLoading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
            </div>
        );
    }

    if (!hasPermission("lifting.view")) {
        return <AccessDenied />;
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-primary-50 text-primary-600 shadow-sm">
                            <ClipboardList className="w-5 h-5" />
                        </div>
                        Liftings
                    </h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 ml-1">
                        View and filter historical lifting records.
                    </p>
                </div>
                <button
                    onClick={() => router.push("/commercial/lifting")}
                    className="shrink-0 px-4 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 transition-colors flex items-center gap-2 shadow-sm"
                >
                    <Plus className="w-4 h-4" />
                    Create Lifting
                </button>
            </div>

            {/* Filters */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="px-5 py-3.5 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                        <div className={cn(
                            "p-1.5 rounded-lg transition-colors",
                            activeFilterCount > 0
                                ? "bg-primary-100 dark:bg-primary-500/15 text-primary-600"
                                : "bg-gray-100 dark:bg-slate-800 text-gray-400"
                        )}>
                            <Filter className="w-3.5 h-3.5" />
                        </div>
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Filters</span>
                        {activeFilterCount > 0 && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-primary-100 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300">
                                {activeFilterCount}
                            </span>
                        )}
                    </div>
                    {activeFilterCount > 0 && (
                        <button
                            onClick={() => {
                                setHouseId("");
                                setDateFrom("");
                                setDateTo("");
                                setStatusFilter("");
                                setSearch("");
                                searchRef.current = "";
                                setExpandedId(null);
                                fetchRecords({ search: "", silent: true });
                            }}
                            className="text-[11px] font-semibold text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors flex items-center gap-1"
                        >
                            <X className="w-3 h-3" />
                            Clear all
                        </button>
                    )}
                </div>
                <div className="p-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
                        <div>
                            <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                                House
                            </label>
                            <select
                                value={houseId}
                                onChange={(e) => setHouseId(e.target.value ? Number(e.target.value) : "")}
                                className="w-full px-3 py-[9px] rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50 text-sm text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all"
                            >
                                <option value="">All Houses</option>
                                {houses.map((h) => (
                                    <option key={h.id} value={h.id}>{h.display_name}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                                From Date
                            </label>
                            <input
                                type="date"
                                value={dateFrom}
                                onChange={(e) => setDateFrom(e.target.value)}
                                className="w-full px-3 py-[9px] rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50 text-sm text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all"
                            />
                        </div>
                        <div>
                            <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                                To Date
                            </label>
                            <input
                                type="date"
                                value={dateTo}
                                onChange={(e) => setDateTo(e.target.value)}
                                className="w-full px-3 py-[9px] rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50 text-sm text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all"
                            />
                        </div>
                        <div>
                            <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                                Status
                            </label>
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                                className="w-full px-3 py-[9px] rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50 text-sm text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all"
                            >
                                <option value="">All Statuses</option>
                                <option value="Draft">Draft</option>
                                <option value="Confirmed">Confirmed</option>
                                <option value="Approved">Approved</option>
                                <option value="Cancelled">Cancelled</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                                Search
                            </label>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                                <input
                                    type="text"
                                    value={search}
                                    onChange={(e) => handleSearchChange(e.target.value)}
                                    placeholder="Product, code or notes..."
                                    className="w-full pl-9 pr-8 py-[9px] rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50 text-sm text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all placeholder:text-gray-400"
                                />
                                {search && (
                                    <button
                                        onClick={() => { setSearch(""); searchRef.current = ""; fetchRecords({ search: "", silent: true }); }}
                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="mt-4 flex items-center gap-2.5">
                        <button
                            onClick={() => fetchRecords({ silent: false })}
                            className="px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 transition-all shadow-sm hover:shadow-md active:scale-[0.98] flex items-center gap-1.5"
                        >
                            <Search className="w-3.5 h-3.5" />
                            Search
                        </button>
                        <button
                            onClick={() => {
                                setHouseId("");
                                setDateFrom("");
                                setDateTo("");
                                setStatusFilter("");
                                setSearch("");
                                searchRef.current = "";
                                setExpandedId(null);
                                fetchRecords({ search: "", silent: true });
                            }}
                            className="px-4 py-2 rounded-xl border border-gray-200 dark:border-slate-700 text-sm font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800/50 hover:text-gray-700 dark:hover:text-gray-300 transition-all active:scale-[0.98]"
                        >
                            Reset
                        </button>
                    </div>

                    {/* Active filter chips */}
                    {activeFilterChips.length > 0 && (
                        <div className="mt-4 flex flex-wrap items-center gap-1.5 pt-4 border-t border-gray-100 dark:border-slate-800">
                            {activeFilterChips.map((chip, i) => (
                                <span
                                    key={i}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-primary-300 text-[11px] font-semibold border border-primary-200/50 dark:border-primary-500/20"
                                >
                                    {chip.label}
                                    <button onClick={chip.onRemove} className="hover:bg-primary-200 dark:hover:bg-primary-500/20 rounded-full p-0.5 transition-colors">
                                        <X className="w-3 h-3" />
                                    </button>
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Records Table */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
                {loading ? (
                    <div className="flex items-center justify-center py-16">
                        <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
                    </div>
                ) : records.length === 0 ? (
                    <div className="px-6 py-16 text-center">
                        <p className="text-gray-400 dark:text-gray-500 text-sm">No lifting records found</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/30">
                                    <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 w-8"></th>
                                    <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Date</th>
                                    <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">House</th>
                                    <th className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Payment</th>
                                    <th className="text-right px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Bank Deposit</th>
                                    <th className="text-right px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Total Lifting</th>
                                    <th className="text-right px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">iTopUp</th>
                                    <th className="text-center px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Status</th>
                                    <th className="text-right px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Items</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50 dark:divide-slate-800/50">
                                {records.map((r) => (
                                    <Fragment key={r.id}>
                                        <tr
                                            className="hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition-colors cursor-pointer"
                                            onClick={() => handleViewDetail(r.id)}
                                        >
                                            <td className="px-4 py-3">
                                                {expandedId === r.id ? (
                                                    <ChevronUp className="w-4 h-4 text-gray-400" />
                                                ) : (
                                                    <ChevronDown className="w-4 h-4 text-gray-400" />
                                                )}
                                            </td>
                                            <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
                                                {formatDate(r.lifting_date)}
                                            </td>
                                            <td className="px-4 py-3 font-semibold text-gray-900 dark:text-gray-100">
                                                {r.house?.display_name || r.house?.name || `House #${r.house_id}`}
                                            </td>
                                            <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                                                {r.payment_method}
                                            </td>
                                            <td className="px-4 py-3 text-right font-mono text-sm text-gray-700 dark:text-gray-300">
                                                {formatNumber(r.total_bank_deposit)}
                                            </td>
                                            <td className="px-4 py-3 text-right font-mono text-sm text-gray-700 dark:text-gray-300">
                                                {formatNumber(r.total_lifting_amount)}
                                            </td>
                                            <td className="px-4 py-3 text-right font-mono text-sm text-gray-700 dark:text-gray-300">
                                                {formatNumber(r.itopup_amount)}
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <span
                                                    className={cn(
                                                        "inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold",
                                                        statusColors[r.status] || "bg-gray-100 text-gray-500"
                                                    )}
                                                >
                                                    {r.status}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-right font-mono text-sm text-gray-600 dark:text-gray-400">
                                                {r.products.length}
                                            </td>
                                        </tr>
                                        {expandedId === r.id && (
                                            <tr>
                                                <td colSpan={9} className="px-6 py-4 bg-gray-50/50 dark:bg-slate-800/20">
                                                    {r.notes && (
                                                        <div className="mb-3 text-sm text-gray-500 dark:text-gray-400">
                                                            <span className="font-semibold text-gray-700 dark:text-gray-300">Notes:</span> {r.notes}
                                                        </div>
                                                    )}
                                                    <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-slate-800">
                                                        <table className="w-full text-sm">
                                                            <thead>
                                                                <tr className="bg-gray-100/70 dark:bg-slate-800/50">
                                                                    <th className="text-left px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Code</th>
                                                                    <th className="text-left px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Name</th>
                                                                    <th className="text-right px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Qty</th>
                                                                    <th className="text-right px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Unit Price</th>
                                                                    <th className="text-right px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Total</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody className="divide-y divide-gray-50 dark:divide-slate-800/50">
                                                                {r.products.map((p) => (
                                                                    <tr key={p.id} className="bg-white/50 dark:bg-transparent">
                                                                        <td className="px-4 py-2 font-mono text-xs text-gray-600 dark:text-gray-400">{p.product_code}</td>
                                                                        <td className="px-4 py-2 font-semibold text-gray-900 dark:text-gray-100">{p.product_name}</td>
                                                                        <td className="px-4 py-2 text-right font-mono text-sm text-gray-700 dark:text-gray-300">{p.quantity}</td>
                                                                        <td className="px-4 py-2 text-right font-mono text-sm text-gray-700 dark:text-gray-300">{formatNumber(p.unit_price)}</td>
                                                                        <td className="px-4 py-2 text-right font-mono text-sm text-gray-700 dark:text-gray-300">{formatNumber(p.total_price)}</td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </Fragment>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}


