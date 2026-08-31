"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Crown, Loader2, Sparkles, Building2 } from "lucide-react";
import { toast } from "react-hot-toast";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import PageGuideModal from "@/components/PageGuideModal";
import { AccessDenied } from "@/components/ui/AccessDenied";
import type { Plan, Subscription, HouseOption } from "@/types/billing";

const TIER_STYLES: Record<string, { ring: string; badge: string }> = {
  premium: { ring: "ring-2 ring-amber-400", badge: "bg-amber-500" },
  standard: { ring: "ring-1 ring-primary-300 dark:ring-primary-700", badge: "bg-primary-500" },
  basic: { ring: "", badge: "bg-slate-400" },
};

export default function PricingPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const { hasPermission, loading: authLoading, selectedHouse } = useAuth();

  const [houses, setHouses] = useState<HouseOption[]>([]);
  const [houseId, setHouseId] = useState<number | null>(selectedHouse?.id ?? null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [current, setCurrent] = useState<Subscription | null>(null);
  const [interval, setInterval] = useState<"monthly" | "yearly">("monthly");
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<number | null>(null);

  const canView = hasPermission("plans.view");

  const houseHeader = useMemo(
    () => (houseId ? { "X-House-ID": String(houseId) } : {}),
    [houseId]
  );

  const loadHouses = useCallback(async () => {
    try {
      const res = await apiClient.get("houses/accessible");
      const list: HouseOption[] = res.data || [];
      setHouses(list);
      if (!houseId && list.length > 0) setHouseId(selectedHouse?.id ?? list[0].id);
    } catch {
      /* house load failure is non-fatal */
    }
  }, [houseId, selectedHouse]);

  const loadData = useCallback(async () => {
    if (!houseId) return;
    setLoading(true);
    try {
      const headers = { "X-House-ID": String(houseId) };
      const [plansRes, subRes] = await Promise.all([
        apiClient.get("v1/plans", { params: { active_only: true, per_page: 100 } }),
        apiClient.get("v1/subscription/current", { headers }).catch(() => null),
      ]);
      setPlans(plansRes.data?.data || []);
      const subData = subRes?.data;
      setCurrent(subData && typeof subData === "object" && Object.keys(subData).length ? subData : null);
    } finally {
      setLoading(false);
    }
  }, [houseId]);

  useEffect(() => {
    if (authLoading) return;
    loadHouses();
  }, [authLoading, loadHouses]);

  useEffect(() => {
    if (authLoading) return;
    loadData();
  }, [authLoading, houseId, loadData]);

  useEffect(() => {
    if (!authLoading && !canView) {
      const timer = setTimeout(() => router.push("/"), 5000);
      return () => clearTimeout(timer);
    }
  }, [authLoading, canView, router]);

  const active = useMemo(() => {
    const s = current;
    if (
      s &&
      (s.status === "active" || s.status === "trialing" || s.status === "past_due" || s.status === "paused") &&
      s.package
    ) {
      return s;
    }
    return null;
  }, [current]);

  const handleSubscribe = async (plan: Plan) => {
    if (!houseId) {
      toast.error(t("pricing.select_house_first"));
      return;
    }
    setActionId(plan.id);
    try {
      if (active && active.package && active.package.id === plan.id) {
        toast.error(t("pricing.already_on_plan"));
        return;
      }
      if (active) {
        const res = await apiClient.post(
          "v1/subscription/change-plan",
          { plan_id: plan.id, billing_interval: interval },
          { headers: houseHeader }
        );
        const m = res.data?.is_upgrade ? t("pricing.upgrade") : t("pricing.downgrade");
        toast.success(`${m} — ${plan.name}`);
      } else {
        const res = await apiClient.post(
          "v1/subscription/select",
          { plan_id: plan.id, billing_interval: interval, trial: true, auto_renew: true },
          { headers: houseHeader }
        );
        toast.success(t("pricing.toast_purchase_success"));
        if (res.data?.invoice?.id) {
          router.push("/billing");
          return;
        }
      }
      await loadData();
      if (interval === "monthly" && (active || current)) setInterval("monthly");
    } catch (err: any) {
      toast.error(err?.message || t("pricing.something_went_wrong"));
    } finally {
      setActionId(null);
    }
  };

  if (!authLoading && !canView) {
    return <AccessDenied />;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t("pricing.title")}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 transition-colors">{t("pricing.description")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <PageGuideModal pageKey="pricing" />
          <select
            value={houseId ?? ""}
            onChange={(e) => setHouseId(e.target.value ? Number(e.target.value) : null)}
            className="h-10 rounded-lg border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 text-sm text-gray-700 dark:text-gray-200"
          >
            {houses.length === 0 && <option value="">{t("pricing.select_house_first")}</option>}
            {houses.map((h) => (
              <option key={h.id} value={h.id}>
                {h.display_name || `${h.name} (${h.code})`}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Current plan banner */}
      <div className="flex items-start gap-3 rounded-2xl border border-primary-100 dark:border-slate-800 bg-primary-50/50 dark:bg-slate-900 px-4 py-3">
        <Building2 className="w-5 h-5 text-primary-500 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
            {t("pricing.current_plan")}:
            {active ? (
              <span className="ml-2 text-primary-600 dark:text-primary-400">{active.package?.name}</span>
            ) : (
              <span className="ml-2 text-gray-400">{t("pricing.no_active_plan")}</span>
            )}
          </p>
          {active && active.package && (
            <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
              {t("billing.status")}: {active.effective_status || active.status} ·{" "}
              {t("billing.period")}: {active.start_date?.slice(0, 10)} → {active.end_date?.slice(0, 10)}
            </p>
          )}
        </div>
      </div>

      {/* Interval toggle */}
      <div className="flex items-center gap-4">
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">{t("pricing.billing_interval")}:</p>
        <div className="inline-flex rounded-xl bg-gray-100 dark:bg-slate-800 p-1 gap-1">
          {(["monthly", "yearly"] as const).map((it) => (
            <button
              key={it}
              onClick={() => setInterval(it)}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${
                interval === it
                  ? "bg-white dark:bg-slate-700 text-primary-600 dark:text-primary-300 shadow-sm"
                  : "text-gray-500 dark:text-gray-400"
              }`}
            >
              {t(it === "monthly" ? "pricing.monthly" : "pricing.yearly")}
            </button>
          ))}
        </div>
      </div>

      {/* Plans grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-3xl border border-gray-100 dark:border-slate-800 p-8 animate-pulse space-y-4">
              <div className="h-5 w-24 bg-gray-200 dark:bg-slate-700 rounded-md" />
              <div className="h-10 w-40 bg-gray-200 dark:bg-slate-700 rounded-lg" />
              <div className="space-y-2">
                {[0, 1, 2, 3].map((n) => (
                  <div key={n} className="h-3 w-full bg-gray-100 dark:bg-slate-800 rounded-md" />
                ))}
              </div>
              <div className="h-11 w-full bg-gray-200 dark:bg-slate-700 rounded-xl" />
            </div>
          ))}
        </div>
      ) : plans.length === 0 ? (
        <div className="text-center py-20 text-gray-400 dark:text-gray-600">
          <Crown className="w-12 h-12 mx-auto mb-3" />
          <p className="text-sm font-semibold">{t("plans.no_data")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {plans.map((plan) => {
            const tier = (plan.tier || "").toLowerCase();
            const style = TIER_STYLES[tier] || TIER_STYLES.basic;
            const price = interval === "monthly" ? plan.price_monthly : plan.price_yearly;
            const isCurrent = active?.package?.id === plan.id;
            return (
              <div
                key={plan.id}
                className={`relative rounded-3xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 p-8 shadow-sm hover:shadow-lg transition-all ${style.ring}`}
              >
                {tier === "premium" && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 rounded-full bg-amber-500 text-white text-[11px] font-bold px-3 py-1 shadow">
                    <Sparkles className="w-3 h-3" /> {plan.name}
                  </div>
                )}
                {tier !== "premium" && (
                  <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{plan.name}</h3>
                )}
                <div className="mt-4 flex items-end gap-2">
                  <span className="text-3xl font-extrabold text-gray-900 dark:text-gray-100">
                    ৳{Number(price).toLocaleString()}
                  </span>
                  <span className="text-sm text-gray-400 mb-1.5">
                    / {interval === "monthly" ? t("pricing.per_month") : t("pricing.per_year")}
                  </span>
                </div>
                {plan.trial_days > 0 && (
                  <p className="mt-1 text-[11px] text-primary-500 font-semibold">
                    {t("pricing.trial_days", { days: plan.trial_days })}
                  </p>
                )}
                {plan.description && (
                  <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">{plan.description}</p>
                )}
                <ul className="mt-6 space-y-3">
                  {(plan.features || "")
                    .split(",")
                    .filter(Boolean)
                    .map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-300">
                        <Check className="w-4 h-4 text-primary-500 shrink-0 mt-0.5" />
                        {f.trim()}
                      </li>
                    ))}
                </ul>
                <button
                  onClick={() => handleSubscribe(plan)}
                  disabled={actionId === plan.id}
                  className={`mt-8 w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold transition-colors disabled:opacity-50 ${
                    isCurrent
                      ? "bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400"
                      : "bg-primary-600 text-white hover:bg-primary-700 shadow-lg shadow-primary-200 dark:shadow-none"
                  }`}
                >
                  {actionId === plan.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : isCurrent ? (
                    t("pricing.current")
                  ) : active ? (
                    t("pricing.change_plan")
                  ) : (
                    t("pricing.subscribe")
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}