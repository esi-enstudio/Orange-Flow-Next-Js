"use client";

import { Fragment, useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { toast } from "react-hot-toast";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import { Loader2, ClipboardList, Search, ChevronDown, ChevronUp, Plus, X, Filter, Download, FileText, Trash2, Eye, Upload, Pencil, BarChart3, Wallet, Landmark, Package, Coins, CreditCard, Smartphone, Cpu, Boxes } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatLiftingAmount, formatPrice } from "@/lib/price";
import ImageLightbox from "@/components/ui/ImageLightbox";
import PageGuideModal from "@/components/PageGuideModal";
import PullPreRFModal, { PullBank } from "./_components/PullPreRFModal";
import { DateRangePicker } from "@/components/date-picker";
import type { DateRangeValue } from "@/components/date-picker/utils";

function compressImage(file: File, maxWidth = 1200, maxHeight = 1200, quality = 0.75): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement("canvas");
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width = Math.round((width * maxHeight) / height);
                        height = maxHeight;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext("2d");
                if (!ctx) {
                    reject(new Error("Failed to get canvas context"));
                    return;
                }
                ctx.drawImage(img, 0, 0, width, height);
                const dataUrl = canvas.toDataURL("image/jpeg", quality);
                resolve(dataUrl);
            };
            img.onerror = (err) => reject(err);
            img.src = e.target?.result as string;
        };
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(file);
    });
}

type House = {
    id: number;
    name: string;
    code: string;
    display_name: string;
    show_pull_button?: boolean;
};

type Product = {
    id: number;
    product_code: string;
    category: string;
    subcategory: string | null;
    product_name: string;
    mrp: number;
    dd_lifting_price: number;
    ret_lifting_price: number;
    status: string;
};

type SelectedProduct = {
    product: Product;
    quantity: number;
};

type LiftingProduct = {
    id: number;
    product_id: number;
    product_code: string;
    product_name: string;
    quantity: number;
    unit_price: number;
    total_price: number;
    /** Present on the list responses — carries the product's category. */
    product?: { category?: string | null } | null;
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
    deposit_slip?: string | null;
    bank_id?: number | null;
    bank_name?: string | null;
    pull_status?: string | null;
    pull_rf_code?: string | null;
    pull_message?: string | null;
    pull_requested_at?: string | null;
    pull_completed_at?: string | null;
    created_at?: string | null;
    house: House | null;
    products: LiftingProduct[];
};

type LiftingSummaryCategory = {
    category: string;
    quantity: number;
    amount: number;
    // Absent on responses from a backend that predates the MRP addition.
    mrp_amount?: number;
};

