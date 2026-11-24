import { distanceMeters, type GeoPoint } from "~/lib/places";
import type { Itinerary, Stop } from "../model";
import { LESS_WALK_MAX_DELAY_SECONDS, mayImprove, select, WALK_AVERSE_TIMEOUT_MILLIS } from "./alternatives";
import { aborted, walkKey, type PlannerBackend, type PlanPlace, type WalkingLink, type WalkingResult } from "./backend";
import { addDays, budapestDay, isYearReviewed, providerCalendar } from "./calendar";
import { BOARD_SECONDS, itinerary, rides, TRANSFER_SECONDS, timelyFilter, WALK_SPEED } from "./core";
import type { LocalNetwork, LocalRoute, LocalStop } from "./local-network";
import { LocalTimetableRouter, pathBoardings, stopPlace, transferKey, walkingLeg, type LocalPath } from "./local-router";

export type TripPlan = { itineraries: Itinerary[]; partial: boolean; requestedAt: number; readyAt: number };

const ACCESS_METERS = 1_200;
const TRANSFER_WALK_METERS = 200;
const GATEWAY_METERS = 400;
/** A local stop counts as a rail interchange only this close to a platform. */
const RAIL_GATEWAY_METERS = 150;
/** Endpoints this close to a stop are reached without a routed walk. */
const SAME_PLACE_METERS = 40;
const LOCAL_PROVIDERS = new Set(["viabusz", "kanyargo", "homm"]);
/** Longest a search waits for the local timetable search after the first usable answer. */
export const LOCAL_WAIT_MILLIS = 2_500;
/** Longest a search waits for combined local + national journeys once local search finished. */
export const GATEWAY_WAIT_MILLIS = 3_000;
const distance = (a: GeoPoint, b: GeoPoint) => distanceMeters(a, b);

/** TripPlanner.timelyChoices */
export const timelyChoices = (journeys: readonly Itinerary[], ready: number) => select(timelyFilter(journeys, ready), ready);

type Stage = "direct" | "localStarted" | "local" | "gatewayStarted" | "gateway";
type Update = { plan?: TripPlan; direct?: boolean; complete?: boolean; failure?: unknown; local?: boolean; localStarted?: boolean; gatewayStarted?: boolean };

class Channel<T> {
  private items: T[] = [];
  private waiter: ((item: T) => void) | null = null;
  send(item: T) {
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = null;
      waiter(item);
    } else this.items.push(item);
  }
  receive(): Promise<T> {
    if (this.items.length) return Promise.resolve(this.items.shift()!);
    return new Promise((resolve) => (this.waiter = resolve));
  }
}

const isRail = (mode: string) => mode === "RAIL" || mode === "TRAMTRAIN" || mode === "TRAIN" || mode === "SUBURBAN_RAILWAY";
type Reference = { position: GeoPoint; mode: string };

/** Port of data/HybridTripPlanner.kt: join reviewed local timetables to national services using routed street walks. */
export class HybridTripPlanner {
  constructor(
    private backend: PlannerBackend,
    private localSettleMillis = 500,
    private searchTimeoutMillis = 10_000,
  ) {}

