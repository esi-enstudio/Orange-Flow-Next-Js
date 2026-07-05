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
  ChevronDown,
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
  const { theme, setTheme } = useTheme();
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  const toggleGroup = (title: string) => {
    setExpandedGroup(prev => prev === title ? null : title);
  };

  const filteredItems = navItems.filter(item => {
    const key = item.translationKey?.replace("nav.", "");
    if (mobileNavKeys.includes(key || "")) return false;
    if (item.permission && !hasPermission(item.permission)) return false;
    if (item.children) {
      const visible = item.children.filter(c => !c.permission || hasPermission(c.permission));
      return visible.length > 0;
    }
    return true;
  });

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
            onClick={onClose}
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
                onClick={onClose}
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
                onClick={onClose}
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
                  onClick={(e) => { e.preventDefault(); logout(); onClose(); }}
                  className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </Link>

              {/* Divider */}
              <div className="border-t border-gray-100 dark:border-slate-800" />

              {/* Navigation Items */}
              {filteredItems.length > 0 && (
                <div className="space-y-1">
                  {filteredItems.map((item) => {
                const hasChildren = item.children && item.children.length > 0;
                const isExpanded = expandedGroup === item.title;

                if (!hasChildren) {
                  return (
                    <Link
                      key={item.title}
                      href={item.href || "#"}
                      onClick={onClose}
                      className={cn(
                        "flex items-center justify-between px-4 py-3.5 rounded-xl transition-colors",
                        pathname === item.href
                          ? "bg-primary-50 dark:bg-primary-500/10 text-primary-600 dark:text-primary-400"
                          : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800"
                      )}
                    >
                      <div className="flex items-center gap-3.5">
                        <item.icon className="w-5 h-5" />
                        <span className="text-sm font-medium">
                          {t(getTranslationKey(item.title))}
                        </span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600" />
                    </Link>
                  );
                }

                return (
                  <div key={item.title}>
                    <button
                      onClick={() => toggleGroup(item.title)}
                      className={cn(
                        "w-full flex items-center justify-between px-4 py-3.5 rounded-xl transition-colors",
                        "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800"
                      )}
                    >
                      <div className="flex items-center gap-3.5">
                        <item.icon className="w-5 h-5" />
                        <span className="text-sm font-medium">
                          {t(getTranslationKey(item.title))}
                        </span>
                      </div>
                      <ChevronDown className={cn(
                        "w-4 h-4 text-gray-300 dark:text-gray-600 transition-transform duration-200",
                        isExpanded && "rotate-180"
                      )} />
                    </button>
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.15, ease: "easeInOut" }}
                          className="overflow-hidden"
                        >
                          <div className="ml-4 space-y-0.5 pb-1">
                            {item.children?.map((child) => {
                              const childPath = child.href || "";
                              return (
                                <Link
                                  key={child.title}
                                  href={childPath}
                                  onClick={onClose}
                                  className={cn(
                                    "flex items-center justify-between px-4 py-3 rounded-lg transition-colors",
                                    pathname === childPath
                                      ? "bg-primary-50 dark:bg-primary-500/10 text-primary-600 dark:text-primary-400"
                                      : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800"
                                  )}
                                >
                                  <div className="flex items-center gap-3">
                                    {child.icon && <child.icon className="w-4 h-4" />}
                                    <span className="text-sm">
                                      {t(child.translationKey || `nav.${child.title.toLowerCase().replace(/\s+/g, "_")}`)}
                                    </span>
                                  </div>
                                </Link>
                              );
                            })}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
