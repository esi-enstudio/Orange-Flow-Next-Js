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
  MoreVertical,
  ChevronRight,
  Activity
} from "lucide-react";
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

interface Retailer {
  id: number;
  name: string;
  retailer_code: string;
  itop_number: string;
  thana: string;
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [recentRetailers, setRecentRetailers] = useState<Retailer[]>([]);
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

        const retailersPromise = hasPermission("view_retailers")
          ? apiClient.get("retailers?limit=5").then(res => res.data).catch(() => [])
          : Promise.resolve([]);

        const [statsData, retailersData] = await Promise.all([
          statsPromise,
          retailersPromise
        ]);

        setStats(statsData);
        setRecentRetailers(retailersData);
      } catch (err) {
        console.error("Failed to fetch dashboard data", err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [authLoading, hasPermission]);

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
          <button className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors shadow-sm shadow-primary-100 dark:shadow-none">
            {t('dashboard.add_retailer')}
          </button>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Retailers Table */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden transition-colors duration-300">
          <div className="p-6 border-b border-gray-50 dark:border-slate-800 flex items-center justify-between">
            <h2 className="font-bold text-lg dark:text-gray-100">{t('dashboard.recent_retailers')}</h2>
            <button className="text-primary-600 dark:text-primary-400 text-sm font-semibold flex items-center gap-1 hover:underline">
              {t('dashboard.view_all')} <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-gray-50/50 dark:bg-slate-800/50 text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  <th className="px-6 py-4">{t('dashboard.retailer_name')}</th>
                  <th className="px-6 py-4">{t('dashboard.code')}</th>
                  <th className="px-6 py-4">{t('dashboard.thana')}</th>
                  <th className="px-6 py-4">{t('dashboard.status')}</th>
                  <th className="px-6 py-4 text-right">{t('dashboard.action')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-slate-800">
                {recentRetailers.map((retailer) => (
                  <tr key={retailer.id} className="hover:bg-gray-50/50 dark:hover:bg-slate-800/50 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-500/20 flex items-center justify-center text-primary-700 dark:text-primary-400 font-bold text-xs transition-colors">
                          {retailer.name.charAt(0)}
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900 dark:text-gray-100 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors">
                            {retailer.name}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 transition-colors">{retailer.itop_number}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <code className="bg-gray-100 dark:bg-slate-800 px-2 py-1 rounded text-xs font-mono dark:text-gray-300 transition-colors">{retailer.retailer_code}</code>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600 dark:text-gray-400 transition-colors">{retailer.thana}</td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400 transition-colors">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                        {t('dashboard.active')}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg text-gray-400 transition-colors">
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Activity Feed */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm flex flex-col transition-colors duration-300">
          <div className="p-6 border-b border-gray-50 dark:border-slate-800">
            <h2 className="font-bold text-lg flex items-center gap-2 dark:text-gray-100 transition-colors">
              <Activity className="w-5 h-5 text-primary-600 dark:text-primary-400" />
              {t('dashboard.activity_feed')}
            </h2>
          </div>
          <div className="p-6 space-y-6 flex-1">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="flex gap-4 relative last:after:hidden after:absolute after:left-[11px] after:top-[26px] after:bottom-[-26px] after:w-[2px] after:bg-gray-50 dark:after:bg-slate-800 transition-colors">
                <div className="w-[22px] h-[22px] rounded-full border-2 border-primary-500 bg-white dark:bg-slate-900 z-10 transition-colors"></div>
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 leading-none mb-1 transition-colors">Stock Updated</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 transition-colors">RSO Sazzad added 500 SIMs to Retailer A102</p>
                  <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-1 font-medium transition-colors">10 minutes ago</p>
                </div>
              </div>
            ))}
          </div>
          <div className="p-4 border-t border-gray-50 dark:border-slate-800">
            <button className="w-full py-2 text-sm font-semibold text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors">
              {t('dashboard.see_all')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
