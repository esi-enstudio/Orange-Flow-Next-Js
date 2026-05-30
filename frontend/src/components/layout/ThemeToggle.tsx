"use client";

import * as React from "react";
import { Moon, Sun, Monitor } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

export function ThemeToggle() {
  const { setTheme, theme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  // Avoid hydration mismatch
  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return <div className="w-9 h-9" />;

  const themes = [
    { name: "light", icon: Sun },
    { name: "dark", icon: Moon },
    { name: "system", icon: Monitor },
  ];

  return (
    <div className="flex items-center p-1 bg-gray-100 dark:bg-slate-800 rounded-lg">
      {themes.map((t) => (
        <button
          key={t.name}
          onClick={() => setTheme(t.name)}
          className={cn(
            "p-1.5 rounded-md transition-all",
            theme === t.name
              ? "bg-white dark:bg-slate-700 text-primary-600 shadow-sm"
              : "text-gray-500 hover:text-gray-900 dark:hover:text-gray-100"
          )}
          title={t.name.charAt(0).toUpperCase() + t.name.slice(1)}
        >
          <t.icon className="w-4 h-4" />
        </button>
      ))}
    </div>
  );
}
