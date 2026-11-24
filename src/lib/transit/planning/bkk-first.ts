import { bkkPlan, planHeadroom, stopsAt, type BkkPlanResult } from "../client";
import type { Itinerary, Stop } from "../model";
import { LONG_WALK_SECONDS, WALK_AVERSE_TIMEOUT_MILLIS, EGRESS_WALK_SECONDS, finalWalkSeconds } from "./alternatives";
import { aborted, Semaphore, walkKey, withTimeout, type Bounds, type PlannerBackend, type PlanPlace, type WalkingLink, type WalkingResult, type WalkPair } from "./backend";
import { feasible, rides, seconds, supported, TRANSFER_SECONDS, walkMeters, walkSeconds } from "./core";
import { distanceMeters } from "~/lib/places";

const RESERVED_PLANS = 4;
const MAX_BKK_WALKS = 4;
/** Journeys whose final walk is looked at for a connecting ride, per search. */
const MAX_CONNECTIONS = 2;
/** A connecting ride must spare at least this much walking to be offered. */
const MIN_WALK_SAVED_SECONDS = 240;

/** BKK's planner as seen by [BkkFirstPlannerBackend]; tests substitute a fake (BkkPlannerSource). */
export type BkkPlannerSource = {
  plan(from: PlanPlace, to: PlanPlace, ready: number, busesOnly: boolean, signal: AbortSignal): Promise<BkkPlanResult>;
  walking(from: PlanPlace, to: PlanPlace, ready: number, signal: AbortSignal): Promise<WalkingLink | null>;
  stops(bounds: Bounds, signal: AbortSignal): Promise<Stop[]>;
  planHeadroom(): number;
};

export const workerPlannerSource: BkkPlannerSource = {
  plan: (from, to, ready, busesOnly, signal) => bkkPlan(from, to, ready, busesOnly ? "BUS,COACH,WALK" : "TRANSIT,WALK", signal),
  async walking(from, to, ready, signal) {
    const result = await bkkPlan(from, to, ready, "WALK", signal);
    const trip = result.itineraries.find((row) => row.legs.every((leg) => leg.mode === "WALK"));
    return trip ? { from, to, seconds: seconds(trip.start, trip.end), meters: walkMeters(trip) } : null;
  },
  async stops(bounds, signal) {
    const center = { lat: (bounds.south + bounds.north) / 2, lon: (bounds.west + bounds.east) / 2 };
    const radius = Math.min(5000, Math.ceil(distanceMeters(center, { lat: bounds.north, lon: bounds.east })));
    return (await stopsAt(center, radius, signal)).value;
  },
  planHeadroom,
};

/** BkkWorkerRepository.plannable */
const plannable = (p: PlanPlace) => supported(p.position) && p.position.lat >= 45 && p.position.lat <= 49 && p.position.lon >= 16 && p.position.lon <= 23.5;

/** Same vehicles at the same minutes are one itinerary whichever planner found it. */
const signature = (trip: Itinerary) =>
  rides(trip)
    .map((leg) => `${leg.mode}\u0000${leg.name}\u0000${Math.floor(leg.start / 60_000)}`)
    .join("|");
export function combine(primary: Itinerary[], secondary: Itinerary[]) {
  if (!primary.length) return secondary;
  const known = new Set(primary.map(signature));
  return [...primary, ...secondary.filter((trip) => !known.has(signature(trip)))];
}

/**
 * Port of data/BkkFirstPlannerBackend.kt: BKK-first planning for any endpoints the Worker accepts.
 *  - A healthy, non-empty BKK answer is returned at once; EMMA's walk-averse search is merged in only when
 *    every BKK journey walks a long way (bounded), and long final walks may get a connecting ride.
 *  - EMMA is asked when BKK fails, times out, is over budget, has nothing, or offered journeys the app
 *    could not represent. Identical journeys appear once.
 *  - A completed result is reused for 30 s for the same endpoints, re-checked against the new ready time.
 *  - Walking links try BKK first (a few, within the plan budget), falling back to EMMA per missing item.
 */
export class BkkFirstPlannerBackend implements PlannerBackend {
  private recent = new Map<string, { ready: number; fetched: number; rows: Itinerary[] }>();
  private walks = new Map<string, WalkingLink>();
  private walkRequests = new Semaphore(2);

  constructor(
    private emma: PlannerBackend,
    private bkk: BkkPlannerSource = workerPlannerSource,
    private bkkTimeoutMillis = 5_000,
    private clock: () => number = Date.now,
  ) {}

  clearRouteCache() {
    this.recent.clear();
    this.emma.clearRouteCache();
  }

