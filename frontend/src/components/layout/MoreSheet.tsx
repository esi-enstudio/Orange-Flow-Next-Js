"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn, getProfilePicUrl } from "@/lib/utils";
import { useState } from "react";
import {
  Upload,
  Users2,
  Banknote,
  Target,
  Crosshair,
  Shield,
  Search,
  ShieldCheck,
  ListTodo,
  ChevronLeft,
  X,
  ChevronRight,
  Globe,
  Bell,
  Sun,
  Moon,
  Monitor,
  User,
  LogOut,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useLanguage } from "@/i18n/useLanguage";
import { useAuth } from "@/context/AuthContext";
import { useEntitlements } from "@/context/EntitlementsContext";
import { moduleKeyOf } from "@/lib/planModules";
import { useTheme } from "@/components/ThemeProvider";
import { navItems } from "@/lib/constants";

interface MoreSheetProps {
  open: boolean;
  onClose: () => void;
}

const mobileNavKeys = ["dashboard", "reports_center", "dms", "employees", "more"];

function getTranslationKey(title: string): string {
  const item = navItems.find(n => n.title === title);
  return item?.translationKey || `nav.${title.toLowerCase().replace(/\s+/g, "_")}`;
}

export function MoreSheet({ open, onClose }: MoreSheetProps) {
  const pathname = usePathname();
  const { t, language, setLanguage } = useLanguage();
  const { hasPermission, user, logout } = useAuth();
  const { hasModule, hasPage } = useEntitlements();
  const { theme, setTheme } = useTheme();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [openNested, setOpenNested] = useState<string | null>(null);

  const canShow = (item: any): boolean => {
    if (item.permissions && item.permissions.length > 0) {
      return item.permissions.some((permission: string) => hasPermission(permission));
    }
    if (item.permission) return hasPermission(item.permission);
    return true;
  };

  const filterChildren = (children: any[], parentModuleKey: string): any[] =>
    children
      .filter(canShow)
      .filter(child => hasModule(child.moduleKey || parentModuleKey))
      .filter(child => child.href ? hasPage(child.href) : true)
      .map(child => {
        if (child.children) {
          const visibleChildren = filterChildren(child.children, child.moduleKey || parentModuleKey);
          return visibleChildren.length > 0
            ? { ...child, children: visibleChildren }
            : { ...child, children: undefined };
        }
        return child;
      });

  const filteredItems = navItems
    .map(item => ({ ...item }))
    .filter(item => {
    const key = item.translationKey?.replace("nav.", "");
    if (mobileNavKeys.includes(key || "")) return false;
    if (!canShow(item)) return false;

    if (item.children) {
      const visibleChildren = filterChildren(item.children, moduleKeyOf(item));
      if (visibleChildren.length === 0) return false;
      item.children = visibleChildren;
    } else if (!hasModule(moduleKeyOf(item))) {
      return false;
    }

    return true;
  });

  const selectedMenu = filteredItems.find(item => item.title === openMenu);
  const selectedNested = selectedMenu?.children?.find(
    child => child.title === openNested && child.children?.length
  );
  const returnToMainMenu = () => {
    setOpenMenu(null);
    setOpenNested(null);
  };
  const closeSheet = () => {
    returnToMainMenu();
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/40 z-[60]"
            onClick={closeSheet}
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-[70] bg-white dark:bg-slate-900 rounded-t-2xl shadow-2xl max-h-[75vh] flex flex-col"
          >
            <div className="flex items-center justify-between px-6 pt-4 pb-3 border-b border-gray-100 dark:border-slate-800 shrink-0">
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                {t("nav.more")}
              </h2>
              <button
                onClick={closeSheet}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-y-auto px-4 py-3 space-y-3 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-200 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5">
              {/* Header Actions — Language, Theme, Notifications */}
              <div className="flex items-center justify-between px-2 py-2.5 bg-gray-50 dark:bg-slate-800/50 rounded-xl">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setLanguage(language === 'en' ? 'bn' : 'en')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-slate-700 transition-colors"
                  >
                    <Globe className="w-4 h-4" />
                    {language === 'en' ? 'EN' : 'BN'}
                  </button>
                  <div className="flex items-center p-0.5 bg-gray-200/50 dark:bg-slate-700/50 rounded-lg">
                    {[
                      { name: "light", icon: Sun },
                      { name: "dark", icon: Moon },
                      { name: "system", icon: Monitor },
                    ].map((t) => (
                      <button
                        key={t.name}
                        onClick={() => setTheme(t.name)}
                        className={cn(
                          "p-1.5 rounded-md transition-all",
                          theme === t.name
                            ? "bg-white dark:bg-slate-600 text-primary-600 shadow-sm"
                            : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-200"
                        )}
                      >
                        <t.icon className="w-3.5 h-3.5" />
                      </button>
                    ))}
                  </div>
                </div>
                <button className="relative p-2 text-gray-400 hover:text-primary-500 hover:bg-white dark:hover:bg-slate-700 rounded-lg transition-all">
                  <Bell className="w-4 h-4" />
                  <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-red-500 rounded-full border border-white dark:border-slate-900" />
                </button>
              </div>

              {/* Profile Card */}
              <Link
                href="/profile"
                onClick={closeSheet}
                className="flex items-center gap-3 px-3 py-3 bg-gray-50 dark:bg-slate-800/50 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-primary-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0 overflow-hidden">
                  {user?.profile_pic ? (
                    <img src={getProfilePicUrl(user.profile_pic)!} alt="" className="w-full h-full object-cover" />
                  ) : (
                    user?.name?.charAt(0) || "U"
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">{user?.name || "User"}</p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate capitalize">{user?.roles?.[0]?.name || ""}</p>
                </div>
                <button
                  onClick={(e) => { e.preventDefault(); logout(); closeSheet(); }}
                  className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </Link>

              {/* Divider */}
              <div className="border-t border-gray-100 dark:border-slate-800" />

              {/* Navigation Items */}
              {filteredItems.length > 0 && (
                <nav className="overflow-hidden">
                  <motion.div
                    animate={{ x: selectedNested ? "-66.6667%" : selectedMenu ? "-33.3333%" : "0%" }}
                    transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                    className="relative flex w-[300%]"
                  >
                    <div className={cn(
                      "w-1/3 shrink-0 space-y-1",
                      selectedMenu ? "absolute left-0 top-0" : "relative"
                    )}>
                      {filteredItems.map((item) => {
                        const hasChildren = item.children && item.children.length > 0;
                        const isParentActive = item.children?.some((child) =>
                          (child.href && child.href === pathname) ||
                          child.children?.some((sub: { href?: string }) => sub.href === pathname)
                        );
                        const isDirectActive = item.href === pathname;
                        const label = t(getTranslationKey(item.title));

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
                              aria-label={label}
                              className={cn(
                                "group flex min-h-11 w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors cursor-pointer",
                                isParentActive
                                  ? "bg-primary-50 font-semibold text-primary-600 dark:bg-primary-500/10 dark:text-primary-400"
                                  : "text-gray-700 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-slate-800 dark:hover:text-gray-100"
                              )}
                            >
                              <span className="flex min-w-0 items-center gap-3">
                                <item.icon className={cn(
                                  "h-5 w-5 shrink-0",
                                  item.color || "text-gray-400 dark:text-gray-500"
                                )} />
                                <span className="whitespace-nowrap">{label}</span>
                              </span>
                              <ChevronRight className="h-4 w-4 shrink-0 opacity-50" />
                            </button>
                          );
                        }

                        return (
                          <Link
                            key={item.title}
                            href={item.href || "#"}
                            onClick={closeSheet}
                            className={cn(
                              "flex min-h-11 items-center justify-start rounded-xl px-3 py-2 text-sm transition-colors cursor-pointer",
                              isDirectActive
                                ? "bg-primary-50 font-semibold text-primary-600 dark:bg-primary-500/10 dark:text-primary-400"
                                : "text-gray-700 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-slate-800 dark:hover:text-gray-100"
                            )}
                          >
                            <span className="flex min-w-0 items-center gap-3">
                              <item.icon className={cn(
                                "h-5 w-5 shrink-0",
                                item.color || "text-gray-400 dark:text-gray-500"
                              )} />
                              <span className="whitespace-nowrap">{label}</span>
                            </span>
                          </Link>
                        );
                      })}
                    </div>

                    <div className={cn(
                      "w-1/3 shrink-0 space-y-1",
                      selectedMenu && !selectedNested
                        ? "relative left-1/3"
                        : "absolute left-1/3 top-0"
                    )}>
                      {selectedMenu && (
                        <>
                          <button
                            type="button"
                            onClick={returnToMainMenu}
                            aria-label={t("common.back")}
                            className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-sm font-semibold text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-slate-800 dark:hover:text-gray-100 cursor-pointer"
                          >
                            <ChevronLeft className="h-4 w-4 shrink-0" />
                            <span>{t("common.back")}</span>
                          </button>
                          <div className="px-3 pb-1 pt-2 text-xs font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                            {t(getTranslationKey(selectedMenu.title))}
                          </div>
                          {selectedMenu.children?.map((child) => {
                            const hasChildren = child.children && child.children.length > 0;
                            const label = t(child.translationKey || `nav.${child.title.toLowerCase().replace(/\s+/g, "_")}`);
                            const isChildActive = child.href === pathname;
                            const isNestedActive = child.children?.some(
                              (sub: { href?: string }) => sub.href === pathname
                            );

                            if (hasChildren) {
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
                                key={child.title}
                                href={child.href || "#"}
                                onClick={closeSheet}
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
                              </Link>
                            );
                          })}
                        </>
                      )}
                    </div>

                    <div className={cn(
                      "w-1/3 shrink-0 space-y-1",
                      selectedNested
                        ? "relative left-2/3"
                        : "absolute left-2/3 top-0"
                    )}>
                      {selectedNested && (
                        <>
                          <button
                            type="button"
                            onClick={() => setOpenNested(null)}
                            aria-label={t("common.back")}
                            className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-sm font-semibold text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-slate-800 dark:hover:text-gray-100 cursor-pointer"
                          >
                            <ChevronLeft className="h-4 w-4 shrink-0" />
                            <span>{t("common.back")}</span>
                          </button>
                          <div className="px-3 pb-1 pt-2 text-xs font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                            {t(selectedNested.translationKey || `nav.${selectedNested.title.toLowerCase().replace(/\s+/g, "_")}`)}
                          </div>
                          {selectedNested.children?.map((sub) => {
                            const label = t(sub.translationKey || `nav.${sub.title.toLowerCase().replace(/\s+/g, "_")}`);
                            const isSubActive = sub.href === pathname;
                            return (
                              <Link
                                key={sub.href || sub.title}
                                href={sub.href || "#"}
                                onClick={closeSheet}
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
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