  async plan(
    origin: PlanPlace,
    destination: PlanPlace,
    requested: number,
    ready: number,
    nationalStops: readonly Stop[],
    loadNetwork: (signal: AbortSignal) => Promise<LocalNetwork>,
    localProviders: ReadonlySet<string>,
    signal: AbortSignal,
  ): Promise<TripPlan> {
    if (signal.aborted) throw aborted();
    // Candidates stay private until one complete, feasible snapshot is selected. A good direct answer
    // never waits for walking, local verification or gateway fan-out.
    const controller = new AbortController();
    const stop = () => controller.abort();
    signal.addEventListener("abort", stop, { once: true });
    const updates = new Channel<Update | null>();
    void this.search(origin, destination, requested, ready, nationalStops, loadNetwork, localProviders, controller.signal, (plan, stage) =>
      updates.send({
        plan: stage === "localStarted" ? undefined : plan,
        direct: stage === "direct",
        local: stage === "local",
        localStarted: stage === "localStarted",
        gatewayStarted: stage === "gatewayStarted",
      }),
    ).then(
      (complete) => updates.send({ plan: complete, complete: true }),
      (failure: unknown) => {
        if (!controller.signal.aborted) updates.send({ complete: true, failure });
      },
    );
    let best: TripPlan | null = null;
    let latest: TripPlan | null = null;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const restartSettle = (wait: number) => {
      clearTimeout(settle);
      settle = setTimeout(() => updates.send(null), wait);
    };
    let directAnswers = 0;
    // Short local rides come from the local timetable search, which may finish after both direct answers.
    let localPending = false,
      localDone = false,
      gatewayPending = false;
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      updates.send(null);
    }, this.searchTimeoutMillis);
    const onAbort = () => updates.send(null);
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      for (;;) {
        const update = await updates.receive();
        if (signal.aborted) throw aborted();
        if (update === null) {
          if (timedOut) {
            if (best) return { ...best, partial: true };
            throw new Error("Planning services unavailable");
          }
          return best!;
        }
        if (update.direct) directAnswers++;
        if (update.local) {
          localPending = false;
          localDone = true;
        }
        // Local search done; combined local + national journeys follow in their own bounded window.
        if (update.gatewayStarted) {
          localPending = true;
          localDone = true;
          gatewayPending = true;
          if (settle !== undefined)
            restartSettle(Math.max(GATEWAY_WAIT_MILLIS, mayImprove(best?.itineraries ?? []) ? WALK_AVERSE_TIMEOUT_MILLIS : 0));
        }
        if (update.localStarted && !localDone) {
          localPending = true;
          if (settle !== undefined)
            restartSettle(Math.max(LOCAL_WAIT_MILLIS, mayImprove(best?.itineraries ?? []) ? WALK_AVERSE_TIMEOUT_MILLIS : 0));
          continue;
        }
        if (update.plan) {
          latest = update.plan;
          const choices = timelyChoices([...update.plan.itineraries, ...(best?.itineraries ?? [])], ready);
          if (choices.length) best = { ...update.plan, itineraries: choices };
        }
        if (best && (update.complete || (directAnswers >= 2 && !localPending))) return best;
        if (update.complete) {
          if (update.failure !== undefined) throw update.failure instanceof Error ? update.failure : new Error("Planning services unavailable");
          return { ...latest!, itineraries: [] };
        }
        // Give the other direct query (and a long-walk answer's walk-averse search) a short chance.
        if (best && settle === undefined)
          restartSettle(
            Math.max(
              this.localSettleMillis,
              mayImprove(best.itineraries) ? WALK_AVERSE_TIMEOUT_MILLIS : 0,
              gatewayPending ? GATEWAY_WAIT_MILLIS : localPending ? LOCAL_WAIT_MILLIS : 0,
            ),
          );
      }
    } finally {
      clearTimeout(settle);
      clearTimeout(deadline);
      signal.removeEventListener("abort", onAbort);
      signal.removeEventListener("abort", stop);
      controller.abort();
    }
  }

  private async search(
    origin: PlanPlace,
    destination: PlanPlace,
    requested: number,
    ready: number,
    nationalStops: readonly Stop[],
    loadNetwork: (signal: AbortSignal) => Promise<LocalNetwork>,
    localProviders: ReadonlySet<string>,
    signal: AbortSignal,
    onCandidate: (plan: TripPlan, stage: Stage) => void,
  ): Promise<TripPlan> {
    const journeys: Itinerary[] = [];
    let partial = false,
      nationalSucceeded = false;
    const remoteRequests = new Map<string, Promise<Itinerary[]>>();
    const result = (): TripPlan => ({ itineraries: timelyChoices(journeys, ready), partial, requestedAt: requested, readyAt: ready });
    const emit = (stage: Stage) => {
      if (!signal.aborted) onCandidate(result(), stage);
    };
    // Share identical calls within this search, with no stale timetable/realtime cache between searches.
    const remote = (from: PlanPlace, to: PlanPlace, time: number, bus = false, plain = false) => {
      const key = `${walkKey(from.position, to.position)}:${time}:${bus}:${plain}`;
      let request = remoteRequests.get(key);
      if (!request) {
        request = (plain ? this.backend.plainRoutes(from, to, time, bus, signal) : this.backend.routes(from, to, time, bus, signal)).then(
          (rows) => {
            nationalSucceeded = true;
            return rows;
          },
          (error: unknown) => {
            if (signal.aborted) throw aborted();
            void error;
            partial = true;
            return [] as Itinerary[];
          },
        );
        remoteRequests.set(key, request);
      }
      return request;
    };
    const unavailable = () => new Error("Planning services unavailable");

    // The independent bus search prevents train-heavy source rankings from hiding Volán.
    const direct = Promise.all(
      [false, true].map((bus) =>
        remote(origin, destination, ready, bus).then((rows) => {
          journeys.push(...rows);
          emit("direct");
        }),
      ),
    );
    direct.catch(() => undefined);
    if (!localProviders.size) {
      emit("local");
      await direct;
      if (!nationalSucceeded) throw unavailable();
      return result();
    }
    let network: LocalNetwork | null = null;
    try {
      network = await loadNetwork(signal);
    } catch (error) {
      if (signal.aborted) throw aborted();
      void error;
      partial = true;
    }
    if (!network) {
      emit("local");
      await direct;
      if (!nationalSucceeded && !journeys.length) throw unavailable();
      return result();
    }
    const day = budapestDay(ready);
    const days = [day, addDays(day, 1)];
    const nearby = network.stops.filter(
      (stop) => Math.min(distance(stop.position, origin.position), distance(stop.position, destination.position)) <= ACCESS_METERS,
    );
    const needed = new Set(nearby.flatMap((stop) => stop.providerIds).filter((id) => localProviders.has(id)));
    const verified = network.verifiedProviderIds;
    if (
      [...needed].some(
        (provider) =>
          !isYearReviewed(Number(day.slice(0, 4))) ||
          day > "2026-12-31" ||
          (!verified.has(provider) && days.some((d) => providerCalendar(provider, d) !== null)),
      )
    )
      partial = true;
    const activeRoutes = network.routes.filter(
      (route) => localProviders.has(route.providerId) && verified.has(route.providerId) && days.some((d) => providerCalendar(route.providerId, d) !== null),
    );
    const active = new Set(activeRoutes.map((route) => route.id));
    const activeStops = network.stops.filter((stop) => stop.routeIds.some((id) => active.has(id)));
    const access = activeStops.filter((stop) => distance(stop.position, origin.position) <= ACCESS_METERS);
    const egress = activeStops.filter((stop) => distance(stop.position, destination.position) <= ACCESS_METERS);
    if (access.length || egress.length) emit("localStarted");
    else {
      emit("local");
      await direct;
      if (!nationalSucceeded) throw unavailable();
      return result();
    }

    // Only local components reachable at either endpoint need walking-transfer work.
    const relevant = connectedStops(activeStops, activeRoutes, [...access, ...egress]);
    const transferPairs = relevant.flatMap((a) =>
      relevant.filter((b) => a.id !== b.id && distance(a.position, b.position) <= TRANSFER_WALK_METERS).map((b) => [a, b] as const),
    );
    // Precise (BKK) walks are scarce: walks from the origin and to the destination come first, nearest first.
    const pairs: [PlanPlace, PlanPlace][] = [
      ...[
        ...access.map((stop) => [origin, stopPlace(stop)] as [PlanPlace, PlanPlace]),
        ...egress.map((stop) => [stopPlace(stop), destination] as [PlanPlace, PlanPlace]),
      ].sort((x, y) => distance(x[0].position, x[1].position) - distance(y[0].position, y[1].position)),
      ...transferPairs.map(([a, b]) => [stopPlace(a), stopPlace(b)] as [PlanPlace, PlanPlace]),
    ];
    let walking: WalkingResult;
    try {
      walking = await this.backend.walking(pairs, ready, signal);
    } catch (error) {
      if (signal.aborted) throw aborted();
      void error;
      walking = { links: new Map(), partial: true };
    }
    partial ||= walking.partial;
    // Walking services may return nothing for a (near) zero-length walk; such tiny walks are filled in directly.
    const link = (a: PlanPlace, b: PlanPlace): WalkingLink | null => {
      const known = walking.links.get(walkKey(a.position, b.position));
      if (known) return known;
      const meters = distance(a.position, b.position);
      return meters <= SAME_PLACE_METERS ? { from: a, to: b, seconds: Math.ceil(meters / WALK_SPEED), meters } : null;
    };
    const transferLinks = new Map<string, WalkingLink>();
    for (const [a, b] of transferPairs) {
      const walk = link(stopPlace(a), stopPlace(b));
      if (walk) transferLinks.set(transferKey(a.id, b.id), walk);
    }
    const egressLinks = new Map<string, WalkingLink>();
    for (const stop of egress) {
      const walk = link(stopPlace(stop), destination);
      if (walk) egressLinks.set(stop.id, walk);
    }
    const router = new LocalTimetableRouter(
      { ...network, verifiedProviderIds: new Set([...verified].filter((id) => localProviders.has(id))) },
      ready,
    );
    const seeds = access.flatMap((stop): LocalPath[] => {
      const walk = link(origin, stopPlace(stop));
      return walk ? [{ stopId: stop.id, arrival: ready + walk.seconds * 1000, legs: [walkingLeg(walk, ready)] }] : [];
    });
    const reached = router.search(seeds, transferLinks);
    journeys.push(...router.finish(reached, egressLinks));
    emit("gatewayStarted");

    // Local access/walking does not depend on either national search; join it only for stop references.
    await direct;

    // Preserve exact source identities: proximity selects a gateway, never merges its board.
    let indexed: Reference[] = nationalStops.filter((stop) => stop.id.startsWith("emma:")).map((stop) => ({ position: stop.position, mode: stop.mode }));
    if (!indexed.length) {
      // Planning must also work before the map's index has loaded.
      const bounds = {
        west: Math.min(...relevant.map((s) => s.position.lon)) - 0.006,
        south: Math.min(...relevant.map((s) => s.position.lat)) - 0.004,
        east: Math.max(...relevant.map((s) => s.position.lon)) + 0.006,
        north: Math.max(...relevant.map((s) => s.position.lat)) + 0.004,
      };
      try {
        indexed = (await this.backend.stops(bounds, signal)).map((stop) => ({ position: stop.position, mode: stop.mode }));
      } catch (error) {
        if (signal.aborted) throw aborted();
        void error;
        partial = true;
      }
    }
    const references: Reference[] = [
      ...indexed,
      ...journeys.flatMap((trip) =>
        rides(trip)
          .filter((leg) => !LOCAL_PROVIDERS.has(leg.provider ?? ""))
          .flatMap((leg) => [
            { position: leg.fromPosition, mode: leg.mode },
            { position: leg.toPosition, mode: leg.mode },
          ]),
      ),
    ];
    // A journey ending after the selector's absolute delay limit cannot enter the final three.
    const earliestEnd = journeys.length ? Math.min(...journeys.map((trip) => trip.end)) : null;
    const latestUsefulArrival = earliestEnd === null ? null : earliestEnd + LESS_WALK_MAX_DELAY_SECONDS * 1000;
    const useful = (path: LocalPath) => pathBoardings(path) > 0 && (latestUsefulArrival === null || path.arrival <= latestUsefulArrival);
    const usefulPaths = (stop: LocalStop) => (reached.get(stop.id) ?? []).filter(useful);
    const starts: { endpoint: PlanPlace; path: LocalPath | null }[] = [
      { endpoint: origin, path: null },
      ...gateways(
        relevant.filter((stop) => usefulPaths(stop).length > 0),
        references,
        destination.position,
        (stop) => Math.min(...usefulPaths(stop).map((path) => Math.floor((path.arrival - ready) / 1000))),
      ).map((stop) => ({
        endpoint: stopPlace(stop),
        path: usefulPaths(stop).reduce((a, b) => (b.arrival < a.arrival ? b : a)),
      })),
    ];
    const ends: { endpoint: PlanPlace; stop: LocalStop | null }[] = [
      { endpoint: destination, stop: null },
      ...gateways(connectedStops(activeStops, activeRoutes, egress), references, origin.position, (stop) => distance(stop.position, destination.position) / 5).map(
        (stop) => ({ endpoint: stopPlace(stop), stop }),
      ),
    ];
    await Promise.all(
      starts
        .flatMap((start) => ends.map((end) => [start, end] as const))
        .filter(([start, end]) => start.path !== null || end.stop !== null)
        .map(async ([start, end]) => {
          const prefix = start.path?.legs ?? [];
          // EMMA applies a 60s initial boarding allowance. Add the remaining 120s at a local/national boundary.
          const time = start.path ? start.path.arrival + (TRANSFER_SECONDS - BOARD_SECONDS) * 1000 : ready;
          const middle = await remote(start.endpoint, end.endpoint, time, false, true);
          for (const trip of middle) {
            const legs = [...prefix, ...trip.legs];
            if (end.stop === null) {
              const joined = itinerary(legs, ready);
              if (joined) journeys.push(joined);
            } else
              journeys.push(...router.finish(router.search([{ stopId: end.stop.id, arrival: trip.end, legs }], transferLinks), egressLinks));
          }
          emit("gateway");
        }),
    );
    if (!nationalSucceeded && !journeys.length) throw unavailable();
    return result();
  }
}

