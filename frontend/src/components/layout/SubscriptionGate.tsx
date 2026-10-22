"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  CreditCard,
  Loader2,
  Lock,
  LogOut,
  RefreshCw,
} from "lucide-react";
import { useLanguage } from "@/i18n/useLanguage";
import { useAuth } from "@/context/AuthContext";
import { useEntitlements } from "@/context/EntitlementsContext";
import type { HouseAccessBlock, HouseAccessCode } from "@/types/billing";

/** Pages that must stay reachable so a blocked house can renew / log out. */
const ALLOWED_PREFIXES = [
  "/billing",
  "/pricing",
  "/profile",
  "/settings",
  "/login",
  "/register",
  "/setup",
  "/forgot-password",
  "/reset-password",
  "/maintenance",
  "/admin",
];

const BLOCK_KEYS: Record<
  HouseAccessCode,
  {
    title: string;
    message: string;
    icon: typeof Lock;
    tone: "amber" | "red";
    primary: { label: string; href: string } | null;
  }
> = {
  SUBSCRIPTION_REQUIRED: {
    title: "common.access_blocked_title_no_plan",
    message: "common.access_blocked_message_no_plan",
    icon: CreditCard,
    tone: "amber",
    primary: { label: "common.access_blocked_choose_plan", href: "/billing" },
  },
  SUBSCRIPTION_EXPIRED: {
    title: "common.access_blocked_title_expired",
    message: "common.access_blocked_message_expired",
    icon: CalendarClock,
    tone: "red",
    primary: { label: "common.access_blocked_renew", href: "/billing" },
  },
  HOUSE_INACTIVE: {
    title: "common.access_blocked_title_inactive",
    message: "common.access_blocked_message_inactive",
    icon: AlertTriangle,
    tone: "amber",
    primary: null,
  },
};

const TONE = {
  amber: {
    chip: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400",
    ring: "ring-amber-500/20",
  },
  red: {
    chip: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400",
    ring: "ring-red-500/20",
  },
};

const fmtDate = (value?: string | null) =>
  value ? String(value).slice(0, 10) : null;

/**
 * Global gate for houses that may not use the product at all.
 *
 * Deny-by-default policy (backend `PlanModuleGuard` is authoritative):
 *   - no plan assigned  -> SUBSCRIPTION_REQUIRED
 *   - plan expired      -> SUBSCRIPTION_EXPIRED
 *   - house deactivated -> HOUSE_INACTIVE
 *
 * Two sources feed it:
 *   1. `EntitlementsContext.accessBlock` — proactive, read on page load so the
 *      user sees one explanation instead of a wall of failed requests.
 *   2. `house-access-blocked` window event — raised by `api.ts` when a live
 *      request comes back 403 (covers a plan expiring mid-session).
 *
 * The overlay always states *why*: the house, the plan and its expiry date.
 *
 * When the house is blocked the app shell is **not mounted at all** — that
 * stops the dashboard from firing a burst of doomed API calls (and the toasts
 * that come with them) behind the overlay. Billing, plans and profile stay
 * mounted so the tenant can renew or pick a plan.
 */
export function SubscriptionGate({ children }: { children?: ReactNode }) {
  const [instantBlock, setInstantBlock] = useState<HouseAccessBlock | null>(null);
  const [checking, setChecking] = useState(false);
  const lastRefreshRef = useRef(0);
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useLanguage();
  const { logout, user } = useAuth();
  const { accessBlock, entitlements, refresh } = useEntitlements();

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<HouseAccessBlock>).detail;
      if (!detail?.code) return;
      setInstantBlock(detail);
      // Re-read the authoritative state; the event only fast-paths the overlay.
      // Throttled: a blocked page fires several requests at once, and one
      // refresh is enough to learn the real state.
      const now = Date.now();
      if (now - lastRefreshRef.current > 1500) {
        lastRefreshRef.current = now;
        void refresh();
      }
    };
    window.addEventListener("house-access-blocked", handler);
    return () => window.removeEventListener("house-access-blocked", handler);
  }, [refresh]);

  // Drop the optimistic (event) block once fresh entitlements say we are clear
  // — e.g. the tenant renewed while this overlay was showing.
  useEffect(() => {
    if (entitlements && !accessBlock) setInstantBlock(null);
  }, [entitlements, accessBlock]);

  const block = accessBlock ?? instantBlock;
  const allowedPath = ALLOWED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  if (!user || !block || allowedPath) return <>{children}</>;

  const config = BLOCK_KEYS[block.code] ?? BLOCK_KEYS.SUBSCRIPTION_REQUIRED;
  const tone = TONE[config.tone];
  const Icon = config.icon;
  const houseLabel = block.houseName || t("common.access_blocked_this_house");
  const expiredOn = fmtDate(block.planEndDate);

  const details: { label: string; value: string }[] = [];
  if (block.houseName) {
    details.push({ label: t("common.access_blocked_house"), value: block.houseName });
  }
  if (block.planName) {
    details.push({ label: t("common.access_blocked_plan"), value: block.planName });
  }
  if (expiredOn) {
    details.push({
      label: t("common.access_blocked_expiry"),
      value:
        block.daysRemaining && block.daysRemaining > 0
          ? t("common.access_blocked_days_left", {
              date: expiredOn,
              days: block.daysRemaining,
            })
          : expiredOn,
    });
  }

  const checkAgain = async () => {
    setChecking(true);
    setInstantBlock(null);
    try {
      await refresh();
    } finally {
      setChecking(false);
    }
  };

  const primaryHref = config.primary?.href ?? null;
  const primaryLabel = config.primary?.label ?? null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="house-access-gate-title"
      aria-describedby="house-access-gate-message"
      className="fixed inset-0 z-[400] flex items-center justify-center overflow-y-auto bg-gray-950/60 p-4 backdrop-blur-sm"
    >
      <div className="my-auto w-full max-w-lg rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-2xl dark:border-slate-800 dark:bg-slate-900 sm:p-8">
        <div
          className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl ring-8 ${tone.chip} ${tone.ring}`}
        >
          <Icon className="h-7 w-7" />
        </div>

        <h2
          id="house-access-gate-title"
          className="mt-5 text-xl font-bold text-gray-900 dark:text-gray-100"
        >
          {t(config.title)}
        </h2>
        <p
          id="house-access-gate-message"
          className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400"
        >
          {t(config.message, { house: houseLabel })}
        </p>

        {details.length > 0 && (
          <dl className="mt-5 divide-y divide-gray-100 rounded-xl border border-gray-100 bg-gray-50/70 text-left dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-800/40">
            {details.map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <dt className="text-[11px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {row.label}
                </dt>
                <dd className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        <p className="mt-4 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          {block.code === "SUBSCRIPTION_REQUIRED"
            ? t("common.access_blocked_hint_no_plan")
            : t("common.access_blocked_hint_generic")}
        </p>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          {primaryHref && primaryLabel && (
            <button
              type="button"
              onClick={() => router.push(primaryHref)}
              className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
            >
              {t(primaryLabel)}
              <ArrowUpRight className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={checkAgain}
            disabled={checking}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-200 dark:hover:bg-slate-700"
          >
            {checking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            {t("common.access_blocked_check_again")}
          </button>
          <button
            type="button"
            onClick={logout}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-gray-400 dark:hover:bg-slate-800 dark:hover:text-gray-200"
          >
            <LogOut className="h-4 w-4" />
            {t("common.logout")}
          </button>
        </div>
      </div>
    </div>
  );
}
