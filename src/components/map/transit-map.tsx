import { useEffect, useRef, useState } from "react";
import {
  getVersion,
  LngLatBounds,
  Map,
  Marker,
  setWorkerUrl,
  type GeoJSONSource,
} from "maplibre-gl";

import { INITIAL_CAMERA, MAP_STYLES } from "~/lib/map-config";
import type { GeoPoint, PlaceResult } from "~/lib/places";
import { t } from "~/lib/strings";
import type { Stop, Vehicle } from "~/lib/transit/model";
import { distanceMeters } from "~/lib/places";
import {
  updateTransitLayers,
  VEHICLE_LAYER,
  TRANSIT_HIT_LAYERS,
  type MapLine,
} from "./transit-layers";
import { attachStyleImages } from "./style-images";

setWorkerUrl(`/maplibre/maplibre-gl-worker.mjs?v=${getVersion()}`);

const EMPTY_STOPS: Stop[] = [];
const EMPTY_VEHICLES: Vehicle[] = [];
const EMPTY_LINES: MapLine[] = [];

const ROUTE_SOURCE = "bm-route-preview";

export type RoutePreview = {
  origin: GeoPoint | null;
  destination: GeoPoint | null;
};

type TransitMapProps = {
  styleUrl: string;
  /** Camera padding so the visible map centre clears the sheet (Android's bottomPaddingPx). */
  bottomPadding?: number;
  /** Desktop: the departures panel docks on the left instead. */
  leftPadding?: number;
  userPosition?: GeoPoint | null;
  /** Each increment flies to the user position (Android's locationCameraRequest). */
  locateRequest?: number;
  place?: PlaceResult | null;
  /** Each increment frames the selected place (placeCameraRequest). */
  placeRequest?: number;
  route?: RoutePreview | null;
  routeColor?: string;
  onMapClick?: () => void;
  className?: string;
  stops?: Stop[];
  vehicles?: Vehicle[];
  selected?: string;
  lines?: MapLine[];
  focusPoint?: GeoPoint | null;
  /** A route, trip or vehicle view: the camera before it is restored when it closes (NativeTransitMap previousCamera). */
  focused?: boolean;
  onStopSelected?: (stop: Stop) => void;
  onVehicleSelected?: (vehicle: Vehicle) => void;
  onViewportChanged?: (area: {
    lat: number;
    lon: number;
    radius: number;
    zoom: number;
  }) => void;
};

function element(className: string) {
  const node = document.createElement("div");
  node.className = className;
  node.setAttribute("aria-hidden", "true");
  return node;
}

function pin() {
  const node = element("map-pin");
  node.innerHTML = '<span class="icon">location_on</span>';
  return node;
}

