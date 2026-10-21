"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, ArrowUpRight, Lock, LogOut } from "lucide-react";
import { useLanguage } from "@/i18n/useLanguage";
import { useAuth } from "@/context/AuthContext";

type BlockCode = "SUBSCRIPTION_EXPIRED" | "HOUSE_INACTIVE";

interface BlockInfo {
  code: BlockCode;
  houseId?: number | null;
}

/** Pages that must stay reachable so a blocked house can renew / log out. */
const ALLOWED_PREFIXES = [
  "/billing",
  "/pricing",
  "/profile",
  "/settings",
  "/login",
  "/maintenance",
  "/admin",
];

/**
 * Global gate for houses whose subscription expired / was deactivated.
 *
 * The backend (`PlanModuleGuard`) is authoritative and blocks every API call
 * for those houses; `api.ts` re-broadcasts the 403 as a `house-access-blocked`
 * event. This overlay gives the user a clear explanation and a route to billing
 * instead of a stream of failed requests.
 */
export function SubscriptionGate() {
  const [block, setBlock] = useState<BlockInfo | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useLanguage();
  const { logout, hasPermission } = useAuth();

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<BlockInfo>).detail;
      if (!detail?.code) return;
      setBlock({ code: detail.code, houseId: detail.houseId ?? null });
    };
    window.addEventListener("house-access-blocked", handler);
    return () => window.removeEventListener("house-access-blocked", handler);
  }, []);

  const allowedPath = ALLOWED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  if (!block || allowedPath) return null;

  const expired = block.code === "SUBSCRIPTION_EXPIRED";
  const title = expired
    ? t("common.subscription_expired_title")
    : t("common.house_inactive_title");
  const message = expired
    ? t("common.subscription_expired_message")
    : t("common.house_inactive_message");

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="house-access-gate-title"
      className="fixed inset-0 z-[400] flex items-center justify-center bg-gray-950/60 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-md rounded-2xl border border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl p-6 sm:p-8 text-center">
        <div
          className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl ${
            expired
              ? "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400"
              : "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400"
          }`}
        >
          {expired ? <Lock className="h-7 w-7" /> : <AlertTriangle className="h-7 w-7" />}
        </div>

        <h2
          id="house-access-gate-title"
          className="mt-4 text-xl font-bold text-gray-900 dark:text-gray-100"
        >
          {title}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
          {message}
        </p>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          {(hasPermission("billing.view") || hasPermission("subscription.view")) && (
            <button
              type="button"
              onClick={() => router.push("/billing")}
              className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
            >
              {t("common.go_to_billing")}
              <ArrowUpRight className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={logout}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-200 dark:hover:bg-slate-700"
          >
            <LogOut className="h-4 w-4" />
            {t("common.logout")}
          </button>
        </div>
      </div>
    </div>
  );
}
