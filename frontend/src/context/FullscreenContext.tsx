"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

const STORAGE_KEY = "focus-mode";
const STORAGE_EVENT = "orangeflow:focus-mode";

/** Width/height (px) of the invisible hot-zone that reveals the chrome on hover. */
export const REVEAL_EDGE = 28;

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
  setRevealSidebar: (value: boolean) => void;
  revealHeader: boolean;
  setRevealHeader: (value: boolean) => void;

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

  const setRevealSidebar = useCallback((value: boolean) => {
    setRevealSidebarState(value);
  }, []);

  const setRevealHeader = useCallback((value: boolean) => {
    setRevealHeaderState(value);
  }, []);

  const setFocusMode = useCallback((value: boolean) => {
    localStorage.setItem(STORAGE_KEY, String(value));
    window.dispatchEvent(new Event(STORAGE_EVENT));
    // Collapse any revealed chrome so it does not linger after leaving focus mode.
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
  useEffect(() => {
    if (!isFocusMode) return;

    const onPointer = (x: number, y: number) => {
      setRevealSidebarState(x <= REVEAL_EDGE);
      setRevealHeaderState(y <= REVEAL_EDGE);
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
    };
  }, [isFocusMode]);

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
        setRevealSidebar,
        revealHeader,
        setRevealHeader,
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
