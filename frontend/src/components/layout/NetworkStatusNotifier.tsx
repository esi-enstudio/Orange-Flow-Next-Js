"use client";

import { useEffect } from "react";
import toast from "react-hot-toast";
import { useLanguage } from "@/i18n/useLanguage";

export function NetworkStatusNotifier() {
  const { t } = useLanguage();

  useEffect(() => {
    const handleOffline = () => {
      toast.error(t("common.network_offline"), { id: "network-status" });
    };
    const handleOnline = () => {
      toast.success(t("common.network_online"), { id: "network-status" });
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [t]);

  return null;
}
