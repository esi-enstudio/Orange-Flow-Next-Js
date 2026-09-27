"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MutableRefObject,
  type ReactNode,
} from "react";

const STORAGE_KEY = "focus-mode";
const STORAGE_EVENT = "orangeflow:focus-mode";

/** Width/height (px) of the invisible hot-zone that reveals the chrome on hover. */
export const REVEAL_EDGE = 28;

/**
 * Grace period before revealed chrome slides back out. Without it, skimming the
 * hot-zone with a single stray pixel makes the panel flicker.
 */
const HIDE_GRACE_MS = 180;

type HideTimer = MutableRefObject<ReturnType<typeof setTimeout> | null>;

function clearPendingHide(timer: HideTimer) {
  if (timer.current !== null) {
    clearTimeout(timer.current);
    timer.current = null;
  }
}

interface FullscreenContextValue {
  /** Layout focus mode: sidebar + header + mobile nav are hidden. Persisted. */
  isFocusMode: boolean;
  setFocusMode: (value: boolean) => void;
  toggleFocusMode: () => void;

  /** True while the document is in browser/OS fullscreen (Fullscreen API). */
  isNativeFullscreen: boolean;
  nativeFullscreenSupported: boolean;
  toggleNativeFullscreen: () => void;

  /** Chrome auto-reveal while focus mode is on. */
  revealSidebar: boolean;
  revealHeader: boolean;
  /**
   * Pin/unpin the chrome while the pointer is physically over it. The hot-zone test
   * is bypassed for as long as the pointer stays inside the panel, so the header and
   * the sidebar can be used normally (moved across, clicked, scrolled) and only
   * collapse once the pointer leaves their bounds.
   */
  setSidebarHovering: (value: boolean) => void;
  setHeaderHovering: (value: boolean) => void;

  /** Keyboard shortcut label, e.g. "Shift + F". */
  shortcutLabel: string;
}

const FullscreenContext = createContext<FullscreenContextValue | undefined>(undefined);

function noopSubscribe() {
  return () => {};
}

