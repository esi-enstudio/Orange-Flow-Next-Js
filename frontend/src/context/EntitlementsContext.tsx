"use client";
import { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from "react";
import apiClient from "@/lib/api";
import type { Entitlements } from "@/types/billing";
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
  refresh: () => Promise<void>;
}

const EntitlementsContext = createContext<EntitlementsContextType | undefined>(undefined);

const ADMIN_ROLE_NAME = new Set(["admin", "super admin", "super_admin"]);

function isAdminUser(user: { roles?: { name: string }[] } | null): boolean {
  return !!user?.roles?.some((r) => ADMIN_ROLE_NAME.has(r.name.toLowerCase()));
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

  const hasModule = useCallback(
    (key: string): boolean => {
      if (isAdminUser(user)) return true;
      if (!moduleGated || allowedModules === null) return true;
      return moduleEnabledForKeys(key, allowedModules);
    },
    [user, moduleGated, allowedModules]
  );

  const hasPage = useCallback(
    (path: string): boolean => {
      if (isAdminUser(user)) return true;
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