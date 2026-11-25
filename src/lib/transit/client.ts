import { emmaBoard, emmaTrip, isVolanId, railNumber } from "./emma";
import { budapestParts, itinerary, routerLegKey } from "./planning/core";
import { isLocalId, localBoard, localTrip } from "./local";
import type { GeoPoint } from "~/lib/places";
import {
  appStopId,
  array,
  object,
  number,
  string,
  parseRoutes,
  parseRoute,
  parseStop,
  parseVehicle,
  polyline,
  type Row,
  type Snapshot,
  type Stop,
  type Vehicle,
  type Departure,
  type Journey,
  type Itinerary,
  type Leg,
} from "./model";

export const WORKER_URL =
  "https://bmenetrend-bkk-proxy.bmenetrend-backend.workers.dev";
const TTL: Record<string, number> = {
  "stops-for-location": 300_000,
  search: 10_000,
  "vehicles-for-location": 5_000,
  "vehicles-for-route": 5_000,
  vehicles: 5_000,
  "trip-details": 30_000,
  "route-details": 30_000,
  "plan-trip": 5_000,
  "service-disruptions": 60_000,
  // The Worker's relay of the local operators (tools/bkk-worker/src/local.js).
  "local-timetable-check": 600_000,
  "local-live": 10_000,
  "arrivals-and-departures-for-stop": 10_000,
  "arrivals-and-departures-for-stops": 10_000,
};
const cache = new Map<string, { value: Row; expires: number; size: number }>();
let cacheSize = 0;
type PendingRequest = {
  promise: Promise<Row>;
  controller: AbortController;
  users: number;
};
const pending = new Map<string, PendingRequest>();
let requests: number[] = [],
  plans: number[] = [],
  cooldown = 0;
export class TransitError extends Error {
  constructor(
    message: string,
    public retryAt = 0,
  ) {
    super(message);
  }
}
export const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "A közlekedési adatok nem érhetők el.";
const abort = () => new DOMException("Megszakítva", "AbortError");
/** Forget cached answers, budgets and a Retry-After cooldown (tests; nothing in the app calls this). */
export function resetTransport() {
  cache.clear();
  cacheSize = 0;
  pending.clear();
  requests = [];
  plans = [];
  cooldown = 0;
}
/** Planner calls the client budget still allows this minute (BkkWorkerRepository.planHeadroom). */
export function planHeadroom() {
  const now = Date.now();
  return Math.max(0, 8 - plans.filter((time) => now - time < 60_000).length);
}

/** Map/nearby polling: kept below the full budget so taps on stops, trips and lines always have headroom. */
const BACKGROUND = new Set([
  "local-live",
  "service-disruptions",
  "stops-for-location",
  "vehicles-for-location",
  "arrivals-and-departures-for-stops",
]);
/** A short budget wait is invisible to the user; a longer one is reported as an error with its retry time. */
const MAX_BUDGET_WAIT = 8_000;

/** Milliseconds until the client budget allows this request (0: now). Mirrors BkkRequestBudget's oldest + 60 s. */
function budgetWait(endpoint: string, now: number) {
  requests = requests.filter((time) => now - time < 60_000);
  plans = plans.filter((time) => now - time < 60_000);
  const limit = BACKGROUND.has(endpoint) ? 45 : 60;
  let wait = 0;
  if (requests.length >= limit)
    wait = requests[requests.length - limit]! + 60_000 - now;
  if (endpoint === "plan-trip" && plans.length >= 8)
    wait = Math.max(wait, plans[plans.length - 8]! + 60_000 - now);
  return Math.max(0, wait);
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const done = () => {
      signal.removeEventListener("abort", stop);
      resolve();
    };
    const timer = setTimeout(done, ms);
    const stop = () => {
      clearTimeout(timer);
      reject(abort());
    };
    signal.addEventListener("abort", stop, { once: true });
  });
}

