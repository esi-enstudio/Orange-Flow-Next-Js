"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import apiClient from "@/lib/api";
import { useAuth } from "./AuthContext";

export type MaintenancePhase = "off" | "grace" | "enforced";

export interface MaintenanceStatus {
  enabled: boolean;
  phase: MaintenancePhase;
  message: string | null;
  grace_minutes: number;
  grace_until: string | null;
  server_now: string | null;
}

interface MaintenanceContextType {
  /** Last known server status (or localStorage fallback). */
  status: MaintenanceStatus;
  /** Effective phase: the grace deadline is applied locally so the UI flips to
   *  "enforced" at exactly 00:00 even if a poll response is stale. */
  phase: MaintenancePhase;
  /** Milliseconds left until enforcement (null unless in grace). */
  msLeft: number | null;
  /** Formatted mm:ss (or h:mm:ss) countdown, null unless in grace. */
  timeLeft: string | null;
  graceEndLocal: number | null;
  isSuperAdmin: boolean;
  /** True once the first status fetch attempt has settled (success or error).
   *  Pages must wait for this before redirecting on a "phase === off" value. */
  initialized: boolean;
  refresh: () => Promise<void>;
}

const STORAGE_KEY = "maintenance_status_v1";
const OFF_STATUS: MaintenanceStatus = {
  enabled: false,
  phase: "off",
  message: null,
  grace_minutes: 10,
  grace_until: null,
  server_now: null,
};

const MaintenanceContext = createContext<MaintenanceContextType | undefined>(
  undefined
);

function isValidStatus(value: unknown): value is MaintenanceStatus {
  if (!value || typeof value !== "object") return false;
  const s = value as Partial<MaintenanceStatus>;
  return (
    typeof s.enabled === "boolean" &&
    (s.phase === "off" || s.phase === "grace" || s.phase === "enforced")
  );
}

function readStoredStatus(): { status: MaintenanceStatus; fetchedAt: number } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isValidStatus(parsed?.status) || typeof parsed?.fetchedAt !== "number") {
      return null;
    }
    return { status: parsed.status, fetchedAt: parsed.fetchedAt };
  } catch {
    return null;
  }
}

/** Format a remaining-ms value as a countdown clock. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

export function MaintenanceProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [status, setStatus] = useState<MaintenanceStatus>(OFF_STATUS);
  const [graceEndLocal, setGraceEndLocal] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [initialized, setInitialized] = useState(false);

  const isSuperAdmin = useMemo(() => {
    if (!user?.roles) return false;
    return user.roles.some((r) => {
      const name = (r?.name || "").toLowerCase();
      return name === "super admin" || name === "super_admin";
    });
  }, [user]);

  const applyStatus = useCallback(
    (next: MaintenanceStatus, receivedAt: number) => {
      setStatus(next);
      if (next.phase === "grace" && next.grace_until && next.server_now) {
        // Translate the server deadline onto the local clock so a skewed
        // client clock cannot desynchronize the countdown.
        const remaining =
          Date.parse(next.grace_until) - Date.parse(next.server_now);
        setGraceEndLocal(
          Number.isFinite(remaining) ? receivedAt + remaining : null
        );
      } else {
        setGraceEndLocal(null);
      }
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ status: next, fetchedAt: receivedAt })
        );
      } catch {
        // storage full / private mode — the in-memory state still works
      }
    },
    []
  );

  const refresh = useCallback(async () => {
    try {
      const res = await apiClient.get("settings/maintenance");
      const data = res.data as MaintenanceStatus;
      if (isValidStatus(data)) {
        applyStatus(data, Date.now());
      }
    } catch {
      // Backend unreachable — keep the last known state (localStorage is
      // seeded on mount below). Fail-open by design.
    } finally {
      setInitialized(true);
    }
  }, [applyStatus]);

  // Seed from localStorage after mount (avoids SSR hydration mismatch), then
  // fetch the authoritative status.
  useEffect(() => {
    const stored = readStoredStatus();
    if (stored) {
      setStatus(stored.status);
      if (
        stored.status.phase === "grace" &&
        stored.status.grace_until &&
        stored.status.server_now
      ) {
        const remaining =
          Date.parse(stored.status.grace_until) -
          Date.parse(stored.status.server_now);
        setGraceEndLocal(
          Number.isFinite(remaining) ? stored.fetchedAt + remaining : null
        );
      }
    }
    refresh();
  }, [refresh]);

  // Effective phase: flips to "enforced" locally the moment the deadline hits.
  const phase: MaintenancePhase = useMemo(() => {
    if (
      status.phase === "grace" &&
      graceEndLocal !== null &&
      now >= graceEndLocal
    ) {
      return "enforced";
    }
    return status.phase;
  }, [status.phase, graceEndLocal, now]);

  // Poll: fast while something is happening, slow when off.
  useEffect(() => {
    const intervalMs = status.phase === "off" ? 20_000 : 10_000;
    const id = window.setInterval(refresh, intervalMs);
    return () => window.clearInterval(id);
  }, [status.phase, refresh]);

  // 1s ticker while a countdown matters.
  useEffect(() => {
    if (status.phase === "off") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [status.phase]);

  const msLeft = useMemo(() => {
    if (phase !== "grace" || graceEndLocal === null) return null;
    return Math.max(0, graceEndLocal - now);
  }, [phase, graceEndLocal, now]);

  const timeLeft = msLeft !== null ? formatCountdown(msLeft) : null;

  const value = useMemo<MaintenanceContextType>(
    () => ({
      status,
      phase,
      msLeft,
      timeLeft,
      graceEndLocal,
      isSuperAdmin,
      initialized,
      refresh,
    }),
    [status, phase, msLeft, timeLeft, graceEndLocal, isSuperAdmin, initialized, refresh]
  );

  return (
    <MaintenanceContext.Provider value={value}>
      {children}
    </MaintenanceContext.Provider>
  );
}

export function useMaintenance() {
  const context = useContext(MaintenanceContext);
  if (context === undefined) {
    throw new Error("useMaintenance must be used within a MaintenanceProvider");
  }
  return context;
}

/** True when maintenance is enforced and this session is not a Super Admin. */
export function useMaintenanceGate() {
  const { phase, isSuperAdmin } = useMaintenance();
  const { loading: authLoading } = useAuth();
  return phase === "enforced" && !authLoading && !isSuperAdmin;
}
