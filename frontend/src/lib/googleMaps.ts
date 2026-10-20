"use client";

/**
 * Loads the Google Maps JavaScript API once per page and shares it across every
 * component that needs a map.
 *
 * A browser key (`NEXT_PUBLIC_*`) is public, so it must be restricted by HTTP
 * referrer in Google Cloud Console. When the current site address is not on
 * that list Google logs `RefererNotAllowedMapError` and paints its own error
 * dialog over the map. To keep that from happening on every visit we decide
 * *before* injecting the script whether the key may be used on this origin:
 *
 * - `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — production browser key (restricted).
 * - `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY_DEV` — optional key that allows localhost,
 *   used instead of the production key while running `next dev`. This keeps the
 *   production key locked to production domains.
 * - `NEXT_PUBLIC_GOOGLE_MAPS_ALLOWED_ORIGINS` — optional comma-separated mirror
 *   of the key's HTTP referrer list (e.g. `https://app.example.com/*`). When set,
 *   any other origin skips Google Maps entirely, so an unauthorized host can
 *   never trigger the Google error again.
 *
 * When Google still rejects the key, the rejection is remembered per origin and
 * Google Maps is not attempted again until the user retries. The rejection is
 * cleared by `clearGoogleMapsKeyRejection()`.
 */

const SCRIPT_ID = "orange-flow-google-maps";
const CALLBACK_NAME = "__orangeFlowGoogleMapsReady";
const LOAD_TIMEOUT_MS = 20000;
const REJECTED_STORAGE_PREFIX = "orange-flow:google-maps-rejected:";
// Last characters of the rejected key. Swapping in a different key (e.g. the
// localhost dev key) automatically clears the rejection on the next visit.
const KEY_ID_LENGTH = 8;

let loadPromise: Promise<void> | null = null;

export type GoogleMapsUnavailableReason =
  /** No browser key is configured for this build. */
  | "no_key"
  /** The current origin is not in `NEXT_PUBLIC_GOOGLE_MAPS_ALLOWED_ORIGINS`. */
  | "origin_not_allowed"
  /** Google answered with `gm_authFailure` (e.g. RefererNotAllowedMapError). */
  | "key_rejected";

/** Thrown by `loadGoogleMaps` when the key may not be used on this origin. */
export class GoogleMapsUnavailableError extends Error {
  readonly reason: GoogleMapsUnavailableReason;

  constructor(reason: GoogleMapsUnavailableReason) {
    super(`Google Maps is unavailable (${reason})`);
    this.name = "GoogleMapsUnavailableError";
    this.reason = reason;
  }
}

export function googleMapsApiKey(): string {
  const productionKey = (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "").trim();
  const developmentKey = (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY_DEV || "").trim();
  // `next dev` prefers the localhost-friendly key; production never sees it.
  if (process.env.NODE_ENV !== "production" && developmentKey) return developmentKey;
  return productionKey;
}

export function googleMapsAllowedOrigins(): string[] {
  return (process.env.NEXT_PUBLIC_GOOGLE_MAPS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

function currentOrigin(): string | null {
  if (typeof window === "undefined") return null;
  return normalizeOrigin(window.location.origin);
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * Matches an origin (`https://app.example.com`) against a configured rule.
 * Rules accept a full origin, a bare host (`app.example.com`), a wildcard host
 * (`https://*.example.com`), an optional trailing `/*`, or `*` for any origin.
 */
function originMatchesRule(origin: string, rule: string): boolean {
  const normalized = normalizeOrigin(rule).replace(/\/\*$/, "");
  if (!normalized) return false;
  if (normalized === "*") return true;
  if (normalized === origin) return true;

  const wildcard = normalized.match(/^([a-z][a-z0-9+.-]*):\/\/\*\.(.+)$/);
  if (wildcard) {
    const [, scheme, host] = wildcard;
    const parsed = parseUrl(origin);
    if (!parsed || parsed.protocol !== `${scheme}:`) return false;
    return parsed.hostname === host || parsed.hostname.endsWith(`.${host}`);
  }

  // A bare host (`localhost:3000`, `app.example.com`) matches any scheme.
  if (!normalized.includes("://")) {
    const parsed = parseUrl(origin);
    if (!parsed) return false;
    return parsed.host === normalized || parsed.hostname === normalized;
  }

  return false;
}

function rejectionStorageKey(origin: string): string {
  return `${REJECTED_STORAGE_PREFIX}${origin}`;
}

function currentKeyId(): string {
  const key = googleMapsApiKey();
  return key ? key.slice(-KEY_ID_LENGTH) : "";
}

/**
 * A rejection only applies while the same key is in use, so replacing the key
 * (or adding the dev key) retries automatically without a manual reset.
 */
export function googleMapsKeyRejected(): boolean {
  const origin = currentOrigin();
  if (!origin) return false;
  try {
    const raw = window.localStorage.getItem(rejectionStorageKey(origin));
    if (!raw) return false;
    const stored = JSON.parse(raw) as { keyId?: string } | null;
    return stored?.keyId === currentKeyId();
  } catch {
    return false;
  }
}

/** Remembers that Google refused the key on this origin. */
export function markGoogleMapsKeyRejected(): void {
  const origin = currentOrigin();
  if (!origin) return;
  try {
    window.localStorage.setItem(
      rejectionStorageKey(origin),
      JSON.stringify({ keyId: currentKeyId(), at: new Date().toISOString() })
    );
  } catch {
    /* storage can be blocked — the in-memory state still shows the message */
  }
}

/** Allows the next attempt (call after fixing the key in Google Cloud Console). */
export function clearGoogleMapsKeyRejection(): void {
  const origin = currentOrigin();
  if (!origin) return;
  try {
    window.localStorage.removeItem(rejectionStorageKey(origin));
  } catch {
    /* ignore */
  }
}

/**
 * Why Google Maps cannot be shown on this origin, or `null` when it may load.
 * This is the single gate used by both the page (provider toggle) and the map.
 */
export function googleMapsUnavailableReason(): GoogleMapsUnavailableReason | null {
  if (!googleMapsApiKey()) return "no_key";

  const origin = currentOrigin();
  // Server render: nothing to validate yet.
  if (!origin) return null;

  const allowedOrigins = googleMapsAllowedOrigins();
  if (allowedOrigins.length > 0 && !allowedOrigins.some((rule) => originMatchesRule(origin, rule))) {
    return "origin_not_allowed";
  }

  if (googleMapsKeyRejected()) return "key_rejected";
  return null;
}

/** The exact HTTP referrer Google must be told to allow for this page. */
export function googleMapsReferrerPattern(): string {
  const origin = currentOrigin();
  return origin ? `${origin}/*` : "";
}

function mapsAlreadyLoaded(): boolean {
  return typeof window !== "undefined" && Boolean(window.google?.maps?.Map);
}

export function loadGoogleMaps(apiKey: string): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Maps can only be loaded in the browser"));
  }
  if (!apiKey) return Promise.reject(new GoogleMapsUnavailableError("no_key"));

  // Never inject the script where the key is known to be unauthorized: that is
  // exactly what produces the RefererNotAllowedMapError console noise.
  const blockedReason = googleMapsUnavailableReason();
  if (blockedReason) return Promise.reject(new GoogleMapsUnavailableError(blockedReason));

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
