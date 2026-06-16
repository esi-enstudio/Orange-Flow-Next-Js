"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import apiClient from "@/lib/api";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity, Users, UserCheck, Target, Award,
  BarChart3, RefreshCw, FileSpreadsheet,
  Radio, Shield, Building2, UserCog,
  Smartphone, ChevronDown, ChevronUp, Grid3X3, List,
  Sparkles, Medal, Zap, Search, Check, CalendarDays,
  Pencil, Settings, Play, Square,
  type LucideIcon,
} from "lucide-react";

import SectionConfigModal from "./SectionConfigModal";
import {
  PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, Legend, Tooltip,
  LineChart, Line,
} from "recharts";

/* ─────────── types ─────────── */
interface GaLiveData {
  summary: {
    total_activations: number;
    yesterday_total: number;
    employee_activation: number;
    employee_activation_pct: number;
    market_activation: number;
    market_activation_pct: number;
    total_selected_employees: number;
    activated_employee_count: number;
    active_supervisors: number;
    active_rso: number;
    active_bp: number;
    active_cc: number;
    total_supervisors: number;
    total_rso: number;
    total_bp: number;
    total_cc: number;
  };
  distribution: {
    employee_activation: number;
    employee_activation_pct: number;
    market_activation: number;
    market_activation_pct: number;
  };
  supervisors: Array<{
    id: number;
    name: string;
    dms_code: string;
    total_activation: number;
    employee_activation: number;
    market_activation: number;
    contribution: number;
    active_rso: number;
    active_bp: number;
    active_cc: number;
  }>;
  rsos: Array<{
    id: number;
    name: string;
    dms_code: string;
    itop_number: string;
    assisted_code: string;
    total_activation: number;
    own_activation: number;
    market_activation: number;
    contribution: number;
  }>;
  bps: Array<{
    id: number;
    name: string;
    dms_code: string;
    assisted_code: string;
    pool_number: string;
    own_activation: number;
    contribution: number;
    rank: number;
  }>;
  ccs: Array<{
    id: number;
    name: string;
    dms_code: string;
    own_activation: number;
    contribution: number;
  }>;
  top_performers: {
    supervisor: Record<string, unknown> | null;
    rso: Record<string, unknown> | null;
    bp: Record<string, unknown> | null;
    cc: Record<string, unknown> | null;
  };
  insights: string[];
  trend: Array<{ date: string; count: number }>;
  date_range: { start: string; end: string };
}

/* ─────────── colors ─────────── */
const PIE_COLORS = ["#8b5cf6", "#f59e0b"];
const CHART_COLORS = ["#8b5cf6", "#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#14b8a6"];

/* ─────────── KPI Card ─────────── */
function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white dark:bg-slate-800/80 rounded-2xl border border-gray-100 dark:border-slate-700/50 p-5 hover:shadow-lg hover:border-gray-200 dark:hover:border-slate-600 transition-all duration-300"
    >
      <div className="flex items-center justify-between mb-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${color}15` }}
        >
          <Icon className="w-5 h-5" style={{ color }} />
        </div>
      </div>
      <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 mb-0.5 truncate uppercase tracking-wider">
        {label}
      </p>
      <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      {sub && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{sub}</p>
      )}
    </motion.div>
  );
}

/* ─────────── Section Header ─────────── */
function SectionHeader({ title, subtitle, action, onEdit }: { title: string; subtitle?: string; action?: React.ReactNode; onEdit?: () => void }) {
  return (
    <div className="flex items-center justify-between mb-5">
      <div>
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">{title}</h2>
        {subtitle && <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {onEdit && (
          <button
            onClick={onEdit}
            className="p-2 rounded-xl opacity-0 group-hover:opacity-100 transition-all duration-200 border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 shadow-sm hover:shadow-md"
            title="Configure section exclusions"
          >
            <Pencil className="w-3.5 h-3.5 text-gray-400" />
          </button>
        )}
        {action}
      </div>
    </div>
  );
}

/* ─────────── Skeleton ─────────── */
function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-gray-200 dark:bg-slate-700 rounded-xl", className)} />;
}

