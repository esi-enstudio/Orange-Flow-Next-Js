"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Send, Clock, MessageCircle, Loader2, RefreshCw,
  Plus, Trash2, Power, CalendarCheck, AlertCircle, Smartphone,
  Pencil, CheckCircle2, User, Search, Zap,
} from "lucide-react";
import apiClient from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "react-hot-toast";
import WhatsAppConnectModal from "@/components/WhatsAppConnectModal";

interface Props {
  open: boolean;
  houseId: number | null;
  reportType: string;
  title?: string;
  subtitle?: string;
  onClose: () => void;
}

interface WsStatus {
  connected: boolean;
  state?: string;
  qr?: string;
  error?: string;
}

interface WsGroup {
  id: string;
  name: string;
}

interface WsContact {
  jid: string;
  push_name: string;
  full_name: string;
  first_name: string;
  business_name: string;
}

interface TgStatus {
  success: boolean;
  state?: string;
  error?: string;
  bot?: { id: number; name: string; username?: string | null };
  chat_id?: string | null;
  chat_name?: string | null;
}

interface ScheduleItem {
  id: number;
  house_id: number;
  schedule_type: string;
  schedule_time: string;
  interval_minutes: number | null;
  channel: string;
  report_type: string;
  whatsapp_chat_id: string;
  whatsapp_chat_name: string;
  caption: string | null;
  is_active: boolean;
  last_run_date: string | null;
  last_status: string | null;
  last_error: string | null;
  last_run_at: string | null;
}

const emptyForm = {
  schedule_type: "interval",
  schedule_time: "18:00",
  interval_minutes: "5",
  channel: "whatsapp" as "whatsapp" | "telegram",
  whatsapp_chat_id: "",
  whatsapp_chat_name: "",
  caption: "",
};