/** Shared bounded transport, matching BkkWorkerClient: no keys, no Next proxy, no background queue. */
export async function request(
  endpoint: string,
  params: Record<string, string>,
  signal: AbortSignal,
): Promise<Row> {
  if (!(endpoint in TTL)) throw new TransitError("Nem támogatott kérés.");
  if (signal.aborted) throw abort();
  const query = new URLSearchParams(
    Object.entries(params).sort(([a], [b]) => a.localeCompare(b)),
  );
  const key = `${endpoint}?${query}`;
  let shared: PendingRequest | undefined;
  for (;;) {
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    shared = pending.get(key);
    if (shared?.controller.signal.aborted) shared = undefined;
    if (shared) break;
    const now = Date.now();
    if (now < cooldown)
      throw new TransitError(
        "A szolgáltató rövid szünetet kér. Kérlek, várj az újrapróbálással.",
        cooldown,
      );
    const wait = budgetWait(endpoint, now);
    if (!wait) break;
    if (wait > MAX_BUDGET_WAIT)
      throw new TransitError(
        "Túl sok kérés. Egy perc múlva próbáld újra.",
        now + wait,
      );
    // A burst of taps waits for the next free slot instead of failing; superseded requests abort here.
    await delay(wait, signal);
  }
  if (!shared) {
    const now = Date.now();
    requests.push(now);
    if (endpoint === "plan-trip") plans.push(now);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    const promise = (async () => {
      try {
        const response = await fetch(
          `${WORKER_URL}/api/${endpoint}.json?${query}`,
          { signal: controller.signal, cache: "no-store", credentials: "omit" },
        );
        if (response.status === 429) {
          const value = response.headers.get("Retry-After") ?? "60";
          const seconds = /^\d+$/.test(value)
            ? Number(value) * 1000
            : Date.parse(value) - Date.now();
          cooldown =
            Date.now() +
            Math.max(1000, Number.isFinite(seconds) ? seconds : 60_000);
          throw new TransitError(
            "A szolgáltató túlterhelt. Az automatikus frissítés rövid időre szünetel.",
            cooldown,
          );
        }
        if (!response.ok)
          throw new TransitError(
            `A közlekedési szolgáltató nem érhető el (${response.status}).`,
          );
        const json = object(await response.json());
        // service-disruptions and the local relays have their own envelopes and timestamps.
        if (
          json.status !== "OK" ||
          (!["service-disruptions", "local-timetable-check", "local-live"].includes(endpoint) &&
            (!json.data || typeof json.data !== "object" || Array.isArray(json.data) || !number(json.currentTime)))
        )
          throw new TransitError("A szolgáltató hibás választ adott.");
        const size = JSON.stringify(json).length;
        cacheSize -= cache.get(key)?.size ?? 0;
        cacheSize += size;
        cache.set(key, {
          size,
          value: json,
          expires: Date.now() + (TTL[endpoint] ?? 5000),
        });
        while (cache.size > 60 || cacheSize > 2_000_000) {
          const oldest = cache.keys().next().value!;
          cacheSize -= cache.get(oldest)!.size;
          cache.delete(oldest);
        }
        return json;
      } catch (error) {
        if (controller.signal.aborted)
          throw new TransitError(
            "A kérés megszakadt vagy lejárt. Próbáld újra.",
          );
        throw error;
      } finally {
        clearTimeout(timer);
        if (pending.get(key)?.controller === controller) pending.delete(key);
      }
    })();
    shared = { promise, controller, users: 0 };
    pending.set(key, shared);
  }
  const entry = shared;
  entry.users++;
  return new Promise((resolve, reject) => {
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      signal.removeEventListener("abort", onAbort);
      if (--entry.users === 0 && pending.get(key) === entry)
        entry.controller.abort();
    };
    const onAbort = () => {
      release();
      reject(abort());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    entry.promise.then(
      (value) => {
        if (!released) {
          release();
          resolve(value);
        }
      },
      (error: unknown) => {
        if (!released) {
          release();
          reject(
            error instanceof Error ? error : new TransitError(message(error)),
          );
        }
      },
    );
  });
}
function snapshot<T>(root: Row, value: T): Snapshot<T> {
  return {
    value,
    at: number(root.currentTime),
    incomplete: object(root.data).limitExceeded === true,
    fallbackUnavailable:
      object(root.fallback).status === "unavailable" ||
      object(object(root.data).fallback).status === "unavailable",
  };
}
const refs = (root: Row) => object(object(root.data).references);
export async function stopsAt(
  point: GeoPoint,
  radius: number,
  signal: AbortSignal,
) {
  const root = await request(
    "stops-for-location",
    {
      lat: String(point.lat),
      lon: String(point.lon),
      radius: String(Math.min(5000, radius)),
      includeReferences: "routes",
    },
    signal,
  );
  const routes = parseRoutes(refs(root));
  const stops = array(object(root.data).list).flatMap((row) => {
    const stop = parseStop(row, routes);
    return stop ? [stop] : [];
  });
  rememberStops(stops);
  return snapshot(root, [
    ...new Map(stops.map((stop) => [stop.id, stop])).values(),
  ]);
}
/**
 * Every live vehicle of one BKK-served line (Worker `vehicles-for-route`), independent of the map area:
 * a highlighted line shows all its vehicles at any zoom, like Android's focused route.
 */
