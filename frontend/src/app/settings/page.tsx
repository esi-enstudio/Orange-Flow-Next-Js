"use client";
import { useLanguage } from "@/i18n/useLanguage";
import { usePrimaryColor, PRIMARY_COLORS } from "@/context/ColorContext";
import {
  Settings, Palette, Sun, Moon, Monitor, Check, Image, Save,
  Loader2, Upload, RefreshCw, Building2, Globe, Bell, Shield,
  Database, ChevronRight
} from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";
import { useState, useEffect } from "react";
import apiClient, { resolveImageUrl } from "@/lib/api";
import toast from "react-hot-toast";
import { useBrand } from "@/context/BrandContext";

type TabId = "general" | "appearance" | "automation";

interface Tab {
  id: TabId;
  label: string;
  icon: typeof Building2;
  description: string;
  color: string;
  bgColor: string;
}

const TABS: Tab[] = [
  { id: "general", label: "General", icon: Building2, description: "App name, logo & branding", color: "text-sky-600", bgColor: "bg-sky-100 dark:bg-sky-500/10" },
  { id: "appearance", label: "Appearance", icon: Palette, description: "Theme & color scheme", color: "text-amber-600", bgColor: "bg-amber-100 dark:bg-amber-500/10" },
  { id: "automation", label: "Automation", icon: RefreshCw, description: "Auto-sync & scheduler", color: "text-emerald-600", bgColor: "bg-emerald-100 dark:bg-emerald-500/10" },
];

function Toggle({ enabled, onToggle, disabled }: { enabled: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button onClick={onToggle} disabled={disabled}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200 ${
        enabled ? "bg-primary-500" : "bg-gray-300 dark:bg-slate-600"
      } disabled:opacity-50`}>
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-200 ${
        enabled ? "translate-x-6" : "translate-x-1"
      }`} />
    </button>
  );
}

