import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { resetTransport, tripVehicle } from "../src/lib/transit/client";
import { departureVehicle } from "../src/lib/transit/departure-navigation";
import type { Departure, Vehicle } from "../src/lib/transit/model";

const window = new Window({ url: "http://localhost:3000" });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: window.localStorage });
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
beforeEach(() => resetTransport());

const route = { id: "BKK_0050", name: "5", description: "", mode: "BUS", color: "#199dcf", textColor: "#fff" };
const departure: Departure = {
  source: "BKK API",
  id: "d",
  stopId: "emma:BKK:F1",
  tripId: "BKK_TRIP1",
  destination: "Pasaréti tér",
  route,
  scheduled: 1,
  expected: 1,
  live: true,
  cancelled: false,
  serviceDate: "20261124",
};
const vehicle = (id: string, tripId: string, extra: Partial<Vehicle> = {}): Vehicle => ({
  id,
  name: "5",
  position: { lat: 47.5, lon: 19 },
  destination: "",
  registration: "",
  model: "",
  route,
  tripId,
  observedAt: Date.now(),
  source: "BKK API",
  ...extra,
});

test("departureVehicle: vehicle id first, then the trip (or a merged Volán bus's BKK trip), never the line", () => {
  const other = vehicle("BKK_2", "BKK_TRIP2");
  expect(departureVehicle(departure, [other])).toBeNull();
  expect(departureVehicle(departure, [other, vehicle("BKK_1", "BKK_TRIP1")])?.id).toBe("BKK_1");
  expect(departureVehicle(departure, [vehicle("emma:hkir:X", "emma:hkir:T", { bkkTripId: "BKK_TRIP1" })])?.id).toBe("emma:hkir:X");
  expect(departureVehicle({ ...departure, vehicleId: "emma:kanyargo:7" }, [vehicle("kanyargo:7", "x")])?.id).toBe("kanyargo:7");
  expect(departureVehicle({ ...departure, cancelled: true }, [vehicle("BKK_1", "BKK_TRIP1")])).toBeNull();
});

const tripDetails = (vehicleTrip: string) =>
  Response.json({
    status: "OK",
    currentTime: Date.now(),
    data: {
      entry: {
        tripId: "BKK_TRIP1",
        vehicle: {
          vehicleId: "BKK_V9",
          tripId: vehicleTrip,
          routeId: "BKK_0050",
          location: { lat: 47.51, lon: 19.02 },
          lastUpdateTime: Math.floor(Date.now() / 1000),
          label: "Pasaréti tér",
        },
      },
      references: { routes: { BKK_0050: { id: "BKK_0050", shortName: "5", type: "BUS" } } },
    },
  });

test("tripVehicle shares the journey's trip-details request and accepts only the departure's trip", async () => {
  const urls: string[] = [];
  globalThis.fetch = mock(async (input: string | URL | Request) => {
    urls.push(String(input));
    return tripDetails("BKK_TRIP1");
  }) as unknown as typeof fetch;
  const found = await tripVehicle("BKK_TRIP1", new AbortController().signal);
  expect(found?.id).toBe("BKK_V9");
  expect(urls[0]).toContain("/api/trip-details.json?");
  expect(urls[0]).toContain("includeReferences=routes%2Ctrips%2Cstops");
  globalThis.fetch = mock(async () => tripDetails("BKK_OTHER")) as unknown as typeof fetch;
  expect(await tripVehicle("BKK_TRIP2", new AbortController().signal)).toBeNull();
  // MÁV trips are EMMA's: no Worker request at all.
  expect(await tripVehicle("emma:1:123", new AbortController().signal)).toBeNull();
});

test("an aborted lookup rejects instead of resolving late", async () => {
  globalThis.fetch = mock(
    (_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))),
      ),
  ) as unknown as typeof fetch;
  const controller = new AbortController();
  const pending = tripVehicle("BKK_TRIP3", controller.signal);
  controller.abort();
  await expect(pending).rejects.toBeDefined();
});
