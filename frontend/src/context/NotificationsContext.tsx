"use client";

/**
 * In-app notifications shared by the header bell and the sidebar badges.
 *
 * The feed is per-user (`/api/v1/notifications`), so a user only ever sees their
 * own rows. Super admins receive a row when a house submits a payment request
 * that is awaiting approval.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import apiClient from "@/lib/api";
import { useAuth } from "./AuthContext";

export interface AppNotification {
  id: number;
  type: string;
  title: string;
  message: string | null;
  link: string | null;
  house_id: number | null;
  record_id: number | null;
  payload: Record<string, unknown>;
  is_read: boolean;
  read_at: string | null;
  created_at: string | null;
}

interface NotificationsState {
  count: number;
  total: number;
  items: AppNotification[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  refreshCount: () => Promise<void>;
  loadFeed: () => Promise<void>;
  loadMore: () => Promise<void>;
  markRead: (id: number) => Promise<void>;
  markAllRead: () => Promise<void>;
}

// Nav routes whose sidebar entry shows the unread count as a badge.
export const SIDEBAR_BADGE_ROUTES: Record<string, true> = {
  "/admin/payments": true,
};

const NotificationsContext = createContext<NotificationsState | undefined>(undefined);

// Polling keeps the badge honest without a websocket. 60s is frequent enough
// for an approval queue and cheap enough to leave open on every page.
const POLL_INTERVAL_MS = 60_000;
const FEED_LIMIT = 10;

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [count, setCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const refreshCount = useCallback(async () => {
    if (!user) return;
    try {
      const res = await apiClient.get("v1/notifications/unread-count");
      setCount(Number(res.data?.data?.count ?? 0));
    } catch {
      /* a badge must never break the page */
    }
  }, [user]);

  const loadFeed = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await apiClient.get("v1/notifications", {
        params: { page: 1, per_page: FEED_LIMIT },
      });
      setItems(res.data?.data ?? []);
      setCount(Number(res.data?.unread_count ?? 0));
      setTotal(Number(res.data?.pagination?.total ?? 0));
    } catch {
      /* keep the previous feed on a transient failure */
    } finally {
      setLoading(false);
    }
  }, [user]);

  const loadMore = useCallback(async () => {
    if (!user || loadingMore) return;
    const nextPage = Math.floor(items.length / FEED_LIMIT) + 1;
    setLoadingMore(true);
    try {
      const res = await apiClient.get("v1/notifications", {
        params: { page: nextPage, per_page: FEED_LIMIT },
      });
      const fetched: AppNotification[] = res.data?.data ?? [];
      setItems((prev) => {
        const seen = new Set(prev.map((item) => item.id));
        return [...prev, ...fetched.filter((item) => !seen.has(item.id))];
      });
      setCount(Number(res.data?.unread_count ?? 0));
      setTotal(Number(res.data?.pagination?.total ?? 0));
    } catch {
      /* the footer keeps offering another attempt */
    } finally {
      setLoadingMore(false);
    }
  }, [user, loadingMore, items.length]);

  // Initial load + polling (only while signed in).
  useEffect(() => {
    if (!user) {
      setCount(0);
      setTotal(0);
      setItems([]);
      return;
    }
    void refreshCount();
    const timer = setInterval(() => {
      void refreshCount();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [user, refreshCount]);

  // Refresh the list when the panel opens.
  useEffect(() => {
    if (isOpen && user) void loadFeed();
  }, [isOpen, user, loadFeed]);

  const markRead = useCallback(async (id: number) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, is_read: true } : item))
    );
    setCount((prev) => Math.max(0, prev - 1));
    try {
      await apiClient.post(`v1/notifications/${id}/read`);
    } catch {
      /* optimistic update; the next poll corrects the count */
    }
  }, []);

  const markAllRead = useCallback(async () => {
    setItems((prev) => prev.map((item) => ({ ...item, is_read: true })));
    setCount(0);
    try {
      await apiClient.post("v1/notifications/read-all");
    } catch {
      /* optimistic update; the next poll corrects the count */
    }
  }, []);

  return (
    <NotificationsContext.Provider
      value={{
        count,
        total,
        items,
        loading,
        loadingMore,
        hasMore: items.length < total,
        isOpen,
        setIsOpen,
        refreshCount,
        loadFeed,
        loadMore,
        markRead,
        markAllRead,
      }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsState {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    throw new Error("useNotifications must be used inside NotificationsProvider");
  }
  return ctx;
}