export async function routeVehicles(
  routeId: string,
  signal: AbortSignal,
): Promise<Snapshot<Vehicle[]>> {
  const root = await request(
    "vehicles-for-route",
    // BkkWorkerRepository.routeVehicles: the same parameters as search's line vehicles, so both share one cache entry.
    { routeId, includeReferences: "routes" },
    signal,
  );
  const routes = parseRoutes(refs(root));
  return snapshot(
    root,
    array(object(root.data).list).flatMap((row) => {
      const vehicle = parseVehicle(row, routes);
      return vehicle ? [vehicle] : [];
    }),
  );
}
export async function vehiclesAt(
  point: GeoPoint,
  radius: number,
  signal: AbortSignal,
): Promise<Snapshot<Vehicle[]>> {
  const root = await request(
    "vehicles-for-location",
    {
      lat: String(point.lat),
      lon: String(point.lon),
      radius: String(Math.min(5000, radius)),
      includeReferences: "routes,trips",
    },
    signal,
  );
  const routes = parseRoutes(refs(root));
  return snapshot(
    root,
    array(object(root.data).list).flatMap((row) => {
      const vehicle = parseVehicle(row, routes);
      return vehicle ? [vehicle] : [];
    }),
  );
}
export async function searchTransit(
  query: string,
  near: GeoPoint,
  signal: AbortSignal,
) {
  const root = await request(
    "search",
    {
      query: query.trim(),
      lat: String(near.lat),
      lon: String(near.lon),
      includeReferences: "stops,routes,trips",
    },
    signal,
  );
  const data = object(root.data),
    ref = refs(root),
    routes = parseRoutes(ref),
    entry = object(data.entry),
    stopsRef = object(ref.stops);
  const stops = array(entry.stopIds).flatMap((id) => {
    const stop = parseStop(stopsRef[string(id)], routes);
    return stop ? [stop] : [];
  });
  rememberStops(stops);
  const lineIds = array(entry.routeIds).map(string).filter(Boolean).slice(0, 3);
  const found = array(entry.vehicleIds).map(
    (id) => object(ref.vehicles)[string(id)],
  );
  let incomplete = false;
  const optional = async (endpoint: string, params: Record<string, string>) => {
    try {
      return await request(endpoint, params, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      incomplete = true;
      return null;
    }
  };
  if (lineIds.length) {
    const extra = await optional("vehicles-for-route", {
      routeId: lineIds.join(","),
      includeReferences: "routes",
    });
    if (extra) {
      parseRoutes(refs(extra)).forEach((value, key) => routes.set(key, value));
      found.push(...array(object(extra.data).list));
    }
  }
  if (/^(?:BKK_)?\d{3,15}$/.test(query.trim())) {
    const extra = await optional("vehicles", {
      vehicleId: query.trim().startsWith("BKK_")
        ? query.trim()
        : `BKK_${query.trim()}`,
      includeReferences: "routes",
    });
    if (extra) {
      parseRoutes(refs(extra)).forEach((value, key) => routes.set(key, value));
      found.push(...array(object(extra.data).list));
    }
  }
  const vehicles = found.flatMap((row) => {
    const vehicle = parseVehicle(row, routes);
    return vehicle ? [vehicle] : [];
  });
  const result = snapshot(root, {
    stops,
    routes: lineIds.flatMap((id) => (routes.get(id) ? [routes.get(id)!] : [])),
    vehicles: [
      ...new Map(vehicles.map((vehicle) => [vehicle.id, vehicle])).values(),
    ],
  });
  result.incomplete ||= incomplete;
  return result;
}
export async function board(
  stop: Stop,
  minutes: number,
  signal: AbortSignal,
): Promise<Snapshot<Departure[]>> {
  if (isLocalId(stop.id)) return localBoard(stop, minutes, signal);
  if (stop.source === "EMMA" && stop.id.startsWith("emma:1:"))
    return emmaBoard(stop, minutes, signal);
  // TransitViewModel.fetchBoards: FUTÁR serves two hours and knows rural Volán stops (Császár, Kecskéd…)
  // and railway stations outside Budapest (Balatonföldvár…) without their timetables. A stop EMMA also
  // serves therefore uses EMMA beyond two hours, or when BKK fails or answers empty.
  const emma = emmaServes(stop);
  if (emma && minutes > 120) return emmaBoard(stop, minutes, signal);
  let primary: Snapshot<Departure[]> | undefined;
  try {
    primary = await workerBoard(stop, minutes, signal);
    if (!emma || primary.value.length > 0) return primary;
  } catch (error) {
    if (signal.aborted || !emma) throw error;
  }
  try {
    return await emmaBoard(stop, minutes, signal);
  } catch (error) {
    // An empty BKK answer is still a real answer when MÁV cannot be reached.
    if (primary && !signal.aborted) return primary;
    throw error;
  }
}

/** Stops whose official MÁV (`emma:1:`) or Volán (`emma:hkir:`) board EMMA can supply. */
const emmaServes = (stop: Stop) => stop.id.startsWith("emma:1:") || isVolanId(stop.id);

async function workerBoard(
  stop: Stop,
  minutes: number,
  signal: AbortSignal,
): Promise<Snapshot<Departure[]>> {
  if (stop.source === "EMMA" && stop.id.startsWith("emma:1:"))
    return emmaBoard(stop, minutes, signal);
  const root = await request(
    "arrivals-and-departures-for-stop",
    {
      stopId: stop.rawId,
      minutesBefore: "0",
      minutesAfter: String(Math.min(120, minutes)),
      limit: "50",
      includeReferences: "routes,trips,stops",
    },
    signal,
  );
  return snapshot(root, boardRows(root, stop));
}

/**
 * Several stops' boards (nearby stations, favourites) through the Worker's bounded batch endpoint:
 * one request per six stops instead of one each. Stops the batch could not serve fall back like
 * [board]; a stop with no board at all is null.
 */
export async function boards(
  stops: Stop[],
  minutes: number,
  signal: AbortSignal,
): Promise<(Departure[] | null)[]> {
  const fallback = async (stop: Stop) => {
    if (!emmaServes(stop)) return null;
    try {
      return (await emmaBoard(stop, minutes, signal)).value;
    } catch (error) {
      if (signal.aborted) throw error;
      return null;
    }
  };
  const local = async (stop: Stop) => {
    try {
      return (await localBoard(stop, minutes, signal)).value;
    } catch (error) {
      if (signal.aborted) throw error;
      return null;
    }
  };
  const direct = (stop: Stop) =>
    isLocalId(stop.id) ||
    (stop.source === "EMMA" && stop.id.startsWith("emma:1:")) ||
    (emmaServes(stop) && minutes > 120);
  const worker = stops.filter((stop) => !direct(stop));
  const results = new Map<string, Departure[] | null>();
  for (let index = 0; index < worker.length; index += 6) {
    const chunk = worker.slice(index, index + 6);
    let root: Row | null = null;
    try {
      root = await request(
        "arrivals-and-departures-for-stops",
        {
          stopId: chunk.map((stop) => stop.rawId).join(","),
          minutesBefore: "0",
          minutesAfter: String(Math.min(120, minutes)),
          limit: "50",
          includeReferences: "routes,trips,stops",
        },
        signal,
      );
    } catch (error) {
      if (signal.aborted) throw error;
    }
    const ok = new Set(
      array(object(root?.data).successfulStopIds).map(string),
    );
    for (const stop of chunk) {
      const rows = root && ok.has(stop.rawId) ? boardRows(root, stop) : null;
      // An empty FUTÁR board is not final for MÁV and Volán stops; EMMA has their timetables.
      results.set(
        stop.id,
        rows && (rows.length > 0 || !emmaServes(stop)) ? rows : ((await fallback(stop)) ?? rows),
      );
    }
  }
  await Promise.all(
    stops
      .filter(direct)
      .map(async (stop) => results.set(stop.id, isLocalId(stop.id) ? await local(stop) : await fallback(stop))),
  );
  return stops.map((stop) => results.get(stop.id) ?? null);
}

function boardRows(root: Row, stop: Stop): Departure[] {
  const ref = refs(root),
    routes = parseRoutes(ref),
    trips = object(ref.trips),
    entry = object(object(root.data).entry);
  const rows = array(entry.stopTimes)
    .flatMap((value) => {
      const row = object(value),
        tripId = string(row.tripId),
        trip = object(trips[tripId]),
        route = routes.get(string(trip.routeId) || string(row.routeId));
      const scheduled = number(row.departureTime) * 1000,
        predicted = number(row.predictedDepartureTime) * 1000;
      if (
        !route ||
        !scheduled ||
        (row.pickupAllowed === false && row.canceled !== true)
      )
        return [];
      if (row.stopId && appStopId(string(row.stopId)) !== stop.id) return [];
      const cancelled = row.canceled === true;
      return [
        {
          id: `${tripId}:${scheduled}`,
          stopId: stop.id,
          tripId,
          route,
          destination: string(row.stopHeadsign) || string(trip.tripHeadsign),
          scheduled,
          expected: !cancelled && predicted ? predicted : scheduled,
          source: "BKK API" as const,
          live: !cancelled && predicted > 0,
          cancelled,
          serviceDate: string(row.serviceDate),
        },
      ];
    })
    .sort((a, b) => a.expected - b.expected);
  return rows;
}
/** BkkWorkerParser.workerTripId: trips the Worker serves (BKK and Volán); MÁV `emma:` trips use EMMA directly. */
export const isWorkerTripId = (tripId: string) =>
  /^BKK_./.test(tripId) || /^volan_[A-Za-z0-9_.-]+$/.test(tripId);

/**
 * BkkWorkerRepository.tripVehicle: the live vehicle running [tripId] now, from the same `trip-details`
 * request (and cache entry) the trip view uses. Null before the trip starts or when the vehicle the
 * Worker reports runs another trip.
 */
export async function tripVehicle(
  tripId: string,
  signal: AbortSignal,
): Promise<Vehicle | null> {
  if (!isWorkerTripId(tripId)) return null;
  const root = await request(
    "trip-details",
    { tripId, includeReferences: "routes,trips,stops" },
    signal,
  );
  const row = object(object(object(root.data).entry).vehicle);
  if (!Object.keys(row).length) return null;
  const vehicle = parseVehicle(row, parseRoutes(refs(root)));
  return vehicle?.tripId === tripId ? vehicle : null;
}
export async function tripDetails(
  tripId: string,
  signal: AbortSignal,
): Promise<Snapshot<Journey>> {
  if (isLocalId(tripId)) return localTrip(tripId, signal);
  if (tripId.startsWith("emma:1:") || isVolanId(tripId)) return emmaTrip(tripId, signal);
  const root = await request(
    "trip-details",
    { tripId, includeReferences: "routes,trips,stops" },
    signal,
  );
  const ref = refs(root),
    routes = parseRoutes(ref),
    entry = object(object(root.data).entry),
    trip = object(object(ref.trips)[tripId]);
  const route =
    routes.get(string(trip.routeId) || string(object(entry.vehicle).routeId)) ??
    routes.values().next().value;
  const stops = array(entry.stopTimes).flatMap((value) => {
    const row = object(value),
      stop = parseStop(object(ref.stops)[string(row.stopId)], routes);
    const predicted =
      number(row.predictedDepartureTime) || number(row.predictedArrivalTime);
    return stop
      ? [
          {
            stop,
            time:
              (predicted ||
                number(row.departureTime) ||
                number(row.arrivalTime)) * 1000,
            live: predicted > 0,
          },
        ]
      : [];
  });
  rememberStops(stops.map((row) => row.stop));
  return snapshot(root, {
    routeId: route?.id,
    name: `${route?.name ?? "Járat"} · ${string(trip.tripHeadsign)}`,
    stops,
    color: route?.color ?? "#145fad",
    geometry: polyline(string(object(entry.polyline).points)),
  });
}
export type PlanEndpoint = { name: string; position: GeoPoint };

/** BkkWorkerParser.PlanResult: [rejected] counts itineraries the app cannot show faithfully (EMMA is needed). */
export type BkkPlanResult = { itineraries: Itinerary[]; rejected: number; offered: number; fetchedAt: number };
export type BkkPlanMode = "TRANSIT,WALK" | "BUS,COACH,WALK" | "WALK";

const BKK_MODES = new Set(["BUS", "TRAM", "TROLLEYBUS", "SUBWAY"]);
const BKK_SPECIAL_MODES = new Set(["COACH", "FERRY", "CABLE_CAR", "FUNICULAR"]);
const PLAN_MODES = new Set([
  "WALK", "BUS", "COACH", "TRAM", "TROLLEYBUS", "SUBWAY", "RAIL", "SUBURBAN_RAILWAY", "TRAMTRAIN", "FERRY", "CABLE_CAR", "FUNICULAR",
]);
const isTrainMode = (mode: string) => mode === "RAIL" || mode === "TRAMTRAIN" || mode === "TRAIN";
/** HevSupport.number */
export function hevNumber(short: string, long: string) {
  return [long, short].map((value) => value.trim()).find((value) => /^H[5-9](?:A|E)?$/i.test(value))?.toUpperCase();
}
export const HEV_COLORS: Record<string, string> = { "5": "#7B116B", "6": "#824B00", "7": "#EF7800" };

/**
 * BkkWorkerParser.planRoute: a planner leg's line. BKK lines keep their identity (rail/HÉV by mode), Volán
 * lines keep BKK's raw agency ID under the Volán provider, other agencies are genuinely unsupported (null).
 */
export function planRoute(raw: string, mode: string, short: string, long: string, routeColor: string) {
  const shown = short && !short.includes("<") && !/[\uE000-\uF8FF]/.test(short) ? short : "";
  const safe = /^[a-f\d]{6}$/i.test(routeColor) ? `#${routeColor}` : "";
  if (/^volan_[A-Za-z0-9_.-]+$/.test(raw)) {
    if (mode !== "BUS" && mode !== "COACH") return null;
    const number = shown || long;
    return number ? { id: raw, provider: "volan", name: number, color: safe || "#F9B900" } : null;
  }
  if (!raw.startsWith("BKK_") || raw.length <= 4) return null;
  if (BKK_MODES.has(mode)) return shown ? { id: raw, provider: "bkk", name: shown, color: safe || "#199DCF" } : null;
  if (mode === "SUBURBAN_RAILWAY") {
    const number = hevNumber(shown, long);
    return number ? { id: raw, provider: "hev", name: number, color: HEV_COLORS[number[1]!] ?? "#EB6482" } : null;
  }
  if (isTrainMode(mode)) return { id: raw, provider: "mav", name: railNumber(shown, long), color: "#0066AA" };
  if (!BKK_SPECIAL_MODES.has(mode)) return null;
  const number = shown || long;
  return number ? { id: raw, provider: "bkk", name: number, color: safe || "#199DCF" } : null;
}

const planPoint = (row: Row) => {
  const lat = row.lat,
    lon = row.lon;
  if (typeof lat !== "number" || typeof lon !== "number" || lat < 45 || lat > 49.5 || lon < 15.5 || lon > 23.5)
    throw new Error("Hibás pont");
  const name = string(row.name);
  if (!name) throw new Error("Névtelen pont");
  return { name, position: { lat, lon }, platform: string(row.platformCode) || undefined };
};

function planLeg(row: Row): Leg {
  const mode = string(row.mode);
  if (!PLAN_MODES.has(mode)) throw new Error("Ismeretlen mód");
  // Planner timestamps are milliseconds.
  const start = row.startTime,
    end = row.endTime,
    distance = row.distance;
  if (typeof start !== "number" || typeof end !== "number" || typeof distance !== "number" || end < start || !(distance >= 0))
    throw new Error("Hibás szakasz");
  if (mode === "WALK" && Math.floor((end - start) / 1000) + 10 < distance / 2.2) throw new Error("Hibás séta");
  const route =
    mode === "WALK"
      ? null
      : planRoute(string(row.routeId), mode, string(row.routeShortName), string(row.routeLongName), string(row.routeColor));
  if (mode !== "WALK" && !route) throw new Error("Nem támogatott járat");
  const from = planPoint(object(row.from)),
    to = planPoint(object(row.to));
  const stops = array(row.intermediateStops).map((value) => planPoint(object(value)));
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
    headsign: string(row.headsign) || undefined,
    distance,
    stayOnBoard: row.interlineWithPreviousLeg === true,
    start,
    end,
    live: row.realTime === true,
    geometry: [from, ...stops, to].map((point) => [point.position.lon, point.position.lat] as [number, number]),
    intermediate: stops.map((stop) => stop.name),
    source: "BKK API",
    tripId: string(row.tripId) || undefined,
    serviceDate: /^\d{8}$/.test(string(row.serviceDate)) ? string(row.serviceDate) : undefined,
  };
}

