"use client";

import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { Bell, Search, Loader2 } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { useAuth } from "@/context/AuthContext";
import { usePathname } from "next/navigation";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { loading, user } = useAuth();
  const pathname = usePathname();
  const isAuthPage = pathname === "/login" || pathname === "/register";

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F8FAFC] dark:bg-slate-950 transition-colors duration-300">
        <Loader2 className="h-10 w-10 text-orange-500 animate-spin mb-4" />
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Loading your dashboard...</p>
      </div>
    );
  }

  if (isAuthPage) {
    // If user is already logged in and tries to access login page, don't show it
    if (user) return null;
    return <>{children}</>;
  }

  // If not loading and no user, and not on auth page, don't render anything while redirecting
  if (!user) {
    return null;
  }

  return (
    <div className="flex min-h-screen bg-[#F8FAFC] dark:bg-slate-950 transition-colors duration-300">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white dark:bg-slate-900 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between px-4 md:px-8 sticky top-0 z-40 transition-colors duration-300 gap-4">
          <div className="flex items-center gap-3 md:gap-4 flex-1 min-w-0">
            <div className="md:hidden flex-shrink-0 w-8 h-8 bg-orange-500 rounded flex items-center justify-center">
              <span className="text-white font-bold">O</span>
            </div>
            <div className="relative hidden sm:block max-w-xs w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input 
                type="text" 
                placeholder="Search..." 
                className="w-full pl-9 pr-4 py-2 bg-gray-50 dark:bg-slate-800 border-none rounded-lg text-sm focus:ring-2 focus:ring-orange-500 transition-all dark:text-gray-100 outline-none"
              />
            </div>
          </div>
          
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            <ThemeToggle />
            <div className="hidden xs:block h-8 w-[1px] bg-gray-100 dark:bg-slate-800 mx-0.5 sm:mx-1"></div>
            <button className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 relative">
              <Bell className="w-5 h-5" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border-2 border-white dark:border-slate-900"></span>
            </button>
            <div className="hidden md:block h-8 w-[1px] bg-gray-100 dark:bg-slate-800 mx-1"></div>
            <div className="flex items-center gap-2 ml-1 sm:ml-0">
              <div className="hidden md:block text-right">
                <p className="text-xs font-bold text-gray-900 dark:text-gray-100">{user?.name || "User"}</p>
                <p className="text-[10px] text-gray-500 dark:text-gray-400 capitalize">{user?.status || "Active"}</p>
              </div>
              <div className="w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center text-white font-bold text-xs flex-shrink-0">
                {user?.name?.charAt(0) || "U"}
              </div>
            </div>
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
