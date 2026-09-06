"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import apiClient from "@/lib/api";
import { useLanguage } from "@/i18n/useLanguage";
import { toast } from "react-hot-toast";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { SerialRangeInput, SerialRangeInputHandle } from "@/components/dms/SerialRangeInput";
import { fetchEventSource, EventSourceMessage } from "@microsoft/fetch-event-source";
import Cookies from "js-cookie";
import {
  SmartphoneNfc,
  Search,
  Loader2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  Activity,
  ArrowRight,
  Clipboard,
  Database,
  Building,
  Store,
  ShieldCheck,
  Tag,
  ChevronDown,
  X,
  AlertTriangle
} from "lucide-react";

interface House {
  id: number;
  name: string;
  code: string;
  display_name: string;
}

interface Retailer {
  id: number;
  retailer_code: string;
  name: string;
  itop_number: string | null;
  employee_id: number | null;
  employee_itop_number: string | null;
  is_assisted: boolean;
  assisted_by_role: string | null;
}

interface IssueResultItem {
  sim_no: string;
  status: "Success" | "Skipped" | "Failed";
  message: string | null;
}

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

export default function SIMIssuePage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const { t, language } = useLanguage();

  const [houses, setHouses] = useState<House[]>([]);
  const [selectedHouseId, setSelectedHouseId] = useState<number | "">("");

  const [retailerSearch, setRetailerSearch] = useState("");
  const [retailers, setRetailers] = useState<Retailer[]>([]);
  const [retailersLoading, setRetailersLoading] = useState(false);
  const [selectedRetailer, setSelectedRetailer] = useState<Retailer | null>(null);

  const [inputMethod, setInputMethod] = useState<"range" | "list">("range");
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [results, setResults] = useState<IssueResultItem[]>([]);
  const [issueInfo, setIssueInfo] = useState<{
    houseName: string;
    houseCode: string;
    retailerCode: string;
    retailerName: string;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | IssueResultItem["status"]>("All");
  const [currentPage, setCurrentPage] = useState(1);
  const [showConfirm, setShowConfirm] = useState(false);
  const pageSize = 10;
  const logContainerRef = useRef<HTMLDivElement>(null);
  const rangeInputRef = useRef<SerialRangeInputHandle>(null);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

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

  useEffect(() => {
    if (!selectedHouseId || retailerSearch.trim() === "") {
      setRetailers([]);
      return;
    }
    const delayDebounceFn = setTimeout(async () => {
      setRetailersLoading(true);
      try {
        const res = await apiClient.get(
          `retailers/by-house/${selectedHouseId}?search=${encodeURIComponent(retailerSearch)}`
        );
        setRetailers(res.data);
      } catch {
        setRetailers([]);
      } finally {
        setRetailersLoading(false);
      }
    }, 300);
    return () => clearTimeout(delayDebounceFn);
  }, [retailerSearch, selectedHouseId]);

  const parsedCount = useMemo(() => {
    function b(v: string) { try { return BigInt(v); } catch { return BigInt(0); } }
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
          let endStr = end;
          if (end.length < start.length) {
            const prefix = start.slice(0, start.length - end.length);
            endStr = prefix + end;
          }
          const s = b(start);
          const e = b(endStr);
          if (s === BigInt(0) || e === BigInt(0) || e < s) continue;
          const diff = e - s + BigInt(1);
          if (diff > BigInt(500)) continue;
          total += Number(diff);
          continue;
        }
      }
      const clean = trimmed.replace(/\D/g, "");
      if (clean) total += 1;
    }
    return total;
  }, [inputValue]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (loading) {
      setElapsedTime(0);
      timer = setInterval(() => setElapsedTime((p) => p + 1), 1000);
    }
    return () => clearInterval(timer);
  }, [loading]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedHouseId) { toast.error(t("sim_issue.no_house")); return; }
    if (!selectedRetailer) { toast.error(t("sim_issue.no_retailer")); return; }
    if (!inputValue.trim()) { toast.error(t("sim_issue.no_input")); return; }
    if (parsedCount > 500) { toast.error(t("sim_issue.range_too_large")); return; }
    setShowConfirm(true);
  };

  const confirmIssue = () => {
    setShowConfirm(false);
    setLoading(true);
    setResults([]);
    setLogs([]);
    setCurrentPage(1);
    setStatusFilter("All");

    const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000/api";
    const url = `${baseUrl}/dms/sim-issue/stream`;

    fetchEventSource(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${Cookies.get("token")}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        house_id: Number(selectedHouseId),
        retailer_id: selectedRetailer!.id,
        input_value: inputValue
      }),
      onmessage(ev: EventSourceMessage) {
        if (ev.event === "log") {
          const data = JSON.parse(ev.data);
          setLogs(prev => [...prev, data.message]);
        } else if (ev.event === "error") {
          const data = JSON.parse(ev.data);
          setLogs(prev => [...prev, `❌ ${data.message}`]);
          toast.error(data.message);
          setLoading(false);
        } else if (ev.event === "complete") {
          const data = JSON.parse(ev.data);
          setResults(data.results);
          setIssueInfo({
            houseName: data.house_name,
            houseCode: data.house_code,
            retailerCode: data.retailer_code,
            retailerName: data.retailer_name
          });
          toast.success(`Successfully issued ${data.total_success} SIM(s) to ${data.retailer_name}!`);
          setLoading(false);
        }
      },
      onerror(err: any) {
        toast.error("Connection lost. Please try again.");
        setLoading(false);
        throw err;
      }
    });
  };

  const stats = useMemo(() => {
    const total = results.length;
    const success = results.filter((r) => r.status === "Success").length;
    const skipped = results.filter((r) => r.status === "Skipped").length;
    const failed = results.filter((r) => r.status === "Failed").length;
    return { total, success, skipped, failed };
  }, [results]);

  const exportToCSV = () => {
    if (results.length === 0) return;
    const headers = ["SIM Serial", "Status", "Message"];
    const rows = results.map((r) => [r.sim_no, r.status, r.message || "-"]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `sim-issue-${issueInfo?.retailerCode || "export"}-${Date.now()}.csv`;
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
        return row.sim_no.toLowerCase().includes(q) || (row.message?.toLowerCase().includes(q) ?? false);
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

  const getStatusBadge = (status: IssueResultItem["status"]) => {
    switch (status) {
      case "Success":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400 border border-green-200 dark:border-green-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            {t("sim_issue.success")}
          </span>
        );
      case "Skipped":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 border border-amber-200 dark:border-amber-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            {t("sim_issue.skipped")}
          </span>
        );
      case "Failed":
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400 border border-red-200 dark:border-red-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
            {t("sim_issue.failed")}
          </span>
        );
    }
  };

  const loadExample = (type: "range" | "list") => {
    if (type === "range") {
      const val = "898803992145808574-580";
      setInputValue(val);
      setTimeout(() => rangeInputRef.current?.resetFromValue(val), 0);
    } else {
      setInputValue("898803992145808574\n898803992145808575\n898803992145808580");
    }
  };

  if (!authLoading && !hasPermission("dms.sim_issue")) {
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
              className="p-3.5 rounded-2xl bg-gradient-to-tr from-orange-500 to-amber-400 text-white shadow-lg shadow-orange-200 dark:shadow-none"
            >
              <SmartphoneNfc className="w-6 h-6" />
            </motion.div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-gray-900 dark:text-gray-100">
                {t("sim_issue.title")}
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-xl">
                {t("sim_issue.subtitle")}
              </p>
            </div>
          </div>

          {/* House Select Dropdown */}
          <motion.div variants={itemVariants} className="flex flex-col gap-2 max-w-sm w-full">
            <label className="text-xs font-bold text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
              <Building className="w-3.5 h-3.5" />
              {t("sim_issue.select_house")}
            </label>
            <div className="relative">
              <select
                value={selectedHouseId}
                onChange={(e) => {
                  const val = e.target.value === "" ? "" : Number(e.target.value);
                  setSelectedHouseId(val);
                  setSelectedRetailer(null);
                  setRetailerSearch("");
                  setRetailers([]);
                  setInputValue("");
                  setResults([]);
                  setIssueInfo(null);
                  setSearchQuery("");
                  setStatusFilter("All");
                  setCurrentPage(1);
                  setInputMethod("range");
                }}
                disabled={loading}
                className="w-full pl-4 pr-10 py-3 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-2xl text-sm font-bold text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all cursor-pointer disabled:opacity-60 appearance-none"
              >
                <option value="" className="dark:bg-slate-800 dark:text-gray-400">-- {t("sim_issue.select_house")} --</option>
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
        <motion.div variants={itemVariants} className="bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 rounded-3xl p-6 md:p-8 shadow-sm relative">
          {/* Glow decoration (clipped to card to avoid horizontal scroll) */}
          <div className="absolute inset-0 overflow-hidden rounded-3xl pointer-events-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 1.5 }}
              className="absolute -top-20 -right-20 w-64 h-64 bg-orange-500/5 dark:bg-orange-500/10 rounded-full blur-3xl"
            />
          </div>

          <form onSubmit={handleSearch} className="space-y-6 relative z-10">
            {/* No house selected placeholder */}
            {!selectedHouseId ? (
              <div className="flex flex-col items-center justify-center py-12 text-center text-gray-400 dark:text-gray-500">
                <Building className="w-12 h-12 mb-3 text-gray-200 dark:text-gray-800 animate-pulse" />
                <p className="text-sm font-bold">{t("sim_issue.no_house")}</p>
              </div>
            ) : !selectedRetailer ? (
              /* Step 1: Retailer Search - high-performance, no pre-load */
              <div className="flex flex-col gap-2 w-full relative">
                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                  <Store className="w-3.5 h-3.5" />
                  {t("sim_issue.select_retailer")}
                </label>
                <div className="relative">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={retailerSearch}
                    onChange={(e) => {
                      const val = e.target.value;
                      setRetailerSearch(val);
                      if (val.trim() === "") {
                        setRetailers([]);
                      }
                    }}
                    placeholder={t("sim_issue.search_retailer_placeholder")}
                    autoComplete="off"
                    className="w-full pl-10 pr-10 py-3 bg-gray-50 dark:bg-slate-800/50 border border-gray-200 dark:border-slate-700/60 rounded-2xl text-sm font-bold text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all"
                  />
                  {retailersLoading && (
                    <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
                      <Loader2 className="w-4 h-4 animate-spin text-orange-500" />
                    </div>
                  )}

                  {/* Dropdown - only shown when search has input and results available */}
                  {retailerSearch.trim().length > 0 && (
                    <div className="absolute left-0 right-0 mt-2 max-h-60 overflow-y-auto z-50 bg-white dark:bg-slate-900 border border-gray-150 dark:border-slate-800 rounded-2xl shadow-xl divide-y divide-gray-50 dark:divide-slate-800/40">
                      {retailers.length > 0 ? (
                        retailers.map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => {
                              setSelectedRetailer(r);
                              setRetailerSearch("");
                              setRetailers([]);
                            }}
                            className="w-full text-left px-4 py-3 hover:bg-orange-50/50 dark:hover:bg-orange-500/5 flex items-center gap-3 transition-colors"
                          >
                            <div className="w-8 h-8 rounded-lg bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300 flex items-center justify-center flex-shrink-0">
                              <Store className="w-4 h-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-bold text-gray-900 dark:text-gray-100 truncate">
                                {r.name}
                                {r.employee_itop_number && (
                                  <span className="text-orange-600 dark:text-orange-400 font-mono">
                                    {' '}({r.employee_itop_number.slice(-3)})
                                  </span>
                                )}
                              </p>
                              <p className="text-[11px] font-mono text-gray-500 dark:text-gray-400 flex items-center gap-2">
                                <span>Code: {r.retailer_code}</span>
                                {r.itop_number && <span>• iTop: {r.itop_number}</span>}
                        {r.is_assisted && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 rounded text-[10px] font-semibold uppercase">
                            {r.assisted_by_role} Assisted
                          </span>
                        )}
                              </p>
                            </div>
                          </button>
                        ))
                      ) : (
                        <div className="px-4 py-6 text-center text-xs text-gray-400 dark:text-gray-500">
                          {retailersLoading ? "Searching..." : t("sim_issue.no_retailers_found")}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <>
                {/* Step 2: Retailer Selected Preview Card */}
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-4 bg-orange-50/30 dark:bg-orange-500/5 border border-orange-200/50 dark:border-orange-500/20 rounded-2xl flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-orange-100 dark:bg-orange-500/20 text-orange-600 dark:text-orange-400 flex items-center justify-center">
                      <Store className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-900 dark:text-gray-100">
                        {selectedRetailer.name}
                        {selectedRetailer.employee_itop_number && (
                          <span className="text-orange-600 dark:text-orange-400 font-mono">
                            {' '}({selectedRetailer.employee_itop_number.slice(-3)})
                          </span>
                        )}
                      </p>
                      <p className="text-xs font-mono text-gray-500 dark:text-gray-400 mt-0.5 flex items-center gap-2">
                        <span>Code: <span className="text-orange-600 dark:text-orange-400 font-bold">{selectedRetailer.retailer_code}</span></span>
                        {selectedRetailer.itop_number && <span>• iTop: {selectedRetailer.itop_number}</span>}
                        {selectedRetailer.is_assisted && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 rounded text-[10px] font-semibold uppercase">
                            {selectedRetailer.assisted_by_role} Assisted
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedRetailer(null);
                      setRetailerSearch("");
                      setRetailers([]);
                      setInputValue("");
                      setResults([]);
                      setIssueInfo(null);
                      setSearchQuery("");
                      setStatusFilter("All");
                      setCurrentPage(1);
                    }}
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl transition-all"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </motion.div>

                {/* Step 3: Input Method and Helper Links */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05 }}
                  className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
                >
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-black text-gray-500 dark:text-gray-400 tracking-wide uppercase">
                      {t("sim_issue.input_method")}
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
                        {t("sim_issue.method_range")}
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
                        {t("sim_issue.method_list")}
                      </button>
                    </div>
                  </div>

                  <div className="flex gap-3 text-xs font-bold">
                    <button
                      type="button"
                      onClick={() => loadExample(inputMethod)}
                      disabled={loading}
                      className="text-orange-500 hover:text-orange-600 transition-colors flex items-center gap-1 border-b border-orange-500/20 hover:border-orange-600/50"
                    >
                      <Clipboard className="w-3.5 h-3.5" />
                      {"Load Example"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setInputMethod("range");
                        setInputValue("");
                        setSelectedRetailer(null);
                        setRetailerSearch("");
                        setRetailers([]);
                        setResults([]);
                        setIssueInfo(null);
                        setLogs([]);
                        setSearchQuery("");
                        setStatusFilter("All");
                        setCurrentPage(1);
                        setTimeout(() => rangeInputRef.current?.resetFromValue(""), 0);
                      }}
                      disabled={loading}
                      className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                    >
                      {t("common.reset")}
                    </button>
                  </div>
                </motion.div>

                {/* SIM Serials: Range component OR List textarea */}
                {inputMethod === "range" ? (
                  <SerialRangeInput
                    ref={rangeInputRef}
                    onChange={setInputValue}
                    disabled={loading}
                  />
                ) : (
                  <div className="relative group">
                    <textarea
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      disabled={loading}
                      rows={5}
                      placeholder={t("sim_issue.placeholder_list")}
                      className={cn(
                        "w-full px-5 py-4 border border-gray-200 dark:border-slate-800 rounded-3xl bg-gray-50/50 dark:bg-slate-800/30 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:ring-2 transition-all text-sm font-mono tracking-wider leading-relaxed resize-none",
                        parsedCount > 500
                          ? "focus:ring-red-500 border-red-300 dark:border-red-500/20"
                          : "focus:ring-orange-500"
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
                              : "bg-orange-50 text-orange-600 border-orange-100 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/20"
                        )}
                      >
                        {`Parsed: ${parsedCount} / 500`}
                      </span>
                    </div>
                  </div>
                )}

                {parsedCount > 500 && (
                  <motion.p
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="text-xs font-bold text-red-500 dark:text-red-400 flex items-center gap-1.5"
                  >
                    <AlertCircle className="w-4 h-4" />
                    {t("sim_issue.range_too_large")}
                  </motion.p>
                )}

                {/* Submit Block */}
                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={loading || parsedCount === 0 || parsedCount > 500 || !selectedHouseId || !selectedRetailer}
                    className="px-8 py-3.5 bg-gradient-to-tr from-orange-600 to-amber-500 hover:from-orange-700 hover:to-amber-600 text-white rounded-2xl text-sm font-black transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {t("sim_issue.issuing")}
                      </>
                    ) : (
                      <>
                        {t("sim_issue.issue_button")}
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
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
                  <div className="absolute inset-[-10px] rounded-full border border-orange-500/20 dark:border-orange-500/30 animate-ping" />
                  <div className="w-16 h-16 rounded-full bg-orange-500/10 dark:bg-orange-500/20 flex items-center justify-center text-orange-500">
                    <SmartphoneNfc className="w-8 h-8" />
                  </div>
                </motion.div>

                <h4 className="text-lg font-black text-gray-800 dark:text-gray-200 tracking-tight">
                  {t("sim_issue.issuing")}
                </h4>

                <div className="mt-4 w-full max-w-lg">
                  <div ref={logContainerRef} className="bg-gray-900/90 dark:bg-slate-950/90 border border-gray-700/50 dark:border-slate-800/60 rounded-2xl p-4 max-h-48 overflow-y-auto text-left shadow-2xl backdrop-blur-sm">
                    <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-700/30 dark:border-slate-800/60">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                      </span>
                      <span className="text-[10px] font-bold text-gray-500 dark:text-gray-500 uppercase tracking-widest">Live Log</span>
                    </div>
                    <div className="space-y-1.5">
                      {logs.map((log, i) => (
                        <motion.p
                          key={i}
                          initial={{ opacity: 0, x: -12 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ type: "spring", stiffness: 200, damping: 20 }}
                          className="text-[11px] font-mono leading-relaxed"
                        >
                          {log.startsWith("✅") || log.startsWith("📤") || log.startsWith("📊") || log.startsWith("📄") ? (
                            <span className="text-emerald-400">{log}</span>
                          ) : log.startsWith("❌") ? (
                            <span className="text-red-400">{log}</span>
                          ) : log.startsWith("🔍") || log.startsWith("🚀") ? (
                            <span className="text-blue-400">{log}</span>
                          ) : log.startsWith("⚠️") ? (
                            <span className="text-amber-400">{log}</span>
                          ) : (
                            <span className="text-gray-300 dark:text-gray-400">{log}</span>
                          )}
                        </motion.p>
                      ))}
                      {logs.length === 0 && (
                        <p className="text-[11px] font-mono text-gray-500 animate-pulse">
                          <span className="text-emerald-400">$</span> Initializing automation...
                        </p>
                      )}
                      <p className="text-[11px] font-mono text-gray-600 animate-pulse">
                        <span className="text-gray-600">_</span>
                      </p>
                    </div>
                  </div>
                </div>

                <motion.span
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                  className="mt-8 text-xs font-black text-orange-600 bg-orange-50 dark:text-orange-400 dark:bg-orange-500/10 border border-orange-100 dark:border-orange-500/20 px-3.5 py-1.5 rounded-full flex items-center gap-1.5"
                >
                  <Activity className="w-3.5 h-3.5" />
                  {`Time Elapsed: ${elapsedTime}s`}
                </motion.span>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Results Section */}
        {issueInfo && (
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
                <Database className="w-5 h-5 text-orange-500" />
                {t("sim_issue.results_title")}
                <span className="text-xs font-bold text-gray-500 dark:text-gray-400 font-mono">
                  ({issueInfo?.retailerName} - {issueInfo?.retailerCode})
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

            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                {
                  key: "All" as const,
                  label: t("sim_issue.total"),
                  value: stats.total,
                  icon: SmartphoneNfc,
                  activeColor: "border-orange-500 dark:border-orange-400 ring-2 ring-orange-500/20",
                  iconColor: "text-gray-300 dark:text-gray-700 group-hover:text-orange-500",
                  valueColor: "text-gray-800 dark:text-gray-100",
                  percentColor: "text-gray-400"
                },
                {
                  key: "Success" as const,
                  label: t("sim_issue.success"),
                  value: stats.success,
                  icon: ShieldCheck,
                  activeColor: "border-green-500 dark:border-green-400 ring-2 ring-green-500/20",
                  iconColor: "text-green-300 dark:text-green-950 group-hover:text-green-500",
                  valueColor: "text-green-600 dark:text-green-400",
                  percentColor: "text-green-500"
                },
                {
                  key: "Skipped" as const,
                  label: t("sim_issue.skipped"),
                  value: stats.skipped,
                  icon: Tag,
                  activeColor: "border-amber-500 dark:border-amber-400 ring-2 ring-amber-500/20",
                  iconColor: "text-amber-300 dark:text-amber-950 group-hover:text-amber-500",
                  valueColor: "text-amber-600 dark:text-amber-400",
                  percentColor: "text-amber-500"
                },
                {
                  key: "Failed" as const,
                  label: t("sim_issue.failed"),
                  value: stats.failed,
                  icon: AlertTriangle,
                  activeColor: "border-red-500 dark:border-red-400 ring-2 ring-red-500/20",
                  iconColor: "text-red-300 dark:text-red-950 group-hover:text-red-500",
                  valueColor: "text-red-600 dark:text-red-400",
                  percentColor: "text-red-500"
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
                    statusFilter === card.key
                      ? card.activeColor
                      : "border-gray-100 dark:border-slate-800 hover:border-gray-300 dark:hover:border-slate-700"
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
                    placeholder={"Search serial or message..."}
                    className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700/60 rounded-2xl text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-orange-500 transition-all font-medium"
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
                        {t("sim_issue.table_serial")}
                      </th>
                      <th className="px-6 py-4 text-xs font-black text-gray-500 dark:text-gray-400 tracking-wider uppercase">
                        {t("sim_issue.table_status")}
                      </th>
                      <th className="px-6 py-4 text-xs font-black text-gray-500 dark:text-gray-400 tracking-wider uppercase">
                        {t("sim_issue.table_message")}
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
                        <td className="px-6 py-4">{getStatusBadge(row.status)}</td>
                        <td className="px-6 py-4 text-xs text-gray-500 dark:text-gray-400">{row.message || "-"}</td>
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
                    {t("sim_issue.confirm_title")}
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                    {t("sim_issue.confirm_desc")
                      .replace("{count}", String(parsedCount))
                      .replace("{retailer}", `${selectedRetailer?.name} (${selectedRetailer?.retailer_code})`)}
                  </p>

                  <div className="flex gap-3 w-full">
                    <button
                      onClick={() => setShowConfirm(false)}
                      className="flex-1 px-5 py-3 border border-gray-200 dark:border-slate-700 rounded-2xl text-sm font-black text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
                    >
                      {t("sim_issue.confirm_no")}
                    </button>
                    <button
                      onClick={confirmIssue}
                      className="flex-1 px-5 py-3 bg-gradient-to-tr from-orange-600 to-amber-500 hover:from-orange-700 hover:to-amber-600 text-white rounded-2xl text-sm font-black transition-all shadow-lg shadow-orange-200 dark:shadow-none"
                    >
                      {t("sim_issue.confirm_yes")}
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
