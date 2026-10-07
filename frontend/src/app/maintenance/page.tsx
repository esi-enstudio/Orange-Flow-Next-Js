"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { MaintenanceScreen } from "@/components/MaintenanceScreen";
import { useMaintenance } from "@/context/MaintenanceContext";

/**
 * Standalone maintenance page. Reachable directly (and served by the Next
 * proxy for non-Super-Admin sessions during enforcement). Redirects away when
 * maintenance is off, or when a Super Admin visits (they keep full access).
 */
export default function MaintenancePage() {
  const router = useRouter();
  const { phase, isSuperAdmin, initialized } = useMaintenance();

  useEffect(() => {
    if (!initialized) return;
    if (phase === "off" || (phase === "enforced" && isSuperAdmin)) {
      router.replace("/");
    }
  }, [initialized, phase, isSuperAdmin, router]);

  return <MaintenanceScreen standalone />;
}
