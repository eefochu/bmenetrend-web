import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { Itinerary, Leg } from "../src/lib/transit/model";
import { select, families } from "../src/lib/transit/planning/alternatives";
import { feasible, itinerary, routerLegKey } from "../src/lib/transit/planning/core";
import { BkkFirstPlannerBackend, type BkkPlannerSource } from "../src/lib/transit/planning/bkk-first";
import type { PlannerBackend, PlanPlace, WalkingResult } from "../src/lib/transit/planning/backend";
import { HybridTripPlanner } from "../src/lib/transit/planning/hybrid";
import { PlannerSession, type PlanForm } from "../src/lib/transit/planning/session";
import { parseEmmaPlan, EmmaPlannerBackend } from "../src/lib/transit/planning/emma-planner";
import { bkkPlan, parsePlan, resetTransport } from "../src/lib/transit/client";
import { EMMA_QUERIES } from "../src/lib/transit/emma-contract";
import type { LocalNetwork } from "../src/lib/transit/planning/local-network";

const window = new Window({ url: "http://localhost:3000" });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: window.localStorage });
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
beforeEach(() => resetTransport());
const signal = () => new AbortController().signal;
const MIN = 60_000;
const A = { lat: 47.5, lon: 19.0 },
  B = { lat: 47.51, lon: 19.01 },
  C = { lat: 47.52, lon: 19.02 },
  D = { lat: 47.53, lon: 19.03 };

function leg(mode: string, start: number, minutes: number, name = "", extra: Partial<Leg> = {}): Leg {
  return {
    mode,
    name,
    color: "#00afef",
    from: "A",
    to: "B",
    fromPosition: A,
    toPosition: B,
    distance: mode === "WALK" ? minutes * 60 : 3000,
    stayOnBoard: false,
    start,
    end: start + minutes * MIN,
    live: false,
    geometry: [],
    intermediate: [],
    source: "EMMA",
    routeId: mode === "WALK" ? undefined : `route-${name}`,
    provider: mode === "WALK" ? undefined : mode === "RAIL" ? "mav" : "bkk",
    ...extra,
  };
}
const trip = (id: string, legs: Leg[]): Itinerary => ({ id, start: legs[0]!.start, end: legs.at(-1)!.end, walkMeters: 0, legs });

test("TripPlanner.feasible: boarding minute, transfer slack, and BKK router chains", () => {
  const ready = Date.now();
  // First boarding needs a minute after arriving (no routed walk before it).
  expect(feasible([leg("BUS", ready + 30_000, 10, "1")], ready)).toBe(false);
  expect(feasible([leg("BUS", ready + MIN, 10, "1")], ready)).toBe(true);
  // A transfer needs walking + 180 s unless BKK's router connected the legs itself.
  const first = leg("BUS", ready + MIN, 10, "1", { toPosition: B });
  const second = leg("TRAM", first.end + 60_000, 10, "2", { fromPosition: B });
  expect(feasible([first, second], ready)).toBe(false);
  const journey = "bkk:x";
  const routedFirst = { ...first, source: "BKK API" as const, routerJourney: journey };
  const routedSecond = { ...second, source: "BKK API" as const, routerJourney: journey, routerPrevious: routerLegKey(routedFirst) };
  expect(feasible([routedFirst, routedSecond], ready)).toBe(true);
  // A claimed router link still cannot jump between distant points.
  expect(feasible([routedFirst, { ...routedSecond, fromPosition: D }], ready)).toBe(false);
  // A journey may not start before the ready time.
  expect(feasible([leg("BUS", ready - 2000, 10, "1")], ready)).toBe(false);
});

