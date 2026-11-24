import type { Itinerary, Leg } from "../model";
import type { PlanPlace, WalkingLink } from "./backend";
import { addDays, budapestDay, providerCalendar, localInstant } from "./calendar";
import { BOARD_SECONDS, itinerary, seconds, TRANSFER_SECONDS, walkLeg } from "./core";
import type { LocalNetwork, LocalRoute, LocalStop, LocalTrip } from "./local-network";

/** Port of data/LocalTimetableRouter.kt: earliest arrival with a label per boarding count. */
export type LocalPath = { stopId: string; arrival: number; legs: Leg[] };
const boardings = (path: LocalPath) => path.legs.filter((leg) => leg.mode !== "WALK" && !leg.stayOnBoard).length;
const restricted = (path: LocalPath) => path.legs.some((leg) => leg.restricted === true);
const walkingDistance = (path: LocalPath) => path.legs.reduce((sum, leg) => sum + (leg.mode === "WALK" ? leg.distance : 0), 0);
export const pathBoardings = boardings;

export const stopPlace = (stop: LocalStop): PlanPlace => ({ id: stop.id, name: stop.name, position: stop.position });
export const walkingLeg = (link: WalkingLink, start: number) => walkLeg(link.from, link.to, start, link.seconds, link.meters);

const LOCAL_COLORS: Record<string, string> = { viabusz: "#205C48", kanyargo: "#6750A4", homm: "#BF5700" };

class Heap<T> {
  private items: T[] = [];
  constructor(private less: (a: T, b: T) => boolean) {}
  get size() {
    return this.items.length;
  }
  push(item: T) {
    const items = this.items;
    items.push(item);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(items[i]!, items[parent]!)) break;
      [items[i], items[parent]] = [items[parent]!, items[i]!];
      i = parent;
    }
  }
  pop(): T {
    const items = this.items;
    const top = items[0]!;
    const last = items.pop()!;
    if (items.length) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1,
          right = left + 1;
        let smallest = i;
        if (left < items.length && this.less(items[left]!, items[smallest]!)) smallest = left;
        if (right < items.length && this.less(items[right]!, items[smallest]!)) smallest = right;
        if (smallest === i) break;
        [items[i], items[smallest]] = [items[smallest]!, items[i]!];
        i = smallest;
      }
    }
    return top;
  }
}

type Boarding = { trip: LocalTrip; times: number[]; index: number };

export class LocalTimetableRouter {
  readonly stops: Map<string, LocalStop>;
  private routes: Map<string, LocalRoute>;
  private horizon: number;
  private boardings = new Map<string, Boarding[]>();

  constructor(
    private network: LocalNetwork,
    private ready: number,
  ) {
    this.stops = new Map(network.stops.map((stop) => [stop.id, stop]));
    this.routes = new Map(network.routes.map((route) => [route.id, route]));
    this.horizon = ready + 86_400_000;
    const day = budapestDay(ready);
    for (const date of [addDays(day, -1), day, addDays(day, 1)]) {
      for (const trip of network.trips) {
        const route = this.routes.get(trip.routeId);
        if (!route || !network.verifiedProviderIds.has(route.providerId) || trip.calendar !== providerCalendar(route.providerId, date)) continue;
        const times = trip.stopTimes.map((time) => localInstant(date, time.minuteOfDay));
        if (times.some((time) => time === null)) continue;
        const valid = times as number[];
        if (valid.some((time, i) => i > 0 && valid[i - 1]! > time) || valid.at(-1)! < ready || valid[0]! > this.horizon) continue;
        for (let index = 0; index < trip.stopTimes.length - 1; index++) {
          const stopId = trip.stopTimes[index]!.stopId;
          const list = this.boardings.get(stopId) ?? [];
          list.push({ trip, times: valid, index });
          this.boardings.set(stopId, list);
        }
      }
    }
    for (const list of this.boardings.values()) list.sort((a, b) => a.times[a.index]! - b.times[b.index]!);
  }