export default function WhatsAppReportDeliveryModal({
  open,
  houseId,
  reportType,
  title = "WhatsApp Report Delivery",
  subtitle = "Auto-send the report daily at a fixed time",
  onClose,
}: Props) {
  const [status, setStatus] = useState<WsStatus | null>(null);
  const [tgStatus, setTgStatus] = useState<TgStatus | null>(null);
  const [groups, setGroups] = useState<WsGroup[]>([]);
  const [contacts, setContacts] = useState<WsContact[]>([]);
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [directSending, setDirectSending] = useState(false);
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScheduleItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [waTargetTab, setWaTargetTab] = useState<"groups" | "contacts">("groups");
  const [contactSearch, setContactSearch] = useState("");
  const [groupSearch, setGroupSearch] = useState("");

  const houseHeader = houseId ? { "X-House-ID": String(houseId) } : {};

  const fetchAll = useCallback(async () => {
    if (!houseId) return;
    const hH = { "X-House-ID": String(houseId) };
    const [statusRes, groupsRes, contactsRes, schedulesRes, tgRes] = await Promise.allSettled([
      apiClient.get("/whatsapp/status", { headers: hH }),
      apiClient.get("/whatsapp/groups", { headers: hH }),
      apiClient.get("/whatsapp/contacts", { headers: hH }),
      apiClient.get("/whatsapp-schedules", {
        params: { house_id: houseId, report_type: reportType },
        headers: hH,
      }),
      apiClient.get("/telegram/status", { headers: hH }),
    ]);
    if (statusRes.status === "fulfilled") setStatus(statusRes.value.data);
    else setStatus({ connected: false, state: "unreachable", error: "Service unreachable" });
    setGroups(groupsRes.status === "fulfilled" ? groupsRes.value.data?.data ?? [] : []);
    setContacts(contactsRes.status === "fulfilled" ? contactsRes.value.data?.data ?? [] : []);
    setSchedules(schedulesRes.status === "fulfilled" ? schedulesRes.value.data?.data ?? [] : []);
    setTgStatus(tgRes.status === "fulfilled" ? tgRes.value.data : null);
  }, [houseId, reportType]);

  useEffect(() => {
    if (open && houseId) {
      setLoading(true);
      fetchAll().finally(() => setLoading(false));
      const timer = setInterval(() => {
        const hH = houseId ? { "X-House-ID": String(houseId) } : {};
        apiClient.get("/whatsapp/status", { headers: hH }).then((r) => setStatus(r.data)).catch(() => {});
      }, 5000);
      return () => clearInterval(timer);
    }
  }, [open, houseId, fetchAll]);

  const closeModal = () => {
    setStatus(null);
    setTgStatus(null);
    setGroups([]);
    setContacts([]);
    setSchedules([]);
    setEditingId(null);
    setForm(emptyForm);
    setWaTargetTab("groups");
    setContactSearch("");
    setGroupSearch("");
    onClose();
  };

  const contactDisplayName = (c: WsContact): string => {
    return c.push_name || c.full_name || c.business_name || c.first_name || c.jid.split("@")[0];
  };

  const filteredContacts = useMemo(() => {
    if (!contactSearch.trim()) return contacts.slice(0, 100);
    const q = contactSearch.toLowerCase();
    return contacts
      .filter((c) => {
        const name = contactDisplayName(c).toLowerCase();
        const jid = c.jid.toLowerCase();
        return name.includes(q) || jid.includes(q);
      })
      .slice(0, 100);
  }, [contacts, contactSearch]);

  const filteredGroups = useMemo(() => {
    if (!groupSearch.trim()) return groups;
    const q = groupSearch.toLowerCase();
    return groups.filter((g) => g.name.toLowerCase().includes(q) || g.id.toLowerCase().includes(q));
  }, [groups, groupSearch]);

  const selectGroup = (id: string) => {
    const g = groups.find((x) => x.id === id);
    setForm((f) => ({
      ...f,
      whatsapp_chat_id: id,
      whatsapp_chat_name: g?.name ?? "",
    }));
  };

  const save = async () => {
    if (!houseId) return;
    if (form.channel === "whatsapp" && !form.whatsapp_chat_id) {
      toast.error("Select a WhatsApp group or contact");
      return;
    }
    if (form.schedule_type === "interval") {
      const mins = parseInt(form.interval_minutes, 10);
      if (!mins || mins < 1 || mins > 1440) {
        toast.error("Repeat interval must be between 1 and 1440 minutes");
        return;
      }
    } else if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(form.schedule_time)) {
      toast.error("Time must be in HH:MM (24-hour) format");
      return;
    }
    setLoading(true);
    try {
      const payload: Record<string, unknown> = {
        schedule_type: form.schedule_type,
        schedule_time: form.schedule_type === "daily" ? form.schedule_time : null,
        interval_minutes: form.schedule_type === "interval" ? parseInt(form.interval_minutes, 10) : null,
        channel: form.channel,
        report_type: reportType,
        caption: form.caption || null,
      };
      if (form.channel === "whatsapp") {
        payload.whatsapp_chat_id = form.whatsapp_chat_id;
        payload.whatsapp_chat_name = form.whatsapp_chat_name;
      }
      if (editingId) {
        await apiClient.patch(`/whatsapp-schedules/${editingId}`, payload);
        toast.success("Schedule updated");
      } else {
        await apiClient.post("/whatsapp-schedules", payload, { headers: houseHeader });
        toast.success(form.channel === "telegram" ? "Telegram schedule created" : "Schedule created");
      }
      setEditingId(null);
      setForm(emptyForm);
      fetchAll();
    } catch (e) {
      const msg = (e as Error).message || "Save failed";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const sendDirect = async () => {
    if (!houseId) return;
    if (form.channel === "whatsapp" && !form.whatsapp_chat_id) {
      toast.error("Select a WhatsApp group or contact");
      return;
    }
    setDirectSending(true);
    try {
      const payload: Record<string, unknown> = {
        channel: form.channel,
        report_type: reportType,
        caption: form.caption || null,
      };
      if (form.channel === "whatsapp") {
        payload.whatsapp_chat_id = form.whatsapp_chat_id;
        payload.whatsapp_chat_name = form.whatsapp_chat_name;
      }
      await apiClient.post("/whatsapp-schedules/send-direct", payload, { headers: houseHeader });
      toast.success(
        form.channel === "telegram"
          ? "Report sent to Telegram"
          : `Report sent to ${form.whatsapp_chat_name || "WhatsApp"}`
      );
    } catch (e) {
      const axiosErr = e as { response?: { data?: { detail?: string } } };
      const msg = axiosErr.response?.data?.detail || (e as Error).message || "Send failed";
      toast.error(msg);
    } finally {
      setDirectSending(false);
    }
  };

  const startEdit = (s: ScheduleItem) => {
    setEditingId(s.id);
    setForm({
      schedule_type: s.schedule_type,
      schedule_time: s.schedule_time,
      interval_minutes: String(s.interval_minutes ?? 5),
      channel: (s.channel === "telegram" ? "telegram" : "whatsapp"),
      whatsapp_chat_id: s.whatsapp_chat_id,
      whatsapp_chat_name: s.whatsapp_chat_name,
      caption: s.caption ?? "",
    });
  };

  const toggle = async (s: ScheduleItem) => {
    setTogglingId(s.id);
    try {
      await apiClient.patch(`/whatsapp-schedules/${s.id}`, { is_active: !s.is_active });
      fetchAll();
    } catch (e) {
      toast.error((e as Error).message || "Toggle failed");
    } finally {
      setTogglingId(null);
    }
  };

  const remove = async (s: ScheduleItem) => {
    setDeleting(true);
    try {
      await apiClient.delete(`/whatsapp-schedules/${s.id}`);
      fetchAll();
      toast.success("Schedule deleted");
      setDeleteTarget(null);
    } catch (e) {
      toast.error((e as Error).message || "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  const sendNow = async (s: ScheduleItem) => {
    setSendingId(s.id);
    try {
      await apiClient.post(`/whatsapp-schedules/${s.id}/send-now`);
      toast.success(s.channel === "telegram" ? "Report sent to Telegram" : "Report sent to WhatsApp");
      fetchAll();
    } catch (e) {
      toast.error((e as Error).message || "Send failed");
    } finally {
      setSendingId(null);
    }
  };

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 backdrop-blur-md p-4"
            onClick={closeModal}
          >
          <motion.div
            initial={{ scale: 0.96, y: 16, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.96, y: 16, opacity: 0 }}
            transition={{ type: "spring", damping: 26, stiffness: 300 }}
            className="w-full max-w-2xl max-h-[92vh] bg-white dark:bg-slate-900 rounded-3xl border border-gray-200 dark:border-slate-700/80 shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-100 dark:border-slate-800 flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-green-50 dark:bg-green-500/10 flex items-center justify-center shrink-0">
                <MessageCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-gray-900 dark:text-gray-100">{title}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
              </div>
              <button
                onClick={closeModal}
                className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-500 dark:text-gray-400"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
              {/* Connection status */}
              <div
                className={cn(
                  "rounded-2xl border p-4 flex flex-col sm:flex-row items-center gap-4",
                  status?.connected
                    ? "border-green-200 dark:border-green-500/30 bg-green-50 dark:bg-green-500/10"
                    : "border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10"
                )}
              >
                <div className="flex-1 text-center sm:text-left">
                  <p className={cn("font-semibold flex items-center justify-center sm:justify-start gap-2",
                    status?.connected ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400")}>
                    {loading && !status ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Checking WhatsApp service...</>
                    ) : status?.connected ? (
                      <><CheckCircle2 className="w-4 h-4" /> WhatsApp connected ({status.state})</>
                    ) : (
                      <><AlertCircle className="w-4 h-4" /> {status?.error ?? "Not connected — scan QR to link"}</>
                    )}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {status?.qr
                      ? "Scan the QR code below with WhatsApp (Linked Devices) to link this account."
                      : status?.state === "not_configured"
                        ? <span>WhatsApp not configured for this house. <button onClick={() => setShowConnectModal(true)} className="text-green-600 dark:text-green-400 underline font-medium">Setup WhatsApp</button></span>
                        : !status?.connected && !status?.qr
                          ? "Start the whatsapp-service container first. If a QR already appeared on the service logs, the session is still linking."
                          : "Reports will be delivered from this linked WhatsApp account."}
                  </p>
                </div>
                <button
                  onClick={fetchAll}
                  disabled={loading}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 dark:border-slate-600 text-sm hover:bg-white dark:hover:bg-slate-800 disabled:opacity-50"
                >
                  <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
                  Refresh
                </button>
              </div>

              {status?.qr && (
                <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800/40 p-4">
                  <Smartphone className="w-5 h-5 text-gray-400" />
                  <img src={status.qr} alt="WhatsApp QR" className="w-48 h-48 rounded-xl" />
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Open WhatsApp → Linked Devices → Link a Device → Scan
                  </p>
                </div>
              )}

              {/* Create / edit form */}
              <div className="rounded-2xl border border-gray-200 dark:border-slate-700/60 p-4 space-y-4">
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                  {editingId ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                  {editingId ? "Edit schedule" : "New schedule"}
                </p>

                {/* Channel selector */}
                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">
                    Delivery channel
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, channel: "whatsapp" }))}
                      className={cn(
                        "flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border text-sm min-h-[44px] transition-colors",
                        form.channel === "whatsapp"
                          ? "border-green-400 dark:border-green-500 bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-300 font-medium"
                          : "border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 text-gray-600 dark:text-gray-400"
                      )}
                    >
                      <MessageCircle className="w-4 h-4" />
                      WhatsApp
                    </button>
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, channel: "telegram" }))}
                      className={cn(
                        "flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border text-sm min-h-[44px] transition-colors",
                        form.channel === "telegram"
                          ? "border-sky-400 dark:border-sky-500 bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-300 font-medium"
                          : "border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 text-gray-600 dark:text-gray-400"
                      )}
                    >
                      <Send className="w-4 h-4" />
                      Telegram
                    </button>
                  </div>
                </div>

                {form.channel === "whatsapp" ? (
                  <div>
                    <div className="flex items-center gap-1 mb-3 bg-gray-100 dark:bg-slate-800 rounded-xl p-1">
                      <button
                        type="button"
                        onClick={() => setWaTargetTab("groups")}
                        className={cn(
                          "flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors",
                          waTargetTab === "groups"
                            ? "bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 shadow-sm"
                            : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                        )}
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        Groups ({groups.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setWaTargetTab("contacts")}
                        className={cn(
                          "flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors",
                          waTargetTab === "contacts"
                            ? "bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 shadow-sm"
                            : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                        )}
                      >
                        <User className="w-3.5 h-3.5" />
                        Contacts ({contacts.length})
                      </button>
                    </div>

                    {waTargetTab === "groups" ? (
                      <div>
                        <div className="relative mb-2">
                          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                          <input
                            type="text"
                            value={groupSearch}
                            onChange={(e) => setGroupSearch(e.target.value)}
                            placeholder="Search groups by name..."
                            className="w-full min-h-[40px] pl-9 pr-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                          />
                        </div>
                        {filteredGroups.length > 0 ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-44 overflow-y-auto pr-1">
                            {filteredGroups.map((g, gi) => (
                              <button
                                key={g.id || g.name || `group-${gi}`}
                                onClick={() => selectGroup(g.id)}
                                className={cn(
                                  "flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm text-left transition-colors min-h-[44px]",
                                  form.whatsapp_chat_id === g.id
                                    ? "border-green-400 dark:border-green-500 bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-300"
                                    : "border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 text-gray-700 dark:text-gray-300"
                                )}
                              >
                                <MessageCircle className="w-4 h-4 shrink-0" />
                                <span className="truncate">{g.name}</span>
                                {form.whatsapp_chat_id === g.id && <CheckCircle2 className="w-4 h-4 shrink-0 ml-auto" />}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-gray-400 bg-gray-50 dark:bg-slate-800/40 rounded-xl border border-dashed border-gray-200 dark:border-slate-700 px-3 py-3">
                            {groupSearch ? "No groups match your search" : !status?.connected ? "No groups available — link WhatsApp first" : "No groups available"}.
                          </p>
                        )}
                      </div>
                    ) : (
                      <div>
                        <div className="relative mb-2">
                          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                          <input
                            type="text"
                            value={contactSearch}
                            onChange={(e) => setContactSearch(e.target.value)}
                            placeholder="Search contacts by name or number..."
                            className="w-full min-h-[40px] pl-9 pr-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                          />
                        </div>
                        {filteredContacts.length > 0 ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-44 overflow-y-auto pr-1">
                            {filteredContacts.map((c) => (
                              <button
                                key={c.jid}
                                onClick={() => {
                                  setForm((f) => ({
                                    ...f,
                                    whatsapp_chat_id: c.jid,
                                    whatsapp_chat_name: contactDisplayName(c),
                                  }));
                                }}
                                className={cn(
                                  "flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm text-left transition-colors min-h-[44px]",
                                  form.whatsapp_chat_id === c.jid
                                    ? "border-green-400 dark:border-green-500 bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-300"
                                    : "border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 text-gray-700 dark:text-gray-300"
                                )}
                              >
                                <User className="w-4 h-4 shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <span className="truncate block">{contactDisplayName(c)}</span>
                                  {c.jid.includes("@s.whatsapp.net") && (
                                    <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate block">
                                      {c.jid.replace("@s.whatsapp.net", "")}
                                    </span>
                                  )}
                                </div>
                                {form.whatsapp_chat_id === c.jid && <CheckCircle2 className="w-4 h-4 shrink-0" />}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-gray-400 bg-gray-50 dark:bg-slate-800/40 rounded-xl border border-dashed border-gray-200 dark:border-slate-700 px-3 py-3">
                            {contactSearch ? "No contacts match your search" : "No contacts available"}.
                          </p>
                        )}
                        {contacts.length > 0 && (
                          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1.5">
                            {contactSearch
                              ? `${filteredContacts.length} of ${contacts.length} contacts shown`
                              : `Showing ${Math.min(contacts.length, 100)} of ${contacts.length} contacts — type to search`}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div
                    className={cn(
                      "rounded-2xl border p-4",
                      tgStatus?.success
                        ? "border-sky-200 dark:border-sky-500/30 bg-sky-50 dark:bg-sky-500/10"
                        : "border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10"
                    )}
                  >
                    {tgStatus?.success ? (
                      <>
                        <p className="text-sm font-medium text-sky-700 dark:text-sky-300 flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                          Bot @{tgStatus.bot?.username || tgStatus.bot?.name} ready
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
                          Report goes to the house&apos;s linked group:{" "}
                          <span className="font-mono">{tgStatus.chat_name || tgStatus.chat_id || "—"}</span>
                          {!tgStatus.chat_id && " (link it on the Telegram page)"}
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-amber-700 dark:text-amber-400 flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                        {tgStatus?.error ?? "Telegram not configured for this house"}
                        {" — "}
                        <button onClick={closeModal} className="underline font-medium shrink-0">Open Telegram page</button>
                      </p>
                    )}
                  </div>
                )}

                <div>
                  <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">
                    Send Frequency
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, schedule_type: "interval" }))}
                      className={cn(
                        "px-3 py-2.5 rounded-xl border text-sm min-h-[44px] transition-colors",
                        form.schedule_type === "interval"
                          ? "border-green-400 dark:border-green-500 bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-300"
                          : "border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 text-gray-600 dark:text-gray-400"
                      )}
                    >
                      <RefreshCw className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                      Repeat every N min
                    </button>
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, schedule_type: "daily" }))}
                      className={cn(
                        "px-3 py-2.5 rounded-xl border text-sm min-h-[44px] transition-colors",
                        form.schedule_type === "daily"
                          ? "border-green-400 dark:border-green-500 bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-300"
                          : "border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 text-gray-600 dark:text-gray-400"
                      )}
                    >
                      <Clock className="w-4 h-4 inline mr-1.5 -mt-0.5" />
                      Daily at HH:MM
                    </button>
                  </div>
                  {form.schedule_type === "interval" && (
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5">
                      Report automatically posts every N minutes to the selected group until you pause it.
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {form.schedule_type === "interval" ? (
                    <div>
                      <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">
                        Repeat every (minutes)
                      </label>
                      <div className="relative">
                        <RefreshCw className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                          type="number"
                          min={1}
                          max={1440}
                          value={form.interval_minutes}
                          onChange={(e) => setForm((f) => ({ ...f, interval_minutes: e.target.value }))}
                          className="w-full min-h-[44px] pl-9 pr-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">
                        Daily Send Time (24-hour)
                      </label>
                      <div className="relative">
                        <Clock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                          type="time"
                          value={form.schedule_time}
                          onChange={(e) => setForm((f) => ({ ...f, schedule_time: e.target.value }))}
                          className="w-full min-h-[44px] pl-9 pr-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                        />
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">
                      Caption (optional)
                    </label>
                    <input
                      type="text"
                      value={form.caption}
                      onChange={(e) => setForm((f) => ({ ...f, caption: e.target.value }))}
                      placeholder="e.g. Daily GA Live Report"
                      className="w-full min-h-[44px] px-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2">
                  {editingId && (
                    <button
                      onClick={() => { setEditingId(null); setForm(emptyForm); }}
                      className="px-4 min-h-[44px] rounded-xl border border-gray-200 dark:border-slate-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800"
                    >
                      Cancel
                    </button>
                  )}
                  {!editingId && (
                    <button
                      onClick={sendDirect}
                      disabled={directSending || loading}
                      className="flex items-center gap-2 px-4 min-h-[44px] rounded-xl border border-green-300 dark:border-green-500/40 bg-white dark:bg-slate-800 text-green-700 dark:text-green-400 text-sm font-medium hover:bg-green-50 dark:hover:bg-green-500/10 disabled:opacity-50"
                    >
                      {directSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                      Send Now
                    </button>
                  )}
                  <button
                    onClick={save}
                    disabled={loading || directSending}
                    className="flex items-center gap-2 px-4 min-h-[44px] rounded-xl bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    {editingId ? "Update schedule" : "Save schedule"}
                  </button>
                </div>
              </div>

              {/* Existing schedules */}
              <div>
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
                  <CalendarCheck className="w-4 h-4" />
                  Active schedules
                </p>
                {schedules.length === 0 ? (
                  <p className="text-sm text-gray-400 bg-gray-50 dark:bg-slate-800/30 rounded-xl border border-dashed border-gray-200 dark:border-slate-700 px-3 py-4 text-center">
                    No schedules yet — create one above.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {schedules.map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center gap-3 rounded-xl border border-gray-200 dark:border-slate-700/60 px-3 py-2.5"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm text-gray-800 dark:text-gray-200 truncate flex items-center gap-1.5">
                            {s.channel === "telegram" && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-sky-50 dark:bg-sky-500/10 text-sky-600 dark:text-sky-400 text-[10px] font-semibold shrink-0">
                                <Send className="w-2.5 h-2.5" />
                                TG
                              </span>
                            )}
                            <span className="truncate">{s.whatsapp_chat_name}</span>
                          </p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1 flex-wrap">
                            {s.schedule_type === "interval" ? (
                              <>
                                <RefreshCw className="w-3 h-3" />
                                every {s.interval_minutes} min
                              </>
                            ) : (
                              <>
                                <Clock className="w-3 h-3" />
                                daily {s.schedule_time}
                              </>
                            )}
                            {s.last_run_date && (
                              <span className="inline-flex items-center gap-1 ml-1">
                                <span className="text-gray-400">· last:</span>
                                {s.last_status === "success" ? (
                                  <span className="text-green-600 dark:text-green-400">success</span>
                                ) : (
                                  <span className="text-red-500">{s.last_status ?? "n/a"}</span>
                                )}
                              </span>
                            )}
                          </p>
                          {s.last_error && <p className="text-[11px] text-red-500 truncate mt-0.5">{s.last_error}</p>}
                        </div>
                        <button
                          onClick={() => sendNow(s)}
                          disabled={sendingId === s.id}
                          className="p-2 rounded-lg border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 min-h-[36px]"
                          title="Send now"
                        >
                          {sendingId === s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => startEdit(s)}
                          className="p-2 rounded-lg border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 min-h-[36px]"
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => toggle(s)}
                          disabled={togglingId === s.id}
                          className={cn(
                            "p-2 rounded-lg border min-h-[36px] disabled:opacity-50",
                            s.is_active
                              ? "border-green-200 dark:border-green-500/40 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-500/10"
                              : "border-gray-200 dark:border-slate-700 text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800"
                          )}
                          title={s.is_active ? "Pause schedule" : "Resume schedule"}
                        >
                          {togglingId === s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => setDeleteTarget(s)}
                          className="p-2 rounded-lg border border-red-200 dark:border-red-500/40 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 min-h-[36px]"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>
      <AnimatePresence>
        {deleteTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => !deleting && setDeleteTarget(null)}
          >
            <motion.div
              initial={{ scale: 0.94, y: 12, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.94, y: 12, opacity: 0 }}
              transition={{ type: "spring", damping: 26, stiffness: 320 }}
              className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 shadow-2xl p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-red-50 dark:bg-red-500/10 flex items-center justify-center shrink-0">
                  <AlertCircle className="w-5 h-5 text-red-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-gray-900 dark:text-gray-100">Delete schedule?</h4>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 break-words">
                    The report schedule for{" "}
                    <span className="font-medium text-gray-700 dark:text-gray-300">
                      {deleteTarget.whatsapp_chat_name}
                    </span>{" "}
                    will be permanently removed. This action cannot be undone.
                  </p>
                  <div className="flex items-center gap-1.5 flex-wrap mt-2 text-[11px] text-gray-400 dark:text-gray-500">
                    {deleteTarget.channel === "telegram" ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-sky-50 dark:bg-sky-500/10 text-sky-600 dark:text-sky-400 font-semibold">
                        <Send className="w-2.5 h-2.5" /> Telegram
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400 font-semibold">
                        <MessageCircle className="w-2.5 h-2.5" /> WhatsApp
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      {deleteTarget.schedule_type === "interval"
                        ? <><RefreshCw className="w-3 h-3" /> every {deleteTarget.interval_minutes} min</>
                        : <><Clock className="w-3 h-3" /> daily {deleteTarget.schedule_time}</>}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 mt-5">
                <button
                  onClick={() => setDeleteTarget(null)}
                  disabled={deleting}
                  className="px-4 min-h-[44px] rounded-xl border border-gray-200 dark:border-slate-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => remove(deleteTarget)}
                  disabled={deleting}
                  className="flex items-center gap-2 px-4 min-h-[44px] rounded-xl bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                >
                  {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <WhatsAppConnectModal
        open={showConnectModal}
        houseId={houseId}
        onClose={() => setShowConnectModal(false)}
        onConnected={() => { setShowConnectModal(false); fetchAll(); }}
      />
    </>
  );
}
