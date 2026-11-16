import type { GeoPoint } from "~/lib/places";
import {
  array,
  object,
  string,
  number,
  position,
  color,
  type Row,
  type Stop,
  type Vehicle,
  type Route,
  type Snapshot,
  type Departure,
  type Journey,
} from "./model";

import { OFFICIAL_EMMA_URL, EMMA_QUERIES } from "./emma-contract";

// Public build-time configuration. The frontend itself remains a static export.
function endpoint() {
  const configured = process.env.NEXT_PUBLIC_EMMA_GRAPHQL_URL;
  if (typeof configured === "string" && configured.trim().length > 0) return configured.trim();
  return OFFICIAL_EMMA_URL;
}
export const EMMA_URL = endpoint();
const cache = new Map<string, { data: Row; at: number; expires: number }>();
let blockedUntil = 0;

/** Official MÁV data via the configured adapter, or direct only where upstream CORS permits. */
export async function emmaQuery(
  query: string,
  variables: Row,
  ttl: number,
  signal: AbortSignal,
) {
  if (signal.aborted) throw new DOMException("Megszakítva", "AbortError");
  const key = JSON.stringify([query, variables]),
    cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached;
  if (Date.now() < blockedUntil)
    throw new Error(
      "A MÁV/EMMA adatai ebben a böngészőben nem érhetők el. A BKK adatai továbbra is használhatók.",
    );
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, 8000);
  try {
    const response = await fetch(EMMA_URL, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const retry = Number(response.headers.get("Retry-After"));
      blockedUntil =
        Date.now() +
        (response.status === 429 && retry > 0 ? retry * 1000 : 60_000);
      throw new Error(`Az EMMA nem érhető el (${response.status}).`);
    }
    const json = object(await response.json());
    if (array(json.errors).length || !json.data)
      throw new Error("Az EMMA nem tudta teljesíteni a kérést.");
    const result = {
      data: object(json.data),
      at: Date.now(),
      expires: Date.now() + ttl,
    };
    cache.set(key, result);
    while (cache.size > 30) cache.delete(cache.keys().next().value!);
    return result;
  } catch (error) {
    if (signal.aborted) throw new DOMException("Megszakítva", "AbortError");
    if (error instanceof TypeError || controller.signal.aborted) {
      blockedUntil = Date.now() + 60_000;
      throw new Error(
        "A MÁV/EMMA adatai ebben a böngészőben nem érhetők el. Próbáld később.",
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}
function snapshot<T>(value: T, at: number): Snapshot<T> {
  return {
    value,
    at,
    incomplete: false,
    fallbackUnavailable: false,
    source: "EMMA",
  };
}
const isRail = (mode: string) => mode === "RAIL" || mode === "TRAMTRAIN";
const RAIL_LINE = /^(?:S|Z|G|EX|RE|R|TT)\s?\d{1,3}[A-Z]?$/i;
const SHORT_TRAIN_NAME = /^[A-Za-z0-9][A-Za-z0-9 .-]{0,14}$/;
const MARKUP = /<[^>]+>|&(?:#\w+|\w+);/;
/** RailSupport.clean: EMMA's rail shortName can be markup or a private-use font glyph. */
function cleanRailName(value: string) {
  const text = value.trim();
  if (!text || MARKUP.test(text) || /[\uE000-\uF8FF]/.test(text) || text.includes('"'))
    return "";
  return text;
}
/** RailSupport.number: the rail line (S10, G44) or service prefix (IC, EX) shown on badges. */
export function railNumber(shortName: string, longName: string) {
  const short = cleanRailName(shortName);
  const long = cleanRailName(longName);
  if (long && RAIL_LINE.test(long)) return long.replace(/ /g, "").toUpperCase();
  if (short && SHORT_TRAIN_NAME.test(short)) return short;
  const prefix = long.split(" ")[0] ?? "";
  if (!prefix || prefix.length > 8 || !/[\p{L}\d]/u.test(prefix)) return "?";
  return ["ic", "ir", "ec", "en", "rj", "rjx", "ex"].includes(prefix.toLowerCase())
    ? prefix.toUpperCase()
    : prefix;
}
function route(value: unknown): Route | null {
  const row = object(value),
    id = string(row.gtfsId),
    mode = string(row.mode);
  return id
    ? {
        id: `emma:${id}`,
        name: isRail(mode)
          ? railNumber(string(row.shortName), string(row.longName))
          : string(row.shortName) || string(row.longName),
        description: string(row.longName),
        mode,
        color: color(row.color, "#0066aa"),
        textColor: "#ffffff",
      }
    : null;
}
function stop(value: unknown): Stop | null {
  const row = object(value),
    point = position(row),
    id = string(row.gtfsId);
  if (!point || !id || !string(row.name)) return null;
  // MÁV supplement only; BKK platforms and other operators stay on the primary Worker path.
  if (!id.startsWith("1:") || !isRail(string(row.vehicleMode))) return null;
  return {
    id: `emma:${id}`,
    rawId: `emma:${id}`,
    name: string(row.name),
    position: point,
    platform: string(row.platformCode),
    mode: string(row.vehicleMode),
    routes: array(row.routes).flatMap((value) => {
      const parsed = route(value);
      return parsed ? [parsed] : [];
    }),
    source: "EMMA",
  };
}
function bounds(point: GeoPoint, radius: number) {
  const lat = Math.min(radius, 5000) / 111_000,
    lon = lat / Math.cos((point.lat * Math.PI) / 180);
  return {
    south: point.lat - lat,
    north: point.lat + lat,
    west: point.lon - lon,
    east: point.lon + lon,
  };
}
export async function emmaStops(
  point: GeoPoint,
  radius: number,
  signal: AbortSignal,
) {
  const result = await emmaQuery(
    EMMA_QUERIES.stops,
    bounds(point, radius),
    300_000,
    signal,
  );
  return snapshot(
    array(result.data.stopsByBbox).flatMap((value) => {
      const parsed = stop(value);
      return parsed ? [parsed] : [];
    }),
    result.at,
  );
}
export async function emmaVehicles(
  point: GeoPoint,
  radius: number,
  signal: AbortSignal,
) {
  const result = await emmaQuery(
    EMMA_QUERIES.vehicles,
    bounds(point, radius),
    10_000,
    signal,
  );
  return snapshot(
    array(result.data.vehiclePositions).flatMap((value): Vehicle[] => {
      const row = object(value),
        point = position(row),
        trip = object(row.trip),
        parsed = route(trip.route),
        id = string(row.vehicleId),
        observedAt = number(row.lastUpdated) * 1000;
      if (
        !point ||
        !id.startsWith("1:") ||
        !parsed ||
        !isRail(parsed.mode) ||
        !observedAt ||
        Date.now() - observedAt > 180_000 ||
        observedAt - Date.now() > 30_000
      )
        return [];
      return [
        {
          id: `emma:${id}`,
          position: point,
          name: parsed.name || string(trip.tripShortName),
          destination: string(trip.tripHeadsign),
          registration: string(row.label),
          model: "",
          route: parsed,
          tripId: `emma:${string(trip.gtfsId)}`,
          source: "EMMA",
          observedAt,
          mode: parsed.mode,
          bearing:
            typeof row.heading === "number" &&
            row.heading >= 0 &&
            row.heading <= 360
              ? row.heading
              : undefined,
        },
      ];
    }),
    result.at,
  );
}
export async function emmaSearch(query: string, signal: AbortSignal) {
  const result = await emmaQuery(
    EMMA_QUERIES.search,
    { name: query.trim() },
    30_000,
    signal,
  );
  return snapshot(
    array(result.data.stops).flatMap((value) => {
      const parsed = stop(value);
      return parsed ? [parsed] : [];
    }),
    result.at,
  );
}
export async function emmaBoard(
  target: Stop,
  minutes: number,
  signal: AbortSignal,
) {
  const result = await emmaQuery(
    EMMA_QUERIES.board,
    {
      id: target.id.slice(5),
      start: Math.floor(Date.now() / 30_000) * 30,
      range: Math.min(300, minutes) * 60,
    },
    10_000,
    signal,
  );
  const rows = array(object(result.data.stop).stoptimesWithoutPatterns).flatMap(
    (value): Departure[] => {
      const row = object(value),
        trip = object(row.trip),
        parsed = route(trip.route),
        scheduled =
          (number(row.serviceDay) + number(row.scheduledDeparture)) * 1000,
        cancelled = row.realtimeState === "CANCELED";
      if (!parsed || !isRail(parsed.mode) || !number(row.serviceDay)) return [];
      const live = !cancelled && row.realtime === true;
      return [
        {
          id: `${string(trip.gtfsId)}:${scheduled}`,
          stopId: target.id,
          tripId: `emma:${string(trip.gtfsId)}`,
          route: parsed,
          destination: string(row.headsign) || string(trip.tripHeadsign),
          scheduled,
          expected: live
            ? (number(row.serviceDay) + number(row.realtimeDeparture)) * 1000
            : scheduled,
          live,
          cancelled,
          serviceDate: "",
          source: "EMMA",
        },
      ];
    },
  );
  return snapshot(
    rows.sort((a, b) => a.expected - b.expected),
    result.at,
  );
}
export async function emmaTrip(tripId: string, signal: AbortSignal) {
  const id = tripId.slice(5);
  const result = await emmaQuery(EMMA_QUERIES.trip, { id }, 30_000, signal);
  const trip = object(result.data.trip),
    parsed = route(trip.route),
    times = array(trip.stoptimes);
  if (trip.gtfsId !== id || !parsed || !isRail(parsed.mode))
    throw new Error("A MÁV-járat nem található.");
  const stops = array(trip.stops).flatMap((value, index) => {
    const parsed = stop(value),
      time = object(times[index]),
      seconds =
        time.realtime === true
          ? number(time.realtimeArrival) || number(time.realtimeDeparture)
          : number(time.scheduledArrival) || number(time.scheduledDeparture);
    return parsed
      ? [
          {
            stop: parsed,
            time: (number(time.serviceDay) + seconds) * 1000,
            live: time.realtime === true,
          },
        ]
      : [];
  });
  const geometry = array(trip.geometry).flatMap((value): [number, number][] => {
    const coordinates = array(value);
    return position({ lat: coordinates[1], lon: coordinates[0] })
      ? [[number(coordinates[0]), number(coordinates[1])]]
      : [];
  });
  return snapshot<Journey>(
    {
      routeId: parsed.id,
      name: `${parsed.name} · ${string(trip.tripHeadsign)}`,
      stops,
      geometry,
      color: parsed.color,
    },
    result.at,
  );
}
export function mergeStops(primary: Stop[], fallback: Stop[]) {
  return [
    ...new Map(
      [...fallback, ...primary].map((stop) => [stop.id, stop]),
    ).values(),
  ];
}
export function mergeVehicles(primary: Vehicle[], fallback: Vehicle[]) {
  const numbers = new Set(
    primary.flatMap((vehicle) =>
      vehicle.id.replace(/^(?:BKK_|emma:1:)/, "").split("-"),
    ),
  );
  return [
    ...primary,
    ...fallback.filter(
      (vehicle) =>
        !vehicle.id
          .replace(/^emma:1:/, "")
          .split("-")
          .some((id) => numbers.has(id)),
    ),
  ];
}
