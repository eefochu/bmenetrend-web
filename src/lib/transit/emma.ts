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

import { OFFICIAL_EMMA_URL, EMMA_QUERIES, PLAN_OPERATIONS, WALK_OPERATIONS } from "./emma-contract";

// Public build-time configuration. The frontend itself remains a static export.
function endpoint() {
  const configured = process.env.NEXT_PUBLIC_EMMA_GRAPHQL_URL;
  if (typeof configured === "string" && configured.trim().length > 0) return configured.trim();
  return OFFICIAL_EMMA_URL;
}
export const EMMA_URL = endpoint();
type EmmaResult = { data: Row; at: number; expires: number; errors: Row[] };
const cache = new Map<string, EmmaResult>();
let blockedUntil = 0;

/** EMMA's national planner routinely needs 8–10 s; other queries answer within a few seconds. */
const SLOW_QUERIES = new Set<string>([...PLAN_OPERATIONS, ...WALK_OPERATIONS].map((name) => EMMA_QUERIES[name]));
const timeoutFor = (query: string) => (SLOW_QUERIES.has(query) ? 22_000 : 8000);

async function emmaFetch(
  query: string,
  variables: Row,
  ttl: number,
  signal: AbortSignal,
  partial: boolean,
): Promise<EmmaResult> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(cancel, timeoutFor(query));
  try {
    const response = await fetch(EMMA_URL, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
    if (response.status === 429) {
      // A short Retry-After is momentary congestion: retry this request. Longer ones pause every MÁV request.
      const retry = Number(response.headers.get("Retry-After"));
      if (retry > 0 && retry <= 2) throw new EmmaError("Az EMMA most foglalt.", true, retry * 1000);
      blockedUntil = Date.now() + (retry > 0 ? Math.min(retry, 120) * 1000 : 30_000);
      throw new EmmaError(`Az EMMA nem érhető el (429).`, false);
    }
    if (!response.ok)
      // A rejected or failed request is about this request only; 5xx may succeed on a retry.
      throw new EmmaError(`Az EMMA nem érhető el (${response.status}).`, response.status >= 500);
    const json = object(await response.json());
    // Aliased batches (street walks) report per-alias errors next to the others' data.
    if ((array(json.errors).length && !partial) || !json.data || typeof json.data !== "object")
      throw new EmmaError("Az EMMA nem tudta teljesíteni a kérést.", false);
    return { data: object(json.data), at: Date.now(), expires: Date.now() + ttl, errors: array(json.errors).map(object) };
  } catch (error) {
    if (signal.aborted) throw new DOMException("Megszakítva", "AbortError");
    if (error instanceof EmmaError) throw error;
    if (controller.signal.aborted)
      throw new EmmaError("Az EMMA nem válaszolt időben.", true);
    // TypeError: the adapter is not running or CORS refused the response; retrying each tick cannot help.
    blockedUntil = Date.now() + 30_000;
    throw new EmmaError(
      "A MÁV/EMMA adatai ebben a böngészőben nem érhetők el. Próbáld később.",
      false,
    );
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}

class EmmaError extends Error {
  constructor(
    message: string,
    public transient: boolean,
    public retryAfter = 600,
  ) {
    super(message);
  }
}

/**
 * Official MÁV data via the configured adapter, or direct only where upstream CORS permits. A timeout or
 * 5xx is retried once after a short pause; only an unreachable adapter or an explicit 429 pauses MÁV
 * requests globally.
 */
export async function emmaQuery(
  query: string,
  variables: Row,
  ttl: number,
  signal: AbortSignal,
  options: { partial?: boolean } = {},
): Promise<EmmaResult> {
  if (signal.aborted) throw new DOMException("Megszakítva", "AbortError");
  const key = JSON.stringify([query, variables]),
    cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached;
  if (Date.now() < blockedUntil)
    throw new Error(
      "A MÁV/EMMA adatai ebben a böngészőben nem érhetők el. A BKK adatai továbbra is használhatók.",
    );
  const partial = options.partial === true;
  let result;
  try {
    result = await emmaFetch(query, variables, ttl, signal, partial);
  } catch (error) {
    if (!(error instanceof EmmaError) || !error.transient || signal.aborted) throw error;
    await new Promise((resolve) => setTimeout(resolve, error.retryAfter));
    if (signal.aborted) throw new DOMException("Megszakítva", "AbortError");
    result = await emmaFetch(query, variables, ttl, signal, partial);
  }
  // A partly failed batch is not a cacheable answer.
  if (!result.errors.length) {
    cache.set(key, result);
    while (cache.size > 30) cache.delete(cache.keys().next().value!);
  }
  return result;
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
const VOLAN_STOP = /^hkir:hkir_(\d+_\d+)$/;
/** An app stop/trip identity that EMMA serves for Volán (`emma:hkir:…`), shared with the Worker's `volan_…`. */
export const isVolanId = (id: string) => id.startsWith("emma:hkir:");

/**
 * MÁV railway stops for the map supplement. Stops of a Volán trip (`volan`) are accepted too, with the
 * Worker identity as rawId, so a tapped stop keeps the BKK-first board path.
 */
function stop(value: unknown, volan = false): Stop | null {
  const row = object(value),
    point = position(row),
    id = string(row.gtfsId);
  if (!point || !id || !string(row.name)) return null;
  const volanCode = volan ? VOLAN_STOP.exec(id)?.[1] : undefined;
  // MÁV supplement only; BKK platforms and other operators stay on the primary Worker path.
  if (!volanCode && (!id.startsWith("1:") || !isRail(string(row.vehicleMode)))) return null;
  return {
    id: `emma:${id}`,
    rawId: volanCode ? `volan_${volanCode}` : `emma:${id}`,
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
/**
 * The map area as a railway query box. Box centres snap to a coarse 0.028° × 0.05° grid and always span
 * the full 5 km radius plus half a cell, so panning within a few kilometres repeats an identical (cached)
 * query instead of a new MÁV request for every small move. The box stays within the adapter's limits
 * (0.12° × 0.2°, Hungary bounds); the map radius is never more than 5 km.
 */
function bounds(point: GeoPoint) {
  const cellLat = 0.028,
    cellLon = 0.05;
  const lat = Math.round(point.lat / cellLat) * cellLat,
    lon = Math.round(point.lon / cellLon) * cellLon;
  const halfLat = 5000 / 111_000 + cellLat / 2, // 0.059°: under the 0.12° span limit after rounding
    halfLon = Math.min(0.0995, 5000 / 111_000 / Math.cos((lat * Math.PI) / 180) + cellLon / 2);
  const round = (value: number) => Math.round(value * 1e5) / 1e5;
  return {
    south: round(Math.max(45.5, lat - halfLat)),
    north: round(Math.min(48.8, lat + halfLat)),
    west: round(Math.max(15.9, lon - halfLon)),
    east: round(Math.min(23.1, lon + halfLon)),
  };
}
export async function emmaStops(point: GeoPoint, signal: AbortSignal) {
  const result = await emmaQuery(
    EMMA_QUERIES.stops,
    bounds(point),
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
export async function emmaVehicles(point: GeoPoint, signal: AbortSignal) {
  const result = await emmaQuery(
    EMMA_QUERIES.vehicles,
    bounds(point),
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
  const volan = isVolanId(target.id);
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
      // A MÁV station lists trains only; a Volán stop (FUTÁR fallback) lists its coaches.
      if (!parsed || (!volan && !isRail(parsed.mode)) || !number(row.serviceDay)) return [];
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
  const volan = isVolanId(tripId);
  const result = await emmaQuery(EMMA_QUERIES.trip, { id }, 30_000, signal);
  const trip = object(result.data.trip),
    parsed = route(trip.route),
    times = array(trip.stoptimes);
  if (trip.gtfsId !== id || !parsed || (!volan && !isRail(parsed.mode)))
    throw new Error(volan ? "A Volán-járat nem található." : "A MÁV-járat nem található.");
  const stops = array(trip.stops).flatMap((value, index) => {
    const parsed = stop(value, volan),
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
