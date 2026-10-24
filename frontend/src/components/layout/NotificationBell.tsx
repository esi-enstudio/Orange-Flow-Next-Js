"use client";

/**
 * Header notification bell.
 *
 * Shows an unread count and a dropdown feed. A house's submitted payment
 * request lands here for the super admin, with a shortcut into Payment Review.
 */

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, ChevronDown, Loader2, Wallet } from "lucide-react";
import { useLanguage } from "@/i18n/useLanguage";
import { cn } from "@/lib/utils";
import { useNotifications, type AppNotification } from "@/context/NotificationsContext";

function relativeTime(iso: string | null, t: (key: string, params?: Record<string, string | number>) => string): string {
  if (!iso) return "";
  const created = new Date(iso).getTime();
  if (Number.isNaN(created)) return "";
  const minutes = Math.floor((Date.now() - created) / 60000);
  if (minutes < 1) return t("notifications.time.just_now");
  if (minutes < 60) return t("notifications.time.minutes_ago", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("notifications.time.hours_ago", { count: hours });
  const days = Math.floor(hours / 24);
  return t("notifications.time.days_ago", { count: days });
}

export function NotificationBell() {
  const { t, language } = useLanguage();
  const router = useRouter();
  const {
    count,
    items,
    loading,
    loadingMore,
    hasMore,
    isOpen,
    setIsOpen,
    markRead,
    markAllRead,
    loadMore,
  } = useNotifications();
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape — the panel is not a focus trap, it just
  // dismisses like any header popover.
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, setIsOpen]);

  const numberFormat = new Intl.NumberFormat(language === "bn" ? "bn-BD" : "en-US");

  const titleFor = (item: AppNotification) => {
    if (item.type === "payment_request") return t("notifications.payment_request.title");
    return item.title;
  };

  const messageFor = (item: AppNotification) => {
    if (item.type === "payment_request") {
      const payload = item.payload ?? {};
      const amount = payload.amount != null ? numberFormat.format(Number(payload.amount)) : "";
      return t("notifications.payment_request.message", {
        house: String(payload.house_name ?? "—"),
        amount: `${amount} ${String(payload.currency ?? "")}`.trim(),
        invoice: String(payload.invoice_no ?? "—"),
      });
    }
    return item.message ?? "";
  };

  const openItem = async (item: AppNotification) => {
    if (!item.is_read) await markRead(item.id);
    setIsOpen(false);
    if (item.link) router.push(item.link);
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label={t("notifications.title")}
        title={t("notifications.title")}
        aria-expanded={isOpen}
        className="relative p-2 text-gray-400 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/10 rounded-xl transition-all cursor-pointer"
      >
        <Bell className="w-5 h-5" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center border-2 border-white dark:border-slate-900">
            {count > 99 ? "99+" : numberFormat.format(count)}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl z-50 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-slate-800">
            <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
              {t("notifications.title")}
              {count > 0 && (
                <span className="ml-2 text-[11px] font-bold text-primary-600 dark:text-primary-400">
                  {t("notifications.unread", { count })}
                </span>
              )}
            </p>
            {count > 0 && (
              <button
                type="button"
                onClick={() => void markAllRead()}
                aria-label={t("notifications.mark_all_read")}
                title={t("notifications.mark_all_read")}
                className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-500/10 dark:hover:text-primary-400 transition-colors cursor-pointer"
              >
                <CheckCheck className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto scrollbar-custom">
            {loading && items.length === 0 ? (
              <div className="divide-y divide-gray-50 dark:divide-slate-800">
                {[0, 1, 2].map((n) => (
                  <div key={n} className="flex items-start gap-3 px-4 py-3 animate-pulse">
                    <div className="w-8 h-8 rounded-xl bg-gray-200 dark:bg-slate-700 shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 w-32 bg-gray-200 dark:bg-slate-700 rounded-md" />
                      <div className="h-2.5 w-48 bg-gray-100 dark:bg-slate-800 rounded-md" />
                    </div>
                  </div>
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Bell className="w-6 h-6 text-gray-300 dark:text-slate-600 mx-auto mb-2" />
                <p className="text-xs text-gray-400 dark:text-gray-500">{t("notifications.empty")}</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50 dark:divide-slate-800">
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void openItem(item)}
                    className={cn(
                      "w-full text-left px-4 py-3 flex items-start gap-3 transition-colors cursor-pointer",
                      item.is_read
                        ? "hover:bg-gray-50 dark:hover:bg-slate-800/60"
                        : "bg-primary-50/50 dark:bg-primary-500/5 hover:bg-primary-50 dark:hover:bg-primary-500/10"
                    )}
                  >
                    <span
                      className={cn(
                        "w-8 h-8 rounded-xl flex items-center justify-center shrink-0",
                        item.type === "payment_request"
                          ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"
                          : "bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-gray-400"
                      )}
                    >
                      {item.type === "payment_request" ? (
                        <Wallet className="w-4 h-4" />
                      ) : (
                        <Bell className="w-4 h-4" />
                      )}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-900 dark:text-gray-100 truncate">
                          {titleFor(item)}
                        </span>
                        {!item.is_read && (
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                        )}
                      </span>
                      <span className="block text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
                        {messageFor(item)}
                      </span>
                      <span className="block text-[10px] text-gray-400 dark:text-gray-500 mt-1">
                        {relativeTime(item.created_at, t)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {items.length > 0 && (
            <div className="border-t border-gray-100 dark:border-slate-800 px-3 py-2">
              {hasMore ? (
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  className="w-full inline-flex items-center justify-center gap-1.5 min-h-10 rounded-xl text-xs font-bold text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-500/10 disabled:opacity-60 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                  {loadingMore ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                  {t("notifications.view_all")}
                </button>
              ) : (
                <p className="py-1.5 text-center text-[11px] text-gray-400 dark:text-gray-500">
                  {t("notifications.all_caught_up")}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