test("PlannerAlternatives: recommendation first, at most three, no duplicates, public before restricted", () => {
  const ready = Date.now() + MIN;
  const base = ready + 5 * MIN;
  const rows = [
    trip("a", [leg("WALK", base, 5), leg("RAIL", base + 6 * MIN, 30, "S10")]),
    trip("a-copy", [leg("WALK", base, 5), leg("RAIL", base + 6 * MIN, 30, "S10")]),
    trip("b", [leg("WALK", base + 15 * MIN, 5), leg("RAIL", base + 21 * MIN, 30, "S12")]),
    trip("c", [leg("WALK", base, 4), leg("BUS", base + 5 * MIN, 20, "40"), leg("BUS", base + 28 * MIN, 12, "88")]),
    trip("d", [leg("WALK", base + 40 * MIN, 5), leg("RAIL", base + 46 * MIN, 30, "S10")]),
  ];
  const shown = select(rows, ready);
  expect(shown.length).toBeLessThanOrEqual(3);
  expect(shown.map((t) => t.id)).not.toContain("a-copy");
  expect(new Set(shown.map((t) => t.id)).size).toBe(shown.length);
  // A registration-only service is offered only when nothing public exists.
  const restricted = trip("r", [leg("BUS", base, 10, "1", { provider: "homm", restricted: true })]);
  const open = trip("p", [leg("BUS", base + 2 * MIN, 30, "2")]);
  expect(select([restricted, open], ready).map((t) => t.id)).toEqual(["p"]);
  expect(select([restricted], ready).map((t) => t.id)).toEqual(["r"]);
  expect(families(restricted)).toEqual(["local"]);
});

const place = (name: string, position: { lat: number; lon: number }): PlanPlace => ({ name, position });
const plan = (itineraries: Itinerary[], rejected = 0) => ({ itineraries, rejected, offered: itineraries.length + rejected, fetchedAt: Date.now() });

function fakeEmma(overrides: Partial<PlannerBackend> = {}): PlannerBackend & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    routes: async (_f, _t, _r, bus) => (calls.push(`routes:${bus}`), []),
    plainRoutes: async () => (calls.push("plain"), []),
    walkAverseRoutes: async () => (calls.push("averse"), []),
    walking: async () => ({ links: new Map(), partial: false }) as WalkingResult,
    stops: async () => [],
    clearRouteCache: () => calls.push("clear"),
    ...overrides,
  };
}
function fakeBkk(answer: (ready: number) => ReturnType<typeof plan> | Promise<never>, headroom = 8): BkkPlannerSource & { calls: number } {
  const source = {
    calls: 0,
    plan: async (_f: PlanPlace, _t: PlanPlace, ready: number) => {
      source.calls++;
      return answer(ready);
    },
    walking: async () => null,
    stops: async () => [],
    planHeadroom: () => headroom,
  };
  return source;
}

test("BkkFirst: a healthy BKK answer is returned without EMMA; long walks add the walk-averse search", async () => {
  const ready = Date.now();
  const bus = trip("bkk", [leg("BUS", ready + 2 * MIN, 10, "5", { source: "BKK API" })]);
  const emma = fakeEmma();
  const backend = new BkkFirstPlannerBackend(emma, fakeBkk(() => plan([bus])));
  expect((await backend.routes(place("A", A), place("B", B), ready, false, signal())).map((t) => t.id)).toEqual(["bkk"]);
  expect(emma.calls).toEqual([]);
  const walker = trip("walk", [leg("WALK", ready, 12), leg("BUS", ready + 14 * MIN, 10, "5", { source: "BKK API" })]);
  const averse = trip("averse", [leg("BUS", ready + 5 * MIN, 25, "7")]);
  const emma2 = fakeEmma({ walkAverseRoutes: async () => [averse] });
  const backend2 = new BkkFirstPlannerBackend(emma2, fakeBkk(() => plan([walker])));
  expect((await backend2.routes(place("A", A), place("B", B), ready, false, signal())).map((t) => t.id)).toEqual(["walk", "averse"]);
});

