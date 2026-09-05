"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { 
  LayoutDashboard, 
  BarChart3,
  Zap,
  Users, 
  Menu 
} from "lucide-react";

import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import { ReportsSheet } from "./ReportsSheet";
import { DMSSheet } from "./DMSSheet";
import { MoreSheet } from "./MoreSheet";

const reportPermissions = [
  "reports.view",
  "activations.view",
  "itopup.view",
  "live_activations.view",
  "transactions.view",
];

const dmsPermissions = [
  "dms.sim_issue",
  "dms.sim_status",
  "dms.sim_return",
  "scratch_card.view",
];

export function MobileNav() {
  const pathname = usePathname();
  const { t } = useLanguage();
  const { hasPermission } = useAuth();
  const [reportsOpen, setReportsOpen] = useState(false);
  const [dmsOpen, setDmsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const canViewAnyReport = reportPermissions.some(p => hasPermission(p));
  const canViewAnyDms = dmsPermissions.some(p => hasPermission(p));

  const canViewEmployees = hasPermission("employees.view");

  return (
    <>
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-900 border-t border-gray-100 dark:border-slate-800 px-6 py-3 z-40 shadow-[0_-4px_10px_rgba(0,0,0,0.03)] transition-colors duration-300">
        <div className="flex justify-between items-center">
          <Link
            href="/"
            className={cn(
              "flex flex-col items-center gap-1 transition-colors",
              pathname === "/" ? "text-primary-600 dark:text-primary-400" : "text-gray-400 dark:text-gray-500"
            )}
          >
            <LayoutDashboard className="w-5 h-5" />
            <span className="text-[10px] font-medium">{t('nav.dashboard')}</span>
          </Link>

          {canViewAnyReport && (
            <button
              onClick={() => setReportsOpen(true)}
              className={cn(
                "flex flex-col items-center gap-1 transition-colors",
                reportsOpen ? "text-primary-600 dark:text-primary-400" : "text-gray-400 dark:text-gray-500"
              )}
            >
              <BarChart3 className="w-5 h-5" />
              <span className="text-[10px] font-medium">{t('nav.reports_center')}</span>
            </button>
          )}

          {canViewAnyDms && (
            <button
              onClick={() => setDmsOpen(true)}
              className={cn(
                "flex flex-col items-center gap-1 transition-colors",
                dmsOpen ? "text-yellow-500" : "text-gray-400 dark:text-gray-500"
              )}
            >
              <Zap className="w-5 h-5" />
              <span className="text-[10px] font-medium">{t('nav.dms')}</span>
            </button>
          )}

          {canViewEmployees && (
            <Link
              href="/employees"
              className={cn(
                "flex flex-col items-center gap-1 transition-colors",
                pathname.startsWith("/employees") ? "text-primary-600 dark:text-primary-400" : "text-gray-400 dark:text-gray-500"
              )}
            >
              <Users className="w-5 h-5" />
              <span className="text-[10px] font-medium">{t('nav.employees')}</span>
            </Link>
          )}
          <button
            onClick={() => setMoreOpen(true)}
            className="flex flex-col items-center gap-1 transition-colors text-gray-400 dark:text-gray-500"
          >
            <Menu className="w-5 h-5" />
            <span className="text-[10px] font-medium">{t('nav.more')}</span>
          </button>
        </div>
      </div>

      <ReportsSheet open={reportsOpen} onClose={() => setReportsOpen(false)} />
      <DMSSheet open={dmsOpen} onClose={() => setDmsOpen(false)} />
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
    </>
  );
}
