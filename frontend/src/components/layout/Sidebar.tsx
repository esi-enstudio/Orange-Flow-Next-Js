"use client";

import React, { useState, useEffect, useRef } from "react";
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

function navHrefs(items: any[]): string[] {
  return items.flatMap((item) => [
    ...(item.href ? [item.href] : []),
    ...(item.children ? navHrefs(item.children) : []),
  ]);
}

/** The one active nav item: the longest matching href wins, so a child page such
 * as /retailers/routes does not also light up its parent /retailers. */
function activeNavHref(items: any[], pathname: string): string | null {
  const matches = navHrefs(items).filter((href) => isPathMatch(href, pathname));
  return matches.sort((a, b) => b.length - a.length)[0] ?? null;
}

/** Titles from the top-level item down to the one that owns `href`, so the
 * sidebar can open on the exact panel the current page lives in. */
function navTrail(items: any[], href: string | null): string[] | null {
  if (!href) return null;
  for (const item of items) {
    if (item.href === href) return [item.title];
    if (item.children) {
      const trail = navTrail(item.children, href);
      if (trail) return [item.title, ...trail];
    }
  }
  return null;
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

function filterChildren(children: any[], parentModuleKey: string): any[] {
      return children
        .filter(child => canShow(child))
    .filter(child => hasModule(child.moduleKey || parentModuleKey))
        .filter(child => child.href ? hasPage(child.href) : true)
        .map(child => {
          if (child.children) {
        const filtered = filterChildren(child.children, child.moduleKey || parentModuleKey);
            return filtered.length > 0 ? { ...child, children: filtered } : { ...child, children: undefined };
          }
          return child;
        });
    }

    return navItems
      .map(item => ({ ...item })) // Shallow clone parent
      .filter(item => {
        // 0. Hide entries with a direct permission the user does not have.
        if (!canShow(item)) return false;

        // A child may belong to a separate plan module while remaining nested
        // under this navigation group (e.g. Reports → Report Builder).
        if (item.children) {
          const visibleChildren = filterChildren(item.children, moduleKeyOf(item));
          // If no children are visible, hide the parent
          if (visibleChildren.length === 0) return false;

          // Assign cloned children
          item.children = visibleChildren;
        } else if (!hasModule(moduleKeyOf(item))) {
          return false;
        }

        return true;
      });
  }, [hasPermission, hasModule, hasPage]);

  const activeHref = React.useMemo(
    () =>
      isResignationLetterheadActive
        ? "/employees/resignation-documents"
        : activeNavHref(filteredNavItems, pathname),
    [filteredNavItems, pathname, isResignationLetterheadActive]
  );

  useEffect(() => {
    const employeeId = Number(new URLSearchParams(window.location.search).get("emp_id"));
    setIsResignationLetterheadActive(
      pathname === "/houses/letterhead" && Number.isSafeInteger(employeeId) && employeeId > 0
    );
  }, [pathname]);

  // Opening the sidebar should land on the panel that owns the page the user is
  // on, not the root menu list. `filteredNavItems` is rebuilt whenever the auth
  // context re-renders, so the targets are kept in a ref and only read on the
  // closed → open transition; otherwise browsing panels manually would be reset.
  const navSnapshot = useRef({ items: filteredNavItems, activeHref });
  useEffect(() => {
    navSnapshot.current = { items: filteredNavItems, activeHref };
  });

  const wasOpen = useRef(false);
  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      const trail = navTrail(navSnapshot.current.items, navSnapshot.current.activeHref);
      // A direct top-level page has a trail of length 1 and no panel to open.
      setOpenMenu(trail && trail.length > 1 ? trail[0] : null);
      setOpenNested(trail && trail.length > 2 ? trail[1] : null);
    }
    wasOpen.current = !!isOpen;
  }, [isOpen]);

  const selectedMenu = filteredNavItems.find(item => item.title === openMenu);
  const selectedNested = selectedMenu?.children?.find(
    child => child.title === openNested && child.children?.length
  );
  const returnToMainMenu = () => {
    setOpenMenu(null);
    setOpenNested(null);
  };

  const sidebarContent = (
    <div className="sidebar-scrollbar flex flex-col h-full overflow-x-hidden overflow-y-auto">
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
            className="relative flex w-[300%]"
          >
            <div
              className={cn(
                "w-1/3 shrink-0 space-y-1",
                selectedMenu ? "absolute left-0 top-0" : "relative"
              )}
            >
              {filteredNavItems.map((item) => {
                const hasChildren = item.children && item.children.length > 0;
                const isParentActive = item.children?.some(child =>
                  (child.href && child.href === activeHref) ||
                  child.children?.some(sub => sub.href && sub.href === activeHref)
                );
                const isDirectActive = item.href === activeHref;
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

            <div
              className={cn(
                "w-1/3 shrink-0 space-y-1",
                selectedMenu && !selectedNested
                  ? "relative left-1/3"
                  : "absolute left-1/3 top-0"
              )}
            >
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
                      ? child.href === activeHref
                      : false;
                    const isNestedActive = child.children?.some(sub =>
                      sub.href === activeHref
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
                        {child.badge && (
                          <span
                            title={t(child.badge)}
                            aria-label={t(child.badge)}
                            className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                          >
                            {t("nav.legacy_replaced_short")}
                          </span>
                        )}
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

            <div
              className={cn(
                "w-1/3 shrink-0 space-y-1",
                selectedNested
                  ? "relative left-2/3"
                  : "absolute left-2/3 top-0"
              )}
            >
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
                    const isSubActive = sub.href === activeHref;
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
                        {sub.badge && (
                          <span
                            title={t(sub.badge)}
                            aria-label={t(sub.badge)}
                            className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                          >
                            {t("nav.legacy_replaced_short")}
                          </span>
                        )}
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
