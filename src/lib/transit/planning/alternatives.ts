import { distanceMeters, type GeoPoint } from "~/lib/places";
import type { Itinerary } from "../model";
import { order, rides, seconds, totalSeconds, transfers, walkMeters, walkSeconds } from "./core";

/** Port of data/PlannerAlternatives.kt: presentation selection only; every operator still participates in routing. */
export const MAX_ARRIVAL_DELAY_SECONDS = 1200;
/** Extra waiting seconds a rider accepts to avoid one second of walking. */
export const WAIT_PER_WALK = 2;
/** At most this many route cards: the recommendation and two useful backups. */
export const MAX_CHOICES = 3;
/** A journey walking at least this long triggers the walk-averse search. */
export const LONG_WALK_SECONDS = 600;
export const WALK_AVERSE_TIMEOUT_MILLIS = 4_000;
/** Latest a ride that spares walking may arrive after the fastest journey. */
export const LESS_WALK_MAX_DELAY_SECONDS = 2700;
/** A trip whose last step is a walk of at least this long may be improved by a connecting ride. */
export const EGRESS_WALK_SECONDS = 480;
const LESS_WALK_SECONDS = 120;
const OUTCLASSED_DELAY_SECONDS = 300;
const LOCAL_PROVIDERS = new Set(["viabusz", "kanyargo", "homm"]);
const LONG_WALK_EXTRA = 2;
const SENSIBLE_WALK_SECONDS = 900;
const EXTRA_WALK_SECONDS = 600;
const SAME_RIDE_SECONDS = 120;

const restricted = (trip: Itinerary) => trip.legs.some((leg) => leg.restricted === true);
const near = (a: GeoPoint, b: GeoPoint) => distanceMeters(a, b) <= 200;
const coerce = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Kinds of service a journey rides, in boarding order; empty for walking only. */
export function families(trip: Itinerary): string[] {
  return [
    ...new Set(
      rides(trip).map((leg) => {
        const provider = leg.provider;
        if (provider && LOCAL_PROVIDERS.has(provider)) return "local";
        if (provider === "volan") return "volan";
        if (provider === "mav" || provider === "hev" || leg.mode === "RAIL" || leg.mode === "SUBURBAN_RAILWAY") return "rail";
        return provider ?? leg.mode;
      }),
    ),
  ];
}

/** [by] arrives no later, walks no more (30 s tolerance), changes no more and is not less accessible. */
const noBetter = (trip: Itinerary, by: Itinerary) =>
  by.end <= trip.end &&
  walkSeconds(by) <= walkSeconds(trip) + 30 &&
  transfers(by) <= transfers(trip) &&
  (restricted(trip) || !restricted(by));
const outclassed = (trip: Itinerary, by: Itinerary) => noBetter(trip, by) && by.end + OUTCLASSED_DELAY_SECONDS * 1000 <= trip.end;
const strictlyWorse = (trip: Itinerary, by: Itinerary) =>
  noBetter(trip, by) && (transfers(by) < transfers(trip) || walkSeconds(by) + 60 <= walkSeconds(trip));

export const walkPenalty = (walk: number) => walk * WAIT_PER_WALK + Math.max(0, walk - LONG_WALK_SECONDS) * LONG_WALK_EXTRA;
const walkRelief = (fastest: Itinerary, trip: Itinerary) =>
  Math.max(0, walkPenalty(walkSeconds(fastest)) - walkPenalty(walkSeconds(trip)));

function sameRide(a: Itinerary, b: Itinerary) {
  const first = rides(a),
    second = rides(b);
  if (!first.length || first.length !== second.length) return false;
  return first.every((x, i) => {
    const y = second[i]!;
    return (
      x.provider === y.provider &&
      x.name === y.name &&
      x.mode === y.mode &&
      Math.abs(seconds(x.start, y.start)) <= SAME_RIDE_SECONDS &&
      near(x.fromPosition, y.fromPosition)
    );
  });
}

function equivalent(a: Itinerary, b: Itinerary) {
  if (
    restricted(a) !== restricted(b) ||
    transfers(a) !== transfers(b) ||
    Math.abs(walkMeters(a) - walkMeters(b)) > 200 ||
    Math.abs(walkSeconds(a) - walkSeconds(b)) > 180
  )
    return false;
  const first = rides(a),
    second = rides(b);
  if (first.length !== second.length) return false;
  // Walking-only suggestions share the same requested endpoints.
  if (!first.length) return true;
  return first.every((x, i) => {
    const y = second[i]!;
    return (
      x.provider === y.provider &&
      x.name === y.name &&
      x.mode === y.mode &&
      x.stayOnBoard === y.stayOnBoard &&
      near(x.fromPosition, y.fromPosition) &&
      near(x.toPosition, y.toPosition)
    );
  });
}

/** Ranking cost only, never added to the displayed timetable or walking duration. */
function inconvenience(trip: Itinerary, ready: number) {
  return (
    totalSeconds(trip, ready) +
    walkPenalty(walkSeconds(trip)) +
    transfers(trip) * 300 +
    trip.legs
      .filter((leg) => leg.mode !== "WALK" && !leg.stayOnBoard)
      .reduce((sum, leg) => sum + (leg.mode === "RAIL" ? 180 : leg.mode === "COACH" ? 60 : 0), 0)
  );
}

