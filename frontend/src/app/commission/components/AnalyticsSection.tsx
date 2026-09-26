"use client";

import { useState } from "react";
import { BarChart3, TrendingUp, Users } from "lucide-react";
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

const categoryColors: Record<string, string> = {
  distributor_campaign: "bg-blue-500",
  rso_campaign: "bg-green-500",
  management_incentive: "bg-purple-500",
  operations_reimbursement: "bg-amber-500",
};

function CampaignBar({ campaign }: { campaign: CampaignPerformance }) {
  return (
    <div className="flex items-center gap-3 py-2 group">
      <div className="w-3 h-3 rounded-full flex-shrink-0 mt-0.5">
        <div
          className={`w-3 h-3 rounded-full ${
            categoryColors[campaign.category] || "bg-gray-400"
          }`}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
            {campaign.campaign_name}
          </span>
          <span className="text-sm font-mono text-gray-600 dark:text-gray-400 ml-2">
            {formatCurrency(campaign.total_amount)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary-500 to-primary-600"
              style={{ width: `${Math.min(100, (campaign.total_amount / 1000000) * 100)}%` }}
            />
          </div>
          <span className="text-xs text-gray-400 w-16 text-right">
            {campaign.transaction_count} txns
          </span>
        </div>
      </div>
    </div>
  );
}

function HouseCard({ house }: { house: HousePerformance }) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-gray-100 dark:border-slate-800 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {house.house_code}
          </p>
          <p className="text-xs text-gray-500">{house.house_name}</p>
        </div>
        <span className="text-xs text-gray-400">{house.transaction_count} txns</span>
      </div>
      <p className="text-sm font-mono font-medium text-gray-900 dark:text-gray-100">
        {formatCurrency(house.total_amount)}
      </p>
    </div>
  );
}

export default function AnalyticsSection({ analytics }: Props) {
  const [activeTab, setActiveTab] = useState<"campaigns" | "houses">("campaigns");
  const topCampaigns = analytics.campaign_performance.slice(0, 10);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Campaign / House Performance */}
      <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/20">
                <BarChart3 className="w-4 h-4 text-indigo-600" />
              </div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Performance
              </h3>
            </div>
            <div className="flex items-center gap-1 bg-gray-100 dark:bg-slate-800 rounded-lg p-0.5">
              <button
                onClick={() => setActiveTab("campaigns")}
                className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                  activeTab === "campaigns"
                    ? "bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                Campaigns
              </button>
              <button
                onClick={() => setActiveTab("houses")}
                className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                  activeTab === "houses"
                    ? "bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
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
                <p className="text-sm text-gray-400 text-center py-8">
                  No campaign data available
                </p>
              ) : (
                topCampaigns.map((campaign) => (
                  <CampaignBar key={campaign.campaign_type_id} campaign={campaign} />
                ))
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {analytics.house_performance.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8 col-span-2">
                  No house data available
                </p>
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
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-1.5 rounded-lg bg-green-50 dark:bg-green-900/20">
              <TrendingUp className="w-4 h-4 text-green-600" />
            </div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              Category Breakdown
            </h3>
          </div>
          <div className="space-y-3">
            {Object.entries(categoryColors).map(([category, color]) => {
              const perf = analytics.campaign_performance.filter(
                (c) => c.category === category
              );
              const total = perf.reduce((sum, c) => sum + c.total_amount, 0);
              const count = perf.length;
              return (
                <div key={category} className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${color}`} />
                  <div className="flex-1">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300 capitalize">
                      {category.replace(/_/g, " ")}
                    </p>
                    <p className="text-xs text-gray-400">{count} campaigns</p>
                  </div>
                  <p className="text-xs font-mono text-gray-900 dark:text-gray-100">
                    {formatCurrency(total)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="p-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20">
              <Users className="w-4 h-4 text-amber-600" />
            </div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              House Summary
            </h3>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Total Houses</span>
              <span className="font-semibold">{analytics.house_performance.length}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Active Campaigns</span>
              <span className="font-semibold">{analytics.campaign_performance.length}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Avg Amount / House</span>
              <span className="font-semibold font-mono">
                {analytics.house_performance.length > 0
                  ? formatCurrency(analytics.summary.total_campaign_amount / analytics.house_performance.length)
                  : formatCurrency(0)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
