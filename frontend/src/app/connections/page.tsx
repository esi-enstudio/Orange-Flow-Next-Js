"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { ChevronRight, Home, Plug, RefreshCw } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import { toast } from "react-hot-toast";
import { AccessDenied } from "@/components/ui/AccessDenied";
import PageGuideModal from "@/components/PageGuideModal";
import { useHouseConnections } from "@/hooks/useHouseConnections";
import { CONNECTION_PROVIDERS } from "@/lib/connectionProviders";
import { ProviderCard } from "./_components/ProviderCard";
import { WhatsAppCard } from "./_components/WhatsAppCard";
import { TelegramCard } from "./_components/TelegramCard";
import { GmailCard } from "./_components/GmailCard";

export default function ConnectionsPage() {
  const { hasPermission, loading: authLoading, selectedHouse, user } = useAuth();
  const { t } = useLanguage();
  const availableHouses = useMemo(
    () => user?.houses ?? [],
    [user?.houses]
  );
  const houseId =
    selectedHouse && availableHouses.some((house) => house.id === selectedHouse.id)
      ? selectedHouse.id
      : availableHouses.length === 1
        ? availableHouses[0].id
        : null;
  const { data, loading, error, refresh } = useHouseConnections(houseId);
  const [refreshing, setRefreshing] = useState(false);

  const canView = hasPermission("connections.view");

  useEffect(() => {
    if (!houseId) return;
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("automation");
    if (!outcome) return;
    if (outcome === "gmail_connected") {
      toast.success(t("connectionsPage.gmail.connected_success"));
    } else if (outcome === "gmail_error") {
      toast.error(t("connectionsPage.gmail.connect_error"));
    }
    params.delete("automation");
    const query = params.toString();
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`
    );
  }, [houseId, t]);

  if (!authLoading && !canView) return <AccessDenied />;

  const refreshAll = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  const stateFor = (provider: keyof typeof CONNECTION_PROVIDERS) =>
    data?.find((item) => item.provider === provider);

  const cardSkeleton = (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Object.keys(CONNECTION_PROVIDERS).map((provider) => (
        <ProviderCard
          key={provider}
          presentation={CONNECTION_PROVIDERS[provider as keyof typeof CONNECTION_PROVIDERS]}
          loading
        />
      ))}
    </div>
  );

  return (
    <main className="mx-auto min-h-screen max-w-[1600px] min-w-0 p-2 pb-8 sm:px-6 sm:pb-8 sm:pt-2">
      <header className="mb-4 border-b border-gray-200 pb-4 dark:border-slate-700">
        <nav aria-label={t("connectionsPage.breadcrumb_label")} className="-mt-2 mb-4 text-[13px]">
          <ol className="flex flex-wrap items-center gap-1.5 text-gray-500 dark:text-gray-400">
            <li>
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 transition-colors hover:text-gray-700 dark:hover:text-gray-200"
              >
                <Home aria-hidden="true" className="size-4" />
                {t("connectionsPage.breadcrumb_home")}
              </Link>
            </li>
            <li aria-hidden="true">
              <ChevronRight className="size-3.5" />
            </li>
            <li>{t("connectionsPage.breadcrumb_section")}</li>
            <li aria-hidden="true">
              <ChevronRight className="size-3.5" />
            </li>
            <li aria-current="page" className="font-medium text-gray-700 dark:text-gray-300">
              {t("connectionsPage.title")}
            </li>
          </ol>
        </nav>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-400">
              <Plug aria-hidden="true" className="size-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                  {t("connectionsPage.title")}
                </h1>
                <PageGuideModal pageKey="connectionsPage" />
              </div>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {t("connectionsPage.subtitle")}
              </p>
            </div>
          </div>

          <div className="flex w-full flex-col gap-2 sm:ml-auto sm:w-auto sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={refreshAll}
              disabled={refreshing || loading || !houseId}
              className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-200 dark:hover:bg-slate-800 sm:w-auto"
            >
              <RefreshCw
                aria-hidden="true"
                className={`size-4 ${refreshing || loading ? "animate-spin" : ""}`}
              />
              {t("connectionsPage.refresh")}
            </button>
          </div>
        </div>
      </header>

      <section className="space-y-4">
        {availableHouses.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-700 dark:border-slate-700 dark:bg-slate-900/50 dark:text-gray-300">
            <p className="font-semibold">{t("connectionsPage.no_house")}</p>
            <p className="mt-1">{t("connectionsPage.no_accessible_house")}</p>
          </div>
        ) : !houseId ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-6 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <p className="font-semibold">{t("connectionsPage.no_house")}</p>
            <p className="mt-1">{t("connectionsPage.no_house_hint")}</p>
          </div>
        ) : loading ? (
          cardSkeleton
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-6 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            <p className="font-semibold">{t("connectionsPage.load_failed")}</p>
            <button
              type="button"
              onClick={refreshAll}
              className="mt-3 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-red-300 bg-white px-4 font-semibold text-red-700 transition-colors hover:bg-red-50 dark:border-red-500/40 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-500/10"
            >
              <RefreshCw aria-hidden="true" className="size-4" />
              {t("connectionsPage.retry")}
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <WhatsAppCard state={stateFor("whatsapp")} houseId={houseId} onChanged={refresh} />
            <TelegramCard state={stateFor("telegram")} houseId={houseId} onChanged={refresh} />
            <GmailCard state={stateFor("gmail")} houseId={houseId} onChanged={refresh} />
          </div>
        )}
      </section>
    </main>
  );
}