export default function TransitMap({
  styleUrl,
  bottomPadding = 0,
  leftPadding = 0,
  userPosition,
  locateRequest = 0,
  place,
  placeRequest = 0,
  route,
  routeColor = "#145fad",
  onMapClick,
  className,
  stops = EMPTY_STOPS,
  vehicles = EMPTY_VEHICLES,
  selected = "",
  lines = EMPTY_LINES,
  focusPoint,
  focused = false,
  onStopSelected,
  onVehicleSelected,
  onViewportChanged,
}: TransitMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [styleRevision, setStyleRevision] = useState(0);
  const styleReady = useRef(false);
  const lastFit = useRef("");
  const initialStyle = useRef(styleUrl);
  initialStyle.current = styleUrl;
  const transit = useRef({
    stops,
    vehicles,
    onStopSelected,
    onVehicleSelected,
    onViewportChanged,
  });
  transit.current = {
    stops,
    vehicles,
    onStopSelected,
    onVehicleSelected,
    onViewportChanged,
  };
  const click = useRef(onMapClick);
  click.current = onMapClick;

  useEffect(() => {
    if (!container.current) return;
    let map: Map;
    try {
      map = new Map({
        container: container.current,
        ...INITIAL_CAMERA,
        style: initialStyle.current,
        attributionControl: false,
        locale: { "Map.Title": t.mapLabel },
      });
    } catch {
      setStatus("error");
      return;
    }
    mapRef.current = map;
    attachStyleImages(map);
    // Idle also fires after failed requests; retain the retry action on failure.
    let loadFailed = false;
    map.on("error", () => {
      loadFailed = true;
      setStatus("error");
    });
    map.on("idle", () => {
      if (!loadFailed) setStatus("ready");
    });
    map.on("style.load", () => {
      loadFailed = false;
      styleReady.current = true;
      setStyleRevision((value) => value + 1);
    });
    const report = () => {
      const center = map.getCenter(),
        bounds = map.getBounds();
      const radius =
        Math.ceil(
          distanceMeters(
            { lat: center.lat, lon: center.lng },
            { lat: bounds.getNorth(), lon: bounds.getEast() },
          ) / 500,
        ) *
          500 +
        500;
      transit.current.onViewportChanged?.({
        lat: Math.round(center.lat * 200) / 200,
        lon: Math.round(center.lng * 200) / 200,
        radius: Math.max(1000, Math.min(5000, radius)),
        zoom: map.getZoom(),
      });
    };
    map.on("moveend", report);
    map.on("load", report);
    map.on("click", (event) => {
      const layers = TRANSIT_HIT_LAYERS.filter((id) => map.getLayer(id));
      const features = layers.length
        ? map.queryRenderedFeatures(
            [
              [event.point.x - 10, event.point.y - 10],
              [event.point.x + 10, event.point.y + 10],
            ],
            { layers },
          )
        : [];
      const vehicleFeature = features.find((feature) =>
        feature.layer.id.startsWith(VEHICLE_LAYER),
      );
      const vehicle = transit.current.vehicles.find(
        (item) => item.id === vehicleFeature?.properties.id,
      );
      if (vehicle) {
        transit.current.onVehicleSelected?.(vehicle);
        return;
      }
      const stop = transit.current.stops.find(
        (item) => item.id === features[0]?.properties.id,
      );
      if (stop) {
        transit.current.onStopSelected?.(stop);
        return;
      }
      click.current?.();
    });
    map.on("mousemove", (event) => {
      const layers = TRANSIT_HIT_LAYERS.filter((id) => map.getLayer(id));
      map.getCanvas().style.cursor =
        layers.length &&
        map.queryRenderedFeatures(event.point, { layers }).length
          ? "pointer"
          : "";
    });
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      styleReady.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, [attempt]);

  // Style changes keep the camera: Android swaps styles on the same map as well.
  const appliedStyle = useRef(styleUrl);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || appliedStyle.current === styleUrl) return;
    appliedStyle.current = styleUrl;
    setStatus("loading");
    styleReady.current = false;
    map.setStyle(styleUrl, { diff: false });
  }, [styleUrl, attempt]);

  useEffect(() => {
    mapRef.current?.easeTo({
      padding: { top: 0, right: 0, left: leftPadding, bottom: bottomPadding },
      duration: 250,
    });
  }, [bottomPadding, leftPadding, attempt]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && styleRevision > 0 && styleReady.current)
      updateTransitLayers(map, stops, vehicles, selected, lines, styleUrl === MAP_STYLES.dark);
  }, [stops, vehicles, selected, lines, styleRevision, styleUrl]);

  // NativeTransitMap: remember the camera when a route/vehicle focus starts and fly back to it when the
  // focus ends without a selected stop (sheet swiped away, route view closed). Declared before the
  // focus-point and fit effects so it captures the camera before they move it.
  const savedCamera = useRef<{ center: [number, number]; zoom: number; bearing: number; pitch: number } | null>(null);
  const wasFocused = useRef(false);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const paddingRef = useRef({ leftPadding, bottomPadding });
  paddingRef.current = { leftPadding, bottomPadding };
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (focused && !wasFocused.current) {
      const center = map.getCenter();
      savedCamera.current = {
        center: [center.lng, center.lat],
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      };
    } else if (!focused && wasFocused.current) {
      const camera = savedCamera.current;
      savedCamera.current = null;
      if (camera && !selectedRef.current)
        map.easeTo({
          ...camera,
          padding: { top: 0, right: 0, left: paddingRef.current.leftPadding, bottom: paddingRef.current.bottomPadding },
          duration: 650,
        });
    }
    wasFocused.current = focused;
  }, [focused]);

  useEffect(() => {
    if (focusPoint)
      mapRef.current?.flyTo({
        center: [focusPoint.lon, focusPoint.lat],
        zoom: Math.max(15, mapRef.current.getZoom()),
      });
  }, [focusPoint]);

  useEffect(() => {
    const points = lines.flatMap((line) => line.coordinates);
    const key = `${points.length}:${points[0]?.join(":")}:${points.at(-1)?.join(":")}`;
    if (!points.length) {
      lastFit.current = "";
      return;
    }
    if (key === lastFit.current || !mapRef.current) return;
    lastFit.current = key;
    const bounds = new LngLatBounds(points[0], points[0]);
    points.forEach((point) => bounds.extend(point));
    // The map's camera padding already clears the sheet / docked panel; MapLibre adds these margins to it.
    mapRef.current.fitBounds(bounds, {
      padding: { top: 90, right: 40, bottom: 30, left: 30 },
      maxZoom: 16,
      duration: 500,
    });
  }, [lines]);

  // User location dot.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !userPosition) return;
    const marker = new Marker({ element: element("user-dot") })
      .setLngLat([userPosition.lon, userPosition.lat])
      .addTo(map);
    return () => {
      marker.remove();
    };
  }, [userPosition, attempt]);

  const lastLocate = useRef(locateRequest);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !userPosition || locateRequest === lastLocate.current) return;
    lastLocate.current = locateRequest;
    map.flyTo({
      center: [userPosition.lon, userPosition.lat],
      zoom: Math.max(map.getZoom(), 16),
    });
  }, [locateRequest, userPosition]);

  // Selected place pin and camera.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !place) return;
    const marker = new Marker({ element: pin(), anchor: "bottom" })
      .setLngLat([place.position.lon, place.position.lat])
      .addTo(map);
    return () => {
      marker.remove();
    };
  }, [place, attempt]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !place || placeRequest === 0) return;
    if (place.bounds) {
      const { west, south, east, north } = place.bounds;
      map.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        { padding: 48, maxZoom: 17 },
      );
    } else {
      map.flyTo({ center: [place.position.lon, place.position.lat], zoom: 16 });
    }
    // Only a new request moves the camera; padding changes alone must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeRequest]);

  // Planner preview: origin dot, destination pin and a dotted straight line (PlannerScreen dottedRoute).
  const origin = route?.origin;
  const destination = route?.destination;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers: Marker[] = [];
    if (origin)
      markers.push(
        new Marker({ element: element("origin-dot") })
          .setLngLat([origin.lon, origin.lat])
          .addTo(map),
      );
    if (destination)
      markers.push(
        new Marker({ element: pin(), anchor: "bottom" })
          .setLngLat([destination.lon, destination.lat])
          .addTo(map),
      );
    return () => markers.forEach((marker) => marker.remove());
  }, [origin, destination, attempt]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || styleRevision === 0) return;
    const coordinates =
      origin && destination
        ? [
            [origin.lon, origin.lat],
            [destination.lon, destination.lat],
          ]
        : [];
    const data = {
      type: "Feature" as const,
      properties: {},
      geometry: { type: "LineString" as const, coordinates },
    };
    const source = map.getSource<GeoJSONSource>(ROUTE_SOURCE);
    if (source) void source.setData(data);
    else if (coordinates.length) {
      map.addSource(ROUTE_SOURCE, { type: "geojson", data });
      map.addLayer({
        id: ROUTE_SOURCE,
        type: "line",
        source: ROUTE_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": routeColor,
          "line-width": 5,
          "line-dasharray": [0.1, 2],
        },
      });
    }
    if (map.getLayer(ROUTE_SOURCE))
      map.setPaintProperty(ROUTE_SOURCE, "line-color", routeColor);
  }, [origin, destination, routeColor, styleRevision]);

  // Like previewCameraRequest, only a new destination frames the trip; location fixes do not.
  const originRef = useRef(origin);
  originRef.current = origin;
  useEffect(() => {
    const map = mapRef.current;
    const origin = originRef.current;
    if (!map || !destination) return;
    if (origin) {
      const bounds = new LngLatBounds(
        [origin.lon, origin.lat],
        [origin.lon, origin.lat],
      ).extend([destination.lon, destination.lat]);
      map.fitBounds(bounds, { padding: 64, maxZoom: 16 });
    } else map.flyTo({ center: [destination.lon, destination.lat], zoom: 15 });
  }, [destination]);

  return (
    <div className={`transit-map${className ? ` ${className}` : ""}`}>
      <div
        ref={container}
        className="transit-map-canvas"
        aria-label={t.mapLabel}
      />
      {status !== "ready" && (
        <div className="map-status" role="status" aria-live="polite">
          {status === "loading" ? (
            <span>{t.mapLoading}</span>
          ) : (
            <>
              <span>{t.mapFailed}</span>
              <button
                type="button"
                className="button button-outlined"
                onClick={() => {
                  appliedStyle.current = styleUrl;
                  setStatus("loading");
                  setAttempt((value) => value + 1);
                }}
              >
                {t.mapRetry}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