test("BkkFirst: EMMA answers when BKK is empty, failing or unrepresentable; BKK rows survive an EMMA outage", async () => {
  const ready = Date.now();
  const national = trip("emma", [leg("RAIL", ready + 5 * MIN, 30, "S10")]);
  const emma = fakeEmma({ routes: async () => [national] });
  const empty = new BkkFirstPlannerBackend(emma, fakeBkk(() => plan([])));
  expect((await empty.routes(place("A", A), place("B", B), ready, false, signal())).map((t) => t.id)).toEqual(["emma"]);
  const failing = new BkkFirstPlannerBackend(emma, fakeBkk(() => Promise.reject(new Error("down"))));
  expect((await failing.routes(place("A", A), place("C", C), ready, false, signal())).map((t) => t.id)).toEqual(["emma"]);
  const usable = trip("bkk", [leg("BUS", ready + 2 * MIN, 10, "5", { source: "BKK API" })]);
  const partial = new BkkFirstPlannerBackend(emma, fakeBkk(() => plan([usable], 1)));
  expect((await partial.routes(place("A", A), place("D", D), ready, false, signal())).map((t) => t.id)).toEqual(["bkk", "emma"]);
  const down = new BkkFirstPlannerBackend(fakeEmma({ routes: () => Promise.reject(new Error("EMMA down")) }), fakeBkk(() => plan([usable], 1)));
  expect((await down.routes(place("A", A), place("B", B), ready, false, signal())).map((t) => t.id)).toEqual(["bkk"]);
  const none = new BkkFirstPlannerBackend(fakeEmma({ routes: () => Promise.reject(new Error("EMMA down")) }), fakeBkk(() => plan([])));
  await expect(none.routes(place("A", A), place("B", B), ready, false, signal())).rejects.toThrow("EMMA down");
});

test("BkkFirst: a 30 s result is reused for the same endpoints, re-checked for the later ready time", async () => {
  let now = Date.now();
  const ready = now;
  const early = trip("early", [leg("BUS", ready + 65_000, 10, "5", { source: "BKK API" })]);
  const late = trip("late", [leg("BUS", ready + 10 * MIN, 10, "6", { source: "BKK API" })]);
  const bkk = fakeBkk(() => plan([early, late]));
  const backend = new BkkFirstPlannerBackend(fakeEmma(), bkk, 5000, () => now);
  await backend.plainRoutes(place("A", A), place("B", B), ready, false, signal());
  now += 5_000;
  // The early bus can no longer be caught 5 s later (boarding minute): only the later one survives, no request.
  expect((await backend.plainRoutes(place("A", A), place("B", B), ready + 8_000, false, signal())).map((t) => t.id)).toEqual(["late"]);
  expect(bkk.calls).toBe(1);
  now += 31_000;
  await backend.plainRoutes(place("A", A), place("B", B), ready + 8_000, false, signal());
  expect(bkk.calls).toBe(2);
});

test("BkkFirst: a long final walk gets a spliced connecting ride from the stop where the rider gets off", async () => {
  const ready = Date.now();
  const ride = leg("BUS", ready + 2 * MIN, 10, "5", { source: "BKK API", toPosition: C, to: "Stop" });
  const walkHome = leg("WALK", ride.end, 12, "", { source: "BKK API", fromPosition: C, toPosition: D });
  const long = trip("long", [ride, walkHome]);
  const tail = trip("tail", [leg("BUS", ride.end + 5 * MIN, 4, "9", { source: "BKK API", fromPosition: C, toPosition: D })]);
  const bkk = fakeBkk((at) => (at > ready ? plan([tail]) : plan([long])));
  const rows = await new BkkFirstPlannerBackend(fakeEmma(), bkk).routes(place("A", A), place("D", D), ready, false, signal());
  expect(rows.map((t) => t.id)).toEqual(["long", "long+tail"]);
  expect(rows[1]!.legs.map((l) => l.name)).toEqual(["5", "9"]);
  // No budget headroom: no extra request.
  const tight = fakeBkk(() => plan([long]), 4);
  await new BkkFirstPlannerBackend(fakeEmma(), tight).routes(place("A", A), place("D", D), ready, false, signal());
  expect(tight.calls).toBe(1);
});

