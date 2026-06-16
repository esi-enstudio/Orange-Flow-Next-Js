"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import apiClient from "@/lib/api";
import { useLanguage } from "@/i18n/useLanguage";
import { toast } from "react-hot-toast";
import { motion, AnimatePresence } from "framer-motion";
import {
  SmartphoneNfc,
  Search,
  Loader2,
  CheckCircle2,
  Tag,
  Layers,
  AlertCircle,
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
  Download,
  Activity,
  ArrowRight,
  Clipboard,
  Database,
  Building,
  RefreshCw
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { AccessDenied } from "@/components/ui/AccessDenied";

interface House {
  id: number;
  name: string;
  code: string;
  display_name: string;
}

interface SIMStatusItem {
  sim_no: string;
  status: "Active" | "Issued" | "Warehouse" | "Other House" | "Not Found";
  distributor: string | null;
  retailer: string | null;
  activation_date: string | null;
  msisdn: string | null;
}

const loadingTipsEn = [
  "Spawning automated browser instance...",
  "Navigating to Banglalink DMS Portal...",
  "Authenticating with distributor credentials...",
  "Bypassing/verifying session credentials...",
  "Navigating to Smart Search Report page...",
  "Inputting SIM serial number queries...",
  "Submitting query to DMS engine...",
  "Scraping SIM data tables...",
  "Filtering target distributor allocations...",
  "Parsing status codes and MSISDN mapping..."
];

const loadingTipsBn = [
  "Starting automated browser instance...",
  "Navigating to Banglalink DMS portal...",
  "Logging in with distributor user ID...",
  "Verifying session credentials...",
  "Loading Smart Search Report page...",
  "Inputting SIM serial numbers...",
  "Submitting query to DMS engine...",
  "Scraping SIM data tables...",
  "Filtering target distributor allocations...",
  "Parsing status codes and MSISDN mapping..."
];

export default function SIMStatusCheckPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const { t, language } = useLanguage();

  const [houses, setHouses] = useState<House[]>([]);
  const [selectedHouseId, setSelectedHouseId] = useState<number | "">("");
  const [inputMethod, setInputMethod] = useState<"range" | "list">("range");
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [tipIndex, setTipIndex] = useState(0);

  // Query results
  const [results, setResults] = useState<SIMStatusItem[]>([]);
  const [houseInfo, setHouseInfo] = useState<{ name: string; code: string } | null>(null);

  // Table filtering and pagination states
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | SIMStatusItem["status"]>("All");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  // 1. Fetch accessible houses
  useEffect(() => {
    const fetchHouses = async () => {
      try {
        const res = await apiClient.get("houses/accessible");
        setHouses(res.data);
        if (res.data.length === 1) {
          setSelectedHouseId(res.data[0].id);
        }
      } catch (err) {
        toast.error("Failed to load houses list.");
      }
    };
    fetchHouses();
  }, [language]);

  // 2. Parsed counts calculator for dynamic UI counter
  const parsedCount = useMemo(() => {
    if (!inputValue.trim()) return 0;
    const rawLines = inputValue.split(/[\n,\;]+/);
    let total = 0;
    for (const line of rawLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Range detection
      if (trimmed.includes("-") && trimmed.split("-").length === 2) {
        const parts = trimmed.split("-");
        const start = parts[0].trim();
        const end = parts[1].trim();
        if (/^\d+$/.test(start) && /^\d+$/.test(end)) {
          const startNum = parseInt(start, 10);
          let endNum = 0;
          if (end.length < start.length) {
            const prefix = start.slice(0, start.length - end.length);
            endNum = parseInt(prefix + end, 10);
          } else {
            endNum = parseInt(end, 10);
          }
          const size = Math.abs(endNum - startNum) + 1;
          total += isNaN(size) ? 0 : size;
          continue;
        }
      }

      const clean = trimmed.replace(/\D/g, "");
      if (clean) {
        total += 1;
      }
    }
    return total;
  }, [inputValue]);

  // 3. Loading animation and tips cycling timer
  useEffect(() => {
    let timer: NodeJS.Timeout;
    let tipsTimer: NodeJS.Timeout;

    if (loading) {
      setElapsedTime(0);
      setTipIndex(0);

      timer = setInterval(() => {
        setElapsedTime((prev) => prev + 1);
      }, 1000);

      tipsTimer = setInterval(() => {
        setTipIndex((prev) => (prev + 1) % loadingTipsEn.length);
      }, 3500);
    }

    return () => {
      clearInterval(timer);
      clearInterval(tipsTimer);
    };
  }, [loading]);

  const activeTips = useMemo(() => {
    return language === "bn" ? loadingTipsBn : loadingTipsEn;
  }, [language]);

  // 4. Handle Submit Query
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedHouseId) {
      toast.error(t("sim_status_check.no_house"));
      return;
    }
    if (!inputValue.trim()) {
      toast.error(t("sim_status_check.no_input"));
      return;
    }
    if (parsedCount > 500) {
      toast.error(t("sim_status_check.range_too_large"));
      return;
    }

    setLoading(true);
    setResults([]);
    setCurrentPage(1);
    setStatusFilter("All");

    try {
      const res = await apiClient.post("dms/sim-status", {
        house_id: Number(selectedHouseId),
        input_value: inputValue
      });

      setResults(res.data.results);
      setHouseInfo({
        name: res.data.house_name,
        code: res.data.house_code
      });

      toast.success(`Successfully retrieved status for ${res.data.total_checked} SIMs!`);
    } catch (err: any) {
      const errMsg = err.response?.data?.detail || err.message || "Query failed";
      toast.error(errMsg);
    } finally {
      setLoading(false);
    }
  };

  // 5. Stat Counter Computations
  const stats = useMemo(() => {
    const total = results.length;
    const active = results.filter(r => r.status === "Active").length;
    const issued = results.filter(r => r.status === "Issued").length;
    const warehouse = results.filter(r => r.status === "Warehouse").length;
    const otherHouse = results.filter(r => r.status === "Other House").length;
    const notFound = results.filter(r => r.status === "Not Found").length;

    return { total, active, issued, warehouse, otherHouse, notFound };
  }, [results]);

  // 6. CSV Export local query results
  const exportToCSV = () => {
    if (results.length === 0) return;

    const headers = ["SIM Serial", "Status", "Mobile Number", "Activation Date", "Retailer", "Distributor"];
    const rows = results.map(r => [
      r.sim_no,
      r.status,
      r.msisdn || "-",
      r.activation_date || "-",
      r.retailer || "-",
      r.distributor || "-"
    ]);

    const csvContent = "data:text/csv;charset=utf-8,"
      + [headers.join(","), ...rows.map(e => e.map(val => `"${val}"`).join(","))].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    const fileName = `sim_status_report_${houseInfo?.code || "export"}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // 7. Filtering and Searching rows local
  const processedRows = useMemo(() => {
    return results.filter(row => {
      // 1. Status Filter
      if (statusFilter !== "All" && row.status !== statusFilter) return false;

      // 2. Search Query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesSerial = row.sim_no.toLowerCase().includes(query);
        const matchesMsisdn = row.msisdn?.toLowerCase().includes(query);
        const matchesRetailer = row.retailer?.toLowerCase().includes(query);
        return matchesSerial || matchesMsisdn || matchesRetailer;
      }

      return true;
    });
  }, [results, statusFilter, searchQuery]);

  // 8. Pagination calculation
  const totalPages = Math.ceil(processedRows.length / pageSize);
  const paginatedRows = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return processedRows.slice(startIndex, startIndex + pageSize);
  }, [processedRows, currentPage]);

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  // Helper functions for layouts
  const getStatusBadge = (status: SIMStatusItem["status"]) => {
    switch (status) {
      case "Active":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400 border border-green-200 dark:border-green-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            {t("sim_status_check.active")}
          </span>
        );
      case "Issued":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            {t("sim_status_check.issued")}
          </span>
        );
      case "Warehouse":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-gray-300 border border-gray-200 dark:border-slate-700">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-500" />
            {t("sim_status_check.warehouse")}
          </span>
        );
      case "Other House":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400 border border-orange-200 dark:border-orange-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
            {t("sim_status_check.other_house")}
          </span>
        );
      case "Not Found":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400 border border-red-200 dark:border-red-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
            {t("sim_status_check.not_found")}
          </span>
        );
    }
  };

  const loadExample = (type: "range" | "list") => {
    if (type === "range") {
      setInputValue("898803992145808574-580");
    } else {
      setInputValue("898803992145808574\n898803992145808575\n898803992145808580");
    }
  };

  if (!authLoading && !hasPermission("dms.sim_status")) {
    return <AccessDenied />;
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-12 animate-in fade-in duration-500">

      {/* Title Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-3xl p-6 md:p-8 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="p-3.5 rounded-2xl bg-gradient-to-tr from-primary-500 to-orange-400 text-white shadow-lg shadow-primary-200 dark:shadow-none animate-pulse">
            <SmartphoneNfc className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-gray-900 dark:text-gray-100">
              {t("sim_status_check.title")}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-xl">
              {t("sim_status_check.subtitle")}
            </p>
          </div>
        </div>

        {/* House Select Dropdown */}
        <div className="flex flex-col gap-2 max-w-sm w-full">
          <label className="text-xs font-bold text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
            <Building className="w-3.5 h-3.5" />
            {t("sim_status_check.select_house")}
          </label>
          <div className="relative">
            <select
              value={selectedHouseId}
              onChange={(e) => {
                    setSelectedHouseId(e.target.value === "" ? "" : Number(e.target.value));
                    setInputValue("");
                    setResults([]);
                    setHouseInfo(null);
                    setSearchQuery("");
                    setStatusFilter("All");
                    setCurrentPage(1);
                    setInputMethod("range");
                  }}
              disabled={loading}
              className="w-full pl-4 pr-10 py-3 bg-gray-50 dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700/60 rounded-2xl text-sm font-bold text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all cursor-pointer disabled:opacity-60"
            >
              <option value="">-- {t("sim_status_check.select_house")} --</option>
              {houses.map((house) => (
                <option key={house.id} value={house.id}>
                  {house.display_name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Main Entry Card */}
      <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-3xl p-6 md:p-8 shadow-sm relative overflow-hidden">

        {/* Glow decoration */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-primary-500/5 dark:bg-primary-500/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none" />

        <form onSubmit={handleSearch} className="space-y-6 relative z-10">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            {/* Input Selection Tabs */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-black text-gray-500 dark:text-gray-400 tracking-wide uppercase">
                {t("sim_status_check.input_method")}
              </label>
              <div className="flex gap-1.5 p-1 bg-gray-100/80 dark:bg-slate-800 border border-gray-200/50 dark:border-slate-700 rounded-2xl">
                <button
                  type="button"
                  onClick={() => {
                    setInputMethod("range");
                    setInputValue("");
                  }}
                  disabled={loading}
                  className={cn(
                    "px-5 py-2 text-xs font-black rounded-xl transition-all",
                    inputMethod === "range"
                      ? "bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-md"
                      : "text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                  )}
                >
                  {t("sim_status_check.method_range")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setInputMethod("list");
                    setInputValue("");
                  }}
                  disabled={loading}
                  className={cn(
                    "px-5 py-2 text-xs font-black rounded-xl transition-all",
                    inputMethod === "list"
                      ? "bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-md"
                      : "text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                  )}
                >
                  {t("sim_status_check.method_list")}
                </button>
              </div>
            </div>

            {/* Quick Helper Links */}
            <div className="flex gap-3 text-xs font-bold">
              <button
                type="button"
                onClick={() => loadExample(inputMethod)}
                disabled={loading}
                className="text-primary-500 hover:text-primary-600 transition-colors flex items-center gap-1 border-b border-primary-500/20 hover:border-primary-600/50"
              >
                <Clipboard className="w-3.5 h-3.5" />
                {"Load Example"}
              </button>
              <button
                type="button"
                onClick={() => setInputValue("")}
                disabled={loading}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                {t("common.reset")}
              </button>
            </div>
          </div>

          {/* Text Area Input */}
          <div className="relative group">
            <textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              disabled={loading}
              rows={5}
              placeholder={
                inputMethod === "range"
                  ? t("sim_status_check.placeholder_range")
                  : t("sim_status_check.placeholder_list")
              }
              className={cn(
                "w-full px-5 py-4 border border-gray-200 dark:border-slate-800 rounded-3xl bg-gray-50/50 dark:bg-slate-800/30 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:ring-2 transition-all text-sm font-mono tracking-wider leading-relaxed resize-none",
                parsedCount > 500
                  ? "focus:ring-red-500 border-red-300 dark:border-red-500/20"
                  : "focus:ring-primary-500"
              )}
            />

            {/* Realtime character counts & limits overlay status */}
            <div className="absolute right-4 bottom-4 flex items-center gap-2">
              <span
                className={cn(
                  "text-xs font-black px-3 py-1.5 rounded-xl border",
                  parsedCount === 0
                    ? "bg-gray-100 text-gray-400 dark:bg-slate-800 dark:border-slate-700"
                    : parsedCount > 500
                      ? "bg-red-50 text-red-600 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20"
                      : "bg-primary-50 text-primary-600 border-primary-100 dark:bg-primary-500/10 dark:text-primary-400 dark:border-primary-500/20"
                )}
              >
                {`Parsed: ${parsedCount} / 500`}
              </span>
            </div>
          </div>

          {parsedCount > 500 && (
            <p className="text-xs font-bold text-red-500 dark:text-red-400 flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4" />
              {t("sim_status_check.range_too_large")}
            </p>
          )}

          {/* Submit Action Block */}
          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={loading || parsedCount === 0 || parsedCount > 500 || !selectedHouseId}
              className="px-8 py-3.5 bg-gradient-to-tr from-primary-600 to-orange-500 hover:from-primary-700 hover:to-orange-600 text-white rounded-2xl text-sm font-black transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl active:translate-y-[1px] shadow-primary-200 dark:shadow-none flex items-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t("sim_status_check.searching")}
                </>
              ) : (
                <>
                  {t("sim_status_check.search_button")}
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </form>

        {/* Large overlay loading indicator with cycling status updates */}
        <AnimatePresence>
          {loading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-white/95 dark:bg-slate-900/95 z-50 flex flex-col items-center justify-center p-6 text-center"
            >
              <div className="relative mb-6">
                {/* Glowing ring animation */}
                <div className="absolute inset-[-10px] rounded-full border border-primary-500/20 dark:border-primary-500/30 animate-ping" />
                <div className="w-16 h-16 rounded-full bg-primary-500/10 dark:bg-primary-500/20 flex items-center justify-center text-primary-500">
                  <Loader2 className="w-8 h-8 animate-spin" />
                </div>
              </div>

              {/* Status Header */}
              <h4 className="text-lg font-black text-gray-800 dark:text-gray-200 tracking-tight">
                {t("sim_status_check.searching")}
              </h4>

              {/* Tips transition scope */}
              <div className="h-6 mt-2 overflow-hidden max-w-md">
                <AnimatePresence mode="wait">
                  <motion.p
                    key={tipIndex}
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -20, opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="text-sm font-medium text-gray-400 dark:text-gray-500"
                  >
                    {activeTips[tipIndex]}
                  </motion.p>
                </AnimatePresence>
              </div>

              {/* Elapsed Timer */}
              <span className="mt-8 text-xs font-black text-primary-600 bg-primary-50 dark:text-primary-400 dark:bg-primary-500/10 border border-primary-100 dark:border-primary-500/20 px-3.5 py-1.5 rounded-full flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5" />
                {`Time Elapsed: ${elapsedTime}s`}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Results Section Dashboard */}
      {houseInfo && (
        <div className="space-y-6 animate-in slide-in-from-bottom duration-500">

          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <h2 className="text-xl font-black text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Database className="w-5 h-5 text-primary-500" />
              {t("sim_status_check.results_title")}
              <span className="text-xs font-bold text-gray-500 dark:text-gray-400 font-mono">
                ({houseInfo?.name} - {houseInfo?.code})
              </span>
            </h2>

            <button
              onClick={exportToCSV}
              className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700/80 border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-200 rounded-xl text-xs font-black transition-colors flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              {"Export Results (CSV)"}
            </button>
          </div>

          {/* Stats Counter Filter Cards Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">

            {/* Total checked */}
            <div
              onClick={() => {
                setStatusFilter("All");
                setCurrentPage(1);
              }}
              className={cn(
                "p-5 rounded-2xl bg-white dark:bg-slate-900 border transition-all cursor-pointer select-none relative group hover:scale-[1.02]",
                statusFilter === "All"
                  ? "border-primary-500 dark:border-primary-400 ring-2 ring-primary-500/20"
                  : "border-gray-100 dark:border-slate-800 hover:border-gray-300 dark:hover:border-slate-700"
              )}
            >
              <div className="absolute top-4 right-4 text-gray-300 dark:text-slate-800 group-hover:text-primary-400 transition-colors">
                <SmartphoneNfc className="w-5 h-5" />
              </div>
              <p className="text-xs font-bold text-gray-400 dark:text-gray-500">{t("sim_status_check.total")}</p>
              <h3 className="text-2xl font-black text-gray-800 dark:text-gray-100 mt-2 font-mono">{stats.total}</h3>
              <span className="text-[10px] text-gray-400 mt-1 block">100%</span>
            </div>

            {/* Active Card */}
            <div
              onClick={() => {
                setStatusFilter("Active");
                setCurrentPage(1);
              }}
              className={cn(
                "p-5 rounded-2xl bg-white dark:bg-slate-900 border transition-all cursor-pointer select-none relative group hover:scale-[1.02]",
                statusFilter === "Active"
                  ? "border-green-500 dark:border-green-400 ring-2 ring-green-500/20"
                  : "border-gray-100 dark:border-slate-800 hover:border-gray-300 dark:hover:border-slate-700"
              )}
            >
              <div className="absolute top-4 right-4 text-green-300 dark:text-green-950 group-hover:text-green-500 transition-colors">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <p className="text-xs font-bold text-gray-400 dark:text-gray-500">{t("sim_status_check.active")}</p>
              <h3 className="text-2xl font-black text-green-600 dark:text-green-400 mt-2 font-mono">{stats.active}</h3>
              <span className="text-[10px] text-green-500 font-bold mt-1 block">
                {stats.total > 0 ? Math.round((stats.active / stats.total) * 100) : 0}%
              </span>
            </div>

            {/* Issued Card */}
            <div
              onClick={() => {
                setStatusFilter("Issued");
                setCurrentPage(1);
              }}
              className={cn(
                "p-5 rounded-2xl bg-white dark:bg-slate-900 border transition-all cursor-pointer select-none relative group hover:scale-[1.02]",
                statusFilter === "Issued"
                  ? "border-amber-500 dark:border-amber-400 ring-2 ring-amber-500/20"
                  : "border-gray-100 dark:border-slate-800 hover:border-gray-300 dark:hover:border-slate-700"
              )}
            >
              <div className="absolute top-4 right-4 text-amber-300 dark:text-amber-950 group-hover:text-amber-500 transition-colors">
                <Tag className="w-5 h-5" />
              </div>
              <p className="text-xs font-bold text-gray-400 dark:text-gray-500">{t("sim_status_check.issued")}</p>
              <h3 className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-2 font-mono">{stats.issued}</h3>
              <span className="text-[10px] text-amber-500 font-bold mt-1 block">
                {stats.total > 0 ? Math.round((stats.issued / stats.total) * 100) : 0}%
              </span>
            </div>

            {/* Warehouse Card */}
            <div
              onClick={() => {
                setStatusFilter("Warehouse");
                setCurrentPage(1);
              }}
              className={cn(
                "p-5 rounded-2xl bg-white dark:bg-slate-900 border transition-all cursor-pointer select-none relative group hover:scale-[1.02]",
                statusFilter === "Warehouse"
                  ? "border-gray-500 dark:border-gray-400 ring-2 ring-gray-500/20"
                  : "border-gray-100 dark:border-slate-800 hover:border-gray-300 dark:hover:border-slate-700"
              )}
            >
              <div className="absolute top-4 right-4 text-gray-400 dark:text-slate-800 group-hover:text-gray-600 transition-colors">
                <Layers className="w-5 h-5" />
              </div>
              <p className="text-xs font-bold text-gray-400 dark:text-gray-500">{t("sim_status_check.warehouse")}</p>
              <h3 className="text-2xl font-black text-gray-600 dark:text-gray-300 mt-2 font-mono">{stats.warehouse}</h3>
              <span className="text-[10px] text-gray-400 font-bold mt-1 block">
                {stats.total > 0 ? Math.round((stats.warehouse / stats.total) * 100) : 0}%
              </span>
            </div>

            {/* Other House Card */}
            <div
              onClick={() => {
                setStatusFilter("Other House");
                setCurrentPage(1);
              }}
              className={cn(
                "p-5 rounded-2xl bg-white dark:bg-slate-900 border transition-all cursor-pointer select-none relative group hover:scale-[1.02]",
                statusFilter === "Other House"
                  ? "border-orange-500 dark:border-orange-400 ring-2 ring-orange-500/20"
                  : "border-gray-100 dark:border-slate-800 hover:border-gray-300 dark:hover:border-slate-700"
              )}
            >
              <div className="absolute top-4 right-4 text-orange-300 dark:text-orange-950 group-hover:text-orange-500 transition-colors">
                <AlertCircle className="w-5 h-5" />
              </div>
              <p className="text-xs font-bold text-gray-400 dark:text-gray-500">{t("sim_status_check.other_house")}</p>
              <h3 className="text-2xl font-black text-orange-600 dark:text-orange-400 mt-2 font-mono">{stats.otherHouse}</h3>
              <span className="text-[10px] text-orange-500 font-bold mt-1 block">
                {stats.total > 0 ? Math.round((stats.otherHouse / stats.total) * 100) : 0}%
              </span>
            </div>

            {/* Not Found Card */}
            <div
              onClick={() => {
                setStatusFilter("Not Found");
                setCurrentPage(1);
              }}
              className={cn(
                "p-5 rounded-2xl bg-white dark:bg-slate-900 border transition-all cursor-pointer select-none relative group hover:scale-[1.02]",
                statusFilter === "Not Found"
                  ? "border-red-500 dark:border-red-400 ring-2 ring-red-500/20"
                  : "border-gray-100 dark:border-slate-800 hover:border-gray-300 dark:hover:border-slate-700"
              )}
            >
              <div className="absolute top-4 right-4 text-red-300 dark:text-red-950 group-hover:text-red-500 transition-colors">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <p className="text-xs font-bold text-gray-400 dark:text-gray-500">{t("sim_status_check.not_found")}</p>
              <h3 className="text-2xl font-black text-red-600 dark:text-red-400 mt-2 font-mono">{stats.notFound}</h3>
              <span className="text-[10px] text-red-500 font-bold mt-1 block">
                {stats.total > 0 ? Math.round((stats.notFound / stats.total) * 100) : 0}%
              </span>
            </div>

          </div>

          {/* Table filtering & listing card */}
          <div className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-3xl overflow-hidden shadow-sm">

            {/* Local Search bar */}
            <div className="p-5 border-b border-gray-100 dark:border-slate-800/80 bg-gray-50/50 dark:bg-slate-900/30 flex flex-col sm:flex-row gap-4 items-center justify-between">
              <div className="relative w-full max-w-sm">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1);
                  }}
                    placeholder={"Search serial, mobile, or retailer..."}
                  className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700/60 rounded-2xl text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 transition-all font-medium"
                />
              </div>

              {/* Status helper info */}
              <span className="text-xs font-bold text-gray-400 dark:text-gray-500">
                {`Showing results: ${(currentPage - 1) * pageSize + 1}-${Math.min(currentPage * pageSize, processedRows.length)} of ${processedRows.length}`}
              </span>
            </div>

            {/* Results Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse whitespace-nowrap">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-slate-800/60 bg-gray-50/20 dark:bg-slate-900/10">
                    <th className="px-6 py-4 text-xs font-black text-gray-500 dark:text-gray-400 tracking-wider uppercase">
                      {t("sim_status_check.table_serial")}
                    </th>
                    <th className="px-6 py-4 text-xs font-black text-gray-500 dark:text-gray-400 tracking-wider uppercase">
                      {t("sim_status_check.table_status")}
                    </th>
                    <th className="px-6 py-4 text-xs font-black text-gray-500 dark:text-gray-400 tracking-wider uppercase">
                      {t("sim_status_check.table_msisdn")}
                    </th>
                    <th className="px-6 py-4 text-xs font-black text-gray-500 dark:text-gray-400 tracking-wider uppercase">
                      {t("sim_status_check.table_activation")}
                    </th>
                    <th className="px-6 py-4 text-xs font-black text-gray-500 dark:text-gray-400 tracking-wider uppercase">
                      {t("sim_status_check.table_retailer")}
                    </th>
                    <th className="px-6 py-4 text-xs font-black text-gray-500 dark:text-gray-400 tracking-wider uppercase">
                      {t("sim_status_check.table_distributor")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-800/40 text-sm">
                  {paginatedRows.map((row, index) => (
                    <tr
                      key={`${row.sim_no}-${index}`}
                      className="hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition-colors font-medium text-gray-700 dark:text-gray-300"
                    >
                      {/* Serial */}
                      <td className="px-6 py-4 font-mono font-bold text-gray-900 dark:text-gray-100 text-xs">
                        {row.sim_no}
                      </td>

                      {/* Status */}
                      <td className="px-6 py-4">
                        {getStatusBadge(row.status)}
                      </td>

                      {/* MSISDN */}
                      <td className="px-6 py-4 font-mono font-bold text-xs">
                        {row.msisdn || "-"}
                      </td>

                      {/* Activation Date */}
                      <td className="px-6 py-4 text-xs text-gray-500 dark:text-gray-400">
                        {row.activation_date || "-"}
                      </td>

                      {/* Retailer */}
                      <td className="px-6 py-4 text-xs">
                        {row.retailer || "-"}
                      </td>

                      {/* Distributor */}
                      <td className="px-6 py-4 text-xs text-gray-500 dark:text-gray-400">
                        {row.distributor || "-"}
                      </td>
                    </tr>
                  ))}

                  {paginatedRows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-gray-400 dark:text-gray-500">
                          {"No results found."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="p-5 border-t border-gray-100 dark:border-slate-800/80 bg-gray-50/20 dark:bg-slate-900/10 flex items-center justify-center gap-4">
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="px-3 py-2 border border-gray-200 dark:border-slate-700/60 rounded-xl text-xs font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-40"
                >
                  <ChevronLeft className="w-4 h-4 inline-block mr-1" />
                  {t("common.prev")}
                </button>

                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="px-3 py-2 border border-gray-200 dark:border-slate-700/60 rounded-xl text-xs font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-40"
                >
                  {t("common.next")}
                  <ChevronRight className="w-4 h-4 inline-block ml-1" />
                </button>
              </div>
            )}

          </div>

        </div>
      )}

    </div>
  );
}
