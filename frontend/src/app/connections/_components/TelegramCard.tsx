"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  Send,
  Link2,
  Unlink,
  Bot,
  Plus,
  Pencil,
  Trash2,
  AlertCircle,
  Info,
  Settings,
} from "lucide-react";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import { toast } from "react-hot-toast";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";
import type { HouseConnectionState } from "@/hooks/useHouseConnections";
import { CONNECTION_PROVIDERS } from "@/lib/connectionProviders";
import { ProviderCard } from "./ProviderCard";
import { cn } from "@/lib/utils";
import { ConnectionManagementDialog } from "./ConnectionManagementDialog";

interface Props {
  state?: HouseConnectionState;
  houseId: number;
  onChanged: () => void;
}

interface House {
  id: number;
  name: string;
  code: string;
  telegram_chat_id: string | null;
  telegram_chat_name: string | null;
}

interface TgBot {
  id: number;
  name: string;
  bot_username: string | null;
  status: string;
  last_error: string | null;
  houses: {
    id: number;
    name: string;
    code: string;
    telegram_chat_id: string | null;
    telegram_chat_name: string | null;
  }[];
}

const btnBase =
  "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60";

export function TelegramCard({ state, houseId, onChanged }: Props) {
  const { hasPermission } = useAuth();
  const { t } = useLanguage();
  const canAct = hasPermission("telegram.connect");
  const canManage = hasPermission("telegram.manage");
  const connected = state?.connected === true;
  const hasBot = state?.status !== "not_configured";
  const headers = { "X-House-ID": String(houseId) };

  // ── Modals ──
  const [managementOpen, setManagementOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [botFormOpen, setBotFormOpen] = useState(false);
  const [deleteBotTarget, setDeleteBotTarget] = useState<TgBot | null>(null);

  // ── Bot admin (telegram.manage) ──
  const [bots, setBots] = useState<TgBot[]>([]);
  const [houses, setHouses] = useState<House[]>([]);
  const [botsLoading, setBotsLoading] = useState(false);
  const [housesLoading, setHousesLoading] = useState(false);
  const [editingBotId, setEditingBotId] = useState<number | null>(null);
  const [botName, setBotName] = useState("");
  const [botToken, setBotToken] = useState("");
  const [selectedHouseIds, setSelectedHouseIds] = useState<number[]>([]);
  const [savingBot, setSavingBot] = useState(false);
  const [deletingBotId, setDeletingBotId] = useState<number | null>(null);

  // ── Per-house chat linking ──
  const [chatId, setChatId] = useState("");
  const [houseChatIds, setHouseChatIds] = useState<Record<number, string>>({});
  const [testingHouse, setTestingHouse] = useState<number | null>(null);

  const closeManagement = () => {
    setManagementOpen(false);
    setConfirmOpen(false);
    setBotFormOpen(false);
    setDeleteBotTarget(null);
  };

  const loadBots = useCallback(async () => {
    if (!canManage) return;
    setBotsLoading(true);
    try {
      const res = await apiClient.get("/telegram/bots");
      setBots(res.data?.data ?? []);
    } catch {
      toast.error(t("connectionsPage.load_failed"));
    } finally {
      setBotsLoading(false);
    }
  }, [canManage, t]);

  const loadHouses = useCallback(async () => {
    if (!canManage) return;
    setHousesLoading(true);
    try {
      const res = await apiClient.get("/houses", { params: { per_page: 100 } });
      const data = res.data?.data ?? res.data ?? [];
      setHouses(Array.isArray(data) ? data : []);
    } catch {
      toast.error(t("connectionsPage.load_failed"));
    } finally {
      setHousesLoading(false);
    }
  }, [canManage, t]);

  useEffect(() => {
    if (canManage) {
      void loadBots();
      void loadHouses();
    }
  }, [canManage, loadBots, loadHouses]);

  const botForHouse = (hid: number) => bots.find((b) => b.houses.some((h) => h.id === hid));

  // ── Per-house actions ──
  const linkChat = async (value: string, targetHouseId = houseId) => {
    const chat = value.trim();
    if (!chat) return;
    setTestingHouse(targetHouseId);
    try {
      await apiClient.post(
        "/telegram/connect",
        { house_id: targetHouseId, chat_id: chat },
        { headers: { "X-House-ID": String(targetHouseId) } }
      );
      toast.success(t("connectionsPage.telegram.test_sent"));
      if (targetHouseId === houseId) setChatId("");
      setHouseChatIds((current) => ({ ...current, [targetHouseId]: "" }));
      onChanged();
    } catch (error: unknown) {
      const detail =
        (error as { response?: { data?: { detail?: unknown } } })?.response
          ?.data?.detail;
      toast.error(typeof detail === "string" ? detail : t("connectionsPage.action_failed"));
    } finally {
      setTestingHouse(null);
    }
  };

  const sendTest = async () => {
    if (!state?.reference) return;
    setTestingHouse(houseId);
    try {
      await apiClient.post(
        "/telegram/test-delivery",
        { house_id: houseId, chat_id: state.reference, chat_name: state.reference },
        { headers }
      );
      toast.success(t("connectionsPage.telegram.test_sent"));
      onChanged();
    } catch (error: unknown) {
      const detail =
        (error as { response?: { data?: { detail?: unknown } } })?.response
          ?.data?.detail;
      toast.error(typeof detail === "string" ? detail : t("connectionsPage.action_failed"));
    } finally {
      setTestingHouse(null);
    }
  };

  const disconnect = async () => {
    setConfirmOpen(false);
    try {
      await apiClient.delete("/telegram/disconnect", { headers });
      toast.success(t("connectionsPage.actions.disconnect"));
      onChanged();
    } catch (error: unknown) {
      const detail =
        (error as { response?: { data?: { detail?: unknown } } })?.response
          ?.data?.detail;
      toast.error(typeof detail === "string" ? detail : t("connectionsPage.action_failed"));
    }
  };

  // ── Bot CRUD ──
  const toggleHouse = (id: number) => {
    setSelectedHouseIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const saveBot = async () => {
    if (!botName.trim()) return toast.error(t("telegramPage.bot_name_required"));
    if (!editingBotId && !botToken.trim()) return toast.error(t("telegramPage.bot_token_required"));
    if (selectedHouseIds.length === 0) return toast.error(t("whatsappPage.select_house_error"));

    setSavingBot(true);
    try {
      if (editingBotId) {
        await apiClient.put(`/telegram/bots/${editingBotId}/houses`, { house_ids: selectedHouseIds });
        const payload: Record<string, string> = { name: botName.trim() };
        if (botToken.trim()) payload.bot_token = botToken.trim();
        await apiClient.patch(`/telegram/bots/${editingBotId}`, payload);
        toast.success(t("telegramPage.updated"));
      } else {
        await apiClient.post("/telegram/bots", {
          name: botName.trim(),
          bot_token: botToken.trim(),
          house_ids: selectedHouseIds,
        });
        toast.success(t("telegramPage.created"), { duration: 6000 });
      }
      setBotFormOpen(false);
      await loadBots();
      onChanged();
    } catch (error: unknown) {
      const detail =
        (error as { response?: { data?: { detail?: unknown } } })?.response?.data
          ?.detail;
      toast.error(
        typeof detail === "string" ? detail : t("connectionsPage.save_failed")
      );
    } finally {
      setSavingBot(false);
    }
  };

  const deleteBot = async () => {
    if (!deleteBotTarget) return;
    setDeletingBotId(deleteBotTarget.id);
    try {
      await apiClient.delete(`/telegram/bots/${deleteBotTarget.id}`);
      toast.success(t("telegramPage.deleted"));
      setDeleteBotTarget(null);
      await loadBots();
      onChanged();
    } catch (error: unknown) {
      const detail =
        (error as { response?: { data?: { detail?: unknown } } })?.response?.data
          ?.detail;
      toast.error(
        typeof detail === "string" ? detail : t("connectionsPage.delete_failed")
      );
    } finally {
      setDeletingBotId(null);
    }
  };

  return (
    <div className="min-w-0">
      <ProviderCard
        presentation={CONNECTION_PROVIDERS.telegram}
        state={state}
        action={
          canAct || canManage ? (
            <button
              type="button"
              onClick={() => setManagementOpen(true)}
              className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-sky-700"
            >
              <Link2 className="size-4" />
              {connected
                ? t("connectionsPage.actions.manage")
                : t("connectionsPage.actions.connect")}
            </button>
          ) : null
        }
      />

      <ConnectionManagementDialog
        open={managementOpen}
        onClose={closeManagement}
        title={t("connectionsPage.telegram.name")}
        description={t("connectionsPage.telegram.description")}
        errorMessage={state?.error}
      >
        <div className="space-y-5">
          {!hasBot && (
            <div className="space-y-1 text-sm text-gray-500 dark:text-gray-400">
              <p className="font-semibold text-gray-700 dark:text-gray-300">
                {t("connectionsPage.telegram.no_bot")}
              </p>
              <p>{t("connectionsPage.telegram.no_bot_hint")}</p>
            </div>
          )}
          {hasBot && !connected && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("connectionsPage.telegram.chat_hint")}
            </p>
          )}
          {canAct && hasBot && (
            connected ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {canManage && (
                  <button
                    type="button"
                    onClick={sendTest}
                    disabled={testingHouse !== null}
                    className={`${btnBase} w-full border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-400 dark:hover:bg-sky-500/20`}
                  >
                    {testingHouse === houseId ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Send className="size-4" />
                    )}
                    {testingHouse === houseId
                      ? t("connectionsPage.actions.sending")
                      : t("connectionsPage.actions.send_test")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setConfirmOpen(true)}
                  disabled={confirmOpen}
                  className={`${btnBase} w-full border-red-200 bg-white text-red-600 hover:bg-red-50 dark:border-red-500/40 dark:bg-slate-900 dark:text-red-400 dark:hover:bg-red-500/10`}
                >
                  <Unlink className="size-4" />
                  {t("connectionsPage.actions.disconnect")}
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <label
                  htmlFor={`tg-chat-${houseId}`}
                  className="block text-xs font-semibold text-gray-600 dark:text-gray-300"
                >
                  {t("connectionsPage.telegram.chat_label")}
                </label>
                <input
                  id={`tg-chat-${houseId}`}
                  value={chatId}
                  onChange={(e) => setChatId(e.target.value)}
                  placeholder={t("connectionsPage.telegram.chat_placeholder")}
                  className="min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-primary-500 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100"
                />
                <button
                  type="button"
                  onClick={() => linkChat(chatId)}
                  disabled={!chatId.trim() || testingHouse !== null}
                  className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {testingHouse === houseId ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-4" />
                  )}
                  {testingHouse === houseId
                    ? t("connectionsPage.telegram.linking")
                    : t("connectionsPage.actions.verify_link")}
                </button>
              </div>
            )
          )}

      {canManage && (
        <div className="space-y-4">
        <section className="rounded-xl border border-gray-100 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/50">
          <div className="flex items-center justify-between gap-2 mb-3">
            <button
              type="button"
              onClick={() => {
                setEditingBotId(null);
                setBotName("");
                setBotToken("");
                setSelectedHouseIds([]);
                setBotFormOpen(true);
              }}
              className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-200 dark:hover:bg-slate-800"
            >
              <Plus className="size-3.5" />
              {t("telegramPage.add_bot")}
            </button>
            <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400">
              {t("telegramPage.bots_section")}
            </h3>
          </div>
          {botsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-2xl border border-gray-100 dark:border-slate-700 p-5 space-y-3 animate-pulse">
                  <div className="h-4 w-32 bg-gray-200 dark:bg-slate-700 rounded-md" />
                  <div className="h-3 w-24 bg-gray-100 dark:bg-slate-800 rounded-md" />
                  <div className="h-9 w-full bg-gray-200 dark:bg-slate-700 rounded-xl mt-3" />
                </div>
              ))}
            </div>
          ) : bots.length === 0 ? (
            <p className="text-xs text-gray-500 dark:text-gray-400 text-center py-4">
              {t("telegramPage.no_bots")}
            </p>
          ) : (
            <div className="space-y-2">
              {bots.map((b) => (
                <div
                  key={b.id}
                  className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-2 dark:border-slate-700 dark:bg-slate-800/50"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-sky-50 dark:bg-sky-500/10 flex items-center justify-center text-sky-600 dark:text-sky-400 shrink-0">
                      <Bot className="w-3.5 h-3.5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {b.name}
                      </p>
                      {b.bot_username && (
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate font-mono">
                          @{b.bot_username}
                        </p>
                      )}
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                      b.status === "active"
                        ? "bg-green-100 text-green-700 dark:bg-green-500/10 dark:text-green-400"
                        : "bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-400"
                    }`}
                  >
                    {b.status}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingBotId(b.id);
                      setBotName(b.name);
                      setBotToken("");
                      setSelectedHouseIds(b.houses.map((h) => h.id));
                      setBotFormOpen(true);
                    }}
                    className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg text-gray-400 transition-colors hover:text-primary-600 dark:hover:text-primary-400"
                    title={t("telegramPage.manage_houses")}
                    aria-label={t("telegramPage.manage_houses")}
                  >
                    <Settings className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteBotTarget(b)}
                    className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg text-gray-400 transition-colors hover:text-red-600 dark:hover:text-red-400"
                    title={t("telegramPage.delete_bot")}
                    aria-label={t("telegramPage.delete_bot")}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

      {canManage && housesLoading && (
        <p className="text-xs text-gray-400 dark:text-gray-500">
          {t("connectionsPage.loading_houses")}
        </p>
      )}

      {/* Per-house house linking (telegram.manage) */}
      {canManage && houses.length > 0 && (
        <section className="rounded-xl border border-gray-100 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/50">
          <div className="mb-3">
            <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400">
              {t("telegramPage.houses_section")}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {t("telegramPage.houses_desc")}
            </p>
          </div>
          <div className="space-y-2">
            {houses.map((house) => {
              const boundBot = botForHouse(house.id);
              const isLinked = !!house.telegram_chat_id;
              return (
                <div
                  key={house.id}
                  className="flex min-w-0 flex-col gap-3 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-gray-200 dark:bg-slate-800 flex items-center justify-center text-xs font-bold text-gray-500 dark:text-gray-400 shrink-0">
                      {house.code.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                        {house.name}
                      </p>
                      <p className="text-[10px] text-gray-400 font-mono truncate">
                        {house.code}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="min-w-[140px]">
                      {boundBot ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 truncate">
                          <Bot className="w-3 h-3 text-sky-500" />
                          <span className="truncate">{boundBot.name}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                          <AlertCircle className="w-3 h-3" />
                          {t("telegramPage.no_bot_assigned")}
                        </span>
                      )}
                    </div>
                    {boundBot && (
                      <>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={houseChatIds[house.id] ?? ""}
                          onChange={(e) =>
                            setHouseChatIds((current) => ({
                              ...current,
                              [house.id]: e.target.value,
                            }))
                          }
                          placeholder={t("telegramPage.chat_id_placeholder")}
                          className="min-h-11 w-full max-w-xs rounded-xl border border-gray-200 bg-white px-3 text-sm font-mono text-gray-700 focus:outline-none focus:ring-2 focus:ring-sky-500/40 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-300"
                        />
                        <button
                          type="button"
                          onClick={() => linkChat(houseChatIds[house.id] ?? "", house.id)}
                          disabled={testingHouse === house.id || !(houseChatIds[house.id] ?? "").trim()}
                          className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-xl bg-sky-600 px-3 py-2 text-xs font-medium text-white transition-all hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {testingHouse === house.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Send className="w-3 h-3" />
                          )}
                          {t("telegramPage.test_and_save")}
                        </button>
                      </>
                    )}
                    {isLinked && !boundBot ? (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400 text-[10px] font-semibold shrink-0">
                        <CheckCircle2 className="w-3 h-3" />
                        {t("telegramPage.linked_badge")}
                      </span>
                    ) : (
                      <span className="px-2 py-1 rounded-full bg-gray-50 dark:bg-slate-800 text-gray-400 text-[10px] font-semibold shrink-0">
                        {t("telegramPage.unlinked_badge")}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-gray-400 dark:text-gray-500 flex items-start gap-1.5 mt-2">
            <Info className="w-3.5 h-3.5 mt-px shrink-0" />
            {t("telegramPage.how_to_help")}
          </p>
        </section>
      )}
          </div>
      )}
        </div>
      </ConnectionManagementDialog>

      <ConfirmationModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={disconnect}
        title={t("connectionsPage.telegram.disconnect_title")}
        message={t("connectionsPage.telegram.disconnect_desc")}
        confirmText={t("connectionsPage.actions.disconnect")}
        cancelText={t("connectionsPage.actions.cancel")}
        type="danger"
        loading={confirmOpen}
      />

      {/* Bot form modal */}
      {botFormOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4"
          onClick={() => setBotFormOpen(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl border border-gray-100 dark:border-slate-800 shadow-2xl max-h-[92vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-800 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-sky-50 dark:bg-sky-500/10 flex items-center justify-center">
                {editingBotId ? (
                  <Pencil className="w-5 h-5 text-sky-600" />
                ) : (
                  <Plus className="w-5 h-5 text-sky-600" />
                )}
              </div>
              <h3 className="font-bold text-lg text-gray-900 dark:text-gray-100 flex-1">
                {editingBotId ? t("telegramPage.manage_houses") : t("telegramPage.add_bot")}
              </h3>
              <button
                onClick={() => setBotFormOpen(false)}
                className="flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-xl text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-800"
                aria-label={t("connectionsPage.actions.close")}
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">
                  {t("telegramPage.bot_name")}
                </label>
                <input
                  type="text"
                  value={botName}
                  onChange={(e) => setBotName(e.target.value)}
                  placeholder={t("telegramPage.bot_name_placeholder")}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">
                  {t("telegramPage.bot_token")}
                  {editingBotId && <span className="ml-1 text-gray-400">({t("telegramPage.keep_token_hint")})</span>}
                </label>
                <input
                  type="password"
                  autoComplete="off"
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  placeholder={editingBotId ? t("telegramPage.keep_token_hint") : t("telegramPage.bot_token_placeholder")}
                  className="w-full min-h-[44px] px-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-mono text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">
                  {t("telegramPage.assign_houses")} ({selectedHouseIds.length})
                </label>
                <div className="max-h-52 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-2 pr-1">
                  {houses.map((h) => (
                    <label
                      key={h.id}
                      className={cn(
                        "flex items-center gap-2.5 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors min-h-[44px]",
                        selectedHouseIds.includes(h.id)
                          ? "border-sky-400 dark:border-sky-500 bg-sky-50 dark:bg-sky-500/10"
                          : "border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800"
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selectedHouseIds.includes(h.id)}
                        onChange={() => toggleHouse(h.id)}
                        className="accent-sky-600 w-4 h-4"
                      />
                      <span className="text-sm text-gray-700 dark:text-gray-300 truncate">
                        {h.name}
                      </span>
                      <span className="ml-auto text-[10px] font-mono text-gray-400 shrink-0">
                        {h.code}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 dark:border-slate-800 flex justify-end gap-2">
              <button
                onClick={() => setBotFormOpen(false)}
                className="min-h-11 cursor-pointer rounded-xl border border-gray-200 px-4 text-sm text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:text-gray-400 dark:hover:bg-slate-800"
              >
                {t("connectionsPage.actions.cancel")}
              </button>
              <button
                onClick={saveBot}
                disabled={savingBot}
                className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-sky-600 px-4 text-sm font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingBot ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {editingBotId ? t("connectionsPage.actions.update") : t("telegramPage.add_bot")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      <ConfirmationModal
        isOpen={deleteBotTarget !== null}
        onClose={() => setDeleteBotTarget(null)}
        onConfirm={deleteBot}
        type="danger"
        title={t("telegramPage.delete_bot")}
        confirmText={t("telegramPage.delete_bot")}
        loading={deletingBotId !== null}
      >
        {deleteBotTarget && (
          <>
            <div className="w-full mt-5 rounded-2xl border border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60 p-4">
              <div className="flex items-center gap-3 text-left">
                <div className="w-11 h-11 rounded-xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-700 flex items-center justify-center shrink-0 shadow-sm">
                  <Bot className="w-5 h-5 text-sky-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                    {deleteBotTarget.name}
                  </p>
                  {deleteBotTarget.bot_username && (
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 font-mono truncate">
                      @{deleteBotTarget.bot_username}
                    </p>
                  )}
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
                  {t("connectionsPage.houses_count", {
                    count: deleteBotTarget.houses.length,
                  })}
                </span>
              </div>
            </div>
            <p className="mt-4 pt-4 w-full border-t border-dashed border-gray-200 dark:border-slate-700 text-xs font-semibold text-red-600 dark:text-red-400 flex items-center justify-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              {t("whatsappPage.delete_irreversible")}
            </p>
          </>
        )}
      </ConfirmationModal>
    </div>
  );
}
