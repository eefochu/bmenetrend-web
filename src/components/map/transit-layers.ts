import type { ExpressionSpecification, GeoJSONSource, Map as LibreMap } from "maplibre-gl";
import type { FeatureCollection, Point, LineString } from "geojson";
import type { Stop, Vehicle } from "~/lib/transit/model";
import { emblem, transport, stationColor } from "~/lib/transit/badges";
import { stationOffsets, type Offset } from "./station-layout";

export const STOP_LAYER = "bm-stops";
export const VEHICLE_LAYER = "bm-vehicles";
export const TRANSIT_HIT_LAYERS = [
  "bm-stops",
  "bm-stops-rail",
  "bm-vehicles",
  "bm-vehicles-overview",
];
const FOCUS = "bm-focus";
/** StopMarkerLayout.sizeStops over the 22dp sprite. */
const STOP_SIZE: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  9,
  6 / 22,
  12,
  8 / 22,
  13,
  12 / 22,
  15,
  1,
  19,
  1,
];
export type MapLine = {
  coordinates: [number, number][];
  color: string;
  walking?: boolean;
};
const scenes = new WeakMap<
  LibreMap,
  {
    stops: Map<string, Stop>;
    offsets: Map<string, Offset>;
    previousStops?: Stop[];
    selected: string;
    center: string;
    focused?: string;
    stopData?: FeatureCollection<Point>;
    lastStopUpload?: FeatureCollection<Point>;
    loading: Set<string>;
  }
>();

function palette(stop: Stop) {
  const colors = stop.routes.map(stationColor);
  if (!colors.length)
    colors.push(
      transport({
        id: stop.rawId,
        mode: stop.mode,
        name: "",
        description: "",
        color: "",
        textColor: "",
      }).color,
    );
  return [...new Set(colors)].sort();
}
function stationSprite(
  colors: string[],
  selected: boolean,
  center: string,
  focused = false,
  /** StationSprite.kt: a focused single-colour stop takes the highlighted route's colour. */
  routeColor = "",
  dark = false,
) {
  // StationSprite.kt: 22dp ring, 3x raster, 4dp outer extent, dark accent centre.
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 90;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(3, 3);
  const circle = (radius: number, fill: string) => {
    ctx.beginPath();
    ctx.arc(15, 15, radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  };
  if (focused) circle(13.5, dark ? "#111D2C" : "#ffffff");
  circle(12.5, "#ffffff");
  circle(11, focused && colors.length === 1 && routeColor ? routeColor : colors[0]!);
  if (colors.length > 1)
    colors.forEach((color, index) => {
      ctx.beginPath();
      ctx.moveTo(15, 15);
      ctx.arc(
        15,
        15,
        10.25,
        -Math.PI / 2 + (index * 2 * Math.PI) / colors.length,
        -Math.PI / 2 + ((index + 1) * 2 * Math.PI) / colors.length,
      );
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 0.3;
      ctx.stroke();
    });
  if (!selected || colors.length > 1) {
    circle(7, "#ffffff");
    circle(6.5, center);
  }
  return ctx.getImageData(0, 0, 90, 90);
}

function arrowSprite(map: LibreMap, color: string) {
  const key = `bm-heading:${color}`;
  if (!map.hasImage(key)) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 84;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(3, 3);
    ctx.beginPath();
    ctx.moveTo(14, 1);
    ctx.lineTo(17, 7);
    ctx.lineTo(11, 7);
    ctx.closePath();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fill();
    map.addImage(key, ctx.getImageData(0, 0, 84, 84), { pixelRatio: 3 });
  }
  return key;
}

