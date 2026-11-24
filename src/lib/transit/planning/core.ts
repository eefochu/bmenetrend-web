import { distanceMeters, type GeoPoint } from "~/lib/places";
import type { Itinerary, Leg } from "../model";

/**
 * Port of data/TripPlanner.kt (journey metrics, feasibility, ordering) and the TripItinerary helpers.
 * Times are epoch milliseconds; durations are whole seconds like java.time.Duration.getSeconds().
 */
export const WALK_SPEED = 1.15;
export const BOARD_SECONDS = 60;
export const TRANSFER_SECONDS = 180;
const MAX_BOARDING_WAIT_SECONDS = 60 * 60;

export const ZONE = "Europe/Budapest";

export const walking = (leg: Leg) => leg.mode === "WALK";
/** Duration.between(a, b).seconds */
export const seconds = (from: number, to: number) => Math.floor((to - from) / 1000);
export const walkSeconds = (trip: Itinerary) =>
  trip.legs.reduce((sum, leg) => sum + (walking(leg) ? seconds(leg.start, leg.end) : 0), 0);
export const walkMeters = (trip: Itinerary) =>
  trip.legs.reduce((sum, leg) => sum + (walking(leg) ? leg.distance : 0), 0);
export const transfers = (trip: Itinerary) =>
  Math.max(0, trip.legs.filter((leg) => !walking(leg) && !leg.stayOnBoard).length - 1);
export const durationSeconds = (trip: Itinerary) => seconds(trip.start, trip.end);
/** Door-to-door time from the chosen departure, including the initial wait. */
export const totalSeconds = (trip: Itinerary, ready: number) => seconds(Math.min(ready, trip.start), trip.end);
export const rides = (trip: Itinerary) => trip.legs.filter((leg) => !walking(leg));

export const supported = (p: GeoPoint) =>
  Number.isFinite(p.lat) && Number.isFinite(p.lon) && p.lat >= 45.7 && p.lat <= 48.6 && p.lon >= 16.1 && p.lon <= 22.9;

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
        toPlatform: leg.toPlatform,
        intermediate: [...previous.intermediate, ...leg.intermediate],
        geometry: [...previous.geometry, ...leg.geometry],
        routerJourney: undefined,
        routerPrevious: undefined,
      };
    else result.push(leg);
  }
  return result;
}

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** TripPlanner.order */
export function order(a: Itinerary, b: Itinerary) {
  return (
    a.end - b.end ||
    walkSeconds(a) - walkSeconds(b) ||
    transfers(a) - transfers(b) ||
    walkMeters(a) - walkMeters(b) ||
    durationSeconds(a) - durationSeconds(b) ||
    compareText(a.id, b.id)
  );
}

export function routerLegKey(leg: Leg) {
  return [leg.mode, leg.start, leg.end, leg.fromPosition.lat, leg.fromPosition.lon, leg.toPosition.lat, leg.toPosition.lon].join(":");
}

function routerLink(previous: Leg | undefined, next: Leg) {
  if (
    previous?.source !== "BKK API" ||
    next.source !== "BKK API" ||
    !next.routerJourney ||
    next.routerJourney !== previous.routerJourney ||
    next.routerPrevious !== routerLegKey(previous)
  )
    return false;
  const gap = seconds(previous.end, next.start);
  // A claimed direct router connection still cannot jump between distant points.
  return gap >= 0 && distanceMeters(previous.toPosition, next.fromPosition) <= 20 + gap * 2.2;
}

/** TripPlanner.feasible: verify source times; never move a leg or invent a connection to make it fit. */
export function feasible(legs: readonly Leg[], ready: number): boolean {
  if (!legs.length || legs[0]!.start < ready - 1000) return false;
  if (legs.filter((leg) => !walking(leg) && !leg.stayOnBoard).length > 5) return false;
  for (let i = 1; i < legs.length; i++) if (legs[i]!.start < legs[i - 1]!.end) return false;
  let previousTransit: Leg | undefined;
  let walkingSinceTransit = 0;
  let previousLeg: Leg | undefined;
  let routerChainSinceTransit = false;
  for (const leg of legs) {
    const link = routerLink(previousLeg, leg);
    if (walking(leg)) {
      if (previousTransit) {
        walkingSinceTransit += seconds(leg.start, leg.end);
        routerChainSinceTransit = routerChainSinceTransit && link;
      }
    } else {
      if (leg.stayOnBoard && !previousTransit) return false;
      if (!leg.stayOnBoard) {
        if (
          previousTransit &&
          seconds(previousTransit.end, leg.start) < walkingSinceTransit + TRANSFER_SECONDS &&
          !(routerChainSinceTransit && link)
        )
          return false;
        if (!previousTransit) {
          const precedingWalk = previousLeg && walking(previousLeg) ? previousLeg : undefined;
          const arrived = precedingWalk?.end ?? ready;
          // OTP already computed this walk-to-vehicle connection: no extra boarding minute after the walk.
          const routedWalk = link && precedingWalk !== undefined && precedingWalk.end > precedingWalk.start;
          if (seconds(arrived, leg.start) < BOARD_SECONDS && !routedWalk) return false;
        }
      }
      previousTransit = leg;
      walkingSinceTransit = 0;
      routerChainSinceTransit = leg.source === "BKK API" && leg.routerJourney !== undefined;
    }
    previousLeg = leg;
  }
  return true;
}

export const itineraryId = (legs: readonly Leg[]) =>
  legs.map((leg) => `${leg.routeId ?? leg.mode}:${leg.start}:${leg.from}:${leg.to}`).join("|");

/** TripPlanner.itinerary */
export function itinerary(legs: Leg[], ready: number, fetchedAt?: number): Itinerary | null {
  if (!feasible(legs, ready)) return null;
  const trip: Itinerary = { id: itineraryId(legs), start: legs[0]!.start, end: legs.at(-1)!.end, walkMeters: 0, legs, fetchedAt };
  trip.walkMeters = walkMeters(trip);
  return trip;
}

/** TripPlanner.timelyChoices: feasible, no leg waits more than an hour to board, then PlannerAlternatives.select. */
export function timelyFilter(journeys: readonly Itinerary[], ready: number) {
  return journeys.filter((trip) => {
    if (!feasible(trip.legs, ready)) return false;
    let arrived = ready;
    return trip.legs.every((leg) => {
      // Waiting before the first walk counts too: OTP may delay that walk until just before a much later bus.
      const acceptable = leg.stayOnBoard || seconds(arrived, leg.start) <= MAX_BOARDING_WAIT_SECONDS;
      arrived = leg.end;
      return acceptable;
    });
  });
}

/** A walk leg between two points (WalkingLink.leg). */
export function walkLeg(
  from: { name: string; position: GeoPoint; platform?: string },
  to: { name: string; position: GeoPoint; platform?: string },
  start: number,
  walkSeconds: number,
  meters: number,
): Leg {
  return {
    mode: "WALK",
    name: "",
    color: "#536171",
    from: from.name,
    to: to.name,
    fromPosition: from.position,
    toPosition: to.position,
    fromPlatform: from.platform,
    toPlatform: to.platform,
    distance: meters,
    stayOnBoard: false,
    start,
    end: start + walkSeconds * 1000,
    live: false,
    geometry: [
      [from.position.lon, from.position.lat],
      [to.position.lon, to.position.lat],
    ],
    intermediate: [],
  };
}

/** Budapest wall-clock parts of an instant. */
export function budapestParts(at: number) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: ZONE,
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
  ) as Record<"year" | "month" | "day" | "hour" | "minute" | "second", string>;
}
