"use client";
import { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from "react";
import apiClient from "@/lib/api";
import type { Entitlements, HouseAccessBlock, HouseAccessCode } from "@/types/billing";
import { BASE_MODULES, isAlwaysReachable, leafForRoute, leafEnabledForKey, moduleEnabledForKeys, moduleForKeyPath } from "@/lib/planModules";
import { useAuth } from "./AuthContext";

interface EntitlementsContextType {
  entitlements: Entitlements | null;
  loading: boolean;
  /** null = unrestricted (legacy/no strict plan). Set = strict module access. */
  allowedModules: Set<string> | null;
  /** True when the active house's plan enforces explicit module access. */
  moduleGated: boolean;
  /** Whether the caller may use a given top-level module under the current plan. */
  hasModule: (key: string) => boolean;
  /** Whether a given page route (nav leaf) is allowed under the plan. */
  hasPage: (path: string) => boolean;
  /**
   * Non-null when the active house is blocked from the product entirely:
   * no plan assigned, plan expired, or house deactivated. Mirrors the backend
   * `PlanModuleGuard` so the UI explains the block on page load instead of
   * waiting for a 403.
   */
  accessBlock: HouseAccessBlock | null;
  refresh: () => Promise<void>;
}

const EntitlementsContext = createContext<EntitlementsContextType | undefined>(undefined);

// Only the platform super admin bypasses plan module/page gating. A tenant
// "admin"/"manager" is still bound by the plan they bought — matching the
// backend `PlanModuleGuard`, so the UI never offers a module the API will 403.
const SUPER_ADMIN_ROLE_NAME = new Set(["super admin", "super_admin"]);

function isSuperAdminUser(user: { roles?: { name: string }[] } | null): boolean {
  return !!user?.roles?.some((r) => SUPER_ADMIN_ROLE_NAME.has(r.name.toLowerCase()));
}

export function EntitlementsProvider({ children }: { children: ReactNode }) {
  const { user, selectedHouse, loading: authLoading } = useAuth();
  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [loading, setLoading] = useState(!authLoading);

  const refresh = useCallback(async () => {
    if (!user || authLoading) return;
    setLoading(true);
    try {
      const headers: Record<string, string> = {};
      if (selectedHouse) headers["X-House-ID"] = String(selectedHouse.id);
      const res = await apiClient.get("v1/subscription/entitlements", { headers });
      setEntitlements(res.data);
    } catch {
      // Fail-open on fetch errors: treat as unrestricted so the UI never
      // locks a user out because of a transient entitlement fetch failure.
      setEntitlements(null);
    } finally {
      setLoading(false);
    }
  }, [user, authLoading, selectedHouse]);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    (async () => {
      try {
        const headers: Record<string, string> = {};
        if (selectedHouse) headers["X-House-ID"] = String(selectedHouse.id);
        const res = await apiClient.get("v1/subscription/entitlements", { headers });
        if (!cancelled) setEntitlements(res.data);
      } catch {
        if (!cancelled) setEntitlements(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, authLoading, selectedHouse]);

  const moduleGated = useMemo(() => !!entitlements?.module_gated, [entitlements]);
  const allowedModules = useMemo(
    () => (moduleGated && entitlements?.allowed_modules ? new Set(entitlements.allowed_modules) : null),
    [moduleGated, entitlements]
  );

  // Deny-by-default house access. The backend is authoritative; this is the
  // same answer delivered proactively so the UI can gate on load.
  const accessBlock = useMemo<HouseAccessBlock | null>(() => {
    if (!entitlements || entitlements.access_allowed !== false) return null;
    if (!entitlements.access_code) return null;
    return {
      code: entitlements.access_code as HouseAccessCode,
      houseId: entitlements.house_id ?? null,
      houseName: entitlements.house_name ?? null,
      houseCode: entitlements.house_code ?? null,
      planName: entitlements.plan_name ?? null,
      planStatus: entitlements.plan_status ?? null,
      planEndDate: entitlements.plan_end_date ?? null,
      daysRemaining: entitlements.days_remaining ?? null,
      action: entitlements.access_action ?? null,
      message: entitlements.access_message ?? null,
    };
  }, [entitlements]);

  const hasModule = useCallback(
    (key: string): boolean => {
      if (isSuperAdminUser(user)) return true;
      if (!moduleGated || allowedModules === null) return true;
      return moduleEnabledForKeys(key, allowedModules);
    },
    [user, moduleGated, allowedModules]
  );

  const hasPage = useCallback(
    (path: string): boolean => {
      if (isSuperAdminUser(user)) return true;
      if (!moduleGated || allowedModules === null) return true;
      const moduleKey = moduleForKeyPath(path);
      if (!moduleKey || BASE_MODULES.has(moduleKey) || isAlwaysReachable(moduleKey)) return true;
      if (allowedModules.has(moduleKey)) return true;
      const leaf = leafForRoute(path);
      if (!leaf) return true;
      return leafEnabledForKey(leaf, allowedModules);
    },
    [user, moduleGated, allowedModules]
  );

  return (
    <EntitlementsContext.Provider
      value={{
        entitlements,
        loading,
        allowedModules,
        moduleGated,
        hasModule,
        hasPage,
        accessBlock,
        refresh,
      }}
    >
      {children}
    </EntitlementsContext.Provider>
  );
}

export function useEntitlements() {
  const context = useContext(EntitlementsContext);
  if (context === undefined) {
    throw new Error("useEntitlements must be used within an EntitlementsProvider");
  }
  return context;
}