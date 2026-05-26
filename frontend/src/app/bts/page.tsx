"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import {
  Search,
 
  MapPin, 
  Wifi, 
  Signal, 
  MoreVertical,
  ChevronLeft,
  ChevronRight,
  Database,
  Plus
} from "lucide-react";
import { cn } from "@/lib/utils";

interface BTS {
  id: number;
  bts_code: string;
  site_id: string;
  thana: string;
  site_type: string;
}

export default function BTSPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const router = useRouter();
  const [btsList, setBtsList] = useState<BTS[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const limit = 12;

  // Permission Check
  useEffect(() => {
    if (!authLoading && !hasPermission("view_bts")) {
      router.push("/");
    }
  }, [authLoading, hasPermission, router]);

  const fetchBTS = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get("/bts", {
        params: {
          search,
          skip: page * limit,
          limit
        }
      });
      setBtsList(response.data);
    } catch (err) {
      console.error("Failed to fetch BTS", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      fetchBTS();
    }, 500);
    return () => clearTimeout(delayDebounceFn);
  }, [search, page]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 transition-colors">BTS Management</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 transition-colors">Monitor base stations and coverage areas.</p>
        </div>
        <button className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-medium hover:bg-orange-700 transition-colors shadow-sm shadow-orange-100 dark:shadow-none">
          <Plus className="w-4 h-4" />
          Add Station
        </button>
      </div>

      {/* Search Bar */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500 transition-colors" />
        <input 
          type="text" 
          placeholder="Search by name or site code..." 
          className="w-full pl-10 pr-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl text-sm focus:ring-2 focus:ring-orange-500 transition-all outline-none dark:text-gray-100"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
      </div>

      {/* BTS Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
            <div key={i} className="h-48 bg-gray-100 dark:bg-slate-900 rounded-2xl animate-pulse"></div>
          ))}
        </div>
      ) : btsList.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-gray-300 dark:border-slate-800 p-20 text-center transition-colors">
          <Database className="w-12 h-12 text-gray-300 dark:text-gray-700 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">No stations found</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Try adjusting your search or filters.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {btsList.map((bts) => (
            <div key={bts.id} className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-gray-100 dark:border-slate-800 shadow-sm hover:shadow-md dark:hover:shadow-orange-500/5 transition-all group duration-300">
              <div className="flex justify-between items-start mb-4">
                <div className="w-12 h-12 bg-orange-50 dark:bg-orange-500/10 rounded-xl flex items-center justify-center text-orange-600 dark:text-orange-400 group-hover:bg-orange-600 group-hover:text-white transition-colors duration-300">
                  <Signal className="w-6 h-6" />
                </div>
                <button className="p-1.5 text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-slate-800 rounded-lg transition-colors">
                  <MoreVertical className="w-4 h-4" />
                </button>
              </div>
              
              <h3 className="font-bold text-gray-900 dark:text-gray-100 group-hover:text-orange-600 dark:group-hover:text-orange-400 transition-colors duration-300">{bts.site_id}</h3>
              <p className="text-xs font-mono text-gray-500 dark:text-gray-400 mt-1 bg-gray-50 dark:bg-slate-800 inline-block px-1.5 py-0.5 rounded transition-colors">
                {bts.bts_code}
              </p>
              
              <div className="mt-6 pt-4 border-t border-gray-50 dark:border-slate-800 space-y-3 transition-colors">
                <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" />
                    {bts.thana || "N/A"}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Wifi className="w-3.5 h-3.5" />
                    {bts.site_type || "Macro"}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/10 px-2 py-0.5 rounded-full transition-colors">ONLINE</span>
                  <button className="text-[10px] font-bold text-orange-600 dark:text-orange-400 hover:underline">DETAILS</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {!loading && btsList.length > 0 && (
        <div className="flex items-center justify-center gap-4 mt-8">
          <button 
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="flex items-center gap-1 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-all duration-200"
          >
            <ChevronLeft className="w-4 h-4" />
            Prev
          </button>
          <span className="text-sm font-bold text-gray-900 dark:text-gray-100">Page {page + 1}</span>
          <button 
            onClick={() => setPage(p => p + 1)}
            disabled={btsList.length < limit}
            className="flex items-center gap-1 px-4 py-2 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 transition-all duration-200"
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