function LoadingSkeleton() {
  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-72 mt-2" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

/* ─────────── Empty State ─────────── */
function EmptyState({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-24 h-24 rounded-2xl bg-gray-50 dark:bg-slate-800 flex items-center justify-center mb-5">
        <Radio className="w-12 h-12 text-gray-300 dark:text-gray-600" />
      </div>
      <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300">
        No activation data found
      </h3>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-1.5 max-w-sm">
        No activation data found for the selected period. Try a different date range or check sync settings.
      </p>
      <button
        onClick={onRefresh}
        className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary-500 text-white text-sm font-medium hover:bg-primary-600 transition-colors"
      >
        <RefreshCw className="w-4 h-4" />
        Refresh Data
      </button>
    </div>
  );
}

/* ─────────── House Selector (Searchable Dropdown) ─────────── */
function HouseSelector({
  houses,
  selected,
  onSelect,
  loading,
}: {
  houses: Array<{ id: number; name: string; code: string }>;
  selected: number | null;
  onSelect: (id: number) => void;
  loading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const selectedHouse = useMemo(
    () => houses.find((h) => h.id === selected) ?? null,
    [houses, selected]
  );

  const filtered = useMemo(
    () =>
      houses.filter(
        (h) =>
          h.name.toLowerCase().includes(query.toLowerCase()) ||
          h.code.toLowerCase().includes(query.toLowerCase())
      ),
    [houses, query]
  );

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  if (houses.length === 1 && selected === houses[0].id) return null;

  if (houses.length === 0) {
    if (loading) {
      return (
        <div className="bg-white dark:bg-slate-800/80 rounded-2xl border border-gray-100 dark:border-slate-700/50 p-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 rounded-full border-2 border-primary-500 border-t-transparent animate-spin" />
            <span className="text-sm text-gray-500 dark:text-gray-400">Loading houses...</span>
          </div>
        </div>
      );
    }
    return (
      <div className="bg-white dark:bg-slate-800/80 rounded-2xl border border-gray-100 dark:border-slate-700/50 p-4 mb-6">
        <div className="flex items-center gap-3">
          <Building2 className="w-5 h-5 text-gray-400" />
          <span className="text-sm text-gray-500 dark:text-gray-400">No houses available</span>
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative mb-6">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "w-full flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all text-left",
          open
            ? "border-primary-400 dark:border-primary-500 shadow-md shadow-primary-500/10 ring-1 ring-primary-500/20"
            : "border-gray-200 dark:border-slate-600 hover:border-gray-300 dark:hover:border-slate-500 bg-white dark:bg-slate-800/80"
        )}
      >
        <Building2 className="w-5 h-5 text-primary-500 shrink-0" />
        <div className="flex-1 min-w-0">
          {selectedHouse ? (
            <>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                {selectedHouse.name}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{selectedHouse.code}</p>
            </>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">Select a house</p>
          )}
        </div>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-gray-400 transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 z-50 mt-2 bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-600 shadow-xl overflow-hidden">
          <div className="p-3 border-b border-gray-100 dark:border-slate-700/50">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                autoFocus
                type="text"
                placeholder="Search houses..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-gray-50 dark:bg-slate-700/50 border border-gray-200 dark:border-slate-600 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-400"
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-400 text-center">No houses match your search</p>
            ) : (
              filtered.map((h) => (
                <button
                  key={h.id}
                  onClick={() => {
                    onSelect(h.id);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-slate-700/50",
                    selected === h.id && "bg-primary-50 dark:bg-primary-500/5"
                  )}
                >
                  <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-slate-700 flex items-center justify-center shrink-0">
                    <Building2 className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={cn(
                      "text-sm font-medium truncate",
                      selected === h.id
                        ? "text-primary-700 dark:text-primary-400"
                        : "text-gray-900 dark:text-gray-100"
                    )}>
                      {h.name}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{h.code}</p>
                  </div>
                  {selected === h.id && (
                    <Check className="w-4 h-4 text-primary-500 shrink-0" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────── Custom Tooltip ─────────── */
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload) return null;
  return (
    <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl px-3 py-2 shadow-lg text-sm">
      {label && <p className="font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</p>}
      {payload.map((p: any, i: number) => (
        <p key={i} className="text-gray-600 dark:text-gray-400">
          {p.name}: <span className="font-semibold">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

/* ─────────── Main Page ─────────── */
export default function GaLiveReportPage() {
  const { user, hasPermission, loading: authLoading } = useAuth();

  const [data, setData] = useState<GaLiveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSup, setExpandedSup] = useState<number | null>(null);
  const [rsoView, setRsoView] = useState<"grid" | "table">("grid");
  const [selectedHouseId, setSelectedHouseId] = useState<number | null>(null);
  const [allHouses, setAllHouses] = useState<Array<{ id: number; name: string; code: string }> | null>(null);
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [configVersion, setConfigVersion] = useState(0);
  const [liveSyncEnabled, setLiveSyncEnabled] = useState(true);
  const [liveSyncLoading, setLiveSyncLoading] = useState(false);

  const isAdmin = hasPermission("ga_section_configs.edit");

  function todayStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  const today = todayStr();

  const assignedHouses = useMemo(() => user?.houses ?? [], [user]);

  const houses = useMemo(() => {
    if (allHouses) return allHouses;
    return assignedHouses;
  }, [assignedHouses, allHouses]);

  const housesLoading = assignedHouses.length === 0 && allHouses === null;

  useEffect(() => {
    if (assignedHouses.length === 0 && !allHouses) {
      apiClient.get("/houses/accessible").then(res => setAllHouses(res.data)).catch(() => {});
    }
  }, [assignedHouses, allHouses]);

  const effectiveHouseId = useMemo(
    () => selectedHouseId ?? (houses.length === 1 ? houses[0].id : null),
    [selectedHouseId, houses]
  );

  const fetchData = useCallback(async () => {
    if (!effectiveHouseId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get("/reports/live-activations", {
        params: { house_id: effectiveHouseId, start_date: today, end_date: today },
      });
      setData(res.data);
    } catch {
      setError("Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [effectiveHouseId, today, configVersion]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    apiClient.get("/settings/live-sync").then(res => {
      setLiveSyncEnabled(res.data.enabled);
    }).catch(() => {});
  }, []);

  const toggleLiveSync = async () => {
    setLiveSyncLoading(true);
    try {
      const res = await apiClient.put("/settings/live-sync", { enabled: !liveSyncEnabled });
      setLiveSyncEnabled(res.data.enabled);
    } catch {
      // silent
    } finally {
      setLiveSyncLoading(false);
    }
  };

  const handleExport = async () => {
    if (!effectiveHouseId) return;
    try {
      const res = await apiClient.get("/live-activations/export", {
        params: { start_date: today, end_date: today, house_id: effectiveHouseId },
        responseType: "blob",
      });
      const blob = new Blob([res.data]);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `live_activations_${today}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Export failed: ${msg}`);
    }
  };

  /* auth guard */
  if (authLoading) return <LoadingSkeleton />;
  if (!hasPermission("live_activations.view")) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <Shield className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400">Access Denied</p>
        </div>
      </div>
    );
  }

  if (loading) return <LoadingSkeleton />;

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center max-w-sm">
          <p className="text-red-500 mb-2 text-sm">{error}</p>
          <button onClick={fetchData} className="px-4 py-2 rounded-xl bg-primary-500 text-white text-sm font-medium">
            <RefreshCw className="w-4 h-4 inline mr-2" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!effectiveHouseId) {
    return (
      <div className="p-4 md:p-6 max-w-7xl mx-auto">
        <HouseSelector houses={houses} selected={selectedHouseId} onSelect={setSelectedHouseId} loading={housesLoading} />
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Building2 className="w-16 h-16 text-gray-200 dark:text-gray-700 mb-4" />
          <p className="text-gray-500 dark:text-gray-400">Select a house to view the report</p>
        </div>
      </div>
    );
  }

  if (!data) return <EmptyState onRefresh={fetchData} />;

  const { summary, distribution, supervisors, rsos, bps, ccs, top_performers, insights, trend } = data;
  const totalActivation = summary.total_activations;

  /* chart data */
  const donutData = [
    { name: "Employee", value: distribution.employee_activation, color: PIE_COLORS[0] },
    { name: "Market", value: distribution.market_activation, color: PIE_COLORS[1] },
  ].filter((d) => d.value > 0);

  const supBarData = [...supervisors].sort((a, b) => b.total_activation - a.total_activation).slice(0, 10);

  const rsoBarData = [...rsos].sort((a, b) => b.total_activation - a.total_activation).slice(0, 10);
  const bpBarData = [...bps].sort((a, b) => b.own_activation - a.own_activation).slice(0, 10);

  return (
    <div className="p-4 md:p-6 space-y-8 max-w-7xl mx-auto pb-32">
      {/* House Selector */}
      <HouseSelector houses={houses} selected={selectedHouseId} onSelect={setSelectedHouseId} loading={housesLoading} />

      {/* ────── Header ────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-gray-100 tracking-tight flex items-center gap-3">
            <Radio className="w-7 h-7 text-primary-500" />
            GA Live Report
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Real-time activation performance overview of your selected house.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={toggleLiveSync}
            disabled={liveSyncLoading}
            className={cn(
              "px-3 py-2 rounded-xl border text-sm font-medium flex items-center gap-2 transition-all",
              liveSyncEnabled
                ? "border-green-300 dark:border-green-500/30 bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-500/20"
                : "border-red-300 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20"
            )}
            title={liveSyncEnabled ? "Live sync is ON — click to stop" : "Live sync is OFF — click to start"}
          >
            {liveSyncEnabled ? <Play className="w-3.5 h-3.5 fill-current" /> : <Square className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">Live Sync</span>
          </button>
          <div className="px-3 py-2 rounded-xl border border-gray-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-gray-400" />
            {today}
          </div>
          <button
            onClick={fetchData}
            className="p-2.5 rounded-xl bg-primary-500 text-white hover:bg-primary-600 transition-colors disabled:opacity-50"
            disabled={loading}
            title="Refresh"
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </button>
          <button
            onClick={handleExport}
            className="p-2.5 rounded-xl border border-gray-200 dark:border-slate-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
            title="Export Excel"
          >
            <FileSpreadsheet className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ────── Top Performers ────── */}
      {(top_performers.supervisor || top_performers.rso || top_performers.bp || top_performers.cc) && (
        <div className="group relative">
        <section>
          <SectionHeader title="Top Performers" subtitle="Highest achievers across all roles" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {top_performers.supervisor && (
              <div className="bg-gradient-to-br from-primary-50 to-primary-100 dark:from-primary-500/10 dark:to-primary-600/5 rounded-2xl border border-primary-200 dark:border-primary-500/20 p-5 relative overflow-hidden">
                <div className="absolute top-3 right-3 text-primary-300/50 dark:text-primary-400/20">
                  <Medal className="w-8 h-8" />
                </div>
                <p className="text-xs font-medium text-primary-600 dark:text-primary-400 uppercase tracking-wider mb-2">Top Supervisor</p>
                <p className="font-bold text-gray-900 dark:text-gray-100 text-lg truncate">{top_performers.supervisor.name as string}</p>
                <p className="text-sm text-primary-600 dark:text-primary-400 mt-1">
                  {(top_performers.supervisor.total_activation as number).toLocaleString()} activations
                </p>
                <span className="inline-block mt-2 text-xs font-medium px-2 py-0.5 rounded-full bg-white/60 dark:bg-slate-800/60 text-gray-600 dark:text-gray-400">
                  {(top_performers.supervisor.contribution as number).toFixed(1)}% contribution
                </span>
              </div>
            )}
            {top_performers.rso && (
              <div className="bg-gradient-to-br from-orange-50 to-orange-100 dark:from-orange-500/10 dark:to-orange-600/5 rounded-2xl border border-orange-200 dark:border-orange-500/20 p-5 relative overflow-hidden">
                <div className="absolute top-3 right-3 text-orange-300/50 dark:text-orange-400/20">
                  <Award className="w-8 h-8" />
                </div>
                <p className="text-xs font-medium text-orange-600 dark:text-orange-400 uppercase tracking-wider mb-2">Top RSO</p>
                <p className="font-bold text-gray-900 dark:text-gray-100 text-lg truncate">{top_performers.rso.name as string}</p>
                <p className="text-sm text-orange-600 dark:text-orange-400 mt-1">
                  {(top_performers.rso.total_activation as number).toLocaleString()} activations
                </p>
                <span className="inline-block mt-2 text-xs font-medium px-2 py-0.5 rounded-full bg-white/60 dark:bg-slate-800/60 text-gray-600 dark:text-gray-400">
                  {(top_performers.rso.contribution as number).toFixed(1)}% contribution
                </span>
              </div>
            )}
            {top_performers.bp && (
              <div className="bg-gradient-to-br from-teal-50 to-teal-100 dark:from-teal-500/10 dark:to-teal-600/5 rounded-2xl border border-teal-200 dark:border-teal-500/20 p-5 relative overflow-hidden">
                <div className="absolute top-3 right-3 text-teal-300/50 dark:text-teal-400/20">
                  <Zap className="w-8 h-8" />
                </div>
                <p className="text-xs font-medium text-teal-600 dark:text-teal-400 uppercase tracking-wider mb-2">Top BP</p>
                <p className="font-bold text-gray-900 dark:text-gray-100 text-lg truncate">{top_performers.bp.name as string}</p>
                <p className="text-sm text-teal-600 dark:text-teal-400 mt-1">
                  {(top_performers.bp.own_activation as number).toLocaleString()} activations
                </p>
                <span className="inline-block mt-2 text-xs font-medium px-2 py-0.5 rounded-full bg-white/60 dark:bg-slate-800/60 text-gray-600 dark:text-gray-400">
                  {(top_performers.bp.contribution as number).toFixed(1)}% contribution
                </span>
              </div>
            )}
            {top_performers.cc && (
              <div className="bg-gradient-to-br from-rose-50 to-rose-100 dark:from-rose-500/10 dark:to-rose-600/5 rounded-2xl border border-rose-200 dark:border-rose-500/20 p-5 relative overflow-hidden">
                <div className="absolute top-3 right-3 text-rose-300/50 dark:text-rose-400/20">
                  <BarChart3 className="w-8 h-8" />
                </div>
                <p className="text-xs font-medium text-rose-600 dark:text-rose-400 uppercase tracking-wider mb-2">Top CC</p>
                <p className="font-bold text-gray-900 dark:text-gray-100 text-lg truncate">{top_performers.cc.name as string}</p>
                <p className="text-sm text-rose-600 dark:text-rose-400 mt-1">
                  {(top_performers.cc.own_activation as number).toLocaleString()} activations
                </p>
                <span className="inline-block mt-2 text-xs font-medium px-2 py-0.5 rounded-full bg-white/60 dark:bg-slate-800/60 text-gray-600 dark:text-gray-400">
                  {(top_performers.cc.contribution as number).toFixed(1)}% contribution
                </span>
              </div>
            )}
          </div>
        </section>
        </div>
      )}

      {/* ────── Executive Summary ────── */}
      <section>
        <SectionHeader title="Executive Summary" subtitle="Key activation metrics for the selected period" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="group relative">
            <KpiCard
              icon={Activity}
              label="Total Activation"
              value={summary.total_activations}
              sub={`Yesterday GA - ${(summary.yesterday_total ?? 0).toLocaleString()}`}
              color="#8b5cf6"
            />
            {isAdmin && (
              <button
                onClick={() => setEditingSection("total_activation")}
                className="absolute top-2 right-2 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 shadow-sm hover:bg-gray-50 dark:hover:bg-slate-700 z-10"
                title="Configure exclusions"
              >
                <Pencil className="w-3 h-3 text-gray-400" />
              </button>
            )}
          </div>
          <div className="group relative">
            <KpiCard
              icon={UserCheck}
              label="Employee Activation"
              value={summary.employee_activation}
              sub={`${summary.activated_employee_count} / ${summary.total_selected_employees} (${summary.total_selected_employees > 0 ? Math.round(summary.activated_employee_count / summary.total_selected_employees * 100) : 0}%) employees activated`}
              color="#10b981"
            />
            {isAdmin && (
              <button
                onClick={() => setEditingSection("employee_activation")}
                className="absolute top-2 right-2 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 shadow-sm hover:bg-gray-50 dark:hover:bg-slate-700 z-10"
                title="Configure product exclusions"
              >
                <Pencil className="w-3 h-3 text-gray-400" />
              </button>
            )}
          </div>
          <div className="group relative">
            <KpiCard
              icon={Target}
              label="Market Activation"
              value={summary.market_activation}
              sub={`${summary.market_activation_pct}% of total`}
              color="#f59e0b"
            />
            {isAdmin && (
              <button
                onClick={() => setEditingSection("market_activation")}
                className="absolute top-2 right-2 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 shadow-sm hover:bg-gray-50 dark:hover:bg-slate-700 z-10"
                title="Configure product exclusions"
              >
                <Pencil className="w-3 h-3 text-gray-400" />
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ────── Activation Distribution ────── */}
      <div className="relative">
      <section>
        <SectionHeader title="Activation Distribution" subtitle="Employee vs Market breakdown and contribution analysis" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Donut */}
          <div className="relative group">
          <div className="bg-white dark:bg-slate-800/80 rounded-2xl border border-gray-100 dark:border-slate-700/50 p-5">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Employee vs Market</h3>
            {donutData.length === 0 ? (
              <div className="flex items-center justify-center h-56 text-gray-400 text-sm">No data</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={donutData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={4}>
                    {donutData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            )}
            <div className="flex justify-center gap-6 mt-2">
              {donutData.map((d) => (
                <div key={d.name} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: d.color }} />
                  <span className="text-xs text-gray-600 dark:text-gray-400">
                    {d.name}: {((d.value / (donutData.reduce((a, b) => a + b.value, 0))) * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
            {isAdmin && (
              <button
                onClick={() => setEditingSection("distribution")}
                className="absolute top-3 right-3 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 shadow-sm hover:bg-gray-50 dark:hover:bg-slate-700 z-10"
                title="Configure Employee vs Market"
              >
                <Pencil className="w-3 h-3 text-gray-400" />
              </button>
            )}
          </div>
          </div>

          {/* Horizontal Bar - RSO Contribution */}
          <div className="relative group">
          <div className="bg-white dark:bg-slate-800/80 rounded-2xl border border-gray-100 dark:border-slate-700/50 p-5">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">RSO Contribution</h3>
            {rsoBarData.length === 0 ? (
              <div className="flex items-center justify-center h-56 text-gray-400 text-sm">No data</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={rsoBarData} layout="vertical" margin={{ left: 0, right: 0, top: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="total_activation" fill="#3b82f6" radius={[0, 4, 4, 0]} name="Activation" />
                </BarChart>
              </ResponsiveContainer>
            )}
            {isAdmin && (
              <button
                onClick={() => setEditingSection("rsos")}
                className="absolute top-3 right-3 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 shadow-sm hover:bg-gray-50 dark:hover:bg-slate-700 z-10"
                title="Configure RSO Contribution"
              >
                <Pencil className="w-3 h-3 text-gray-400" />
              </button>
            )}
          </div>
          </div>

          {/* Horizontal Bar - BP Contribution */}
          <div className="relative group">
          <div className="bg-white dark:bg-slate-800/80 rounded-2xl border border-gray-100 dark:border-slate-700/50 p-5">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">BP Contribution</h3>
            {bpBarData.length === 0 ? (
              <div className="flex items-center justify-center h-56 text-gray-400 text-sm">No data</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={bpBarData} layout="vertical" margin={{ left: 0, right: 0, top: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="own_activation" fill="#10b981" radius={[0, 4, 4, 0]} name="Activation" />
                </BarChart>
              </ResponsiveContainer>
            )}
            {isAdmin && (
              <button
                onClick={() => setEditingSection("bps")}
                className="absolute top-3 right-3 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-600 shadow-sm hover:bg-gray-50 dark:hover:bg-slate-700 z-10"
                title="Configure BP Contribution"
              >
                <Pencil className="w-3 h-3 text-gray-400" />
              </button>
            )}
          </div>
          </div>
        </div>
      </section>
      </div>

      {/* ────── Trend Chart ────── */}
      {trend.length > 0 && (
        <div className="group relative">
        <section>
          <SectionHeader title="Activation Trend" subtitle="Daily activation count for the selected period" onEdit={isAdmin ? () => setEditingSection("total_activation") : undefined} />
          <div className="bg-white dark:bg-slate-800/80 rounded-2xl border border-gray-100 dark:border-slate-700/50 p-5">
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={trend} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip content={<ChartTooltip />} />
                <Line type="monotone" dataKey="count" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 3 }} name="Activations" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
        </div>
      )}

      {/* ────── Supervisor Performance ────── */}
      {supervisors.length > 0 && (
        <div className="group relative">
        <section>
          <SectionHeader
            title="Supervisor Performance"
            subtitle={`${supervisors.length} supervisors · showing contribution and team breakdown`}
            onEdit={isAdmin ? () => setEditingSection("supervisors") : undefined}
          />
          <div className="space-y-3">
            {supervisors.map((sup) => {
              const isOpen = expandedSup === sup.id;
              return (
                <motion.div
                  key={sup.id}
                  layout
                  className="bg-white dark:bg-slate-800/80 rounded-2xl border border-gray-100 dark:border-slate-700/50 overflow-hidden"
                >
                  <button
                    onClick={() => setExpandedSup(isOpen ? null : sup.id)}
                    className="w-full flex items-center justify-between p-5 hover:bg-gray-50 dark:hover:bg-slate-700/30 transition-colors text-left"
                  >
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-500/10 flex items-center justify-center shrink-0">
                        <Users className="w-5 h-5 text-primary-500" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-900 dark:text-gray-100 truncate">{sup.name}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{sup.dms_code || `ID: ${sup.id}`}</p>
                      </div>
                      <div className="hidden sm:flex items-center gap-3 ml-auto">
                        <span className="text-sm font-bold text-gray-900 dark:text-gray-100">
                          {sup.total_activation.toLocaleString()}
                        </span>
                        <span className="text-xs px-2 py-1 rounded-full bg-primary-50 dark:bg-primary-500/10 text-primary-600 dark:text-primary-400 font-medium">
                          {sup.contribution}%
                        </span>
                        <span className="text-xs px-2 py-1 rounded-full bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400 font-medium">
                          Emp: {sup.employee_activation}
                        </span>
                        <span className="text-xs px-2 py-1 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium">
                          Mkt: {sup.market_activation}
                        </span>
                      </div>
                    </div>
                    {isOpen ? (
                      <ChevronUp className="w-5 h-5 text-gray-400 shrink-0 ml-3" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-gray-400 shrink-0 ml-3" />
                    )}
                  </button>
                  <AnimatePresence>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25 }}
                        className="overflow-hidden"
                      >
                        <div className="px-5 pb-5 pt-2 border-t border-gray-100 dark:border-slate-700/50">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="bg-gray-50 dark:bg-slate-700/30 rounded-xl p-4">
                              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Team Breakdown</p>
                              <div className="space-y-2">
                                <div className="flex items-center justify-between text-sm">
                                  <span className="text-gray-600 dark:text-gray-400">RSO Count</span>
                                  <span className="font-semibold text-gray-900 dark:text-gray-100">{sup.active_rso}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm">
                                  <span className="text-gray-600 dark:text-gray-400">BP Count</span>
                                  <span className="font-semibold text-gray-900 dark:text-gray-100">{sup.active_bp}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm">
                                  <span className="text-gray-600 dark:text-gray-400">CC Count</span>
                                  <span className="font-semibold text-gray-900 dark:text-gray-100">{sup.active_cc}</span>
                                </div>
                              </div>
                            </div>
                            <div className="bg-gray-50 dark:bg-slate-700/30 rounded-xl p-4">
                              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Activation Breakdown</p>
                              <div className="space-y-3">
                                <div>
                                  <div className="flex items-center justify-between text-sm mb-1">
                                    <span className="text-gray-600 dark:text-gray-400">Employee</span>
                                    <span className="font-semibold text-green-600 dark:text-green-400">{sup.employee_activation}</span>
                                  </div>
                                  <div className="w-full h-1.5 bg-gray-200 dark:bg-slate-600 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-green-500 rounded-full"
                                      style={{ width: `${sup.total_activation > 0 ? (sup.employee_activation / sup.total_activation) * 100 : 0}%` }}
                                    />
                                  </div>
                                </div>
                                <div>
                                  <div className="flex items-center justify-between text-sm mb-1">
                                    <span className="text-gray-600 dark:text-gray-400">Market</span>
                                    <span className="font-semibold text-amber-600 dark:text-amber-400">{sup.market_activation}</span>
                                  </div>
                                  <div className="w-full h-1.5 bg-gray-200 dark:bg-slate-600 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-amber-500 rounded-full"
                                      style={{ width: `${sup.total_activation > 0 ? (sup.market_activation / sup.total_activation) * 100 : 0}%` }}
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                            <div className="bg-gray-50 dark:bg-slate-700/30 rounded-xl p-4">
                              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Mini Trend</p>
                              <div className="h-20">
                                <ResponsiveContainer width="100%" height="100%">
                                  <LineChart data={trend.slice(-14)}>
                                    <Line type="monotone" dataKey="count" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                                  </LineChart>
                                </ResponsiveContainer>
                              </div>
                              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 text-center">
                                {sup.contribution}% contribution
                              </p>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        </section>
        </div>
      )}

      {/* ────── RSO Performance ────── */}
      {rsos.length > 0 && (
        <div className="group relative">
        <section>
          <SectionHeader
            title="RSO Performance"
            subtitle={`${rsos.length} RSOs · view grid or table`}
            onEdit={isAdmin ? () => setEditingSection("rsos") : undefined}
            action={
              <div className="flex items-center border border-gray-200 dark:border-slate-600 rounded-xl overflow-hidden">
                <button
                  onClick={() => setRsoView("grid")}
                  className={cn("p-2 transition-colors", rsoView === "grid" ? "bg-primary-500 text-white" : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300")}
                >
                  <Grid3X3 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setRsoView("table")}
                  className={cn("p-2 transition-colors", rsoView === "table" ? "bg-primary-500 text-white" : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300")}
                >
                  <List className="w-4 h-4" />
                </button>
              </div>
            }
          />
          {rsoView === "grid" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {rsos.map((rso) => (
                <div
                  key={rso.id}
                  className="bg-white dark:bg-slate-800/80 rounded-2xl border border-gray-100 dark:border-slate-700/50 p-5 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-9 h-9 rounded-xl bg-orange-50 dark:bg-orange-500/10 flex items-center justify-center">
                      <UserCog className="w-4.5 h-4.5 text-orange-500" />
                    </div>
                    <div>
                      <p className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">{rso.name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{[rso.dms_code, rso.itop_number].filter(Boolean).join(' • ') || `ID: ${rso.id}`}</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500 dark:text-gray-400">Own Code Activation</span>
                      <span className="font-semibold text-gray-900 dark:text-gray-100">{rso.own_activation.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500 dark:text-gray-400">Market Activation</span>
                      <span className="font-semibold text-amber-600 dark:text-amber-400">{rso.market_activation.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500 dark:text-gray-400">Total Activation</span>
                      <span className="font-semibold text-primary-600 dark:text-primary-400">{rso.total_activation.toLocaleString()}</span>
                    </div>
                    <div>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-gray-400">Contribution</span>
                        <span className="font-semibold text-gray-700 dark:text-gray-300">{rso.contribution}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-gray-200 dark:bg-slate-600 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-orange-400 to-orange-500 rounded-full"
                          style={{ width: `${Math.min(rso.contribution, 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-800/80 rounded-2xl border border-gray-100 dark:border-slate-700/50 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse whitespace-nowrap">
                  <thead>
                    <tr>
                      <th className="text-left px-5 py-3 font-semibold text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-slate-600 sticky left-0 bg-white dark:bg-slate-800 z-20 relative after:absolute after:inset-y-0 after:right-0 after:w-[3px] after:shadow-[2px_0_4px_rgba(0,0,0,0.08)] dark:after:shadow-[2px_0_4px_rgba(0,0,0,0.3)]">Name</th>
                      <th className="text-center px-2 py-3 font-semibold text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-slate-600">Own Activation</th>
                      <th className="text-center px-2 py-3 font-semibold text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-slate-600">Market Activation</th>
                      <th className="text-center px-2 py-3 font-semibold text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-slate-600">Total</th>
                      <th className="text-center px-2 py-3 font-semibold text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-slate-600">Contribution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rsos.map((rso) => (
                      <tr key={rso.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/20 transition-colors">
                        <td className="px-5 py-3 border border-gray-200 dark:border-slate-600 sticky left-0 bg-white dark:bg-slate-800 z-20 relative after:absolute after:inset-y-0 after:right-0 after:w-[3px] after:shadow-[2px_0_4px_rgba(0,0,0,0.08)] dark:after:shadow-[2px_0_4px_rgba(0,0,0,0.3)]">
                          <p className="font-medium text-gray-900 dark:text-gray-100">{rso.name}</p>
                          <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-tight">{rso.dms_code ? `${rso.dms_code}${rso.itop_number ? ` • ${rso.itop_number.slice(-3)}` : ''}${rso.assisted_code ? ` • ${rso.assisted_code}` : ''}` : `#${rso.id}`}</p>
                        </td>
                        <td className="px-2 py-3 text-center font-medium text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-slate-600">{rso.own_activation.toLocaleString()}</td>
                        <td className="px-2 py-3 text-center text-amber-600 dark:text-amber-400 border border-gray-200 dark:border-slate-600">{rso.market_activation.toLocaleString()}</td>
                        <td className="px-2 py-3 text-center font-bold text-primary-600 dark:text-primary-400 border border-gray-200 dark:border-slate-600">{rso.total_activation.toLocaleString()}</td>
                        <td className="px-2 py-3 text-center border border-gray-200 dark:border-slate-600">
                          <span className="text-xs font-medium px-2 py-1 rounded-full bg-primary-50 dark:bg-primary-500/10 text-primary-600 dark:text-primary-400">
                            {rso.contribution}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
        </div>
      )}

      {/* ────── BP Performance ────── */}
      {bps.length > 0 && (
        <div className="group relative">
        <section>
          <SectionHeader title="BP Performance" subtitle={`${bps.length} BPs · leaderboard ranking`} onEdit={isAdmin ? () => setEditingSection("bps") : undefined} />
          <div className="space-y-2">
            {bps.map((bp, idx) => (
              <div
                key={bp.id}
                className={cn(
                  "flex items-center gap-4 bg-white dark:bg-slate-800/80 rounded-2xl border p-4 transition-all hover:shadow-md",
                  idx < 3
                    ? "border-amber-200 dark:border-amber-500/30 bg-gradient-to-r from-amber-50/50 to-transparent dark:from-amber-500/5"
                    : "border-gray-100 dark:border-slate-700/50"
                )}
              >
                {/* Rank */}
                <div
                  className={cn(
                    "w-9 h-9 rounded-xl flex items-center justify-center shrink-0 font-bold text-sm",
                    idx === 0
                      ? "bg-amber-100 dark:bg-amber-500/20 text-amber-600 dark:text-amber-400"
                      : idx === 1
                      ? "bg-gray-100 dark:bg-gray-600/30 text-gray-500 dark:text-gray-300"
                      : idx === 2
                      ? "bg-orange-100 dark:bg-orange-500/20 text-orange-600 dark:text-orange-400"
                      : "bg-gray-50 dark:bg-slate-700/50 text-gray-400 dark:text-gray-500"
                  )}
                >
                  {idx === 0 ? <Medal className="w-5 h-5" /> : idx === 1 ? <Award className="w-5 h-5" /> : idx === 2 ? <Zap className="w-5 h-5" /> : `#${bp.rank}`}
                </div>
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">{bp.name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {[bp.dms_code, bp.assisted_code, bp.pool_number].filter(Boolean).join(' • ') || `ID: ${bp.id}`}
                  </p>
                </div>
                {/* Stats */}
                <div className="text-right shrink-0">
                  <p className="font-bold text-gray-900 dark:text-gray-100">{bp.own_activation.toLocaleString()}</p>
                  <p className="text-xs text-gray-400">own activation</p>
                </div>
                <div className="w-24 shrink-0">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-gray-400">Contribution</span>
                    <span className="font-semibold text-gray-700 dark:text-gray-300">{bp.contribution}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-gray-200 dark:bg-slate-600 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-teal-400 to-teal-500 rounded-full"
                      style={{ width: `${Math.min(bp.contribution, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
        </div>
      )}

      {/* ────── CC Performance ────── */}
      {ccs.length > 0 && (
        <div className="group relative">
        <section>
          <SectionHeader title="CC Performance" subtitle={`${ccs.length} CCs · activation summary`} onEdit={isAdmin ? () => setEditingSection("ccs") : undefined} />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {ccs.map((cc) => (
              <div
                key={cc.id}
                className="bg-white dark:bg-slate-800/80 rounded-2xl border border-gray-100 dark:border-slate-700/50 p-5 hover:shadow-md transition-shadow"
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 rounded-xl bg-rose-50 dark:bg-rose-500/10 flex items-center justify-center">
                    <Smartphone className="w-4.5 h-4.5 text-rose-500" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-gray-900 dark:text-gray-100">{cc.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{cc.dms_code || `ID: ${cc.id}`}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-500 dark:text-gray-400">Own Activation</span>
                  <span className="font-bold text-gray-900 dark:text-gray-100">{cc.own_activation.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between text-xs mb-2">
                  <span className="text-gray-400">Contribution</span>
                  <span className="font-semibold text-rose-600 dark:text-rose-400">{cc.contribution}%</span>
                </div>
                <div className="w-full h-1.5 bg-gray-200 dark:bg-slate-600 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-rose-400 to-rose-500 rounded-full"
                    style={{ width: `${Math.min(cc.contribution, 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
        </div>
      )}

      {/* ────── Smart Insights ────── */}
      {insights.length > 0 && (
        <div className="group relative">
        <section>
          <SectionHeader title="Smart Insights" subtitle="Automated analysis of your activation data" onEdit={isAdmin ? () => setEditingSection("insights") : undefined} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {insights.map((insight, i) => (
              <div
                key={i}
                className="flex items-start gap-3 bg-white dark:bg-slate-800/80 rounded-2xl border border-gray-100 dark:border-slate-700/50 p-4"
              >
                <div className="w-8 h-8 rounded-lg bg-primary-50 dark:bg-primary-500/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Sparkles className="w-4 h-4 text-primary-500" />
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{insight}</p>
              </div>
            ))}
          </div>
        </section>
        </div>
      )}

      {/* ────── Section Config Modal ────── */}
      <SectionConfigModal
        open={editingSection !== null}
        sectionKey={editingSection as any}
        houseId={effectiveHouseId!}
        onClose={() => setEditingSection(null)}
        onSaved={() => setConfigVersion((v) => v + 1)}
        mode={
          editingSection === "total_activation" || editingSection === "market_activation" || editingSection === "distribution"
            ? "full"
            : editingSection === "employee_activation"
              ? "employees_only"
              : editingSection === "rsos" || editingSection === "bps"
                ? "full"
              : "products_only"
        }
      />
    </div>
  );
}
