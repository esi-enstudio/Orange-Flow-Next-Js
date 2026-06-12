"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { toast } from "react-hot-toast";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { Loader2, ClipboardList, Eye, Check, Pencil, X, Banknote, Building2, Package } from "lucide-react";
import { cn } from "@/lib/utils";

type House = {
    id: number;
    name: string;
    code: string;
    display_name: string;
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

type PreviewData = {
    total_lifting_amount: number;
    remaining_amount: number;
    itopup_amount: number;
    products: {
        product_id: number;
        product_code: string;
        product_name: string;
        category: string;
        subcategory: string | null;
        quantity: number;
        unit_price: number;
        total_price: number;
    }[];
};

export default function CreateLiftingPage() {
    const router = useRouter();
    const { hasPermission, loading: authLoading } = useAuth();
    const { t } = useLanguage();

    const [houses, setHouses] = useState<House[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);

    const [houseId, setHouseId] = useState<number | "">("");
    const [liftingDate, setLiftingDate] = useState(() => new Date().toISOString().split("T")[0]);
    const [paymentMethod, setPaymentMethod] = useState<"Cash" | "Credit">("Cash");
    const [bankDeposit, setBankDeposit] = useState("0");
    const [notes, setNotes] = useState("");

    const [selectedProducts, setSelectedProducts] = useState<SelectedProduct[]>([]);
    const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

    const [previewData, setPreviewData] = useState<PreviewData | null>(null);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [confirmLoading, setConfirmLoading] = useState(false);

    const [showPreview, setShowPreview] = useState(false);

    const productCategories = useMemo(() => {
        const cats = new Set<string>();
        products.forEach((p) => cats.add(p.category));
        return Array.from(cats).sort();
    }, [products]);

    const productsByCategory = useMemo(() => {
        const map: Record<string, Product[]> = {};
        products.forEach((p) => {
            if (!map[p.category]) map[p.category] = [];
            map[p.category].push(p);
        });
        return map;
    }, [products]);

    const selectedProductIds = useMemo(() => new Set(selectedProducts.map((sp) => sp.product.id)), [selectedProducts]);

    const canCreate = hasPermission("create_lifting");

    const fetchData = async () => {
        setLoading(true);
        try {
            const [housesRes, productsRes] = await Promise.allSettled([
                apiClient.get("houses/accessible"),
                apiClient.get("products", { params: { status: "Active" } }),
            ]);

            if (housesRes.status === "fulfilled") {
                setHouses(housesRes.value.data);
            } else {
                console.error("Failed to load houses:", housesRes.reason);
            }

            if (productsRes.status === "fulfilled") {
                setProducts(productsRes.value.data);
            } else {
                console.error("Failed to load products:", productsRes.reason);
                const detail = productsRes.reason?.response?.data?.detail;
                toast.error(detail || "Failed to load products");
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!authLoading && hasPermission("view_lifting")) {
            fetchData();
        }
    }, [authLoading, hasPermission]);

    const toggleProduct = (product: Product) => {
        setSelectedProducts((prev) => {
            const exists = prev.find((sp) => sp.product.id === product.id);
            if (exists) {
                return prev.filter((sp) => sp.product.id !== product.id);
            }
            return [...prev, { product, quantity: 1 }];
        });
    };

    const updateQuantity = (productId: number, quantity: number) => {
        setSelectedProducts((prev) =>
            prev.map((sp) =>
                sp.product.id === productId ? { ...sp, quantity: Math.max(1, quantity) } : sp
            )
        );
    };

    const totalSelectionAmount = useMemo(() => {
        return selectedProducts.reduce((sum, sp) => {
            return sum + (sp.product.dd_lifting_price || 0) * sp.quantity;
        }, 0);
    }, [selectedProducts]);

    const handlePreview = async () => {
        if (!houseId) {
            toast.error("Please select a house");
            return;
        }
        if (selectedProducts.length === 0) {
            toast.error("Please select at least one product");
            return;
        }

        setPreviewLoading(true);
        try {
            const res = await apiClient.post("lifting/preview", {
                house_id: houseId,
                lifting_date: liftingDate,
                payment_method: paymentMethod,
                total_bank_deposit: Number(bankDeposit || 0),
                notes: notes.trim() || null,
                products: selectedProducts.map((sp) => ({
                    product_id: sp.product.id,
                    quantity: sp.quantity,
                })),
            });
            setPreviewData(res.data);
            setShowPreview(true);
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || "Failed to compute preview");
        } finally {
            setPreviewLoading(false);
        }
    };

    const handleConfirm = async () => {
        if (!previewData) return;
        setConfirmLoading(true);
        try {
            await apiClient.post("lifting", {
                house_id: houseId,
                lifting_date: liftingDate,
                payment_method: paymentMethod,
                total_bank_deposit: Number(bankDeposit || 0),
                notes: notes.trim() || null,
                products: selectedProducts.map((sp) => ({
                    product_id: sp.product.id,
                    quantity: sp.quantity,
                })),
            });
            toast.success("Lifting record created successfully");
            router.push("/commercial/lifting/records");
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || "Failed to create lifting record");
        } finally {
            setConfirmLoading(false);
        }
    };

    const resetForm = () => {
        setHouseId("");
        setLiftingDate(new Date().toISOString().split("T")[0]);
        setPaymentMethod("Cash");
        setBankDeposit("0");
        setNotes("");
        setSelectedProducts([]);
        setPreviewData(null);
        setShowPreview(false);
        setExpandedCategory(null);
    };

    if (authLoading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
            </div>
        );
    }

    if (!hasPermission("view_lifting")) {
        return <AccessDenied />;
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-primary-50 text-primary-600 shadow-sm">
                        <ClipboardList className="w-5 h-5" />
                    </div>
                    Create Lifting
                </h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 ml-1">
                    Select products, enter quantities, and create a lifting record.
                </p>
            </div>

            {/* House, Date, Payment */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-6">
                <div className="flex items-center gap-2 pb-2 mb-4 border-b border-gray-100 dark:border-slate-800">
                    <Building2 className="w-4 h-4 text-primary-500" />
                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                        Basic Information
                    </h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    <div className="space-y-1.5">
                        <label className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            House *
                        </label>
                        <select
                            value={houseId}
                            onChange={(e) => setHouseId(e.target.value ? Number(e.target.value) : "")}
                            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 outline-none transition-all text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        >
                            <option value="">Select a house</option>
                            {houses.map((h) => (
                                <option key={h.id} value={h.id}>
                                    {h.display_name}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Date *
                        </label>
                        <input
                            type="date"
                            value={liftingDate}
                            onChange={(e) => setLiftingDate(e.target.value)}
                            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 outline-none transition-all text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Payment Method *
                        </label>
                        <div className="flex gap-3">
                            {(["Cash", "Credit"] as const).map((method) => (
                                <button
                                    key={method}
                                    type="button"
                                    onClick={() => setPaymentMethod(method)}
                                    className={cn(
                                        "flex-1 px-4 py-2.5 rounded-lg border text-sm font-semibold transition-all",
                                        paymentMethod === method
                                            ? "bg-primary-50 border-primary-300 text-primary-700 dark:bg-primary-500/10 dark:border-primary-500 dark:text-primary-300"
                                            : "border-gray-200 dark:border-slate-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800"
                                    )}
                                >
                                    {method}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Product Selection */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-6">
                <div className="flex items-center gap-2 pb-2 mb-4 border-b border-gray-100 dark:border-slate-800">
                    <Package className="w-4 h-4 text-primary-500" />
                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                        Products
                    </h4>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
                    </div>
                ) : (
                    <div className="space-y-4">
                        {productCategories.map((category) => {
                            const catProducts = productsByCategory[category] || [];
                            const isExpanded = expandedCategory === category;
                            const selectedCount = catProducts.filter((p) => selectedProductIds.has(p.id)).length;

                            return (
                                <div key={category} className="border border-gray-100 dark:border-slate-800 rounded-xl overflow-hidden">
                                    <button
                                        type="button"
                                        onClick={() => setExpandedCategory(isExpanded ? null : category)}
                                        className="w-full flex items-center justify-between px-5 py-3.5 bg-gray-50 dark:bg-slate-800/50 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors text-left"
                                    >
                                        <div className="flex items-center gap-3">
                                            <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{category}</span>
                                            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-primary-100/70 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300">
                                                {catProducts.length}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            {selectedCount > 0 && (
                                                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                                                    {selectedCount} selected
                                                </span>
                                            )}
                                            <svg
                                                className={cn("w-4 h-4 text-gray-400 transition-transform", isExpanded && "rotate-180")}
                                                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                                            >
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                            </svg>
                                        </div>
                                    </button>

                                    {isExpanded && (
                                        <div className="divide-y divide-gray-50 dark:divide-slate-800/50">
                                            {catProducts.map((product) => {
                                                const isSelected = selectedProductIds.has(product.id);
                                                const selected = selectedProducts.find((sp) => sp.product.id === product.id);

                                                return (
                                                    <div
                                                        key={product.id}
                                                        className={cn(
                                                            "flex items-center gap-4 px-5 py-3 transition-colors",
                                                            isSelected ? "bg-primary-50/50 dark:bg-primary-500/5" : "hover:bg-gray-50 dark:hover:bg-slate-800/30"
                                                        )}
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            checked={isSelected}
                                                            onChange={() => toggleProduct(product)}
                                                            className="w-4 h-4 rounded border-gray-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500"
                                                        />
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                                                                    {product.product_name}
                                                                </span>
                                                                <span className="text-[10px] font-mono text-gray-400 dark:text-gray-500">
                                                                    {product.product_code}
                                                                </span>
                                                            </div>
                                                            <div className="flex items-center gap-3 mt-0.5">
                                                                <span className="text-[11px] text-gray-500 dark:text-gray-400">
                                                                    MRP: {product.mrp.toLocaleString()}
                                                                </span>
                                                                <span className="text-[11px] text-gray-500 dark:text-gray-400">
                                                                    DD: {product.dd_lifting_price.toLocaleString()}
                                                                </span>
                                                                <span className="text-[11px] text-gray-500 dark:text-gray-400">
                                                                    Ret: {product.ret_lifting_price.toLocaleString()}
                                                                </span>
                                                            </div>
                                                        </div>
                                                        {isSelected && selected && (
                                                            <div className="flex items-center gap-2 shrink-0">
                                                                <label className="text-[10px] font-bold text-gray-400 uppercase">Qty</label>
                                                                <input
                                                                    type="number"
                                                                    min={1}
                                                                    value={selected.quantity}
                                                                    onChange={(e) => updateQuantity(product.id, Math.max(1, parseInt(e.target.value) || 1))}
                                                                    className="w-20 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-900 dark:text-gray-100 text-center outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                                                />
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {productCategories.length === 0 && (
                            <div className="text-center py-12 text-gray-400 dark:text-gray-500 text-sm">
                                No active products found. Create products in the Products section first.
                            </div>
                        )}
                    </div>
                )}

                {selectedProducts.length > 0 && (
                    <div className="mt-5 p-4 bg-primary-50/50 dark:bg-primary-500/5 rounded-xl border border-primary-100 dark:border-primary-500/10">
                        <div className="flex items-center justify-between text-sm">
                            <span className="font-semibold text-gray-700 dark:text-gray-300">Selected Products:</span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">{selectedProducts.length} item(s)</span>
                        </div>
                        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 space-y-1">
                            {selectedProducts.map((sp) => (
                                <div key={sp.product.id} className="flex justify-between">
                                    <span>{sp.product.product_name} x {sp.quantity}</span>
                                    <span className="font-mono">{(sp.product.dd_lifting_price * sp.quantity).toLocaleString()}</span>
                                </div>
                            ))}
                            <div className="pt-2 mt-2 border-t border-primary-100 dark:border-primary-500/10 flex justify-between font-bold text-gray-900 dark:text-gray-100">
                                <span>Total Lifting Amount</span>
                                <span className="font-mono">{totalSelectionAmount.toLocaleString()}</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Bank Deposit & Notes */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-6">
                <div className="flex items-center gap-2 pb-2 mb-4 border-b border-gray-100 dark:border-slate-800">
                    <Banknote className="w-4 h-4 text-primary-500" />
                    <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                        Payment Details
                    </h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="space-y-1.5">
                        <label className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Total Bank Deposit Amount *
                        </label>
                        <input
                            type="number"
                            step="0.01"
                            min={0}
                            value={bankDeposit}
                            onChange={(e) => setBankDeposit(e.target.value)}
                            placeholder="0.00"
                            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 outline-none transition-all text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-[11px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                            Notes
                        </label>
                        <input
                            type="text"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="Optional notes..."
                            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 outline-none transition-all text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                        />
                    </div>
                </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3">
                <button
                    type="button"
                    onClick={handlePreview}
                    disabled={previewLoading || selectedProducts.length === 0 || !houseId}
                    className="px-6 py-2.5 bg-primary-600 text-white rounded-lg text-sm font-semibold hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                >
                    {previewLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                        <Eye className="w-4 h-4" />
                    )}
                    Preview
                </button>
                <button
                    type="button"
                    onClick={resetForm}
                    className="px-4 py-2.5 rounded-lg border border-gray-200 dark:border-slate-800 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
                >
                    Reset
                </button>
            </div>

            {/* Preview Modal */}
            {showPreview && previewData && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                     onClick={() => setShowPreview(false)}>
                    <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-2xl shadow-2xl border border-gray-100 dark:border-slate-800 max-h-[90vh] flex flex-col"
                         onClick={(e) => e.stopPropagation()}>
                        {/* Header */}
                        <div className="bg-primary-600 rounded-t-2xl px-6 py-5 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-white/20 rounded-xl">
                                    <Eye className="w-5 h-5 text-white" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-white">Lifting Preview</h3>
                                    <p className="text-sm text-white/80">Review the calculated values before confirming</p>
                                </div>
                            </div>
                            <button onClick={() => setShowPreview(false)} className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors">
                                <X className="w-4 h-4 text-white" />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="flex-1 overflow-y-auto p-6 space-y-6">
                            {/* Summary Cards */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <div className="bg-blue-50 dark:bg-blue-500/10 rounded-xl p-4 border border-blue-100 dark:border-blue-500/10">
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-1">
                                        Total Lifting Amount
                                    </p>
                                    <p className="text-xl font-bold text-blue-700 dark:text-blue-300 font-mono">
                                        {previewData.total_lifting_amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </p>
                                </div>
                                <div className="bg-emerald-50 dark:bg-emerald-500/10 rounded-xl p-4 border border-emerald-100 dark:border-emerald-500/10">
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-1">
                                        Remaining Amount
                                    </p>
                                    <p className="text-xl font-bold text-emerald-700 dark:text-emerald-300 font-mono">
                                        {previewData.remaining_amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </p>
                                </div>
                                <div className="bg-purple-50 dark:bg-purple-500/10 rounded-xl p-4 border border-purple-100 dark:border-purple-500/10">
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400 mb-1">
                                        iTopUp Amount
                                    </p>
                                    <p className="text-xl font-bold text-purple-700 dark:text-purple-300 font-mono">
                                        {previewData.itopup_amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </p>
                                </div>
                            </div>

                            {/* Bank Deposit */}
                            <div className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-slate-800/50 rounded-xl border border-gray-100 dark:border-slate-800">
                                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Total Bank Deposit</span>
                                <span className="text-lg font-bold text-gray-900 dark:text-gray-100 font-mono">
                                    {Number(bankDeposit || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                            </div>

                            {/* Products */}
                            <div>
                                <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">
                                    Selected Products
                                </h4>
                                <div className="space-y-2">
                                    {previewData.products.map((p) => (
                                        <div key={p.product_id} className="flex items-center justify-between px-4 py-2.5 bg-gray-50 dark:bg-slate-800/30 rounded-lg">
                                            <div>
                                                <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{p.product_name}</span>
                                                <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-2 font-mono">{p.product_code}</span>
                                                <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                                                    {p.quantity} x {p.unit_price.toLocaleString()}
                                                </div>
                                            </div>
                                            <span className="text-sm font-bold text-gray-900 dark:text-gray-100 font-mono">
                                                {p.total_price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Formulas */}
                            <div className="px-4 py-3 bg-gray-50 dark:bg-slate-800/50 rounded-xl border border-gray-100 dark:border-slate-800">
                                <h4 className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Calculation</h4>
                                <div className="text-[11px] text-gray-500 dark:text-gray-400 space-y-1 font-mono">
                                    <div>Bank Deposit = {Number(bankDeposit || 0).toLocaleString()}</div>
                                    <div>Total Lifting = {previewData.total_lifting_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                                    <div>Remaining = Bank Deposit - Total Lifting = {previewData.remaining_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                                    <div>iTopUp = Remaining / 0.9625 = {previewData.itopup_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                                </div>
                            </div>
                        </div>

                        {/* Footer Actions */}
                        <div className="px-6 py-4 border-t border-gray-100 dark:border-slate-800 flex items-center justify-end gap-3">
                            <button
                                type="button"
                                onClick={() => setShowPreview(false)}
                                className="px-4 py-2.5 rounded-lg border border-gray-200 dark:border-slate-800 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-2"
                            >
                                <X className="w-4 h-4" />
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowPreview(false)}
                                className="px-4 py-2.5 rounded-lg border border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-300 text-sm font-semibold hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-colors flex items-center gap-2"
                            >
                                <Pencil className="w-4 h-4" />
                                Modify
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirm}
                                disabled={confirmLoading || !canCreate}
                                className="px-5 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                            >
                                {confirmLoading ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <Check className="w-4 h-4" />
                                )}
                                Confirm
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