const minWith = <T,>(items: readonly T[], compare: (a: T, b: T) => number): T | undefined =>
  items.reduce<T | undefined>((best, item) => (best === undefined || compare(item, best) < 0 ? item : best), undefined);

/** PlannerAlternatives.select: the recommendation and at most two genuinely useful backups. */
export function select(journeys: readonly Itinerary[], ready?: number): Itinerary[] {
  const sorted = [...new Map(journeys.map((trip) => [trip.id, trip])).values()].sort(order);
  const distinct: Itinerary[] = [];
  for (const trip of sorted) if (!distinct.some((other) => equivalent(other, trip))) distinct.push(trip);
  // Public services take precedence over trips requiring registration the app cannot confirm.
  const publicTrips = distinct.filter((trip) => !restricted(trip));
  const usable = publicTrips.length ? publicTrips : distinct;
  if (!usable.length) return [];
  const baseline = ready ?? Math.min(...sorted.map((trip) => trip.start));
  const practical = (a: Itinerary, b: Itinerary) =>
    inconvenience(a, baseline) - inconvenience(b, baseline) ||
    transfers(a) - transfers(b) ||
    walkSeconds(a) - walkSeconds(b) ||
    order(a, b);
  const walkLimit = Math.max(SENSIBLE_WALK_SECONDS, Math.min(...usable.map(walkSeconds)) + EXTRA_WALK_SECONDS);
  const candidates: Itinerary[] = [];
  for (const trip of usable.filter((trip) => walkSeconds(trip) <= walkLimit).sort(practical))
    if (!candidates.some((other) => sameRide(other, trip))) candidates.push(trip);
  const fastest = minWith(candidates, order)!;
  const elapsed = Math.max(0, seconds(baseline, fastest.end));
  const recommendationDelay = coerce(Math.trunc(elapsed / 4), 300, 600);
  const alternativeDelay = coerce(Math.trunc(elapsed / 3), 900, MAX_ARRIVAL_DELAY_SECONDS);
  const recommended = minWith(
    candidates.filter(
      (trip) =>
        trip.end <=
        fastest.end + Math.max(recommendationDelay, Math.min(LESS_WALK_MAX_DELAY_SECONDS, walkRelief(fastest, trip))) * 1000,
    ),
    practical,
  )!;
  const backups = candidates
    .filter(
      (trip) =>
        trip.id !== recommended.id &&
        trip.end <=
          fastest.end + Math.max(alternativeDelay, Math.min(LESS_WALK_MAX_DELAY_SECONDS, walkRelief(fastest, trip))) * 1000,
    )
    .sort(practical);
  const shown = [recommended];
  // Reserve a slot for "wait for a ride instead of walking" when it really spares walking.
  const lessWalk = minWith(backups, (a, b) => walkSeconds(a) - walkSeconds(b) || practical(a, b));
  if (lessWalk && walkSeconds(lessWalk) + LESS_WALK_SECONDS <= walkSeconds(recommended)) shown.push(lessWalk);
  // Offer variety: the best viable Volán, local, BKK or rail journey each get a card when their kind is not shown yet.
  const groups = new Map<string, Itinerary[]>();
  for (const trip of backups) {
    const family = families(trip)[0];
    if (family === undefined) continue;
    groups.set(family, [...(groups.get(family) ?? []), trip]);
  }
  for (const trip of [...groups.values()].map((group) => minWith(group, practical)!).sort(practical)) {
    const shownFamilies = new Set(shown.flatMap(families));
    if (shown.length < MAX_CHOICES && !shown.some((s) => s.id === trip.id) && families(trip).some((f) => !shownFamilies.has(f)))
      shown.push(trip);
  }
  for (const trip of backups) {
    if (shown.length >= MAX_CHOICES) break;
    if (shown.some((s) => s.id === trip.id)) continue;
    // Never show a card that is no faster and strictly worse (an extra change or more walking).
    if (shown.some((s) => strictlyWorse(trip, s))) continue;
    // The first backup is the next-best route; further cards must offer something the shown ones do not.
    if (shown.length === 1 || !shown.some((s) => outclassed(trip, s))) shown.push(trip);
  }
  // Never pad: a slot stays empty when no remaining journey is a useful choice.
  return [recommended, ...shown.slice(1).sort(practical)];
}

/** Seconds of the final walk after the last ride; 0 when the trip ends on a vehicle or walks only. */
export function finalWalkSeconds(trip: Itinerary) {
  if (!rides(trip).length) return 0;
  let total = 0;
  for (let i = trip.legs.length - 1; i >= 0 && trip.legs[i]!.mode === "WALK"; i--)
    total += seconds(trip.legs[i]!.start, trip.legs[i]!.end);
  return total;
}

/** True when a planner may still improve these trips with a slower, walk-sparing search. */
export const mayImprove = (trips: readonly Itinerary[]) =>
  trips.length > 0 &&
  (Math.min(...trips.map(walkSeconds)) >= LONG_WALK_SECONDS || trips.some((trip) => finalWalkSeconds(trip) >= EGRESS_WALK_SECONDS));
