"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { MapContainer, Marker, Polyline, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  avatarHtml,
  batteryGlyph,
  displayName,
  escapeHtml,
  identityCodes,
  markerTitle,
  MAP_CENTER,
  pinColor,
  type LiveMapItem,
  type LiveMapLabels,
} from "./liveMapShared";
import { FullscreenButton, MapEmptyOverlay, MapLegend, useMapFullscreen } from "./MapChrome";

// The map item/label types are shared with the Google Maps implementation.
export type { LiveMapItem, LiveMapLabels } from "./liveMapShared";

interface Props {
  items: LiveMapItem[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  trail: [number, number][];
  labels: LiveMapLabels;
  fitSignal: number;
  emptyLabel: string;
}

const DHAAKU_CENTER: [number, number] = [MAP_CENTER.lat, MAP_CENTER.lng];

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
  const name = displayName(item);
  const codes = identityCodes(item);
  const statusLabel = item.is_online ? labels.online : labels.offline;
  const statusColor = item.is_online ? "#059669" : "#64748b";
  const accessibleName = markerTitle(item, labels);

  const html = `
    <div style="position:relative;display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 2px 3px rgba(15,23,42,.35));">
      <div title="${escapeHtml(accessibleName)}" style="width:max-content;max-width:${LABEL_WIDTH}px;height:${LABEL_HEIGHT}px;box-sizing:border-box;background:#ffffff;border:1px solid rgba(203,213,225,.9);border-radius:12px;padding:6px 9px;text-align:left;overflow:hidden;display:flex;flex-direction:column;justify-content:center;">
        <div style="display:flex;align-items:center;gap:6px;min-width:0;height:22px;">
          ${avatarHtml(item, color)}
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
  const { isFullscreen, canFullscreen, toggleFullscreen } = useMapFullscreen(rootRef);
  // Zoom at which the marker's identity card becomes visible; published by
  // ZoomWatcher so marker icons can be swapped without re-mounting the map.
  const [zoom, setZoom] = useState<number>(7);

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

      <FullscreenButton
        canFullscreen={canFullscreen}
        isFullscreen={isFullscreen}
        labels={labels}
        onToggle={toggleFullscreen}
      />

      {!hasPoints && <MapEmptyOverlay label={emptyLabel} />}

      <MapLegend labels={labels} />
    </div>
  );
}