/** Android's source/layer ordering, sprite dimensions, offsets and zoom gates. No station name layer. */
export function updateTransitLayers(
  map: LibreMap,
  stops: Stop[],
  vehicles: Vehicle[],
  selected: string,
  lines: MapLine[],
  /** StationSprite: direction arrows are white on the dark map, slate on the light one. */
  dark = false,
) {
  let scene = scenes.get(map);
  if (!scene) {
    scene = {
      stops: new Map(),
      offsets: new Map(),
      selected: "",
      center: "",
      loading: new Set(),
    };
    scenes.set(map, scene);
  }
  const primary =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--md-sys-color-primary")
      .trim() || "#145fad";
  const components = primary
    .replace("#", "")
    .match(/.{2}/g)
    ?.map((part) => Math.round(parseInt(part, 16) * 0.1)) ?? [2, 9, 17];
  const center = `rgb(${components.join(",")})`;
  const routeColor = lines.find((line) => !line.walking)?.color ?? "";
  const focusKey = lines.length ? `focus-${routeColor}-${dark ? "dark" : "light"}` : "map";
  let stopData = scene.stopData;
  if (
    scene.previousStops !== stops ||
    scene.selected !== selected ||
    scene.center !== center ||
    scene.focused !== focusKey ||
    !stopData
  ) {
    stops.forEach((stop) => scene.stops.set(stop.id, stop));
    // Bound the working catalogue but retain stable offsets for neighbouring regions.
    while (scene.stops.size > 5000)
      scene.stops.delete(scene.stops.keys().next().value!);
    scene.offsets = stationOffsets([...scene.stops.values()], scene.offsets);
    stopData = {
      type: "FeatureCollection",
      features: stops.map((stop) => {
        const colors = palette(stop),
          highlighted = stop.id === selected,
          key = `bm-station:${colors.join("-")}:${highlighted}:${center}:${focusKey}`;
        if (!map.hasImage(key))
          map.addImage(
            key,
            stationSprite(colors, highlighted, center, Boolean(lines.length), routeColor, dark),
            {
              pixelRatio: 3,
            },
          );
        const offset = lines.length
          ? { x: 0, y: 0 }
          : (scene.offsets.get(stop.id) ?? { x: 0, y: 0 });
        return {
          type: "Feature",
          id: stop.id,
          geometry: {
            type: "Point",
            coordinates: [stop.position.lon, stop.position.lat],
          },
          properties: {
            id: stop.id,
            hasHeading: stop.bearing !== undefined,
            bearing: Math.round((stop.bearing ?? 0) / 5) * 5,
            arrowOffset: [
              offset.x * Math.cos(((stop.bearing ?? 0) * Math.PI) / 180) +
                offset.y * Math.sin(((stop.bearing ?? 0) * Math.PI) / 180),
              -offset.x * Math.sin(((stop.bearing ?? 0) * Math.PI) / 180) +
                offset.y * Math.cos(((stop.bearing ?? 0) * Math.PI) / 180),
            ],
            icon: key,
            offset: [offset.x, offset.y],
            rail: ["RAIL", "TRAMTRAIN"].includes(stop.mode),
          },
        };
      }),
    };
    scene.stopData = stopData;
    scene.previousStops = stops;
    scene.selected = selected;
    scene.center = center;
    scene.focused = focusKey;
  } else {
    // A style swap removes image registrations, while the CPU-side scene is still reusable.
    stops.forEach((stop) => {
      const colors = palette(stop),
        highlighted = stop.id === selected,
        key = `bm-station:${colors.join("-")}:${highlighted}:${center}:${focusKey}`;
      if (!map.hasImage(key))
        map.addImage(
          key,
          stationSprite(colors, highlighted, center, Boolean(lines.length), routeColor, dark),
          {
            pixelRatio: 3,
          },
        );
    });
  }
  const loadIcon = (asset: string) => {
    const key = `bm-native:${asset}`;
    if (!map.hasImage(key) && !scene.loading.has(key)) {
      scene.loading.add(key);
      void map
        .loadImage(asset)
        .then((image) => {
          if (!map.hasImage(key) && map.getStyle())
            map.addImage(key, image.data, { pixelRatio: 3 });
        })
        .catch(() => {
          /* Map may have unmounted; do not turn asset cancellation into a map outage. */
        })
        .finally(() => scene.loading.delete(key));
    }
    return key;
  };
  const vehicleData: FeatureCollection<Point> = {
    type: "FeatureCollection",
    features: vehicles
      .filter((vehicle) => Date.now() - vehicle.observedAt < 180_000)
      .map((vehicle) => {
        const route = vehicle.route ?? {
          id: vehicle.id,
          mode: vehicle.mode ?? "",
          name: "",
          description: "",
          color: "",
          textColor: "",
        };
        return {
          type: "Feature",
          id: vehicle.id,
          geometry: {
            type: "Point",
            coordinates: [vehicle.position.lon, vehicle.position.lat],
          },
          properties: {
            id: vehicle.id,
            icon: loadIcon(
              emblem(route, false) || `/transit/${transport(route).asset}.png`,
            ),
            rail: ["RAIL", "TRAMTRAIN"].includes(route.mode),
            selected: vehicle.id === selected,
            hasHeading: vehicle.bearing !== undefined,
            bearing: vehicle.bearing ?? 0,
            arrow: arrowSprite(map, transport(route).color),
            color: transport(route).color,
          },
        };
      }),
  };
  const lineData: FeatureCollection<LineString> = {
    type: "FeatureCollection",
    features: lines
      .filter((line) => line.coordinates.length > 1)
      .map((line) => ({
        type: "Feature",
        geometry: { type: "LineString", coordinates: line.coordinates },
        properties: { color: line.color, walking: !!line.walking },
      })),
  };
  for (const [id, data] of [
    [FOCUS, lineData],
    [STOP_LAYER, stopData],
    [VEHICLE_LAYER, vehicleData],
  ] as const) {
    const source = map.getSource<GeoJSONSource>(id);
    if (source) {
      if (id !== STOP_LAYER || scene.lastStopUpload !== data)
        void source.setData(data);
    } else map.addSource(id, { type: "geojson", data, maxzoom: 14 });
    if (id === STOP_LAYER) scene.lastStopUpload = stopData;
  }
  if (!map.getLayer(FOCUS)) {
    map.addLayer({
      id: `${FOCUS}-casing`,
      type: "line",
      source: FOCUS,
      // RouteLineLayer.kt: an opaque 8px casing (dark navy on the dark map) under the 5px stroke.
      paint: { "line-color": dark ? "#17212D" : "#ffffff", "line-width": 8 },
      layout: { "line-cap": "round", "line-join": "round" },
    });
    map.addLayer({
      id: FOCUS,
      type: "line",
      source: FOCUS,
      paint: { "line-color": ["get", "color"], "line-width": 5 },
      layout: { "line-cap": "round", "line-join": "round" },
    });
    map.addLayer({
      id: `${FOCUS}-walk`,
      type: "line",
      source: FOCUS,
      filter: ["==", ["get", "walking"], true],
      paint: {
        "line-color": "#536171",
        "line-width": 5,
        "line-dasharray": [0.1, 2],
      },
      layout: { "line-cap": "round" },
    });
  }
  const casing = dark ? "#17212D" : "#ffffff";
  if (map.getPaintProperty(`${FOCUS}-casing`, "line-color") !== casing)
    map.setPaintProperty(`${FOCUS}-casing`, "line-color", casing);
  const stationArrowLayer = "bm-station-arrow";
  const stationArrow = `bm-station-arrow:${dark ? "dark" : "light"}`;
  if (!map.hasImage(stationArrow)) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 114;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(3, 3);
    ctx.beginPath();
    ctx.moveTo(19, 1);
    ctx.lineTo(23, 10);
    ctx.lineTo(15, 10);
    ctx.closePath();
    ctx.fillStyle = dark ? "#ffffff" : "#334455";
    ctx.fill();
    map.addImage(stationArrow, ctx.getImageData(0, 0, 114, 114), {
      pixelRatio: 3,
    });
  }
  if (map.getLayer(stationArrowLayer)) {
    if (map.getLayoutProperty(stationArrowLayer, "icon-image") !== stationArrow)
      map.setLayoutProperty(stationArrowLayer, "icon-image", stationArrow);
  }
  else
    map.addLayer({
      id: stationArrowLayer,
      type: "symbol",
      source: STOP_LAYER,
      filter: ["get", "hasHeading"],
      layout: {
        "icon-image": stationArrow,
        "icon-rotate": ["get", "bearing"],
        "icon-offset": ["get", "arrowOffset"],
        "icon-rotation-alignment": "map",
        "icon-pitch-alignment": "viewport",
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-size": STOP_SIZE,
      },
    });
  map.setLayerZoomRange(stationArrowLayer, lines.length ? 0 : 14, 24);
  // StationMarkerLayers.configure: arrows share the dots' scale, 16dp on a focused route.
  const arrowSize = lines.length ? 16 / 22 : STOP_SIZE;
  if (JSON.stringify(map.getLayoutProperty(stationArrowLayer, "icon-size")) !== JSON.stringify(arrowSize))
    map.setLayoutProperty(stationArrowLayer, "icon-size", arrowSize);
  for (const rail of [true, false]) {
    const id = rail ? `${STOP_LAYER}-rail` : STOP_LAYER;
    if (!map.getLayer(id))
      map.addLayer({
        id,
        type: "symbol",
        source: STOP_LAYER,
        filter: ["==", ["get", "rail"], rail],
        layout: {
          "icon-image": ["get", "icon"],
          "icon-offset": ["get", "offset"],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-rotation-alignment": "map",
          "icon-pitch-alignment": "viewport",
          "icon-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            9,
            6 / 22,
            12,
            8 / 22,
            13,
            12 / 22,
            15,
            1,
            19,
            1,
          ],
        },
      });
    map.setLayerZoomRange(id, lines.length ? 0 : rail ? 9 : 14, 24);
    map.setLayoutProperty(
      id,
      "icon-size",
      lines.length
        ? 16 / 22
        : [
            "interpolate",
            ["linear"],
            ["zoom"],
            9,
            6 / 22,
            12,
            8 / 22,
            13,
            12 / 22,
            15,
            1,
            19,
            1,
          ],
    );
  }
  for (const overview of [true, false]) {
    const id = overview ? "bm-headings-overview" : "bm-headings";
    if (!map.getLayer(id))
      map.addLayer({
        id,
        type: "symbol",
        source: VEHICLE_LAYER,
        filter: [
          "all",
          ["get", "hasHeading"],
          overview ? ["get", "rail"] : true,
        ],
        layout: {
          "icon-image": ["get", "arrow"],
          "icon-rotate": ["get", "bearing"],
          "icon-rotation-alignment": "map",
          "icon-pitch-alignment": "viewport",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-size": [
            "case",
            ["get", "selected"],
            (30 / 18) * (overview ? 0.7 : 1),
            (26 / 18) * (overview ? 0.7 : 1),
          ],
        },
      });
    map.setLayerZoomRange(
      id,
      overview ? 7 : lines.length ? 0 : 15,
      overview ? 15 : 24,
    );
    map.setLayoutProperty(
      id,
      "visibility",
      overview && lines.length ? "none" : "visible",
    );
  }
  for (const overview of [true, false]) {
    const id = overview ? `${VEHICLE_LAYER}-overview` : VEHICLE_LAYER;
    if (!map.getLayer(id))
      map.addLayer({
        id,
        type: "symbol",
        source: VEHICLE_LAYER,
        filter: overview ? ["==", ["get", "rail"], true] : true,
        layout: {
          "icon-image": ["get", "icon"],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-rotation-alignment": "viewport",
          "icon-size": [
            "case",
            ["get", "selected"],
            (30 / 36) * (overview ? 0.7 : 1),
            (26 / 36) * (overview ? 0.7 : 1),
          ],
        },
      });
    map.setLayerZoomRange(
      id,
      overview ? 7 : lines.length ? 0 : 15,
      overview ? 15 : 24,
    );
    map.setLayoutProperty(
      id,
      "visibility",
      overview && lines.length ? "none" : "visible",
    );
  }
}
