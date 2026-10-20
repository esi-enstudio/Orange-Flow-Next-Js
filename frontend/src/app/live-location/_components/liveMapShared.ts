/**
 * Shared building blocks for the live-location map providers (Leaflet /
 * OpenStreetMap and Google Maps). Both providers render the same identity card
 * (avatar, name, codes, status, battery) and the same pin colours, so the
 * pieces live here instead of being copied into each map component.
 */

import { resolveImageUrl } from "@/lib/api";
import { employeeIdentifierValue } from "@/lib/employeeIdentifier";

export interface LiveMapItem {
  employee_id: number;
  employee_name?: string | null;
  employee_type?: string | null;
  dms_code?: string | null;
  photo_url?: string | null;
  // Identity card content — the map prints these into the marker's label.
  itop_number?: string | null;
  pool_number?: string | null;
  latitude: number;
  longitude: number;
  battery_percent?: number | null;
  battery_status: string;
  is_online: boolean;
}

export interface LiveMapLabels {
  legend: string;
  online: string;
  offline: string;
  low_battery: string;
  fullscreen: string;
  exit_fullscreen: string;
  /** Shown while the Google Maps script is still downloading. */
  google_loading: string;
  /** Shown when the Google Maps script could not be loaded (network, timeout). */
  google_error: string;
  /** No browser key is configured for this build. */
  google_no_key: string;
  /** The current address is not in the key's allowed origins. */
  google_origin_not_allowed: string;
  /** Google refused the key for this address (RefererNotAllowedMapError). */
  google_key_rejected: string;
  /** Button that falls back to the OpenStreetMap provider. */
  switch_to_osm: string;
  /** Button that clears the remembered rejection and reloads the page. */
  retry: string;
}

/** Dhaka — where the map opens before the first "fit all". */
export const MAP_CENTER = { lat: 23.8103, lng: 90.4125 };

export function pinColor(item: LiveMapItem): string {
  if (item.battery_status === "low") return "#f59e0b";
  return item.is_online ? "#10b981" : "#64748b";
}

/**
 * Marker HTML is assigned with innerHTML, and employee names/dms codes come
 * from imported spreadsheets, so every interpolated value must be escaped.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Falls back to generated initials when the employee has no profile photo. */
export function initialsOf(item: LiveMapItem): string {
  const words = (item.employee_name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toLocaleUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toLocaleUpperCase();
  const code = (item.dms_code || "").trim();
  if (code) return code.slice(0, 2).toLocaleUpperCase();
  return "#";
}

/** Display name used by marker tooltips and identity cards. */
export function displayName(item: LiveMapItem): string {
  return (item.employee_name || "").trim() || item.dms_code || `#${item.employee_id}`;
}

/** DMS code plus iTopUp / pool number, whichever the employee has. */
export function identityCodes(item: LiveMapItem): string {
  return [item.dms_code, employeeIdentifierValue(item)].filter(Boolean).join(" · ");
}

/** Screen-reader / tooltip summary for a marker. */
export function markerTitle(item: LiveMapItem, labels: LiveMapLabels): string {
  const name = displayName(item);
  const codes = identityCodes(item);
  const battery =
    item.battery_percent != null ? `${Math.round(item.battery_percent)}%` : "";
  return [
    codes ? `${name} (${codes})` : name,
    item.is_online ? labels.online : labels.offline,
    battery,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Identity-card avatar: the employee's profile photo when present, otherwise a
 * colour-coded initials circle. The initials stay painted underneath the image
 * so a missing/broken photo silently degrades to them — the card is raw HTML
 * and cannot fall back through React state.
 */
export function avatarHtml(item: LiveMapItem, color: string): string {
  const photo = resolveImageUrl(item.photo_url);
  const initials = escapeHtml(initialsOf(item));
  const base =
    "flex:0 0 auto;position:relative;width:22px;height:22px;border-radius:9999px;overflow:hidden;" +
    `background:${color};color:#ffffff;font-size:10px;font-weight:700;line-height:1;` +
    "display:flex;align-items:center;justify-content:center;";
  if (!photo) return `<span style="${base}">${initials}</span>`;
  return `<span style="${base}">${initials}<img src="${escapeHtml(photo)}" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'" /></span>`;
}

/**
 * Battery colours follow the same palette as the page's battery chip:
 * blue while charging, amber below the low threshold, green when healthy.
 */
export function batteryColor(item: LiveMapItem): string {
  if (item.battery_status === "charging") return "#3b82f6";
  if (item.battery_status === "low") return "#f59e0b";
  if (item.battery_percent != null) return "#059669";
  return "#94a3b8";
}

/**
 * Tiny SVG battery for the identity card. The fill width mirrors
 * `battery_percent`; while charging a bolt replaces the fill, matching the
 * BatteryCharging icon used elsewhere on the page.
 */
export function batteryGlyph(item: LiveMapItem): string {
  const color = batteryColor(item);
  const pct =
    item.battery_percent == null
      ? null
      : Math.max(0, Math.min(100, item.battery_percent));
  const inner =
    item.battery_status === "charging"
      ? `<path d="M7.6 1.6 L4.1 5.5 H6.3 L5.1 8.4 L8.6 4.5 H6.4 Z" fill="${color}"/>`
      : `<rect x="2" y="2" width="${pct == null ? 0 : ((pct / 100) * 9).toFixed(1)}" height="6" rx="1" fill="${color}"/>`;

  return `
    <span style="display:inline-flex;align-items:center;gap:3px;flex:0 0 auto;">
      <svg width="15" height="10" viewBox="0 0 15 10" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="0.5" y="0.5" width="12" height="9" rx="2" fill="none" stroke="${color}" stroke-width="1"/>
        <rect x="13.8" y="3.2" width="1.2" height="3.6" rx="0.6" fill="${color}"/>
        ${inner}
      </svg>
      <span style="font-size:10px;font-weight:600;line-height:12px;color:${color};white-space:nowrap;">${
        pct == null ? "—" : `${Math.round(pct)}%`
      }</span>
    </span>`;
}

/** Two-tone pin outline used by both providers. */
export const PIN_PATH =
  "M13 0C5.8 0 0 5.8 0 13c0 9.7 13 23 13 23s13-13.3 13-23C26 5.8 20.2 0 13 0z";
