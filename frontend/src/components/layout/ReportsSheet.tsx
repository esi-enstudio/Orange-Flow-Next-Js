"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  BarChart3,
  FileSpreadsheet,
  Activity,
  CreditCard,
  Smartphone,
  X,
  ChevronRight,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useLanguage } from "@/i18n/useLanguage";

const reportItems = [
  {
    key: "report_activations",
    href: "/reports/activations",
    icon: BarChart3,
  },
  {
    key: "report_itopup",
    href: "/reports/itopup-details",
    icon: FileSpreadsheet,
  },
  {
    key: "report_live_activations",
    href: "/reports/live-activations",
    icon: Activity,
  },
  {
    key: "report_scratch_card",
    href: "/reports/scratch-card",
    icon: CreditCard,
  },
  {
    key: "report_sim_issue",
    href: "/reports/sim-issues",
    icon: Smartphone,
  },
];

interface ReportsSheetProps {
  open: boolean;
  onClose: () => void;
}

export function ReportsSheet({ open, onClose }: ReportsSheetProps) {
  const pathname = usePathname();
  const { t } = useLanguage();

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
              {reportItems.map((item) => (
                <Link
                  key={item.key}
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
                    <item.icon className="w-5 h-5" />
                    <span className="text-sm font-medium">
                      {t(`nav.${item.key}`)}
                    </span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600" />
                </Link>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