  routes(from: PlanPlace, to: PlanPlace, ready: number, busesOnly: boolean, signal: AbortSignal) {
    return this.search(from, to, ready, busesOnly, true, signal);
  }
  plainRoutes(from: PlanPlace, to: PlanPlace, ready: number, busesOnly: boolean, signal: AbortSignal) {
    return this.search(from, to, ready, busesOnly, false, signal);
  }
  walkAverseRoutes(from: PlanPlace, to: PlanPlace, ready: number, busesOnly: boolean, signal: AbortSignal) {
    return this.emma.walkAverseRoutes(from, to, ready, busesOnly, signal);
  }

  private async search(from: PlanPlace, to: PlanPlace, ready: number, busesOnly: boolean, enrich: boolean, signal: AbortSignal) {
    if (!plannable(from) || !plannable(to)) return this.emma.routes(from, to, ready, busesOnly, signal);
    const key = `${from.position.lat},${from.position.lon}>${to.position.lat},${to.position.lon}:${busesOnly}:${enrich}`;
    const cached = this.cachedRoutes(key, ready);
    if (cached) return cached;
    const primary = await this.bkkRoutes(from, to, ready, busesOnly, signal);
    if (primary?.itineraries.length && primary.rejected === 0) {
      const rows = primary.itineraries;
      if (!enrich) return this.remember(key, ready, rows);
      // Both improvements are bounded and run together, so they add at most one timeout.
      const [averse, connected] = await Promise.all([
        this.walkAverse(rows, from, to, ready, busesOnly, signal),
        this.connectingRides(rows, to, ready, busesOnly, signal),
      ]);
      return this.remember(key, ready, combine(combine(rows, connected), averse));
    }
    const supplied = primary?.itineraries ?? [];
    let national: Itinerary[];
    try {
      national = await this.emma.routes(from, to, ready, busesOnly, signal);
    } catch (error) {
      if (signal.aborted) throw aborted();
      if (!supplied.length) throw error;
      // EMMA is down: BKK's usable itineraries are still a real (partial) answer.
      return this.remember(key, ready, supplied);
    }
    const rows = combine(supplied, national);
    return rows.length ? this.remember(key, ready, rows) : rows;
  }

  /** When every BKK journey walks LONG_WALK_SECONDS or more, also ask EMMA to avoid walking (bounded). */
  private async walkAverse(rows: Itinerary[], from: PlanPlace, to: PlanPlace, ready: number, busesOnly: boolean, signal: AbortSignal) {
    if (!rows.length || Math.min(...rows.map(walkSeconds)) < LONG_WALK_SECONDS) return [];
    try {
      return (await withTimeout(WALK_AVERSE_TIMEOUT_MILLIS, signal, (inner) => this.emma.walkAverseRoutes(from, to, ready, busesOnly, inner))) ?? [];
    } catch (error) {
      if (signal.aborted) throw aborted();
      void error;
      return [];
    }
  }