type LiftingSummary = {
    total_records: number;
    total_bank_deposit: number;
    total_lifting_amount: number;
    total_itopup: number;
    total_remaining: number;
    total_quantity: number;
    categories: LiftingSummaryCategory[];
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

// Static class strings (never built dynamically) so Tailwind keeps them in the bundle.
const summaryTones: Record<string, string> = {
    amber: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400",
    blue: "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400",
    emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400",
    violet: "bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400",
    rose: "bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400",
    slate: "bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-gray-300",
};

function categoryStyle(category: string) {
    const c = category.toLowerCase();
    if (c.includes("scratch")) return { icon: CreditCard, tone: "rose" };
    if (c.includes("sim")) return { icon: Smartphone, tone: "blue" };
    if (c.includes("device")) return { icon: Cpu, tone: "violet" };
    if (c.includes("box") || c.includes("other")) return { icon: Boxes, tone: "slate" };
    return { icon: Package, tone: "amber" };
}

export default function LiftingRecordsPage() {
    const router = useRouter();
    const { user, hasPermission, loading: authLoading } = useAuth();
    const { t } = useLanguage();

    const isAdmin = useMemo(() => {
        if (!user?.roles) return false;
        return user.roles.some((r) => {
            const name = r.name.toLowerCase();
            return name === "admin" || name === "super admin" || name === "super_admin" || name === "manager" || name === "house manager" || name === "house_manager";
        });
    }, [user]);

    const isStrictAdmin = useMemo(() => {
        if (!user?.roles) return false;
        return user.roles.some((r) => {
            const name = r.name.toLowerCase();
            return name === "admin" || name === "super admin" || name === "super_admin";
        });
    }, [user]);

    const isEditable = (r: LiftingRecord) => {
        if (isAdmin) return true;
        if (!r.created_at) return true;
        const createdTime = new Date(r.created_at).getTime();
        const now = new Date().getTime();
        return (now - createdTime) < 3600 * 1000;
    };

    const [records, setRecords] = useState<LiftingRecord[]>([]);
    const [summary, setSummary] = useState<LiftingSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [printing, setPrinting] = useState(false);

    const [houses, setHouses] = useState<House[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [banks, setBanks] = useState<PullBank[]>([]);
    const [houseId, setHouseId] = useState<number | "">("");
    const monthRange = getMonthRange();
    const [dateRange, setDateRange] = useState<DateRangeValue>({ from: monthRange.from, to: monthRange.to });
    const [statusFilter, setStatusFilter] = useState("");
    const [search, setSearch] = useState("");

    const [expandedId, setExpandedId] = useState<number | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<LiftingRecord | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [hasSearched, setHasSearched] = useState(false);

    const [editTarget, setEditTarget] = useState<LiftingRecord | null>(null);
    const [editBankDeposit, setEditBankDeposit] = useState("");
    const [editBankId, setEditBankId] = useState<string>("");
    const [editNotes, setEditNotes] = useState("");
    const [editStatus, setEditStatus] = useState("Confirmed");
    const [editDepositSlip, setEditDepositSlip] = useState<string | null>(null);
    const [editSelectedProducts, setEditSelectedProducts] = useState<SelectedProduct[]>([]);
    const [editProductSearch, setEditProductSearch] = useState("");
    const [editCompressing, setEditCompressing] = useState(false);
    const [editLoading, setEditLoading] = useState(false);
    const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
    const [pullTarget, setPullTarget] = useState<LiftingRecord | null>(null);

    const openEditModal = (r: LiftingRecord) => {
        setEditTarget(r);
        setEditBankDeposit(String(r.total_bank_deposit ?? 0));
        setEditBankId(r.bank_id ? String(r.bank_id) : "");
        setEditNotes(r.notes || "");
        setEditStatus(r.status || "Confirmed");
        setEditDepositSlip(r.deposit_slip || null);
        setEditSelectedProducts(
            r.products.map((p) => {
                const found = products.find((prod) => prod.id === p.product_id);
                const productObj: Product = found || {
                    id: p.product_id,
                    product_code: p.product_code,
                    category: p.product?.category || "General",
                    subcategory: null,
                    product_name: p.product_name,
                    mrp: 0,
                    dd_lifting_price: p.unit_price,
                    ret_lifting_price: 0,
                    status: "Active",
                };
                return {
                    product: productObj,
                    quantity: p.quantity,
                };
            })
        );
        setEditProductSearch("");
    };

    const handleUpdate = async () => {
        if (!editTarget) return;
        setEditLoading(true);
        try {
            await apiClient.patch(`lifting/${editTarget.id}`, {
                total_bank_deposit: Number(editBankDeposit || 0),
                notes: editNotes.trim() || null,
                status: editStatus,
                deposit_slip: editDepositSlip,
                bank_id: editBankId ? Number(editBankId) : null,
                products: editSelectedProducts.map((sp) => ({
                    product_id: sp.product.id,
                    quantity: sp.quantity,
                })),
            });
            toast.success("Lifting record updated successfully");
            setEditTarget(null);
            fetchRecords({ silent: true });
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || "Failed to update lifting record");
        } finally {
            setEditLoading(false);
        }
    };

    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const searchRef = useRef("");
    const fetchingRef = useRef(false);

    const fetchHouses = async () => {
        try {
            const res = await apiClient.get("houses/accessible");
            setHouses(res.data);
        } catch { }
    };

    const fetchBanks = async () => {
        try {
            const res = await apiClient.get("lifting/pull/options");
            setBanks(res.data?.banks || []);
        } catch { }
    };

    const fetchRecords = useCallback(async (overrides?: { search?: string; silent?: boolean }) => {
        if (fetchingRef.current) return;
        fetchingRef.current = true;
        setLoading(true);
        try {
            const s = overrides?.search !== undefined ? overrides.search : search;
            const params: Record<string, any> = {
                limit: 10,
                offset: 0,
            };
            if (houseId) params.house_id = houseId;
            if (dateRange.from) params.date_from = dateRange.from;
            if (dateRange.to) params.date_to = dateRange.to;
            if (statusFilter) params.status = statusFilter;
            if (s.trim()) params.search = s.trim();

            const summaryParams: Record<string, any> = { ...params };
            delete summaryParams.limit;
            delete summaryParams.offset;

            // The summary is an add-on: if it is unavailable the record list must keep working.
            const [recordsRes, summaryRes] = await Promise.all([
                apiClient.get("lifting", { params }),
                apiClient.get("lifting/summary", { params: summaryParams }).catch(() => null),
            ]);
            setRecords(recordsRes.data);
            setSummary(summaryRes?.data?.data ?? null);
        } catch (err: any) {
            if (!overrides?.silent) {
                toast.error(err?.response?.data?.detail || t("common.error"));
            }
        } finally {
            setLoading(false);
            fetchingRef.current = false;
        }
    }, [houseId, dateRange.from, dateRange.to, statusFilter, search, t]);

    const statementParams = () => {
        const params: Record<string, any> = {};
        if (houseId) params.house_id = houseId;
        if (dateRange.from) params.date_from = dateRange.from;
        if (dateRange.to) params.date_to = dateRange.to;
        if (statusFilter) params.status = statusFilter;
        if (search.trim()) params.search = search.trim();
        return params;
    };

    const handleStatement = async () => {
        setPrinting(true);
        try {
            const res = await apiClient.get("lifting/statement", {
                params: statementParams(),
                responseType: "blob",
            });
            const url = window.URL.createObjectURL(
                new Blob([res.data], { type: "application/pdf" })
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = `lifting_statement_${dateRange.from || "start"}_${dateRange.to || "end"}.pdf`;
            a.click();
            window.URL.revokeObjectURL(url);
            toast.success(t("liftings.statement.success"));
        } catch (err: any) {
            // Error bodies arrive as a Blob because of responseType: "blob".
            let message = t("common.error");
            const data = err?.response?.data;
            if (data instanceof Blob) {
                try {
                    const parsed = JSON.parse(await data.text());
                    message = parsed?.detail || parsed?.error?.message || message;
                } catch {
                    /* keep the generic message */
                }
            } else if (data?.detail) {
                message = data.detail;
            }
            toast.error(message);
        } finally {
            setPrinting(false);
        }
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        try {
            await apiClient.delete(`lifting/${deleteTarget.id}`);
            toast.success("Lifting record deleted");
            setDeleteTarget(null);
            setExpandedId(null);
            fetchRecords({ silent: true });
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || t("common.error"));
        } finally {
            setDeleting(false);
        }
    };

    const handlePull = (record: LiftingRecord) => {
        setPullTarget(record);
    };

    const pullBadge = (r: LiftingRecord, withStop = false) => {
        if (!r.house?.show_pull_button || !hasPermission("lifting.pull")) return null;

        const running = r.pull_status === "running";
        const submitted = r.pull_status === "submitted";
        const blocked = r.pull_status === "blocked";
        const failed = r.pull_status === "failed";
        const disabled = running || submitted;

        let tone =
            "border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100 dark:border-primary-500/30 dark:bg-primary-500/10 dark:text-primary-300 dark:hover:bg-primary-500/20";
        if (submitted) {
            tone = "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300";
        } else if (blocked) {
            tone = "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300";
        } else if (failed) {
            tone = "border-red-200 bg-red-50 text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300";
        }

        const title = running
            ? t("liftings.pull.running_title")
            : submitted
              ? t("liftings.pull.already_submitted")
              : blocked
                ? t("liftings.pull.status_blocked")
                : failed
                  ? t("liftings.pull.status_failed")
                  : t("liftings.pull.title");

        return (
            <button
                type="button"
                onClick={(e) => {
                    if (withStop) e.stopPropagation();
                    if (disabled) return;
                    handlePull(r);
                }}
                disabled={disabled}
                className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide transition-colors",
                    tone,
                    disabled ? "cursor-not-allowed opacity-80" : "cursor-pointer"
                )}
                title={r.pull_rf_code ? `${title} • ${r.pull_rf_code}` : title}
                aria-label={title}
            >
                {running && <Loader2 className="w-3 h-3 animate-spin" />}
                {t("liftings.pull.button")}
                {submitted && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                {blocked && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />}
                {failed && <span className="w-1.5 h-1.5 rounded-full bg-red-500" />}
            </button>
        );
    };

    useEffect(() => {
        if (!authLoading && hasPermission("lifting.view")) {
            fetchHouses();
            fetchBanks();
        }
    }, [authLoading]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleSearchChange = (value: string) => {
        setSearch(value);
        searchRef.current = value;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            fetchRecords({ search: value, silent: true });
        }, 400);
    };

    const handleViewDetail = (recordId: number) => {
        setExpandedId((prev) => (prev === recordId ? null : recordId));
    };

    // Lifting money: two decimals, and up to four when a scratch-card price
    // carries them — the same precision the prices are stored and added up with.
    const formatNumber = (n: number) => formatLiftingAmount(n);

    const formatDate = (dateStr: string) => {
        const d = new Date(dateStr + "T00:00:00");
        return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    };

    // Product categories come from the database; translate the known ones and fall
    // back to the stored value for any custom category.
    const categoryLabel = (category: string) => {
        const key = `liftings.summary.categories.${category.toLowerCase().replace(/\s+/g, "_")}`;
        const label = t(key);
        return label === key ? category : label;
    };

    const activeFilterCount = [houseId, dateRange.from || dateRange.to ? true : false, statusFilter, search.trim()].filter(Boolean).length;

    const activeFilterChips: { label: string; onRemove: () => void }[] = [];
    const selectedHouse = houses.find((h) => h.id === houseId);
    if (selectedHouse) activeFilterChips.push({ label: `House: ${selectedHouse.display_name}`, onRemove: () => setHouseId("") });
    if (dateRange.from || dateRange.to) {
        activeFilterChips.push({
            label: `Date: ${dateRange.from || "..."} - ${dateRange.to || "..."}`,
            onRemove: () => setDateRange({ from: null, to: null }),
        });
    }
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
        <div className="space-y-4 sm:space-y-6 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div className="min-w-0">
                    <div className="flex items-center gap-2.5">
                        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-2.5 sm:gap-3">
                            <div className="p-2 rounded-xl bg-primary-50 text-primary-600 shadow-sm">
                                <ClipboardList className="w-5 h-5" />
                            </div>
                            {t("liftings.title")}
                        </h1>
                        <PageGuideModal pageKey="liftings" />
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 ml-1">
                        {t("liftings.subtitle")}
                    </p>
                </div>
                <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-2.5 sm:shrink-0">
                    <button
                        onClick={handleStatement}
                        disabled={printing || loading || !hasSearched}
                        className="w-full sm:w-auto justify-center px-4 py-2.5 bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30 rounded-xl text-sm font-semibold hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors flex items-center gap-2 shadow-sm cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        {printing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                        {t("liftings.statement.button")}
                    </button>
                    <button
                        onClick={() => router.push("/liftings/create")}
                        className="w-full sm:w-auto justify-center shrink-0 px-4 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 transition-colors flex items-center gap-2 shadow-sm"
                    >
                        <Plus className="w-4 h-4" />
                        {t("liftings.create")}
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="px-3.5 py-3 sm:px-5 sm:py-3.5 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between">
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
                                setDateRange({ from: null, to: null });
                                setStatusFilter("");
                                setSearch("");
                                searchRef.current = "";
                                setExpandedId(null);
                                setHasSearched(false);
                                setRecords([]);
                                setSummary(null);
                            }}
                            className="text-[11px] font-semibold text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors flex items-center gap-1"
                        >
                            <X className="w-3 h-3" />
                            Clear all
                        </button>
                    )}
                </div>
                <div className="p-3.5 sm:p-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-3.5">
                        <div>
                            <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                                House
                            </label>
                            <select
                                value={houseId}
                                onChange={(e) => setHouseId(e.target.value ? Number(e.target.value) : "")}
                                className="w-full px-3 py-[9px] rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all"
                            >
                                <option value="">Select House</option>
                                {houses.map((h) => (
                                    <option key={h.id} value={h.id}>{h.display_name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="sm:col-span-2">
                            <DateRangePicker
                                label="Date Range"
                                value={dateRange}
                                onChange={setDateRange}
                                placeholder="Select date range"
                            />
                        </div>
                        <div>
                            <label className="block text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                                Status
                            </label>
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                                className="w-full px-3 py-[9px] rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all"
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
                                    className="w-full pl-9 pr-8 py-[9px] rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 transition-all placeholder:text-gray-400"
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
                    <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:items-center">
                        <button
                            onClick={() => {
                                if (!houseId) {
                                    toast.error("Please select a house");
                                    return;
                                }
                                if (!dateRange.from || !dateRange.to) {
                                    toast.error("Please select date range");
                                    return;
                                }
                                setHasSearched(true);
                                fetchRecords({ silent: false });
                            }}
                            className="w-full sm:w-auto justify-center px-4 py-2 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 transition-all shadow-sm hover:shadow-md active:scale-[0.98] flex items-center gap-1.5"
                        >
                            <Search className="w-3.5 h-3.5" />
                            Search
                        </button>
                        <button
                            onClick={() => {
                                setHouseId("");
                                setDateRange({ from: null, to: null });
                                setStatusFilter("");
                                setSearch("");
                                searchRef.current = "";
                                setExpandedId(null);
                                setHasSearched(false);
                                setRecords([]);
                                setSummary(null);
                            }}
                            className="w-full sm:w-auto justify-center px-4 py-2 rounded-xl border border-gray-200 dark:border-slate-700 text-sm font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800/50 hover:text-gray-700 dark:hover:text-gray-300 transition-all active:scale-[0.98]"
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

            {/* Filtered Summary */}
            {hasSearched && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="px-3.5 py-3 sm:px-5 sm:py-3.5 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <div className="p-1.5 rounded-lg bg-primary-100 dark:bg-primary-500/15 text-primary-600 shrink-0">
                            <BarChart3 className="w-3.5 h-3.5" />
                        </div>
                        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 truncate">
                            {t("liftings.summary.title")}
                        </span>
                    </div>
                    {!loading && summary && summary.total_records > 0 && (
                        <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-primary-300">
                                {t("liftings.summary.records", { count: summary.total_records })}
                            </span>
                            <span className="hidden sm:inline-flex text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300">
                                {t("liftings.summary.items", { count: summary.total_quantity })}
                            </span>
                        </div>
                    )}
                </div>

                {loading ? (
                    <div className="p-3.5 sm:p-5 space-y-4">
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-3.5">
                            {Array.from({ length: 4 }).map((_, i) => (
                                <div key={i} className="rounded-xl border border-gray-100 dark:border-slate-800 p-3.5 flex items-center gap-3 animate-pulse">
                                    <div className="w-9 h-9 rounded-lg bg-gray-200 dark:bg-slate-700 shrink-0" />
                                    <div className="space-y-2 flex-1 min-w-0">
                                        <div className="h-2.5 w-20 bg-gray-200 dark:bg-slate-700 rounded-md" />
                                        <div className="h-3.5 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="pt-4 border-t border-gray-100 dark:border-slate-800 grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-3.5">
                            {Array.from({ length: 4 }).map((_, i) => (
                                <div key={i} className="rounded-xl border border-gray-100 dark:border-slate-800 p-3.5 animate-pulse space-y-2">
                                    <div className="h-2.5 w-16 bg-gray-200 dark:bg-slate-700 rounded-md" />
                                    <div className="h-3.5 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
                                    <div className="h-2.5 w-14 bg-gray-100 dark:bg-slate-800 rounded-md" />
                                </div>
                            ))}
                        </div>
                    </div>
                ) : !summary ? (
                    <p className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
                        {t("liftings.summary.unavailable")}
                    </p>
                ) : summary.total_records === 0 ? (
                    <p className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
                        {t("liftings.summary.no_data")}
                    </p>
                ) : (
                    <div className="p-3.5 sm:p-5 space-y-4">
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-3.5">
                            {[
                                { key: "itopup", label: t("liftings.summary.total_itopup"), value: formatNumber(summary.total_itopup), icon: Wallet, tone: "amber" },
                                { key: "deposit", label: t("liftings.summary.total_bank_deposit"), value: formatNumber(summary.total_bank_deposit), icon: Landmark, tone: "blue" },
                                { key: "lifting", label: t("liftings.summary.total_lifting"), value: formatNumber(summary.total_lifting_amount), icon: Package, tone: "emerald" },
                                { key: "remaining", label: t("liftings.summary.remaining"), value: formatNumber(summary.total_remaining), icon: Coins, tone: summary.total_remaining < 0 ? "rose" : "violet" },
                            ].map((metric) => {
                                const Icon = metric.icon;
                                const isNegative = metric.key === "remaining" && summary.total_remaining < 0;
                                return (
                                    <div
                                        key={metric.key}
                                        className="rounded-xl border border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/20 p-3.5 flex items-center gap-3 min-w-0"
                                    >
                                        <div className={cn("p-2.5 rounded-lg shrink-0", summaryTones[metric.tone])}>
                                            <Icon className="w-4 h-4" />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 truncate">{metric.label}</p>
                                            <p className={cn(
                                                "text-base sm:text-lg font-bold font-mono truncate",
                                                isNegative ? "text-rose-600 dark:text-rose-400" : "text-gray-900 dark:text-gray-100"
                                            )}>
                                                {metric.value}
                                            </p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {summary.categories.length > 0 && (
                            <div className="pt-4 border-t border-gray-100 dark:border-slate-800">
                                <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2.5">
                                    {t("liftings.summary.breakdown")}
                                </p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-3.5">
                                    {summary.categories.map((cat) => {
                                        const { icon: CategoryIcon, tone } = categoryStyle(cat.category);
                                        return (
                                            <div
                                                key={cat.category}
                                                className="rounded-xl border border-gray-100 dark:border-slate-800 p-3.5 flex items-center gap-3 min-w-0"
                                            >
                                                <div className={cn("p-2.5 rounded-lg shrink-0", summaryTones[tone])}>
                                                    <CategoryIcon className="w-4 h-4" />
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 truncate">
                                                        {categoryLabel(cat.category)}
                                                    </p>
                                                    <p className="text-base font-bold font-mono text-gray-900 dark:text-gray-100 truncate">
                                                        {formatNumber(cat.mrp_amount ?? cat.amount)}
                                                        <span className="ml-1.5 align-middle text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                                                            {t("liftings.summary.mrp")}
                                                        </span>
                                                    </p>
                                                    <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
                                                        {t("liftings.summary.lifting_value", { amount: formatNumber(cat.amount) })}
                                                    </p>
                                                    <p className="text-[11px] text-gray-400 dark:text-gray-500">
                                                        {t("liftings.summary.quantity", { count: cat.quantity })}
                                                    </p>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
            )}

            {/* Records Table / Accordion */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
                {!hasSearched ? (
                    <div className="px-4 py-12 text-center">
                        <p className="text-gray-400 dark:text-gray-500 text-sm">Please select House and Date Range, then click Search to view lifting records</p>
                    </div>
                ) : loading ? (
                    <div className="divide-y divide-gray-50 dark:divide-slate-800">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <div key={i} className="flex items-center gap-4 px-3.5 py-4 sm:px-4 animate-pulse">
                                <div className="w-10 h-10 rounded-xl bg-gray-200 dark:bg-slate-700 shrink-0" />
                                <div className="space-y-2 flex-1 min-w-0">
                                    <div className="h-3 w-32 bg-gray-200 dark:bg-slate-700 rounded-md" />
                                    <div className="h-2.5 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
                                </div>
                                <div className="hidden sm:block flex-1 space-y-2">
                                    <div className="h-3 w-20 bg-gray-200 dark:bg-slate-700 rounded-md" />
                                    <div className="h-2.5 w-16 bg-gray-100 dark:bg-slate-800 rounded-md" />
                                </div>
                                <div className="hidden sm:block w-16 h-3 bg-gray-200 dark:bg-slate-700 rounded-md" />
                            </div>
                        ))}
                    </div>
                ) : records.length === 0 ? (
                    <div className="px-4 py-12 text-center">
                        <p className="text-gray-400 dark:text-gray-500 text-sm">No lifting records found</p>
                    </div>
                ) : (
                    <>
                        {/* Desktop Table — lg+ */}
                        <div className="hidden lg:block overflow-x-auto scrollbar-custom">
                            <table className="w-full text-sm whitespace-nowrap">
                                <thead>
                                    <tr className="border-b border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/30">
                                        <th className="text-left px-2 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 w-8"></th>
                                        <th className="text-left px-2 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Date</th>
                                        <th className="text-left px-2 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">House</th>
                                        <th className="text-left px-2 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Payment</th>
                                        <th className="text-right px-2 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Bank Deposit</th>
                                        <th className="text-right px-2 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Total Lifting</th>
                                        <th className="text-right px-2 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">iTopUp</th>
                                        <th className="text-center px-2 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Status</th>
                                        <th className="text-right px-2 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Items</th>
                                        <th className="text-right px-2 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 w-14">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50 dark:divide-slate-800/50">
                                    {records.map((r) => (
                                        <Fragment key={r.id}>
                                            <tr
                                                className="hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition-colors cursor-pointer"
                                                onClick={() => handleViewDetail(r.id)}
                                            >
                                                <td className="px-2 py-1">
                                                    {expandedId === r.id ? (
                                                        <ChevronUp className="w-4 h-4 text-gray-400" />
                                                    ) : (
                                                        <ChevronDown className="w-4 h-4 text-gray-400" />
                                                    )}
                                                </td>
                                                <td className="px-2 py-1 font-mono text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
                                                    {formatDate(r.lifting_date)}
                                                </td>
                                                <td className="px-2 py-1 font-semibold text-gray-900 dark:text-gray-100">
                                                    {r.house?.display_name || r.house?.name || `House #${r.house_id}`}
                                                </td>
                                                <td className="px-2 py-1 text-gray-600 dark:text-gray-400">
                                                    {r.payment_method}
                                                </td>
                                                <td className="px-2 py-1 text-right font-mono text-sm text-gray-700 dark:text-gray-300">
                                                    {formatNumber(r.total_bank_deposit)}
                                                </td>
                                                <td className="px-2 py-1 text-right font-mono text-sm text-gray-700 dark:text-gray-300">
                                                    {formatNumber(r.total_lifting_amount)}
                                                </td>
                                                <td className="px-2 py-1 text-right font-mono text-sm text-gray-700 dark:text-gray-300">
                                                    <div className="flex items-center justify-end gap-1.5">
                                                        <span>{formatNumber(r.itopup_amount)}</span>
                                                        {pullBadge(r, true)}
                                                    </div>
                                                </td>
                                                <td className="px-2 py-1 text-center">
                                                    <span
                                                        className={cn(
                                                            "inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold",
                                                            statusColors[r.status] || "bg-gray-100 text-gray-500"
                                                        )}
                                                    >
                                                        {r.status}
                                                    </span>
                                                </td>
                                                <td className="px-2 py-1 text-right font-mono text-sm text-gray-600 dark:text-gray-400">
                                                    {r.products.length}
                                                </td>
                                                <td className="px-2 py-1 text-right whitespace-nowrap">
                                                    <div className="flex items-center justify-end gap-1">
                                                        {hasPermission("lifting.edit") && isEditable(r) && (
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); openEditModal(r); }}
                                                                className="p-1.5 rounded-lg text-gray-400 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/10 transition-all cursor-pointer"
                                                                title="Edit lifting record"
                                                            >
                                                                <Pencil className="w-4 h-4" />
                                                            </button>
                                                        )}
                                                        {hasPermission("lifting.delete") && (
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); setDeleteTarget(r); }}
                                                                className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all cursor-pointer"
                                                                title="Delete lifting record"
                                                            >
                                                                <Trash2 className="w-4 h-4" />
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                            {expandedId === r.id && (
                                                <tr>
                                                    <td colSpan={10} className="px-3 py-3 bg-gray-50/50 dark:bg-slate-800/20">
                                                        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                                                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
                                                                <span>
                                                                    <span className="font-semibold text-gray-700 dark:text-gray-300">{t("liftings.fields.bank_name")}:</span>{" "}
                                                                    {r.bank_name || "—"}
                                                                </span>
                                                                {r.pull_status === "submitted" && r.pull_rf_code && (
                                                                    <span>
                                                                        <span className="font-semibold text-gray-700 dark:text-gray-300">{t("liftings.pull.rf_code")}:</span>{" "}
                                                                        <span className="font-mono">{r.pull_rf_code}</span>
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {r.notes && (
                                                                <div className="text-sm text-gray-500 dark:text-gray-400">
                                                                    <span className="font-semibold text-gray-700 dark:text-gray-300">Notes:</span> {r.notes}
                                                                </div>
                                                            )}
                                                            {r.deposit_slip && (
                                                                <div className="flex items-center gap-2">
                                                                    <span className="font-semibold text-sm text-gray-700 dark:text-gray-300">Deposit Slip:</span>
                                                                    <button
                                                                        onClick={() => setLightboxUrl(r.deposit_slip!)}
                                                                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary-50 dark:bg-primary-500/10 text-primary-600 dark:text-primary-400 text-xs font-semibold hover:bg-primary-100 dark:hover:bg-primary-500/20 transition-all cursor-pointer"
                                                                    >
                                                                        <Eye className="w-3.5 h-3.5" />
                                                                        View Slip
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-slate-800">
                                                            <table className="w-full text-sm">
                                                                <thead>
                                                                    <tr className="bg-gray-100/70 dark:bg-slate-800/50">
                                                                        <th className="text-left px-2 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Code</th>
                                                                        <th className="text-left px-2 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Name</th>
                                                                        <th className="text-right px-2 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Qty</th>
                                                                        <th className="text-right px-2 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Unit Price</th>
                                                                        <th className="text-right px-2 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Total</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody className="divide-y divide-gray-50 dark:divide-slate-800/50">
                                                                    {r.products.map((p) => (
                                                                        <tr key={p.id} className="bg-white/50 dark:bg-transparent">
                                                                            <td className="px-2 py-1 font-mono text-xs text-gray-600 dark:text-gray-400">{p.product_code}</td>
                                                                            <td className="px-2 py-1 font-semibold text-gray-900 dark:text-gray-100">{p.product_name}</td>
                                                                            <td className="px-2 py-1 text-right font-mono text-sm text-gray-700 dark:text-gray-300">{p.quantity}</td>
                                                                            <td className="px-2 py-1 text-right font-mono text-sm text-gray-700 dark:text-gray-300">{formatPrice(p.unit_price, p.product?.category)}</td>
                                                                            <td className="px-2 py-1 text-right font-mono text-sm text-gray-700 dark:text-gray-300">{formatNumber(p.total_price)}</td>
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

                        {/* Mobile Accordion — below lg */}
                        <div className="lg:hidden divide-y divide-gray-50 dark:divide-slate-800">
                            {records.map((r) => (
                                <div key={r.id} className="transition-colors">
                                    {/* Always visible header */}
                                    <button
                                        onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                                        className="w-full flex items-center justify-between px-3.5 py-3 hover:bg-gray-50/30 dark:hover:bg-slate-800/30 transition-colors text-left"
                                    >
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className="font-mono text-xs text-gray-500 dark:text-gray-400 shrink-0">{formatDate(r.lifting_date)}</span>
                                                <span className={cn(
                                                    "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0",
                                                    statusColors[r.status] || "bg-gray-100 text-gray-500"
                                                )}>
                                                    {r.status}
                                                </span>
                                            </div>
                                            <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm mt-0.5 truncate">
                                                {r.house?.display_name || r.house?.name || `House #${r.house_id}`}
                                            </p>
                                        </div>
                                        <ChevronDown className={cn("w-4 h-4 text-gray-400 shrink-0 ml-2 transition-transform duration-300", expandedId === r.id && "rotate-180")} />
                                    </button>
                                    {/* Expandable content */}
                                    {expandedId === r.id && (
                                        <div className="px-3.5 pb-3.5 space-y-2.5 animate-in slide-in-from-top-1 duration-200">
                                            <div className="h-px bg-gray-100 dark:bg-slate-800" />
                                            <div className="space-y-1.5">
                                                <div className="flex items-center justify-between gap-3">
                                                    <p className="text-[11px] font-bold text-gray-400 uppercase">Payment</p>
                                                    <p className="text-xs font-medium text-gray-700 dark:text-gray-200 text-right">{r.payment_method}</p>
                                                </div>
                                                <div className="flex items-center justify-between gap-3">
                                                    <p className="text-[11px] font-bold text-gray-400 uppercase">Items</p>
                                                    <p className="text-xs font-medium text-gray-700 dark:text-gray-200 text-right">{r.products.length}</p>
                                                </div>
                                                <div className="flex items-center justify-between gap-3">
                                                    <p className="text-[11px] font-bold text-gray-400 uppercase">Bank Deposit</p>
                                                    <p className="text-xs font-mono font-medium text-gray-700 dark:text-gray-200 text-right">{formatNumber(r.total_bank_deposit)}</p>
                                                </div>
                                                <div className="flex items-center justify-between gap-3">
                                                    <p className="text-[11px] font-bold text-gray-400 uppercase">{t("liftings.fields.bank_name")}</p>
                                                    <p className="text-xs font-medium text-gray-700 dark:text-gray-200 text-right">{r.bank_name || "—"}</p>
                                                </div>
                                                {r.pull_status === "submitted" && r.pull_rf_code && (
                                                    <div className="flex items-center justify-between gap-3">
                                                        <p className="text-[11px] font-bold text-gray-400 uppercase">{t("liftings.pull.rf_code")}</p>
                                                        <p className="text-xs font-mono font-medium text-gray-700 dark:text-gray-200 text-right">{r.pull_rf_code}</p>
                                                    </div>
                                                )}
                                                <div className="flex items-center justify-between gap-3">
                                                    <p className="text-[11px] font-bold text-gray-400 uppercase">Total Lifting</p>
                                                    <p className="text-xs font-mono font-medium text-gray-700 dark:text-gray-200 text-right">{formatNumber(r.total_lifting_amount)}</p>
                                                </div>
                                                <div className="flex items-center justify-between gap-3">
                                                    <p className="text-[11px] font-bold text-gray-400 uppercase">iTopUp</p>
                                                    <div className="flex items-center justify-end gap-1.5">
                                                        <p className="text-xs font-mono font-medium text-gray-700 dark:text-gray-200 text-right">{formatNumber(r.itopup_amount)}</p>
                                                        {pullBadge(r)}
                                                    </div>
                                                </div>
                                                {r.deposit_slip && (
                                                    <div className="flex items-center justify-between gap-3 pt-1">
                                                        <p className="text-[11px] font-bold text-gray-400 uppercase">Deposit Slip</p>
                                                        <button
                                                            onClick={() => setLightboxUrl(r.deposit_slip!)}
                                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary-50 dark:bg-primary-500/10 text-primary-600 dark:text-primary-400 text-xs font-semibold hover:bg-primary-100 dark:hover:bg-primary-500/20 transition-all cursor-pointer"
                                                        >
                                                            <Eye className="w-3.5 h-3.5" />
                                                            View Slip
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                            {r.notes && (
                                                <div className="text-xs text-gray-500 dark:text-gray-400">
                                                    <span className="font-semibold text-gray-700 dark:text-gray-300">Notes:</span> {r.notes}
                                                </div>
                                            )}
                                            {r.products.length > 0 && (
                                                <div className="rounded-lg border border-gray-100 dark:border-slate-800 divide-y divide-gray-50 dark:divide-slate-800/50">
                                                    {r.products.map((p) => (
                                                        <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
                                                            <div className="min-w-0">
                                                                <p className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate">{p.product_name}</p>
                                                                <p className="text-[10px] font-mono text-gray-400 dark:text-gray-500">{p.product_code} × {p.quantity}</p>
                                                            </div>
                                                            <p className="text-xs font-mono font-medium text-gray-700 dark:text-gray-300 shrink-0">{formatNumber(p.total_price)}</p>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                            <div className="flex items-center gap-2 pt-2">
                                                {hasPermission("lifting.edit") && isEditable(r) && (
                                                    <button
                                                        onClick={() => openEditModal(r)}
                                                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-200 text-xs font-bold hover:bg-gray-50 dark:hover:bg-slate-800 transition-all cursor-pointer active:scale-[0.98]"
                                                    >
                                                        <Pencil className="w-3.5 h-3.5" />
                                                        Edit
                                                    </button>
                                                )}
                                                {hasPermission("lifting.delete") && (
                                                    <button
                                                        onClick={() => setDeleteTarget(r)}
                                                        className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-red-200 dark:border-red-500/20 text-red-500 text-xs font-bold hover:bg-red-50 dark:hover:bg-red-500/10 transition-all cursor-pointer active:scale-[0.98]"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                        Delete
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>

            <ConfirmationModal
                isOpen={!!deleteTarget}
                onClose={() => setDeleteTarget(null)}
                onConfirm={handleDelete}
                title="Delete Lifting Record"
                message={
                    deleteTarget
                        ? `Are you sure you want to delete the lifting record for ${deleteTarget.house?.display_name || deleteTarget.house?.name || `House #${deleteTarget.house_id}`} on ${formatDate(deleteTarget.lifting_date)}? This action cannot be undone.`
                        : ""
                }
                confirmText="Delete"
                type="danger"
                loading={deleting}
            />

            {/* Edit Lifting Modal */}
            {editTarget && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full border border-gray-100 dark:border-slate-800 shadow-2xl overflow-hidden p-6 space-y-4">
                        <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-slate-800">
                            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                                <Pencil className="w-5 h-5 text-primary-500" />
                                Edit Lifting Record #{editTarget.id}
                            </h3>
                            <button
                                onClick={() => setEditTarget(null)}
                                className="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800 cursor-pointer"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                                    Bank Deposit Amount
                                </label>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={editBankDeposit}
                                    onChange={(e) => setEditBankDeposit(e.target.value)}
                                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 text-sm outline-none focus:ring-2 focus:ring-primary-500"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                                    {t("liftings.fields.bank_name")}
                                </label>
                                <select
                                    value={editBankId}
                                    onChange={(e) => setEditBankId(e.target.value)}
                                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 text-sm outline-none focus:ring-2 focus:ring-primary-500 cursor-pointer"
                                >
                                    <option value="">{t("liftings.fields.bank_name_placeholder")}</option>
                                    {banks.map((bank) => (
                                        <option key={bank.id} value={bank.id}>
                                            {bank.name}
                                        </option>
                                    ))}
                                </select>
                                <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                                    {t("liftings.fields.bank_name_hint")}
                                </p>
                            </div>

                            <div>
                                <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                                    Status
                                </label>
                                <select
                                    value={editStatus}
                                    onChange={(e) => setEditStatus(e.target.value)}
                                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 text-sm outline-none focus:ring-2 focus:ring-primary-500 cursor-pointer"
                                >
                                    <option value="Draft">Draft</option>
                                    <option value="Confirmed">Confirmed</option>
                                    <option value="Approved">Approved</option>
                                    <option value="Cancelled">Cancelled</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                                    Notes
                                </label>
                                <textarea
                                    value={editNotes}
                                    onChange={(e) => setEditNotes(e.target.value)}
                                    rows={2}
                                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 text-sm outline-none focus:ring-2 focus:ring-primary-500"
                                    placeholder="Add notes..."
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                                    Products
                                </label>
                                <div className="space-y-2">
                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                                        <input
                                            type="text"
                                            value={editProductSearch}
                                            onChange={(e) => setEditProductSearch(e.target.value)}
                                            placeholder="Search product to add..."
                                            className="w-full pl-9 pr-3 py-2 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 text-xs text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-primary-500"
                                        />
                                    </div>
                                    {editProductSearch && (
                                        <div className="max-h-36 overflow-y-auto rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 divide-y divide-gray-100 dark:divide-slate-700">
                                            {products
                                                .filter(p => p.product_name.toLowerCase().includes(editProductSearch.toLowerCase()) || p.product_code.toLowerCase().includes(editProductSearch.toLowerCase()))
                                                .slice(0, 5)
                                                .map(p => {
                                                    const alreadySelected = editSelectedProducts.some(sp => sp.product.id === p.id);
                                                    return (
                                                        <div key={p.id} className="flex items-center justify-between px-3 py-2 hover:bg-gray-50 dark:hover:bg-slate-700/50">
                                                            <div className="min-w-0 pr-2">
                                                                <p className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate">{p.product_name}</p>
                                                                <p className="text-[10px] font-mono text-gray-400">{p.product_code} • {formatPrice(p.dd_lifting_price, p.category)} BDT</p>
                                                            </div>
                                                            <button
                                                                type="button"
                                                                disabled={alreadySelected}
                                                                onClick={() => {
                                                                    if (!alreadySelected) {
                                                                        setEditSelectedProducts(prev => [...prev, { product: p, quantity: 1 }]);
                                                                        setEditProductSearch("");
                                                                    }
                                                                }}
                                                                className={cn(
                                                                    "px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer",
                                                                    alreadySelected ? "bg-gray-100 dark:bg-slate-700 text-gray-400 cursor-not-allowed" : "bg-primary-600 text-white hover:bg-primary-700"
                                                                )}
                                                            >
                                                                {alreadySelected ? "Added" : "Add"}
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                        </div>
                                    )}

                                    {editSelectedProducts.length > 0 ? (
                                        <div className="rounded-xl border border-gray-200 dark:border-slate-700 divide-y divide-gray-100 dark:divide-slate-800 max-h-48 overflow-y-auto">
                                            {editSelectedProducts.map((sp) => (
                                                <div key={sp.product.id} className="flex items-center justify-between gap-3 px-3 py-2 bg-gray-50/50 dark:bg-slate-800/50">
                                                    <div className="min-w-0 flex-1">
                                                        <p className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate">{sp.product.product_name}</p>
                                                        <p className="text-[10px] font-mono text-gray-400">{sp.product.product_code} • {formatPrice(sp.product.dd_lifting_price, sp.product.category)}</p>
                                                    </div>
                                                    <div className="flex items-center gap-2 shrink-0">
                                                        <div className="flex items-center border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900">
                                                            <button
                                                                type="button"
                                                                onClick={() => setEditSelectedProducts(prev => prev.map(item => item.product.id === sp.product.id ? { ...item, quantity: Math.max(1, item.quantity - 1) } : item))}
                                                                className="px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-l-lg cursor-pointer"
                                                            >
                                                                -
                                                            </button>
                                                            <span className="px-2 text-xs font-mono font-medium text-gray-900 dark:text-gray-100">{sp.quantity}</span>
                                                            <button
                                                                type="button"
                                                                onClick={() => setEditSelectedProducts(prev => prev.map(item => item.product.id === sp.product.id ? { ...item, quantity: item.quantity + 1 } : item))}
                                                                className="px-2 py-1 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-r-lg cursor-pointer"
                                                            >
                                                                +
                                                            </button>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => setEditSelectedProducts(prev => prev.filter(item => item.product.id !== sp.product.id))}
                                                            className="p-1 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 cursor-pointer"
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-xs text-gray-400 italic">No products selected.</p>
                                    )}
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                                    Bank Deposit Slip
                                </label>
                                <div className="flex items-center gap-3">
                                    {editDepositSlip && (
                                        <button
                                            type="button"
                                            onClick={() => setLightboxUrl(editDepositSlip)}
                                            className="relative w-16 h-16 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden group shrink-0 cursor-pointer"
                                        >
                                            <img src={editDepositSlip} alt="Deposit slip" className="w-full h-full object-cover" />
                                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                                <Eye className="w-4 h-4 text-white" />
                                            </div>
                                        </button>
                                    )}
                                    <label className="flex-1 flex flex-col items-center justify-center px-4 py-3 border-2 border-dashed border-gray-200 dark:border-slate-700 rounded-xl hover:border-primary-500 dark:hover:border-primary-500 transition-colors cursor-pointer bg-gray-50/50 dark:bg-slate-800/50">
                                        <Upload className="w-5 h-5 text-gray-400 mb-1" />
                                        <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                                            {editCompressing ? "Optimizing image..." : editDepositSlip ? "Change slip image" : "Upload deposit slip"}
                                        </span>
                                        <input
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            disabled={editCompressing}
                                            onChange={async (e) => {
                                                const file = e.target.files?.[0];
                                                if (!file) return;
                                                setEditCompressing(true);
                                                try {
                                                    const compressed = await compressImage(file, 1200, 1200, 0.75);
                                                    setEditDepositSlip(compressed);
                                                    toast.success("Deposit slip optimized");
                                                } catch {
                                                    toast.error("Failed to process image");
                                                } finally {
                                                    setEditCompressing(false);
                                                }
                                            }}
                                        />
                                    </label>
                                    {editDepositSlip && (
                                        <button
                                            type="button"
                                            onClick={() => setEditDepositSlip(null)}
                                            className="p-2 rounded-xl text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors cursor-pointer"
                                            title="Remove slip"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100 dark:border-slate-800">
                            <button
                                onClick={() => setEditTarget(null)}
                                disabled={editLoading}
                                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleUpdate}
                                disabled={editLoading || editCompressing}
                                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-primary-600 text-white hover:bg-primary-700 transition-all cursor-pointer shadow-sm disabled:opacity-50"
                            >
                                {editLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                                Save Changes
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* PULL PreRF automation */}
            <PullPreRFModal
                open={!!pullTarget}
                record={pullTarget}
                isAdmin={isStrictAdmin}
                onClose={() => setPullTarget(null)}
                onCompleted={() => fetchRecords({ silent: true })}
            />

            {/* Lightbox for Deposit Slip */}
            <ImageLightbox
                open={!!lightboxUrl}
                src={lightboxUrl}
                alt="Bank Deposit Slip"
                onClose={() => setLightboxUrl(null)}
            />
        </div>
    );
}


