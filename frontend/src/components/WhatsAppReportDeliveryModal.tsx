"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Send, Clock, MessageCircle, Loader2, RefreshCw,
  Plus, Trash2, Power, CalendarCheck, AlertCircle, Smartphone,
  Pencil, CheckCircle2, User, Search, Copy, History, BellRing,
  Lock, ChevronDown, ChevronUp, CalendarDays, Wifi, WifiOff, ListChecks, Zap,
  Sunrise, Sunset,
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
  phone_number?: string;
  last_connected_at?: string;
  connection?: string;
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
  start_time: string | null;
  end_time: string | null;
  channel: string;
  report_type: string;
  whatsapp_chat_id: string;
  whatsapp_chat_name: string;
  target_ids: string[];
  target_names: string[];
  starts_on: string | null;
  ends_on: string | null;
  timezone_name: string;
  caption: string | null;
  is_active: boolean;
  last_run_date: string | null;
  last_status: string | null;
  last_error: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
}

interface DeliveryLog {
  id: number;
  schedule_id: number | null;
  house_id: number;
  report_type: string;
  channel: string;
  triggered_by: string;
  target_count: number;
  delivered_count: number;
  status: string;
  error: string | null;
  chat_names: string[];
  created_at: string | null;
}

interface FormState {
  schedule_type: "daily" | "interval";
  schedule_time: string;
  interval_minutes: string;
  start_time: string;
  end_time: string;
  channel: "whatsapp" | "telegram";
  caption: string;
  starts_on: string;
  ends_on: string;
  ends_never: boolean;
}

const REPORT_TITLES: Record<string, string> = {
  ga_live: "GA Live Report",
  active_lso: "Active LSO Report",
  active_sso: "Active SSO Report",
  activation: "Activation Report",
};

