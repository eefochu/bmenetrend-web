import { distanceMeters, type GeoPoint } from "~/lib/places";
import { request } from "./client";
import type { Departure, Journey, Route, Snapshot, Source, Stop, Vehicle } from "./model";
import { budapestDay, hommCalendar, isConfirmedWorkingDay, kanyargoCalendar, localInstant, viabuszCalendar } from "./planning/calendar";
import { planningNetwork, type LocalNetwork, type LocalRoute, type LocalStop } from "./planning/local-network";

/**
 * The local operators (ViaBusz, KanyarGO, HOMM) on the map and boards: ports of TransitRepository's
 * bundled networks, DepartureCalculator (scheduled part) and ViabuszParser/KanyargoParser's live feeds.
 * Their sites send no CORS headers, so the BKK Worker relays them (`local-timetable-check`, `local-live`).
 */
export const LOCAL_PREFIX = "local:";
export const isLocalId = (id: string) => id.startsWith(LOCAL_PREFIX);
const SOURCE: Record<string, Source> = { viabusz: "ViaBusz", kanyargo: "KanyarGO", homm: "HOMM" };
const COLORS: Record<string, string> = { viabusz: "#205C48", kanyargo: "#6750A4", homm: "#BF5700" };
const NAMES: Record<string, string> = { viabusz: "ViaBusz", kanyargo: "KanyarGO", homm: "HOMM" };

let network: Promise<LocalNetwork> | null = null;
let networkDay = "";
/** Today's (verified when possible) local networks, shared by map, boards and the planner's own load. */
export function localNetwork(signal?: AbortSignal): Promise<LocalNetwork> {
  const day = budapestDay(Date.now());
  if (!network || networkDay !== day) {
    networkDay = day;
    const loading = planningNetwork(new AbortController().signal);
    loading.catch(() => {
      if (network === loading) network = null;
    });
    network = loading;
  }
  const shared = network;
  if (!signal) return shared;
  return new Promise((resolve, reject) => {
    const stop = () => reject(new DOMException("Megszakítva", "AbortError"));
    if (signal.aborted) return stop();
    signal.addEventListener("abort", stop, { once: true });
    shared.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}

export function localRoute(route: LocalRoute): Route {
  return {
    id: `${LOCAL_PREFIX}${route.id}`,
    name: route.number,
    description: route.name,
    mode: "BUS",
    color: COLORS[route.providerId] ?? "#40576A",
    textColor: "#ffffff",
    provider: route.providerId,
  };
}

export function localStop(stop: LocalStop, routes: Map<string, LocalRoute>): Stop {
  const provider = stop.providerIds.find((id) => id in SOURCE) ?? stop.providerId;
  return {
    id: `${LOCAL_PREFIX}${stop.id}`,
    rawId: stop.id,
    name: stop.name,
    position: stop.position,
    platform: "",
    mode: "BUS",
    routes: stop.routeIds.flatMap((id) => {
      const route = routes.get(id);
      return route ? [localRoute(route)] : [];
    }),
    source: SOURCE[provider] ?? "ViaBusz",
  };
}

/** Local stops within [radius] metres of [point] (the map area). */
export function localStopsNear(value: LocalNetwork, point: GeoPoint, radius: number): Stop[] {
  const routes = new Map(value.routes.map((route) => [route.id, route]));
  return value.stops.filter((stop) => distanceMeters(point, stop.position) <= radius).map((stop) => localStop(stop, routes));
}

/** Whether any local stop lies within [radius] metres (live polling stays off elsewhere). */
export const nearLocalNetwork = (value: LocalNetwork | null, point: GeoPoint, radius: number) =>
  value?.stops.some((stop) => distanceMeters(point, stop.position) <= radius) ?? false;

/** DepartureCalculator: needs today's verified service date for the operator and its reviewed calendar. */
export function localDepartures(value: LocalNetwork, stopId: string, now: number, windowMinutes: number): Departure[] {
  const today = budapestDay(now);
  const until = now + Math.min(300, Math.max(1, windowMinutes)) * 60_000;
  const ids = new Map<string, string>();
  for (const stop of value.stops) for (const source of stop.sourceStopIds) if (!ids.has(source)) ids.set(source, stop.id);
  for (const stop of value.stops) ids.set(stop.id, stop.id);
  const selected = ids.get(stopId) ?? stopId;
  const routes = new Map(value.routes.map((route) => [route.id, route]));
  const calendars = new Map<string, string | null>();
  const rows: Departure[] = [];
  for (const trip of value.trips) {
    const route = routes.get(trip.routeId);
    const direction = route?.directions.find((d) => d.id === trip.directionId);
    if (!route || !direction) continue;
    const serviceDate = route.providerId in value.providerServiceDates ? value.providerServiceDates[route.providerId] : value.serviceDate;
    if (serviceDate !== today) continue;
    const key = route.providerId === "homm" || route.providerId === "kanyargo" ? route.providerId : trip.calendar === "working_days" ? "working_days" : "viabusz";
    if (!calendars.has(key))
      calendars.set(
        key,
        key === "homm"
          ? hommCalendar(today)
          : key === "kanyargo"
            ? kanyargoCalendar(today)
            : key === "working_days"
              ? isConfirmedWorkingDay(today)
                ? "working_days"
                : null
              : viabuszCalendar(today),
      );
    if (trip.calendar !== calendars.get(key)) continue;
    // Boarding rows only: the last stop of a trip is an arrival.
    for (let index = 0; index < trip.stopTimes.length - 1; index++) {
      const time = trip.stopTimes[index]!;
      if (time.stopId !== selected) continue;
      const at = localInstant(today, time.minuteOfDay);
      if (at === null || at < now || at > until) continue;
      rows.push({
        source: SOURCE[route.providerId] ?? "ViaBusz",
        id: `${trip.id}:${today}:${index}`,
        stopId: `${LOCAL_PREFIX}${selected}`,
        tripId: `${LOCAL_PREFIX}${trip.id}@${today}@${index}`,
        destination: direction.name,
        route: localRoute(route),
        scheduled: at,
        expected: at,
        live: false,
        cancelled: false,
        serviceDate: today.replace(/-/g, ""),
      });
    }
  }
  return rows.sort((a, b) => a.expected - b.expected);
}

export class LocalNotice extends Error {}

/** A local stop's board, with the operator's warning when its timetable cannot be used today. */
export async function localBoard(stop: Stop, minutes: number, signal: AbortSignal): Promise<Snapshot<Departure[]>> {
  const value = await localNetwork(signal);
  const rows = localDepartures(value, stop.rawId, Date.now(), minutes);
  const providers = stop.routes.map((route) => route.provider).filter((id): id is string => !!id);
  const warning = [...new Set(providers.map((id) => value.providerWarnings[id]).filter((text): text is string => !!text))].join("\n");
  if (!rows.length && warning) throw new LocalNotice(warning);
  return { value: rows, at: value.fetchedAt, incomplete: false, fallbackUnavailable: false, source: stop.source };
}

/** A local departure's own run, from the timetable (no live trip feed exists). */
export async function localTrip(tripId: string, signal: AbortSignal): Promise<Snapshot<Journey>> {
  const value = await localNetwork(signal);
  const [id, day] = tripId.slice(LOCAL_PREFIX.length).split("@") as [string, string];
  const trip = value.trips.find((entry) => entry.id === id);
  const route = trip && value.routes.find((entry) => entry.id === trip.routeId);
  const direction = route?.directions.find((entry) => entry.id === trip!.directionId);
  if (!trip || !route || !direction || !day) throw new Error("A helyi menet nem található.");
  const stops = new Map(value.stops.map((stop) => [stop.id, stop]));
  const routes = new Map(value.routes.map((entry) => [entry.id, entry]));
  const rows = trip.stopTimes.flatMap((time) => {
    const stop = stops.get(time.stopId);
    const at = localInstant(day, time.minuteOfDay);
    return stop && at !== null ? [{ stop: localStop(stop, routes), time: at, live: false }] : [];
  });
  return {
    value: {
      routeId: localRoute(route).id,
      name: `${route.number} · ${direction.name}`,
      stops: rows,
      geometry: rows.map(({ stop }) => [stop.position.lon, stop.position.lat] as [number, number]),
      color: COLORS[route.providerId] ?? "#40576A",
    },
    at: value.fetchedAt,
    incomplete: false,
    fallbackUnavailable: false,
    source: SOURCE[route.providerId],
  };
}

const ZONE_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Budapest",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
/** "yyyy-MM-dd HH:mm:ss" in Budapest time to an instant (null when it does not exist). */
function budapestTimestamp(text: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const [y = 0, mo = 0, d = 0, h = 0, mi = 0, s = 0] = match.slice(1).map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  const found = [60, 120]
    .map((offset) => naive - offset * 60_000)
    .filter((ms) => {
      const parts = Object.fromEntries(ZONE_FORMAT.formatToParts(ms).map((part) => [part.type, part.value]));
      return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)) === naive;
    });
  return found[0] ?? null;
}

