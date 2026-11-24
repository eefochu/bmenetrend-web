import { afterEach, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { hommCalendar, isConfirmedWorkingDay, kanyargoCalendar, localInstant, viabuszCalendar } from "../src/lib/transit/planning/calendar";
import {
  checkedDate,
  decodeNetwork,
  LOCAL_PROVIDERS,
  mergeNetworks,
  planningNetwork,
  resetLocalNetworks,
  SourceChanged,
  type LocalNetwork,
} from "../src/lib/transit/planning/local-network";
import { LocalTimetableRouter, transferKey } from "../src/lib/transit/planning/local-router";
import { localDepartures, parseLocalVehicles } from "../src/lib/transit/local";
import { resetTransport } from "../src/lib/transit/client";
import { persistentWalking, storeKey, WalkingLinkStore, type StoredWalk, type WalkStorage } from "../src/lib/transit/planning/walking-store";
import type { PlannerBackend, PlanPlace } from "../src/lib/transit/planning/backend";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  resetLocalNetworks();
});
const asset = (name: string) => JSON.parse(readFileSync(`public/transit/local/${name}`, "utf8")) as Record<string, unknown>;
const bundled = () => LOCAL_PROVIDERS.map((provider) => decodeNetwork(asset(provider.asset)));

test("bundled ViaBusz, KanyarGO and HOMM networks decode with NetworkJson's validation and merge shared platforms", () => {
  const networks = bundled();
  expect(networks.map((n) => n.routes.length)).toEqual([5, 8, 2]);
  const merged = mergeNetworks(networks);
  // SharedStops: KanyarGO 29/30 are ViaBusz platform 1.
  expect(merged.stops.some((stop) => stop.id === "kanyargo:29")).toBe(false);
  const shared = merged.stops.find((stop) => stop.id === "1")!;
  expect(shared.providerIds.sort()).toEqual(["kanyargo", "viabusz"]);
  expect(merged.trips.every((trip) => trip.stopTimes.every((time) => !time.stopId.startsWith("kanyargo:29")))).toBe(true);
  // Bundled assets are never verified by themselves.
  expect(merged.verifiedProviderIds.size).toBe(0);
  expect(() => decodeNetwork({ ...asset("homm-network.json"), schemaVersion: 9 })).toThrow();
});

test("reviewed calendars: working days, school breaks, weekends and the 2026 limit", () => {
  expect(isConfirmedWorkingDay("2026-11-24")).toBe(true);
  expect(isConfirmedWorkingDay("2026-12-24")).toBe(false); // transferred rest day
  expect(isConfirmedWorkingDay("2026-12-12")).toBe(true); // transferred working Saturday
  expect(isConfirmedWorkingDay("2026-04-06")).toBe(false); // Easter Monday
  expect(kanyargoCalendar("2026-11-24")).toBe("school_term");
  expect(kanyargoCalendar("2026-10-26")).toBe("school_break");
  expect(kanyargoCalendar("2026-11-28")).toBeNull();
  expect(hommCalendar("2026-11-28")).toBe("school_break");
  expect(viabuszCalendar("2026-09-15")).toBeNull();
  expect(viabuszCalendar("2026-11-24")).toBe("school_term");
  expect(kanyargoCalendar("2027-01-04")).toBeNull();
  expect(hommCalendar("2027-01-04")).toBeNull();
  // DST: 02:30 on 2026-03-29 does not exist in Budapest.
  expect(localInstant("2026-03-29", 150)).toBeNull();
  expect(localInstant("2026-11-24", 600)).toBe(Date.UTC(2026, 10, 24, 9, 0));
});

test("an operator whose documents cannot be read (CORS) fails closed with Android's warning", async () => {
  globalThis.fetch = mock(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith("/transit/local/")) return Response.json(asset(url.split("/").at(-1)!));
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;
  const network = await planningNetwork(new AbortController().signal, Date.UTC(2026, 10, 24, 9));
  expect(network.verifiedProviderIds.size).toBe(0);
  expect(network.providerServiceDates.homm).toBeNull();
  expect(network.providerWarnings.viabusz).toBe(
    "ViaBusz: a hálózat nem érhető el. A mentett megállók és útvonalak láthatók; az indulásokhoz ma ellenőrzött menetrend szükséges.",
  );
});

