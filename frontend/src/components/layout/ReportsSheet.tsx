"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  FileSpreadsheet,
  X,
  ChevronRight,
} from "lucide-react";
import { navItems } from "@/lib/constants";
import type { LucideIcon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useLanguage } from "@/i18n/useLanguage";
import { useAuth } from "@/context/AuthContext";
import { useEntitlements } from "@/context/EntitlementsContext";

type ReportLink = {
  title: string;
  translationKey?: string;
  href: string;
  icon?: LucideIcon;
  permission?: string;
  permissions?: string[];
  moduleKey?: string;
  badge?: string;
};

const reportsGroup = navItems.find((item) => item.translationKey === "nav.reports_center");
const reportItems: ReportLink[] = (reportsGroup?.children || []).flatMap((child) => {
  const leaves = child.children || [child];
  return leaves.flatMap((leaf) => leaf.href
    ? [{
        title: leaf.title,
        translationKey: leaf.translationKey,
        href: leaf.href,
        icon: leaf.icon || child.icon,
        permission: leaf.permission,
        permissions: leaf.permissions,
        moduleKey: leaf.moduleKey || child.moduleKey || reportsGroup?.moduleKey,
        badge: leaf.badge,
      }]
    : []);
});

interface ReportsSheetProps {
  open: boolean;
  onClose: () => void;
}

export function ReportsSheet({ open, onClose }: ReportsSheetProps) {
  const pathname = usePathname();
  const { t } = useLanguage();
  const { hasPermission } = useAuth();
  const { hasModule, hasPage } = useEntitlements();

  const visibleItems = reportItems.filter(item => {
    if (!hasModule(item.moduleKey || "reports") || !hasPage(item.href)) return false;
    if (item.permissions && item.permissions.length > 0) {
      return item.permissions.some(p => hasPermission(p));
    }
    return !item.permission || hasPermission(item.permission as string);
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
            className="fixed bottom-0 left-0 right-0 z-[70] bg-white dark:bg-slate-900 rounded-t-2xl shadow-2xl max-h-[70vh] flex flex-col"
          >
            <div className="flex items-center justify-between px-6 pt-4 pb-3 border-b border-gray-100 dark:border-slate-800 shrink-0">
              <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                {t("nav.reports_center")}
              </h2>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-y-auto px-4 py-3 space-y-1">
              {visibleItems.map((item) => (
                (() => {
                  const Icon = item.icon || FileSpreadsheet;
                  return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  className={cn(
                    "flex items-center justify-between px-4 py-3.5 rounded-xl transition-colors",
                    pathname === item.href
                      ? "bg-primary-50 dark:bg-primary-500/10 text-primary-600 dark:text-primary-400"
                      : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800"
                  )}
                >
                  <div className="flex items-center gap-3.5">
                  <Icon className="w-5 h-5" />
                    <span className="text-sm font-medium">
                    {item.translationKey ? t(item.translationKey) : item.title}
                    </span>
                  </div>
                {item.badge && (
                  <span
                    title={t(item.badge)}
                    aria-label={t(item.badge)}
                    className="max-w-40 rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                  >
                    {t(item.badge)}
                  </span>
                )}
                  <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600" />
                </Link>
                );
                })()
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
