"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { useLanguage } from "@/i18n/useLanguage";
import { useMaintenance } from "@/context/MaintenanceContext";

/**
 * Non-dismissible top notification shown to EVERY session (including Super
 * Admins and anonymous visitors) while maintenance is pending (grace) or
 * active for admins (enforced). Regular users in the enforced phase see the
 * full MaintenanceScreen instead of this banner.
 *
 * The measured height is published as `--maintenance-banner-h` on <html> plus
 * the `maintenance-banner-active` class so sticky headers and the page body
 * offset below the banner (see globals.css).
 */
export function MaintenanceBanner() {
  const { phase, timeLeft, status, isSuperAdmin } = useMaintenance();
  const { t } = useLanguage();
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);

  // The dedicated /maintenance page carries its own countdown, so the top
  // banner would be a duplicate there.
  const visible =
    phase !== "off" &&
    pathname !== "/maintenance" &&
    !(phase === "enforced" && !isSuperAdmin);

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

  return (
    <div
      ref={ref}
      role="alert"
      aria-live="assertive"
      className={
        enforced
          ? "fixed top-0 inset-x-0 z-[120] bg-rose-600 text-white shadow-lg"
          : "fixed top-0 inset-x-0 z-[120] bg-amber-500 text-amber-950 shadow-lg"
      }
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
  );
}
