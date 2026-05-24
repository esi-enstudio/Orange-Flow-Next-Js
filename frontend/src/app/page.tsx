"use client";

import { useEffect, useState } from "react";
import WebApp from "@twa-dev/sdk";

interface Retailer {
  id: number;
  name: string;
  retailer_code: string;
  itop_number: string;
  thana: string;
  contact_no: string;
}

export default function Home() {
  const [retailers, setRetailers] = useState<Retailer[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Initialize Telegram Web App
    if (typeof window !== "undefined") {
      WebApp.ready();
      WebApp.expand();
      
      // Set theme-based colors if available
      document.documentElement.style.setProperty('--tg-theme-bg-color', WebApp.backgroundColor || '#ffffff');
      document.documentElement.style.setProperty('--tg-theme-text-color', WebApp.textColor || '#000000');
      document.documentElement.style.setProperty('--tg-theme-hint-color', WebApp.hintColor || '#999999');
      document.documentElement.style.setProperty('--tg-theme-link-color', WebApp.linkColor || '#2481cc');
      document.documentElement.style.setProperty('--tg-theme-button-color', WebApp.buttonColor || '#2481cc');
      document.documentElement.style.setProperty('--tg-theme-button-text-color', WebApp.buttonTextColor || '#ffffff');
    }

    fetchRetailers();
  }, []);

  const fetchRetailers = async (query = "") => {
    setLoading(true);
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";
      const url = query 
        ? `${baseUrl}/retailers?search=${encodeURIComponent(query)}` 
        : `${baseUrl}/retailers`;
      
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch retailers");
      const data = await response.json();
      setRetailers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchRetailers(search);
  };

  return (
    <main className="min-h-screen bg-[var(--tg-theme-secondary-bg-color,#f4f4f5)] text-[var(--tg-theme-text-color,#000000)] p-4 font-sans">
      {/* Header */}
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--tg-theme-text-color,#000000)]">
          OrangeFlow <span className="text-orange-500 text-sm font-normal">Management</span>
        </h1>
        <p className="text-sm text-[var(--tg-theme-hint-color,#71717a)] mt-1">
          Retailer Database Dashboard
        </p>
      </header>

      {/* Search Bar */}
      <form onSubmit={handleSearch} className="mb-6">
        <div className="relative">
          <input
            type="text"
            placeholder="Search by name or code..."
            className="w-full p-3 pl-4 rounded-xl border-none bg-[var(--tg-theme-bg-color,#ffffff)] shadow-sm focus:ring-2 focus:ring-orange-500 transition-all text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button 
            type="submit"
            className="absolute right-2 top-1.5 bg-orange-500 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-orange-600 transition-colors"
          >
            Search
          </button>
        </div>
      </form>

      {/* Retailer List */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--tg-theme-hint-color,#71717a)] px-1">
          Retailers ({retailers.length})
        </h2>

        {loading ? (
          <div className="flex justify-center py-10">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500"></div>
          </div>
        ) : error ? (
          <div className="bg-red-50 text-red-600 p-4 rounded-xl text-center text-sm">
            {error}
          </div>
        ) : retailers.length === 0 ? (
          <div className="bg-[var(--tg-theme-bg-color,#ffffff)] p-8 rounded-xl text-center shadow-sm">
            <p className="text-[var(--tg-theme-hint-color,#71717a)] text-sm">No retailers found.</p>
          </div>
        ) : (
          retailers.map((retailer) => (
            <div 
              key={retailer.id} 
              className="bg-[var(--tg-theme-bg-color,#ffffff)] p-4 rounded-xl shadow-sm border border-transparent hover:border-orange-200 transition-all group"
            >
              <div className="flex justify-between items-start mb-2">
                <h3 className="font-bold text-base group-hover:text-orange-600 transition-colors">
                  {retailer.name}
                </h3>
                <span className="bg-orange-100 text-orange-700 text-[10px] px-2 py-0.5 rounded-full font-bold">
                  {retailer.retailer_code}
                </span>
              </div>
              
              <div className="grid grid-cols-2 gap-y-2 text-xs text-[var(--tg-theme-hint-color,#71717a)]">
                <div className="flex items-center gap-1.5">
                  <span className="opacity-60">iTop:</span>
                  <span className="font-medium text-[var(--tg-theme-text-color,#000000)]">
                    {retailer.itop_number || "N/A"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="opacity-60">Phone:</span>
                  <span className="font-medium text-[var(--tg-theme-text-color,#000000)]">
                    {retailer.contact_no || "N/A"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 col-span-2 border-t border-gray-50 pt-2 mt-1">
                  <span className="opacity-60">Thana:</span>
                  <span className="font-medium text-[var(--tg-theme-text-color,#000000)]">
                    {retailer.thana || "N/A"}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </section>

      {/* Bottom Padding for Telegram UI */}
      <div className="h-10"></div>
    </main>
  );
}
