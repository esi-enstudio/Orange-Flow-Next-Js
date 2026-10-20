"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, ShieldAlert } from "lucide-react";
import { googleMapsApiKey, loadGoogleMaps } from "@/lib/googleMaps";
import { FullscreenButton, MapEmptyOverlay, MapLegend, useMapFullscreen } from "./MapChrome";
import {
  avatarHtml,
  batteryGlyph,
  displayName,
  escapeHtml,
  identityCodes,
  MAP_CENTER,
  markerTitle,
  PIN_PATH,
  pinColor,
  type LiveMapItem,
  type LiveMapLabels,
} from "./liveMapShared";

interface Props {
  items: LiveMapItem[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  trail: [number, number][];
  labels: LiveMapLabels;
  fitSignal: number;
  emptyLabel: string;
  /** Offered when Google rejects the API key (e.g. a referrer restriction). */
  onFallback?: () => void;
}

// PIN_PATH is drawn in a 26x36 box, so the tip sits at the bottom centre.
const PIN_ANCHOR = { x: 13, y: 36 };

// Google calls `window.gm_authFailure` when the key/billing check fails
// (InvalidKeyMapError, RefererNotAllowedMapError, ...).
type AuthFailureWindow = Window & { gm_authFailure?: () => void };

/**
 * Google shows its own low-contrast error dialog over the map for these
 * failures; this handler lets the page replace it with an actionable message.
 */
function useGoogleAuthFailure(onFailure: () => void) {
  const onFailureRef = useRef(onFailure);
  useEffect(() => {
    onFailureRef.current = onFailure;
  });

  useEffect(() => {
    const authWindow = window as AuthFailureWindow;
    const previous = authWindow.gm_authFailure;
    authWindow.gm_authFailure = () => onFailureRef.current();
    return () => {
      if (authWindow.gm_authFailure && previous) {
        authWindow.gm_authFailure = previous;
      } else {
        delete authWindow.gm_authFailure;
      }
    };
  }, []);
}

/**
 * The selected employee's card, rendered inside an InfoWindow. Same content and
 * palette as the Leaflet identity card so switching providers keeps the map
 * readable: avatar, name, DMS / iTopUp numbers, status and battery.
 */
function infoWindowHtml(item: LiveMapItem, labels: LiveMapLabels): string {
  const color = pinColor(item);
  const name = escapeHtml(displayName(item));
  const codes = escapeHtml(identityCodes(item));
  const statusLabel = escapeHtml(item.is_online ? labels.online : labels.offline);
  const statusColor = item.is_online ? "#059669" : "#64748b";

  return `<div style="min-width:190px;max-width:240px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;">
    <div style="display:flex;align-items:center;gap:8px;">
      ${avatarHtml(item, color)}
      <span style="min-width:0;font-size:13px;font-weight:700;line-height:18px;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</span>
    </div>
    <div style="margin-top:6px;font-size:11px;line-height:14px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${codes}</div>
    <div style="margin-top:8px;display:flex;align-items:center;justify-content:space-between;gap:10px;">
      <span style="display:inline-flex;align-items:center;gap:5px;">
        <span style="flex:0 0 auto;width:7px;height:7px;border-radius:9999px;background:${item.is_online ? "#10b981" : "#64748b"};"></span>
        <span style="font-size:11px;font-weight:600;color:${statusColor};">${statusLabel}</span>
      </span>
      ${batteryGlyph(item)}
    </div>
  </div>`;
}

function validPoint(item: LiveMapItem): boolean {
  return Number.isFinite(item.latitude) && Number.isFinite(item.longitude);
}

export default function GoogleLocationMap({
  items,
  selectedId,
  onSelect,
  trail,
  labels,
  fitSignal,
  emptyLabel,
  onFallback,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Map<number, google.maps.Marker>>(new Map());
  const infoRef = useRef<google.maps.InfoWindow | null>(null);
  const trailRef = useRef<google.maps.Polyline | null>(null);
  const lastFitRef = useRef(-1);
  const lastFocusRef = useRef<number | null>(null);
  const openInfoRef = useRef<number | null>(null);
  const infoSigRef = useRef("");

  // Callbacks / labels are read from refs so changing them never re-creates the
  // map or re-runs the focus animation.
  const onSelectRef = useRef(onSelect);
  const labelsRef = useRef(labels);
  useEffect(() => {
    onSelectRef.current = onSelect;
    labelsRef.current = labels;
  });

  const [status, setStatus] = useState<"loading" | "ready" | "error" | "auth-error">("loading");
  const { isFullscreen, canFullscreen, toggleFullscreen } = useMapFullscreen(rootRef);

  // Registered before the script loads so the very first auth failure is caught.
  useGoogleAuthFailure(() => setStatus("auth-error"));

  const hasPoints = items.some(validPoint);
  // The page rebuilds the labels object every render; the signatures keep the
  // marker/info-window effects from re-running on unrelated re-renders.
  const labelsSig = `${labels.online}|${labels.offline}`;

  // Create the map once. `@googlemaps/js-api-loader` is not used — the script is
  // injected by `loadGoogleMaps` so there is a single loader for the whole app.
  useEffect(() => {
    const apiKey = googleMapsApiKey();
    if (!apiKey) {
      setStatus("error");
      return;
    }

    let cancelled = false;
    loadGoogleMaps(apiKey)
      .then(() => {
        if (cancelled) return;
        if (!mapRef.current && containerRef.current) {
          mapRef.current = new google.maps.Map(containerRef.current, {
            center: MAP_CENTER,
            zoom: 7,
            // The page provides its own fullscreen control; keep Google's off so
            // the two buttons don't overlap.
            fullscreenControl: false,
            streetViewControl: false,
            mapTypeControl: true,
            clickableIcons: false,
            backgroundColor: "#e5e7eb",
          });
          infoRef.current = new google.maps.InfoWindow({ disableAutoPan: true });
          infoRef.current.addListener("closeclick", () => {
            openInfoRef.current = null;
          });
        }
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Sync markers with the live data and the current selection.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;

    const markers = markersRef.current;
    const liveIds = new Set(items.map((item) => item.employee_id));

    markers.forEach((marker, id) => {
      if (!liveIds.has(id)) {
        marker.setMap(null);
        markers.delete(id);
      }
    });

    items.forEach((item) => {
      if (!validPoint(item)) return;
      const isSelected = item.employee_id === selectedId;
      const position = { lat: item.latitude, lng: item.longitude };
      const icon: google.maps.Symbol = {
        path: PIN_PATH,
        fillColor: pinColor(item),
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 2,
        scale: isSelected ? 1.3 : 1,
        anchor: new google.maps.Point(PIN_ANCHOR.x, PIN_ANCHOR.y),
      };

      let marker = markers.get(item.employee_id);
      if (!marker) {
        marker = new google.maps.Marker({
          map,
          position,
          icon,
          title: markerTitle(item, labelsRef.current),
        });
        marker.addListener("click", () => onSelectRef.current(item.employee_id));
        markers.set(item.employee_id, marker);
      } else {
        marker.setPosition(position);
        marker.setIcon(icon);
      }

      marker.setTitle(markerTitle(item, labelsRef.current));
      marker.setZIndex(isSelected ? 2000 : 1000);
    });
  }, [items, labelsSig, selectedId, status]);

  // Focus the selected employee and show their identity card.
  useEffect(() => {
    const map = mapRef.current;
    const info = infoRef.current;
    if (!map || !info || status !== "ready") return;

    if (selectedId == null) {
      info.close();
      openInfoRef.current = null;
      lastFocusRef.current = null;
      return;
    }

    const item = items.find((i) => i.employee_id === selectedId);
    if (!item || !validPoint(item)) return;

    if (lastFocusRef.current !== selectedId) {
      map.panTo({ lat: item.latitude, lng: item.longitude });
      map.setZoom(Math.max(map.getZoom() ?? 7, 14));
      lastFocusRef.current = selectedId;
    }

    // Only repaint the card when something the card shows actually changed.
    const signature = [
      selectedId,
      labelsRef.current.online,
      item.employee_name,
      item.dms_code,
      item.itop_number,
      item.pool_number,
      item.photo_url,
      item.battery_percent,
      item.battery_status,
      item.is_online,
      item.latitude,
      item.longitude,
    ].join("|");
    if (infoSigRef.current !== signature) {
      info.setContent(infoWindowHtml(item, labelsRef.current));
      infoSigRef.current = signature;
    }

    if (openInfoRef.current !== selectedId) {
      const marker = markersRef.current.get(selectedId);
      if (marker) {
        info.open({ map, anchor: marker });
      } else {
        info.setPosition({ lat: item.latitude, lng: item.longitude });
        info.open({ map });
      }
      openInfoRef.current = selectedId;
    }
  }, [items, labelsSig, selectedId, status]);

  // "Fit all" (and the first paint) frames every employee on the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready" || lastFitRef.current === fitSignal) return;

    const points = items.filter(validPoint);
    if (points.length === 0) return;

    lastFitRef.current = fitSignal;
    if (points.length === 1) {
      map.setCenter({ lat: points[0].latitude, lng: points[0].longitude });
      map.setZoom(15);
      return;
    }

    const bounds = new google.maps.LatLngBounds();
    points.forEach((p) => bounds.extend({ lat: p.latitude, lng: p.longitude }));
    map.fitBounds(bounds, 48);
  }, [fitSignal, items, status]);

  // Movement trail of the selected employee.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || status !== "ready") return;

    if (trail.length < 2) {
      trailRef.current?.setMap(null);
      trailRef.current = null;
      return;
    }

    const path = trail.map(([lat, lng]) => ({ lat, lng }));
    if (!trailRef.current) {
      trailRef.current = new google.maps.Polyline({
        map,
        path,
        strokeColor: "#2563eb",
        strokeOpacity: 0.75,
        strokeWeight: 3,
      });
    } else {
      trailRef.current.setPath(path);
    }
  }, [trail, status]);

