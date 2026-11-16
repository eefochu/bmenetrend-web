import { distanceMeters, type GeoPoint } from "~/lib/places";
import { planHeadroom, planTrip, type PlanEndpoint } from "./client";
import { emmaQuery, railNumber } from "./emma";
import { EMMA_QUERIES } from "./emma-contract";
import { array, color, number, object, string, type Itinerary, type Leg, type Row } from "./model";

/**
 * Port of Android's planner path: BkkFirstPlannerBackend (which planner to ask, and when), TripPlanner
 * (EMMA's national planner, ordering, feasibility) and PlannerAlternatives (which journeys become cards).
 */

const BKK_TIMEOUT = 5_000;
const WALK_AVERSE_TIMEOUT = 4_000;
const LONG_WALK_SECONDS = 600;
const EGRESS_WALK_SECONDS = 480;
const TRANSFER_SECONDS = 180;
const MIN_WALK_SAVED_SECONDS = 240;
const MAX_CONNECTIONS = 2;
const RESERVED_PLANS = 4;
const MAX_BOARDING_WAIT_SECONDS = 3600;

export type PlanOutcome = {
  itineraries: Itinerary[];
  /** Some source failed or returned journeys the app could not represent (planner_partial). */
  partial: boolean;
  requestedAt: number;
  readyAt: number;
};

const walking = (leg: Leg) => leg.mode === "WALK";
const seconds = (from: number, to: number) => Math.round((to - from) / 1000);
export const walkSeconds = (trip: Itinerary) =>
  trip.legs.filter(walking).reduce((sum, leg) => sum + seconds(leg.start, leg.end), 0);
export const transfers = (trip: Itinerary) =>
  Math.max(0, trip.legs.filter((leg) => !walking(leg) && !leg.stayOnBoard).length - 1);
const walkMeters = (trip: Itinerary) =>
  trip.legs.filter(walking).reduce((sum, leg) => sum + leg.distance, 0);

/** TripItinerary.travelLegs: movement only, consecutive walks joined. */
export function travelLegs(trip: Itinerary): Leg[] {
  const result: Leg[] = [];
  for (const leg of trip.legs) {
    if (leg.end <= leg.start) continue;
    const previous = result.at(-1);
    if (walking(leg) && previous && walking(previous) && previous.end === leg.start)
      result[result.length - 1] = {
        ...previous,
        end: leg.end,
        distance: previous.distance + leg.distance,
        to: leg.to,
        toPosition: leg.toPosition,
        geometry: [...previous.geometry, ...leg.geometry],
      };
    else result.push(leg);
  }
  return result;
}

/** TripPlanner.order */
function order(a: Itinerary, b: Itinerary) {
  return (
    a.end - b.end ||
    walkSeconds(a) - walkSeconds(b) ||
    transfers(a) - transfers(b) ||
    walkMeters(a) - walkMeters(b) ||
    a.end - a.start - (b.end - b.start) ||
    a.id.localeCompare(b.id)
  );
}

/** TripPlanner.feasible, for router-made journeys: start after ready, at most five rides, no overlaps. */
function feasible(trip: Itinerary, ready: number) {
  const legs = trip.legs;
  if (!legs.length || legs[0]!.start < ready - 1000) return false;
  if (legs.filter((leg) => !walking(leg) && !leg.stayOnBoard).length > 5) return false;
  if (legs.some((leg, index) => index > 0 && leg.start < legs[index - 1]!.end)) return false;
  return !legs.some((leg, index) => leg.stayOnBoard && !legs.slice(0, index).some((l) => !walking(l)));
}

/** TripPlanner.timelyChoices: no leg waits more than an hour to board. */
function timely(trip: Itinerary, ready: number) {
  let arrived = ready;
  return trip.legs.every((leg) => {
    const ok = leg.stayOnBoard || seconds(arrived, leg.start) <= MAX_BOARDING_WAIT_SECONDS;
    arrived = leg.end;
    return ok;
  });
}

