"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { 
  LayoutDashboard, 
  Store, 
  MapPin, 
  Users, 
  Menu 
} from "lucide-react";

export function MobileNav() {
  const pathname = usePathname();

  const mobileItems = [
    { title: "Home", href: "/", icon: LayoutDashboard },
    { title: "Retailers", href: "/retailers", icon: Store },
    { title: "BTS", href: "/bts", icon: MapPin },
    { title: "Field", href: "/field-force", icon: Users },
    { title: "More", href: "/more", icon: Menu },
  ];

  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-900 border-t border-gray-100 dark:border-slate-800 px-6 py-3 z-50 shadow-[0_-4px_10px_rgba(0,0,0,0.03)] transition-colors duration-300">
      <div className="flex justify-between items-center">
        {mobileItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-col items-center gap-1",
              pathname === item.href ? "text-orange-600 dark:text-orange-400" : "text-gray-400 dark:text-gray-500"
            )}
          >
            <item.icon className="w-5 h-5" />
            <span className="text-[10px] font-medium">{item.title}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
