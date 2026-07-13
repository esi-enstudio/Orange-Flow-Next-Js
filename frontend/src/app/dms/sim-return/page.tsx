"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import apiClient from "@/lib/api";
import { useLanguage } from "@/i18n/useLanguage";
import { toast } from "react-hot-toast";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { AccessDenied } from "@/components/ui/AccessDenied";
import {
  Undo2,
  Search,
  Loader2,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Download,
  Activity,
  ArrowRight,
  Clipboard,
  Database,
  Building,
  ShieldCheck,
  FileX,
  RotateCcw,
  AlertCircle,
  Smartphone,
  ChevronDown
} from "lucide-react";

interface House {
  id: number;
  name: string;
  code: string;
  display_name: string;
}

interface ReturnResultItem {
  sim_no: string;
  status: "Success" | "Failed" | "Already Returned";
  remarks: string | null;
}

const loadingTipsEn = [
  "Spawning automated browser instance...",
  "Navigating to Banglalink DMS Portal...",
  "Authenticating with distributor credentials...",
  "Bypassing/verifying session credentials...",
  "Navigating to SIM Return page...",
  "Inputting SIM serial number queries...",
  "Submitting return request to DMS engine...",
  "Processing SIM return transactions...",
  "Verifying return status with warehouse...",
  "Finalizing return results..."
];

const loadingTipsBn = [
  "Starting automated browser instance...",
  "Navigating to Banglalink DMS portal...",
  "Logging in with distributor user ID...",
  "Verifying session credentials...",
  "Navigating to SIM return page...",
  "Inputting SIM serial numbers...",
  "Submitting return request to DMS engine...",
  "Processing SIM return transactions...",
  "Verifying return status with warehouse...",
  "Finalizing return results..."
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08 }
  }
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring" as const, stiffness: 200, damping: 20 }
  }
} as const;

const cardVariants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: (i: number) => ({
    opacity: 1,
    scale: 1,
    transition: { delay: i * 0.08, type: "spring" as const, stiffness: 200, damping: 20 }
  })
};