test("Hybrid: runs the all-modes and bus-only searches and selects at most three", async () => {
  const ready = Date.now();
  const seen: boolean[] = [];
  const backend = fakeEmma({
    routes: async (_f, _t, at, bus) => {
      seen.push(bus);
      return [trip(bus ? "bus" : "rail", [leg(bus ? "BUS" : "RAIL", at + 3 * MIN, 20, bus ? "770" : "S10", { provider: bus ? "volan" : "mav" })])];
    },
  });
  const result = await new HybridTripPlanner(backend).plan(place("A", A), place("B", B), ready, ready, [], async () => fail(), new Set(), signal());
  expect(seen.sort()).toEqual([false, true]);
  expect(result.itineraries.map((t) => t.id).sort()).toEqual(["bus", "rail"]);
  expect(result.partial).toBe(false);
});
const fail = (): never => {
  throw new Error("unused");
};

function localNetwork(verified: boolean): LocalNetwork {
  const stops = [
    { id: "homm:1", name: "Start", position: { lat: 47.5001, lon: 19.0001 }, routeIds: ["homm:288"], providerId: "homm", providerIds: ["homm"], aliases: [], sourceStopIds: ["homm:1"] },
    { id: "homm:2", name: "End", position: { lat: 47.5101, lon: 19.0101 }, routeIds: ["homm:288"], providerId: "homm", providerIds: ["homm"], aliases: [], sourceStopIds: ["homm:2"] },
  ];
  const minutes = Array.from({ length: 48 }, (_, i) => i * 30);
  return {
    stops,
    routes: [{ id: "homm:288", number: "288", name: "288", providerId: "homm", directions: [{ id: "d", name: "End", stopIds: ["homm:1", "homm:2"], restrictedService: false }] }],
    trips: ["school_term", "school_break"].flatMap((calendar) =>
      minutes.map((minute) => ({ id: `${calendar}:${minute}`, routeId: "homm:288", directionId: "d", calendar, stopTimes: [{ stopId: "homm:1", minuteOfDay: minute }, { stopId: "homm:2", minuteOfDay: minute + 8 }] })),
    ),
    fetchedAt: Date.now(),
    source: "test",
    serviceDate: null,
    providerServiceDates: {},
    providerWarnings: {},
    warning: null,
    verifiedProviderIds: new Set(verified ? ["homm"] : []),
  };
}

test("Hybrid: verified local timetables join the answer; unverified ones only mark it partial", async () => {
  // 2026-11-24 (a reviewed school day), 10:00 Budapest.
  const ready = Date.UTC(2026, 10, 24, 9, 0);
  const backend = fakeEmma({
    walking: async (pairs) => ({
      links: new Map(pairs.map(([a, b]) => [`${a.position.lat},${a.position.lon}>${b.position.lat},${b.position.lon}`, { from: a, to: b, seconds: 60, meters: 40 }])),
      partial: false,
    }),
  });
  const planner = new HybridTripPlanner(backend, 10, 3000);
  const local = await planner.plan(place("A", A), place("B", B), ready, ready, [], async () => localNetwork(true), new Set(["homm"]), signal());
  expect(local.itineraries.length).toBeGreaterThan(0);
  expect(local.itineraries[0]!.legs.some((l) => l.provider === "homm" && l.name === "288")).toBe(true);
  // Unverified (e.g. the operator's documents could not be checked): no local rides, and the answer says so.
  const closed = await planner.plan(place("A", A), place("B", B), ready, ready, [], async () => localNetwork(false), new Set(["homm"]), signal());
  expect(closed.itineraries).toEqual([]);
  expect(closed.partial).toBe(true);
});

const form = (origin = A, extra: Partial<PlanForm> = {}): PlanForm => ({
  origin: place("A", origin),
  destination: place("B", B),
  departure: null,
  localProviders: [],
  ...extra,
});

