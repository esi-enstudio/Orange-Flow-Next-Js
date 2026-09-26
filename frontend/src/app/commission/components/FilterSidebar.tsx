"use client";

import { useState, useEffect } from "react";
import { X, ChevronDown, ChevronUp, Search } from "lucide-react";
import { fetchFilterOptions } from "@/lib/commission";
import type { CommissionFilterState, FilterOptions } from "@/types/commission";

interface Props {
  filters: CommissionFilterState;
  onFiltersChange: (filters: CommissionFilterState) => void;
  isOpen: boolean;
  onToggle: () => void;
}

type AccordionKey = "date" | "houses" | "campaigns" | "search";

export default function FilterSidebar({ filters, onFiltersChange, isOpen, onToggle }: Props) {
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
  const [openAccordions, setOpenAccordions] = useState<Set<AccordionKey>>(
    new Set(["date", "search"])
  );
  const [searchInput, setSearchInput] = useState(filters.search);

  useEffect(() => {
    fetchFilterOptions().then(setFilterOptions).catch(() => {});
  }, []);

  const toggleAccordion = (key: AccordionKey) => {
    setOpenAccordions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const updateFilter = <K extends keyof CommissionFilterState>(
    key: K,
    value: CommissionFilterState[K]
  ) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const updateDate = (field: "from" | "to", value: string) => {
    updateFilter("date", { ...filters.date, [field]: value });
  };

  const toggleHouse = (id: number) => {
    const ids = filters.houseIds.includes(id)
      ? filters.houseIds.filter((i) => i !== id)
      : [...filters.houseIds, id];
    updateFilter("houseIds", ids);
  };

  const toggleCampaignType = (id: number) => {
    const ids = filters.campaignTypeIds.includes(id)
      ? filters.campaignTypeIds.filter((i) => i !== id)
      : [...filters.campaignTypeIds, id];
    updateFilter("campaignTypeIds", ids);
  };

  const clearAll = () => {
    onFiltersChange({
      date: { from: "", to: "" },
      houseIds: [],
      campaignTypeIds: [],
      campaignCategory: "",
      participantType: "",
      search: "",
    });
    setSearchInput("");
  };

  const hasActiveFilters =
    filters.date.from ||
    filters.date.to ||
    filters.houseIds.length > 0 ||
    filters.campaignTypeIds.length > 0 ||
    filters.campaignCategory ||
    filters.participantType ||
    filters.search;

  if (!isOpen) return null;

  const AccordionHeader = ({
    label,
    accordionKey,
    count,
  }: {
    label: string;
    accordionKey: AccordionKey;
    count?: number;
  }) => (
    <button
      onClick={() => toggleAccordion(accordionKey)}
      className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
    >
      <div className="flex items-center gap-2">
        <span>{label}</span>
        {count !== undefined && count > 0 && (
          <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-primary-500 rounded-full">
            {count}
          </span>
        )}
      </div>
      {openAccordions.has(accordionKey) ? (
        <ChevronUp className="w-4 h-4" />
      ) : (
        <ChevronDown className="w-4 h-4" />
      )}
    </button>
  );

  return (
    <div className="w-80 border-r border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-y-auto flex-shrink-0">
      <div className="sticky top-0 bg-white dark:bg-slate-900 z-10 border-b border-gray-200 dark:border-slate-700">
        <div className="flex items-center justify-between px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Filters
          </h2>
          <div className="flex items-center gap-1">
            {hasActiveFilters && (
              <button
                onClick={clearAll}
                className="text-xs text-primary-600 hover:text-primary-700 px-2 py-1 rounded hover:bg-primary-50 dark:hover:bg-primary-900/20"
              >
                Clear all
              </button>
            )}
            <button
              onClick={onToggle}
              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="divide-y divide-gray-100 dark:divide-slate-800">
        {/* Date Filter */}
        <div>
          <AccordionHeader label="Date Range" accordionKey="date" />
          {openAccordions.has("date") && (
            <div className="px-4 py-3 space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">From</label>
                <input
                  type="date"
                  value={filters.date.from}
                  onChange={(e) => updateDate("from", e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">To</label>
                <input
                  type="date"
                  value={filters.date.to}
                  onChange={(e) => updateDate("to", e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                />
              </div>
            </div>
          )}
        </div>

        {/* House Filter */}
        <div>
          <AccordionHeader
            label="Houses"
            accordionKey="houses"
            count={filters.houseIds.length}
          />
          {openAccordions.has("houses") && (
            <div className="px-4 py-3 max-h-60 overflow-y-auto">
              {filterOptions?.houses?.length ? (
                <div className="space-y-1">
                  {filterOptions.houses.map((h) => (
                    <label
                      key={h.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={filters.houseIds.includes(h.id)}
                        onChange={() => toggleHouse(h.id)}
                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      <span className="text-gray-700 dark:text-gray-300">
                        {h.code}
                      </span>
                      <span className="text-xs text-gray-400 ml-auto truncate">
                        {h.name}
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400">No houses loaded</p>
              )}
            </div>
          )}
        </div>

        {/* Campaign Filter */}
        <div>
          <AccordionHeader
            label="Campaigns"
            accordionKey="campaigns"
            count={filters.campaignTypeIds.length}
          />
          {openAccordions.has("campaigns") && (
            <div className="px-4 py-3 space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Category</label>
                <select
                  value={filters.campaignCategory}
                  onChange={(e) => updateFilter("campaignCategory", e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                >
                  <option value="">All Categories</option>
                  {filterOptions?.categories?.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                    </option>
                  ))}
                </select>
              </div>

              {/* Participant Type */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">Participant Type</label>
                <select
                  value={filters.participantType}
                  onChange={(e) => updateFilter("participantType", e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                >
                  <option value="">All Types</option>
                  {filterOptions?.participant_types?.map((pt) => (
                    <option key={pt} value={pt}>
                      {pt.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                    </option>
                  ))}
                </select>
              </div>

              <div className="max-h-60 overflow-y-auto">
                {filterOptions?.campaigns?.length ? (
                  <div className="space-y-1">
                    {filterOptions.campaigns
                      .filter(
                        (c) =>
                          !filters.campaignCategory ||
                          c.category === filters.campaignCategory
                      )
                      .map((c) => (
                        <label
                          key={c.id}
                          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={filters.campaignTypeIds.includes(c.id)}
                            onChange={() => toggleCampaignType(c.id)}
                            className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                          />
                          <span className="text-gray-700 dark:text-gray-300">
                            {c.name}
                          </span>
                        </label>
                      ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">No campaigns loaded</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Search */}
        <div>
          <AccordionHeader label="Search" accordionKey="search" />
          {openAccordions.has("search") && (
            <div className="px-4 py-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Campaign, House code, name..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      updateFilter("search", searchInput);
                    }
                  }}
                  onBlur={() => updateFilter("search", searchInput)}
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                />
              </div>
              {filters.search && (
                <div className="mt-2 inline-flex items-center gap-1 px-2 py-1 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300 rounded text-xs">
                  {filters.search}
                  <button
                    onClick={() => {
                      updateFilter("search", "");
                      setSearchInput("");
                    }}
                    className="ml-1 hover:text-primary-900"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
