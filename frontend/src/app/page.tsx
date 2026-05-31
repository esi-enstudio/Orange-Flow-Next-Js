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
  Clock,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/useLanguage";

interface Stats {
  total_retailers: number;
  total_houses: number;
  total_bts: number;
  total_employees: number;
  active_users: number;
  today_activations: number;
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
  const { user, loading: authLoading, hasPermission } = useAuth();
  const { t } = useLanguage();

  useEffect(() => {
    if (authLoading) return;

    const fetchData = async () => {
      try {
        const statsPromise = hasPermission("view_reports")
          ? apiClient.get("stats").then(res => res.data).catch(() => null)
          : Promise.resolve(null);

        const [statsData] = await Promise.all([statsPromise]);

        setStats(statsData);
      } catch (err) {
        console.error("Failed to fetch dashboard data", err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [authLoading, hasPermission]);

  useEffect(() => {
    apiClient.get("todos").then(res => {
      setTodos(res.data);
    }).catch(() => {});
  }, []);

  const statCards = [
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
    { 
      title: t('dashboard.today_ga'), 
      value: stats?.today_activations || 0, 
      icon: TrendingUp, 
      color: "bg-primary-500", 
      trend: "-3%", 
      isUp: false 
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
          <button className="px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg text-sm font-medium text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors shadow-sm">
            {t('dashboard.download_report')}
          </button>
          <Link
            href="/todos"
            className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors shadow-sm shadow-primary-100 dark:shadow-none inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            {t('todos.add_task')}
          </Link>
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
          <div className="p-4 border-t border-gray-50 dark:border-slate-800">
            <Link
              href="/todos"
              className="w-full py-2.5 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              <Plus className="w-4 h-4" />
              {t('todos.manage_tasks')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