export default function SettingsPage() {
  const { t } = useLanguage();
  const { primaryColor, setPrimaryColor } = usePrimaryColor();
  const { theme, setTheme } = useTheme();
  const { brand, updateBrand } = useBrand();
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("general");
  const [appName, setAppName] = useState(brand.app_name);
  const [logo, setLogo] = useState<string | null>(brand.logo);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dailySyncEnabled, setDailySyncEnabled] = useState(true);
  const [togglingSync, setTogglingSync] = useState(false);

  useEffect(() => {
    apiClient.get("settings/daily-sync").then(r => setDailySyncEnabled(r.data.enabled)).catch(() => {});
  }, []);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    setAppName(brand.app_name);
    setLogo(brand.logo);
  }, [brand]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiClient.put("settings/brand", { app_name: appName });
      updateBrand({ app_name: appName, logo });
      toast.success("Brand settings saved");
    } catch { toast.error("Failed to save"); }
    finally { setSaving(false); }
  };

  const handleToggleSync = async () => {
    setTogglingSync(true);
    const next = !dailySyncEnabled;
    try {
      await apiClient.put("settings/daily-sync", { enabled: next });
      setDailySyncEnabled(next);
      toast.success(next ? "Daily sync enabled" : "Daily sync disabled");
    } catch { toast.error("Toggle failed"); }
    finally { setTogglingSync(false); }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await apiClient.post("settings/brand/logo", form);
      const logoUrl = resolveImageUrl(res.data.logo);
      setLogo(logoUrl);
      updateBrand({ app_name: appName, logo: logoUrl });
      toast.success("Logo uploaded");
    } catch { toast.error("Failed to upload logo"); }
    finally { setUploading(false); }
  };

  if (!mounted) return null;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <div className="p-3 bg-primary-100 dark:bg-primary-500/20 rounded-2xl shadow-sm">
          <Settings className="w-6 h-6 text-primary-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('settings.title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{t('settings.description')}</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-2 mb-8 overflow-x-auto pb-2 scrollbar-none">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`group flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all duration-200 shrink-0 ${
                isActive
                  ? "border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-500/10 shadow-sm"
                  : "border-gray-100 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-gray-200 dark:hover:border-slate-700 hover:shadow-sm"
              }`}>
              <div className={`p-2 rounded-xl transition-colors ${isActive ? tab.bgColor : "bg-gray-100 dark:bg-slate-800 group-hover:bg-gray-200 dark:group-hover:bg-slate-700"}`}>
                <Icon className={`w-4 h-4 ${isActive ? tab.color : "text-gray-500 dark:text-gray-400"}`} />
              </div>
              <div className="text-left">
                <p className={`text-sm font-semibold ${isActive ? "text-gray-900 dark:text-gray-100" : "text-gray-700 dark:text-gray-300"}`}>{tab.label}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 hidden sm:block">{tab.description}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="transition-all duration-300">
        {activeTab === "general" && (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-gray-100 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-sky-100 dark:bg-sky-500/10 rounded-xl">
                  <Building2 className="w-5 h-5 text-sky-600" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Brand Settings</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Customize your app name and logo</p>
                </div>
              </div>
            </div>
            <div className="p-6 space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">App Name</label>
                <input type="text" value={appName} onChange={e => setAppName(e.target.value)}
                  className="w-full max-w-md px-4 py-2.5 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary-500 outline-none transition-all" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Logo</label>
                <div className="flex items-center gap-4">
                  {logo ? (
                    <img src={logo} alt="Brand logo" className="w-16 h-16 rounded-xl object-cover border border-gray-200 dark:border-slate-700" />
                  ) : (
                    <div className="w-16 h-16 rounded-xl bg-gray-100 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 flex items-center justify-center text-gray-400">
                      <Image className="w-6 h-6" />
                    </div>
                  )}
                  <label className="cursor-pointer inline-flex items-center gap-2 px-4 py-2.5 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 rounded-xl text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors">
                    <Upload className="w-4 h-4" />
                    {uploading ? "Uploading..." : "Upload Logo"}
                    <input type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                  </label>
                </div>
              </div>
              <button onClick={handleSave} disabled={saving}
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary-500 hover:bg-primary-600 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        )}

        {activeTab === "appearance" && (
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
            <div className="p-6 space-y-8">
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
                  {[
                    { id: "light" as const, label: "Light", icon: Sun },
                    { id: "dark" as const, label: "Dark", icon: Moon },
                    { id: "system" as const, label: "System", icon: Monitor },
                  ].map(mode => {
                    const Icon = mode.icon;
                    const isActive = theme === mode.id;
                    return (
                      <button key={mode.id} onClick={() => setTheme(mode.id)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                          isActive ? "bg-white dark:bg-slate-700 shadow-sm text-gray-900 dark:text-gray-100" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                        }`}>
                        <Icon className="w-4 h-4" /> {mode.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "automation" && (
          <div className="space-y-4">
            {/* Daily Sync */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
              <div className="p-6">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="p-2.5 bg-emerald-100 dark:bg-emerald-500/10 rounded-xl shrink-0">
                      <RefreshCw className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Daily Auto Sync</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Download reports from DMS daily at 7:00 AM</p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {["Activation", "iTopUp", "Scratch Card", "SIM Issue"].map(label => (
                          <span key={label} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-400">
                            {label}
                          </span>
                        ))}
                      </div>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                        {dailySyncEnabled ? "Sync is on — will auto-download daily at 7:00 AM" : "Sync is off — no data will be downloaded"}
                      </p>
                    </div>
                  </div>
                  <Toggle enabled={dailySyncEnabled} onToggle={handleToggleSync} disabled={togglingSync} />
                </div>
              </div>
            </div>

            {/* Placeholder for future automation settings */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden opacity-50 hover:opacity-80 transition-opacity">
              <div className="p-6">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="p-2.5 bg-gray-100 dark:bg-slate-800 rounded-xl shrink-0">
                      <Database className="w-5 h-5 text-gray-400" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-400 dark:text-gray-500">More automation settings coming soon...</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Additional sync and scheduler options</p>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-gray-300 dark:text-gray-600" />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
