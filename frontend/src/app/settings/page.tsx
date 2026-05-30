"use client";
import { useLanguage } from "@/i18n/useLanguage";
import { usePrimaryColor, PRIMARY_COLORS } from "@/context/ColorContext";
import { Settings, Palette, Sun, Moon, Monitor, Check } from "lucide-react";
import { useTheme } from "next-themes";
import { useState, useEffect } from "react";

export default function SettingsPage() {
  const { t } = useLanguage();
  const { primaryColor, setPrimaryColor } = usePrimaryColor();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  if (!mounted) return null;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <div className="flex items-center gap-4">
        <div className="p-3 bg-primary-100 dark:bg-primary-500/20 rounded-2xl shadow-sm">
          <Settings className="w-6 h-6 text-primary-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('settings.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t('settings.description')}</p>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-gray-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 dark:bg-amber-500/10 rounded-xl">
              <Palette className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('settings.theme_section')}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('settings.theme_description')}</p>
            </div>
          </div>
        </div>
        <div className="p-6">
          <div className="space-y-8">
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">{t('settings.color_label')}</p>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                {PRIMARY_COLORS.map((c) => (
                  <button key={c.id} onClick={() => setPrimaryColor(c.id)}
                    className="group relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all duration-200"
                    style={{
                      borderColor: primaryColor === c.id ? c.hex : "transparent",
                      backgroundColor: primaryColor === c.id ? `${c.hex}10` : "transparent",
                    }}>
                    <div className="relative">
                      <div className="w-10 h-10 rounded-full shadow-sm transition-transform duration-200 group-hover:scale-110"
                        style={{ backgroundColor: c.hex }} />
                      {primaryColor === c.id && (
                        <div className="absolute -top-1 -right-1 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center shadow-md">
                          <Check className="w-3 h-3 text-white" />
                        </div>
                      )}
                    </div>
                    <span className="text-xs font-medium text-gray-600 dark:text-gray-400">{c.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-6 border-t border-gray-100 dark:border-slate-800">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">Interface Mode</p>
              <div className="flex items-center gap-3 p-1 bg-gray-100 dark:bg-slate-800 rounded-xl w-fit">
                <button onClick={() => setTheme("light")}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    theme === "light" ? "bg-white dark:bg-slate-700 shadow-sm text-gray-900 dark:text-gray-100" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                  }`}>
                  <Sun className="w-4 h-4" /> Light
                </button>
                <button onClick={() => setTheme("dark")}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    theme === "dark" ? "bg-white dark:bg-slate-700 shadow-sm text-gray-900 dark:text-gray-100" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                  }`}>
                  <Moon className="w-4 h-4" /> Dark
                </button>
                <button onClick={() => setTheme("system")}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    theme === "system" ? "bg-white dark:bg-slate-700 shadow-sm text-gray-900 dark:text-gray-100" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                  }`}>
                  <Monitor className="w-4 h-4" /> System
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
