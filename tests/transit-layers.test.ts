import { expect, test } from "bun:test";
import type { Map as LibreMap } from "maplibre-gl";
import {
  validateStyleMin,
  type StyleSpecification,
} from "@maplibre/maplibre-gl-style-spec";
import {
  updateTransitLayers,
  STOP_LAYER,
} from "../src/components/map/transit-layers";
import type { Stop, Vehicle } from "../src/lib/transit/model";

test("native sprite layers validate, omit station labels and don't re-upload stops on vehicle ticks", () => {
  const context = {
    scale() {},
    beginPath() {},
    arc() {},
    fill() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    stroke() {},
    getImageData: () => ({
      width: 90,
      height: 90,
      data: new Uint8ClampedArray(90 * 90 * 4),
    }),
  };
  let primary = "#145fad";
  const originalDocument = globalThis.document,
    originalComputed = globalThis.getComputedStyle;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      documentElement: {},
      createElement: () => ({ getContext: () => context }),
    },
  });
  Object.defineProperty(globalThis, "getComputedStyle", {
    configurable: true,
    value: () => ({ getPropertyValue: () => primary }),
  });
  const images = new Set<string>(),
    sources = new Map<
      string,
      { data: unknown; uploads: number; setData: (data: unknown) => void }
    >(),
    layers: Record<string, unknown>[] = [];
  const map = {
    hasImage: (id: string) => images.has(id),
    addImage: (id: string) => images.add(id),
    loadImage: async () => ({
      data: {
        width: 108,
        height: 108,
        data: new Uint8ClampedArray(108 * 108 * 4),
      },
    }),
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, source: { data: unknown }) => {
      const entry = {
        data: source.data,
        uploads: 1,
        setData: (data: unknown) => {
          entry.data = data;
          entry.uploads++;
        },
      };
      sources.set(id, entry);
    },
    getLayer: (id: string) => layers.find((layer) => layer.id === id),
    addLayer: (layer: Record<string, unknown>) => layers.push(layer),
    getStyle: () => ({}),
    setLayerZoomRange: (id: string, min: number, max: number) => {
      const layer = layers.find((layer) => layer.id === id)!;
      layer.minzoom = min;
      layer.maxzoom = max;
    },
    getPaintProperty: (id: string, key: string) =>
      (layers.find((layer) => layer.id === id)?.paint as Record<string, unknown> | undefined)?.[key],
    setPaintProperty: (id: string, key: string, value: unknown) => {
      const layer = layers.find((layer) => layer.id === id)!;
      layer.paint = { ...(layer.paint as object), [key]: value };
    },
    getLayoutProperty: (id: string, key: string) =>
      (layers.find((layer) => layer.id === id)?.layout as Record<string, unknown> | undefined)?.[key],
    setLayoutProperty: (id: string, key: string, value: unknown) => {
      const layer = layers.find((layer) => layer.id === id)!;
      Object.assign(layer.layout as object, { [key]: value });
    },
  } as unknown as LibreMap;
  const stop: Stop = {
    id: "stop",
    rawId: "BKK_stop",
    name: "Invisible station name",
    position: { lat: 47.5, lon: 19.05 },
    mode: "TRAM",
    routes: [],
    source: "BKK API",
    platform: "",
  };
  try {
    const stops = [stop];
    updateTransitLayers(map, stops, [], "", []);
    const first = sources.get(STOP_LAYER)!.uploads;
    const vehicle: Vehicle = {
      id: "vehicle",
      position: stop.position,
      name: "41",
      destination: "A",
      registration: "B",
      model: "",
      tripId: "trip",
      observedAt: Date.now(),
      source: "BKK API",
      bearing: 0,
    };
    updateTransitLayers(map, stops, [vehicle], "", []);
    expect(sources.get(STOP_LAYER)!.uploads).toBe(first);
    expect(
      layers.some((layer) => JSON.stringify(layer).includes("text-field")),
    ).toBe(false);
    expect(
      layers.some(
        (layer) => layer.id === "bm-stops-rail" && layer.minzoom === 9,
      ),
    ).toBe(true);
    const style = {
      version: 8,
      sources: Object.fromEntries(
        [...sources].map(([id, value]) => [
          id,
          { type: "geojson", data: value.data },
        ]),
      ),
      layers,
    };
    expect(
      validateStyleMin(style as unknown as StyleSpecification).map(
        (error) => error.message,
      ),
    ).toEqual([]);
    updateTransitLayers(map, stops, [vehicle], "", [
      {
        coordinates: [
          [19, 47],
          [19.1, 47.1],
        ],
        color: "#145fad",
      },
    ]);
    expect(layers.find((layer) => layer.id === STOP_LAYER)?.minzoom).toBe(0);
    // setStyle drops sources, layers and images; a dark theme must restore all of them.
    sources.clear();
    layers.length = 0;
    images.clear();
    primary = "#94c9ff";
    updateTransitLayers(map, stops, [], "", []);
    expect(sources.has(STOP_LAYER)).toBe(true);
    expect(layers.some((layer) => layer.id === STOP_LAYER)).toBe(true);
    expect(images.size).toBeGreaterThan(0);
  } finally {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: originalDocument,
    });
    Object.defineProperty(globalThis, "getComputedStyle", {
      configurable: true,
      value: originalComputed,
    });
  }
});