/** BkkWorkerParser.planResult: BKK's OTP itineraries, validated by the same feasibility rules as EMMA's. */
export function parsePlan(root: Row, ready: number, fetchedAt?: number): BkkPlanResult {
  const entry = object(object(root.data).entry);
  if (entry.error !== undefined && entry.error !== null) throw new TransitError("A BKK útvonaltervező hibát adott.");
  const rows = array(object(entry.plan).itineraries);
  let rejected = 0;
  const seen = new Set<string>();
  const itineraries = rows.flatMap((value, index) => {
    let legs: Leg[];
    try {
      const raw = array(object(value).legs);
      if (raw.length < 1 || raw.length > 40) throw new Error("Szakaszok");
      legs = raw.map((leg) => planLeg(object(leg)));
    } catch {
      rejected++;
      return [];
    }
    const keys = legs.map(routerLegKey);
    const journey = `bkk:${ready}:${index}:${keys.join("|")}`;
    const routed = legs.map((leg, i) => ({ ...leg, routerJourney: journey, routerPrevious: keys[i - 1] }));
    // Merely infeasible journeys are not "rejected": EMMA would apply the same rule.
    const trip = itinerary(routed, ready, fetchedAt);
    if (!trip || seen.has(trip.id)) return [];
    seen.add(trip.id);
    return [trip];
  });
  return { itineraries, rejected, offered: rows.length, fetchedAt: fetchedAt ?? Date.now() };
}

