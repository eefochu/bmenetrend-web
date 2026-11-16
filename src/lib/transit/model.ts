import type { GeoPoint } from "~/lib/places";

export type Source = "BKK API" | "EMMA";
export type Route = {
  id: string;
  name: string;
  description: string;
  mode: string;
  color: string;
  textColor: string;
};
export type Stop = {
  bearing?: number;
  id: string;
  rawId: string;
  name: string;
  position: GeoPoint;
  platform: string;
  mode: string;
  routes: Route[];
  source: Source;
};
export type Vehicle = {
  id: string;
  name: string;
  position: GeoPoint;
  destination: string;
  registration: string;
  model: string;
  route?: Route;
  tripId: string;
  observedAt: number;
  source: Source;
  bearing?: number;
  mode?: string;
};
export type Departure = {
  source: Source;
  id: string;
  stopId: string;
  tripId: string;
  destination: string;
  route: Route;
  scheduled: number;
  expected: number;
  live: boolean;
  cancelled: boolean;
  serviceDate: string;
};
export type Snapshot<T> = {
  source?: Source;
  value: T;
  at: number;
  incomplete: boolean;
  fallbackUnavailable: boolean;
};
export type SearchResults = {
  stops: Stop[];
  routes: Route[];
  vehicles: Vehicle[];
};
export type Journey = {
  routeId?: string;
  name: string;
  stops: { stop: Stop; time: number; live: boolean }[];
  geometry: [number, number][];
  color: string;
};
export type Leg = {
  routeId?: string;
  mode: string;
  name: string;
  color: string;
  from: string;
  to: string;
  /** Source positions of the leg's ends (PlanPoint). */
  fromPosition?: GeoPoint;
  toPosition?: GeoPoint;
  fromPlatform?: string;
  toPlatform?: string;
  headsign?: string;
  /** Metres, as reported by the planner. */
  distance: number;
  /** interlineWithPreviousLeg: the rider stays on the vehicle (PlanLeg.stayOnBoard). */
  stayOnBoard: boolean;
  start: number;
  end: number;
  live: boolean;
  geometry: [number, number][];
  intermediate: string[];
  source: Source;
};
export type Itinerary = {
  id: string;
  start: number;
  end: number;
  walkMeters: number;
  legs: Leg[];
};

export type Row = Record<string, unknown>;
export const object = (value: unknown): Row =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : {};
export const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
export const string = (value: unknown): string =>
  typeof value === "string" ? value : "";
export const number = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
export const color = (value: unknown, fallback = "#145fad") =>
  /^[a-f\d]{6}$/i.test(string(value)) ? `#${string(value)}` : fallback;
export const position = (row: Row): GeoPoint | null => {
  const lat = number(row.lat),
    lon = number(row.lon);
  return lat >= 45.7 && lat <= 48.6 && lon >= 16.1 && lon <= 22.9
    ? { lat, lon }
    : null;
};
export function appStopId(raw: string) {
  if (raw.startsWith("emma:")) return raw;
  if (/^BKK_00\d{7}(_\d+)?$/.test(raw)) return `emma:1:${raw.slice(4)}`;
  if (/^volan_\d+_\d+$/.test(raw)) return `emma:hkir:hkir_${raw.slice(6)}`;
  return raw.startsWith("BKK_") ? `emma:BKK:${raw.slice(4)}` : raw;
}
export function parseRoute(value: unknown): Route | null {
  const row = object(value),
    id = string(row.id);
  if (!id) return null;
  return {
    id,
    name: string(row.shortName) || string(row.longName) || id,
    description: string(row.description) || string(row.longName),
    mode: string(row.type),
    color: color(row.color),
    textColor: color(row.textColor, "#ffffff"),
  };
}
export function parseRoutes(ref: Row) {
  return new Map(
    Object.entries(object(ref.routes)).flatMap(([key, value]) => {
      const route = parseRoute(value);
      return route ? [[key, route] as const] : [];
    }),
  );
}
export function parseStop(
  value: unknown,
  routes: Map<string, Route>,
): Stop | null {
  const row = object(value),
    rawId = string(row.id),
    point = position(row);
  if (!point || !rawId || !string(row.name) || number(row.locationType) !== 0)
    return null;
  const serving = array(row.routeIds).flatMap((id) => {
    const route = routes.get(string(id));
    return route ? [route] : [];
  });
  return {
    bearing:
      string(row.direction).trim() !== "" &&
      Number.isFinite(Number(row.direction)) &&
      Math.abs(Number(row.direction)) <= 360
        ? (Number(row.direction) + 360) % 360
        : undefined,
    id: appStopId(rawId),
    rawId,
    name: string(row.name),
    position: point,
    platform: string(row.platformCode),
    mode: string(row.type),
    routes: serving,
    source: row.source === "emma" ? "EMMA" : "BKK API",
  };
}
export function parseVehicle(
  value: unknown,
  routes: Map<string, Route>,
  now = Date.now(),
): Vehicle | null {
  const row = object(value),
    point = position(object(row.location)),
    id = string(row.vehicleId),
    observedAt = number(row.lastUpdateTime) * 1000;
  if (
    !point ||
    !id ||
    !observedAt ||
    now - observedAt > 180_000 ||
    observedAt - now > 30_000
  )
    return null;
  const route = routes.get(string(row.routeId));
  return {
    id,
    name:
      route?.name ??
      (string(row.trainNumber) || string(row.licensePlate) || id),
    route,
    position: point,
    destination: string(row.label),
    registration: string(row.licensePlate),
    model: string(row.model),
    tripId: string(row.tripId),
    source: row.source === "emma" ? "EMMA" : "BKK API",
    observedAt,
    mode: string(row.vehicleRouteType) || route?.mode,
    bearing:
      typeof row.bearing === "number" && row.bearing >= 0 && row.bearing <= 360
        ? row.bearing
        : undefined,
  };
}
export function polyline(encoded: string): [number, number][] {
  let index = 0,
    lat = 0,
    lon = 0;
  const coordinates: [number, number][] = [];
  const next = () => {
    let result = 0,
      shift = 0,
      byte = 0;
    do {
      if (index >= encoded.length || shift > 30)
        throw new Error("Hibás útvonalgeometria");
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) throw new Error("Hibás útvonalgeometria");
      result |= (byte & 31) << shift;
      shift += 5;
    } while (byte >= 32);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length && coordinates.length < 100_000) {
    lat += next();
    lon += next();
    if (position({ lat: lat / 1e5, lon: lon / 1e5 }))
      coordinates.push([lon / 1e5, lat / 1e5]);
  }
  return coordinates;
}
export const clock = (time: number) =>
  time
    ? new Intl.DateTimeFormat("hu-HU", {
        timeZone: "Europe/Budapest",
        hour: "2-digit",
        minute: "2-digit",
      }).format(time)
    : "–";