const near = (a?: GeoPoint, b?: GeoPoint) => !a || !b || distanceMeters(a, b) <= 200;
const rides = (trip: Itinerary) => trip.legs.filter((leg) => !walking(leg));
const provider = (leg: Leg) =>
  /^(volan|emma:hkir:)/.test(leg.routeId ?? "")
    ? "volan"
    : ["RAIL", "SUBURBAN_RAILWAY", "TRAMTRAIN"].includes(leg.mode) || (leg.routeId ?? "").startsWith("emma:1:")
      ? "rail"
      : "bkk";

function equivalent(a: Itinerary, b: Itinerary) {
  if (
    transfers(a) !== transfers(b) ||
    Math.abs(walkMeters(a) - walkMeters(b)) > 200 ||
    Math.abs(walkSeconds(a) - walkSeconds(b)) > 180
  )
    return false;
  const first = rides(a),
    second = rides(b);
  if (first.length !== second.length) return false;
  return first.every((x, i) => {
    const y = second[i]!;
    return (
      provider(x) === provider(y) &&
      x.name === y.name &&
      x.mode === y.mode &&
      x.stayOnBoard === y.stayOnBoard &&
      near(x.fromPosition, y.fromPosition) &&
      near(x.toPosition, y.toPosition)
    );
  });
}

function sameRide(a: Itinerary, b: Itinerary) {
  const first = rides(a),
    second = rides(b);
  if (!first.length || first.length !== second.length) return false;
  return first.every((x, i) => {
    const y = second[i]!;
    return (
      provider(x) === provider(y) &&
      x.name === y.name &&
      x.mode === y.mode &&
      Math.abs(seconds(x.start, y.start)) <= 120 &&
      near(x.fromPosition, y.fromPosition)
    );
  });
}

const walkPenalty = (walk: number) => walk * 2 + Math.max(0, walk - LONG_WALK_SECONDS) * 2;
const walkRelief = (fastest: Itinerary, trip: Itinerary) =>
  Math.max(0, walkPenalty(walkSeconds(fastest)) - walkPenalty(walkSeconds(trip)));
function inconvenience(trip: Itinerary, ready: number) {
  return (
    seconds(Math.min(ready, trip.start), trip.end) +
    walkPenalty(walkSeconds(trip)) +
    transfers(trip) * 300 +
    trip.legs
      .filter((leg) => !walking(leg) && !leg.stayOnBoard)
      .reduce((sum, leg) => sum + (leg.mode === "RAIL" ? 180 : leg.mode === "COACH" ? 60 : 0), 0)
  );
}
const families = (trip: Itinerary) => [...new Set(rides(trip).map(provider))];
const noBetter = (trip: Itinerary, by: Itinerary) =>
  by.end <= trip.end && walkSeconds(by) <= walkSeconds(trip) + 30 && transfers(by) <= transfers(trip);
const outclassed = (trip: Itinerary, by: Itinerary) => noBetter(trip, by) && by.end + 300_000 <= trip.end;
const strictlyWorse = (trip: Itinerary, by: Itinerary) =>
  noBetter(trip, by) && (transfers(by) < transfers(trip) || walkSeconds(by) + 60 <= walkSeconds(trip));

