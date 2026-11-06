"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AlertTriangle, CalendarClock, ShieldAlert } from "lucide-react";
import { useLanguage } from "@/i18n/useLanguage";
import { useMaintenance } from "@/context/MaintenanceContext";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";

interface ExpiringSubscription {
  house_id: number;
  house_name: string | null;
  house_code: string | null;
  plan_name: string;
  expires_at: string;
  expired: boolean;
  deadline_local: number;
}

interface ExpiringSubscriptionsResponse {
  server_now: string;
  data: Omit<ExpiringSubscription, "deadline_local">[];
}

function formatExpiryCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return days > 0
    ? `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Non-dismissible top notification shown to EVERY session (including Super
 * Admins and anonymous visitors) while maintenance is pending or active. It
 * can also stack multiple subscription-expiry warnings with the maintenance
 * notice so neither notification replaces the other.
 *
 * The measured height is published as `--maintenance-banner-h` on <html> plus
 * the `maintenance-banner-active` class so sticky headers and the page body
 * offset below the banner (see globals.css).
 */
export function MaintenanceBanner() {
  const { phase, timeLeft, status } = useMaintenance();
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  const [expiringSubscriptions, setExpiringSubscriptions] = useState<ExpiringSubscription[]>([]);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!user?.id) {
      setExpiringSubscriptions([]);
      return;
    }

    let cancelled = false;
    const fetchExpiries = async () => {
      try {
        const response = await apiClient.get<ExpiringSubscriptionsResponse>(
          "v1/subscription/expiring-soon"
        );
        if (cancelled) return;
        const receivedAt = Date.now();
        const serverNow = Date.parse(response.data.server_now);
        const warnings = Number.isFinite(serverNow)
          ? response.data.data.flatMap((item) => {
              const expiresAt = Date.parse(item.expires_at);
              if (!Number.isFinite(expiresAt)) return [];
              return [{
                ...item,
                deadline_local: receivedAt + (expiresAt - serverNow),
              }];
            })
          : [];
        setExpiringSubscriptions(warnings);
        setNow(receivedAt);
      } catch {
        // Keep the last known countdown during transient API failures.
      }
    };

    void fetchExpiries();
    const interval = window.setInterval(fetchExpiries, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [user?.id]);

  useEffect(() => {
    if (expiringSubscriptions.length === 0) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [expiringSubscriptions.length]);

  const activeExpiryWarnings = expiringSubscriptions.filter(
    (subscription) => subscription.expired || subscription.deadline_local > now
  );
  const maintenanceVisible = phase !== "off" && pathname !== "/maintenance";
  const visible = maintenanceVisible || activeExpiryWarnings.length > 0;

  useEffect(() => {
    if (!visible) return;
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const apply = () => {
      root.style.setProperty("--maintenance-banner-h", `${el.offsetHeight}px`);
    };
    apply();
    root.classList.add("maintenance-banner-active");
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => {
      root.classList.remove("maintenance-banner-active");
      root.style.removeProperty("--maintenance-banner-h");
      observer.disconnect();
    };
  }, [visible]);

  if (!visible) return null;

  const enforced = phase === "enforced";
  const message = status.message || t("maintenance.default_message");
  const expiryDateFormatter = new Intl.DateTimeFormat(
    language === "bn" ? "bn-BD" : "en-GB",
    { dateStyle: "medium", timeStyle: "short" }
  );

  return (
    <div ref={ref} className="fixed top-0 inset-x-0 z-[120] shadow-lg">
      {maintenanceVisible && (
        <div
          role="alert"
          aria-live="assertive"
          className={enforced ? "bg-rose-600 text-white" : "bg-amber-500 text-amber-950"}
        >
          <div className="mx-auto max-w-7xl px-3 sm:px-4 py-2 sm:py-2.5 flex items-center justify-center gap-2 sm:gap-3 text-center flex-wrap">
            {enforced ? (
              <ShieldAlert className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            <p className="text-xs sm:text-sm font-semibold">
              {enforced
                ? t("maintenance.banner.enforced")
                : t("maintenance.banner.title")}
            </p>
            {!enforced && timeLeft !== null && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-amber-950/15 text-[11px] sm:text-xs font-bold tabular-nums tracking-wide">
                {t("maintenance.banner.countdown", { time: timeLeft })}
              </span>
            )}
            <p className="w-full sm:w-auto text-[11px] sm:text-xs font-medium opacity-90 truncate max-w-full">
              {message}
            </p>
          </div>
        </div>
      )}
      {activeExpiryWarnings.map((subscription) => {
        const houseName = subscription.house_code
          ? `${subscription.house_name || subscription.house_code} (${subscription.house_code})`
          : subscription.house_name || subscription.plan_name;
        return (
          <div
            key={subscription.house_id}
            role="status"
            aria-live="polite"
            className="bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-100"
          >
            <div className="mx-auto max-w-7xl px-3 sm:px-4 py-2 flex items-center justify-center gap-2 sm:gap-3 text-center flex-wrap">
              <CalendarClock className="w-4 h-4 shrink-0" />
              <p className="text-xs sm:text-sm font-semibold">
                {subscription.expired
                  ? t("maintenance.banner.plan_expired", { house: houseName })
                  : t("maintenance.banner.plan_expiry", { house: houseName })}
              </p>
              <span className="inline-flex items-center rounded-lg bg-amber-950/10 px-2 py-0.5 text-[11px] font-bold tabular-nums tracking-wide dark:bg-white/10 sm:text-xs">
                <span aria-live="off">
                  {subscription.expired
                    ? t("maintenance.banner.plan_expired_countdown", {
                        time: formatExpiryCountdown(now - subscription.deadline_local),
                        date: expiryDateFormatter.format(new Date(subscription.expires_at)),
                      })
                    : t("maintenance.banner.plan_expiry_countdown", {
                        time: formatExpiryCountdown(subscription.deadline_local - now),
                        date: expiryDateFormatter.format(new Date(subscription.expires_at)),
                      })}
                </span>
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
