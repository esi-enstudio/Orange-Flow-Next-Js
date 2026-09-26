"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { Loader2, Calculator } from "lucide-react";
import CommissionDashboard from "./components/CommissionDashboard";
import type { CommissionFilterState } from "@/types/commission";
import { DEFAULT_FILTER_STATE } from "@/types/commission";

export default function CommissionPage() {
  const { loading: authLoading, hasPermission } = useAuth();
  const [filters, setFilters] = useState<CommissionFilterState>(DEFAULT_FILTER_STATE);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  if (!hasPermission("commission.view")) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-gray-500">You do not have permission to view this module.</p>
      </div>
    );
  }

  return <CommissionDashboard filters={filters} onFiltersChange={setFilters} />;
}
