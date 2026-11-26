"use client";

import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { Loader2, CloudDownload, Minimize2, Menu, X } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import Image from "next/image";
import { useAuth } from "@/context/AuthContext";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/utils";

import { LanguageSwitcher } from "./LanguageSwitcher";
import { useLanguage } from "@/i18n/useLanguage";
import { useBrand } from "@/context/BrandContext";
import { useFullscreen } from "@/context/FullscreenContext";
import { FullscreenControls } from "./FullscreenControls";
import { NotificationBell } from "./NotificationBell";
import { NotificationsProvider } from "@/context/NotificationsContext";
import { HouseSwitcher } from "@/components/houses/HouseSwitcher";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { loading, user } = useAuth();
  const { t } = useLanguage();
  const { brand } = useBrand();
  const pathname = usePathname();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { isFocusMode, revealHeader, setHeaderHovering, setFocusMode } = useFullscreen();
  const isPublicPage = pathname === "/login" || pathname === "/register" || pathname === "/setup" || pathname === "/forgot-password" || pathname === "/reset-password" || pathname === "/maintenance";
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F8FAFC] dark:bg-slate-950 transition-colors duration-300">
        <Loader2 className="h-10 w-10 text-primary-500 animate-spin mb-4" />
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{t('common.loading')}</p>
      </div>
    );
  }

  if (isPublicPage) {
    return <>{children}</>;
  }

  if (!user) {
    return null;
  }

  return (
    <NotificationsProvider>
    <div className="flex min-h-screen bg-[#F8FAFC] dark:bg-slate-950 transition-colors duration-300">
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <header
          // The reveal is pinned for as long as the pointer is anywhere inside the
          // header, so the whole toolbar stays usable — it only slides away once the
          // pointer leaves the header band.
          onMouseEnter={() => isFocusMode && setHeaderHovering(true)}
          onMouseLeave={() => isFocusMode && setHeaderHovering(false)}
          className={cn(
            // A single transition-property covers both the colour and transform changes:
            // stacking `transition-colors` and `transition-transform` would make them
            // fight over the same CSS property and the slide animation would be dropped.
            "hidden md:flex h-16 bg-white dark:bg-slate-900 border-b border-gray-100 dark:border-slate-800 items-center justify-between px-4 md:px-8 z-40 duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none transition-[color,background-color,border-color,outline-color,transform] gap-4",
            isFocusMode
              ? cn(
                  "fixed inset-x-0 top-0 shadow-lg will-change-transform",
                  revealHeader ? "translate-y-0" : "-translate-y-full"
                )
              : "sticky top-0"
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Link href="/" aria-label={brand.app_name} className="flex min-w-0 cursor-pointer items-center gap-2.5">
              {brand.logo ? (
                <Image src={brand.logo} alt="" width={32} height={32} unoptimized className="h-8 w-8 shrink-0 rounded-lg object-cover" />
              ) : (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange-500 shadow-lg shadow-orange-200 dark:shadow-none">
                  <span className="text-lg font-bold text-white">{brand.app_name.charAt(0)}</span>
                </div>
              )}
              <span className="max-w-[180px] truncate text-lg font-bold tracking-tight text-gray-800 dark:text-gray-100">
                {brand.app_name}
              </span>
            </Link>
            <button
              type="button"
              onClick={() => setIsSidebarOpen(open => !open)}
              aria-label={isSidebarOpen ? t("common.close") : t("common.open_sidebar")}
              aria-expanded={isSidebarOpen}
              title={isSidebarOpen ? t("common.close") : t("common.open_sidebar")}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-slate-800 dark:hover:text-gray-100 cursor-pointer"
            >
              {isSidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>

          <div className="flex flex-shrink-0 items-center gap-2 sm:gap-3">
            <div className="hidden md:flex items-center gap-3">
               <Link href="/sync" className="p-2 text-gray-400 hover:text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-500/10 rounded-xl transition-all" title="DMS Sync">
                 <CloudDownload className="w-5 h-5" />
               </Link>
                <HouseSwitcher />
                <LanguageSwitcher />
                <ThemeToggle />
                <FullscreenControls />
               
               <NotificationBell />
            </div>

          </div>
        </header>

        {/* The desktop header is hidden on phones; keep the house picker reachable. */}
        <div className="flex items-center px-2 md:hidden">
          <HouseSwitcher />
        </div>
        
        <main className={cn(
          "flex-1",
          isFocusMode
            ? "p-2 md:p-4 pb-6"
            : "p-2 md:p-8 pb-24 md:pb-8"
        )}>
          {children}
        </main>
      </div>

      {!isFocusMode && <MobileNav />}

      {/* Focus mode escape hatch — touch devices have no hover to reveal the chrome. */}
      {isFocusMode && (
        <button
          type="button"
          onClick={() => setFocusMode(false)}
          title={t("common.fullscreen.exit_focus")}
          aria-label={t("common.fullscreen.exit_focus")}
          className="fixed bottom-4 right-4 z-[102] flex items-center gap-2 h-11 px-4 rounded-full bg-primary-500 text-white text-sm font-semibold shadow-lg shadow-primary-500/30 hover:bg-primary-600 active:scale-95 transition-all cursor-pointer"
        >
          <Minimize2 className="w-4 h-4" />
          <span className="hidden sm:inline">{t("common.fullscreen.exit_focus")}</span>
        </button>
      )}
    </div>
    </NotificationsProvider>
  );
}
