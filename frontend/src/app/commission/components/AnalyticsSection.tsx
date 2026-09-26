"use client";

import { useState } from "react";
import { BarChart3, TrendingUp, Users, Layers } from "lucide-react";
import type { DashboardAnalytics, CampaignPerformance, HousePerformance } from "@/types/commission";

interface Props {
  analytics: DashboardAnalytics;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-BD", {
    style: "currency",
    currency: "BDT",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

const categoryColors: Record<string, { gradient: string; bg: string; text: string }> = {
  distributor_campaign: {
    gradient: "from-blue-500 to-blue-600",
    bg: "bg-blue-500",
    text: "text-blue-600 dark:text-blue-400",
  },
  rso_campaign: {
    gradient: "from-emerald-500 to-emerald-600",
    bg: "bg-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
  },
  management_incentive: {
    gradient: "from-purple-500 to-purple-600",
    bg: "bg-purple-500",
    text: "text-purple-600 dark:text-purple-400",
  },
  operations_reimbursement: {
    gradient: "from-amber-500 to-amber-600",
    bg: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-400",
  },
};

function CampaignBar({ campaign, maxAmount }: { campaign: CampaignPerformance; maxAmount: number }) {
  const categoryStyle = categoryColors[campaign.category] || {
    gradient: "from-gray-500 to-gray-600",
    bg: "bg-gray-500",
    text: "text-gray-600 dark:text-gray-400",
  };
  const percentage = maxAmount > 0 ? (campaign.total_amount / maxAmount) * 100 : 0;

  return (
    <div className="group flex items-center gap-3 py-3 px-2 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer">
      <div className={`w-2 h-2 rounded-full ${categoryStyle.bg} flex-shrink-0 shadow-sm`} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-3 mb-2">
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
            {campaign.campaign_name}
          </span>
          <span className={`text-sm font-mono font-semibold ${categoryStyle.text} whitespace-nowrap`}>
            {formatCurrency(campaign.total_amount)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1 h-2 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full bg-gradient-to-r ${categoryStyle.gradient} rounded-full transition-all duration-500 shadow-sm`}
              style={{ width: `${Math.min(100, percentage)}%` }}
            />
          </div>
          <span className="text-xs text-gray-400 font-medium min-w-[60px] text-right">
            {campaign.transaction_count} txns
          </span>
        </div>
      </div>
    </div>
  );
}

function HouseCard({ house }: { house: HousePerformance }) {
  return (
    <div className="group bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 p-4 shadow-sm hover:shadow-md hover:border-primary-200 dark:hover:border-primary-900/30 transition-all duration-300">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">
            {house.house_code}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
            {house.house_name}
          </p>
        </div>
        <div className="inline-flex items-center gap-1 px-2 py-1 bg-primary-50 dark:bg-primary-500/10 rounded-lg">
          <span className="text-xs font-semibold text-primary-600 dark:text-primary-400">
            {house.transaction_count}
          </span>
          <span className="text-[10px] text-primary-500 dark:text-primary-500">txns</span>
        </div>
      </div>

      <div className="pt-3 border-t border-gray-100 dark:border-slate-800">
        <p className="text-lg font-bold text-gray-900 dark:text-gray-100 font-mono">
          {formatCurrency(house.total_amount)}
        </p>
      </div>
    </div>
  );
}

export default function AnalyticsSection({ analytics }: Props) {
  const [activeTab, setActiveTab] = useState<"campaigns" | "houses">("campaigns");
  const topCampaigns = analytics.campaign_performance.slice(0, 10);
  const maxCampaignAmount = Math.max(...topCampaigns.map((c) => c.total_amount), 1);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
      {/* Campaign / House Performance */}
      <div className="xl:col-span-2 bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-800/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-600 text-white shadow-lg shadow-indigo-500/30">
                <BarChart3 className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                  Performance Overview
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {activeTab === "campaigns"
                    ? `Top ${topCampaigns.length} campaigns by amount`
                    : `Top ${Math.min(6, analytics.house_performance.length)} houses by commission`
                  }
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 bg-white dark:bg-slate-900 rounded-xl p-1 border border-gray-200 dark:border-slate-700 shadow-sm">
              <button
                onClick={() => setActiveTab("campaigns")}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 ${
                  activeTab === "campaigns"
                    ? "bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-md shadow-primary-500/30"
                    : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-800"
                }`}
              >
                Campaigns
              </button>
              <button
                onClick={() => setActiveTab("houses")}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 ${
                  activeTab === "houses"
                    ? "bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-md shadow-primary-500/30"
                    : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-800"
                }`}
              >
                Houses
              </button>
            </div>
          </div>
        </div>

        <div className="p-5">
          {activeTab === "campaigns" ? (
            <div className="space-y-1">
              {topCampaigns.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-slate-800 flex items-center justify-center mb-3">
                    <BarChart3 className="w-8 h-8 text-gray-400" />
                  </div>
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                    No campaign data available
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Try adjusting your filters
                  </p>
                </div>
              ) : (
                topCampaigns.map((campaign, index) => (
                  <CampaignBar
                    key={campaign.campaign_type_id}
                    campaign={campaign}
                    maxAmount={maxCampaignAmount}
                  />
                ))
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {analytics.house_performance.length === 0 ? (
                <div className="col-span-2 flex flex-col items-center justify-center py-12">
                  <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-slate-800 flex items-center justify-center mb-3">
                    <Users className="w-8 h-8 text-gray-400" />
                  </div>
                  <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
                    No house data available
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Try adjusting your filters
                  </p>
                </div>
              ) : (
                analytics.house_performance.slice(0, 6).map((h) => (
                  <HouseCard key={h.house_id} house={h} />
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Summary & Legend */}
      <div className="space-y-4">
        {/* Category Breakdown */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-800/50">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-lg shadow-green-500/30">
                <Layers className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                  Category Breakdown
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Commission by category
                </p>
              </div>
            </div>
          </div>

          <div className="p-5 space-y-4">
            {Object.entries(categoryColors).map(([category, style]) => {
              const perf = analytics.campaign_performance.filter(
                (c) => c.category === category
              );
              const total = perf.reduce((sum, c) => sum + c.total_amount, 0);
              const count = perf.length;

              return (
                <div key={category} className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${style.bg} shadow-sm flex-shrink-0`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 capitalize truncate">
                      {category.replace(/_/g, " ")}
                    </p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      {count} {count === 1 ? 'campaign' : 'campaigns'}
                    </p>
                  </div>
                  <p className={`text-sm font-bold font-mono ${style.text} whitespace-nowrap`}>
                    {formatCurrency(total)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Quick Stats */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-slate-800 bg-gray-50 dark:bg-slate-800/50">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-lg shadow-amber-500/30">
                <TrendingUp className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                  Quick Statistics
                </h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Overview metrics
                </p>
              </div>
            </div>
          </div>

          <div className="p-5 space-y-3">
            <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-slate-800">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Total Houses</span>
              <span className="text-sm font-bold text-gray-900 dark:text-gray-100">
                {analytics.house_performance.length}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-gray-100 dark:border-slate-800">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Active Campaigns</span>
              <span className="text-sm font-bold text-gray-900 dark:text-gray-100">
                {analytics.campaign_performance.length}
              </span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Avg / House</span>
              <span className="text-sm font-bold font-mono text-primary-600 dark:text-primary-400">
                {analytics.house_performance.length > 0
                  ? formatCurrency(
                      analytics.summary.total_campaign_amount / analytics.house_performance.length
                    )
                  : formatCurrency(0)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