  search(seeds: LocalPath[], transfers: Map<string, WalkingLink>): Map<string, LocalPath[]> {
    const queue = new Heap<LocalPath>((a, b) => a.arrival < b.arrival || (a.arrival === b.arrival && boardings(a) < boardings(b)));
    const best = new Map<string, LocalPath>();
    const label = (stopId: string, count: number, limited: boolean) => `${stopId}\u0000${count}\u0000${limited}`;
    const walks = new Map<string, [string, WalkingLink][]>();
    for (const [key, link] of transfers) {
      const [from, to] = key.split("\u0001") as [string, string];
      walks.set(from, [...(walks.get(from) ?? []), [to, link]]);
    }
    // Compare cheap labels before allocating legs and intermediate stops for losing paths.
    const offer = (stopId: string, arrival: number, count: number, limited: boolean, distance: number, build: () => LocalPath) => {
      if (arrival > this.horizon || count > 5) return;
      const key = label(stopId, count, limited);
      const previous = best.get(key);
      if (previous && (previous.arrival < arrival || (previous.arrival === arrival && walkingDistance(previous) <= distance))) return;
      const path = build();
      best.set(key, path);
      queue.push(path);
    };
    for (const seed of seeds) offer(seed.stopId, seed.arrival, boardings(seed), restricted(seed), walkingDistance(seed), () => seed);
    while (queue.size) {
      const path = queue.pop();
      const count = boardings(path),
        limited = restricted(path);
      if (best.get(label(path.stopId, count, limited)) !== path) continue;
      for (const [to, walk] of walks.get(path.stopId) ?? []) {
        const arrival = path.arrival + walk.seconds * 1000;
        offer(to, arrival, count, limited, walkingDistance(path) + walk.meters, () => ({
          stopId: to,
          arrival,
          legs: [...path.legs, walkingLeg(walk, path.arrival)],
        }));
      }
      if (count >= 5) continue;
      const earliest = earliestBoarding(path);
      const departures = this.boardings.get(path.stopId) ?? [];
      let low = 0,
        high = departures.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (departures[mid]!.times[departures[mid]!.index]! < earliest) low = mid + 1;
        else high = mid;
      }
      for (let b = low; b < departures.length; b++) {
        const boarding = departures[b]!;
        const trip = boarding.trip;
        const route = this.routes.get(trip.routeId)!;
        const direction = route.directions.find((d) => d.id === trip.directionId)!;
        const from = this.stops.get(path.stopId)!;
        for (let index = boarding.index + 1; index < trip.stopTimes.length; index++) {
          const to = this.stops.get(trip.stopTimes[index]!.stopId)!;
          const arrival = boarding.times[index]!;
          offer(to.id, arrival, count + 1, limited || direction.restrictedService, walkingDistance(path), () => {
            const intermediate = trip.stopTimes.slice(boarding.index + 1, index).map((time) => this.stops.get(time.stopId)!);
            const ride: Leg = {
              routeId: route.id,
              provider: route.providerId,
              mode: "BUS",
              name: route.number,
              color: LOCAL_COLORS[route.providerId] ?? "#40576A",
              from: from.name,
              to: to.name,
              fromPosition: from.position,
              toPosition: to.position,
              headsign: direction.name,
              distance: 0,
              stayOnBoard: false,
              start: boarding.times[boarding.index]!,
              end: arrival,
              live: false,
              geometry: [from, ...intermediate, to].map((stop) => [stop.position.lon, stop.position.lat] as [number, number]),
              intermediate: intermediate.map((stop) => stop.name),
              restricted: direction.restrictedService,
            };
            return { stopId: to.id, arrival, legs: [...path.legs, ride] };
          });
        }
      }
    }
    const grouped = new Map<string, LocalPath[]>();
    for (const path of best.values()) grouped.set(path.stopId, [...(grouped.get(path.stopId) ?? []), path]);
    return grouped;
  }

  finish(paths: Map<string, LocalPath[]>, egress: Map<string, WalkingLink>): Itinerary[] {
    return [...egress].flatMap(([id, walk]) =>
      (paths.get(id) ?? []).flatMap((path) => {
        const trip = itinerary([...path.legs, walkingLeg(walk, path.arrival)], this.ready);
        return trip ? [trip] : [];
      }),
    );
  }
}

/** Transfer key for [LocalTimetableRouter.search]'s walking map. */
export const transferKey = (from: string, to: string) => `${from}\u0001${to}`;

function earliestBoarding(path: LocalPath) {
  let last = -1;
  for (let i = path.legs.length - 1; i >= 0; i--)
    if (path.legs[i]!.mode !== "WALK") {
      last = i;
      break;
    }
  if (last < 0) return path.arrival + BOARD_SECONDS * 1000;
  let walked = 0;
  for (let i = last + 1; i < path.legs.length; i++) walked += seconds(path.legs[i]!.start, path.legs[i]!.end);
  return Math.max(path.arrival, path.legs[last]!.end + (walked + TRANSFER_SECONDS) * 1000);
}