const coordinate = (value: number) => value.toFixed(5);
/** BkkWorkerRepository.place */
function placeParam(name: string, position: GeoPoint) {
  const label =
    name
      .replace(/::/g, " ")
      .replace(/[\u0000-\u001f]/g, "")
      .trim()
      .slice(0, 120) || "Hely";
  return `${label}::${coordinate(position.lat)},${coordinate(position.lon)}`;
}

/** BkkWorkerRepository.planResult / walking: one Worker `plan-trip` (compact, as Android asks for it). */
export async function bkkPlan(
  from: PlanEndpoint,
  to: PlanEndpoint,
  ready: number,
  mode: BkkPlanMode,
  signal: AbortSignal,
): Promise<BkkPlanResult> {
  const parts = budapestParts(ready);
  const root = await request(
    "plan-trip",
    {
      fromPlace: placeParam(from.name, from.position),
      toPlace: placeParam(to.name, to.position),
      mode,
      date: `${parts.year}-${parts.month}-${parts.day}`,
      time: `${parts.hour}:${parts.minute}`,
      numItineraries: mode === "WALK" ? "1" : "3",
      showIntermediateStops: "true",
      includeReferences: "false",
      compact: "true",
    },
    signal,
  );
  return parsePlan(root, ready, number(root.currentTime) || Date.now());
}