  return (
    <div
      ref={rootRef}
      className="live-map-root relative isolate h-full w-full overflow-hidden rounded-2xl"
    >
      <style>{`.live-map-root:fullscreen{border-radius:0;height:100%;width:100%}.live-map-root:-webkit-full-screen{border-radius:0;height:100%;width:100%}`}</style>

      <div ref={containerRef} className="h-full w-full" style={{ minHeight: "420px", background: "#e5e7eb" }} />

      <FullscreenButton
        canFullscreen={canFullscreen}
        isFullscreen={isFullscreen}
        labels={labels}
        onToggle={toggleFullscreen}
      />

      {status === "loading" && (
        <div className="absolute inset-0 z-[1000] flex flex-col items-center justify-center gap-2 bg-white/80 backdrop-blur-[1px] dark:bg-slate-950/70">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">{labels.google_loading}</p>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 z-[1000] flex flex-col items-center justify-center gap-2 bg-white/90 px-6 text-center backdrop-blur-[1px] dark:bg-slate-950/80">
          <AlertTriangle className="h-6 w-6 text-amber-500" />
          <p className="max-w-xs text-sm font-medium text-gray-600 dark:text-gray-300">{labels.google_error}</p>
        </div>
      )}

      {status === "auth-error" && (
        <div className="absolute inset-0 z-[1000] flex flex-col items-center justify-center gap-3 bg-white/95 px-6 text-center backdrop-blur-[1px] dark:bg-slate-950/85">
          <ShieldAlert className="h-6 w-6 text-amber-500" />
          <p className="max-w-sm text-sm font-medium text-gray-600 dark:text-gray-300">{labels.google_auth_error}</p>
          {onFallback && (
            <button
              type="button"
              onClick={onFallback}
              className="flex min-h-[44px] cursor-pointer items-center rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-700"
            >
              {labels.switch_to_osm}
            </button>
          )}
        </div>
      )}

      {status === "ready" && !hasPoints && <MapEmptyOverlay label={emptyLabel} />}

      {status === "ready" && <MapLegend labels={labels} />}
    </div>
  );
}
