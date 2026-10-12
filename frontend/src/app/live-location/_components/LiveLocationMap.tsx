"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import { Maximize2, Minimize2 } from "lucide-react";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

export interface LiveMapItem {
  employee_id: number;
  employee_name?: string | null;
  employee_type?: string | null;
  dms_code?: string | null;
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
    popupAnchor: [0, -size * 1.3],
  });
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

        {items.map((item) =>
          Number.isFinite(item.latitude) && Number.isFinite(item.longitude) ? (
            <Marker
              key={item.employee_id}
              position={[item.latitude, item.longitude]}
              icon={pinIcon(item, item.employee_id === selectedId)}
              eventHandlers={{ click: () => onSelect(item.employee_id) }}
              zIndexOffset={item.employee_id === selectedId ? 1000 : 0}
            >
              <Popup>
                <div className="min-w-[150px] space-y-0.5">
                  <p className="text-sm font-semibold text-gray-900">
                    {item.employee_name || item.dms_code || `#${item.employee_id}`}
                  </p>
                  {item.dms_code && (
                    <p className="text-[11px] text-gray-500">{item.dms_code}</p>
                  )}
                  <p className="text-[11px]" style={{ color: pinColor(item) }}>
                    {item.is_online ? labels.online : labels.offline}
                    {item.battery_percent != null ? ` · ${item.battery_percent}%` : ""}
                  </p>
                </div>
              </Popup>
            </Marker>
          ) : null
        )}

        <MapController items={items} selectedId={selectedId} fitSignal={fitSignal} />
        <MapResizeHandler />
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