function sessionWith(answer: (ready: number) => Itinerary[], clock: () => number) {
  const searches: AbortSignal[] = [];
  const backend = fakeEmma();
  const planner = {
    plan: async (_o: PlanPlace, _d: PlanPlace, requested: number, ready: number, _n: unknown, _l: unknown, _p: unknown, s: AbortSignal) => {
      searches.push(s);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { itineraries: answer(ready), partial: false, requestedAt: requested, readyAt: ready };
    },
  } as unknown as HybridTripPlanner;
  const session = new PlannerSession({ backend, planner, loadNetwork: async () => fail(), nationalStops: () => [], clock });
  return { session, searches, backend };
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("Planner prefetch: Find joins the warm search for the same form, within 20 m and 90 s", async () => {
  let now = Date.now();
  const bus = (ready: number) => [trip("bus", [leg("BUS", ready + 5 * MIN, 10, "5")])];
  const { session, searches } = sessionWith(bus, () => now);
  session.prefetch(form());
  await wait(300);
  expect(searches).toHaveLength(1);
  // The GPS origin moved 11 m: still the same search.
  const joined = await session.plan(form({ lat: 47.5001, lon: 19.0 }), false, signal());
  expect(searches).toHaveLength(1);
  expect(joined.itineraries.map((t) => t.id)).toEqual(["bus"]);
  // 25 m away: searched fresh.
  await session.plan(form({ lat: 47.50023, lon: 19.0 }), false, signal());
  expect(searches).toHaveLength(2);
  // Older than 90 s: fresh.
  session.prefetch(form());
  await wait(300);
  now += 91_000;
  await session.plan(form(), false, signal());
  expect(searches).toHaveLength(4);
});

test("Planner prefetch: refresh, edits, a changed departure and infeasible journeys search fresh", async () => {
  let now = Date.now();
  const start = now;
  const { session, searches, backend } = sessionWith((ready) => [trip("bus", [leg("BUS", start + 90_000, 10, "5")])].filter((t) => t.start >= ready), () => now);
  session.prefetch(form());
  await wait(300);
  await session.plan(form(), true, signal());
  expect(searches).toHaveLength(2);
  expect(backend.calls).toContain("clear");
  // Editing a field cancels the prefetch (its signal aborts).
  session.prefetch(form());
  await wait(300);
  const warm = searches.at(-1)!;
  session.cancelWarmup();
  expect(warm.aborted).toBe(true);
  // Another departure is another search.
  session.prefetch(form());
  await wait(300);
  await session.plan(form(A, { departure: now + 30 * MIN }), false, signal());
  expect(searches).toHaveLength(5);
  // A journey no longer catchable at Find time is not reused.
  session.prefetch(form());
  await wait(300);
  now += 60_000;
  await session.plan(form(), false, signal());
  expect(searches).toHaveLength(7);
});

test("EMMA plan parsing keeps operators, platforms and drops what the app cannot represent", () => {
  const start = Date.now() + 5 * MIN;
  const rows = parseEmmaPlan(
    {
      plan: {
        itineraries: [
          {
            startTime: start,
            endTime: start + 50 * MIN,
            legs: [
              { mode: "WALK", startTime: start, endTime: start + 10 * MIN, distance: 700, from: { name: "Origin", lat: 47.57, lon: 18.4 }, to: { name: "Tatabánya", lat: 47.57, lon: 18.39, stop: { gtfsId: "1:tb", platformCode: "2" } } },
              { mode: "RAIL", startTime: start + 12 * MIN, endTime: start + 50 * MIN, distance: 36000, realTime: true, from: { name: "Tatabánya", lat: 47.57, lon: 18.39 }, to: { name: "Biatorbágy", lat: 47.47, lon: 18.82 }, route: { gtfsId: "1:S12", shortName: "", longName: "S12", mode: "RAIL" }, trip: { gtfsId: "1:t", tripHeadsign: "Budapest-Déli" }, intermediateStops: [{ name: "Bicske", lat: 47.49, lon: 18.63 }] },
            ],
          },
          { startTime: start, endTime: start + MIN, legs: [{ mode: "SPACESHIP", startTime: start, endTime: start + MIN, distance: 1, from: { name: "x", lat: 47, lon: 19 }, to: { name: "y", lat: 47, lon: 19 } }] },
        ],
      },
    },
    Date.now(),
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]!.legs[1]!.name).toBe("S12");
  expect(rows[0]!.legs[1]!.provider).toBe("mav");
  expect(rows[0]!.legs[1]!.headsign).toBe("Budapest-Déli");
  expect(rows[0]!.legs[0]!.toPlatform).toBe("2");
});

