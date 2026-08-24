"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import apiClient from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLanguage } from "@/i18n/useLanguage";
import {
  Send, Loader2, RefreshCw, CheckCircle2, AlertCircle,
  Link2, Settings, ChevronDown, Bot, Plus, Pencil, Trash2,
  MessageSquare, Hash, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import { AccessDenied } from "@/components/ui/AccessDenied";
import { ConfirmationModal } from "@/components/ui/ConfirmationModal";

interface House {
  id: number;
  name: string;
  code: string;
  is_active: boolean;
  telegram_chat_id: string | null;
  telegram_chat_name: string | null;
}

interface TgBot {
  id: number;
  name: string;
  bot_username: string | null;
  status: string;
  last_error: string | null;
  last_verified_at: string | null;
  created_at: string | null;
  houses: {
    id: number;
    name: string;
    code: string;
    telegram_chat_id: string | null;
    telegram_chat_name: string | null;
  }[];
}

export default function TelegramPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();

  const [houses, setHouses] = useState<House[]>([]);
  const [bots, setBots] = useState<TgBot[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Bot form modal
  const [showBotForm, setShowBotForm] = useState(false);
  const [editingBotId, setEditingBotId] = useState<number | null>(null);
  const [botName, setBotName] = useState("");
  const [botToken, setBotToken] = useState("");
  const [selectedHouseIds, setSelectedHouseIds] = useState<number[]>([]);
  const [savingBot, setSavingBot] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<TgBot | null>(null);
  const [deletingBotId, setDeletingBotId] = useState<number | null>(null);

  // Chat linking
  const [chatDrafts, setChatDrafts] = useState<Record<number, string>>({});
  const [testingHouse, setTestingHouse] = useState<number | null>(null);

  useEffect(() => {
    if (!authLoading && !hasPermission("telegram.view")) {
      const timer = setTimeout(() => router.push("/"), 5000);
      return () => clearTimeout(timer);
    }
  }, [authLoading, hasPermission, router]);

  const loadBots = useCallback(async () => {
    const res = await apiClient.get("/telegram/bots");
    setBots(res.data?.data ?? []);
  }, []);

  const loadHouses = useCallback(async () => {
    const res = await apiClient.get("/houses", { params: { per_page: 100 } });
    const data = res.data?.data ?? res.data ?? [];
    const list: House[] = Array.isArray(data) ? data : [];
    setHouses(list);
    setChatDrafts((prev) => {
      const next = { ...prev };
      for (const h of list) {
        if (next[h.id] === undefined && h.telegram_chat_id) next[h.id] = h.telegram_chat_id;
      }
      return next;
    });
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadBots(), loadHouses()]);
    } catch {
      toast.error("Failed to load Telegram data");
    } finally {
      setLoading(false);
    }
  }, [loadBots, loadHouses]);

  useEffect(() => {
    if (!authLoading && hasPermission("telegram.view")) {
      loadAll();
    }
  }, [authLoading, hasPermission, loadAll]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadBots(), loadHouses()]);
    } finally {
      setRefreshing(false);
    }
  };

  const canManage = hasPermission("telegram.manage");

  // ── Bot CRUD ─────────────────────────────────────────────────────

  const openCreate = () => {
    setEditingBotId(null);
    setBotName("");
    setBotToken("");
    setSelectedHouseIds([]);
    setShowBotForm(true);
  };

  const openEdit = (b: TgBot) => {
    setEditingBotId(b.id);
    setBotName(b.name);
    setBotToken("");
    setSelectedHouseIds(b.houses.map((h) => h.id));
    setShowBotForm(true);
  };

  const toggleHouse = (id: number) => {
    setSelectedHouseIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const saveBot = async () => {
    if (!botName.trim()) return toast.error(t("whatsappPage.connection_name") + " required");
    if (!editingBotId && !botToken.trim()) return toast.error(t("telegramPage.bot_token") + " required");
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
      setShowBotForm(false);
      await Promise.all([loadBots(), loadHouses()]);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Save failed");
    } finally {
      setSavingBot(false);
    }
  };

  const deleteBot = async () => {
    if (!deleteTarget) return;
    setDeletingBotId(deleteTarget.id);
    try {
      await apiClient.delete(`/telegram/bots/${deleteTarget.id}`);
      toast.success(t("telegramPage.deleted"));
      setDeleteTarget(null);
      await Promise.all([loadBots(), loadHouses()]);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Delete failed");
    } finally {
      setDeletingBotId(null);
    }
  };

  // ── Chat linking ─────────────────────────────────────────────────

  const testAndSave = async (house: House) => {
    const chatId = (chatDrafts[house.id] ?? "").trim();
    if (!chatId) return toast.error(t("telegramPage.chat_id_label") + " required");
    setTestingHouse(house.id);
    try {
      const res = await apiClient.post("/telegram/test-delivery", {
        house_id: house.id,
        chat_id: chatId,
        chat_name: chatId,
      });
      toast.success(`${res.data?.data?.bot}: ${t("telegramPage.linked_badge")} ✓`);
      await Promise.all([loadHouses(), loadBots()]);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || "Test failed");
    } finally {
      setTestingHouse(null);
    }
  };

  // Bot lookup per house
  const botForHouse = (hid: number) => bots.find((b) => b.houses.some((h) => h.id === hid));

  const linkedCount = houses.filter((h) => h.telegram_chat_id).length;

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    );
  }

  if (!hasPermission("telegram.view")) {
    return <AccessDenied />;
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-12 h-12 rounded-2xl bg-sky-50 dark:bg-sky-500/10 flex items-center justify-center shrink-0">
            <Send className="w-6 h-6 text-sky-500" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-gray-100 truncate">
              {t("telegramPage.title")}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{t("telegramPage.subtitle")}</p>
          </div>
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-slate-700 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-all min-h-[44px] disabled:opacity-50"
        >
          <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
          Refresh
        </button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: t("telegramPage.total_houses"), value: houses.length, icon: MessageSquare, color: "text-blue-500", bg: "bg-blue-50 dark:bg-blue-500/10" },
          { label: t("telegramPage.bots_section"), value: bots.length, icon: Bot, color: "text-sky-500", bg: "bg-sky-50 dark:bg-sky-500/10" },
          { label: t("telegramPage.linked_badge"), value: linkedCount, icon: CheckCircle2, color: "text-green-500", bg: "bg-green-50 dark:bg-green-500/10" },
        ].map((s, i) => (
          <div key={i} className="bg-white dark:bg-slate-800/60 rounded-2xl border border-gray-100 dark:border-slate-700 p-5 flex items-center gap-4">
            <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center shrink-0", s.bg)}>
              <s.icon className={cn("w-5 h-5", s.color)} />
            </div>
            <div>
              {loading ? (
                <div className="h-7 w-10 bg-gray-200 dark:bg-slate-700 rounded-md animate-pulse mb-1" />
              ) : (
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 leading-none mb-1">{s.value}</p>
              )}
              <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Bots section */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1">
            <h2 className="font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Bot className="w-5 h-5 text-sky-500" />
              {t("telegramPage.bots_section")}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t("telegramPage.bots_desc")}</p>
          </div>
          {canManage && (
            <button
              onClick={openCreate}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-medium transition-all shadow-sm min-h-[44px]"
            >
              <Plus className="w-4 h-4" />
              {t("telegramPage.add_bot")}
            </button>
          )}
        </div>

        {loading ? (
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
          <div className="rounded-2xl border border-dashed border-gray-200 dark:border-slate-700 p-8 text-center">
            <Bot className="w-10 h-10 text-gray-300 dark:text-slate-600 mx-auto mb-3" />
            <p className="font-medium text-gray-700 dark:text-gray-300">{t("telegramPage.no_bots")}</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">{t("telegramPage.no_bots_hint")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {bots.map((b) => (
              <div key={b.id} className="bg-white dark:bg-slate-800/60 rounded-2xl border border-gray-100 dark:border-slate-700 p-5 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-sky-50 dark:bg-sky-500/10 flex items-center justify-center shrink-0">
                    <Bot className="w-5 h-5 text-sky-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 dark:text-gray-100 truncate">{b.name}</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 font-mono truncate">
                      {b.bot_username ? `@${b.bot_username}` : "—"}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide shrink-0",
                      b.status === "active"
                        ? "bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400"
                        : "bg-red-100 dark:bg-red-500/15 text-red-600 dark:text-red-400"
                    )}
                  >
                    <span className={cn("w-1.5 h-1.5 rounded-full", b.status === "active" ? "bg-green-500" : "bg-red-500")} />
                    {b.status}
                  </span>
                </div>

                <div>
                  <p className="text-[11px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1.5">
                    {t("whatsappPage.assigned_houses")} ({b.houses.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {b.houses.length === 0 && <span className="text-xs text-gray-400">—</span>}
                    {b.houses.map((h) => (
                      <span key={h.id} className="inline-flex items-center px-2 py-1 rounded-lg bg-gray-50 dark:bg-slate-800 text-[11px] text-gray-600 dark:text-gray-300 max-w-full">
                        <span className="truncate">{h.name}</span>
                        <span className={cn("ml-1 w-1.5 h-1.5 rounded-full shrink-0", h.telegram_chat_id ? "bg-green-400" : "bg-gray-300")} title={h.telegram_chat_id ? t("telegramPage.linked_badge") : t("telegramPage.unlinked_badge")} />
                      </span>
                    ))}
                  </div>
                </div>

                {canManage && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      onClick={() => openEdit(b)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-gray-200 dark:border-slate-700 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 transition-all min-h-[36px]"
                    >
                      <Settings className="w-3.5 h-3.5" />
                      {t("telegramPage.manage_houses")}
                    </button>
                    <button
                      onClick={() => setDeleteTarget(b)}
                      disabled={deletingBotId === b.id}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-200 dark:border-red-500/40 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all min-h-[36px] disabled:opacity-50 ml-auto"
                    >
                      {deletingBotId === b.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      {t("telegramPage.delete_bot")}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* House group linking */}
      <section className="space-y-4">
        <div>
          <h2 className="font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Hash className="w-5 h-5 text-sky-500" />
            {t("telegramPage.houses_section")}
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t("telegramPage.houses_desc")}</p>
        </div>

        {loading ? (
          <div className="divide-y divide-gray-50 dark:divide-slate-800 rounded-2xl border border-gray-100 dark:border-slate-700 overflow-hidden">
            {Array.from({ length: Math.min(5, Math.max(houses.length, 3)) }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4 animate-pulse">
                <div className="w-10 h-10 rounded-xl bg-gray-200 dark:bg-slate-700 shrink-0" />
                <div className="space-y-2 flex-1">
                  <div className="h-3 w-32 bg-gray-200 dark:bg-slate-700 rounded-md" />
                  <div className="h-2.5 w-20 bg-gray-100 dark:bg-slate-800 rounded-md" />
                </div>
                <div className="hidden sm:block h-9 w-48 bg-gray-200 dark:bg-slate-700 rounded-xl" />
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* Desktop rows */}
            <div className="hidden lg:block rounded-2xl border border-gray-100 dark:border-slate-700 divide-y divide-gray-50 dark:divide-slate-800 overflow-hidden">
              {houses.map((house) => {
                const boundBot = botForHouse(house.id);
                return (
                  <div key={house.id} className="flex items-center gap-4 px-5 py-3.5">
                    <div className="w-10 h-10 rounded-xl bg-gray-50 dark:bg-slate-800 flex items-center justify-center shrink-0">
                      <span className="text-xs font-bold text-gray-500 dark:text-gray-400">{house.code.slice(0, 2)}</span>
                    </div>
                    <div className="min-w-0 w-44">
                      <p className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">{house.name}</p>
                      <p className="text-[11px] text-gray-400 font-mono">{house.code}</p>
                    </div>
                    <div className="w-40 shrink-0">
                      {boundBot ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 truncate">
                          <Bot className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                          <span className="truncate">{boundBot.name}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                          <AlertCircle className="w-3.5 h-3.5" />
                          {t("telegramPage.no_bot_assigned")}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      {canManage && boundBot ? (
                        <input
                          type="text"
                          inputMode="numeric"
                          value={chatDrafts[house.id] ?? ""}
                          onChange={(e) => setChatDrafts((p) => ({ ...p, [house.id]: e.target.value }))}
                          placeholder={t("telegramPage.chat_id_placeholder")}
                          className="w-full max-w-xs min-h-[40px] px-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-mono text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                        />
                      ) : (
                        <span className="text-sm font-mono text-gray-500 dark:text-gray-400 truncate block">
                          {house.telegram_chat_id || "—"}
                        </span>
                      )}
                    </div>
                    {house.telegram_chat_id ? (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400 text-[10px] font-semibold shrink-0">
                        <CheckCircle2 className="w-3 h-3" />
                        {t("telegramPage.linked_badge")}
                      </span>
                    ) : (
                      <span className="px-2 py-1 rounded-full bg-gray-50 dark:bg-slate-800 text-gray-400 text-[10px] font-semibold shrink-0">
                        {t("telegramPage.unlinked_badge")}
                      </span>
                    )}
                    {canManage && boundBot && (
                      <button
                        onClick={() => testAndSave(house)}
                        disabled={testingHouse === house.id}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-medium transition-all min-h-[40px] shrink-0 disabled:opacity-50"
                      >
                        {testingHouse === house.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                        {testingHouse === house.id ? t("telegramPage.testing") : t("telegramPage.test_and_save")}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Mobile accordion */}
            <div className="lg:hidden space-y-2">
              {houses.map((house) => {
                const boundBot = botForHouse(house.id);
                const isExpanded = expandedId === house.id;
                return (
                  <div key={house.id} className="rounded-2xl border border-gray-100 dark:border-slate-700 bg-white dark:bg-slate-800/60 overflow-hidden">
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : house.id)}
                      className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
                    >
                      <div className="w-10 h-10 rounded-xl bg-gray-50 dark:bg-slate-800 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-gray-500 dark:text-gray-400">{house.code.slice(0, 2)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">{house.name}</p>
                        <p className="text-[11px] text-gray-400 font-mono truncate">{house.telegram_chat_id || house.code}</p>
                      </div>
                      {house.telegram_chat_id ? (
                        <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-gray-300 dark:text-slate-600 shrink-0" />
                      )}
                      <ChevronDown className={cn("w-4 h-4 text-gray-400 transition-transform shrink-0", isExpanded && "rotate-180")} />
                    </button>
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-1 space-y-3 border-t border-gray-50 dark:border-slate-800">
                        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                          <Bot className="w-4 h-4 text-sky-500" />
                          {boundBot ? boundBot.name : t("telegramPage.no_bot_assigned")}
                        </div>
                        {canManage && boundBot && (
                          <>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={chatDrafts[house.id] ?? ""}
                              onChange={(e) => setChatDrafts((p) => ({ ...p, [house.id]: e.target.value }))}
                              placeholder={t("telegramPage.chat_id_placeholder")}
                              className="w-full min-h-[44px] px-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-mono text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                            />
                            <button
                              onClick={() => testAndSave(house)}
                              disabled={testingHouse === house.id}
                              className="w-full flex items-center justify-center gap-2 px-4 min-h-[44px] rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-medium disabled:opacity-50"
                            >
                              {testingHouse === house.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                              {testingHouse === house.id ? t("telegramPage.testing") : t("telegramPage.test_and_save")}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        <p className="text-[11px] text-gray-400 dark:text-gray-500 flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 mt-px shrink-0" />
          {t("telegramPage.how_to_help")}
        </p>
      </section>

      {/* Bot form modal */}
      {showBotForm && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4" onClick={() => setShowBotForm(false)}>
          <div
            className="bg-white dark:bg-slate-900 w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl border border-gray-100 dark:border-slate-800 shadow-2xl max-h-[92vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-800 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-sky-50 dark:bg-sky-500/10 flex items-center justify-center">
                {editingBotId ? <Pencil className="w-5 h-5 text-sky-600" /> : <Plus className="w-5 h-5 text-sky-600" />}
              </div>
              <h3 className="font-bold text-lg text-gray-900 dark:text-gray-100 flex-1">
                {editingBotId ? t("telegramPage.manage_houses") : t("telegramPage.add_bot")}
              </h3>
              <button onClick={() => setShowBotForm(false)} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500">
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">{t("telegramPage.bot_name")}</label>
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
                  {editingBotId && <span className="ml-1 text-gray-400">(leave blank to keep current)</span>}
                </label>
                <input
                  type="password"
                  autoComplete="off"
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  placeholder={editingBotId ? "•••••••• (unchanged)" : t("telegramPage.bot_token_placeholder")}
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
                      <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{h.name}</span>
                      <span className="ml-auto text-[10px] font-mono text-gray-400 shrink-0">{h.code}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 dark:border-slate-800 flex justify-end gap-2">
              <button
                onClick={() => setShowBotForm(false)}
                className="px-4 min-h-[44px] rounded-xl border border-gray-200 dark:border-slate-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={saveBot}
                disabled={savingBot}
                className="flex items-center gap-2 px-4 min-h-[44px] rounded-xl bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 disabled:opacity-50"
              >
                {savingBot ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
                {editingBotId ? "Update" : t("telegramPage.add_bot")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      <ConfirmationModal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={deleteBot}
        type="danger"
        title={t("telegramPage.delete_bot")}
        confirmText={t("telegramPage.delete_bot")}
        loading={deletingBotId !== null}
      >
        {deleteTarget && (
          <>
            <div className="w-full mt-5 rounded-2xl border border-gray-100 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/60 p-4">
              <div className="flex items-center gap-3 text-left">
                <div className="w-11 h-11 rounded-xl bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-700 flex items-center justify-center shrink-0 shadow-sm">
                  <Bot className="w-5 h-5 text-sky-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-gray-900 dark:text-gray-100 truncate">{deleteTarget.name}</p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 font-mono truncate">
                    {deleteTarget.bot_username ? `@${deleteTarget.bot_username}` : "—"}
                  </p>
                </div>
                <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">
                  {deleteTarget.houses.length} {deleteTarget.houses.length === 1 ? "house" : "houses"}
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
