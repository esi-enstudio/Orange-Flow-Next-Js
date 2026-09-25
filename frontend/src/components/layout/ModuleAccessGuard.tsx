"use client";

import { usePathname } from "next/navigation";
import { useEntitlements } from "@/context/EntitlementsContext";
import { useAuth } from "@/context/AuthContext";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { moduleForKeyPath, isAlwaysReachable } from "@/lib/planModules";

/**
 * Blocks a page when the active house is on a strict plan that does not include
 * the module (or the specific page) owning the current route. Mirrors the
 * backend PlanModuleGuard; base/always-reachable modules and admins always
 * pass. Fails open while the entitlements are unknown/loading.
 */
export function ModuleAccessGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { hasPage } = useEntitlements();
  const { user, loading } = useAuth();

  // Skip gating while auth/entitlements are still loading (fail-open), for
  // unauthenticated users (public pages/redirects handled by AuthProvider),
  // and for routes with no owning module (profile, admin-only pages, etc.).
  const shouldGate = !loading && !!user;
  const moduleKey = shouldGate ? moduleForKeyPath(pathname) : null;

  if (moduleKey && !isAlwaysReachable(moduleKey) && !hasPage(pathname)) {
    return <AccessDenied />;
  }

  return <>{children}</>;
}