"use client";

import { useCallback, useEffect, useState } from "react";
import apiClient from "@/lib/api";

export type HouseConnectionStatus =
  | "connected"
  | "disconnected"
  | "ready"
  | "not_configured"
  | "error";

export interface HouseConnectionState {
  provider: "whatsapp" | "telegram" | "gmail";
  connected: boolean;
  status: HouseConnectionStatus;
  account: string | null;
  detail: string | null;
  reference: string | null;
  last_connected_at: string | null;
  error: string | null;
  used_for: string[];
  available: boolean;
}

export function useHouseConnections(houseId: number | null) {
  const [data, setData] = useState<HouseConnectionState[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    if (!houseId) {
      setData(null);
      setLoading(false);
      setError(false);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      const res = await apiClient.get("/connections", {
        headers: { "X-House-ID": String(houseId) },
      });
      setData(res.data?.data ?? []);
    } catch {
      setData(null);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [houseId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, refresh: load };
}
