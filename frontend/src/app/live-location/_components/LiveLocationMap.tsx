"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import { Maximize2, Minimize2 } from "lucide-react";
import { MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { employeeIdentifierValue } from "@/lib/employeeIdentifier";

export interface LiveMapItem {
  employee_id: number;
  employee_name?: string | null;
  employee_type?: string | null;
  dms_code?: string | null;
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
}

interface Props {
  items: LiveMapItem[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  trail: [number, number][];
  labels: LiveMapLabels;
  fitSignal: number;
  emptyLabel: string;
}

const DHAAKU_CENTER: [number, number] = [23.8103, 90.4125];

function pinColor(item: LiveMapItem): string {
  if (item.battery_status === "low") return "#f59e0b";
  return item.is_online ? "#10b981" : "#64748b";
}

function pinIcon(item: LiveMapItem, selected: boolean) {
  const color = pinColor(item);
  const size = selected ? 34 : 26;
  const html = `
    <div style="position:relative;display:flex;align-items:flex-end;justify-content:center;filter:drop-shadow(0 2px 3px rgba(15,23,42,.35));">
      ${selected ? `<span style="position:absolute;bottom:-2px;left:50%;transform:translateX(-50%);width:${size + 12}px;height:${size + 12}px;border-radius:9999px;background:${color};opacity:.18;animation:oflpulse 1.6s ease-out infinite;"></span>` : ""}
      <svg width="${size}" height="${size * 1.38}" viewBox="0 0 26 36" xmlns="http://www.w3.org/2000/svg">
        <path d="M13 0C5.8 0 0 5.8 0 13c0 9.7 13 23 13 23s13-13.3 13-23C26 5.8 20.2 0 13 0z" fill="${color}" stroke="#ffffff" stroke-width="2"/>
        <circle cx="13" cy="13" r="4.6" fill="#ffffff"/>
      </svg>
    </div>`;
  return L.divIcon({
    html,
    className: "",
    iconSize: [size, size * 1.38],
    iconAnchor: [size / 2, size * 1.38],
  });
}

/**
 * Below this zoom the identity cards would sit on top of each other (a card is
 * up to ~176px wide, i.e. hundreds of metres at low zoom), so only pins are
 * drawn. The selected marker keeps its card at any zoom.
 */
const LABEL_MIN_ZOOM = 14;

/**
 * Cards hug their content — a short name with short codes draws a narrow card
 * instead of a half-empty 176px one — but never grow past LABEL_WIDTH, or a
 * long "Md. ..." name would span hundreds of metres at map zoom.
 */
const LABEL_WIDTH = 176;
// Card is box-sized to exactly this height (avatar row 22 + gap 4 + code line 12
// + gap 4 + status line 12 + padding 12 + border 2) so the pin tip always lands
// on the exact coordinate.
const LABEL_HEIGHT = 68;

/**
 * divIcon HTML is assigned with innerHTML, and employee names/dms codes come
 * from imported spreadsheets, so every interpolated value must be escaped.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** System has no employee photos, so the avatar is generated from initials. */
function initialsOf(item: LiveMapItem): string {
  const words = (item.employee_name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return `${words[0][0]}${words[1][0]}`.toLocaleUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toLocaleUpperCase();
  const code = (item.dms_code || "").trim();
  if (code) return code.slice(0, 2).toLocaleUpperCase();
  return "#";
}

/**
 * Battery colours follow the same palette as the page's battery chip:
 * blue while charging, amber below the low threshold, green when healthy.
 */
function batteryColor(item: LiveMapItem): string {
  if (item.battery_status === "charging") return "#3b82f6";
  if (item.battery_status === "low") return "#f59e0b";
  if (item.battery_percent != null) return "#059669";
  return "#94a3b8";
}

/**
 * Tiny SVG battery for the identity card — divIcon HTML cannot use React
 * components, so the shell/fill are drawn inline. The fill width mirrors
 * `battery_percent`; while charging a bolt replaces the fill, matching the
 * BatteryCharging icon used elsewhere on the page.
 */
function batteryGlyph(item: LiveMapItem): string {
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

/**
 * Pin with an always-visible identity card above it: avatar, name, the
 * DMS / iTopUp (or pool) numbers plus the live status (online/offline) and
 * battery level, so the operator can read who is where and how each device is
 * doing without clicking every marker. The card sits above the pin tip,
 * leaving the exact location point uncovered.
 */
function labelIcon(item: LiveMapItem, selected: boolean, labels: LiveMapLabels) {
  const color = pinColor(item);
  const size = selected ? 34 : 26;
  const pinHeight = Math.round(size * 1.38);
  const name =
    (item.employee_name || "").trim() || item.dms_code || `#${item.employee_id}`;
  const codes = [item.dms_code, employeeIdentifierValue(item)]
    .filter(Boolean)
    .join(" · ");
  const statusLabel = item.is_online ? labels.online : labels.offline;
  const statusColor = item.is_online ? "#059669" : "#64748b";
  const batteryLabel =
    item.battery_percent != null ? `${Math.round(item.battery_percent)}%` : "";
  const accessibleName = [codes ? `${name} (${codes})` : name, statusLabel, batteryLabel]
    .filter(Boolean)
    .join(" · ");

  const html = `
    <div style="position:relative;display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 2px 3px rgba(15,23,42,.35));">
      <div title="${escapeHtml(accessibleName)}" style="width:max-content;max-width:${LABEL_WIDTH}px;height:${LABEL_HEIGHT}px;box-sizing:border-box;background:#ffffff;border:1px solid rgba(203,213,225,.9);border-radius:12px;padding:6px 9px;text-align:left;overflow:hidden;display:flex;flex-direction:column;justify-content:center;">
        <div style="display:flex;align-items:center;gap:6px;min-width:0;height:22px;">
          <span style="flex:0 0 auto;width:22px;height:22px;border-radius:9999px;background:${color};color:#ffffff;font-size:10px;font-weight:700;line-height:1;display:flex;align-items:center;justify-content:center;">${escapeHtml(initialsOf(item))}</span>
          <span style="min-width:0;font-size:12px;font-weight:600;line-height:22px;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(name)}</span>
        </div>
        <div style="margin-top:4px;font-size:10px;line-height:12px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(codes)}</div>
        <div style="margin-top:4px;display:flex;align-items:center;justify-content:space-between;gap:6px;">
          <span style="display:inline-flex;align-items:center;gap:4px;min-width:0;">
            <span style="flex:0 0 auto;width:6px;height:6px;border-radius:9999px;background:${item.is_online ? "#10b981" : "#64748b"};"></span>
            <span style="font-size:10px;font-weight:600;line-height:12px;color:${statusColor};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(statusLabel)}</span>
          </span>
          ${batteryGlyph(item)}
        </div>
      </div>
      <div style="position:relative;display:flex;align-items:flex-end;justify-content:center;">
        ${selected ? `<span style="position:absolute;bottom:-2px;left:50%;transform:translateX(-50%);width:${size + 12}px;height:${size + 12}px;border-radius:9999px;background:${color};opacity:.18;animation:oflpulse 1.6s ease-out infinite;"></span>` : ""}
        <svg width="${size}" height="${pinHeight}" viewBox="0 0 26 36" xmlns="http://www.w3.org/2000/svg">
          <path d="M13 0C5.8 0 0 5.8 0 13c0 9.7 13 23 13 23s13-13.3 13-23C26 5.8 20.2 0 13 0z" fill="${color}" stroke="#ffffff" stroke-width="2"/>
          <circle cx="13" cy="13" r="4.6" fill="#ffffff"/>
        </svg>
      </div>
    </div>`;

  return L.divIcon({
    html,
    className: "",
    iconSize: [LABEL_WIDTH, LABEL_HEIGHT + pinHeight],
    iconAnchor: [LABEL_WIDTH / 2, LABEL_HEIGHT + pinHeight],
  });
}

/**
 * Publishes the current zoom level so the parent can swap pin <-> labelled icon.
 * Leaflet only fires `zoomend`, so listen there and push the value on mount too.
 */
function ZoomWatcher({ onZoom }: { onZoom: (zoom: number) => void }) {
  const map = useMap();

  useEffect(() => {
    const push = () => onZoom(map.getZoom());
    push();
    map.on("zoomend", push);
    return () => {
      map.off("zoomend", push);
    };
  }, [map, onZoom]);

  return null;
}

function MapController({
  items,
  selectedId,
  fitSignal,
}: {
  items: LiveMapItem[];
  selectedId: number | null;
  fitSignal: number;
}) {
  const map = useMap();
  const lastFit = useRef(-1);
  const lastSelected = useRef<number | null>(null);

  useEffect(() => {
    if (lastFit.current === fitSignal) return;
    const points = items.filter(
      (i) => Number.isFinite(i.latitude) && Number.isFinite(i.longitude)
    );
    if (!points.length) return;
    const bounds = L.latLngBounds(points.map((i) => [i.latitude, i.longitude] as [number, number]));
    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.2), { animate: true });
      lastFit.current = fitSignal;
    }
  }, [fitSignal, items, map]);

  useEffect(() => {
    if (selectedId == null || selectedId === lastSelected.current) return;
    const item = items.find((i) => i.employee_id === selectedId);
    if (item) {
      map.flyTo([item.latitude, item.longitude], Math.max(map.getZoom(), 14), { duration: 0.6 });
      lastSelected.current = selectedId;
    }
  }, [selectedId, items, map]);

  return null;
}

function MapResizeHandler() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    // Leaflet only measures its container once. When the surrounding layout
    // changes (selecting an employee grows the detail panel, which stretches
    // this card), the map keeps the old pane size and leaves a blank strip.
    // Recalculate on every container resize, plus once after first paint.
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container);
    const timer = window.setTimeout(() => map.invalidateSize(), 0);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [map]);

  return null;
}

