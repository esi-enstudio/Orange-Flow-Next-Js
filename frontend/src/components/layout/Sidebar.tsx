"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn, getProfilePicUrl } from "@/lib/utils";
import { navItems } from "@/lib/constants";
import { ChevronRight, ChevronDown, LogOut, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { motion, AnimatePresence } from "framer-motion";
import { useLanguage } from "@/i18n/useLanguage";
import { useBrand } from "@/context/BrandContext";

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { user, logout, hasPermission } = useAuth();
  const { t } = useLanguage();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const { brand } = useBrand();

  // Filter items based on permissions - use memo to prevent mutation of constant
  const filteredNavItems = React.useMemo(() => {
    return navItems
      .map(item => ({ ...item })) // Shallow clone parent
      .filter(item => {
        // 1. If it has a direct permission, check it
        if (item.permission && !hasPermission(item.permission)) return false;

        // 2. If it has children, check if any child is visible
        if (item.children) {
          const visibleChildren = item.children.filter(child => 
            !child.permission || hasPermission(child.permission)
          );
          // If no children are visible, hide the parent
          if (visibleChildren.length === 0) return false;
          
          // Assign cloned children
          item.children = visibleChildren;
        }

        return true;
      });
  }, [hasPermission]);

  // Auto-open parent menu if a child is active
  React.useEffect(() => {
    const activeParent = filteredNavItems.find(item => 
      item.children?.some(child => child.href === pathname)
    );
    if (activeParent) {
      setOpenMenu(activeParent.title);
    }
  }, [pathname, filteredNavItems]);

  const toggleMenu = (title: string) => {
    setOpenMenu(prev => prev === title ? null : title);
  };

  const sidebarContent = (
    <div className="flex flex-col h-full overflow-y-auto scrollbar-hide">
      <div className="p-6">
        <div className="flex items-center justify-between gap-2 mb-8">
          <div className="flex items-center gap-2">
            {brand.logo ? (
              <img src={brand.logo} alt="Logo" className="w-8 h-8 rounded-lg object-cover" />
            ) : (
              <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center shadow-lg shadow-orange-200 dark:shadow-none">
                <span className="text-white font-bold text-lg">{brand.app_name.charAt(0)}</span>
              </div>
            )}
            <span className="font-bold text-xl tracking-tight dark:text-gray-100">{brand.app_name}</span>
          </div>
          {/* Mobile Close Button */}
          <button 
            onClick={onClose}
            className="md:hidden p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-xl bg-gray-50 dark:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="space-y-1">
          {filteredNavItems.map((item) => {
            const hasChildren = item.children && item.children.length > 0;
            const isOpenMenu = openMenu === item.title;
            const isParentActive = item.children?.some(c => c.href === pathname);
            const isDirectActive = item.href === pathname;

            return (
              <div key={item.title} className="space-y-1">
                {hasChildren ? (
                  <button
                    onClick={() => toggleMenu(item.title)}
                    className={cn(
                      "w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all duration-200 group",
                      isParentActive 
                        ? "bg-primary-50 dark:bg-primary-500/10 text-primary-600 dark:text-primary-400 font-semibold"
                        : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 hover:text-gray-900 dark:hover:text-gray-100"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <item.icon className={cn(
                        "w-5 h-5 transition-colors",
                        isParentActive ? "text-primary-600 dark:text-primary-400" : item.color || "text-gray-400 dark:text-gray-500",
                        "group-hover:text-primary-600 dark:group-hover:text-primary-400"
                      )} />
                      <span className="text-sm">{item.translationKey ? t(item.translationKey) : item.title}</span>
                    </div>
                    <ChevronDown className={cn(
                      "w-4 h-4 opacity-40 transition-transform duration-200",
                      isOpenMenu && "rotate-180"
                    )} />
                  </button>
                ) : (
                  <Link
                    href={item.href || "#"}
                    onClick={() => { if (window.innerWidth < 768 && onClose) onClose(); }}
                    className={cn(
                      "flex items-center justify-between px-3 py-2.5 rounded-xl transition-all duration-200 group",
                      isDirectActive
                        ? "bg-primary-50 dark:bg-primary-500/10 text-primary-600 dark:text-primary-400 font-semibold"
                        : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 hover:text-gray-900 dark:hover:text-gray-100"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <item.icon className={cn(
                        "w-5 h-5 transition-colors",
                        isDirectActive ? "text-primary-600 dark:text-primary-400" : item.color || "text-gray-400 dark:text-gray-500",
                        "group-hover:text-primary-600 dark:group-hover:text-primary-400"
                      )} />
                      <span className="text-sm">{item.translationKey ? t(item.translationKey) : item.title}</span>
                    </div>
                  </Link>
                )}

                <AnimatePresence>
                  {hasChildren && isOpenMenu && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2, ease: "easeInOut" }}
                      className="overflow-hidden ml-5"
                    >
                      <div className="space-y-1 pt-1 pb-1">
                        {item.children?.map((child) => {
                          const isChildActive = pathname === child.href;

                          return (
                            <Link
                              key={child.href}
                              href={child.href}
                              onClick={() => { if (window.innerWidth < 768 && onClose) onClose(); }}
                              className={cn(
                                "flex items-center gap-4 px-3 py-2 rounded-lg text-xs transition-all group/item",
                                isChildActive
                                  ? "text-primary-600 dark:text-primary-400 font-bold bg-primary-50/50 dark:bg-primary-500/5"
                                  : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
                              )}
                            >
                              <div className={cn(
                                "w-1.5 h-1.5 rounded-full transition-all duration-300",
                                isChildActive 
                                  ? "bg-primary-500 scale-125" 
                                  : "bg-gray-300 dark:bg-slate-700 group-hover/item:bg-primary-300"
                              )} />
                              <span className="flex-1">{child.translationKey ? t(child.translationKey) : child.title}</span>
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
        </nav>
      </div>

      <div className="mt-auto p-6 space-y-4">
        <div className="flex items-center gap-3 p-2 bg-gray-50 dark:bg-slate-800 rounded-xl group/card">
          <Link href="/profile" className="flex items-center gap-3 flex-1 overflow-hidden group">
            <div className="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-500/20 flex items-center justify-center text-primary-600 dark:text-primary-400 font-bold text-xs group-hover:scale-110 transition-transform overflow-hidden">
              {user?.profile_pic ? (
                <img src={getProfilePicUrl(user.profile_pic)!} alt="User" className="w-full h-full object-cover" />
              ) : (
                user?.name?.charAt(0) || "U"
              )}
            </div>
            <div className="flex flex-col overflow-hidden">
              <span className="text-xs font-bold truncate dark:text-gray-100 group-hover:text-primary-500 transition-colors">{user?.name || t('common.user')}</span>
              <span className="text-[10px] text-gray-500 dark:text-gray-400 truncate capitalize">{user?.roles?.[0]?.name || t('common.user')}</span>
            </div>
          </Link>
          <button 
            onClick={logout}
            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
            title={t('common.logout')}
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-64 bg-white dark:bg-slate-900 border-r border-gray-100 dark:border-slate-800 h-screen sticky top-0 transition-colors duration-300 scrollbar-hide">
        {sidebarContent}
      </aside>

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
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
