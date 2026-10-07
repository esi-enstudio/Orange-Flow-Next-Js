"use client";

import { useMaintenanceGate } from "@/context/MaintenanceContext";
import { MaintenanceScreen } from "@/components/MaintenanceScreen";

/**
 * Replaces the entire app shell (entitlements, sidebar, page content) with the
 * maintenance screen while maintenance is enforced and the session is not a
 * Super Admin. Server-side proxy redirects handle the initial document load;
 * this gate covers client-side navigation and the grace→enforced flip.
 */
export function MaintenanceGate({ children }: { children: React.ReactNode }) {
  const gated = useMaintenanceGate();
  if (gated) return <MaintenanceScreen standalone />;
  return <>{children}</>;
}
