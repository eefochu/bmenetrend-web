import { emmaBoard, emmaTrip } from "./emma";
import type { GeoPoint } from "~/lib/places";
import {
  appStopId,
  array,
  object,
  number,
  string,
  color,
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

/** Map/nearby polling: kept below the full budget so taps on stops, trips and lines always have headroom. */
const BACKGROUND = new Set([
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
        if (
          json.status !== "OK" ||
          !json.data ||
          typeof json.data !== "object" ||
          Array.isArray(json.data) ||
          !number(json.currentTime)
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
  if (stop.source === "EMMA" && stop.id.startsWith("emma:1:"))
    return emmaBoard(stop, minutes, signal);
  try {
    return await workerBoard(stop, minutes, signal);
  } catch (error) {
    if (signal.aborted || !stop.id.startsWith("emma:1:")) throw error;
    return emmaBoard(stop, minutes, signal);
  }
}

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
  const direct = (stop: Stop) =>
    stop.source === "EMMA" && stop.id.startsWith("emma:1:");
  const fallback = async (stop: Stop) => {
    if (!stop.id.startsWith("emma:1:")) return null;
    try {
      return (await emmaBoard(stop, minutes, signal)).value;
    } catch (error) {
      if (signal.aborted) throw error;
      return null;
    }
  };
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
    for (const stop of chunk)
      results.set(
        stop.id,
        root && ok.has(stop.rawId) ? boardRows(root, stop) : await fallback(stop),
      );
  }
  await Promise.all(
    stops
      .filter(direct)
      .map(async (stop) => results.set(stop.id, await fallback(stop))),
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
export async function tripDetails(
  tripId: string,
  signal: AbortSignal,
): Promise<Snapshot<Journey>> {
  if (tripId.startsWith("emma:1:")) return emmaTrip(tripId, signal);
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
export async function planTrip(
  from: PlanEndpoint,
  to: PlanEndpoint,
  at: Date,
  signal: AbortSignal,
): Promise<Snapshot<Itinerary[]>> {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Budapest",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  const place = (point: PlanEndpoint) =>
    `${point.name.replace(/::/g, " ")}::${point.position.lat},${point.position.lon}`;
  const root = await request(
    "plan-trip",
    {
      fromPlace: place(from),
      toPlace: place(to),
      mode: "TRANSIT,WALK",
      date: `${parts.year}-${parts.month}-${parts.day}`,
      time: `${parts.hour}:${parts.minute}`,
      numItineraries: "3",
      showIntermediateStops: "true",
      includeReferences: "false",
    },
    signal,
  );
  const entry = object(object(root.data).entry);
  if (entry.error)
    throw new TransitError(
      "Nem található útvonal a megadott helyek és időpont között.",
    );
  let rejected = false;
  const itineraries = array(object(entry.plan).itineraries).flatMap(
    (value, index) => {
      const row = object(value);
      try {
        const legs: Leg[] = array(row.legs).map((value) => {
          const leg = object(value),
            start = number(leg.startTime),
            end = number(leg.endTime);
          if (!start || end < start || !string(leg.mode))
            throw new Error("Hibás szakasz");
          return {
            routeId: string(leg.routeId),
            mode: string(leg.mode),
            name: string(leg.routeShortName) || string(leg.route),
            color: color(leg.routeColor),
            from: string(object(leg.from).name),
            to: string(object(leg.to).name),
            start,
            end,
            live: leg.realTime === true,
            geometry: polyline(string(object(leg.legGeometry).points)),
            intermediate: array(leg.intermediateStops).map((stop) =>
              string(object(stop).name),
            ),
          };
        });
        if (
          !legs.length ||
          legs.some((leg, i) => i > 0 && leg.start < legs[i - 1]!.end)
        )
          throw new Error("Hibás átszállás");
        return [
          {
            id: `${number(row.startTime)}:${index}`,
            start: legs[0]!.start,
            end: legs.at(-1)!.end,
            walkMeters: number(row.walkDistance),
            legs,
          },
        ];
      } catch {
        rejected = true;
        return [];
      }
    },
  );
  const result = snapshot(root, itineraries);
  result.incomplete ||= rejected;
  return result;
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
