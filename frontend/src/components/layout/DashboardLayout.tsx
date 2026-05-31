"use client";

import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { Bell, Search, Loader2, Menu } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { useAuth } from "@/context/AuthContext";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { getProfilePicUrl } from "@/lib/utils";

import { LanguageSwitcher } from "./LanguageSwitcher";
import { useLanguage } from "@/i18n/useLanguage";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { loading, user } = useAuth();
  const { t } = useLanguage();
  const pathname = usePathname();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const isPublicPage = pathname === "/login" || pathname === "/register" || pathname === "/setup" || pathname === "/forgot-password" || pathname === "/reset-password";

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
    <div className="flex min-h-screen bg-[#F8FAFC] dark:bg-slate-950 transition-colors duration-300">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-20 bg-white dark:bg-slate-900 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between px-4 md:px-8 sticky top-0 z-40 transition-colors duration-300 gap-4">
          <div className="flex items-center gap-3 md:gap-6 flex-1 min-w-0">
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="md:hidden flex-shrink-0 w-10 h-10 bg-gray-50 dark:bg-slate-800 rounded-xl flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-primary-500 transition-colors"
            >
              <Menu className="w-5 h-5" />
            </button>
            
            <div className="relative hidden lg:block max-w-xs w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input 
                type="text" 
                placeholder={t('common.search')} 
                className="w-full pl-9 pr-4 py-2 bg-gray-50 dark:bg-slate-800 border-none rounded-lg text-sm focus:ring-2 focus:ring-primary-500 transition-all dark:text-gray-100 outline-none"
              />
            </div>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            <div className="hidden md:flex items-center gap-3">
               {/* Search icon for smaller desktop */}
               <button className="lg:hidden p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                 <Search className="w-5 h-5" />
               </button>
               
               <LanguageSwitcher />
               <ThemeToggle />
               
               <button className="p-2 text-gray-400 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/10 rounded-xl transition-all relative">
                 <Bell className="w-5 h-5" />
                 <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border-2 border-white dark:border-slate-900"></span>
               </button>
            </div>

            <div className="hidden md:block h-8 w-[1px] bg-gray-100 dark:bg-slate-800 mx-1"></div>
            
            <Link href="/profile" className="flex items-center gap-2 ml-1 sm:ml-0 group">
              <div className="hidden md:block text-right">
                <p className="text-xs font-bold text-gray-900 dark:text-gray-100 group-hover:text-primary-500 transition-colors">{user?.name || t('common.user')}</p>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 capitalize">{user?.roles?.[0]?.name || t('common.user')}</p>
              </div>
              <div className="w-8 h-8 rounded-full bg-primary-500 flex items-center justify-center text-white font-bold text-xs flex-shrink-0 group-hover:scale-110 transition-transform overflow-hidden">
                {user?.profile_pic ? (
                  <img src={getProfilePicUrl(user.profile_pic)!} alt="User" className="w-full h-full object-cover" />
                ) : (
                  user?.name?.charAt(0) || "U"
                )}
              </div>
            </Link>
          </div>
        </header>
        
        <main className="flex-1 p-4 md:p-8 pb-24 md:pb-8">
          {children}
        </main>
      </div>
      <MobileNav />
    </div>
  );
}
