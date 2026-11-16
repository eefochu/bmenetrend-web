import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { planJourney, selectJourneys } from "../src/lib/transit/planner";
import type { Itinerary, Leg } from "../src/lib/transit/model";

const window = new Window({ url: "http://localhost:3000" });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: window.localStorage });
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const signal = () => new AbortController().signal;
const from = { name: "Tatabánya, kórház", position: { lat: 47.5703, lon: 18.404 } };
const to = { name: "Biatorbágy, vasútállomás", position: { lat: 47.4731, lon: 18.8237 } };

function leg(mode: string, start: number, minutes: number, name = "", distance = 300): Leg {
  return {
    mode,
    name,
    color: "#00afef",
    from: "A",
    to: "B",
    distance,
    stayOnBoard: false,
    start,
    end: start + minutes * 60_000,
    live: false,
    geometry: [],
    intermediate: [],
    source: "BKK API",
    routeId: mode === "WALK" ? undefined : `route-${name}`,
  };
}
function trip(id: string, legs: Leg[]): Itinerary {
  return { id, start: legs[0]!.start, end: legs.at(-1)!.end, walkMeters: 0, legs };
}

test("PlannerAlternatives: recommendation first, at most three, no near-duplicates", () => {
  const ready = Date.now() + 60_000;
  const base = ready + 5 * 60_000;
  const rows = [
    trip("a", [leg("WALK", base, 5), leg("RAIL", base + 6 * 60_000, 30, "S10")]),
    trip("a-copy", [leg("WALK", base, 5), leg("RAIL", base + 6 * 60_000, 30, "S10")]),
    trip("b", [leg("WALK", base + 15 * 60_000, 5), leg("RAIL", base + 21 * 60_000, 30, "S12")]),
    trip("c", [leg("WALK", base, 4), leg("BUS", base + 5 * 60_000, 20, "40"), leg("BUS", base + 28 * 60_000, 12, "88")]),
    trip("d", [leg("WALK", base + 40 * 60_000, 5), leg("RAIL", base + 46 * 60_000, 30, "S10")]),
  ];
  const shown = selectJourneys(rows, ready);
  expect(shown.length).toBeLessThanOrEqual(3);
  expect(shown.map((t) => t.id)).not.toContain("a-copy");
  expect(new Set(shown.map((t) => t.id)).size).toBe(shown.length);
});

const emmaPlan = (start: number) => ({
  data: {
    plan: {
      itineraries: [
        {
          startTime: start,
          endTime: start + 50 * 60_000,
          legs: [
            {
              mode: "WALK", startTime: start, endTime: start + 10 * 60_000, distance: 700, realTime: false,
              from: { name: "Origin", lat: 47.5703, lon: 18.404 }, to: { name: "Tatabánya", lat: 47.57, lon: 18.39, stop: { gtfsId: "1:tb", platformCode: "2" } },
              intermediateStops: [],
            },
            {
              mode: "RAIL", startTime: start + 12 * 60_000, endTime: start + 48 * 60_000, distance: 36000, realTime: true,
              from: { name: "Tatabánya", lat: 47.57, lon: 18.39 }, to: { name: "Biatorbágy", lat: 47.47, lon: 18.82 },
              route: { gtfsId: "1:S12", shortName: "", longName: "S12", mode: "RAIL", color: "00AFEF" },
              trip: { gtfsId: "1:trip", tripShortName: "4418", tripHeadsign: "Budapest-Déli" },
              intermediateStops: [{ name: "Bicske", lat: 47.49, lon: 18.63 }],
            },
            {
              mode: "WALK", startTime: start + 48 * 60_000, endTime: start + 50 * 60_000, distance: 120, realTime: false,
              from: { name: "Biatorbágy", lat: 47.47, lon: 18.82 }, to: { name: "Dest", lat: 47.4731, lon: 18.8237 },
              intermediateStops: [],
            },
          ],
        },
      ],
      routingErrors: [],
    },
  },
});

test("BKK with no journey falls back to EMMA's national planner", async () => {
  // Past any shared Worker cooldown another test file may leave behind.
  const clock = spyOn(Date, "now").mockReturnValue(Date.now() + 10 * 60_000);
  try {
    const start = Date.now() + 5 * 60_000;
    const fetcher = mock(async (input: string | URL | Request) =>
      String(input).includes("workers.dev")
        ? Response.json({ status: "OK", currentTime: Date.now(), data: { entry: { plan: { itineraries: [] } } } })
        : Response.json(emmaPlan(start)),
    );
    globalThis.fetch = fetcher as unknown as typeof fetch;
    const outcome = await planJourney(from, to, new Date(Date.now()), signal());
    expect(fetcher.mock.calls.some((call) => String(call[0]).includes("plan-trip"))).toBe(true);
    expect(outcome.itineraries).toHaveLength(1);
    const ride = outcome.itineraries[0]!.legs[1]!;
    expect(ride.name).toBe("S12");
    expect(ride.headsign).toBe("Budapest-Déli");
    expect(ride.source).toBe("EMMA");
    expect(outcome.itineraries[0]!.legs[0]!.toPlatform).toBe("2");
  } finally {
    clock.mockRestore();
  }
});

test("when EMMA is down, BKK's usable journeys are still a partial answer", async () => {
  const clock = spyOn(Date, "now").mockReturnValue(Date.now() + 20 * 60_000);
  try {
    const start = Math.floor((Date.now() + 5 * 60_000) / 1000) * 1000;
    const fetcher = mock(async (input: string | URL | Request) =>
      String(input).includes("workers.dev")
        ? Response.json({
            status: "OK",
            currentTime: Date.now(),
            data: {
              entry: {
                plan: {
                  itineraries: [
                    { startTime: start, walkDistance: 50, legs: [{ mode: "BUS", startTime: start, endTime: start + 600_000, routeShortName: "40", from: { name: "A" }, to: { name: "B" } }] },
                    { startTime: start, legs: [{ mode: "BUS", startTime: start + 600_000, endTime: start }] },
                  ],
                },
              },
            },
          })
        : new Response("", { status: 400 }),
    );
    globalThis.fetch = fetcher as unknown as typeof fetch;
    const outcome = await planJourney(from, to, new Date(Date.now()), signal());
    expect(outcome.itineraries).toHaveLength(1);
    expect(outcome.partial).toBe(true);
  } finally {
    clock.mockRestore();
  }
});