const REPORT_DEFAULT_CAPTIONS: Record<string, string> = {
  ga_live: "Daily GA Live Report",
  active_lso: "Daily Active LSO Report",
  active_sso: "Daily Active SSO Report",
  activation: "Daily Activation Report",
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const BST_MS = 6 * 3600 * 1000;

// Normalize a raw time value into "HH:MM" (24h). Returns "" for anything
// that isn't a valid time so no garbage (e.g. "11:undefined") can render.
const normalizeTime = (v: string): string => {
  const raw = (v ?? "").trim();
  if (!raw) return "";
  const m = /^(?:(?:[01]?\d|2[0-3])):([0-5]\d)(?::[0-5]\d)?$/.exec(raw);
  if (!m) return "";
  return `${raw.split(":")[0].padStart(2, "0")}:${m[1]}`;
};

const emptyForm: FormState = {
  schedule_type: "daily",
  schedule_time: "09:00",
  interval_minutes: "30",
  start_time: "08:00",
  end_time: "21:00",
  channel: "whatsapp",
  caption: "",
  starts_on: "",
  ends_on: "",
  ends_never: true,
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
  const [deliveryLogs, setDeliveryLogs] = useState<DeliveryLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [directSending, setDirectSending] = useState(false);
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScheduleItem | null>(null);
  const [sendNowTarget, setSendNowTarget] = useState<ScheduleItem | null>(null);
  const [showDirectConfirm, setShowDirectConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [waTargetTab, setWaTargetTab] = useState<"groups" | "contacts">("groups");
  const [contactSearch, setContactSearch] = useState("");
  const [groupSearch, setGroupSearch] = useState("");
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [historyOpen, setHistoryOpen] = useState(false);
  const router = useRouter();

  const houseHeader = houseId ? { "X-House-ID": String(houseId) } : {};

  const reportTitle = REPORT_TITLES[reportType] || reportType.replace(/_/g, " ");

  const fetchAll = useCallback(async () => {
    if (!houseId) return;
    const hH = { "X-House-ID": String(houseId) };
    const [statusRes, groupsRes, contactsRes, schedulesRes, tgRes, historyRes] = await Promise.allSettled([
      apiClient.get("/whatsapp/status", { headers: hH }),
      apiClient.get("/whatsapp/groups", { headers: hH }),
      apiClient.get("/whatsapp/contacts", { headers: hH }),
      apiClient.get("/whatsapp-schedules", {
        params: { house_id: houseId, report_type: reportType },
        headers: hH,
      }),
      apiClient.get("/telegram/status", { headers: hH }),
      apiClient.get("/whatsapp-schedules/history", {
        params: { house_id: houseId, report_type: reportType, limit: 30 },
        headers: hH,
      }),
    ]);
    if (statusRes.status === "fulfilled") setStatus(statusRes.value.data);
    else setStatus({ connected: false, state: "unreachable", error: "Service unreachable" });
    setGroups(groupsRes.status === "fulfilled" ? groupsRes.value.data?.data ?? [] : []);
    setContacts(contactsRes.status === "fulfilled" ? contactsRes.value.data?.data ?? [] : []);
    setSchedules(schedulesRes.status === "fulfilled" ? schedulesRes.value.data?.data ?? [] : []);
    setTgStatus(tgRes.status === "fulfilled" ? tgRes.value.data : null);
    setDeliveryLogs(historyRes.status === "fulfilled" ? historyRes.value.data?.data ?? [] : []);
  }, [houseId, reportType]);

  useEffect(() => {
    if (open && houseId) {
      Promise.resolve().then(() => fetchAll());
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
    setDeliveryLogs([]);
    setEditingId(null);
    setDeleteTarget(null);
    setSendNowTarget(null);
    setShowDirectConfirm(false);
    setForm(emptyForm);
    setWaTargetTab("groups");
    setContactSearch("");
    setGroupSearch("");
    setSelectedGroupIds(new Set());
    setSelectedContactIds(new Set());
    setHistoryOpen(false);
    onClose();
  };

  // ── Derived values ───────────────────────────────────────────────

  const overlayRoot = typeof document !== "undefined" ? document.body : null;
  const anyOverlayOpen = open || !!deleteTarget || !!sendNowTarget || showDirectConfirm;

  // Lock background scroll while any overlay is open so the page never
  // shifts/jumps behind the fixed backdrops during open/close animations.
  useEffect(() => {
    if (!anyOverlayOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [anyOverlayOpen]);

  const whatsappReady = status?.connected === true;
  const telegramReady = tgStatus?.success === true;
  const formLocked = form.channel === "telegram" ? !telegramReady : !whatsappReady;

  const refreshNow = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchAll();
    } finally {
      setRefreshing(false);
    }
  }, [fetchAll]);

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

  const selectedGroups = useMemo(
    () => groups.filter((g) => selectedGroupIds.has(g.id)),
    [groups, selectedGroupIds]
  );
  const selectedContacts = useMemo(
    () => contacts.filter((c) => selectedContactIds.has(c.jid)),
    [contacts, selectedContactIds]
  );
  const totalSelected = selectedGroupIds.size + selectedContactIds.size;

  const selectedRecipientLabels = useMemo(() => {
    const names = [
      ...selectedGroups.map((g) => g.name),
      ...selectedContacts.map((c) => contactDisplayName(c)),
    ];
    return names;
  }, [selectedGroups, selectedContacts]);

  const allGroupsVisibleSelected =
    filteredGroups.length > 0 && filteredGroups.every((g) => selectedGroupIds.has(g.id));
  const allContactsVisibleSelected =
    filteredContacts.length > 0 && filteredContacts.every((c) => selectedContactIds.has(c.jid));

  const intervalMinutes = parseInt(form.interval_minutes, 10);
  const dailyTimeValid = TIME_RE.test(form.schedule_time);
  const intervalValid = !isNaN(intervalMinutes) && intervalMinutes >= 1 && intervalMinutes <= 1440;
  const windowValid =
    !form.starts_on || !form.ends_on || form.starts_on <= form.ends_on || form.ends_never;
  const timeWindowValid =
    form.schedule_type !== "interval" ||
    (!form.start_time || !form.end_time || form.start_time <= form.end_time);

  const missingRequirements = useMemo(() => {
    const missing: string[] = [];
    if (form.channel === "whatsapp") {
      if (!whatsappReady) missing.push("Connect WhatsApp first");
      if (whatsappReady && totalSelected === 0) missing.push("Select at least one recipient");
    } else {
      if (!telegramReady) missing.push("Telegram is not configured for this house");
    }
    if (form.schedule_type === "interval" && !intervalValid) missing.push("Enter a valid repeat interval (1–1440 min)");
    if (form.schedule_type === "daily" && !dailyTimeValid) missing.push("Enter a valid delivery time");
    if (!windowValid) missing.push("End date cannot be before start date");
    if (!timeWindowValid) missing.push("Delivery window end time cannot be before start time");
    return missing;
  }, [form, whatsappReady, telegramReady, totalSelected, intervalValid, dailyTimeValid, windowValid, timeWindowValid]);

  const canSave = missingRequirements.length === 0;

  // ── Date/time helpers (naive BST calendar) ───────────────────────

  const bstNow = useCallback(() => new Date(Date.now() + BST_MS), []);

  const toAmPm = useCallback((hhmm: string): string => {
    const m = TIME_RE.exec(hhmm || "");
    if (!m) return "";
    let h = parseInt(m[1], 10);
    const mm = m[2];
    const suffix = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${h}:${mm} ${suffix}`;
  }, []);

  const fmtMedDate = useCallback((dateStr: string): string => {
    if (!dateStr) return "";
    try {
      return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    } catch {
      return dateStr;
    }
  }, []);

  const fmtLogTime = useCallback((iso: string | null): string => {
    if (!iso) return "";
    const dateStr = iso.slice(0, 10);
    const timeStr = iso.slice(11, 16);
    const todayMs = bstNow();
    const todayStr = todayMs.toISOString().slice(0, 10);
    const yesterday = new Date(todayMs.getTime() - 86400000);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);
    if (dateStr === todayStr) return `Today, ${toAmPm(timeStr)}`;
    if (dateStr === yesterdayStr) return `Yesterday, ${toAmPm(timeStr)}`;
    return `${fmtMedDate(dateStr)} ${toAmPm(timeStr)}`;
  }, [bstNow, toAmPm, fmtMedDate]);

  const summarizeNextDelivery = useCallback((): string => {
    if (form.channel === "telegram") return "Sends to the house's linked Telegram group";
    const today = bstNow().toISOString().slice(0, 10);
    const nowTime = bstNow().toISOString().slice(11, 16);
    const win = timeWindowValid && form.start_time && form.end_time
      ? ` · daily ${toAmPm(form.start_time)}–${toAmPm(form.end_time)}`
      : "";
    if (form.starts_on && form.starts_on > today) {
      if (form.schedule_type === "daily") {
        return dailyTimeValid
          ? `Starts ${fmtMedDate(form.starts_on)} at ${toAmPm(form.schedule_time)}`
          : `Starts ${fmtMedDate(form.starts_on)}`;
      }
      return `Starts ${fmtMedDate(form.starts_on)} · every ${intervalValid ? intervalMinutes : "…"} min${win}`;
    }
    if (form.schedule_type === "interval") {
      return `Every ${intervalValid ? intervalMinutes : "…"} min — starts on the next tick${win}`;
    }
    if (!dailyTimeValid) return "";
    const day = nowTime < form.schedule_time ? "Today" : "Tomorrow";
    return `Next delivery ${day} at ${toAmPm(form.schedule_time)}`;
  }, [form, bstNow, toAmPm, fmtMedDate, intervalValid, intervalMinutes, dailyTimeValid, timeWindowValid]);

  // ── Recipient selection ──────────────────────────────────────────

  const toggleGroup = (id: string) => {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleContact = (jid: string) => {
    setSelectedContactIds((prev) => {
      const next = new Set(prev);
      if (next.has(jid)) next.delete(jid);
      else next.add(jid);
      return next;
    });
  };

  const toggleAllGroups = () => {
    if (allGroupsVisibleSelected) {
      setSelectedGroupIds((prev) => {
        const next = new Set(prev);
        filteredGroups.forEach((g) => next.delete(g.id));
        return next;
      });
    } else {
      setSelectedGroupIds((prev) => {
        const next = new Set(prev);
        filteredGroups.forEach((g) => next.add(g.id));
        return next;
      });
    }
  };

  const toggleAllContacts = () => {
    if (allContactsVisibleSelected) {
      setSelectedContactIds((prev) => {
        const next = new Set(prev);
        filteredContacts.forEach((c) => next.delete(c.jid));
        return next;
      });
    } else {
      setSelectedContactIds((prev) => {
        const next = new Set(prev);
        filteredContacts.forEach((c) => next.add(c.jid));
        return next;
      });
    }
  };

  // ── CRUD ─────────────────────────────────────────────────────────

  const save = async () => {
    if (!houseId) return;
    if (form.channel === "whatsapp" && totalSelected === 0) {
      toast.error("Select at least one WhatsApp group or contact");
      return;
    }
    if (form.schedule_type === "interval" && !intervalValid) {
      toast.error("Repeat interval must be between 1 and 1440 minutes");
      return;
    }
    if (form.schedule_type === "daily" && !dailyTimeValid) {
      toast.error("Time must be in HH:MM (24-hour) format");
      return;
    }
    if (!windowValid) {
      toast.error("End date cannot be before start date");
      return;
    }
    if (!timeWindowValid) {
      toast.error("Delivery window end time cannot be before start time");
      return;
    }
    setLoading(true);
    try {
      const payload: Record<string, unknown> = {
        schedule_type: form.schedule_type,
        schedule_time: form.schedule_type === "daily" ? form.schedule_time || "00:00" : "00:00",
        interval_minutes: form.schedule_type === "interval" ? intervalMinutes : null,
        start_time:
          form.schedule_type === "interval"
            ? form.start_time.trim() || "00:00"
            : "00:00",
        end_time:
          form.schedule_type === "interval"
            ? form.end_time.trim() || "23:59"
            : "23:59",
        channel: form.channel,
        report_type: reportType,
        caption: form.caption || null,
        starts_on: form.starts_on || null,
        ends_on: form.ends_never || !form.ends_on ? null : form.ends_on,
        timezone_name: "Asia/Dhaka",
      };
      if (form.channel === "whatsapp") {
        const ids = [...selectedGroupIds, ...selectedContactIds];
        const names = [
          ...selectedGroups.map((g) => g.name),
          ...selectedContacts.map((c) => contactDisplayName(c)),
        ];
        payload.target_ids = ids;
        payload.target_names = names;
        payload.whatsapp_chat_id = ids[0] ?? null;
        payload.whatsapp_chat_name = names[0] ?? null;
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
      setSelectedGroupIds(new Set());
      setSelectedContactIds(new Set());
      fetchAll();
    } catch (e) {
      const msg = (e as Error).message || "Save failed";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const confirmDirectSend = async () => {
    if (!houseId) return;
    setDirectSending(true);
    try {
      const payload: Record<string, unknown> = {
        channel: form.channel,
        report_type: reportType,
        caption: form.caption || null,
      };
      if (form.channel === "whatsapp") {
        payload.whatsapp_chat_ids = [...selectedGroupIds, ...selectedContactIds];
        payload.whatsapp_chat_names = selectedRecipientLabels;
      }
      const res = await apiClient.post("/whatsapp-schedules/send-direct", payload, { headers: houseHeader });
      const delivered = (res.data?.data?.delivered_count ?? totalSelected) as number;
      toast.success(
        form.channel === "telegram"
          ? "Report sent to Telegram"
          : delivered === totalSelected
            ? `Report sent to ${delivered} recipient${delivered === 1 ? "" : "s"}`
            : `Report partially sent (${delivered}/${totalSelected})`
      );
      setShowDirectConfirm(false);
      fetchAll();
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
      schedule_type: s.schedule_type === "interval" ? "interval" : "daily",
      schedule_time: s.schedule_time || "09:00",
      interval_minutes: String(s.interval_minutes ?? 30),
      start_time: s.start_time || "08:00",
      end_time: s.end_time || "21:00",
      channel: s.channel === "telegram" ? "telegram" : "whatsapp",
      caption: s.caption ?? "",
      starts_on: s.starts_on ?? "",
      ends_on: s.ends_on ?? "",
      ends_never: !s.ends_on,
    });
    setWaTargetTab("groups");
    const selGroups = new Set<string>();
    const selContacts = new Set<string>();
    for (const id of s.target_ids ?? []) {
      if (groups.some((g) => g.id === id)) selGroups.add(id);
      else selContacts.add(id);
    }
    setSelectedGroupIds(selGroups);
    setSelectedContactIds(selContacts);
    setGroupSearch("");
    setContactSearch("");
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

  const duplicate = async (s: ScheduleItem) => {
    setDuplicatingId(s.id);
    try {
      await apiClient.post(`/whatsapp-schedules/${s.id}/duplicate`);
      toast.success("Schedule duplicated");
      fetchAll();
    } catch (e) {
      toast.error((e as Error).message || "Duplicate failed");
    } finally {
      setDuplicatingId(null);
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
      setSendNowTarget(null);
      fetchAll();
    } catch (e) {
      toast.error((e as Error).message || "Send failed");
    } finally {
      setSendingId(null);
    }
  };

  const scheduleDesc = (s: ScheduleItem): string => {
    if (s.schedule_type === "interval") {
      const win =
        s.start_time && s.end_time
          ? ` · ${toAmPm(s.start_time)}–${toAmPm(s.end_time)}`
          : "";
      return `Every ${s.interval_minutes} min${win}`;
    }
    const t = toAmPm(s.schedule_time);
    return t ? `Daily at ${t}` : "Daily";
  };

  const scheduleRecipientsLabel = (s: ScheduleItem): string => {
    const names = s.target_names?.length ? s.target_names : [s.whatsapp_chat_name];
    const count = names.length;
    const kind = s.channel === "telegram" ? "group" : count > 1 ? "recipients" : "group";
    return count > 1 ? `${count} ${kind}` : names[0] || "1 group";
  };

  // ── Render helpers ───────────────────────────────────────────────

  const renderStatusBanner = () => {
    const connected = whatsappReady;
    return (
      <div
        className={cn(
          "rounded-2xl border p-4 flex flex-col sm:flex-row items-center gap-4",
          connected
            ? "border-green-200 dark:border-green-500/30 bg-green-50 dark:bg-green-500/10"
            : "border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10"
        )}
      >
        <div className="flex-1 min-w-0 text-center sm:text-left">
          <p
            className={cn(
              "font-semibold flex items-center justify-center sm:justify-start gap-2",
              connected ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400"
            )}
          >
            {!status ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Checking WhatsApp service...</>
            ) : connected ? (
              <><CheckCircle2 className="w-4 h-4 shrink-0" /> WhatsApp connected</>
            ) : (
              <><AlertCircle className="w-4 h-4 shrink-0" /> {status?.error ?? "WhatsApp not connected"}</>
            )}
          </p>
          {connected ? (
            <div className="mt-1 space-y-0.5 text-sm text-gray-600 dark:text-gray-300">
              {status?.phone_number && (
                <p className="font-mono text-xs">{status.phone_number}</p>
              )}
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {status?.last_connected_at
                  ? `Last synced ${fmtLogTime(status.last_connected_at)}`
                  : "Reports will be delivered from this linked WhatsApp account."}
                {status?.connection ? ` · ${status.connection}` : ""}
              </p>
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {status?.qr
                ? "Scan the QR code below with WhatsApp (Linked Devices) to link this account."
                : status?.state === "not_configured"
                  ? "Connect a WhatsApp account to select groups and schedule report delivery."
                  : "Connect WhatsApp to schedule automated report delivery."}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={refreshNow}
            disabled={refreshing}
            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 dark:border-slate-600 text-sm hover:bg-white dark:hover:bg-slate-800 disabled:opacity-50"
          >
            <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
            Refresh
          </button>
          <button
            onClick={() => setShowConnectModal(true)}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium min-h-[40px]",
              connected
                ? "border border-gray-200 dark:border-slate-600 text-gray-700 dark:text-gray-300 hover:bg-white dark:hover:bg-slate-800"
                : "bg-green-600 text-white hover:bg-green-700"
            )}
          >
            {connected ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
            {connected ? "Manage" : "Connect WhatsApp"}
          </button>
        </div>
      </div>
    );
  };

  const renderLockBanner = () => (
    <div className="rounded-xl border border-dashed border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 px-4 py-3 flex items-center gap-3 flex-wrap">
      <Lock className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
          {form.channel === "telegram" ? "Telegram not configured" : "WhatsApp not connected"}
        </p>
        <p className="text-xs text-amber-600/80 dark:text-amber-400/80">
          {form.channel === "telegram"
            ? "Link a Telegram group for this house to schedule report delivery."
            : "Connect a WhatsApp account to select groups and schedule report delivery."}
        </p>
      </div>
      {form.channel === "whatsapp" && (
        <button
          onClick={() => setShowConnectModal(true)}
          className="flex items-center gap-2 px-4 min-h-[44px] rounded-xl bg-green-600 text-white text-sm font-medium hover:bg-green-700"
        >
          <Wifi className="w-4 h-4" />
          Connect WhatsApp
        </button>
      )}
    </div>
  );

  const renderRecipientPicker = () => {
    const tab = waTargetTab;
    return (
      <div>
        <div className="flex items-center justify-between mb-1.5 flex-wrap gap-2">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
            Recipients
          </label>
          {totalSelected > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400 text-xs font-semibold">
              <ListChecks className="w-3.5 h-3.5" />
              Selected: {totalSelected}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 mb-3 bg-gray-100 dark:bg-slate-800 rounded-xl p-1">
          <button
            type="button"
            onClick={() => setWaTargetTab("groups")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors",
              tab === "groups"
                ? "bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            )}
          >
            <MessageCircle className="w-3.5 h-3.5" />
            WhatsApp Groups ({groups.length})
          </button>
          <button
            type="button"
            onClick={() => setWaTargetTab("contacts")}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors",
              tab === "contacts"
                ? "bg-white dark:bg-slate-700 text-gray-900 dark:text-gray-100 shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            )}
          >
            <User className="w-3.5 h-3.5" />
            Contacts ({contacts.length})
          </button>
        </div>

        {tab === "groups" ? (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={groupSearch}
                  onChange={(e) => setGroupSearch(e.target.value)}
                  placeholder="Search groups by name..."
                  className="w-full min-h-[40px] pl-9 pr-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                />
              </div>
              {filteredGroups.length > 0 && (
                <button
                  type="button"
                  onClick={toggleAllGroups}
                  className="px-2.5 min-h-[40px] rounded-xl border border-gray-200 dark:border-slate-700 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 shrink-0"
                >
                  {allGroupsVisibleSelected ? "Deselect all" : "Select all"}
                </button>
              )}
            </div>
            {filteredGroups.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-44 overflow-y-auto pr-1">
                {filteredGroups.map((g, gi) => (
                  <button
                    key={g.id || g.name || `group-${gi}`}
                    type="button"
                    onClick={() => toggleGroup(g.id)}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm text-left transition-colors min-h-[44px]",
                      selectedGroupIds.has(g.id)
                        ? "border-green-400 dark:border-green-500 bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-300"
                        : "border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 text-gray-700 dark:text-gray-300"
                    )}
                  >
                    <MessageCircle className="w-4 h-4 shrink-0" />
                    <span className="truncate flex-1">{g.name}</span>
                    {selectedGroupIds.has(g.id) && <CheckCircle2 className="w-4 h-4 shrink-0" />}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 bg-gray-50 dark:bg-slate-800/40 rounded-xl border border-dashed border-gray-200 dark:border-slate-700 px-3 py-3">
                {groupSearch ? "No groups match your search" : !whatsappReady ? "No groups available — link WhatsApp first" : "No groups available"}.
              </p>
            )}
          </div>
        ) : (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  placeholder="Search contacts by name or number..."
                  className="w-full min-h-[40px] pl-9 pr-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                />
              </div>
              {filteredContacts.length > 0 && (
                <button
                  type="button"
                  onClick={toggleAllContacts}
                  className="px-2.5 min-h-[40px] rounded-xl border border-gray-200 dark:border-slate-700 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 shrink-0"
                >
                  {allContactsVisibleSelected ? "Deselect all" : "Select all"}
                </button>
              )}
            </div>
            {filteredContacts.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-44 overflow-y-auto pr-1">
                {filteredContacts.map((c) => (
                  <button
                    key={c.jid}
                    type="button"
                    onClick={() => toggleContact(c.jid)}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm text-left transition-colors min-h-[44px]",
                      selectedContactIds.has(c.jid)
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
                    {selectedContactIds.has(c.jid) && <CheckCircle2 className="w-4 h-4 shrink-0" />}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 bg-gray-50 dark:bg-slate-800/40 rounded-xl border border-dashed border-gray-200 dark:border-slate-700 px-3 py-3">
                {contactSearch ? "No contacts match your search" : !whatsappReady ? "No contacts available — link WhatsApp first" : "No contacts available"}.
              </p>
            )}
          </div>
        )}

        {/* Selected recipients preview */}
        {totalSelected > 0 && (
          <div className="mt-3 rounded-xl border border-green-200 dark:border-green-500/30 bg-green-50 dark:bg-green-500/10 px-3 py-2.5">
            <p className="text-xs font-semibold text-green-700 dark:text-green-400 mb-1.5">
              Selected recipients ({totalSelected})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {selectedRecipientLabels.slice(0, 5).map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white dark:bg-slate-800 border border-green-200 dark:border-green-500/30 text-[11px] text-gray-700 dark:text-gray-300"
                >
                  {name}
                </span>
              ))}
              {selectedRecipientLabels.length > 5 && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-white dark:bg-slate-800 border border-green-200 dark:border-green-500/30 text-[11px] text-gray-500 dark:text-gray-400">
                  +{selectedRecipientLabels.length - 5} more
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderCaptionField = () => (
    <div>
      <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">
        Caption (optional)
      </label>
      <input
        type="text"
        value={form.caption}
        onChange={(e) => setForm((f) => ({ ...f, caption: e.target.value }))}
        placeholder={REPORT_DEFAULT_CAPTIONS[reportType] || `Daily ${reportTitle}`}
        className="w-full min-h-[44px] px-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
      />
    </div>
  );

  const renderSummary = () => (
    <div className={cn(
      "rounded-2xl border p-4 space-y-2",
      canSave
        ? "border-blue-200 dark:border-blue-500/30 bg-blue-50/60 dark:bg-blue-500/5"
        : "border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/40"
    )}>
      <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
        <BellRing className="w-4 h-4" />
        Schedule summary
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500 dark:text-gray-400">Report</dt>
          <dd className="font-medium text-gray-800 dark:text-gray-200 text-right">{reportTitle}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500 dark:text-gray-400">Channel</dt>
          <dd className="font-medium text-gray-800 dark:text-gray-200 text-right">
            {form.channel === "telegram" ? "Telegram" : "WhatsApp"}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500 dark:text-gray-400">Recipients</dt>
          <dd className="font-medium text-gray-800 dark:text-gray-200 text-right">
            {form.channel === "telegram"
              ? tgStatus?.chat_name || "House Telegram group"
              : totalSelected === 0
                ? "—"
                : `${totalSelected} ${totalSelected === 1 ? "recipient" : "recipients"}`}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500 dark:text-gray-400">Frequency</dt>
          <dd className="font-medium text-gray-800 dark:text-gray-200 text-right">
            {form.schedule_type === "interval"
              ? `Every ${intervalValid ? intervalMinutes : "…"} minutes`
              : dailyTimeValid
                ? `Daily at ${toAmPm(form.schedule_time)}`
                : ""}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500 dark:text-gray-400">Window</dt>
          <dd className="font-medium text-gray-800 dark:text-gray-200 text-right">
            {form.schedule_type === "interval"
              ? timeWindowValid && form.start_time && form.end_time
                ? `${toAmPm(form.start_time)} – ${toAmPm(form.end_time)}`
                : "—"
              : "Unrestricted"}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500 dark:text-gray-400">Timezone</dt>
          <dd className="font-medium text-gray-800 dark:text-gray-200 text-right">Asia/Dhaka (UTC+6)</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-gray-500 dark:text-gray-400">Duration</dt>
          <dd className="font-medium text-gray-800 dark:text-gray-200 text-right">
            {!form.starts_on ? "From now" : `From ${fmtMedDate(form.starts_on)}`}
            {form.ends_never || !form.ends_on ? " · Never ends" : ` · Until ${fmtMedDate(form.ends_on)}`}
          </dd>
        </div>
        {form.caption && (
          <div className="col-span-2 flex justify-between gap-2">
            <dt className="text-gray-500 dark:text-gray-400">Caption</dt>
            <dd className="font-medium text-gray-800 dark:text-gray-200 text-right truncate max-w-[60%]">{form.caption}</dd>
          </div>
        )}
      </dl>
      <p className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1.5 pt-1.5 border-t border-gray-200 dark:border-slate-700">
        <CalendarCheck className="w-3.5 h-3.5" />
        {summarizeNextDelivery()}
      </p>
    </div>
  );

  const renderSchedules = () => (
    <div>
      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2">
        <CalendarCheck className="w-4 h-4" />
        Active schedules
        {schedules.length > 0 && (
          <span className="text-[11px] font-medium text-gray-400 dark:text-gray-500">({schedules.length})</span>
        )}
      </p>
      {schedules.length === 0 ? (
        <p className="text-sm text-gray-400 bg-gray-50 dark:bg-slate-800/30 rounded-xl border border-dashed border-gray-200 dark:border-slate-700 px-3 py-4 text-center">
          No schedules yet — create one above.
        </p>
      ) : (
        <div className="space-y-2">
          {schedules.map((s) => {
            const isTelegram = s.channel === "telegram";
            const recipientsLabel = scheduleRecipientsLabel(s);
            return (
              <div key={s.id} className="rounded-xl border border-gray-200 dark:border-slate-700/60 px-4 py-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm text-gray-800 dark:text-gray-200">
                        {s.report_type === reportType ? reportTitle : REPORT_TITLES[s.report_type] || s.report_type}
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold",
                          isTelegram
                            ? "bg-sky-50 dark:bg-sky-500/10 text-sky-600 dark:text-sky-400"
                            : "bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400"
                        )}
                      >
                        {isTelegram ? <Send className="w-2.5 h-2.5" /> : <MessageCircle className="w-2.5 h-2.5" />}
                        {isTelegram ? "Telegram" : "WhatsApp"}
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold",
                          s.is_active
                            ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-gray-400"
                        )}
                      >
                        {s.is_active ? "Active" : "Paused"}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1 flex items-center gap-1 flex-wrap">
                      <span className="font-medium text-gray-600 dark:text-gray-300">{recipientsLabel}</span>
                      <span className="text-gray-300 dark:text-slate-600">·</span>
                      {s.schedule_type === "interval" ? (
                        <><RefreshCw className="w-3 h-3" /> {scheduleDesc(s)}</>
                      ) : (
                        <><Clock className="w-3 h-3" /> {scheduleDesc(s)}</>
                      )}
                      {s.next_run_at && s.is_active && (
                        <>
                          <span className="text-gray-300 dark:text-slate-600">·</span>
                          <span className="flex items-center gap-1 text-gray-500 dark:text-gray-400">
                            <BellRing className="w-3 h-3" /> Next {fmtLogTime(s.next_run_at)}
                          </span>
                        </>
                      )}
                      {s.last_status && (
                        <>
                          <span className="text-gray-300 dark:text-slate-600">·</span>
                          <span className={s.last_status === "success" ? "text-green-600 dark:text-green-400" : "text-red-500"}>
                            {s.last_status === "success" ? "Last OK" : "Last failed"}
                          </span>
                        </>
                      )}
                    </p>
                    {s.last_error && <p className="text-[11px] text-red-500 truncate mt-0.5">{s.last_error}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  <button
                    onClick={() => setSendNowTarget(s)}
                    disabled={sendingId === s.id}
                    className="p-2 rounded-lg border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 min-h-[36px]"
                    title="Send now"
                  >
                    {sendingId === s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
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
                    onClick={() => duplicate(s)}
                    disabled={duplicatingId === s.id}
                    className="p-2 rounded-lg border border-gray-200 dark:border-slate-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 min-h-[36px]"
                    title="Duplicate"
                  >
                    {duplicatingId === s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => setDeleteTarget(s)}
                    className="p-2 rounded-lg border border-red-200 dark:border-red-500/40 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 min-h-[36px] ml-auto"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const renderDeliveryHistory = () => (
    <div>
      <button
        type="button"
        onClick={() => setHistoryOpen((v) => !v)}
        className="w-full text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-2 hover:text-gray-900 dark:hover:text-gray-100"
      >
        <History className="w-4 h-4" />
        Delivery history
        {deliveryLogs.length > 0 && (
          <span className="text-[11px] font-medium text-gray-400 dark:text-gray-500">({deliveryLogs.length})</span>
        )}
        <span className="ml-auto text-gray-400 dark:text-gray-500">
          {historyOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </button>
      {!historyOpen ? null : deliveryLogs.length === 0 ? (
        <p className="text-sm text-gray-400 bg-gray-50 dark:bg-slate-800/30 rounded-xl border border-dashed border-gray-200 dark:border-slate-700 px-3 py-4 text-center">
          No delivery activity yet. Deliveries will appear here.
        </p>
      ) : (
        <div className="rounded-xl border border-gray-200 dark:border-slate-700/60 divide-y divide-gray-100 dark:divide-slate-800">
          {deliveryLogs.slice(0, 12).map((log) => (
            <div key={log.id} className="px-4 py-2.5 flex items-center gap-3">
              <span
                className={cn(
                  "w-2 h-2 rounded-full shrink-0",
                  log.status === "success"
                    ? "bg-green-500"
                    : log.status === "partial"
                      ? "bg-amber-500"
                      : "bg-red-500"
                )}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  <span className={cn("font-medium", log.status === "success" ? "text-green-600 dark:text-green-400" : log.status === "partial" ? "text-amber-600 dark:text-amber-400" : "text-red-500")}>
                    {log.status === "success"
                      ? `Delivered to ${log.delivered_count} ${log.target_count > 1 ? "groups" : "recipient"}`
                      : log.status === "partial"
                        ? `Partially delivered (${log.delivered_count}/${log.target_count})`
                        : "Failed"}
                  </span>
                  {log.error && <span className="text-xs text-gray-500 dark:text-gray-400 ml-1 truncate">— {log.error}</span>}
                </p>
                {log.chat_names.length > 0 && (
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
                    {log.chat_names.join(", ")}
                  </p>
                )}
              </div>
              <div className="text-right shrink-0">
                <p className="text-[11px] text-gray-500 dark:text-gray-400">{fmtLogTime(log.created_at)}</p>
                {log.triggered_by === "manual" && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[10px] font-semibold">
                    manual
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <>
      {overlayRoot && createPortal(
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
              {/* Channel selector */}
              <div className="rounded-2xl border border-gray-200 dark:border-slate-700/60 p-4">
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

              {status?.qr && (
                <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800/40 p-4">
                  <Smartphone className="w-5 h-5 text-gray-400" />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
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

                {formLocked && form.channel !== "telegram" && renderLockBanner()}

                {/* Connection status — always interactive, never dimmed */}
                {form.channel === "whatsapp" ? (
                  renderStatusBanner()
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
                      <div className="flex items-start gap-3">
                        <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                            {tgStatus?.error ?? "No Telegram bot assigned to this house"}
                          </p>
                          <p className="text-xs text-amber-600/80 dark:text-amber-400/80 mt-0.5">
                            Link a Telegram group for this house to schedule report delivery.
                          </p>
                        </div>
                        <button
                          onClick={() => router.push("/telegram")}
                          className="flex items-center gap-2 px-4 min-h-[44px] rounded-xl bg-sky-600 text-white text-sm font-medium hover:bg-sky-700 shrink-0"
                        >
                          <Pencil className="w-4 h-4" />
                          Open Telegram page
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <div className={cn("space-y-4", formLocked && "opacity-50 pointer-events-none select-none")}>
                  {form.channel === "whatsapp" && renderRecipientPicker()}

                  {/* Frequency */}
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">
                      Schedule
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, schedule_type: "daily" }))}
                        className={cn(
                          "flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border text-sm min-h-[44px] transition-colors",
                          form.schedule_type === "daily"
                            ? "border-green-400 dark:border-green-500 bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-300 font-medium"
                            : "border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 text-gray-600 dark:text-gray-400"
                        )}
                      >
                        <Clock className="w-4 h-4" />
                        Daily at a fixed time
                        <span className="text-[10px] font-bold px-1 py-0.5 rounded bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300 ml-auto shrink-0">
                          Recommended
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, schedule_type: "interval" }))}
                        className={cn(
                          "flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border text-sm min-h-[44px] transition-colors",
                          form.schedule_type === "interval"
                            ? "border-green-400 dark:border-green-500 bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-300"
                            : "border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800 text-gray-600 dark:text-gray-400"
                        )}
                      >
                        <RefreshCw className="w-4 h-4" />
                        Repeat every N min
                      </button>
                    </div>
                    {form.schedule_type === "interval" && (
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5">
                        Report repeatedly posts every N minutes, only inside the daily delivery window.
                      </p>
                    )}
                  </div>

                  {/* Duration */}
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block flex items-center gap-2">
                      <CalendarDays className="w-3.5 h-3.5" />
                      Duration
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-[11px] text-gray-500 dark:text-gray-400 mb-1 block">Starts on</label>
                        <input
                          type="date"
                          value={form.starts_on}
                          onChange={(e) => setForm((f) => ({ ...f, starts_on: e.target.value }))}
                          className="w-full min-h-[44px] px-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-gray-500 dark:text-gray-400 mb-1 block">Ends on</label>
                        <input
                          type="date"
                          value={form.ends_on}
                          disabled={form.ends_never}
                          onChange={(e) => setForm((f) => ({ ...f, ends_on: e.target.value }))}
                          className="w-full min-h-[44px] px-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500/40 disabled:opacity-40"
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, ends_never: !f.ends_never, ends_on: f.ends_never ? "" : f.ends_on }))}
                      className={cn(
                        "mt-3 flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-lg border min-h-[28px]",
                        form.ends_never
                          ? "border-green-200 dark:border-green-500/40 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/10"
                          : "border-gray-200 dark:border-slate-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800"
                      )}
                    >
                      <CheckCircle2 className={cn("w-3 h-3", !form.ends_never && "opacity-30")} />
                      Never expires
                    </button>
                  </div>

                  {/* Delivery time (daily mode) */}
                  {form.schedule_type === "daily" && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 block">
                          Delivery time
                        </label>
                        <div className="relative">
                          <Clock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                          <input
                            type="time"
                            value={form.schedule_time}
                            onChange={(e) => setForm((f) => ({ ...f, schedule_time: normalizeTime(e.target.value) }))}
                            className="w-full min-h-[44px] pl-9 pr-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                          />
                        </div>
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5">
                          Timezone: <span className="font-medium">Asia/Dhaka (UTC+6)</span>
                        </p>
                      </div>
                      {renderCaptionField()}
                    </div>
                  )}

                  {/* Daily delivery window (interval only) */}
                  {form.schedule_type === "interval" && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                        Daily delivery window
                      </p>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-[11px] text-gray-500 dark:text-gray-400 mb-1 block">
                            Start time
                          </label>
                          <div className="relative">
                            <Sunrise className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                              type="time"
                              value={form.start_time || ""}
                              onChange={(e) => setForm((f) => ({ ...f, start_time: normalizeTime(e.target.value) }))}
                              className="w-full min-h-[44px] pl-9 pr-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="text-[11px] text-gray-500 dark:text-gray-400 mb-1 block">
                            End time
                          </label>
                          <div className="relative">
                            <Sunset className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                              type="time"
                              value={form.end_time || ""}
                              onChange={(e) => setForm((f) => ({ ...f, end_time: normalizeTime(e.target.value) }))}
                              className="w-full min-h-[44px] pl-9 pr-3 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-primary-500/40"
                            />
                          </div>
                        </div>
                      </div>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5">
                        Reports only send inside this window daily — so no midnight / early-morning deliveries.
                      </p>
                      {!timeWindowValid && (
                        <p className="text-[11px] text-red-500 mt-1">End time cannot be before start time</p>
                      )}
                    </div>
                  )}

                  {/* Repeat interval + Caption (interval only, below the window) */}
                  {form.schedule_type === "interval" && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5">
                          First report sends as soon as the daily window opens after saving
                        </p>
                      </div>
                      {renderCaptionField()}
                    </div>
                  )}
                </div>

                {/* Schedule summary preview */}
                {!editingId && renderSummary()}

                {/* Actions */}
                {missingRequirements.length > 0 && (
                  <div className="rounded-xl border border-amber-200 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400 space-y-0.5">
                    {missingRequirements.map((m) => (
                      <p key={m}>• {m}</p>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-end gap-2 mt-2">
                  {editingId && (
                    <button
                      onClick={() => { setEditingId(null); setForm(emptyForm); setSelectedGroupIds(new Set()); setSelectedContactIds(new Set()); }}
                      className="px-4 min-h-[44px] rounded-xl border border-gray-200 dark:border-slate-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800"
                    >
                      Cancel
                    </button>
                  )}
                  {!editingId && (
                    <button
                      onClick={() => setShowDirectConfirm(true)}
                      disabled={!canSave || directSending || loading}
                      className="flex items-center gap-2 px-4 min-h-[44px] rounded-xl border border-green-300 dark:border-green-500/40 bg-white dark:bg-slate-800 text-green-700 dark:text-green-400 text-sm font-medium hover:bg-green-50 dark:hover:bg-green-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {directSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                      Send Now
                    </button>
                  )}
                  <button
                    onClick={save}
                    disabled={!canSave || loading || directSending}
                    className="flex items-center gap-2 px-4 min-h-[44px] rounded-xl bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    {editingId ? "Update schedule" : "Save schedule"}
                  </button>
                </div>
              </div>

              {/* Existing schedules */}
              {renderSchedules()}

              {/* Delivery history */}
              {renderDeliveryHistory()}
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>
      , overlayRoot)}

      {/* Delete confirmation */}
      {overlayRoot && createPortal(
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
                      {scheduleRecipientsLabel(deleteTarget)}
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
      , overlayRoot)}

      {/* Send-now confirmation */}
      {overlayRoot && createPortal(
      <AnimatePresence>
        {sendNowTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => !sendingId && setSendNowTarget(null)}
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
                <div className="w-10 h-10 rounded-xl bg-green-50 dark:bg-green-500/10 flex items-center justify-center shrink-0">
                  <Zap className="w-5 h-5 text-green-600 dark:text-green-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-gray-900 dark:text-gray-100">Send report now?</h4>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    This report will be sent to{" "}
                    <span className="font-medium text-gray-700 dark:text-gray-300">
                      {scheduleRecipientsLabel(sendNowTarget)}
                    </span>
                    {sendNowTarget.caption ? ` with caption "${sendNowTarget.caption}"` : ""} right now.
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 mt-5">
                <button
                  onClick={() => setSendNowTarget(null)}
                  disabled={sendingId === sendNowTarget.id}
                  className="px-4 min-h-[44px] rounded-xl border border-gray-200 dark:border-slate-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={() => sendNow(sendNowTarget)}
                  disabled={sendingId === sendNowTarget.id}
                  className="flex items-center gap-2 px-4 min-h-[44px] rounded-xl bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                >
                  {sendingId === sendNowTarget.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Send report
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      , overlayRoot)}

      {/* Direct send confirmation (unsaved form) */}
      {overlayRoot && createPortal(
      <AnimatePresence>
        {showDirectConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => !directSending && setShowDirectConfirm(false)}
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
                <div className="w-10 h-10 rounded-xl bg-green-50 dark:bg-green-500/10 flex items-center justify-center shrink-0">
                  <Zap className="w-5 h-5 text-green-600 dark:text-green-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-gray-900 dark:text-gray-100">Send {reportTitle} now?</h4>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    This report will be sent to{" "}
                    <span className="font-medium text-gray-700 dark:text-gray-300">
                      {form.channel === "telegram"
                        ? tgStatus?.chat_name || "the house Telegram group"
                        : `${totalSelected} recipient${totalSelected === 1 ? "" : "s"}`}
                    </span>{" "}
                    right now. This does not create a schedule.
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 mt-5">
                <button
                  onClick={() => setShowDirectConfirm(false)}
                  disabled={directSending}
                  className="px-4 min-h-[44px] rounded-xl border border-gray-200 dark:border-slate-700 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDirectSend}
                  disabled={directSending}
                  className="flex items-center gap-2 px-4 min-h-[44px] rounded-xl bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                >
                  {directSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Send report
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      , overlayRoot)}

      <WhatsAppConnectModal
        open={showConnectModal}
        houseId={houseId}
        onClose={() => setShowConnectModal(false)}
        onConnected={() => { setShowConnectModal(false); fetchAll(); }}
      />
    </>
  );
}