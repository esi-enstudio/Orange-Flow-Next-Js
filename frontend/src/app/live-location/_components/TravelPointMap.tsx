"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import { Maximize2, Minimize2 } from "lucide-react";
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

export interface TravelMapPoint {
  lat: number;
  lng: number;
  time: string;
  speed_kmh?: number | null;
  battery_percent?: number | null;
  accuracy?: number | null;
}

export interface TravelMapStop {
  index: number;
  lat: number;
  lng: number;
  arrival: string;
  departure: string;
  duration_minutes: number;
}

export interface TravelMapLabels {
  fit_all: string;
  fullscreen: string;
  exit_fullscreen: string;
  empty: string;
  legend: string;
  start: string;
  end: string;
  stop: string;
  selected: string;
  duration: string;
}

interface Props {
  points: TravelMapPoint[];
  stops: TravelMapStop[];
  selectedIndex: number | null;
  labels: TravelMapLabels;
  /** Changing this value re-fits the map to the whole trail. */
  fitSignal: string;
}

const DHAKA_CENTER: [number, number] = [23.8103, 90.4125];
const SELECTED_COLOR = "#2563eb";
const START_COLOR = "#10b981";
const END_COLOR = "#64748b";
const STOP_COLOR = "#f59e0b";

function clock(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function pinIcon(color: string, size: number, pulse: boolean) {
  const html = `
    <div style="position:relative;display:flex;align-items:flex-end;justify-content:center;filter:drop-shadow(0 2px 3px rgba(15,23,42,.35));">
      ${pulse ? `<span style="position:absolute;bottom:-2px;left:50%;transform:translateX(-50%);width:${size + 12}px;height:${size + 12}px;border-radius:9999px;background:${color};opacity:.18;animation:oftpulse 1.6s ease-out infinite;"></span>` : ""}
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

const SELECTED_ICON = pinIcon(SELECTED_COLOR, 34, true);

function TrailController({
  points,
  selectedIndex,
  fitSignal,
}: {
  points: TravelMapPoint[];
  selectedIndex: number | null;
  fitSignal: string;
}) {
  const map = useMap();
  const lastFit = useRef<string | null>(null);
  const lastSelected = useRef<number | null>(null);

  useEffect(() => {
    if (lastFit.current === fitSignal) return;
    const valid = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (!valid.length) return;
    const bounds = L.latLngBounds(valid.map((p) => [p.lat, p.lng] as [number, number]));
    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.2), { animate: true });
      lastFit.current = fitSignal;
    }
  }, [fitSignal, points, map]);

  // Panning to the clicked record is the core interaction of this page.
  useEffect(() => {
    if (selectedIndex == null || selectedIndex === lastSelected.current) return;
    const point = points[selectedIndex];
    if (point && Number.isFinite(point.lat) && Number.isFinite(point.lng)) {
      map.flyTo([point.lat, point.lng], Math.max(map.getZoom(), 16), { duration: 0.6 });
      lastSelected.current = selectedIndex;
    }
  }, [selectedIndex, points, map]);

  return null;
}

function MapResizeHandler() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    // Leaflet measures its container once; the layout changes as the record list
    // grows, which would otherwise leave blank strips around the tiles.
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

export default function TravelPointMap({ points, stops, selectedIndex, labels, fitSignal }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fitTick, setFitTick] = useState(0);
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
      if (document.fullscreenElement) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch {
      /* Fullscreen can be blocked by the browser; ignore. */
    }
  }, []);

  const trail: [number, number][] = points
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map((p) => [p.lat, p.lng]);
  const hasPoints = trail.length > 0;
  const selectedPoint = selectedIndex != null ? points[selectedIndex] : null;
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];

  return (
    <div ref={rootRef} className="travel-map-root relative isolate h-full w-full overflow-hidden rounded-2xl">
      <style>{`@keyframes oftpulse{0%{transform:translateX(-50%) scale(.6);opacity:.35}100%{transform:translateX(-50%) scale(1.6);opacity:0}}.travel-map-root:fullscreen{border-radius:0;height:100%;width:100%}.travel-map-root:-webkit-full-screen{border-radius:0;height:100%;width:100%}`}</style>

      <MapContainer
        center={DHAKA_CENTER}
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
          <Polyline positions={trail} pathOptions={{ color: SELECTED_COLOR, weight: 3, opacity: 0.7 }} />
        )}

        {/* Places the employee actually stayed at. */}
        {stops.map((stop) => (
          <CircleMarker
            key={`stop-${stop.index}`}
            center={[stop.lat, stop.lng]}
            radius={7}
            pathOptions={{ color: "#ffffff", weight: 2, fillColor: STOP_COLOR, fillOpacity: 1 }}
          >
            <Popup>
              <div className="min-w-[140px] space-y-0.5">
                <p className="text-xs font-semibold text-gray-900">
                  {labels.stop} #{stop.index}
                </p>
                <p className="text-[11px] text-gray-500">
                  {clock(stop.arrival)} – {clock(stop.departure)}
                </p>
                <p className="text-[11px] text-gray-500">
                  {labels.duration}: {stop.duration_minutes} min
                </p>
              </div>
            </Popup>
          </CircleMarker>
        ))}

        {/* First and last fix of the day give the trail its two ends. */}
        {hasPoints && (
          <>
            <CircleMarker
              center={trail[0]}
              radius={7}
              pathOptions={{ color: "#ffffff", weight: 2, fillColor: START_COLOR, fillOpacity: 1 }}
            >
              <Popup>
                <div className="space-y-0.5">
                  <p className="text-xs font-semibold text-gray-900">{labels.start}</p>
                  <p className="text-[11px] text-gray-500">{firstPoint ? clock(firstPoint.time) : ""}</p>
                </div>
              </Popup>
            </CircleMarker>
            {trail.length > 1 && (
              <CircleMarker
                center={trail[trail.length - 1]}
                radius={7}
                pathOptions={{ color: "#ffffff", weight: 2, fillColor: END_COLOR, fillOpacity: 1 }}
              >
                <Popup>
                  <div className="space-y-0.5">
                    <p className="text-xs font-semibold text-gray-900">{labels.end}</p>
                    <p className="text-[11px] text-gray-500">{lastPoint ? clock(lastPoint.time) : ""}</p>
                  </div>
                </Popup>
              </CircleMarker>
            )}
          </>
        )}

        {selectedPoint && Number.isFinite(selectedPoint.lat) && Number.isFinite(selectedPoint.lng) && (
          <Marker position={[selectedPoint.lat, selectedPoint.lng]} icon={SELECTED_ICON} zIndexOffset={1000}>
            <Popup>
              <div className="min-w-[150px] space-y-0.5">
                <p className="text-xs font-semibold text-gray-900">
                  {labels.selected} · {clock(selectedPoint.time)}
                </p>
                {selectedPoint.speed_kmh != null && (
                  <p className="text-[11px] text-gray-500">{Math.round(selectedPoint.speed_kmh)} km/h</p>
                )}
                {selectedPoint.battery_percent != null && (
                  <p className="text-[11px] text-gray-500">{selectedPoint.battery_percent}%</p>
                )}
                {selectedPoint.accuracy != null && (
                  <p className="text-[11px] text-gray-500">± {Math.round(selectedPoint.accuracy)} m</p>
                )}
              </div>
            </Popup>
          </Marker>
        )}

        <TrailController points={points} selectedIndex={selectedIndex} fitSignal={`${fitSignal}|${fitTick}`} />
        <MapResizeHandler />
      </MapContainer>

      <div className="absolute right-3 top-3 z-[1000] flex items-center gap-2">
        <button
          type="button"
          onClick={() => setFitTick((t) => t + 1)}
          className="flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl border border-gray-200/80 bg-white/95 px-3 py-2.5 text-xs font-semibold text-gray-600 shadow-lg backdrop-blur transition-colors hover:bg-gray-100 sm:min-h-0 dark:border-slate-700 dark:bg-slate-900/95 dark:text-gray-300 dark:hover:bg-slate-800"
        >
          <span className="hidden sm:inline">{labels.fit_all}</span>
          <span className="sm:hidden">⤢</span>
        </button>
        {canFullscreen && (
          <button
            type="button"
            onClick={toggleFullscreen}
            title={isFullscreen ? labels.exit_fullscreen : labels.fullscreen}
            aria-label={isFullscreen ? labels.exit_fullscreen : labels.fullscreen}
            className="flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-xl border border-gray-200/80 bg-white/95 px-3 py-2.5 text-xs font-semibold text-gray-600 shadow-lg backdrop-blur transition-colors hover:bg-gray-100 sm:min-h-0 dark:border-slate-700 dark:bg-slate-900/95 dark:text-gray-300 dark:hover:bg-slate-800"
          >
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>

      {!hasPoints && (
        <div className="pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center bg-white/70 backdrop-blur-[1px] dark:bg-slate-950/60">
          <p className="px-6 text-center text-sm font-medium text-gray-500 dark:text-gray-400">{labels.empty}</p>
        </div>
      )}

      {hasPoints && (
        <div className="pointer-events-none absolute bottom-4 left-4 z-[1000] rounded-xl border border-gray-200/80 bg-white/95 px-3 py-2.5 shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{labels.legend}</p>
          <div className="space-y-1">
            <LegendRow color={START_COLOR} label={labels.start} />
            {stops.length > 0 && <LegendRow color={STOP_COLOR} label={labels.stop} />}
            <LegendRow color={END_COLOR} label={labels.end} />
            <LegendRow color={SELECTED_COLOR} label={labels.selected} />
          </div>
        </div>
      )}
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
