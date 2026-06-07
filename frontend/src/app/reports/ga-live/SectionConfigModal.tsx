"use client";

import { useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Save, Settings, Package, Tags, Search,
  Check, RotateCcw, AlertCircle, Sliders,
} from "lucide-react";
import apiClient from "@/lib/api";
import { cn } from "@/lib/utils";

type SectionKey =
  | "total_activation"
  | "employee_activation"
  | "market_activation"
  | "distribution"
  | "supervisors"
  | "rsos"
  | "bps"
  | "ccs"
  | "insights"
  | "trend";

const SECTION_META: Record<string, { label: string; icon: string; desc: string }> = {
  total_activation:   { label: "Total Activation", icon: "📊", desc: "Count all activations with exclusions" },
  employee_activation:{ label: "Employee Activation", icon: "👤", desc: "Count activations where retailer_code matches employee's assisted retailer code" },
  market_activation:  { label: "Market Activation", icon: "🎯", desc: "Count activations where retailer_code is not linked to any employee" },
  distribution:       { label: "Activation Distribution", icon: "📈", desc: "Employee vs Market breakdown and contribution analysis" },
  supervisors:        { label: "Supervisor Performance", icon: "👥", desc: "Supervisor contribution and team breakdown" },
  rsos:               { label: "RSO Performance", icon: "🛠️", desc: "RSO activation summary and rankings" },
  bps:                { label: "BP Performance", icon: "🏅", desc: "BP leaderboard ranking" },
  ccs:                { label: "CC Performance", icon: "📱", desc: "CC activation summary" },
  insights:           { label: "Smart Insights", icon: "💡", desc: "Automated analysis of activation data" },
  trend:              { label: "Activation Trend", icon: "📉", desc: "Daily activation count trend" },
};

interface Props {
  open: boolean;
  sectionKey: SectionKey;
  houseId: number;
  onClose: () => void;
  onSaved: () => void;
  mode?: "full" | "products_only";
}

