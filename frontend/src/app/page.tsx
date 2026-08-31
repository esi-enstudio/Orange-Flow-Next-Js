"use client";

import { useEffect, useState } from "react";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { 
  Store, 
  MapPin, 
  Users, 
  TrendingUp, 
  ArrowUpRight, 
  ArrowDownRight,
  ListTodo,
  Plus,
  ChevronRight,
  Circle,
  CheckCircle2,
  XCircle,
  Clock,
  Building2,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/useLanguage";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

interface Stats {
  total_retailers: number;
  active_retailers: number;
  inactive_retailers: number;
  total_houses: number;
  total_bts: number;
  total_employees: number;
  active_employees: number;
  inactive_employees: number;
  active_users: number;
  today_activations: number;
  product_breakdown: Record<string, number>;
}

interface House {
  id: number;
  name: string;
  code: string;
  display_name: string;
}

interface Todo {
  id: number;
  title: string;
  status: string;
  priority: string;
  due_date: string | null;
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [houses, setHouses] = useState<House[]>([]);
  const [selectedHouseId, setSelectedHouseId] = useState<string>("");
  const [dailyData, setDailyData] = useState<{date: string; count: number}[]>([]);
  const [isDark, setIsDark] = useState(false);
  const { user, loading: authLoading, hasPermission } = useAuth();
  const { t } = useLanguage();

  const fetchStats = (houseId: string) => {
    if (!hasPermission("reports.view")) return;
    const params: any = {};
    if (houseId) params.house_id = houseId;
    apiClient.get("stats", { params })
      .then(res => setStats(res.data))
      .catch(() => {});
  };

  useEffect(() => {
    if (authLoading) return;

    const fetchData = async () => {
      try {
        const housesData = await apiClient.get("houses/accessible").then(res => res.data).catch(() => []);
        setHouses(housesData);
        if (housesData.length <= 1) {
          setSelectedHouseId("");
        }
        if (hasPermission("reports.view")) {
          fetchStats("");
        }
      } catch (err) {
        console.error("Failed to fetch dashboard data", err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [authLoading]);

  useEffect(() => {
    if (!authLoading && hasPermission("reports.view")) {
      const params: any = {};
      if (selectedHouseId) params.house_id = selectedHouseId;
      apiClient.get("stats", { params })
        .then(res => setStats(res.data))
        .catch(() => {});
    }
  }, [selectedHouseId]);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    apiClient.get("todos").then(res => {
      setTodos(res.data);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!authLoading && hasPermission("reports.view")) {
      const params: any = {};
      if (selectedHouseId) params.house_id = selectedHouseId;
      apiClient.get("stats/daily-activations", { params })
        .then(res => setDailyData(res.data))
        .catch(() => {});
    }
  }, [authLoading, selectedHouseId]);

  const statCards = [
    { 
      title: t('dashboard.today_ga'), 
      value: stats?.today_activations || 0, 
      icon: TrendingUp, 
      color: "bg-primary-500", 
      trend: "-3%", 
      isUp: false 
    },
    { 
      title: t('dashboard.total_retailers'), 
      value: stats?.total_retailers || 0, 
      icon: Store, 
      color: "bg-blue-500", 
      trend: "+12%", 
      isUp: true 
    },
    { 
      title: t('dashboard.active_bts'), 
      value: stats?.total_bts || 0, 
      icon: MapPin, 
      color: "bg-green-500", 
      trend: "+5%", 
      isUp: true 
    },
    { 
      title: t('dashboard.employees'), 
      value: stats?.total_employees || 0, 
      icon: Users, 
      color: "bg-purple-500", 
      trend: "stable", 
      isUp: true 
    },
  ];

  const pendingTodos = todos.filter(t => t.status === "pending");

  const priorityColor = (p: string) => {
    switch (p) {
      case "high": return "text-red-500";
      case "low": return "text-gray-400";
      default: return "text-amber-500";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Welcome Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 transition-colors">{t('dashboard.overview')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 transition-colors">
            {t('dashboard.welcome').replace('{name}', user?.name || t('common.user'))}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {houses.length > 1 && (
            <div className="relative">
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <select
                value={selectedHouseId}
                onChange={(e) => setSelectedHouseId(e.target.value)}
                className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg text-sm font-medium text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors shadow-sm outline-none focus:ring-2 focus:ring-primary-500 appearance-none cursor-pointer"
              >
                <option value="">{t('common.all')}</option>
                {houses.map((h) => (
                  <option key={h.id} value={h.id}>{h.display_name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        {statCards.map((card, i) => (
          <div key={i} className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm hover:shadow-md transition-all duration-300">
            <div className="flex justify-between items-start mb-4">
              <div className={cn("p-3 rounded-xl text-white shadow-lg", card.color)}>
                <card.icon className="w-6 h-6" />
              </div>
              <div className={cn(
                "flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full",
                card.isUp ? "bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400" : "bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400"
              )}>
                {card.trend !== "stable" && (card.isUp ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />)}
                {card.trend}
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400 transition-colors">{card.title}</p>
              <h3 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1 transition-colors">{card.value.toLocaleString()}</h3>
              {(card.title === t('dashboard.total_retailers') || card.title === t('dashboard.employees')) && (
                <div className="flex items-center gap-4 mt-2 pt-2 border-t border-gray-100 dark:border-slate-800">
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-green-600 dark:text-green-400">
                    <CheckCircle2 className="w-4 h-4" />
                    {card.title === t('dashboard.total_retailers') ? (stats?.active_retailers?.toLocaleString() || 0) : (stats?.active_employees?.toLocaleString() || 0)}
                  </span>
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-red-600 dark:text-red-400">
                    <XCircle className="w-4 h-4" />
                    {card.title === t('dashboard.total_retailers') ? (stats?.inactive_retailers?.toLocaleString() || 0) : (stats?.inactive_employees?.toLocaleString() || 0)}
                  </span>
                </div>
              )}
              {card.title === t('dashboard.today_ga') && stats?.product_breakdown && Object.keys(stats.product_breakdown).length > 0 && (
                <div className="mt-2 pt-2 border-t border-gray-100 dark:border-slate-800">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {Object.entries(stats.product_breakdown).map(([code, count]) => (
                      <div key={code} className="flex items-center justify-between font-medium text-gray-700 dark:text-gray-300" style={{fontSize: '0.6rem'}}>
                        <span>{code}</span>
                        <span className="font-bold text-gray-900 dark:text-gray-100">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* To-Do Widget */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden transition-colors duration-300">
          <div className="p-6 border-b border-gray-50 dark:border-slate-800 flex items-center justify-between">
            <h2 className="font-bold text-lg flex items-center gap-2 dark:text-gray-100">
              <ListTodo className="w-5 h-5 text-primary-600 dark:text-primary-400" />
              {t('todos.my_tasks')}
              {pendingTodos.length > 0 && (
                <span className="text-xs font-bold bg-primary-50 dark:bg-primary-500/10 text-primary-600 dark:text-primary-400 px-2 py-0.5 rounded-full">
                  {pendingTodos.length}
                </span>
              )}
            </h2>
            <Link
              href="/todos"
              className="text-primary-600 dark:text-primary-400 text-sm font-semibold flex items-center gap-1 hover:underline"
            >
              {t('dashboard.view_all')} <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-slate-800">
            {todos.length === 0 && (
              <div className="p-8 text-center text-sm text-gray-400 dark:text-gray-500">
                {t('todos.no_tasks')}
              </div>
            )}
            {todos.slice(0, 5).map((todo) => (
              <div key={todo.id} className="flex items-center gap-3 px-6 py-4 hover:bg-gray-50/50 dark:hover:bg-slate-800/50 transition-colors group">
                <div className={cn(
                  "flex-shrink-0",
                  todo.status === "completed" ? "text-green-500" : "text-gray-300 dark:text-gray-600"
                )}>
                  {todo.status === "completed"
                    ? <CheckCircle2 className="w-5 h-5" />
                    : <Circle className="w-5 h-5" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className={cn(
                    "text-sm font-medium truncate",
                    todo.status === "completed"
                      ? "text-gray-400 line-through"
                      : "text-gray-900 dark:text-gray-100"
                  )}>
                    {todo.title}
                  </p>
                  {todo.due_date && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1 mt-0.5">
                      <Clock className="w-3 h-3" />
                      {new Date(todo.due_date).toLocaleDateString()}
                    </p>
                  )}
                </div>
                <span className={cn(
                  "text-[10px] font-bold uppercase px-2 py-0.5 rounded-full",
                  priorityColor(todo.priority),
                  todo.priority === "high" && "bg-red-50 dark:bg-red-500/10",
                  todo.priority === "medium" && "bg-amber-50 dark:bg-amber-500/10",
                  todo.priority === "low" && "bg-gray-50 dark:bg-gray-500/10",
                )}>
                  {todo.priority}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Add / Summary */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm flex flex-col transition-colors duration-300">
          <div className="p-6 border-b border-gray-50 dark:border-slate-800">
            <h2 className="font-bold text-lg flex items-center gap-2 dark:text-gray-100">
              <Clock className="w-5 h-5 text-primary-600 dark:text-primary-400" />
              {t('todos.summary')}
            </h2>
          </div>
          <div className="p-6 space-y-4 flex-1">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500 dark:text-gray-400">{t('todos.total')}</span>
              <span className="text-lg font-bold text-gray-900 dark:text-gray-100">{todos.length}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500 dark:text-gray-400">{t('todos.pending')}</span>
              <span className="text-lg font-bold text-amber-500">{pendingTodos.length}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-500 dark:text-gray-400">{t('todos.completed')}</span>
              <span className="text-lg font-bold text-green-500">{todos.length - pendingTodos.length}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Daily Activations Chart */}
      {dailyData.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-6 transition-colors duration-300">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-lg flex items-center gap-2 dark:text-gray-100">
              <TrendingUp className="w-5 h-5 text-primary-600 dark:text-primary-400" />
              Daily Activations (Running Month)
            </h2>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#334155" : "#e5e7eb"} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: isDark ? "#94a3b8" : "#64748b" }}
                  tickFormatter={(val: any) => {
                    const d = new Date(String(val));
                    return d.toLocaleDateString("en", { month: "short", day: "numeric" });
                  }}
                  stroke={isDark ? "#475569" : "#cbd5e1"}
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: isDark ? "#94a3b8" : "#64748b" }} stroke={isDark ? "#475569" : "#cbd5e1"} />
                <Tooltip
                  contentStyle={{
                    borderRadius: "12px",
                    border: isDark ? "1px solid #334155" : "1px solid #e5e7eb",
                    fontSize: "13px",
                    backgroundColor: isDark ? "#1e293b" : "#ffffff",
                    color: isDark ? "#e2e8f0" : "#1e293b",
                  }}
                  labelFormatter={(val: any) => new Date(String(val)).toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" })}
                />
                <Bar dataKey="count" radius={[6, 6, 0, 0]} fill="#f97316" maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