export default function SIMReturnPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const { t, language } = useLanguage();

  const [houses, setHouses] = useState<House[]>([]);
  const [selectedHouseId, setSelectedHouseId] = useState<number | "">("");
  const [inputMethod, setInputMethod] = useState<"range" | "list">("range");
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [tipIndex, setTipIndex] = useState(0);
  const [results, setResults] = useState<ReturnResultItem[]>([]);
  const [houseInfo, setHouseInfo] = useState<{ name: string; code: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | ReturnResultItem["status"]>("All");
  const [currentPage, setCurrentPage] = useState(1);
  const [showConfirm, setShowConfirm] = useState(false);
  const houseSelectRef = useRef<HTMLSelectElement>(null);
  const pageSize = 10;

  useEffect(() => {
    const el = houseSelectRef.current;
    if (!el) return;
    const observer = new MutationObserver(() => {
      el.style.colorScheme = document.documentElement.classList.contains("dark") ? "dark" : "light";
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    el.style.colorScheme = document.documentElement.classList.contains("dark") ? "dark" : "light";
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const fetchHouses = async () => {
      try {
        const res = await apiClient.get("houses/accessible");
        setHouses(res.data);
        if (res.data.length === 1) {
          setSelectedHouseId(res.data[0].id);
        }
      } catch {
        toast.error("Failed to load houses list.");
      }
    };
    fetchHouses();
  }, [language]);

  const parsedCount = useMemo(() => {
    if (!inputValue.trim()) return 0;
    const rawLines = inputValue.split(/[\n,\;]+/);
    let total = 0;
    for (const line of rawLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
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

  useEffect(() => {
    let timer: NodeJS.Timeout;
    let tipsTimer: NodeJS.Timeout;
    if (loading) {
      setElapsedTime(0);
      setTipIndex(0);
      timer = setInterval(() => setElapsedTime((p) => p + 1), 1000);
      tipsTimer = setInterval(() => setTipIndex((p) => (p + 1) % loadingTipsEn.length), 3500);
    }
    return () => {
      clearInterval(timer);
      clearInterval(tipsTimer);
    };
  }, [loading]);

  const activeTips = useMemo(() => (language === "bn" ? loadingTipsBn : loadingTipsEn), [language]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedHouseId) { toast.error(t("sim_return.no_house")); return; }
    if (!inputValue.trim()) { toast.error(t("sim_return.no_input")); return; }
    if (parsedCount > 500) { toast.error(t("sim_return.range_too_large")); return; }
    setShowConfirm(true);
  };

  const confirmReturn = async () => {
    setShowConfirm(false);
    setLoading(true);
    setResults([]);
    setCurrentPage(1);
    setStatusFilter("All");

    try {
      const res = await apiClient.post("dms/sim-return", {
        house_id: Number(selectedHouseId),
        input_value: inputValue
      });
      setResults(res.data.results);
      setHouseInfo({ name: res.data.house_name, code: res.data.house_code });
      toast.success(`Successfully processed return for ${res.data.total_processed} SIM(s)!`);
    } catch (err: any) {
      const errMsg = err.response?.data?.detail || err.message || "Return query failed";
      toast.error(errMsg);
    } finally {
      setLoading(false);
    }
  };

  const stats = useMemo(() => {
    const total = results.length;
    const success = results.filter((r) => r.status === "Success").length;
    const failed = results.filter((r) => r.status === "Failed").length;
    const alreadyReturned = results.filter((r) => r.status === "Already Returned").length;
    return { total, success, failed, alreadyReturned };
  }, [results]);

  const exportToCSV = () => {
    if (results.length === 0) return;
    const headers = ["SIM Serial", "Return Status", "Remarks"];
    const rows = results.map((r) => [r.sim_no, r.status, r.remarks || "-"]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `sim-return-${houseInfo?.code || "export"}-${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const processedRows = useMemo(() => {
    return results.filter((row) => {
      if (statusFilter !== "All" && row.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return row.sim_no.toLowerCase().includes(q) || (row.remarks?.toLowerCase().includes(q) ?? false);
      }
      return true;
    });
  }, [results, statusFilter, searchQuery]);

  const totalPages = Math.ceil(processedRows.length / pageSize);
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return processedRows.slice(start, start + pageSize);
  }, [processedRows, currentPage]);

  const handlePageChange = useCallback((page: number) => {
    if (page >= 1 && page <= totalPages) setCurrentPage(page);
  }, [totalPages]);

  const getStatusBadge = (status: ReturnResultItem["status"]) => {
    switch (status) {
      case "Success":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400 border border-green-200 dark:border-green-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            {t("sim_return.success")}
          </span>
        );
      case "Failed":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400 border border-red-200 dark:border-red-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
            {t("sim_return.failed")}
          </span>
        );
      case "Already Returned":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            {t("sim_return.already_returned")}
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

  if (!authLoading && !hasPermission("dms.sim_return")) {
    return <AccessDenied />;
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-12">
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="space-y-8"
      >
        {/* Title Header */}
        <motion.div variants={itemVariants} className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-3xl p-6 md:p-8 shadow-sm">
          <div className="flex items-center gap-4">
            <motion.div
              initial={{ rotate: -180, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              transition={{ duration: 0.6, type: "spring", stiffness: 120 }}
              className="p-3.5 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 text-white shadow-lg shadow-emerald-200 dark:shadow-none"
            >
              <Undo2 className="w-6 h-6" />
            </motion.div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-gray-900 dark:text-gray-100">
                {t("sim_return.title")}
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-xl">
                {t("sim_return.subtitle")}
              </p>
            </div>
          </div>

          {/* House Select Dropdown */}
          <motion.div variants={itemVariants} className="flex flex-col gap-2 max-w-sm w-full">
            <label className="text-xs font-bold text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
              <Building className="w-3.5 h-3.5" />
              {t("sim_return.select_house")}
            </label>
            <div className="relative">
              <select
                ref={houseSelectRef}
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
                className="w-full pl-4 pr-10 py-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl text-sm font-bold text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all cursor-pointer disabled:opacity-60 appearance-none"
              >
                <option value="" className="dark:bg-slate-800 dark:text-gray-400">-- {t("sim_return.select_house")} --</option>
                {houses.map((house) => (
                  <option key={house.id} value={house.id} className="dark:bg-slate-800 dark:text-gray-100">{house.display_name}</option>
                ))}
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                <ChevronDown className="w-4 h-4" />
              </div>
            </div>
          </motion.div>
        </motion.div>

        {/* Main Entry Card */}
        <motion.div variants={itemVariants} className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-3xl p-6 md:p-8 shadow-sm relative overflow-hidden">
          {/* Glow decoration */}
          <motion.div
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1.5 }}
            className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 dark:bg-emerald-500/10 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none"
          />

          <form onSubmit={handleSearch} className="space-y-6 relative z-10">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <motion.div variants={itemVariants} className="flex flex-col gap-1.5">
                <label className="text-xs font-black text-gray-500 dark:text-gray-400 tracking-wide uppercase">
                  {t("sim_return.input_method")}
                </label>
                <div className="flex gap-1.5 p-1 bg-gray-100/80 dark:bg-slate-800 border border-gray-200/50 dark:border-slate-700 rounded-2xl">
                  <button
                    type="button"
                    onClick={() => { setInputMethod("range"); setInputValue(""); }}
                    disabled={loading}
                    className={cn(
                      "px-5 py-2 text-xs font-black rounded-xl transition-all",
                      inputMethod === "range"
                        ? "bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-md"
                        : "text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                    )}
                  >
                    {t("sim_return.method_range")}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setInputMethod("list"); setInputValue(""); }}
                    disabled={loading}
                    className={cn(
                      "px-5 py-2 text-xs font-black rounded-xl transition-all",
                      inputMethod === "list"
                        ? "bg-white dark:bg-slate-700 text-gray-900 dark:text-white shadow-md"
                        : "text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                    )}
                  >
                    {t("sim_return.method_list")}
                  </button>
                </div>
              </motion.div>

              <div className="flex gap-3 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => loadExample(inputMethod)}
                  disabled={loading}
                  className="text-emerald-500 hover:text-emerald-600 transition-colors flex items-center gap-1 border-b border-emerald-500/20 hover:border-emerald-600/50"
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
                    ? t("sim_return.placeholder_range")
                    : t("sim_return.placeholder_list")
                }
                className={cn(
                  "w-full px-5 py-4 border border-gray-200 dark:border-slate-800 rounded-3xl bg-gray-50/50 dark:bg-slate-800/30 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:ring-2 transition-all text-sm font-mono tracking-wider leading-relaxed resize-none",
                  parsedCount > 500
                    ? "focus:ring-red-500 border-red-300 dark:border-red-500/20"
                    : "focus:ring-emerald-500"
                )}
              />

              <div className="absolute right-4 bottom-4 flex items-center gap-2">
                <span
                  className={cn(
                    "text-xs font-black px-3 py-1.5 rounded-xl border",
                    parsedCount === 0
                      ? "bg-gray-100 text-gray-400 dark:bg-slate-800 dark:border-slate-700"
                      : parsedCount > 500
                        ? "bg-red-50 text-red-600 border-red-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20"
                        : "bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20"
                  )}
                >
                  {`Parsed: ${parsedCount} / 500`}
                </span>
              </div>
            </div>

            {parsedCount > 500 && (
              <motion.p
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="text-xs font-bold text-red-500 dark:text-red-400 flex items-center gap-1.5"
              >
                <AlertCircle className="w-4 h-4" />
                {t("sim_return.range_too_large")}
              </motion.p>
            )}

            {/* Submit Action Block */}
            <div className="flex justify-end pt-2">
              <motion.button
                type="submit"
                disabled={loading || parsedCount === 0 || parsedCount > 500 || !selectedHouseId}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="px-8 py-3.5 bg-gradient-to-tr from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600 text-white rounded-2xl text-sm font-black transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl active:translate-y-[1px] shadow-emerald-200 dark:shadow-none flex items-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t("sim_return.returning")}
                  </>
                ) : (
                  <>
                    <RotateCcw className="w-4 h-4" />
                    {t("sim_return.return_button")}
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </motion.button>
            </div>
          </form>

          {/* Loading Overlay */}
          <AnimatePresence>
            {loading && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-white/95 dark:bg-slate-900/95 z-50 flex flex-col items-center justify-center p-6 text-center"
              >
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                  className="relative mb-6"
                >
                  <div className="absolute inset-[-10px] rounded-full border border-emerald-500/20 dark:border-emerald-500/30 animate-ping" />
                  <div className="w-16 h-16 rounded-full bg-emerald-500/10 dark:bg-emerald-500/20 flex items-center justify-center text-emerald-500">
                    <RotateCcw className="w-8 h-8" />
                  </div>
                </motion.div>

                <h4 className="text-lg font-black text-gray-800 dark:text-gray-200 tracking-tight">
                  {t("sim_return.returning")}
                </h4>

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

                <motion.span
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                  className="mt-8 text-xs font-black text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 px-3.5 py-1.5 rounded-full flex items-center gap-1.5"
                >
                  <Activity className="w-3.5 h-3.5" />
                  {`Time Elapsed: ${elapsedTime}s`}
                </motion.span>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Results Section Dashboard */}
        {houseInfo && (
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="space-y-6"
          >
            {/* Results Header */}
            <motion.div
              variants={containerVariants}
              initial="hidden"
              animate="visible"
              className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
            >
              <motion.h2 variants={itemVariants} className="text-xl font-black text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <Database className="w-5 h-5 text-emerald-500" />
                {t("sim_return.results_title")}
                <span className="text-xs font-bold text-gray-500 dark:text-gray-400 font-mono">
                  ({houseInfo?.name} - {houseInfo?.code})
                </span>
              </motion.h2>

              <motion.button
                variants={itemVariants}
                onClick={exportToCSV}
                className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700/80 border border-gray-200 dark:border-slate-700 text-gray-700 dark:text-gray-200 rounded-xl text-xs font-black transition-colors flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                {"Export Results (CSV)"}
              </motion.button>
            </motion.div>

            {/* Stats Counter Cards Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                {
                  key: "All" as const,
                  label: t("sim_return.total"),
                  value: stats.total,
                  color: "gray",
                  icon: Smartphone,
                  borderColor: "border-gray-300 dark:border-gray-600",
                  activeColor: "border-gray-500 dark:border-gray-400 ring-2 ring-gray-500/20",
                  iconColor: "text-gray-300 dark:text-gray-700 group-hover:text-gray-500",
                  valueColor: "text-gray-800 dark:text-gray-100",
                  percentColor: "text-gray-400"
                },
                {
                  key: "Success" as const,
                  label: t("sim_return.success"),
                  value: stats.success,
                  color: "green",
                  icon: ShieldCheck,
                  borderColor: "border-gray-100 dark:border-slate-800",
                  activeColor: "border-green-500 dark:border-green-400 ring-2 ring-green-500/20",
                  iconColor: "text-green-300 dark:text-green-950 group-hover:text-green-500",
                  valueColor: "text-green-600 dark:text-green-400",
                  percentColor: "text-green-500"
                },
                {
                  key: "Failed" as const,
                  label: t("sim_return.failed"),
                  value: stats.failed,
                  color: "red",
                  icon: FileX,
                  borderColor: "border-gray-100 dark:border-slate-800",
                  activeColor: "border-red-500 dark:border-red-400 ring-2 ring-red-500/20",
                  iconColor: "text-red-300 dark:text-red-950 group-hover:text-red-500",
                  valueColor: "text-red-600 dark:text-red-400",
                  percentColor: "text-red-500"
                },
                {
                  key: "Already Returned" as const,
                  label: t("sim_return.already_returned"),
                  value: stats.alreadyReturned,
                  color: "amber",
                  icon: AlertTriangle,
                  borderColor: "border-gray-100 dark:border-slate-800",
                  activeColor: "border-amber-500 dark:border-amber-400 ring-2 ring-amber-500/20",
                  iconColor: "text-amber-300 dark:text-amber-950 group-hover:text-amber-500",
                  valueColor: "text-amber-600 dark:text-amber-400",
                  percentColor: "text-amber-500"
                }
              ].map((card, i) => (
                <motion.div
                  key={card.key}
                  custom={i}
                  variants={cardVariants}
                  initial="hidden"
                  animate="visible"
                  onClick={() => { setStatusFilter(card.key); setCurrentPage(1); }}
                  className={cn(
                    "p-5 rounded-2xl bg-white dark:bg-slate-900 border transition-all cursor-pointer select-none relative group hover:scale-[1.02]",
                    statusFilter === card.key ? card.activeColor : card.borderColor + " hover:border-gray-300 dark:hover:border-slate-700"
                  )}
                >
                  <div className={cn("absolute top-4 right-4 transition-colors", card.iconColor)}>
                    <card.icon className="w-5 h-5" />
                  </div>
                  <p className="text-xs font-bold text-gray-400 dark:text-gray-500">{card.label}</p>
                  <h3 className={cn("text-2xl font-black mt-2 font-mono", card.valueColor)}>
                    {card.value}
                  </h3>
                  <span className={cn("text-[10px] font-bold mt-1 block", card.percentColor)}>
                    {stats.total > 0 ? Math.round((card.value / stats.total) * 100) : 0}%
                  </span>
                </motion.div>
              ))}
            </div>

            {/* Table & Pagination */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-3xl overflow-hidden shadow-sm"
            >
              {/* Local Search bar */}
              <div className="p-5 border-b border-gray-100 dark:border-slate-800/80 bg-gray-50/50 dark:bg-slate-900/30 flex flex-col sm:flex-row gap-4 items-center justify-between">
                <div className="relative w-full max-w-sm">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                    placeholder={"Search serial or remarks..."}
                    className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700/60 rounded-2xl text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all font-medium"
                  />
                </div>

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
                        {t("sim_return.table_serial")}
                      </th>
                      <th className="px-6 py-4 text-xs font-black text-gray-500 dark:text-gray-400 tracking-wider uppercase">
                        {t("sim_return.table_status")}
                      </th>
                      <th className="px-6 py-4 text-xs font-black text-gray-500 dark:text-gray-400 tracking-wider uppercase">
                        {t("sim_return.table_remarks")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-slate-800/40 text-sm">
                    {paginatedRows.map((row, index) => (
                      <motion.tr
                        key={`${row.sim_no}-${index}`}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.03 }}
                        className="hover:bg-gray-50/50 dark:hover:bg-slate-800/30 transition-colors font-medium text-gray-700 dark:text-gray-300"
                      >
                        <td className="px-6 py-4 font-mono font-bold text-gray-900 dark:text-gray-100 text-xs">
                          {row.sim_no}
                        </td>
                        <td className="px-6 py-4">
                          {getStatusBadge(row.status)}
                        </td>
                        <td className="px-6 py-4 text-xs text-gray-500 dark:text-gray-400">
                          {row.remarks || "-"}
                        </td>
                      </motion.tr>
                    ))}

                    {paginatedRows.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-6 py-12 text-center text-gray-400 dark:text-gray-500">
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
            </motion.div>
          </motion.div>
        )}

        {/* Confirmation Dialog */}
        <AnimatePresence>
          {showConfirm && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                transition={{ type: "spring", stiffness: 300, damping: 25 }}
                className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-3xl p-8 max-w-md w-full shadow-2xl"
              >
                <div className="flex flex-col items-center text-center">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 300, delay: 0.1 }}
                    className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-500/10 flex items-center justify-center text-amber-500 mb-4"
                  >
                    <AlertTriangle className="w-8 h-8" />
                  </motion.div>

                  <h3 className="text-xl font-black text-gray-900 dark:text-gray-100 mb-2">
                    {t("sim_return.confirm_title")}
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                    {t("sim_return.confirm_desc").replace("{count}", String(parsedCount))}
                  </p>

                  <div className="flex gap-3 w-full">
                    <button
                      onClick={() => setShowConfirm(false)}
                      className="flex-1 px-5 py-3 border border-gray-200 dark:border-slate-700 rounded-2xl text-sm font-black text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
                    >
                      {t("sim_return.confirm_no")}
                    </button>
                    <button
                      onClick={confirmReturn}
                      className="flex-1 px-5 py-3 bg-gradient-to-tr from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600 text-white rounded-2xl text-sm font-black transition-all shadow-lg shadow-emerald-200 dark:shadow-none"
                    >
                      {t("sim_return.confirm_yes")}
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