/** PlannerAlternatives.select: the recommendation and at most two genuinely useful backups. */
export function selectJourneys(journeys: Itinerary[], ready: number): Itinerary[] {
  const sorted = [...new Map(journeys.map((trip) => [trip.id, trip])).values()].sort(order);
  const distinct: Itinerary[] = [];
  for (const trip of sorted) if (!distinct.some((other) => equivalent(other, trip))) distinct.push(trip);
  if (!distinct.length) return [];
  const practical = (a: Itinerary, b: Itinerary) =>
    inconvenience(a, ready) - inconvenience(b, ready) ||
    transfers(a) - transfers(b) ||
    walkSeconds(a) - walkSeconds(b) ||
    order(a, b);
  const walkLimit = Math.max(900, Math.min(...distinct.map(walkSeconds)) + 600);
  const candidates: Itinerary[] = [];
  for (const trip of distinct.filter((trip) => walkSeconds(trip) <= walkLimit).sort(practical))
    if (!candidates.some((other) => sameRide(other, trip))) candidates.push(trip);
  const fastest = [...candidates].sort(order)[0]!;
  const elapsed = Math.max(0, seconds(ready, fastest.end));
  const recommendationDelay = Math.min(600, Math.max(300, Math.floor(elapsed / 4)));
  const alternativeDelay = Math.min(1200, Math.max(900, Math.floor(elapsed / 3)));
  const recommended = candidates
    .filter(
      (trip) =>
        trip.end <=
        fastest.end + Math.max(recommendationDelay, Math.min(2700, walkRelief(fastest, trip))) * 1000,
    )
    .sort(practical)[0]!;
  const backups = candidates
    .filter(
      (trip) =>
        trip.id !== recommended.id &&
        trip.end <= fastest.end + Math.max(alternativeDelay, Math.min(2700, walkRelief(fastest, trip))) * 1000,
    )
    .sort(practical);
  const shown = [recommended];
  const lessWalk = [...backups].sort((a, b) => walkSeconds(a) - walkSeconds(b) || practical(a, b))[0];
  if (lessWalk && walkSeconds(lessWalk) + 120 <= walkSeconds(recommended)) shown.push(lessWalk);
  const byFamily = new Map<string, Itinerary>();
  for (const trip of backups) {
    const family = families(trip)[0];
    if (family && !byFamily.has(family)) byFamily.set(family, trip);
  }
  for (const trip of [...byFamily.values()].sort(practical)) {
    const shownFamilies = new Set(shown.flatMap(families));
    if (shown.length < 3 && !shown.some((s) => s.id === trip.id) && families(trip).some((f) => !shownFamilies.has(f)))
      shown.push(trip);
  }
  for (const trip of backups) {
    if (shown.length >= 3) break;
    if (shown.some((s) => s.id === trip.id) || shown.some((s) => strictlyWorse(trip, s))) continue;
    if (shown.length === 1 || !shown.some((s) => outclassed(trip, s))) shown.push(trip);
  }
  return [recommended, ...shown.slice(1).sort(practical)];
}

/** Same vehicles at the same minutes are one itinerary whichever planner found it. */
const signature = (trip: Itinerary) =>
  rides(trip)
    .map((leg) => `${leg.mode}:${leg.name}:${Math.floor(leg.start / 60_000)}`)
    .join("|");
function combine(primary: Itinerary[], secondary: Itinerary[]) {
  if (!primary.length) return secondary;
  const known = new Set(primary.map(signature));
  return [...primary, ...secondary.filter((trip) => !known.has(signature(trip)))];
}

function budapestParts(at: number) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Budapest",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
}