function gateways(stops: LocalStop[], references: Reference[], toward: GeoPoint, cost: (stop: LocalStop) => number): LocalStop[] {
  const candidates = stops
    .flatMap((stop) => {
      const nearby = references.filter(
        (ref) =>
          Math.abs(ref.position.lat - stop.position.lat) < 0.004 &&
          Math.abs(ref.position.lon - stop.position.lon) < 0.006 &&
          distance(ref.position, stop.position) <= GATEWAY_METERS,
      );
      // Real interchanges sit right next to a national stop; a rail interchange needs a platform close by.
      if (!nearby.length) return [];
      return [
        {
          stop,
          score: cost(stop) + distance(stop.position, toward) / 15 + Math.min(...nearby.map((ref) => distance(ref.position, stop.position))) / 2,
          rail: nearby.some((ref) => isRail(ref.mode) && distance(ref.position, stop.position) <= RAIL_GATEWAY_METERS),
        },
      ];
    })
    .sort((a, b) => a.score - b.score);
  const selected: LocalStop[] = [];
  // Rail and road interchanges both participate; nearby opposite platforms do not consume all slots.
  const preferred = [candidates[0], candidates.find((c) => c.rail), candidates.find((c) => !c.rail)].filter(
    (c): c is (typeof candidates)[number] => c !== undefined,
  );
  for (const candidate of [...preferred, ...candidates])
    if (selected.length < 3 && !selected.some((stop) => distance(stop.position, candidate.stop.position) < 120)) selected.push(candidate.stop);
  return selected;
}

function connectedStops(stops: LocalStop[], routes: LocalRoute[], seeds: LocalStop[]): LocalStop[] {
  const ids = new Set(seeds.map((stop) => stop.id));
  for (;;) {
    const count = ids.size;
    for (const route of routes)
      if (route.directions.some((direction) => direction.stopIds.some((id) => ids.has(id))))
        route.directions.forEach((direction) => direction.stopIds.forEach((id) => ids.add(id)));
    const reached = stops.filter((stop) => ids.has(stop.id));
    for (const stop of stops)
      if (!ids.has(stop.id) && reached.some((other) => distance(other.position, stop.position) <= TRANSFER_WALK_METERS)) ids.add(stop.id);
    if (count === ids.size) break;
  }
  return stops.filter((stop) => ids.has(stop.id));
}
