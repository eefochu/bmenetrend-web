import { distanceMeters } from "~/lib/places";
import { hevNumber, HEV_COLORS } from "../client";
import { emmaQuery, railNumber } from "../emma";
import { EMMA_QUERIES, WALK_OPERATIONS } from "../emma-contract";
import { array, object, string, type Itinerary, type Leg, type Row, type Stop } from "../model";
import { aborted, Semaphore, walkKey, type Bounds, type PlannerBackend, type PlanPlace, type WalkingLink, type WalkingResult, type WalkPair } from "./backend";
import { budapestParts, feasible, itineraryId, order, seconds, walkMeters } from "./core";

const PLAN_MODES = new Set([
  "WALK", "BUS", "COACH", "TRAM", "TROLLEYBUS", "SUBWAY", "RAIL", "SUBURBAN_RAILWAY", "TRAMTRAIN", "FERRY", "CABLE_CAR", "FUNICULAR",
]);
const isTrain = (mode: string) => mode === "RAIL" || mode === "TRAMTRAIN" || mode === "TRAIN";

/** TripPlanner.variables: coordinates and Budapest local date/time. */
export function planVariables(from: PlanPlace, to: PlanPlace, ready: number) {
  const parts = budapestParts(ready);
  return {
    from: `${from.position.lat.toFixed(6)},${from.position.lon.toFixed(6)}`,
    to: `${to.position.lat.toFixed(6)},${to.position.lon.toFixed(6)}`,
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

function point(row: Row) {
  const lat = row.lat,
    lon = row.lon;
  if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    throw new Error("Hibás pont");
  const name = string(row.name);
  if (!name) throw new Error("Névtelen pont");
  return { name, position: { lat, lon }, platform: string(object(row.stop).platformCode) || undefined };
}

/** TripPlanner.parse: EMMA plan rows the app can represent, sorted, at most twelve. */
export function parseEmmaPlan(data: Row, ready: number): Itinerary[] {
  const plan = object(data.plan);
  if (!Array.isArray(plan.itineraries)) throw new Error("Hiányzó útvonalak");
  const seen = new Map<string, Itinerary>();
  for (const value of plan.itineraries) {
    try {
      const row = object(value);
      const rows = array(row.legs);
      if (rows.length < 1 || rows.length > 40) throw new Error("legs");
      const legs = rows.map((value): Leg => {
        const leg = object(value),
          mode = string(leg.mode);
        if (!PLAN_MODES.has(mode)) throw new Error("mode");
        const start = leg.startTime,
          end = leg.endTime,
          distance = leg.distance;
        if (typeof start !== "number" || typeof end !== "number" || typeof distance !== "number" || end < start || !(distance >= 0))
          throw new Error("time");
        // The street router accounts for grades/escalators; do not override those times.
        if (mode === "WALK" && seconds(start, end) + 10 < distance / 2.2) throw new Error("walk");
        const raw = leg.route && typeof leg.route === "object" ? object(leg.route) : null;
        let route: { id: string; provider: string; name: string; color: string } | null = null;
        if (raw) {
          const source = string(raw.gtfsId);
          if (!source) throw new Error("route");
          const short = string(raw.shortName),
            long = string(raw.longName);
          const hev = mode === "SUBURBAN_RAILWAY" ? hevNumber(short, long) : undefined;
          const provider = hev
            ? "hev"
            : source.startsWith("hkir:") && source.length > 5
              ? "volan"
              : source.startsWith("BKK:") && source.length > 4
                ? "bkk"
                : "mav";
          const name =
            hev ??
            (isTrain(mode)
              ? railNumber(short, long)
              : short && !short.includes("<") && !/[-]/.test(short)
                ? short
                : long || mode);
          const rawColor = string(raw.color);
          route = {
            // The app's EMMA identities (`emma:hkir:…` Volán, `emma:1:…` MÁV), so badges use operator colours.
            id: `emma:${source}`,
            provider,
            name,
            color: hev
              ? (HEV_COLORS[hev[1]!] ?? "#EB6482")
              : /^[a-f\d]{6}$/i.test(rawColor)
                ? `#${rawColor}`
                : isTrain(mode)
                  ? "#0066AA"
                  : provider === "volan"
                    ? "#F9B900"
                    : "#199DCF",
          };
        }
        if (mode !== "WALK" && !route) throw new Error("route");
        const from = point(object(leg.from)),
          to = point(object(leg.to));
        const stops = array(leg.intermediateStops).map((stop) => point(object(stop)));
        const trip = object(leg.trip);
        return {
          routeId: route?.id,
          provider: route?.provider,
          mode,
          name: route?.name ?? "",
          color: route?.color ?? "#536171",
          from: from.name,
          to: to.name,
          fromPosition: from.position,
          toPosition: to.position,
          fromPlatform: from.platform,
          toPlatform: to.platform,
          headsign: string(trip.tripHeadsign) || undefined,
          distance,
          stayOnBoard: leg.interlineWithPreviousLeg === true,
          start,
          end,
          live: leg.realTime === true,
          geometry: [from, ...stops, to].map((p) => [p.position.lon, p.position.lat] as [number, number]),
          intermediate: stops.map((stop) => stop.name),
          source: "EMMA",
          tripId: string(trip.gtfsId) || undefined,
        };
      });
      if (!feasible(legs, ready)) throw new Error("feasible");
      if (row.startTime !== legs[0]!.start || row.endTime !== legs.at(-1)!.end) throw new Error("times");
      const trip: Itinerary = { id: itineraryId(legs), start: legs[0]!.start, end: legs.at(-1)!.end, walkMeters: 0, legs };
      trip.walkMeters = walkMeters(trip);
      if (!seen.has(trip.id)) seen.set(trip.id, trip);
    } catch {
      /* TripPlanner.parse drops rows the app cannot represent. */
    }
  }
  return [...seen.values()].sort(order).slice(0, 12);
}

type RouteRequest = {
  ready: number;
  started: number;
  completed?: number;
  result: Promise<Itinerary[]>;
  controller: AbortController;
  users: number;
  failed?: boolean;
};

/** Port of EmmaPlannerBackend: shared budget for national searches and small, aliased street-walking batches. */
export class EmmaPlannerBackend implements PlannerBackend {
  private requests = new Semaphore(4);
  private walkingBatches = new Semaphore(3);
  private routeRequests = new Map<string, RouteRequest>();
  /** Routed walks (null: the router found none), LRU of 1024. */
  private walks = new Map<string, WalkingLink | null>();

  constructor(private clock: () => number = Date.now) {}

  clearRouteCache() {
    this.routeRequests.clear();
  }

  /** EMMA's stops in a bounded area (all operators), for local/national gateways. */
  async stops(bounds: Bounds, signal: AbortSignal): Promise<Stop[]> {
    const round = (value: number) => Math.round(value * 1e5) / 1e5;
    const area = { south: round(bounds.south), west: round(bounds.west), north: round(bounds.north), east: round(bounds.east) };
    // The adapter accepts at most 0.12° × 0.2° inside Hungary.
    if (area.north - area.south > 0.12 || area.east - area.west > 0.2) return [];
    const result = await this.requests.use(signal, () => emmaQuery(EMMA_QUERIES.stops, area, 300_000, signal));
    return array(result.data.stopsByBbox).flatMap((value): Stop[] => {
      const row = object(value),
        id = string(row.gtfsId);
      const lat = row.lat,
        lon = row.lon;
      if (!id || !/^(?:hkir:|BKK:|1:)./.test(id) || typeof lat !== "number" || typeof lon !== "number" || !string(row.name)) return [];
      if (row.locationType !== undefined && row.locationType !== null && row.locationType !== 0 && row.locationType !== "STOP") return [];
      return [
        {
          id: `emma:${id}`,
          rawId: `emma:${id}`,
          name: string(row.name),
          position: { lat, lon },
          platform: string(row.platformCode),
          mode: string(row.vehicleMode),
          routes: [],
          source: "EMMA",
        },
      ];
    });
  }

  /** Shares an identical in-flight or just-finished search; a later ready time re-checks feasibility. */
  async routes(from: PlanPlace, to: PlanPlace, ready: number, busesOnly: boolean, signal: AbortSignal): Promise<Itinerary[]> {
    const key = `${from.position.lat},${from.position.lon}>${to.position.lat},${to.position.lon}:${busesOnly}`;
    for (;;) {
      if (signal.aborted) throw aborted();
      const now = this.clock();
      let entry = this.routeRequests.get(key);
      const reusable =
        entry &&
        !entry.failed &&
        !entry.controller.signal.aborted &&
        ready - entry.ready >= 0 &&
        ready - entry.ready <= 10_000 &&
        now - (entry.completed ?? entry.started) >= 0 &&
        now - (entry.completed ?? entry.started) <= (entry.completed === undefined ? 30_000 : 10_000);
      if (!reusable) {
        const controller = new AbortController();
        const created: RouteRequest = { ready, started: now, controller, users: 0, result: Promise.resolve([]) };
        created.result = this.requests
          .use(controller.signal, () => this.fetchRoutes(from, to, ready, busesOnly, false, controller.signal))
          .then(
            (rows) => {
              created.completed = this.clock();
              return rows;
            },
            (error: unknown) => {
              created.failed = true;
              if (this.routeRequests.get(key) === created) this.routeRequests.delete(key);
              throw error;
            },
          );
        created.result.catch(() => undefined);
        this.routeRequests.set(key, created);
        while (this.routeRequests.size > 16) this.routeRequests.delete(this.routeRequests.keys().next().value!);
        entry = created;
      }
      const shared = entry!;
      let rows: Itinerary[];
      try {
        rows = await this.join(shared, signal);
      } catch (error) {
        if (signal.aborted) throw aborted();
        // A cancelled search owned by another caller: search again.
        if (shared.controller.signal.aborted && !shared.failed) {
          if (this.routeRequests.get(key) === shared) this.routeRequests.delete(key);
          continue;
        }
        throw error;
      }
      const usable = shared.ready === ready ? rows : rows.filter((trip) => feasible(trip.legs, ready));
      if (usable.length || (!rows.length && shared.ready === ready)) return usable;
      // A later "now" can invalidate a cached boarding/walk: query again at the requested time.
      if (this.routeRequests.get(key) === shared) this.routeRequests.delete(key);
    }
  }

  /** Waits for a shared request; the request is aborted only when every waiter has gone. */
  private join(entry: RouteRequest, signal: AbortSignal): Promise<Itinerary[]> {
    entry.users++;
    return new Promise((resolve, reject) => {
      let done = false;
      const release = () => {
        if (done) return;
        done = true;
        signal.removeEventListener("abort", onAbort);
        if (--entry.users === 0 && entry.completed === undefined) entry.controller.abort();
      };
      const onAbort = () => {
        release();
        reject(aborted());
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
      entry.result.then(
        (rows) => {
          if (!done) {
            release();
            resolve(rows);
          }
        },
        (error: unknown) => {
          if (!done) {
            release();
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        },
      );
    });
  }

  plainRoutes(from: PlanPlace, to: PlanPlace, ready: number, busesOnly: boolean, signal: AbortSignal) {
    return this.routes(from, to, ready, busesOnly, signal);
  }

  /** Not shared with [routes]' request cache: a different query, asked only after a long-walk answer. */
  walkAverseRoutes(from: PlanPlace, to: PlanPlace, ready: number, busesOnly: boolean, signal: AbortSignal) {
    return this.requests.use(signal, () => this.fetchRoutes(from, to, ready, busesOnly, true, signal));
  }

  private async fetchRoutes(from: PlanPlace, to: PlanPlace, ready: number, busesOnly: boolean, avoidWalking: boolean, signal: AbortSignal) {
    const query = busesOnly
      ? avoidWalking
        ? EMMA_QUERIES.planWalkAverseBus
        : EMMA_QUERIES.planBus
      : avoidWalking
        ? EMMA_QUERIES.planWalkAverse
        : EMMA_QUERIES.plan;
    const result = await emmaQuery(query, planVariables(from, to, ready), 15_000, signal);
    return parseEmmaPlan(result.data, ready);
  }

  async walking(pairs: WalkPair[], ready: number, signal: AbortSignal): Promise<WalkingResult> {
    const distinct = [...new Map(pairs.map((pair) => [walkKey(pair[0].position, pair[1].position), pair])).values()];
    const missing = distinct.filter(([a, b]) => !this.walks.has(walkKey(a.position, b.position)));
    const batches: WalkPair[][] = [];
    for (let i = 0; i < missing.length; i += 8) batches.push(missing.slice(i, i + 8));
    const results = await Promise.all(
      batches.map(async (batch) => {
        try {
          const values = await this.walkingBatches.use(signal, () =>
            this.requests.use(signal, () => this.walkBatch(batch, ready, signal)),
          );
          values.links.forEach((value, key) => {
            this.walks.delete(key);
            this.walks.set(key, value);
          });
          while (this.walks.size > 1024) this.walks.delete(this.walks.keys().next().value!);
          return values.partial;
        } catch (error) {
          if (signal.aborted) throw aborted();
          void error;
          return true;
        }
      }),
    );
    const links = new Map<string, WalkingLink>();
    for (const [from, to] of distinct) {
      const key = walkKey(from.position, to.position);
      const walk = this.walks.get(key);
      if (walk) links.set(key, { ...walk, from, to });
    }
    return { links, partial: results.some(Boolean) };
  }

  private async walkBatch(batch: WalkPair[], ready: number, signal: AbortSignal) {
    const base = planVariables(batch[0]![0], batch[0]![1], ready);
    const variables: Row = { date: base.date, time: base.time };
    batch.forEach(([from, to], index) => {
      variables[`from${index}`] = `${from.position.lat.toFixed(6)},${from.position.lon.toFixed(6)}`;
      variables[`to${index}`] = `${to.position.lat.toFixed(6)},${to.position.lon.toFixed(6)}`;
    });
    const result = await emmaQuery(EMMA_QUERIES[WALK_OPERATIONS[batch.length - 1]!], variables, 600_000, signal, { partial: true });
    const failed = new Set(
      result.errors.map((error) => {
        const alias = string(array(error.path)[0]);
        if (!batch.some((_, index) => alias === `walk${index}`)) throw new Error("Unscoped walking error");
        return alias;
      }),
    );
    const links = new Map<string, WalkingLink | null>();
    batch.forEach(([from, to], index) => {
      const alias = `walk${index}`;
      const value = result.data[alias];
      if (failed.has(alias) || value === null || value === undefined) return;
      let walk: WalkingLink | null = null;
      try {
        const trip = parseEmmaPlan({ plan: value }, ready).find((row) => row.legs.every((leg) => leg.mode === "WALK"));
        if (trip) walk = { from, to, seconds: seconds(trip.start, trip.end), meters: walkMeters(trip) };
      } catch {
        walk = null;
      }
      links.set(walkKey(from.position, to.position), walk);
    });
    return { links, partial: failed.size > 0 || links.size < batch.length };
  }
}

export const straightMeters = distanceMeters;
