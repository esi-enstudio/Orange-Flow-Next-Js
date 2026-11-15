"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn, getProfilePicUrl } from "@/lib/utils";
import { navItems } from "@/lib/constants";
import { ChevronLeft, ChevronRight, LogOut, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useEntitlements } from "@/context/EntitlementsContext";
import { moduleKeyOf } from "@/lib/planModules";
import { motion, AnimatePresence } from "framer-motion";
import { useLanguage } from "@/i18n/useLanguage";
import { SIDEBAR_BADGE_ROUTES, useNotifications } from "@/context/NotificationsContext";

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

function isPathMatch(href: string, pathname: string): boolean {
  return href === pathname || pathname.startsWith(href.endsWith("/") ? href : `${href}/`);
}

function isNavPathMatch(
  href: string,
  pathname: string,
  isResignationLetterheadActive: boolean
): boolean {
  return isPathMatch(href, pathname) ||
    (isResignationLetterheadActive && href === "/employees/resignation-documents");
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { user, logout, hasPermission } = useAuth();
  const { hasModule, hasPage } = useEntitlements();
  const { t } = useLanguage();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [openNested, setOpenNested] = useState<string | null>(null);
  const [isResignationLetterheadActive, setIsResignationLetterheadActive] = useState(false);
  const { count: unreadNotifications } = useNotifications();

  // Filter items based on permissions - use memo to prevent mutation of constant
  const filteredNavItems = React.useMemo(() => {
    const canShow = (item: any): boolean => {
      if (item.permissions && item.permissions.length > 0) {
        return item.permissions.some((p: string) => hasPermission(p));
      }
      if (item.permission) return hasPermission(item.permission);
      return true;
    };

function filterChildren(children: any[]): any[] {
      return children
        .filter(child => canShow(child))
        .filter(child => child.href ? hasPage(child.href) : true)
        .map(child => {
          if (child.children) {
            const filtered = filterChildren(child.children);
            return filtered.length > 0 ? { ...child, children: filtered } : { ...child, children: undefined };
          }
          return child;
        });
    }

    return navItems
      .map(item => ({ ...item })) // Shallow clone parent
      .filter(item => {
        // 0. Plan module access — hide whole groups excluded by the plan
        if (!hasModule(moduleKeyOf(item))) return false;

        // 1. If it has a direct permission, check it
        if (!canShow(item)) return false;

        // 2. If it has children, filter recursively
        if (item.children) {
          const visibleChildren = filterChildren(item.children);
          // If no children are visible, hide the parent
          if (visibleChildren.length === 0) return false;

          // Assign cloned children
          item.children = visibleChildren;
        }

        return true;
      });
  }, [hasPermission, hasModule, hasPage]);

  useEffect(() => {
    const employeeId = Number(new URLSearchParams(window.location.search).get("emp_id"));
    setIsResignationLetterheadActive(
      pathname === "/houses/letterhead" && Number.isSafeInteger(employeeId) && employeeId > 0
    );
  }, [pathname]);

  const selectedMenu = filteredNavItems.find(item => item.title === openMenu);
  const selectedNested = selectedMenu?.children?.find(
    child => child.title === openNested && child.children?.length
  );
  const returnToMainMenu = () => {
    setOpenMenu(null);
    setOpenNested(null);
  };

  const sidebarContent = (
    <div className="flex flex-col h-full overflow-y-auto scrollbar-hide">
      <div className="p-2">
        <div className="mb-8 flex items-center justify-between gap-2 rounded-xl bg-gray-50 p-2 dark:bg-slate-800">
          <Link
            href="/profile"
            title={user?.name || t("common.user")}
            aria-label={user?.name || t("common.user")}
            onClick={onClose}
            className="group flex min-w-0 flex-1 items-center justify-start gap-3 overflow-hidden"
          >
            <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full bg-primary-100 text-xs font-bold text-primary-600 transition-transform group-hover:scale-110 dark:bg-primary-500/20 dark:text-primary-400">
              {user?.profile_pic ? (
                <img src={getProfilePicUrl(user.profile_pic)!} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center">
                  {user?.name?.charAt(0) || "U"}
                </span>
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <span className="truncate text-xs font-bold dark:text-gray-100 group-hover:text-primary-500">
                {user?.name || t("common.user")}
              </span>
              <span className="truncate text-[10px] capitalize text-gray-500 dark:text-gray-400">
                {user?.roles?.[0]?.name || t("common.user")}
              </span>
            </div>
          </Link>
          <div className="flex shrink-0 items-center">
            <button
              onClick={logout}
              title={t("common.logout")}
              aria-label={t("common.logout")}
              className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10 cursor-pointer"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>

        <nav className="overflow-hidden">
          <motion.div
            animate={{ x: selectedNested ? "-66.6667%" : selectedMenu ? "-33.3333%" : "0%" }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            className="flex w-[300%]"
          >
            <div className="w-1/3 shrink-0 space-y-1">
              {filteredNavItems.map((item) => {
                const hasChildren = item.children && item.children.length > 0;
                const isParentActive = item.children?.some(child =>
                  (child.href && isNavPathMatch(child.href, pathname, isResignationLetterheadActive)) ||
                  child.children?.some(sub =>
                    sub.href && isNavPathMatch(sub.href, pathname, isResignationLetterheadActive)
                  )
                );
                const isDirectActive = item.href === pathname;
                const label = item.translationKey ? t(item.translationKey) : item.title;

                if (hasChildren) {
                  return (
                    <button
                      key={item.title}
                      type="button"
                      onClick={() => {
                        setOpenMenu(item.title);
                        setOpenNested(null);
                      }}
                      aria-expanded={selectedMenu?.title === item.title}
                      title={label}
                      aria-label={label}
                      className={cn(
                        "group flex w-full items-center justify-between rounded-xl px-3 py-2.5 transition-colors duration-200 cursor-pointer",
                        isParentActive
                          ? "bg-primary-50 font-semibold text-primary-600 dark:bg-primary-500/10 dark:text-primary-400"
                          : "text-gray-500 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-slate-800 dark:hover:text-gray-100"
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <item.icon className={cn(
                          "h-5 w-5 shrink-0 transition-colors",
                          isParentActive ? "text-primary-600 dark:text-primary-400" : item.color || "text-gray-400 dark:text-gray-500",
                          "group-hover:text-primary-600 dark:group-hover:text-primary-400"
                        )} />
                        <span className="whitespace-nowrap text-sm">
                          {label}
                        </span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 opacity-50" />
                    </button>
                  );
                }

                return (
                  <Link
                    key={item.title}
                    href={item.href || "#"}
                    title={label}
                    aria-label={label}
                    onClick={() => {
                      returnToMainMenu();
                      onClose?.();
                    }}
                    className={cn(
                      "group flex items-center justify-start rounded-xl px-3 py-2.5 transition-colors duration-200 cursor-pointer",
                      isDirectActive
                        ? "bg-primary-50 font-semibold text-primary-600 dark:bg-primary-500/10 dark:text-primary-400"
                        : "text-gray-500 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-slate-800 dark:hover:text-gray-100"
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <item.icon className={cn(
                        "h-5 w-5 shrink-0 transition-colors",
                        isDirectActive ? "text-primary-600 dark:text-primary-400" : item.color || "text-gray-400 dark:text-gray-500",
                        "group-hover:text-primary-600 dark:group-hover:text-primary-400"
                      )} />
                      <span className="whitespace-nowrap text-sm">
                        {label}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>

            <div className="w-1/3 shrink-0 space-y-1">
              {selectedMenu && (
                <>
                  <button
                    type="button"
                    onClick={returnToMainMenu}
                    className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-sm font-semibold text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-slate-800 dark:hover:text-gray-100 cursor-pointer"
                    aria-label={t("common.back")}
                  >
                    <ChevronLeft className="h-4 w-4 shrink-0" />
                    <span>{t("common.back")}</span>
                  </button>
                  <div className="px-3 pb-1 pt-2 text-xs font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                    {selectedMenu.translationKey ? t(selectedMenu.translationKey) : selectedMenu.title}
                  </div>
                  {selectedMenu.children?.map((child) => {
                    const childHasNavChildren = child.children && child.children.length > 0;
                    const label = child.translationKey ? t(child.translationKey) : child.title;
                    const isChildActive = child.href
                      ? isNavPathMatch(child.href, pathname, isResignationLetterheadActive)
                      : false;
                    const isNestedActive = child.children?.some(sub =>
                      isNavPathMatch(sub.href, pathname, isResignationLetterheadActive)
                    );

                    if (childHasNavChildren) {
                      return (
                        <button
                          key={child.title}
                          type="button"
                          onClick={() => setOpenNested(child.title)}
                          aria-expanded={selectedNested?.title === child.title}
                          className={cn(
                            "flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors cursor-pointer",
                            isNestedActive || isChildActive
                              ? "bg-primary-50 font-semibold text-primary-700 dark:bg-primary-500/10 dark:text-primary-300"
                              : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-slate-800"
                          )}
                        >
                          <span className="truncate">{label}</span>
                          <ChevronRight className="h-4 w-4 shrink-0 opacity-50" />
                        </button>
                      );
                    }

                    return (
                      <Link
                        key={child.href}
                        href={child.href || "#"}
                        onClick={() => {
                          returnToMainMenu();
                          onClose?.();
                        }}
                        className={cn(
                          "flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors cursor-pointer",
                          isChildActive
                            ? "bg-primary-50 font-semibold text-primary-700 dark:bg-primary-500/10 dark:text-primary-300"
                            : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-slate-800 dark:hover:text-gray-100"
                        )}
                      >
                        <span className={cn(
                          "h-1.5 w-1.5 shrink-0 rounded-full",
                          isChildActive ? "bg-primary-500" : "bg-gray-300 dark:bg-slate-700"
                        )} />
                        <span className="min-w-0 flex-1 truncate">{label}</span>
                        {child.href && SIDEBAR_BADGE_ROUTES[child.href] && unreadNotifications > 0 && (
                          <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                            {unreadNotifications > 99 ? "99+" : unreadNotifications}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </>
              )}
            </div>

            <div className="w-1/3 shrink-0 space-y-1">
              {selectedNested && (
                <>
                  <button
                    type="button"
                    onClick={() => setOpenNested(null)}
                    className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-sm font-semibold text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-slate-800 dark:hover:text-gray-100 cursor-pointer"
                    aria-label={t("common.back")}
                  >
                    <ChevronLeft className="h-4 w-4 shrink-0" />
                    <span>{t("common.back")}</span>
                  </button>
                  <div className="px-3 pb-1 pt-2 text-xs font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                    {selectedNested.translationKey ? t(selectedNested.translationKey) : selectedNested.title}
                  </div>
                  {selectedNested.children?.map((sub) => {
                    const label = sub.translationKey ? t(sub.translationKey) : sub.title;
                    const isSubActive = isNavPathMatch(sub.href, pathname, isResignationLetterheadActive);
                    return (
                      <Link
                        key={sub.href}
                        href={sub.href}
                        onClick={() => {
                          returnToMainMenu();
                          onClose?.();
                        }}
                        className={cn(
                          "flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors cursor-pointer",
                          isSubActive
                            ? "bg-primary-50 font-semibold text-primary-700 dark:bg-primary-500/10 dark:text-primary-300"
                            : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-slate-800 dark:hover:text-gray-100"
                        )}
                      >
                        <span className={cn(
                          "h-1.5 w-1.5 shrink-0 rounded-full",
                          isSubActive ? "bg-primary-500" : "bg-gray-300 dark:bg-slate-700"
                        )} />
                        <span className="min-w-0 flex-1 truncate">{label}</span>
                      </Link>
                    );
                  })}
                </>
              )}
            </div>
          </motion.div>
        </nav>
      </div>

    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.button
              type="button"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={onClose}
              aria-label={t("common.close")}
              className="fixed inset-0 z-[100] hidden cursor-pointer border-0 bg-black/10 p-0 backdrop-blur-sm md:block"
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              className="fixed inset-y-0 left-0 z-[101] hidden w-64 shadow-2xl md:flex"
            >
              <div className="flex h-full w-full flex-col overflow-hidden border-r border-gray-100 bg-white dark:border-slate-800 dark:bg-slate-900">
                {sidebarContent}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label={t("common.close")}
                title={t("common.close")}
                className="absolute left-full top-8 ml-3 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white text-gray-500 shadow-lg transition-colors hover:bg-gray-100 hover:text-gray-900 dark:bg-slate-800 dark:text-gray-300 dark:hover:bg-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Mobile Drawer */}
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] md:hidden"
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 left-0 w-72 bg-white dark:bg-slate-900 z-[101] md:hidden shadow-2xl transition-colors duration-300"
            >
              {sidebarContent}
              <button
                type="button"
                onClick={onClose}
                aria-label={t("common.close")}
                title={t("common.close")}
                className="absolute left-full top-8 ml-3 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white text-gray-500 shadow-lg transition-colors hover:bg-gray-100 hover:text-gray-900 dark:bg-slate-800 dark:text-gray-300 dark:hover:bg-slate-700 dark:hover:text-white cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
