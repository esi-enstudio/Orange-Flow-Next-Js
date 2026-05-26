"use client";

import { useAuth } from "@/context/AuthContext";
import { ChevronDown, Check, Building2, MapPin, Store } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import apiClient from "@/lib/api";

export function HouseSelector() {
  const { user, selectedHouse, setSelectedHouse } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [allHouses, setAllHouses] = useState<any[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isAdmin = anyAdmin();
  function anyAdmin() {
    if (!user || !user.roles) return false;
    return user.roles.some(role => 
      ["admin", "super admin", "super_admin"].includes(role.name.toLowerCase())
    );
  }

  const userHouses = user?.houses || [];
  const displayHouses = userHouses.length > 0 ? userHouses : allHouses;

  useEffect(() => {
    if (isAdmin && userHouses.length === 0) {
      const fetchAllHouses = async () => {
        try {
          const res = await apiClient.get("/houses");
          setAllHouses(res.data);
          if (!selectedHouse && res.data.length > 0) setSelectedHouse(res.data[0]);
        } catch (err) {
          console.error("Failed to fetch houses", err);
        }
      };
      fetchAllHouses();
    }
  }, [isAdmin, userHouses.length, selectedHouse, setSelectedHouse]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (displayHouses.length === 0 && !isAdmin) return null;

  return (
    <div className="relative w-full" ref={dropdownRef}>
      {/* Trigger Button - Compact & Elegant */}
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl transition-all border duration-300",
          isOpen 
            ? "bg-white dark:bg-slate-900 border-orange-500 shadow-sm shadow-orange-100 dark:shadow-none" 
            : "bg-gray-50/50 dark:bg-slate-800/40 border-transparent hover:border-gray-200 dark:hover:border-slate-700"
        )}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors",
            selectedHouse ? "bg-orange-500 text-white" : "bg-gray-200 dark:bg-slate-700 text-gray-500"
          )}>
            <Building2 className="w-4 h-4" />
          </div>
          <div className="text-left min-w-0">
            <p className="text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-tighter leading-none mb-0.5">Distribution</p>
            <p className="text-xs font-bold text-gray-800 dark:text-gray-200 truncate leading-tight">
              {selectedHouse?.name || "Select House"}
            </p>
          </div>
        </div>
        <ChevronDown className={cn(
          "w-3.5 h-3.5 text-gray-400 transition-transform duration-300 shrink-0", 
          isOpen && "rotate-180 text-orange-500"
        )} />
      </button>

      {/* Dropdown - Refined & Elegant */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-slate-900 rounded-2xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.15)] dark:shadow-none border border-gray-100 dark:border-slate-800 overflow-hidden z-[100] animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="p-3 border-b border-gray-50 dark:border-slate-800 bg-gray-50/30 dark:bg-slate-800/30">
            <h4 className="text-[10px] font-black text-gray-400 dark:text-gray-500 uppercase tracking-widest">Available Houses</h4>
          </div>
          
          <div className="max-h-[280px] overflow-y-auto p-1.5 space-y-0.5 scrollbar-hide">
            {displayHouses.length === 0 ? (
              <div className="p-6 text-center text-gray-400">
                <MapPin className="w-5 h-5 mx-auto mb-2 opacity-20" />
                <p className="text-[10px] font-bold uppercase tracking-widest">No Context Found</p>
              </div>
            ) : (
              displayHouses.map((house) => (
                <button
                  key={house.id}
                  onClick={() => {
                    setSelectedHouse(house);
                    setIsOpen(false);
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all group",
                    selectedHouse?.id === house.id 
                      ? "bg-orange-50 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400 font-bold" 
                      : "hover:bg-gray-50 dark:hover:bg-slate-800 text-gray-600 dark:text-gray-400"
                  )}
                >
                  <div className={cn(
                    "w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors",
                    selectedHouse?.id === house.id 
                      ? "bg-orange-500 text-white" 
                      : "bg-gray-100 dark:bg-slate-700 group-hover:bg-orange-100 dark:group-hover:bg-orange-500/20"
                  )}>
                    <Store className={cn(
                      "w-3.5 h-3.5",
                      selectedHouse?.id === house.id ? "text-white" : "text-gray-400 group-hover:text-orange-500"
                    )} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs truncate">{house.name}</span>
                      {selectedHouse?.id === house.id && <Check className="w-3 h-3 shrink-0" />}
                    </div>
                    <span className="text-[9px] font-mono opacity-50 block mt-0.5 uppercase tracking-tighter">
                      {house.code}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