/** ViabuszParser.parseVehicles (KanyargoParser prefixes the identity): fresh, in-area GPS only. */
export function parseLocalVehicles(body: string, provider: "viabusz" | "kanyargo", now: number): Vehicle[] {
  const seen = new Map<string, Vehicle>();
  for (const record of body.split("#")) {
    const fields = record.split(";");
    if (fields.length < 5 || fields[0] === "Error") continue;
    const lat = Number(fields[2]),
      lon = Number(fields[3]);
    const observedAt = budapestTimestamp(fields[1] ?? "");
    if (!fields[2] || !fields[3] || !Number.isFinite(lat) || !Number.isFinite(lon) || observedAt === null) continue;
    // Never display stale depots/intercity positions as live local buses.
    const age = (now - observedAt) / 1000;
    if (age < -60 || age > 180 || lat < 47.4 || lat > 47.53 || lon < 18.75 || lon > 18.89) continue;
    const id = `${LOCAL_PREFIX}${provider}:${fields[0]}`;
    if (seen.has(id)) continue;
    seen.set(id, {
      id,
      name: "?",
      position: { lat, lon },
      destination: "",
      registration: fields[0]!,
      model: "",
      tripId: "",
      observedAt,
      source: SOURCE[provider]!,
      mode: "BUS",
      provider,
      nextStopName: fields[7]?.trim() ? fields[7].trim() : undefined,
    });
  }
  return [...seen.values()];
}

/** TransitRepository.refresh: both live operators; each one's outage is its own. */
export async function localVehicles(signal: AbortSignal): Promise<Snapshot<Vehicle[]>> {
  const results = await Promise.all(
    (["viabusz", "kanyargo"] as const).map(async (provider) => {
      try {
        const root = await request("local-live", { provider }, signal);
        const vehicles = root.vehicles as { available?: boolean; text?: string } | undefined;
        return vehicles?.available && typeof vehicles.text === "string" ? parseLocalVehicles(vehicles.text, provider, Date.now()) : [];
      } catch (error) {
        if (signal.aborted) throw error;
        return null;
      }
    }),
  );
  return {
    value: results.flatMap((rows) => rows ?? []),
    at: Date.now(),
    incomplete: results.some((rows) => rows === null),
    fallbackUnavailable: false,
  };
}

export const localProviderName = (provider: string) => NAMES[provider] ?? provider;