const PLAN_MODES = new Set([
  "WALK", "BUS", "COACH", "TRAM", "TROLLEYBUS", "SUBWAY", "RAIL", "SUBURBAN_RAILWAY", "TRAMTRAIN", "FERRY", "CABLE_CAR", "FUNICULAR",
]);
const MARKUP = /<[^>]+>|&(?:#\w+|\w+);|[-]/;
const point = (row: Row): GeoPoint | undefined => {
  const lat = number(row.lat),
    lon = number(row.lon);
  return lat && lon ? { lat, lon } : undefined;
};

/** TripPlanner.parse: EMMA plan rows the app can represent; anything else is dropped (and reported). */
function parseEmmaPlan(data: Row, ready: number) {
  let rejected = 0;
  const itineraries = array(object(data.plan).itineraries).flatMap((value): Itinerary[] => {
    try {
      const row = object(value);
      const rows = array(row.legs);
      if (rows.length < 1 || rows.length > 40) throw new Error("legs");
      const legs = rows.map((value): Leg => {
        const leg = object(value),
          mode = string(leg.mode),
          start = number(leg.startTime),
          end = number(leg.endTime),
          distance = number(leg.distance);
        if (!PLAN_MODES.has(mode) || !start || end < start || distance < 0) throw new Error("leg");
        if (mode === "WALK" && seconds(start, end) + 10 < distance / 2.2) throw new Error("walk");
        const route = object(leg.route),
          trip = object(leg.trip),
          from = object(leg.from),
          to = object(leg.to);
        const routeId = string(route.gtfsId);
        if (mode !== "WALK" && !routeId) throw new Error("route");
        const short = string(route.shortName),
          long = string(route.longName);
        const name =
          mode === "WALK"
            ? ""
            : ["RAIL", "TRAMTRAIN"].includes(mode)
              ? railNumber(short, long)
              : short && !MARKUP.test(short)
                ? short
                : long || mode;
        const stops = array(leg.intermediateStops).map(object);
        const fromPosition = point(from),
          toPosition = point(to);
        return {
          // The app's EMMA identities (`emma:hkir:…` Volán, `emma:1:…` MÁV), so badges use operator colours.
          routeId: routeId ? `emma:${routeId}` : undefined,
          mode,
          name,
          color: color(route.color, mode === "RAIL" ? "#0066aa" : "#199dcf"),
          from: string(from.name),
          to: string(to.name),
          fromPosition,
          toPosition,
          fromPlatform: string(object(from.stop).platformCode) || undefined,
          toPlatform: string(object(to.stop).platformCode) || undefined,
          headsign: string(trip.tripHeadsign) || undefined,
          distance,
          stayOnBoard: leg.interlineWithPreviousLeg === true,
          start,
          end,
          live: leg.realTime === true,
          geometry: [fromPosition, ...stops.map(point), toPosition].flatMap((p) =>
            p ? [[p.lon, p.lat] as [number, number]] : [],
          ),
          intermediate: stops.map((stop) => string(stop.name)),
          source: "EMMA",
        };
      });
      const trip: Itinerary = {
        id: legs.map((leg) => `${leg.routeId ?? leg.mode}:${leg.start}:${leg.from}:${leg.to}`).join("|"),
        start: legs[0]!.start,
        end: legs.at(-1)!.end,
        walkMeters: 0,
        legs,
      };
      if (!feasible(trip, ready)) throw new Error("feasible");
      if (number(row.startTime) !== trip.start || number(row.endTime) !== trip.end) throw new Error("times");
      trip.walkMeters = walkMeters(trip);
      return [trip];
    } catch {
      rejected++;
      return [];
    }
  });
  return { itineraries: itineraries.sort(order).slice(0, 12), rejected };
}

async function emmaPlan(
  from: PlanEndpoint,
  to: PlanEndpoint,
  ready: number,
  avoidWalking: boolean,
  signal: AbortSignal,
) {
  const parts = budapestParts(ready);
  const result = await emmaQuery(
    avoidWalking ? EMMA_QUERIES.planWalkAverse : EMMA_QUERIES.plan,
    {
      from: `${from.position.lat.toFixed(6)},${from.position.lon.toFixed(6)}`,
      to: `${to.position.lat.toFixed(6)},${to.position.lon.toFixed(6)}`,
      date: `${parts.year}-${parts.month}-${parts.day}`,
      time: `${parts.hour}:${parts.minute}:${parts.second}`,
    },
    15_000,
    signal,
  );
  return parseEmmaPlan(result.data, ready);
}

/** Runs [task] with its own signal, aborted after [ms] or with the parent; null on timeout or failure. */
async function bounded<T>(ms: number, signal: AbortSignal, task: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  signal.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(stop, ms);
  try {
    return await task(controller.signal);
  } catch {
    if (signal.aborted) throw new DOMException("Megszakítva", "AbortError");
    return null;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
  }
}

/** BkkFirstPlannerBackend.connectingRides: wait at the last stop for a connection instead of a long final walk. */
async function connectingRides(rows: Itinerary[], to: PlanEndpoint, ready: number, signal: AbortSignal) {
  if (planHeadroom() <= RESERVED_PLANS) return [];
  const finalWalk = (trip: Itinerary) => {
    if (!rides(trip).length) return 0;
    let total = 0;
    for (let i = trip.legs.length - 1; i >= 0 && walking(trip.legs[i]!); i--)
      total += seconds(trip.legs[i]!.start, trip.legs[i]!.end);
    return total;
  };
  const seen = new Set<string>();
  const targets = rows
    .filter((trip) => finalWalk(trip) >= EGRESS_WALK_SECONDS)
    .sort((a, b) => a.end - b.end)
    .filter((trip) => {
      const last = rides(trip).at(-1)!;
      const key = `${last.toPosition?.lat},${last.toPosition?.lon}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return Boolean(last.toPosition);
    })
    .slice(0, MAX_CONNECTIONS);
  const spliced = await Promise.all(
    targets.map(async (trip) => {
      const lastRide = rides(trip).at(-1)!;
      const connectFrom = lastRide.end + TRANSFER_SECONDS * 1000;
      const tails = await bounded(WALK_AVERSE_TIMEOUT, signal, (inner) =>
        planTrip({ name: lastRide.to, position: lastRide.toPosition! }, to, new Date(connectFrom), inner),
      );
      const walked = finalWalk(trip);
      const prefix = trip.legs.slice(0, trip.legs.lastIndexOf(lastRide) + 1);
      return (tails?.value ?? [])
        .filter(
          (tail) =>
            rides(tail).length > 0 &&
            tail.start >= lastRide.end &&
            rides(tail)[0]!.start >= connectFrom &&
            walkSeconds(tail) + MIN_WALK_SAVED_SECONDS <= walked,
        )
        .map((tail): Itinerary => {
          const legs = [...prefix, ...tail.legs];
          return { id: `${trip.id}+${tail.id}`, start: trip.start, end: tail.end, walkMeters: 0, legs };
        })
        .filter((joined) => feasible(joined, ready))
        .map((joined) => ({ ...joined, walkMeters: walkMeters(joined) }));
    }),
  );
  return spliced.flat();
}

/**
 * BkkFirstPlannerBackend.routes: BKK first (5 s); a healthy non-empty answer is used at once, improved by
 * a bounded walk-averse EMMA search and connecting rides when it walks far. EMMA's national planner is
 * asked when BKK fails, times out, is over budget, has nothing, or offered journeys the app could not
 * represent; when EMMA is down, BKK's usable journeys are still a (partial) answer.
 */
export async function planJourney(
  from: PlanEndpoint,
  to: PlanEndpoint,
  at: Date,
  signal: AbortSignal,
): Promise<PlanOutcome> {
  const requestedAt = Date.now();
  const ready = Math.max(at.getTime(), requestedAt - 60_000);
  const choose = (rows: Itinerary[]) =>
    selectJourneys(
      rows.filter((trip) => feasible(trip, ready) && timely(trip, ready)),
      ready,
    );
  const primary = await bounded(BKK_TIMEOUT, signal, (inner) => planTrip(from, to, new Date(ready), inner));
  if (primary && primary.value.length > 0 && !primary.incomplete) {
    const rows = primary.value;
    const [averse, connected] = await Promise.all([
      Math.min(...rows.map(walkSeconds)) >= LONG_WALK_SECONDS
        ? bounded(WALK_AVERSE_TIMEOUT, signal, (inner) => emmaPlan(from, to, ready, true, inner))
        : null,
      connectingRides(rows, to, ready, signal),
    ]);
    return {
      itineraries: choose(combine(combine(rows, connected), averse?.itineraries ?? [])),
      partial: false,
      requestedAt,
      readyAt: ready,
    };
  }
  const supplied = primary?.value ?? [];
  let national;
  try {
    national = await emmaPlan(from, to, ready, false, signal);
  } catch (error) {
    if (signal.aborted || !supplied.length) throw error;
    // EMMA is down: BKK's usable itineraries are still a real (partial) answer.
    return { itineraries: choose(supplied), partial: true, requestedAt, readyAt: ready };
  }
  return {
    itineraries: choose(combine(supplied, national.itineraries)),
    partial: !primary || Boolean(primary.incomplete) || national.rejected > 0,
    requestedAt,
    readyAt: ready,
  };
}
