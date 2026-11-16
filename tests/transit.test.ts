import { afterEach, describe, expect, test, mock, spyOn } from "bun:test";
import { Window } from "happy-dom";
import {
  appStopId,
  parseRoutes,
  parseStop,
  parseVehicle,
  polyline,
  type Stop,
  type Vehicle,
} from "../src/lib/transit/model";
import { stationOffsets } from "../src/components/map/station-layout";
import { railColor, serviceStyle, emblem } from "../src/lib/transit/badges";
import {
  board,
  boards,
  request,
  searchTransit,
  tripDetails,
  stopsAt,
  planTrip,
  knownStops,
} from "../src/lib/transit/client";
import {
  emmaQuery,
  mergeStops,
  mergeVehicles,
  EMMA_URL,
} from "../src/lib/transit/emma";

const window = new Window({ url: "http://localhost:3000" });
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: window.localStorage,
});
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const route = {
  id: "BKK_3410",
  shortName: "41",
  description: "A | B",
  type: "TRAM",
  color: "FFD800",
  textColor: "000000",
};
const refs = {
  routes: { [route.id]: route },
  stops: {},
  trips: { trip: { routeId: route.id, tripHeadsign: "Végállomás" } },
};
const envelope = (data: object) => ({
  status: "OK",
  currentTime: Date.now(),
  data,
});
const reply = (data: object) => Response.json(envelope(data));
const stop: Stop = {
  id: "emma:BKK:test",
  rawId: "BKK_test",
  name: "Megálló",
  mode: "TRAM",
  position: { lat: 47.5, lon: 19.05 },
  routes: [],
  source: "BKK API",
  platform: "A1",
};
const signal = () => new AbortController().signal;

function fetchMock(
  fn: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
) {
  const fetcher = mock(fn);
  globalThis.fetch = fetcher as unknown as typeof fetch;
  return fetcher;
}

describe("Android identities and data semantics", () => {
  test("rail, BKK and Volán platform aliases match the native app", () => {
    expect(appStopId("BKK_005510017_0")).toBe("emma:1:005510017_0");
    expect(appStopId("BKK_F00057")).toBe("emma:BKK:F00057");
    expect(appStopId("volan_123_4")).toBe("emma:hkir:hkir_123_4");
    expect(appStopId("emma:1:005510017_0")).toBe("emma:1:005510017_0");
  });
  test("parent areas are not boarded or merged with their physical platforms", () => {
    const routes = parseRoutes(refs);
    const raw = {
      id: "BKK_F00057",
      name: "Batthyány tér",
      lat: 47.5,
      lon: 19.05,
      routeIds: [route.id],
    };
    expect(parseStop({ ...raw, locationType: 1 }, routes)).toBeNull();
    expect(
      parseStop({ ...raw, locationType: 0 }, routes)?.routes[0]?.name,
    ).toBe("41");
    expect(parseStop({ ...raw, lat: 0 }, routes)).toBeNull();
  });
  test("vehicle timestamps use source seconds, never HTTP time", () => {
    const now = Date.now(),
      raw = {
        vehicleId: "BKK_1",
        location: { lat: 47.5, lon: 19.05 },
        routeId: route.id,
        lastUpdateTime: now / 1000 - 30,
      };
    expect(parseVehicle(raw, parseRoutes(refs), now)?.observedAt).toBe(
      now - 30_000,
    );
    expect(
      parseVehicle(
        { ...raw, lastUpdateTime: now / 1000 - 181 },
        parseRoutes(refs),
        now,
      ),
    ).toBeNull();
    expect(
      parseVehicle(
        { ...raw, lastUpdateTime: now / 1000 + 31 },
        parseRoutes(refs),
        now,
      ),
    ).toBeNull();
    expect(
      parseVehicle(
        { ...raw, lastUpdateTime: undefined },
        parseRoutes(refs),
        now,
      ),
    ).toBeNull();
  });
  test("MÁV supplementation never duplicates coupled BKK trains", () => {
    const vehicle = { id: "BKK_123-456" } as Vehicle;
    expect(mergeVehicles([vehicle], [{ id: "emma:1:456" } as Vehicle])).toEqual(
      [vehicle],
    );
    expect(
      mergeVehicles([vehicle], [{ id: "emma:1:789" } as Vehicle]),
    ).toHaveLength(2);
    expect(
      mergeStops([stop], [{ ...stop, source: "EMMA", name: "Other" }]),
    ).toEqual([stop]);
  });
  test("truncated polyline is rejected, longitude/latitude order is retained", () => {
    expect(() => polyline("_")).toThrow();
    expect(polyline("??")).toEqual([]); // Outside Hungary, not a fabricated map path.
  });
});