test("a verified operator gets today's service date; a changed source invalidates it", async () => {
  globalThis.fetch = mock(async (input: string | URL | Request) => Response.json(asset(String(input).split("/").at(-1)!))) as unknown as typeof fetch;
  const now = Date.UTC(2026, 10, 24, 9);
  const ok = await planningNetwork(new AbortController().signal, now, async (provider, base) => ({
    ...base,
    serviceDate: "2026-11-24",
    providerServiceDates: { [provider.id]: "2026-11-24" },
    verifiedProviderIds: new Set([provider.id]),
  }));
  expect([...ok.verifiedProviderIds].sort()).toEqual(["homm", "kanyargo", "viabusz"]);
  expect(ok.providerServiceDates.kanyargo).toBe("2026-11-24");
  resetLocalNetworks();
  const changed = await planningNetwork(new AbortController().signal, now, async () => {
    throw new SourceChanged("PDF changed");
  });
  expect(changed.verifiedProviderIds.size).toBe(0);
  expect(changed.providerWarnings.homm).toContain("a hivatalos menetrend megváltozott");
  // No service on a Saturday for KanyarGO.
  const saturday = checkedDate({ ...bundled()[1]!, providerServiceDates: { kanyargo: "2026-11-28" } }, LOCAL_PROVIDERS[1], Date.UTC(2026, 10, 28, 9));
  expect(saturday.warning).toContain("ma nincs menetrendi közlekedés");
});

test("LocalTimetableRouter: earliest arrival over verified trips with walking transfers", () => {
  const merged = mergeNetworks(bundled());
  const network: LocalNetwork = { ...merged, verifiedProviderIds: new Set(["homm"]) };
  const ready = Date.UTC(2026, 10, 24, 6, 0); // 07:00 Budapest, a school day
  const router = new LocalTimetableRouter(network, ready);
  const first = network.trips.find((trip) => trip.routeId.startsWith("homm:") && trip.calendar === "school_term")!;
  const origin = first.stopTimes[0]!.stopId,
    target = first.stopTimes.at(-1)!.stopId;
  const reached = router.search([{ stopId: origin, arrival: ready, legs: [] }], new Map());
  const paths = reached.get(target) ?? [];
  expect(paths.length).toBeGreaterThan(0);
  expect(Math.min(...paths.map((path) => path.arrival))).toBeGreaterThan(ready);
  expect(paths.every((path) => path.legs.every((leg) => leg.provider === "homm"))).toBe(true);
  // Unverified providers never board.
  const closed = new LocalTimetableRouter({ ...network, verifiedProviderIds: new Set() }, ready);
  expect(closed.search([{ stopId: origin, arrival: ready, legs: [] }], new Map()).get(target)).toBeUndefined();
  void transferKey;
});

function memoryStorage(): WalkStorage & { rows: Map<string, StoredWalk>; writes: number } {
  const rows = new Map<string, StoredWalk>();
  const storage = {
    rows,
    writes: 0,
    getAll: async () => [...rows.values()],
    putAll: async (walks: StoredWalk[], remove: string[]) => {
      storage.writes++;
      remove.forEach((key) => rows.delete(key));
      walks.forEach((walk) => rows.set(walk.key, walk));
    },
  };
  return storage;
}

test("WalkingLinkStore: 6-decimal keys, 60-day expiry, and only missing walks are routed", async () => {
  expect(storeKey({ lat: 47.12345649, lon: 19 }, { lat: 47.1, lon: 19.0000004 })).toBe("47.123456\t19.000000\t47.100000\t19.000000");
  const storage = memoryStorage();
  let day = "2026-11-24";
  const store = new WalkingLinkStore(storage, () => day);
  const a: PlanPlace = { name: "a", position: { lat: 47.5, lon: 19 } },
    b: PlanPlace = { name: "b", position: { lat: 47.501, lon: 19 } },
    c: PlanPlace = { name: "c", position: { lat: 47.502, lon: 19 } };
  const routed: string[] = [];
  const delegate = {
    walking: async (pairs: [PlanPlace, PlanPlace][]) => {
      routed.push(...pairs.map(([x, y]) => `${x.name}>${y.name}`));
      return {
        links: new Map(pairs.map(([x, y]) => [`${x.position.lat},${x.position.lon}>${y.position.lat},${y.position.lon}`, { from: x, to: y, seconds: 90, meters: 111.12 }])),
        partial: false,
      };
    },
  } as unknown as PlannerBackend;
  const backend = persistentWalking(delegate, store);
  await backend.walking([[a, b]], Date.now(), new AbortController().signal);
  const second = await backend.walking([[a, b], [b, c]], Date.now(), new AbortController().signal);
  expect(routed).toEqual(["a>b", "b>c"]);
  expect(second.links.size).toBe(2);
  expect(storage.rows.get(storeKey(a.position, b.position))?.meters).toBe(111.1);
  // A fresh visit reads the stored walks; after 60 days they are routed again.
  const reopened = persistentWalking(delegate, new WalkingLinkStore(storage, () => day));
  await reopened.walking([[a, b]], Date.now(), new AbortController().signal);
  expect(routed).toHaveLength(2);
  day = "2027-01-24";
  await persistentWalking(delegate, new WalkingLinkStore(storage, () => day)).walking([[a, b]], Date.now(), new AbortController().signal);
  expect(routed).toHaveLength(3);
});