test("EMMA walking batches: one aliased request per eight walks, per-alias errors stay partial", async () => {
  const bodies: { query: string; variables: Record<string, string> }[] = [];
  globalThis.fetch = mock(async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init!.body)) as { query: string; variables: Record<string, string> };
    bodies.push(body);
    const now = Date.now();
    const walk = (i: number) => ({
      itineraries: [{ startTime: now, endTime: now + 300_000, legs: [{ mode: "WALK", startTime: now, endTime: now + 300_000, distance: 300 + i, from: { name: "a", lat: 47.5, lon: 19 }, to: { name: "b", lat: 47.51, lon: 19 } }] }],
    });
    return Response.json({ data: { walk0: walk(0), walk1: null }, errors: [{ path: ["walk1"], message: "no route" }] });
  }) as unknown as typeof fetch;
  const pairs: [PlanPlace, PlanPlace][] = [
    [place("a", { lat: 47.5, lon: 19 }), place("b", { lat: 47.51, lon: 19 })],
    [place("c", { lat: 47.52, lon: 19 }), place("d", { lat: 47.53, lon: 19 })],
  ];
  const result = await new EmmaPlannerBackend().walking(pairs, Date.now(), signal());
  expect(bodies).toHaveLength(1);
  expect(bodies[0]!.query).toBe(EMMA_QUERIES.walk2);
  expect(bodies[0]!.variables.from1).toBe("47.520000,19.000000");
  expect(result.links.size).toBe(1);
  expect([...result.links.values()][0]!.seconds).toBe(300);
  expect(result.partial).toBe(true);
});

test("BKK plan-trip: compact request, unsupported agencies are rejected (EMMA needed), infeasible ones are not", async () => {
  const ready = Date.now() + 10 * 60 * MIN;
  const start = ready + 5 * MIN;
  const point = (name: string, lat: number) => ({ name, lat, lon: 19.05 });
  const root = {
    status: "OK",
    currentTime: Date.now(),
    data: {
      entry: {
        plan: {
          itineraries: [
            { legs: [{ mode: "BUS", startTime: start, endTime: start + 10 * MIN, distance: 3000, routeId: "BKK_0050", routeShortName: "5", from: point("A", 47.5), to: point("B", 47.52) }] },
            { legs: [{ mode: "BUS", startTime: start, endTime: start + 10 * MIN, distance: 3000, routeId: "OTHER_1", routeShortName: "X", from: point("A", 47.5), to: point("B", 47.52) }] },
            { legs: [{ mode: "BUS", startTime: ready - 10 * MIN, endTime: ready, distance: 3000, routeId: "BKK_0050", routeShortName: "5", from: point("A", 47.5), to: point("B", 47.52) }] },
          ],
        },
      },
    },
  };
  const parsed = parsePlan(root, ready);
  expect(parsed.itineraries).toHaveLength(1);
  expect(parsed.rejected).toBe(1);
  expect(parsed.offered).toBe(3);
  expect(parsed.itineraries[0]!.legs[0]!.routerJourney).toContain("bkk:");
  const urls: string[] = [];
  globalThis.fetch = mock(async (input: string | URL | Request) => {
    urls.push(String(input));
    return Response.json(root);
  }) as unknown as typeof fetch;
  await bkkPlan(place("Deák::tér", { lat: 47.4979, lon: 19.0402 }), place("B", B), ready, "BUS,COACH,WALK", signal());
  expect(urls[0]).toContain("compact=true");
  expect(urls[0]).toContain("mode=BUS%2CCOACH%2CWALK");
  expect(urls[0]).toContain("fromPlace=De%C3%A1k+t%C3%A9r%3A%3A47.49790%2C19.04020");
  void itinerary;
});