function subscribeToFocusMode(onStoreChange: () => void) {
  window.addEventListener(STORAGE_EVENT, onStoreChange);
  // Another tab changed the preference.
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(STORAGE_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function getFocusModeSnapshot() {
  return localStorage.getItem(STORAGE_KEY) === "true";
}

function subscribeToFullscreenChange(onStoreChange: () => void) {
  document.addEventListener("fullscreenchange", onStoreChange);
  return () => document.removeEventListener("fullscreenchange", onStoreChange);
}

function getNativeFullscreenSnapshot() {
  return Boolean(document.fullscreenElement);
}

function getFullscreenSupportSnapshot() {
  return typeof document.documentElement.requestFullscreen === "function";
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

export function FullscreenProvider({ children }: { children: ReactNode }) {
  // localStorage and the Fullscreen API are both "external stores", so they are read
  // through useSyncExternalStore. That keeps the server snapshot (false) distinct from
  // the client snapshot, which avoids a hydration mismatch without a mounted gate.
  const isFocusMode = useSyncExternalStore(
    subscribeToFocusMode,
    getFocusModeSnapshot,
    () => false
  );
  const isNativeFullscreen = useSyncExternalStore(
    subscribeToFullscreenChange,
    getNativeFullscreenSnapshot,
    () => false
  );
  const nativeFullscreenSupported = useSyncExternalStore(
    noopSubscribe,
    getFullscreenSupportSnapshot,
    () => false
  );

  const [revealSidebar, setRevealSidebarState] = useState(false);
  const [revealHeader, setRevealHeaderState] = useState(false);

  // Refs (not state) for the pointer bookkeeping: the hot-zone listener runs on every
  // mouse move and must never trigger a re-render of its own.
  const pointer = useRef({ x: 0, y: 0 });
  const sidebarHover = useRef(false);
  const headerHover = useRef(false);
  const sidebarHideTimer: HideTimer = useRef(null);
  const headerHideTimer: HideTimer = useRef(null);

  // Showing is immediate (feels responsive); hiding waits out the grace period.
  const applySidebar = useCallback((visible: boolean) => {
    clearPendingHide(sidebarHideTimer);
    if (visible) {
      setRevealSidebarState(true);
      return;
    }
    sidebarHideTimer.current = setTimeout(() => {
      sidebarHideTimer.current = null;
      setRevealSidebarState(false);
    }, HIDE_GRACE_MS);
  }, []);

  const applyHeader = useCallback((visible: boolean) => {
    clearPendingHide(headerHideTimer);
    if (visible) {
      setRevealHeaderState(true);
      return;
    }
    headerHideTimer.current = setTimeout(() => {
      headerHideTimer.current = null;
      setRevealHeaderState(false);
    }, HIDE_GRACE_MS);
  }, []);

  const setSidebarHovering = useCallback(
    (hovering: boolean) => {
      sidebarHover.current = hovering;
      applySidebar(hovering || pointer.current.x <= REVEAL_EDGE);
    },
    [applySidebar]
  );

  const setHeaderHovering = useCallback(
    (hovering: boolean) => {
      headerHover.current = hovering;
      applyHeader(hovering || pointer.current.y <= REVEAL_EDGE);
    },
    [applyHeader]
  );

  const setFocusMode = useCallback((value: boolean) => {
    localStorage.setItem(STORAGE_KEY, String(value));
    window.dispatchEvent(new Event(STORAGE_EVENT));
    // Collapse any revealed chrome so it does not linger after leaving focus mode.
    clearPendingHide(sidebarHideTimer);
    clearPendingHide(headerHideTimer);
    sidebarHover.current = false;
    headerHover.current = false;
    setRevealSidebarState(false);
    setRevealHeaderState(false);
  }, []);

  const toggleFocusMode = useCallback(() => {
    setFocusMode(!isFocusMode);
  }, [isFocusMode, setFocusMode]);

  const toggleNativeFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // The browser can refuse (e.g. without a user gesture) — keep the current state.
    }
  }, []);

  // Hot-zone tracking: reveal the sidebar near the left edge, the header near the top.
  // While the pointer sits on a panel its hover flag wins, otherwise moving inside the
  // panel would immediately read as "outside the hot-zone" and collapse it again.
  useEffect(() => {
    if (!isFocusMode) return;

    const onPointer = (x: number, y: number) => {
      pointer.current.x = x;
      pointer.current.y = y;
      if (!sidebarHover.current) applySidebar(x <= REVEAL_EDGE);
      if (!headerHover.current) applyHeader(y <= REVEAL_EDGE);
    };
    const onMouseMove = (event: MouseEvent) => onPointer(event.clientX, event.clientY);
    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (touch) onPointer(touch.clientX, touch.clientY);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("touchstart", onTouchStart);
      clearPendingHide(sidebarHideTimer);
      clearPendingHide(headerHideTimer);
    };
  }, [isFocusMode, applyHeader, applySidebar]);

  // Shift+F toggles focus mode. F11 is deliberately avoided: browsers reserve it for
  // native fullscreen and it never reaches the page.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key?.toLowerCase() !== "f" || !event.shiftKey) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      toggleFocusMode();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleFocusMode]);

  return (
    <FullscreenContext.Provider
      value={{
        isFocusMode,
        setFocusMode,
        toggleFocusMode,
        isNativeFullscreen,
        nativeFullscreenSupported,
        toggleNativeFullscreen,
        revealSidebar,
        setSidebarHovering,
        revealHeader,
        setHeaderHovering,
        shortcutLabel: "Shift + F",
      }}
    >
      {children}
    </FullscreenContext.Provider>
  );
}

export function useFullscreen() {
  const ctx = useContext(FullscreenContext);
  if (!ctx) throw new Error("useFullscreen must be used within a FullscreenProvider");
  return ctx;
}