export default function SectionConfigModal({ open, sectionKey, houseId, onClose, onSaved, mode = "full" }: Props) {
  const [productCodes, setProductCodes] = useState<string[]>([]);
  const [retailerTags, setRetailerTags] = useState<string[]>([]);
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [codeSearch, setCodeSearch] = useState("");
  const [tagSearch, setTagSearch] = useState("");

  const meta = SECTION_META[sectionKey];

  useEffect(() => {
    if (!open || !houseId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setSaved(false);
      setCodeSearch("");
      setTagSearch("");
      try {
        const [codesRes, tagsRes, configRes] = await Promise.all([
          apiClient.get<Array<{ id: number; product_code: string }>>("/product-exclusions"),
          apiClient.get<Array<{ id: number; name: string }>>("/filter-tags", {
            params: { house_id: houseId },
          }),
          apiClient.get<{ sections: Array<{ section_key: string; exclude_product_codes: string[]; exclude_retailer_tags: string[] }> }>(
            "/ga-live/section-configs",
            { params: { house_id: houseId } }
          ),
        ]);

        if (cancelled) return;

        const sectionConfig = configRes.data.sections.find((s) => s.section_key === sectionKey);

        setProductCodes(codesRes.data.map((c) => c.product_code));
        setRetailerTags(tagsRes.data.map((t) => t.name));
        setSelectedCodes(sectionConfig?.exclude_product_codes ?? []);
        setSelectedTags(sectionConfig?.exclude_retailer_tags ?? []);
      } catch {
        if (!cancelled) setError("Failed to load configuration options");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [open, houseId, sectionKey]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const filteredCodes = useMemo(
    () => productCodes.filter((c) => c.toLowerCase().includes(codeSearch.toLowerCase())),
    [productCodes, codeSearch]
  );
  const filteredTags = useMemo(
    () => retailerTags.filter((t) => t.toLowerCase().includes(tagSearch.toLowerCase())),
    [retailerTags, tagSearch]
  );

  function toggleCode(code: string) {
    setSelectedCodes((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  }

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  function selectAllCodes() { setSelectedCodes([...productCodes]); }
  function deselectAllCodes() { setSelectedCodes([]); }
  function selectAllTags() { setSelectedTags([...retailerTags]); }
  function deselectAllTags() { setSelectedTags([]); }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await apiClient.put(`/ga-live/section-configs/${sectionKey}`, {
        exclude_product_codes: selectedCodes,
        exclude_retailer_tags: selectedTags,
      }, { params: { house_id: houseId } });
      setSaved(true);
      setTimeout(() => { onSaved(); onClose(); }, 600);
    } catch {
      setError("Failed to save configuration");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 backdrop-blur-md p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 24 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl max-h-[90vh] bg-white dark:bg-slate-900 rounded-3xl border border-gray-200 dark:border-slate-700/80 shadow-2xl flex flex-col overflow-hidden"
          >
            {/* ── Header with gradient accent ── */}
            <div className="relative shrink-0">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary-400 via-primary-500 to-primary-600" />
              <div className="px-6 py-5 border-b border-gray-100 dark:border-slate-700/50">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4">
                    <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-primary-50 to-primary-100 dark:from-primary-500/15 dark:to-primary-600/10 flex items-center justify-center shrink-0 shadow-sm">
                      <Sliders className="w-5 h-5 text-primary-600 dark:text-primary-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                        Configure Section
                        <span className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-gray-400">
                          {meta.icon} {meta.label}
                        </span>
                      </h3>
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{meta.desc}</p>
                    </div>
                  </div>
                  <button
                    onClick={onClose}
                    className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors -mr-1 -mt-1"
                  >
                    <X className="w-4.5 h-4.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* ── Body ── */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-7">
              {loading ? (
                <div className="py-16 space-y-6">
                  <div className="space-y-3">
                    <div className="h-5 w-36 bg-gray-200 dark:bg-slate-700 rounded-lg animate-pulse" />
                    <div className="h-9 w-full bg-gray-100 dark:bg-slate-800 rounded-xl animate-pulse" />
                    <div className="grid grid-cols-2 gap-2">
                      {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="h-10 bg-gray-100 dark:bg-slate-800 rounded-xl animate-pulse" />
                      ))}
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="h-5 w-32 bg-gray-200 dark:bg-slate-700 rounded-lg animate-pulse" />
                    <div className="h-9 w-full bg-gray-100 dark:bg-slate-800 rounded-xl animate-pulse" />
                    <div className="grid grid-cols-2 gap-2">
                      {[1, 2].map((i) => (
                        <div key={i} className="h-10 bg-gray-100 dark:bg-slate-800 rounded-xl animate-pulse" />
                      ))}
                    </div>
                  </div>
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <div className="w-14 h-14 rounded-2xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center mb-4">
                    <AlertCircle className="w-7 h-7 text-red-500" />
                  </div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">Failed to load</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">{error}</p>
                  <button
                    onClick={() => window.location.reload()}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary-500 text-white text-sm font-medium hover:bg-primary-600 transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Retry
                  </button>
                </div>
              ) : saved ? (
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="flex flex-col items-center justify-center py-16"
                >
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-green-100 to-green-50 dark:from-green-500/20 dark:to-green-600/10 flex items-center justify-center mb-5 shadow-lg shadow-green-500/10">
                    <motion.div
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 0.4, ease: "easeOut" }}
                    >
                      <Check className="w-8 h-8 text-green-600 dark:text-green-400" />
                    </motion.div>
                  </div>
                  <p className="text-lg font-bold text-gray-900 dark:text-gray-100">Configuration Saved</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Report will update automatically</p>
                </motion.div>
              ) : (
                <>
                  {/* ── Product Codes Section ── */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-violet-50 dark:bg-violet-500/10 flex items-center justify-center">
                          <Package className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
                        </div>
                        <span className="text-sm font-bold text-gray-800 dark:text-gray-200">Product Codes</span>
                        <span className={cn(
                          "text-xs font-medium px-2 py-0.5 rounded-full transition-colors",
                          selectedCodes.length > 0
                            ? "bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300"
                            : "bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-gray-400"
                        )}>
                          {selectedCodes.length} / {productCodes.length} selected
                        </span>
                      </div>
                      {productCodes.length > 0 && (
                        <div className="flex items-center gap-1.5">
                          <button onClick={selectAllCodes} className="text-xs font-medium px-2.5 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500 dark:text-gray-400 transition-colors">All</button>
                          <button onClick={deselectAllCodes} className="text-xs font-medium px-2.5 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500 dark:text-gray-400 transition-colors">None</button>
                        </div>
                      )}
                    </div>

                    {/* Search */}
                    <div className="relative mb-3">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search product codes..."
                        value={codeSearch}
                        onChange={(e) => setCodeSearch(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 rounded-xl bg-gray-50 dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 dark:focus:border-violet-500 transition-all"
                      />
                    </div>

                    {productCodes.length === 0 ? (
                      <div className="flex flex-col items-center py-8 text-center bg-gray-50 dark:bg-slate-800/30 rounded-2xl border border-dashed border-gray-200 dark:border-slate-700">
                        <Package className="w-8 h-8 text-gray-300 dark:text-gray-600 mb-2" />
                        <p className="text-sm text-gray-500 dark:text-gray-400">No product codes configured</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Add them in <span className="font-medium">Product Exclusions</span></p>
                      </div>
                    ) : filteredCodes.length === 0 ? (
                      <div className="flex items-center justify-center py-6 text-sm text-gray-400 bg-gray-50 dark:bg-slate-800/30 rounded-2xl border border-dashed border-gray-200 dark:border-slate-700">
                        No codes match &quot;{codeSearch}&quot;
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2 max-h-44 overflow-y-auto pr-1 custom-scrollbar">
                        {filteredCodes.map((code) => (
                          <motion.button
                            key={code}
                            type="button"
                            layout
                            initial={false}
                            onClick={() => toggleCode(code)}
                            className={cn(
                              "flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border text-sm font-medium transition-all duration-150 text-left",
                              selectedCodes.includes(code)
                                ? "bg-violet-50 dark:bg-violet-500/10 border-violet-200 dark:border-violet-500/30 text-violet-700 dark:text-violet-300 shadow-sm"
                                : "bg-white dark:bg-slate-800/50 border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-slate-600 hover:shadow-sm"
                            )}
                          >
                            <div className={cn(
                              "w-4.5 h-4.5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all",
                              selectedCodes.includes(code)
                                ? "bg-violet-500 border-violet-500"
                                : "border-gray-300 dark:border-slate-600"
                            )}>
                              {selectedCodes.includes(code) && <Check className="w-3 h-3 text-white" />}
                            </div>
                            <span className="truncate">{code}</span>
                          </motion.button>
                        ))}
                      </div>
                    )}
                  </div>

                  {mode === "full" && (
                    <>
                    {/* ── Divider ── */}
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-px bg-gray-100 dark:bg-slate-700/50" />
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">and</span>
                      <div className="flex-1 h-px bg-gray-100 dark:bg-slate-700/50" />
                    </div>

                    {/* ── Retailer Tags Section ── */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-lg bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center">
                            <Tags className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                          </div>
                          <span className="text-sm font-bold text-gray-800 dark:text-gray-200">Retailer Tags</span>
                          <span className={cn(
                            "text-xs font-medium px-2 py-0.5 rounded-full transition-colors",
                            selectedTags.length > 0
                              ? "bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300"
                              : "bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-gray-400"
                          )}>
                            {selectedTags.length} / {retailerTags.length} selected
                          </span>
                        </div>
                        {retailerTags.length > 0 && (
                          <div className="flex items-center gap-1.5">
                            <button onClick={selectAllTags} className="text-xs font-medium px-2.5 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500 dark:text-gray-400 transition-colors">All</button>
                            <button onClick={deselectAllTags} className="text-xs font-medium px-2.5 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500 dark:text-gray-400 transition-colors">None</button>
                          </div>
                        )}
                      </div>

                      {/* Search */}
                      <div className="relative mb-3">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                        <input
                          type="text"
                          placeholder="Search retailer tags..."
                          value={tagSearch}
                          onChange={(e) => setTagSearch(e.target.value)}
                          className="w-full pl-9 pr-3 py-2 rounded-xl bg-gray-50 dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-400 dark:focus:border-amber-500 transition-all"
                        />
                      </div>

                      {retailerTags.length === 0 ? (
                        <div className="flex flex-col items-center py-8 text-center bg-gray-50 dark:bg-slate-800/30 rounded-2xl border border-dashed border-gray-200 dark:border-slate-700">
                          <Tags className="w-8 h-8 text-gray-300 dark:text-gray-600 mb-2" />
                          <p className="text-sm text-gray-500 dark:text-gray-400">No retailer tags configured</p>
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Add them in <span className="font-medium">Retailer Marking</span></p>
                        </div>
                      ) : filteredTags.length === 0 ? (
                        <div className="flex items-center justify-center py-6 text-sm text-gray-400 bg-gray-50 dark:bg-slate-800/30 rounded-2xl border border-dashed border-gray-200 dark:border-slate-700">
                          No tags match &quot;{tagSearch}&quot;
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-2 max-h-44 overflow-y-auto pr-1 custom-scrollbar">
                          {filteredTags.map((tag) => (
                            <motion.button
                              key={tag}
                              type="button"
                              layout
                              initial={false}
                              onClick={() => toggleTag(tag)}
                              className={cn(
                                "flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border text-sm font-medium transition-all duration-150 text-left",
                                selectedTags.includes(tag)
                                  ? "bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-300 shadow-sm"
                                  : "bg-white dark:bg-slate-800/50 border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-slate-600 hover:shadow-sm"
                              )}
                            >
                              <div className={cn(
                                "w-4.5 h-4.5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all",
                                selectedTags.includes(tag)
                                  ? "bg-amber-500 border-amber-500"
                                  : "border-gray-300 dark:border-slate-600"
                              )}>
                                {selectedTags.includes(tag) && <Check className="w-3 h-3 text-white" />}
                              </div>
                              <span className="truncate">{tag}</span>
                            </motion.button>
                          ))}
                        </div>
                      )}
                    </div>
                    </>
                  )}
                </>
              )}
            </div>

            {/* ── Footer ── */}
            <div className="shrink-0 px-6 py-4 border-t border-gray-100 dark:border-slate-700/50 bg-gray-50/50 dark:bg-slate-900/50">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setSelectedCodes([]);
                    setSelectedTags([]);
                  }}
                  className="px-4 py-2.5 rounded-xl text-sm font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                >
                  Reset
                </button>
                <div className="flex-1" />
                <button
                  onClick={onClose}
                  className="px-5 py-2.5 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                >
                  Cancel
                </button>
                <motion.button
                  onClick={handleSave}
                  disabled={saving || loading || saved}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  className={cn(
                    "px-7 py-2.5 rounded-xl text-sm font-bold text-white transition-all duration-200 flex items-center gap-2.5 shadow-lg",
                    saved
                      ? "bg-green-500 shadow-green-500/25"
                      : saving || loading
                        ? "bg-primary-400 cursor-not-allowed shadow-primary-400/20"
                        : "bg-primary-600 hover:bg-primary-700 shadow-primary-600/25 hover:shadow-primary-600/40",
                    (saving || loading) && "opacity-80"
                  )}
                >
                  {saving ? (
                    <>
                      <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                      Saving...
                    </>
                  ) : saved ? (
                    <>
                      <Check className="w-4 h-4" />
                      Saved!
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Save Configuration
                    </>
                  )}
                </motion.button>
              </div>
            </div>
          </motion.div>

          {/* Scrollbar styles */}
          <style jsx global>{`
            .custom-scrollbar::-webkit-scrollbar {
              width: 4px;
            }
            .custom-scrollbar::-webkit-scrollbar-track {
              background: transparent;
            }
            .custom-scrollbar::-webkit-scrollbar-thumb {
              background: #d1d5db;
              border-radius: 99px;
            }
            .dark .custom-scrollbar::-webkit-scrollbar-thumb {
              background: #475569;
            }
          `}</style>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