const reviewed = {
  viabusz: ["https://viabusz.biatorbagy.hu/documents/viabusz-menetrend-tanitas-261001.pdf?v=104", "https://viabusz.biatorbagy.hu/documents/viabusz-menetrend-szunet-260901.pdf?v=104"],
  kanyargo: ["https://kanyargo.paty.hu/documents/menetrend-KanyarGO-2026-szept-1-tol.pdf?v=102", "https://kanyargo.paty.hu/documents/menetrend-KanyarGO-2026-aug-10-tanszuneti.pdf?v=102"],
  homm: ["https://homm.hu/www/menetrend-budaors/Közlekedési rend tanítási napokon.pdf", "https://homm.hu/www/menetrend-budaors/Közlekedési rend tanítási szünetben.pdf", "https://homm.hu/www/menetrend-budaors/Átszállási időpontok.pdf"],
} as Record<string, string[]>;
function workerCheck(overrides: { sha?: string; links?: string[] } = {}) {
  return mock(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith("/transit/local/")) return Response.json(asset(url.split("/").at(-1)!));
    const provider = new URL(url).searchParams.get("provider")!;
    const spec = LOCAL_PROVIDERS.find((p) => p.id === provider)!;
    return Response.json({
      status: "OK",
      provider,
      checkedAt: Date.now(),
      links: overrides.links ?? reviewed[provider],
      documents: { school: { sha256: overrides.sha ?? spec.schoolSha }, holiday: { sha256: spec.holidaySha } },
    });
  }) as unknown as typeof fetch;
}

test("the Worker's local-timetable-check verifies operators with Android's review rules", async () => {
  resetTransport();
  globalThis.fetch = workerCheck();
  const now = Date.UTC(2026, 10, 24, 9);
  const ok = await planningNetwork(new AbortController().signal, now);
  expect([...ok.verifiedProviderIds].sort()).toEqual(["homm", "kanyargo", "viabusz"]);
  expect(ok.providerServiceDates.viabusz).toBe("2026-11-24");
  // Today's departures appear on a verified board.
  const rows = localDepartures(ok, "1", now, 60);
  expect(rows.length).toBeGreaterThan(0);
  expect(rows[0]!.source).toBe("ViaBusz");
  expect(rows[0]!.tripId.startsWith("local:")).toBe(true);
  resetLocalNetworks();
  resetTransport();
  globalThis.fetch = workerCheck({ sha: "0".repeat(64) });
  const changed = await planningNetwork(new AbortController().signal, now);
  expect(changed.verifiedProviderIds.size).toBe(0);
  expect(changed.providerWarnings.kanyargo).toContain("a hivatalos menetrend megváltozott");
  expect(localDepartures(changed, "1", now, 60)).toEqual([]);
  resetLocalNetworks();
  resetTransport();
  // An extra PDF in ViaBusz's timetable menu means a new, unreviewed timetable.
  globalThis.fetch = workerCheck({ links: [...reviewed.viabusz!, "https://viabusz.biatorbagy.hu/documents/uj.pdf"] });
  const menu = await planningNetwork(new AbortController().signal, now);
  expect(menu.verifiedProviderIds.has("viabusz")).toBe(false);
});

test("ViaBusz/KanyarGO GPS rows: fresh, in-area positions only", () => {
  const now = Date.UTC(2026, 10, 24, 13, 14, 0); // 14:14 Budapest
  const body = [
    "ROW-428;2026-11-24 14:13:20;47.47926300;18.83496500;3699807;;0'|0';Ritsmann Iskola",
    "OLD-1;2026-11-24 13:00:00;47.47;18.83;1;;;",
    "FAR-1;2026-11-24 14:13:00;47.60;18.83;1;;;",
    "Error;x;y;z;w",
  ].join("#");
  const vehicles = parseLocalVehicles(body, "kanyargo", now);
  expect(vehicles.map((v) => v.id)).toEqual(["local:kanyargo:ROW-428"]);
  expect(vehicles[0]!.observedAt).toBe(Date.UTC(2026, 10, 24, 13, 13, 20));
  expect(vehicles[0]!.source).toBe("KanyarGO");
});
