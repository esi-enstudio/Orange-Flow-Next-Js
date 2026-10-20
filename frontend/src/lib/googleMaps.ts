"use client";

/**
 * Loads the Google Maps JavaScript API once per page and shares it across every
 * component that needs a map. The API key is a browser key (`NEXT_PUBLIC_*`), so
 * it must be restricted by HTTP referrer in Google Cloud Console.
 */

const SCRIPT_ID = "orange-flow-google-maps";
const CALLBACK_NAME = "__orangeFlowGoogleMapsReady";
const LOAD_TIMEOUT_MS = 20000;

let loadPromise: Promise<void> | null = null;

export function googleMapsApiKey(): string {
  return (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "").trim();
}

function mapsAlreadyLoaded(): boolean {
  return typeof window !== "undefined" && Boolean(window.google?.maps?.Map);
}

export function loadGoogleMaps(apiKey: string): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Maps can only be loaded in the browser"));
  }
  if (mapsAlreadyLoaded()) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<void>((resolve, reject) => {
    const globalWindow = window as unknown as Record<string, unknown>;
    let settled = false;
    let injected: HTMLScriptElement | null = null;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      delete globalWindow[CALLBACK_NAME];
      if (error) {
        // Drop the half-loaded tag and allow a later mount (e.g. the user
        // switches back to Google Maps) to inject a fresh one.
        if (injected?.parentNode) injected.parentNode.removeChild(injected);
        loadPromise = null;
        reject(error);
      } else {
        resolve();
      }
    };

    const timeout = window.setTimeout(
      () => finish(new Error("Google Maps did not load in time")),
      LOAD_TIMEOUT_MS
    );

    globalWindow[CALLBACK_NAME] = () => finish();

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      // A previous mount already injected the script — its callback still fires.
      if (mapsAlreadyLoaded()) finish();
      return;
    }

    const script = document.createElement("script");
    injected = script;
    script.id = SCRIPT_ID;
    script.async = true;
    script.defer = true;
    script.onerror = () => finish(new Error("Google Maps script failed to load"));
    // `language` follows the app locale so place labels match the UI.
    const language = typeof document !== "undefined" && document.documentElement.lang === "bn" ? "bn" : "en";
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}` +
      `&v=weekly&language=${language}&callback=${CALLBACK_NAME}`;
    document.head.appendChild(script);
  });

  return loadPromise;
}
