"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
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
  layer_streets: string;
  layer_satellite: string;
  layer_dark: string;
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

// Key-free, Google-like basemaps (Leaflet keeps our pins/trail/select behaviour).
// `{r}` is Leaflet's retina placeholder; Carto serves a/b/c/d subdomains.
type BasemapKey = "streets" | "satellite" | "dark";

const BASEMAPS: Record<BasemapKey, { url: string; attribution: string }> = {
  streets: {
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution:
      "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
  },
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
};

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

export default function LiveLocationMap({
  items,
  selectedId,
  onSelect,
  trail,
  labels,
  fitSignal,
  emptyLabel,
}: Props) {
  const [basemap, setBasemap] = useState<BasemapKey>("streets");
  const hasPoints = items.some(
    (i) => Number.isFinite(i.latitude) && Number.isFinite(i.longitude)
  );

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl isolate">
      <style>{`@keyframes oflpulse{0%{transform:translateX(-50%) scale(.6);opacity:.35}100%{transform:translateX(-50%) scale(1.6);opacity:0}}`}</style>

      <MapContainer
        center={DHAAKU_CENTER}
        zoom={7}
        scrollWheelZoom
        className="h-full w-full"
        style={{ minHeight: "420px", background: "#e5e7eb" }}
      >
        <TileLayer
          key={basemap}
          url={BASEMAPS[basemap].url}
          attribution={BASEMAPS[basemap].attribution}
          subdomains="abcd"
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
      </MapContainer>

      {!hasPoints && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/70 dark:bg-slate-950/60 backdrop-blur-[1px]">
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{emptyLabel}</p>
        </div>
      )}

      {/* Basemap switcher */}
      <div className="absolute right-3 top-3 z-[399] flex overflow-hidden rounded-xl border border-gray-200/80 bg-white/95 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        {(
          [
            ["streets", labels.layer_streets],
            ["satellite", labels.layer_satellite],
            ["dark", labels.layer_dark],
          ] as [BasemapKey, string][]
        ).map(([key, label], idx) => {
          const active = basemap === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setBasemap(key)}
              aria-pressed={active}
              className={`cursor-pointer px-3 py-1.5 text-xs font-semibold transition-colors ${
                idx > 0 ? "border-l border-gray-200/80 dark:border-slate-700" : ""
              } ${
                active
                  ? "bg-primary-600 text-white"
                  : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-slate-800"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="pointer-events-none absolute bottom-4 left-4 z-[399] rounded-xl border border-gray-200/80 bg-white/95 px-3 py-2.5 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
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