export default function LiveLocationMap({
  items,
  selectedId,
  onSelect,
  trail,
  labels,
  fitSignal,
  emptyLabel,
}: Props) {
  const hasPoints = items.some(
    (i) => Number.isFinite(i.latitude) && Number.isFinite(i.longitude)
  );
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);
  // Zoom at which the marker's identity card becomes visible; published by
  // ZoomWatcher so marker icons can be swapped without re-mounting the map.
  const [zoom, setZoom] = useState<number>(7);

  useEffect(() => {
    setCanFullscreen(
      typeof document !== "undefined" &&
        document.fullscreenEnabled === true &&
        typeof document.documentElement.requestFullscreen === "function"
    );
    const onChange = () => setIsFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = rootRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch {
      /* Fullscreen can be blocked by the browser; ignore. */
    }
  }, []);

  // Identity cards are drawn at zoom >= LABEL_MIN_ZOOM so they never pile on
  // top of each other, but the employee the operator picked always keeps it.
  const showLabels = zoom >= LABEL_MIN_ZOOM;

  return (
    <div ref={rootRef} className="live-map-root relative h-full w-full overflow-hidden rounded-2xl isolate">
      <style>{`@keyframes oflpulse{0%{transform:translateX(-50%) scale(.6);opacity:.35}100%{transform:translateX(-50%) scale(1.6);opacity:0}}.live-map-root:fullscreen{border-radius:0;height:100%;width:100%}.live-map-root:-webkit-full-screen{border-radius:0;height:100%;width:100%}`}</style>

      <MapContainer
        center={DHAAKU_CENTER}
        zoom={7}
        scrollWheelZoom
        className="h-full w-full"
        style={{ minHeight: "420px", background: "#e5e7eb" }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          maxZoom={19}
        />

        {trail.length > 1 && (
          <Polyline
            positions={trail}
            pathOptions={{ color: "#2563eb", weight: 3, opacity: 0.75, dashArray: "7 7" }}
          />
        )}

        {items.map((item) => {
          if (!Number.isFinite(item.latitude) || !Number.isFinite(item.longitude)) {
            return null;
          }
          const isSelected = item.employee_id === selectedId;
          const showLabel = showLabels || isSelected;
          return (
            <Marker
              key={item.employee_id}
              position={[item.latitude, item.longitude]}
              icon={
                showLabel
                  ? labelIcon(item, isSelected, labels)
                  : pinIcon(item, isSelected)
              }
              eventHandlers={{ click: () => onSelect(item.employee_id) }}
              zIndexOffset={isSelected ? 2000 : showLabel ? 1000 : 0}
            />
          );
        })}

        <MapController items={items} selectedId={selectedId} fitSignal={fitSignal} />
        <MapResizeHandler />
        <ZoomWatcher onZoom={setZoom} />
      </MapContainer>

      {canFullscreen && (
        <button
          type="button"
          onClick={toggleFullscreen}
          title={isFullscreen ? labels.exit_fullscreen : labels.fullscreen}
          aria-label={isFullscreen ? labels.exit_fullscreen : labels.fullscreen}
          className="absolute right-3 top-3 z-[1000] flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl border border-gray-200/80 bg-white/95 px-3 py-2.5 text-xs font-semibold text-gray-600 shadow-lg backdrop-blur transition-colors hover:bg-gray-100 sm:min-h-0 dark:border-slate-700 dark:bg-slate-900/95 dark:text-gray-300 dark:hover:bg-slate-800"
        >
          {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          <span className="hidden sm:inline">
            {isFullscreen ? labels.exit_fullscreen : labels.fullscreen}
          </span>
        </button>
      )}

      {!hasPoints && (
        <div className="pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center bg-white/70 dark:bg-slate-950/60 backdrop-blur-[1px]">
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{emptyLabel}</p>
        </div>
      )}

      {/* Legend */}
      <div className="pointer-events-none absolute bottom-4 left-4 z-[1000] rounded-xl border border-gray-200/80 bg-white/95 px-3 py-2.5 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          {labels.legend}
        </p>
        <div className="space-y-1">
          <LegendRow color="#10b981" label={labels.online} />
          <LegendRow color="#64748b" label={labels.offline} />
          <LegendRow color="#f59e0b" label={labels.low_battery} />
        </div>
      </div>
    </div>
  );
}

function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-xs font-medium text-gray-600 dark:text-gray-300">{label}</span>
    </div>
  );
}
