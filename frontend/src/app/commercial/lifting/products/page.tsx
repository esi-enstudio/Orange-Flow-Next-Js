"use client";

import { useEffect, useMemo, useState } from "react";
import apiClient from "@/lib/api";
import { toast } from "react-hot-toast";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import { Loader2, Plus, Search, Trash2, Pencil, Save, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ProductCategory = "SIM" | "Scratch Card" | "Device" | "Other";
type ProductStatus = "Active" | "Inactive";

type Product = {
    id: number;
    product_code: string;
    category: ProductCategory | string;
    subcategory?: string | null;
    product_name: string;
    mrp: number;
    dd_lifting_price: number;
    ret_lifting_price: number;
    status: ProductStatus | string;
};

const emptyForm = {
    product_code: "",
    category: "SIM" as ProductCategory,
    subcategory: "",
    product_name: "",
    mrp: "0",
    dd_lifting_price: "0",
    ret_lifting_price: "0",
    status: "Active" as ProductStatus,
};

export default function ProductsPage() {
    const { hasPermission, loading: authLoading } = useAuth();
    const { t } = useLanguage();

    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);

    const [search, setSearch] = useState("");
    const [category, setCategory] = useState<string>("");
    const [status, setStatus] = useState<string>("");

    const [categories, setCategories] = useState<string[]>([]);
    const [subcategories, setSubcategories] = useState<string[]>([]);
    const [statuses] = useState<string[]>(["Active", "Inactive"]);

    const [formMode, setFormMode] = useState<"create" | "edit">("create");
    const [editingId, setEditingId] = useState<number | null>(null);
    const [form, setForm] = useState({ ...emptyForm });
    const [allowCodeEdit, setAllowCodeEdit] = useState(false);

    const [submitting, setSubmitting] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);

    const filteredProducts = useMemo(() => {
        return products.filter((p) => {
            const matchSearch =
                !search.trim() ||
                p.product_code.toLowerCase().includes(search.toLowerCase()) ||
                p.product_name.toLowerCase().includes(search.toLowerCase()) ||
                String(p.category).toLowerCase().includes(search.toLowerCase());

            const matchCategory = !category || String(p.category) === category;
            const matchStatus = !status || String(p.status) === status;

            return matchSearch && matchCategory && matchStatus;
        });
    }, [products, search, category, status]);

    const fetchProducts = async () => {
        setLoading(true);
        try {
            const res = await apiClient.get("products", {
                params: {
                    search: search.trim() ? search.trim() : undefined,
                    category: category || undefined,
                    status: status || undefined,
                },
            });
            setProducts(res.data);
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || t("common.error"));
        } finally {
            setLoading(false);
        }
    };

    const fetchFilterOptions = async () => {
        try {
            const res = await apiClient.get("products/filter-options");
            setCategories(res.data.categories || []);
            setSubcategories(res.data.subcategories || []);
        } catch (err) {
            // non-critical
        }
    };

    useEffect(() => {
        if (!authLoading && hasPermission("view_products")) {
            fetchFilterOptions();
            fetchProducts();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [authLoading, hasPermission]);

    const resetForm = () => {
        setForm({ ...emptyForm });
        setFormMode("create");
        setEditingId(null);
        setAllowCodeEdit(false);
    };

    const startEdit = (p: Product) => {
        setFormMode("edit");
        setEditingId(p.id);
        setAllowCodeEdit(false);
        setForm({
            product_code: p.product_code,
            category: (p.category as ProductCategory) || "SIM",
            subcategory: p.subcategory ? String(p.subcategory) : "",
            product_name: p.product_name,
            mrp: String(p.mrp ?? 0),
            dd_lifting_price: String(p.dd_lifting_price ?? 0),
            ret_lifting_price: String(p.ret_lifting_price ?? 0),
            status: (p.status as ProductStatus) || "Active",
        });
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    const handleSubmit = async () => {
        if (!form.product_code.trim() || !form.product_name.trim()) {
            toast.error("Product code and product name are required");
            return;
        }

        const payload = {
            product_code: form.product_code.trim().toUpperCase(),
            category: form.category,
            subcategory: form.subcategory.trim() || null,
            product_name: form.product_name.trim(),
            mrp: Number(form.mrp || 0),
            dd_lifting_price: Number(form.dd_lifting_price || 0),
            ret_lifting_price: Number(form.ret_lifting_price || 0),
            status: form.status,
        };

        setSubmitting(true);
        try {
            if (formMode === "create") {
                await apiClient.post("products", payload);
                toast.success("Product created");
            } else {
                if (!editingId) return;
                await apiClient.put(`products/${editingId}`, payload);
                toast.success("Product updated");
            }
            resetForm();
            await fetchProducts();
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || t("common.error"));
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        try {
            await apiClient.delete(`products/${deleteTarget.id}`);
            toast.success("Product deleted");
            setDeleteTarget(null);
            await fetchProducts();
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || t("common.error"));
        }
    };

    if (authLoading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
            </div>
        );
    }

    if (!hasPermission("view_products")) {
        return <AccessDenied />;
    }

    const canCreate = hasPermission("create_products");
    const canEdit = hasPermission("edit_products");
    const canDelete = hasPermission("delete_products");

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-primary-50 text-primary-600 shadow-sm">
                        <Plus className="w-5 h-5" />
                    </div>
                    Products
                </h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 ml-1">
                    Create, update, and delete product records used in Lifting.
                </p>
            </div>

            {/* Form */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-6">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                            {formMode === "create" ? "Create Product" : "Edit Product"}
                        </h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                            Category groups products for selection during lifting.
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {(formMode === "edit" || editingId !== null) && (
                            <button
                                type="button"
                                onClick={resetForm}
                                className="px-3 py-2 rounded-xl border border-gray-200 dark:border-slate-800 text-sm hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
                            >
                                <X className="w-4 h-4 inline-block mr-2 align-[-2px]" />
                                Cancel
                            </button>
                        )}
                    </div>
                </div>

                <div className="mt-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            Product Code *
                        </label>
                        <input
                            value={form.product_code}
                            onChange={(e) => setForm((s) => ({ ...s, product_code: e.target.value }))}
                            placeholder="e.g. SIM001"
                            disabled={formMode === "edit" && !allowCodeEdit}
                            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 outline-none transition-all text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-100 dark:disabled:bg-slate-800/50"
                        />
                        {formMode === "edit" && !allowCodeEdit && (
                            <p className="text-[10px] text-gray-400 mt-1">
                                Product code cannot be changed directly. Use the option below if a code update is required alongside price changes.
                            </p>
                        )}
                        {formMode === "edit" && (
                            <label className="flex items-center gap-2 mt-2 cursor-pointer group">
                                <input
                                    type="checkbox"
                                    checked={allowCodeEdit}
                                    onChange={(e) => {
                                        setAllowCodeEdit(e.target.checked);
                                        if (!e.target.checked) {
                                            // Reset to original code when unchecking
                                            const original = products.find((p) => p.id === editingId);
                                            if (original) setForm((s) => ({ ...s, product_code: original.product_code }));
                                        }
                                    }}
                                    className="w-3.5 h-3.5 rounded border-gray-300 dark:border-slate-600 text-amber-500 focus:ring-amber-400"
                                />
                                <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium group-hover:text-amber-700 dark:group-hover:text-amber-300 transition-colors">
                                    Also update the product code
                                </span>
                            </label>
                        )}
                        {formMode === "edit" && allowCodeEdit && (
                            <p className="text-[10px] text-amber-500 mt-1">
                                This will change the product code for future transactions. Existing lifting records retain their original snapshotted data. The previous code is logged in the audit history.
                            </p>
                        )}
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            Category *
                        </label>
                        <select
                            value={form.category}
                            onChange={(e) => setForm((s) => ({ ...s, category: e.target.value as ProductCategory }))}
                            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 outline-none transition-all text-sm"
                        >
                            {(["SIM", "Scratch Card", "Device", "Other"] as ProductCategory[]).map((c) => (
                                <option key={c} value={c}>
                                    {c}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            Subcategory
                        </label>
                        <input
                            value={form.subcategory}
                            onChange={(e) => setForm((s) => ({ ...s, subcategory: e.target.value }))}
                            placeholder="optional"
                            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 outline-none transition-all text-sm"
                            list="product-subcategories"
                        />
                        <datalist id="product-subcategories">
                            {subcategories.map((s) => (
                                <option key={s} value={s} />
                            ))}
                        </datalist>
                    </div>

                    <div className="md:col-span-2 lg:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            Product Name *
                        </label>
                        <input
                            value={form.product_name}
                            onChange={(e) => setForm((s) => ({ ...s, product_name: e.target.value }))}
                            placeholder="e.g. Scratch Card 100"
                            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 outline-none transition-all text-sm"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            Status *
                        </label>
                        <select
                            value={form.status}
                            onChange={(e) => setForm((s) => ({ ...s, status: e.target.value as ProductStatus }))}
                            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 outline-none transition-all text-sm"
                        >
                            {statuses.map((s) => (
                                <option key={s} value={s}>
                                    {s}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            MRP
                        </label>
                        <input
                            type="number"
                            step="0.01"
                            value={form.mrp}
                            onChange={(e) => setForm((s) => ({ ...s, mrp: e.target.value }))}
                            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 outline-none transition-all text-sm"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            Distributor Lifting Price (DD)
                        </label>
                        <input
                            type="number"
                            step="0.01"
                            value={form.dd_lifting_price}
                            onChange={(e) => setForm((s) => ({ ...s, dd_lifting_price: e.target.value }))}
                            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 outline-none transition-all text-sm"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                            Retailer Lifting Price (Ret)
                        </label>
                        <input
                            type="number"
                            step="0.01"
                            value={form.ret_lifting_price}
                            onChange={(e) => setForm((s) => ({ ...s, ret_lifting_price: e.target.value }))}
                            className="w-full px-4 py-2.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-gray-100 outline-none transition-all text-sm"
                        />
                    </div>
                </div>

                <div className="mt-6 flex items-center gap-3">
                    <button
                        type="button"
                        onClick={handleSubmit}
                        disabled={
                            submitting ||
                            (formMode === "create" ? !canCreate : !canEdit) ||
                            !form.product_code.trim() ||
                            !form.product_name.trim()
                        }
                        className="px-5 py-2.5 bg-primary-600 text-white rounded-lg text-sm font-semibold hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                    >
                        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        {formMode === "create" ? "Create Product" : "Save Changes"}
                    </button>

                    <button
                        type="button"
                        onClick={resetForm}
                        className="px-4 py-2.5 rounded-lg border border-gray-200 dark:border-slate-800 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
                    >
                        Reset
                    </button>
                </div>
            </div>

            {/* List */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex items-center gap-2.5 flex-1 min-w-0">
                        <div className="p-2 rounded-xl bg-primary-50 text-primary-600 shadow-sm">
                            <Search className="w-4 h-4" />
                        </div>
                        <span className="font-semibold text-gray-900 dark:text-gray-100">Product List</span>
                        <span
                            className={cn(
                                "text-xs font-bold px-2.5 py-0.5 rounded-full transition-colors",
                                products.length > 0
                                    ? "bg-primary-100/70 dark:bg-primary-500/15 text-primary-700 dark:text-primary-300"
                                    : "bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-gray-400"
                            )}
                        >
                            {products.length}
                        </span>
                    </div>

                    <div className="relative w-full sm:w-56">
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search products..."
                            className="w-full pl-9 pr-3 py-2 rounded-xl bg-gray-50 dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 dark:focus:border-primary-500 transition-all"
                        />
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                    </div>

                    <div className="flex items-center gap-2">
                        <select
                            value={category}
                            onChange={(e) => setCategory(e.target.value)}
                            className="px-3 py-2 rounded-xl bg-gray-50 dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700 text-sm text-gray-900 dark:text-gray-100 outline-none transition-all focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 dark:focus:border-primary-500"
                        >
                            <option value="">All Categories</option>
                            {categories.map((c) => (
                                <option key={c} value={c}>
                                    {c}
                                </option>
                            ))}
                        </select>

                        <select
                            value={status}
                            onChange={(e) => setStatus(e.target.value)}
                            className="px-3 py-2 rounded-xl bg-gray-50 dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700 text-sm text-gray-900 dark:text-gray-100 outline-none transition-all focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 dark:focus:border-primary-500"
                        >
                            <option value="">All Statuses</option>
                            {statuses.map((s) => (
                                <option key={s} value={s}>
                                    {s}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-16">
                        <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
                    </div>
                ) : filteredProducts.length === 0 ? (
                    <div className="px-6 py-16 text-center">
                        <p className="text-gray-400 dark:text-gray-500 text-sm">No products found</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-800/30">
                                    <th className="text-left px-6 py-3 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Code</th>
                                    <th className="text-left px-6 py-3 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Name</th>
                                    <th className="text-left px-6 py-3 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Category</th>
                                    <th className="text-right px-6 py-3 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">MRP</th>
                                    <th className="text-right px-6 py-3 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">DD Price</th>
                                    <th className="text-right px-6 py-3 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Ret Price</th>
                                    <th className="text-center px-6 py-3 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Status</th>
                                    <th className="text-right px-6 py-3 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50 dark:divide-slate-800/50">
                                {filteredProducts.map((p) => (
                                    <tr key={p.id} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition-colors">
                                        <td className="px-6 py-4 font-mono text-xs text-gray-600 dark:text-gray-400">{p.product_code}</td>
                                        <td className="px-6 py-4 font-semibold text-gray-900 dark:text-gray-100">{p.product_name}</td>
                                        <td className="px-6 py-4">
                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-primary-50 text-primary-700 dark:bg-primary-500/10 dark:text-primary-300">
                                                {p.category}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-right font-mono text-sm text-gray-700 dark:text-gray-300">{p.mrp.toLocaleString()}</td>
                                        <td className="px-6 py-4 text-right font-mono text-sm text-gray-700 dark:text-gray-300">{p.dd_lifting_price.toLocaleString()}</td>
                                        <td className="px-6 py-4 text-right font-mono text-sm text-gray-700 dark:text-gray-300">{p.ret_lifting_price.toLocaleString()}</td>
                                        <td className="px-6 py-4 text-center">
                                            <span
                                                className={cn(
                                                    "inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold",
                                                    p.status === "Active"
                                                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                                                        : "bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-gray-400"
                                                )}
                                            >
                                                {p.status}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                {canEdit && (
                                                    <button
                                                        onClick={() => startEdit(p)}
                                                        className="p-2 text-gray-400 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/10 rounded-lg transition-all"
                                                        title="Edit"
                                                    >
                                                        <Pencil className="w-4 h-4" />
                                                    </button>
                                                )}
                                                {canDelete && (
                                                    <button
                                                        onClick={() => setDeleteTarget(p)}
                                                        className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-all"
                                                        title="Delete"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Delete Confirmation Modal */}
            <ConfirmationModal
                isOpen={deleteTarget !== null}
                onClose={() => setDeleteTarget(null)}
                onConfirm={handleDelete}
                title="Delete Product?"
                message={`Are you sure you want to delete "${deleteTarget?.product_name}" (${deleteTarget?.product_code})? This action cannot be undone.`}
                confirmText="Delete"
                type="danger"
            />
        </div>
    );
}
