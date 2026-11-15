"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Building2,
  Check,
  CheckCircle2,
  Clock3,
  Crown,
  Loader2,
  LockKeyhole,
  Sparkles,
} from "lucide-react";
import { toast } from "react-hot-toast";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useEntitlements } from "@/context/EntitlementsContext";
import { useLanguage } from "@/i18n/useLanguage";
import PageGuideModal from "@/components/PageGuideModal";
import { AccessDenied } from "@/components/ui/AccessDenied";
import type { Plan, Subscription, HouseOption } from "@/types/billing";

const TIER_STYLES: Record<string, { ring: string; badge: string }> = {
  premium: { ring: "ring-2 ring-primary-500", badge: "bg-primary-600" },
  standard: { ring: "ring-1 ring-primary-200 dark:ring-primary-800", badge: "bg-primary-500" },
  basic: { ring: "", badge: "bg-slate-500" },
};

const getPlanFeatures = (plan: Plan) =>
  (plan.features || "")
    .split(",")
    .map((feature) => feature.trim())
    .filter(Boolean);

const formatMoney = (amount: number) => `৳${Number(amount).toLocaleString("en-BD")}`;

export default function PricingPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const { hasPermission, loading: authLoading, selectedHouse } = useAuth();
  const { refresh: refreshEntitlements } = useEntitlements();

  const [houses, setHouses] = useState<HouseOption[]>([]);
  const [houseId, setHouseId] = useState<number | null>(selectedHouse?.id ?? null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [current, setCurrent] = useState<Subscription | null>(null);
  const [interval, setInterval] = useState<"monthly" | "yearly">("monthly");
  const [checkoutPlan, setCheckoutPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<number | null>(null);

  const canView = hasPermission("plans.view");

  const houseHeader = useMemo(
    () => (houseId ? { "X-House-ID": String(houseId) } : {}),
    [houseId]
  );

  const selectedHouseOption = useMemo(
    () => houses.find((house) => house.id === houseId) ?? null,
    [houses, houseId]
  );

  const comparisonFeatures = useMemo(
    () => Array.from(new Set(plans.flatMap(getPlanFeatures))),
    [plans]
  );

  const loadHouses = useCallback(async () => {
    try {
      const res = await apiClient.get("houses/accessible");
      const list: HouseOption[] = res.data || [];
      setHouses(list);
      if (list.length > 0) {
        setHouseId((currentHouseId) => currentHouseId ?? selectedHouse?.id ?? list[0].id);
      }
    } catch {
      /* House loading is independent of the plan catalogue. */
    }
  }, [selectedHouse]);

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
      setCurrent(
        subData && typeof subData === "object" && Object.keys(subData).length
          ? subData
          : null
      );
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
    const subscription = current;
    if (
      subscription &&
      ["active", "trialing", "past_due", "paused"].includes(subscription.status) &&
      subscription.package
    ) {
      return subscription;
    }
    return null;
  }, [current]);

  const canSelectPlan = active
    ? hasPermission("subscription.upgrade")
    : hasPermission("subscription.create");

  const handleSubscribe = async () => {
    if (!checkoutPlan || !houseId) {
      toast.error(t("pricing.select_house_first"));
      return;
    }
    if (!canSelectPlan) {
      toast.error(t("pricing.action_not_allowed"));
      return;
    }
    setActionId(checkoutPlan.id);
    try {
      if (active && active.package?.id === checkoutPlan.id) {
        toast.error(t("pricing.already_on_plan"));
        return;
      }

      if (active) {
        const res = await apiClient.post(
          "v1/subscription/change-plan",
          { plan_id: checkoutPlan.id, billing_interval: interval },
          { headers: houseHeader }
        );
        void refreshEntitlements();
        if (res.data?.prorated_invoice?.id) {
          router.push("/billing");
          return;
        }
        const message = res.data?.is_upgrade ? t("pricing.upgrade") : t("pricing.downgrade");
        toast.success(`${message} — ${checkoutPlan.name}`);
        setCheckoutPlan(null);
        await loadData();
      } else {
        const res = await apiClient.post(
          "v1/subscription/select",
          { plan_id: checkoutPlan.id, billing_interval: interval, trial: true, auto_renew: true },
          { headers: houseHeader }
        );
        if (!res.data?.invoice?.id) {
          throw new Error(t("pricing.invoice_not_created"));
        }
        toast.success(t("pricing.invoice_created"));
        void refreshEntitlements();
        router.push("/billing");
      }
    } catch (err: any) {
      const errorCode =
        err?.response?.data?.error_code || err?.response?.data?.detail?.code;
      if (errorCode === "OPEN_INVOICE_EXISTS") {
        toast(t("pricing.open_invoice_redirect"));
        router.push(`/billing?house_id=${houseId}`);
        return;
      }
      toast.error(err?.message || t("pricing.something_went_wrong"));
    } finally {
      setActionId(null);
    }
  };

  if (!authLoading && !canView) {
    return <AccessDenied />;
  }

  const yearlySavings =
    checkoutPlan && interval === "yearly"
      ? Math.max(0, checkoutPlan.price_monthly * 12 - checkoutPlan.price_yearly)
      : 0;
  const selectedPrice = checkoutPlan
    ? interval === "monthly"
      ? checkoutPlan.price_monthly
      : checkoutPlan.price_yearly
    : 0;

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-1 pb-10 animate-in fade-in duration-500">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {checkoutPlan ? t("pricing.checkout_title") : t("pricing.title")}
            </h1>
            <PageGuideModal pageKey="pricing" />
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {checkoutPlan ? t("pricing.checkout_description") : t("pricing.description")}
          </p>
        </div>
        {houses.length > 1 && (
          <label className="flex w-full flex-col gap-1.5 sm:w-auto">
            <span className="text-xs font-bold text-gray-600 dark:text-gray-300">
              {t("pricing.house")}
            </span>
            <select
              value={houseId ?? ""}
              onChange={(event) => {
                setHouseId(event.target.value ? Number(event.target.value) : null);
                setCheckoutPlan(null);
              }}
              className="h-11 min-w-56 cursor-pointer rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-700 dark:border-slate-800 dark:bg-slate-900 dark:text-gray-200"
            >
              {houses.map((house) => (
                <option key={house.id} value={house.id}>
                  {house.display_name || `${house.name} (${house.code})`}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {!houseId ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center text-sm font-semibold text-amber-700 dark:border-slate-800 dark:bg-slate-900 dark:text-amber-300">
          {t("pricing.select_house_first")}
        </div>
      ) : checkoutPlan ? (
        <section className="space-y-6">
          <button
            type="button"
            onClick={() => setCheckoutPlan(null)}
            className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 text-sm font-bold text-gray-700 transition-colors hover:bg-gray-50 dark:border-slate-800 dark:bg-slate-900 dark:text-gray-200 dark:hover:bg-slate-800"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("pricing.back_to_plans")}
          </button>

          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.9fr)]">
            <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-7">
              <div className="mb-6 flex items-start gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-300">
                  <Building2 className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                    {t("pricing.checkout_details")}
                  </h2>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    {t("pricing.checkout_details_description")}
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-gray-100 bg-gray-50/80 p-4 dark:border-slate-800 dark:bg-slate-800/50">
                <p className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t("pricing.house")}
                </p>
                <p className="mt-1 font-bold text-gray-900 dark:text-gray-100">
                  {selectedHouseOption?.display_name ||
                    selectedHouseOption?.name ||
                    current?.house_name ||
                    "—"}
                </p>
              </div>

              <div className="mt-4 flex items-start gap-3 rounded-2xl border border-primary-100 bg-primary-50/60 p-4 dark:border-primary-900/60 dark:bg-primary-950/30">
                <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary-600 dark:text-primary-300" />
                <div>
                  <p className="font-bold text-gray-900 dark:text-gray-100">
                    {checkoutPlan.name}
                  </p>
                  {checkoutPlan.description && (
                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                      {checkoutPlan.description}
                    </p>
                  )}
                  {checkoutPlan.trial_days > 0 && (
                    <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-primary-700 dark:text-primary-300">
                      <Clock3 className="h-3.5 w-3.5" />
                      {t("pricing.trial_days", { days: checkoutPlan.trial_days })}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50/80 p-4 text-sm leading-relaxed text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/5 dark:text-amber-200">
                {t("pricing.manual_payment_notice")}
              </div>
            </section>

            <aside className="order-first rounded-3xl border border-gray-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 lg:order-last sm:p-7">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  {t("pricing.order_summary")}
                </h2>
                <span className="rounded-full bg-primary-50 px-2.5 py-1 text-[11px] font-bold text-primary-700 dark:bg-primary-500/10 dark:text-primary-300">
                  {checkoutPlan.name}
                </span>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1 dark:bg-slate-800">
                {(["monthly", "yearly"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setInterval(value)}
                    aria-pressed={interval === value}
                    className={`min-h-10 cursor-pointer rounded-lg px-3 text-sm font-bold transition-colors ${
                      interval === value
                        ? "bg-white text-primary-700 shadow-sm dark:bg-slate-700 dark:text-primary-200"
                        : "text-gray-500 dark:text-gray-400"
                    }`}
                  >
                    {t(value === "monthly" ? "pricing.monthly" : "pricing.yearly")}
                  </button>
                ))}
              </div>

              <div className="mt-5 flex items-center justify-between gap-3 text-sm">
                <span className="font-semibold text-gray-700 dark:text-gray-300">
                  {checkoutPlan.name} ·{" "}
                  {t(interval === "monthly" ? "pricing.monthly" : "pricing.yearly")}
                </span>
                <span className="font-bold text-gray-900 dark:text-gray-100">
                  {formatMoney(selectedPrice)}
                </span>
              </div>
              {yearlySavings > 0 && (
                <div className="mt-3 flex items-center justify-between gap-3 text-sm text-emerald-700 dark:text-emerald-400">
                  <span>{t("pricing.yearly_savings")}</span>
                  <span className="font-bold">−{formatMoney(yearlySavings)}</span>
                </div>
              )}
              <div className="my-5 border-t border-gray-100 dark:border-slate-800" />
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-bold text-gray-900 dark:text-gray-100">
                  {t("pricing.total_due")}
                </span>
                <span className="text-2xl font-extrabold tracking-tight text-primary-700 dark:text-primary-300">
                  {formatMoney(selectedPrice)}
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                {t("pricing.invoice_amount_note")}
              </p>

              <button
                type="button"
                onClick={handleSubscribe}
                disabled={actionId === checkoutPlan.id || !canSelectPlan}
                className="mt-6 inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-primary-200 transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50 dark:shadow-none"
              >
                {actionId === checkoutPlan.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    {canSelectPlan
                      ? t("pricing.continue_to_billing")
                      : t("pricing.action_not_allowed")}
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>

              <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-[11px] text-gray-500 dark:text-gray-400">
                <LockKeyhole className="h-3.5 w-3.5" />
                {t("pricing.secure_checkout")}
              </p>
            </aside>
          </div>

          <div className="flex items-start gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/5 dark:text-emerald-300">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{t("pricing.payment_review_notice")}</p>
          </div>
        </section>
      ) : (
        <>
          <section className="overflow-hidden rounded-[2rem] border border-primary-100 bg-gradient-to-br from-white via-primary-50/60 to-sky-50 px-5 py-9 text-center dark:border-slate-800 dark:from-slate-900 dark:via-slate-900 dark:to-primary-950/20 sm:px-8 sm:py-12">
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-primary-700 dark:text-primary-300">
              {t("pricing.hero_eyebrow")}
            </p>
            <h2 className="mx-auto mt-3 max-w-3xl text-3xl font-extrabold leading-tight tracking-tight text-gray-900 dark:text-gray-100 sm:text-4xl">
              {t("pricing.hero_title")}
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-gray-600 dark:text-gray-300 sm:text-base">
              {t("pricing.hero_description")}
            </p>
            <div className="mt-6 inline-flex rounded-xl border border-gray-200 bg-white/90 p-1 shadow-sm dark:border-slate-700 dark:bg-slate-900">
              {(["monthly", "yearly"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setInterval(value)}
                  aria-pressed={interval === value}
                  className={`min-h-11 cursor-pointer rounded-lg px-4 text-sm font-bold transition-colors ${
                    interval === value
                      ? "bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-200"
                      : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                  }`}
                >
                  {t(value === "monthly" ? "pricing.monthly" : "pricing.yearly")}
                </button>
              ))}
            </div>
          </section>

          {active && (
            <div className="flex items-start gap-3 rounded-2xl border border-primary-100 bg-primary-50/60 px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
              <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-primary-600 dark:text-primary-300" />
              <div>
                <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
                  {t("pricing.current_plan")}:{" "}
                  <span className="text-primary-700 dark:text-primary-300">
                    {active.package?.name}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  {t("billing.status")}: {active.effective_status || active.status}
                </p>
              </div>
            </div>
          )}

          {loading ? (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  className="space-y-4 rounded-3xl border border-gray-100 bg-white p-6 animate-pulse dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="h-5 w-28 rounded-md bg-gray-200 dark:bg-slate-700" />
                  <div className="h-10 w-40 rounded-lg bg-gray-200 dark:bg-slate-700" />
                  <div className="space-y-2">
                    {[0, 1, 2, 3].map((row) => (
                      <div key={row} className="h-3 w-full rounded-md bg-gray-100 dark:bg-slate-800" />
                    ))}
                  </div>
                  <div className="h-11 w-full rounded-xl bg-gray-200 dark:bg-slate-700" />
                </div>
              ))}
            </div>
          ) : plans.length === 0 ? (
            <div className="rounded-3xl border border-gray-100 bg-white py-16 text-center text-gray-500 dark:border-slate-800 dark:bg-slate-900 dark:text-gray-400">
              <Crown className="mx-auto mb-3 h-12 w-12 text-gray-300 dark:text-slate-700" />
              <p className="text-sm font-semibold">{t("plans.no_data")}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 items-stretch gap-5 md:grid-cols-2 xl:grid-cols-3">
              {plans.map((plan) => {
                const tier = (plan.tier || "").toLowerCase();
                const style = TIER_STYLES[tier] || TIER_STYLES.basic;
                const price =
                  interval === "monthly" ? plan.price_monthly : plan.price_yearly;
                const isCurrent = active?.package?.id === plan.id;
                const savings =
                  interval === "yearly"
                    ? Math.max(0, plan.price_monthly * 12 - plan.price_yearly)
                    : 0;

                return (
                  <article
                    key={plan.id}
                    className={`relative flex flex-col rounded-3xl border border-gray-100 bg-white p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-xl dark:border-slate-800 dark:bg-slate-900 sm:p-7 ${style.ring}`}
                  >
                    {tier === "premium" && (
                      <span className={`absolute -top-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-bold text-white shadow ${style.badge}`}>
                        <Sparkles className="h-3.5 w-3.5" />
                        {t("pricing.popular")}
                      </span>
                    )}
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-xl font-extrabold text-gray-900 dark:text-gray-100">
                          {plan.name}
                        </h3>
                        {plan.description && (
                          <p className="mt-2 min-h-10 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
                            {plan.description}
                          </p>
                        )}
                      </div>
                      {isCurrent && (
                        <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                          {t("pricing.current")}
                        </span>
                      )}
                    </div>

                    <div className="mt-5">
                      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="text-3xl font-extrabold tracking-tight text-gray-900 dark:text-gray-100">
                          {formatMoney(price)}
                        </span>
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                          / {t(interval === "monthly" ? "pricing.per_month" : "pricing.per_year")}
                        </span>
                      </p>
                      {savings > 0 ? (
                        <p className="mt-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                          {t("pricing.yearly_savings_amount", { amount: formatMoney(savings) })}
                        </p>
                      ) : plan.trial_days > 0 ? (
                        <p className="mt-1 text-xs font-semibold text-primary-700 dark:text-primary-300">
                          {t("pricing.trial_days", { days: plan.trial_days })}
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {t("pricing.standard_billing")}
                        </p>
                      )}
                    </div>

                    {plan.limits?.max_users != null && (
                      <div className="mt-5 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 text-center text-xs font-bold text-gray-700 dark:border-slate-800 dark:bg-slate-800/60 dark:text-gray-200">
                        {t("pricing.user_limit", { count: plan.limits.max_users })}
                      </div>
                    )}

                    <div className="my-5 border-t border-gray-100 dark:border-slate-800" />
                    <p className="mb-3 text-[11px] font-extrabold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                      {t("pricing.features_title")}
                    </p>
                    <ul className="mb-7 flex-1 space-y-3">
                      {getPlanFeatures(plan).map((feature, index) => (
                        <li
                          key={`${plan.id}-${index}`}
                          className="flex items-start gap-2.5 text-sm text-gray-700 dark:text-gray-300"
                        >
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                          <span>{feature}</span>
                        </li>
                      ))}
                      {getPlanFeatures(plan).length === 0 && (
                        <li className="text-sm text-gray-400 dark:text-gray-500">
                          {t("pricing.no_features")}
                        </li>
                      )}
                    </ul>

                    <button
                      type="button"
                      onClick={() => {
                        if (!isCurrent && canSelectPlan) setCheckoutPlan(plan);
                      }}
                      disabled={isCurrent || !canSelectPlan}
                      className={`inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                        isCurrent
                          ? "border border-gray-200 bg-gray-50 text-gray-500 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-400"
                          : tier === "basic"
                            ? "border border-gray-200 bg-white text-gray-800 hover:border-primary-300 hover:bg-primary-50 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100 dark:hover:bg-slate-800"
                            : "bg-primary-600 text-white shadow-lg shadow-primary-200 hover:bg-primary-700 dark:shadow-none"
                      }`}
                    >
                      {isCurrent
                        ? t("pricing.current")
                        : canSelectPlan
                          ? t("pricing.select_plan")
                          : t("pricing.action_not_allowed")}
                      {!isCurrent && canSelectPlan && <ArrowRight className="h-4 w-4" />}
                    </button>
                  </article>
                );
              })}
            </div>
          )}

          {!loading && plans.length > 0 && comparisonFeatures.length > 0 && (
            <section className="overflow-hidden rounded-3xl border border-gray-100 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="border-b border-gray-100 px-5 py-4 dark:border-slate-800 sm:px-6">
                <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                  {t("pricing.compare_title")}
                </h2>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {t("pricing.compare_description")}
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] border-collapse text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-gray-800 dark:bg-slate-800/70 dark:text-gray-100">
                      <th className="px-2 py-1 text-left font-bold">{t("pricing.features_title")}</th>
                      {plans.map((plan) => (
                        <th key={plan.id} className="px-2 py-1 text-center font-bold">
                          {plan.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-gray-100 dark:border-slate-800">
                      <td className="px-2 py-1 text-gray-600 dark:text-gray-300">
                        {t("pricing.trial_included")}
                      </td>
                      {plans.map((plan) => (
                        <td key={plan.id} className="px-2 py-1 text-center text-gray-700 dark:text-gray-200">
                          {plan.trial_days > 0
                            ? t("pricing.trial_days", { days: plan.trial_days })
                            : "—"}
                        </td>
                      ))}
                    </tr>
                    {comparisonFeatures.map((feature) => (
                      <tr key={feature} className="border-t border-gray-100 dark:border-slate-800">
                        <td className="px-2 py-1 text-gray-600 dark:text-gray-300">{feature}</td>
                        {plans.map((plan) => {
                          const included = getPlanFeatures(plan).includes(feature);
                          return (
                            <td key={plan.id} className="px-2 py-1 text-center">
                              {included ? (
                                <Check className="mx-auto h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                              ) : (
                                <span className="text-gray-300 dark:text-gray-600">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <div className="flex items-center justify-center gap-2 text-center text-xs text-gray-500 dark:text-gray-400">
            <LockKeyhole className="h-4 w-4 shrink-0" />
            {t("pricing.secure_checkout")}
          </div>
        </>
      )}
    </div>
  );
}
