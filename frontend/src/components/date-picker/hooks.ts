"use client";

import * as React from "react";

/**
 * Subscribes to a media query and stays in sync with it.
 *
 * Used to switch the calendar between one month on mobile and two side by side
 * on desktop. `useSyncExternalStore` is the right fit because the media query
 * *is* an external store — subscribing to it avoids a state update on every
 * mount and keeps the value correct through concurrent rendering and hydration.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = React.useCallback(
    (onStoreChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onStoreChange);
      return () => mql.removeEventListener("change", onStoreChange);
    },
    [query]
  );

  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    // Server render has no viewport; assume the narrow layout, which is the
    // layout that must fit without horizontal scroll.
    () => false
  );
}