  /** "Wait for a ride instead of walking": splice a BKK connection from where long-final-walk journeys get off. */
  private async connectingRides(rows: Itinerary[], to: PlanPlace, ready: number, busesOnly: boolean, signal: AbortSignal) {
    if (this.bkk.planHeadroom() <= RESERVED_PLANS) return [];
    const seen = new Set<string>();
    const targets = rows
      .filter((trip) => finalWalkSeconds(trip) >= EGRESS_WALK_SECONDS)
      .sort((a, b) => a.end - b.end)
      .filter((trip) => {
        const last = rides(trip).at(-1)!;
        const key = `${last.toPosition.lat},${last.toPosition.lon}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, MAX_CONNECTIONS);
    if (!targets.length) return [];
    const spliced = await Promise.all(
      targets.map(async (trip) => {
        const lastRide = rides(trip).at(-1)!;
        const stop: PlanPlace = { id: `egress:${lastRide.to}`, name: lastRide.to, position: lastRide.toPosition };
        // Leave the app's usual transfer time, so every spliced change is one the rider can make.
        const connectFrom = lastRide.end + TRANSFER_SECONDS * 1000;
        let tails: Itinerary[] = [];
        try {
          tails = (await withTimeout(WALK_AVERSE_TIMEOUT_MILLIS, signal, (inner) => this.bkk.plan(stop, to, connectFrom, busesOnly, inner)))?.itineraries ?? [];
        } catch (error) {
          if (signal.aborted) throw aborted();
          void error;
        }
        const walked = finalWalkSeconds(trip);
        const prefix = trip.legs.slice(0, trip.legs.lastIndexOf(lastRide) + 1);
        return tails
          .filter(
            (tail) =>
              rides(tail).length > 0 &&
              tail.start >= lastRide.end &&
              rides(tail)[0]!.start >= connectFrom &&
              walkSeconds(tail) + MIN_WALK_SAVED_SECONDS <= walked,
          )
          .map((tail): Itinerary => {
            const legs = [...prefix, ...tail.legs];
            const joined: Itinerary = { id: `${trip.id}+${tail.id}`, start: trip.start, end: tail.end, walkMeters: 0, legs, fetchedAt: trip.fetchedAt };
            joined.walkMeters = walkMeters(joined);
            return joined;
          })
          // Checked against the requested departure, like every other journey.
          .filter((joined) => feasible(joined.legs, ready));
      }),
    );
    return spliced.flat();
  }

  /** Null when BKK failed, timed out or is over its request budget. */
  private async bkkRoutes(from: PlanPlace, to: PlanPlace, ready: number, busesOnly: boolean, signal: AbortSignal) {
    try {
      return await withTimeout(this.bkkTimeoutMillis, signal, (inner) => this.bkk.plan(from, to, ready, busesOnly, inner));
    } catch (error) {
      if (signal.aborted) throw aborted();
      void error;
      return null;
    }
  }

  private remember(key: string, ready: number, rows: Itinerary[]) {
    this.recent.delete(key);
    this.recent.set(key, { ready, fetched: this.clock(), rows });
    while (this.recent.size > 8) this.recent.delete(this.recent.keys().next().value!);
    return rows;
  }

  /** A still-feasible recent answer, or null when nothing reusable remains (then plan again). */
  private cachedRoutes(key: string, ready: number) {
    const cached = this.recent.get(key);
    if (!cached) return null;
    const age = Math.floor((this.clock() - cached.fetched) / 1000);
    if (ready - cached.ready < 0 || ready - cached.ready > 10_000 || age < 0 || age > 30) return null;
    this.recent.delete(key);
    this.recent.set(key, cached);
    const rows = cached.rows.filter((trip) => feasible(trip.legs, ready));
    return rows.length ? rows : null;
  }

  async walking(pairs: WalkPair[], ready: number, signal: AbortSignal): Promise<WalkingResult> {
    const distinct = [...new Map(pairs.map((pair) => [walkKey(pair[0].position, pair[1].position), pair])).values()];
    const found = new Map<string, WalkingLink>();
    for (const [a, b] of distinct) {
      const key = walkKey(a.position, b.position);
      const known = this.walks.get(key);
      if (known) found.set(key, { ...known, from: a, to: b });
    }
    // Walking links are optional detail: keep most of the planner budget for journeys.
    const allowance = Math.min(MAX_BKK_WALKS, Math.max(0, this.bkk.planHeadroom() - RESERVED_PLANS));
    // The few BKK walks go to the first pairs: callers list the most important first.
    const viaBkk = distinct
      .filter(([a, b]) => !found.has(walkKey(a.position, b.position)) && plannable(a) && plannable(b))
      .slice(0, allowance);
    const fetched = await Promise.all(
      viaBkk.map(async ([a, b]) => {
        try {
          const link = await this.walkRequests.use(signal, () => withTimeout(this.bkkTimeoutMillis, signal, (inner) => this.bkk.walking(a, b, ready, inner)));
          return link ? ([walkKey(a.position, b.position), link] as const) : null;
        } catch (error) {
          if (signal.aborted) throw aborted();
          void error;
          return null;
        }
      }),
    );
    for (const entry of fetched) {
      if (!entry) continue;
      found.set(entry[0], entry[1]);
      this.walks.delete(entry[0]);
      this.walks.set(entry[0], entry[1]);
      while (this.walks.size > 256) this.walks.delete(this.walks.keys().next().value!);
    }
    const missing = distinct.filter(([a, b]) => !found.has(walkKey(a.position, b.position)));
    if (!missing.length) return { links: found, partial: false };
    let fallback: WalkingResult;
    try {
      fallback = await this.emma.walking(missing, ready, signal);
    } catch (error) {
      if (signal.aborted) throw aborted();
      void error;
      fallback = { links: new Map(), partial: true };
    }
    fallback.links.forEach((value, key) => found.set(key, value));
    return { links: found, partial: fallback.partial };
  }

  /** BKK area stops first; EMMA supplements missing identities without replacing a BKK station. */
  async stops(bounds: Bounds, signal: AbortSignal): Promise<Stop[]> {
    let primary: Stop[] = [];
    try {
      primary = (await this.bkk.stops(bounds, signal)).filter(
        (stop) =>
          stop.position.lat >= bounds.south && stop.position.lat <= bounds.north && stop.position.lon >= bounds.west && stop.position.lon <= bounds.east,
      );
    } catch (error) {
      if (signal.aborted) throw aborted();
      void error;
    }
    let fallback: Stop[] = [];
    try {
      fallback = await this.emma.stops(bounds, signal);
    } catch (error) {
      if (signal.aborted) throw aborted();
      if (!primary.length) throw error;
    }
    const ids = new Set(primary.map((stop) => stop.id));
    return [...primary, ...fallback.filter((stop) => !ids.has(stop.id))];
  }
}