/** Compatibility wrapper: BKK's answer as a snapshot (rejected rows mark it incomplete). */
export async function planTrip(
  from: PlanEndpoint,
  to: PlanEndpoint,
  at: Date,
  signal: AbortSignal,
): Promise<Snapshot<Itinerary[]>> {
  const result = await bkkPlan(from, to, at.getTime(), "TRANSIT,WALK", signal);
  return { value: result.itineraries, at: result.fetchedAt, incomplete: result.rejected > 0, fallbackUnavailable: false };
}
const STOP_KEY = "bmenetrend:stop-catalogue:v1";
let catalogue: Map<string, Stop> | undefined;
export function knownStops(): Stop[] {
  if (!catalogue) {
    try {
      catalogue = new Map(
        (JSON.parse(localStorage.getItem(STOP_KEY) ?? "[]") as Stop[])
          .filter(
            (stop) => stop.id && stop.rawId && stop.name && positionSafe(stop),
          )
          .map((stop) => [stop.id, stop]),
      );
    } catch {
      catalogue = new Map();
    }
  }
  return [...catalogue.values()];
}
function positionSafe(stop: Stop) {
  return (
    Array.isArray(stop.routes) &&
    stop.position &&
    Number.isFinite(stop.position.lat) &&
    Number.isFinite(stop.position.lon)
  );
}
export function rememberStops(stops: Stop[]) {
  knownStops();
  stops.forEach((stop) => {
    catalogue!.delete(stop.id);
    catalogue!.set(stop.id, stop);
  });
  let pinned = new Set<string>();
  try {
    const saved = object(
      JSON.parse(localStorage.getItem("bmenetrend:preferences") ?? "{}"),
    );
    pinned = new Set(array(saved.favorites).map(string));
  } catch {
    /* corrupt preferences do not block map data */
  }
  while (catalogue!.size > 2500) {
    const removable = [...catalogue!.keys()].find((id) => !pinned.has(id));
    if (!removable) break;
    catalogue!.delete(removable);
  }
  // Static stop metadata only, never persisted vehicle positions or predictions.
  try {
    localStorage.setItem(STOP_KEY, JSON.stringify([...catalogue!.values()]));
  } catch {
    /* private/full storage */
  }
}

export async function routeDetails(
  routeId: string,
  signal: AbortSignal,
): Promise<Snapshot<Journey[]>> {
  const root = await request(
    "route-details",
    { routeId, related: "false", includeReferences: "routes,stops" },
    signal,
  );
  const ref = refs(root),
    routes = parseRoutes(ref),
    entry = object(object(root.data).entry);
  const route = parseRoute(entry) ?? routes.get(routeId);
  const journeys = array(entry.variants).flatMap((value) => {
    const variant = object(value),
      ids = array(variant.stopIds);
    const stops = ids.flatMap((id) => {
      const stop = parseStop(object(ref.stops)[string(id)], routes);
      return stop ? [{ stop, time: 0, live: false }] : [];
    });
    if (stops.length < 2 || stops.length !== ids.length) return [];
    return [
      {
        routeId: route?.id,
        name: string(variant.headsign) || stops.at(-1)!.stop.name,
        stops,
        geometry: polyline(string(object(variant.polyline).points)),
        color: route?.color ?? "#145fad",
      },
    ];
  });
  rememberStops(
    journeys.flatMap((journey) => journey.stops.map((row) => row.stop)),
  );
  return snapshot(root, journeys);
}