describe("native badge and layout parity", () => {
  test("train and operator colours follow LineComponents.kt", () => {
    expect(railColor("S50")).toBe("#00AFEF");
    expect(railColor("G60")).toBe("#A9CD45");
    expect(railColor("IR85")).toBe("#008001");
    expect(railColor("Z50")).toBe("#FECD28");
    expect(
      serviceStyle({
        id: "volan_599",
        mode: "COACH",
        name: "599",
        description: "",
        color: "#fff",
        textColor: "",
      }).background,
    ).toBe("#F9B900");
    expect(
      emblem({
        id: "M",
        mode: "SUBWAY",
        name: "M2",
        description: "",
        color: "",
        textColor: "",
      }),
    ).toBe("/transit/ui_metro_m2.png");
  });
  test("same-position platforms get deterministic bounded offsets, no viewport inputs", () => {
    const stops = Array.from({ length: 8 }, (_, index) => ({
      ...stop,
      id: `platform-${index}`,
    }));
    const offsets = stationOffsets(stops);
    expect(offsets).toEqual(stationOffsets([...stops].reverse()));
    expect(
      new Set([...offsets.values()].map((o) => `${o.x}:${o.y}`)).size,
    ).toBeGreaterThan(1);
    expect(
      [...offsets.values()].every((o) => Math.hypot(o.x, o.y) <= 24.001),
    ).toBe(true);
    expect(
      stationOffsets([...stops, { ...stop, id: "new-platform" }], offsets).get(
        "platform-1",
      ),
    ).toEqual(offsets.get("platform-1"));
  });
  test("large separated station catalogues allocate within a bounded time", () => {
    const stops = Array.from({ length: 2000 }, (_, index) => ({
      ...stop,
      id: String(index).padStart(4, "0"),
      position: { lat: 47 + index / 100_000, lon: 18 + (index % 100) / 1000 },
    }));
    const started = performance.now();
    expect(stationOffsets(stops).size).toBe(2000);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("bounded production Worker client", () => {
  test("identical consumers share transport and cancelling one leaves the other alive", async () => {
    let finish!: (response: Response) => void;
    const mocked = fetchMock(
      async (_url, init) =>
        new Promise((resolve, reject) => {
          finish = resolve;
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const a = new AbortController(),
      b = new AbortController();
    const one = request("search", { query: "dedup" }, a.signal),
      two = request("search", { query: "dedup" }, b.signal);
    const cancelled = one.then(
      () => false,
      () => true,
    );
    a.abort();
    finish(reply({ entry: {} }));
    expect(await cancelled).toBe(true);
    expect(await two).toHaveProperty("status", "OK");
    expect(mocked).toHaveBeenCalledTimes(1);
    await request("search", { query: "dedup" }, signal());
    expect(mocked).toHaveBeenCalledTimes(1);
  });
  test("cancelling the last consumer cancels the network request", async () => {
    let aborted = false;
    fetchMock(
      async (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          }),
        ),
    );
    const controller = new AbortController(),
      pending = request("search", { query: "abort-all" }, controller.signal);
    const cancelled = pending.then(
      () => false,
      () => true,
    );
    controller.abort();
    expect(await cancelled).toBe(true);
    expect(aborted).toBe(true);
  });
  test("HTTP-200 error envelopes are errors and are never cached", async () => {
    const mocked = fetchMock(async () =>
      Response.json({ status: "ERROR", data: {} }),
    );
    await expect(
      request("search", { query: "error-envelope" }, signal()),
    ).rejects.toThrow();
    await expect(
      request("search", { query: "error-envelope" }, signal()),
    ).rejects.toThrow();
    expect(mocked).toHaveBeenCalledTimes(2);
  });
  test("invalid endpoint never leaves the browser", async () => {
    const mocked = fetchMock(async () => reply({}));
    await expect(request("arbitrary-url", {}, signal())).rejects.toThrow();
    expect(mocked).not.toHaveBeenCalled();
  });
  test("departures preserve cancellations, live predictions and platform scope", async () => {
    const day = Math.floor(Date.now() / 1000);
    fetchMock(async () =>
      reply({
        references: refs,
        entry: {
          stopId: stop.rawId,
          stopTimes: [
            {
              tripId: "trip",
              departureTime: day + 100,
              predictedDepartureTime: day + 160,
              stopHeadsign: "A",
            },
            {
              tripId: "trip",
              departureTime: day + 200,
              canceled: true,
              predictedDepartureTime: day + 240,
            },
            { tripId: "trip", departureTime: day + 300, pickupAllowed: false },
            {
              tripId: "trip",
              departureTime: day + 400,
              stopId: "BKK_different",
            },
          ],
        },
      }),
    );
    const result = await board(stop, 60, signal());
    expect(result.value).toHaveLength(2);
    expect(result.value[0]?.live).toBe(true);
    expect(result.value[1]?.cancelled).toBe(true);
    expect(result.value[1]?.expected).toBe((day + 200) * 1000);
  });
  test("actual trip geometry and ordered times are parsed independently of the viewport", async () => {
    fetchMock(async () =>
      reply({
        references: {
          ...refs,
          stops: {
            [stop.rawId]: {
              id: stop.rawId,
              name: stop.name,
              lat: 47.5,
              lon: 19.05,
              routeIds: [route.id],
            },
          },
        },
        entry: {
          tripId: "trip-details-test",
          vehicle: { routeId: route.id },
          stopTimes: [{ stopId: stop.rawId, departureTime: 100 }],
          polyline: { points: "" },
        },
      }),
    );
    const result = await tripDetails("trip-details-test", signal());
    expect(result.value.stops[0]?.stop.id).toBe(stop.id);
    expect(result.value.stops[0]?.time).toBe(100_000);
    expect(result.value.geometry).toEqual([]);
  });
  test("map requests are capped and real stop metadata survives in local storage", async () => {
    const mocked = fetchMock(async () =>
      reply({
        references: refs,
        list: [
          {
            id: "BKK_saved",
            name: "Saved",
            lat: 47.5,
            lon: 19.05,
            locationType: 0,
            routeIds: [route.id],
          },
        ],
      }),
    );
    await stopsAt({ lat: 47.5, lon: 19.05 }, 20_000, signal());
    expect(String(mocked.mock.calls[0]?.[0])).toContain("radius=5000");
    expect(knownStops().find((s) => s.rawId === "BKK_saved")).toBeDefined();
    expect(localStorage.getItem("bmenetrend:stop-catalogue:v1")).toContain(
      "Saved",
    );
  });
  test("search sends only Worker-supported includeReferences values", async () => {
    const mocked = fetchMock(async () =>
      reply({ references: refs, entry: { stopIds: [], routeIds: [] } }),
    );
    await searchTransit("no-route-search", stop.position, signal());
    expect(String(mocked.mock.calls[0]?.[0])).not.toContain("vehicles%2C");
    expect(String(mocked.mock.calls[0]?.[0])).toContain(
      "includeReferences=stops%2Croutes%2Ctrips",
    );
  });
  test("planner uses Budapest wall-clock time and rejects broken transfer sequences", async () => {
    const mocked = fetchMock(async () =>
      reply({
        entry: {
          plan: {
            itineraries: [
              {
                legs: [
                  { mode: "BUS", startTime: 200, endTime: 300 },
                  { mode: "BUS", startTime: 250, endTime: 400 },
                ],
              },
            ],
          },
        },
      }),
    );
    const result = await planTrip(
      { name: "From", position: stop.position },
      { name: "To", position: stop.position },
      new Date("2026-11-15T12:00:00Z"),
      signal(),
    );
    expect(result.value).toHaveLength(0);
    expect(result.incomplete).toBe(true);
    expect(String(mocked.mock.calls[0]?.[0])).toContain("time=13%3A00");
  });
  test("nearby boards share one batched Worker request", async () => {
    const day = Math.floor(Date.now() / 1000);
    const missing: Stop = { ...stop, id: "emma:BKK:missing", rawId: "BKK_missing" };
    const mocked = fetchMock(async () =>
      reply({
        references: refs,
        successfulStopIds: [stop.rawId],
        failedStopIds: [missing.rawId],
        entry: {
          stopTimes: [
            { tripId: "trip", stopId: stop.rawId, departureTime: day + 100 },
            { tripId: "trip", stopId: missing.rawId, departureTime: day + 200 },
          ],
        },
      }),
    );
    const result = await boards([stop, missing], 60, signal());
    expect(mocked).toHaveBeenCalledTimes(1);
    expect(String(mocked.mock.calls[0]?.[0])).toContain(
      "arrivals-and-departures-for-stops.json?",
    );
    expect(String(mocked.mock.calls[0]?.[0])).toContain("stopId=BKK_test%2CBKK_missing");
    expect(result[0]).toHaveLength(1);
    expect(result[0]?.[0]?.stopId).toBe(stop.id);
    expect(result[1]).toBeNull();
  });
  test("background polling leaves request budget for taps", async () => {
    // Timestamps in the past, so later tests in this process see an empty budget again.
    const clock = spyOn(Date, "now").mockReturnValue(Date.now() - 120_000);
    try {
      fetchMock(async () => reply({ list: [], references: refs, entry: { stopIds: [] } }));
      let rejected = false;
      for (let index = 0; index < 60 && !rejected; index++)
        await request(
          "vehicles-for-location",
          { lat: "47.5", lon: "19.05", radius: String(100 + index) },
          signal(),
        ).catch((error: Error) => {
          expect(error.message).toContain("Túl sok kérés");
          rejected = true;
        });
      expect(rejected).toBe(true);
      await expect(
        request("search", { query: "budget-headroom" }, signal()),
      ).resolves.toBeDefined();
    } finally {
      clock.mockRestore();
    }
  });
  test("Retry-After puts every Worker endpoint into a shared cooldown", async () => {
    const mocked = fetchMock(
      async () =>
        new Response("", { status: 429, headers: { "Retry-After": "60" } }),
    );
    await expect(
      request("search", { query: "limited" }, signal()),
    ).rejects.toThrow();
    await expect(
      request("vehicles", { vehicleId: "BKK_test" }, signal()),
    ).rejects.toThrow();
    expect(mocked).toHaveBeenCalledTimes(1);
  });
});

describe("official MÁV GraphQL fallback", () => {
  test("uses the official endpoint directly and rejects GraphQL errors", async () => {
    const mocked = fetchMock(async () =>
      Response.json({ errors: [{ message: "denied" }], data: {} }),
    );
    await expect(
      emmaQuery("query Test { __typename }", {}, 1000, signal()),
    ).rejects.toThrow();
    expect(String(mocked.mock.calls[0]?.[0])).toBe(EMMA_URL);
    expect(mocked.mock.calls[0]?.[1]?.mode).toBe("cors");
    expect(mocked.mock.calls[0]?.[1]?.credentials).toBe("omit");
  });
  test("browser CORS/network failures back off instead of retrying each live tick", async () => {
    // Keep the cooldown in the past after restoring the clock, so other test
    // files can exercise successful MÁV requests in this same process.
    const now = Date.now();
    const clock = spyOn(Date, "now").mockReturnValue(now - 120_000);
    try {
      const mocked = fetchMock(async () => {
        throw new TypeError("Failed to fetch");
      });
      await expect(
        emmaQuery("query Blocked { __typename }", {}, 0, signal()),
      ).rejects.toThrow("EMMA");
      await expect(
        emmaQuery("query Another { __typename }", {}, 0, signal()),
      ).rejects.toThrow("EMMA");
      expect(mocked).toHaveBeenCalledTimes(1);
    } finally {
      clock.mockRestore();
    }
  });
});
