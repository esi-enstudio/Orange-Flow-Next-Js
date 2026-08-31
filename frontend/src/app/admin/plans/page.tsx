"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Crown, Loader2, Pencil, Plus, Save, Search, Tag, Trash2, X } from "lucide-react";
import { toast } from "react-hot-toast";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import PageGuideModal from "@/components/PageGuideModal";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import type { Paginated, Plan } from "@/types/billing";

interface PlanForm {
  name: string;
  slug: string;
  tier: string;
  billing_interval: string;
  price_monthly: string;
  price_yearly: string;
  trial_days: string;
  sort_order: string;
  is_active: boolean;
  features: string;
  feature_flags: string;
  limits: string;
  description: string;
}

const EMPTY_FORM: PlanForm = {
  name: "",
  slug: "",
  tier: "basic",
  billing_interval: "monthly",
  price_monthly: "0",
  price_yearly: "0",
  trial_days: "0",
  sort_order: "0",
  is_active: true,
  features: "",
  feature_flags: "",
  limits: "",
  description: "",
};

const fmtMoney = (n: number) => `৳${Number(n).toLocaleString()}`;

export default function AdminPlansPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const { hasPermission, loading: authLoading } = useAuth();

  const [plans, setPlans] = useState<Plan[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [form, setForm] = useState<PlanForm>(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Plan | null>(null);
  const [deleting, setDeleting] = useState(false);

  const canView = hasPermission("plans.manage") || hasPermission("subscription.manage");
  const canEdit = hasPermission("plans.manage");

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get("v1/plans", { params: { per_page: 100, include_deleted: false } });
      setPlans((res.data as Paginated<Plan>).data || []);
    } catch (err: any) {
      toast.error(err?.message || t("pricing.something_went_wrong"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (authLoading) return;
    if (!canView) {
      const timer = setTimeout(() => router.push("/"), 5000);
      return () => clearTimeout(timer);
    }
    fetchPlans();
  }, [authLoading, canView, fetchPlans, router]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return plans;
    return plans.filter((p) => p.name.toLowerCase().includes(q) || (p.slug || "").toLowerCase().includes(q));
  }, [plans, search]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setFieldErrors({});
    setModalOpen(true);
  };

  const openEdit = (plan: Plan) => {
    setEditing(plan);
    setForm({
      name: plan.name,
      slug: plan.slug || "",
      tier: plan.tier || "basic",
      billing_interval: plan.billing_interval,
      price_monthly: String(plan.price_monthly ?? 0),
      price_yearly: String(plan.price_yearly ?? 0),
      trial_days: String(plan.trial_days ?? 0),
      sort_order: String(plan.sort_order ?? 0),
      is_active: plan.is_active,
      features: plan.features || "",
      feature_flags: (plan.feature_flags || []).join(", "),
      limits: plan.limits ? JSON.stringify(plan.limits, null, 2) : "",
      description: plan.description || "",
    });
    setFormError("");
    setFieldErrors({});
    setModalOpen(true);
  };

  const validate = (): boolean => {
    const fe: Record<string, string> = {};
    if (!form.name.trim()) fe.name = t("plans.name") + " required";
    if (form.trial_days && Number(form.trial_days) < 0) fe.trial_days = "invalid";
    if (form.limits.trim()) {
      try {
        JSON.parse(form.limits);
      } catch {
        fe.limits = "invalid JSON";
      }
    }
    setFieldErrors(fe);
    return Object.keys(fe).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        slug: form.slug.trim() || null,
        tier: form.tier,
        billing_interval: form.billing_interval,
        price_monthly: Number(form.price_monthly) || 0,
        price_yearly: Number(form.price_yearly) || 0,
        trial_days: Number(form.trial_days) || 0,
        sort_order: Number(form.sort_order) || 0,
        is_active: form.is_active,
        features: form.features,
        feature_flags: form.feature_flags
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        description: form.description || null,
      };
      if (form.limits.trim()) payload.limits = JSON.parse(form.limits);
      if (editing) {
        await apiClient.patch(`v1/plans/${editing.id}`, payload);
        toast.success(t("plans.toast_update_success"));
      } else {
        await apiClient.post("v1/plans", payload);
        toast.success(t("plans.toast_create_success"));
      }
      setModalOpen(false);
      await fetchPlans();
    } catch (err: any) {
      toast.error(err?.message || t("pricing.something_went_wrong"));
      if (err?.response?.data?.detail) setFormError(String(err.response.data.detail));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiClient.delete(`v1/plans/${deleteTarget.id}`);
      toast.success(t("plans.toast_delete_success"));
      setDeleteTarget(null);
      await fetchPlans();
    } catch (err: any) {
      toast.error(err?.message || t("pricing.something_went_wrong"));
    } finally {
      setDeleting(false);
    }
  };

  if (!authLoading && !canView) {
    return <AccessDenied />;
  }

  const inputCls =
    "w-full h-11 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 text-sm text-gray-700 dark:text-gray-200";

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t("plans.title")}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 transition-colors">{t("plans.description")}</p>
        </div>
        <div className="flex items-center gap-3">
          <PageGuideModal pageKey="plans" />
          {canEdit && (
            <button
              onClick={openCreate}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 min-h-[44px] bg-primary-600 text-white rounded-xl text-sm font-bold hover:bg-primary-700 transition-colors shadow-lg shadow-primary-200 dark:shadow-none"
            >
              <Plus className="w-4 h-4" />
              {t("plans.add_new")}
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("plans.search_placeholder")}
          className="w-full h-11 pl-10 pr-4 rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm text-gray-700 dark:text-gray-200"
        />
      </div>

      {/* List */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-3xl border border-gray-100 dark:border-slate-800 p-6 animate-pulse space-y-3">
              <div className="h-5 w-28 bg-gray-200 dark:bg-slate-700 rounded-md" />
              <div className="h-8 w-36 bg-gray-200 dark:bg-slate-700 rounded-lg" />
              <div className="h-3 w-full bg-gray-100 dark:bg-slate-800 rounded-md" />
              <div className="h-3 w-2/3 bg-gray-100 dark:bg-slate-800 rounded-md" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400 dark:text-gray-600">
          <Tag className="w-12 h-12 mx-auto mb-3" />
          <p className="text-sm font-semibold">{t("plans.no_data")}</p>
          <p className="text-[11px] mt-1">{t("plans.empty_desc")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filtered.map((plan) => (
            <div
              key={plan.id}
              className="rounded-3xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 p-6 shadow-sm hover:shadow-lg transition-all"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    {plan.name}
                    {plan.tier === "premium" && <Crown className="w-4 h-4 text-amber-500" />}
                  </p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{plan.slug}</p>
                </div>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ${
                    plan.is_active
                      ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"
                      : "bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-400"
                  }`}
                >
                  {plan.is_active ? t("plans.active") : t("plans.inactive")}
                </span>
              </div>
              <div className="mt-4 flex items-end gap-2">
                <span className="text-2xl font-extrabold text-gray-900 dark:text-gray-100">
                  {fmtMoney(plan.price_monthly)}
                </span>
                <span className="text-[11px] text-gray-400 mb-1">{t("plans.monthly")}</span>
                <span className="text-[11px] text-gray-400 mb-1 mx-1">·</span>
                <span className="text-[11px] text-gray-400 mb-1">{fmtMoney(plan.price_yearly)} {t("plans.yearly")}</span>
              </div>
              <p className="text-[11px] text-primary-500 mt-1">{t("pricing.trial_days", { days: plan.trial_days })}</p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2 line-clamp-2">{plan.description}</p>
              {canEdit && (
                <div className="mt-5 flex gap-2">
                  <button
                    onClick={() => openEdit(plan)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 min-h-[44px] bg-primary-50 dark:bg-primary-500/10 text-primary-600 dark:text-primary-400 rounded-xl text-xs font-bold hover:bg-primary-100 dark:hover:bg-primary-500/20 transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" /> {t("subscriptions.btn_update")}
                  </button>
                  <button
                    onClick={() => setDeleteTarget(plan)}
                    className="inline-flex items-center justify-center px-3 py-2 min-h-[44px] bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 rounded-xl text-xs font-bold hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-0 md:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white dark:bg-slate-900 w-full max-w-4xl h-full md:h-auto md:max-h-[95vh] md:rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                {editing ? t("plans.edit_title") : t("plans.create_title")}
              </h3>
              <button onClick={() => setModalOpen(false)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSave();
              }}
              className="flex-1 overflow-y-auto p-6 md:p-8"
            >
              {formError && (
                <div className="mb-5 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 p-4 text-sm text-red-600 dark:text-red-400">
                  {formError}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t("plans.name")}</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className={inputCls}
                  />
                  {fieldErrors.name && <p className="text-xs text-red-500 mt-1">{fieldErrors.name}</p>}
                </div>
                <div>
                  <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t("plans.slug")}</label>
                  <input
                    value={form.slug}
                    onChange={(e) => setForm({ ...form, slug: e.target.value })}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t("plans.tier")}</label>
                  <select
                    value={form.tier}
                    onChange={(e) => setForm({ ...form, tier: e.target.value })}
                    className={inputCls}
                  >
                    {["basic", "standard", "premium"].map((tr) => (
                      <option key={tr} value={tr}>
                        {tr}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t("plans.interval")}</label>
                  <select
                    value={form.billing_interval}
                    onChange={(e) => setForm({ ...form, billing_interval: e.target.value })}
                    className={inputCls}
                  >
                    <option value="monthly">{t("plans.monthly")}</option>
                    <option value="yearly">{t("plans.yearly")}</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t("plans.price_monthly")}</label>
                  <input
                    type="number"
                    min={0}
                    value={form.price_monthly}
                    onChange={(e) => setForm({ ...form, price_monthly: e.target.value })}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t("plans.price_yearly")}</label>
                  <input
                    type="number"
                    min={0}
                    value={form.price_yearly}
                    onChange={(e) => setForm({ ...form, price_yearly: e.target.value })}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t("plans.trial_days")}</label>
                  <input
                    type="number"
                    min={0}
                    value={form.trial_days}
                    onChange={(e) => setForm({ ...form, trial_days: e.target.value })}
                    className={inputCls}
                  />
                  {fieldErrors.trial_days && <p className="text-xs text-red-500 mt-1">{fieldErrors.trial_days}</p>}
                </div>
                <div>
                  <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t("plans.sort_order")}</label>
                  <input
                    type="number"
                    value={form.sort_order}
                    onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
                    className={inputCls}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t("plans.features")}</label>
                  <input
                    value={form.features}
                    onChange={(e) => setForm({ ...form, features: e.target.value })}
                    className={inputCls}
                    placeholder="Fast retail sync, GA report, ..."
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t("plans.feature_flags")}</label>
                  <input
                    value={form.feature_flags}
                    onChange={(e) => setForm({ ...form, feature_flags: e.target.value })}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t("plans.limits")}</label>
                  <textarea
                    rows={2}
                    value={form.limits}
                    onChange={(e) => setForm({ ...form, limits: e.target.value })}
                    className={inputCls}
                    placeholder='{"retailers": 500}'
                  />
                  {fieldErrors.limits && <p className="text-xs text-red-500 mt-1">{fieldErrors.limits}</p>}
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t("plans.field_description")}</label>
                  <textarea
                    rows={2}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className={inputCls}
                  />
                </div>
                <div className="md:col-span-2 flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="plan-active"
                    checked={form.is_active}
                    onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                    className="w-4 h-4 accent-primary-600"
                  />
                  <label htmlFor="plan-active" className="text-sm font-bold text-gray-700 dark:text-gray-300">
                    {t("plans.is_active")}
                  </label>
                </div>
              </div>
              <div className="mt-8 pt-6 border-t border-gray-100 dark:border-slate-800 flex gap-4">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-6 py-3 rounded-xl border border-gray-200 dark:border-slate-700 text-sm font-bold text-gray-600 dark:text-gray-300"
                >
                  {t("plans.btn_cancel")}
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-primary-600 text-white text-sm font-bold hover:bg-primary-700 transition-colors disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {editing ? t("plans.btn_update") : t("plans.btn_create")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        type="danger"
        title={t("plans.delete_title")}
        message={t("plans.delete_message")}
        confirmText={t("plans.delete_confirm")}
        loading={deleting}
      />
    </div>
  );
}