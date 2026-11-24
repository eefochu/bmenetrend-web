import { array, object, string, type Departure, type Itinerary, type Row, type Stop } from "./model";

/**
 * Port of data/ServiceDisruptions.kt: BKK service alerts and trip changes from the Worker's
 * `service-disruptions` endpoint, matched only by exact BKK feed identities (never by a displayed number).
 */
export type AlertText = { language: string; text: string };
export type AlertPeriod = { start: number | null; end: number | null };
export type AlertTrip = { id: string | null; date: string | null; time: string | null; route: string | null; direction: number | null };
export type AlertSelector = { agency: string | null; route: string | null; type: number | null; stop: string | null; direction: number | null; trip: AlertTrip | null };
export type ServiceAlert = {
  id: string;
  periods: AlertPeriod[];
  selectors: AlertSelector[];
  title: AlertText[];
  description: AlertText[];
  urls: AlertText[];
  effect: number;
  severity: number;
};
export type TripChange = { id: string; trip: AlertTrip; cancelled: boolean; skipped: Set<string>; updatedAt: number | null };
export type DisruptionContext = {
  bkk: boolean;
  /** Epoch ms. */
  from: number;
  until: number;
  route?: string | null;
  type?: number | null;
  stops: Set<string>;
  trip?: string | null;
  date?: string | null;
  time?: string | null;
  direction?: number | null;
  label?: string | null;
};
export type DisruptionWarning = { id: string; alert?: ServiceAlert; change?: TripChange; stale: boolean; serviceLabel?: string | null };
export type DisruptionSnapshot = {
  alerts: ServiceAlert[];
  changes: TripChange[];
  /** Feed timestamps, epoch ms. */
  alertsAt: number | null;
  changesAt: number | null;
  alertsUnavailable: boolean;
  changesUnavailable: boolean;
  attempted: boolean;
};
export const EMPTY_DISRUPTIONS: DisruptionSnapshot = {
  alerts: [],
  changes: [],
  alertsAt: null,
  changesAt: null,
  alertsUnavailable: false,
  changesUnavailable: false,
  attempted: false,
};

const IMPORTANT_EFFECTS = new Set([1, 2, 3, 4, 6, 9, 11]);
export const isImportantAlert = (alert: ServiceAlert) => alert.severity >= 3 || IMPORTANT_EFFECTS.has(alert.effect);
export const isImportant = (warning: DisruptionWarning) => warning.change !== undefined || (warning.alert ? isImportantAlert(warning.alert) : false);

const overlaps = (period: AlertPeriod, from: number, until: number) =>
  (period.end === null || Math.floor(from / 1000) < period.end) && (period.start === null || Math.floor(until / 1000) >= period.start);

/** All supplied fields within a selector must match; selectors themselves are alternatives. */
function matches(s: AlertSelector, c: DisruptionContext) {
  return (
    c.bkk &&
    (s.agency === null || s.agency === "BKK") &&
    (s.route === null || s.route === c.route) &&
    (s.type === null || s.type === c.type) &&
    (s.stop === null || c.stops.has(s.stop)) &&
    (s.direction === null || s.direction === c.direction) &&
    (s.trip === null ||
      ((s.trip.id === null || s.trip.id === c.trip) &&
        (s.trip.date === null || s.trip.date === c.date) &&
        (s.trip.time === null || s.trip.time === c.time) &&
        (s.trip.route === null || s.trip.route === c.route) &&
        (s.trip.direction === null || s.trip.direction === c.direction)))
  );
}

export const alertsStale = (snapshot: DisruptionSnapshot, now: number) =>
  snapshot.alertsUnavailable || snapshot.alertsAt === null || snapshot.alertsAt < now - 300_000;
export const changesStale = (snapshot: DisruptionSnapshot, now: number) =>
  snapshot.changesUnavailable || snapshot.changesAt === null || snapshot.changesAt < now - 180_000;

/** DisruptionSnapshot.warnings */
export function disruptionWarnings(snapshot: DisruptionSnapshot, contexts: DisruptionContext[], now: number, offline = false): DisruptionWarning[] {
  const scope = contexts.filter((c) => c.bkk);
  if (!scope.length) return [];
  const alertsUsable = snapshot.alertsAt !== null && snapshot.alertsAt >= now - 21_600_000;
  const alerts: DisruptionWarning[] = !alertsUsable
    ? []
    : snapshot.alerts
        .filter((alert) => scope.some((c) => (!alert.periods.length || alert.periods.some((p) => overlaps(p, c.from, c.until))) && alert.selectors.some((s) => matches(s, c))))
        .map((alert) => ({ id: alert.id, alert, stale: offline || alertsStale(snapshot, now) }));
  // A reused daily trip ID is insufficient: require the source's service date too.
  // Old cancellations/skips must never masquerade as a current live status.
  const trips: DisruptionWarning[] =
    offline || changesStale(snapshot, now)
      ? []
      : snapshot.changes.flatMap((change) => {
          if (change.trip.id === null || change.trip.date === null) return [];
          const matching = scope.find(
            (c) =>
              c.trip === change.trip.id &&
              c.date === change.trip.date &&
              (change.trip.time === null || c.time === change.trip.time) &&
              (change.trip.route === null || c.route === change.trip.route) &&
              (change.trip.direction === null || c.direction === change.trip.direction) &&
              (change.cancelled || [...change.skipped].some((stop) => c.stops.has(stop))),
          );
          return matching ? [{ id: change.id, change, stale: false, serviceLabel: matching.label }] : [];
        });
  const seen = new Set<string>();
  return [...trips, ...alerts]
    .filter((warning) => {
      const key = `${warning.alert !== undefined}:${warning.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((warning, index) => ({ warning, index }))
    .sort((a, b) => Number(isImportant(b.warning)) - Number(isImportant(a.warning)) || a.index - b.index)
    .map(({ warning }) => warning);
}

/** Exact feed identities only (DisruptionScope); a displayed line number is not a GTFS route ID. */
export const disruptionRoute = (id: string | undefined | null) => {
  if (!id) return null;
  if (/^BKK_[A-Za-z0-9_.-]+$/.test(id)) return id.slice(4);
  if (/^emma:BKK:[A-Za-z0-9_.-]+$/.test(id)) return id.slice(9);
  return null;
};
export const disruptionStop = (id: string | undefined | null) => {
  if (!id) return null;
  if (id.startsWith("emma:BKK:")) return id.slice(9);
  if (id.startsWith("BKK:")) return id.slice(4);
  if (id.startsWith("BKK_") && !/^BKK_00\d{7}(_\d+)?$/.test(id)) return id.slice(4);
  return null;
};
export const disruptionTrip = (id: string | undefined | null) => {
  if (!id) return null;
  if (id.startsWith("BKK_")) return id.slice(4);
  if (id.startsWith("BKK:")) return id.slice(4);
  if (id.startsWith("emma:BKK:")) return id.slice(9);
  return null;
};
function routeType(mode: string | undefined) {
  switch (mode) {
    case "TRAM":
      return 0;
    case "SUBWAY":
      return 1;
    case "RAIL":
    case "SUBURBAN_RAILWAY":
      return 2;
    case "BUS":
    case "COACH":
      return 3;
    case "FERRY":
      return 4;
    case "TROLLEYBUS":
      return 11;
    default:
      return null;
  }
}

export function lineContext(route: { id: string; name: string; mode: string }, at: number, extra: Partial<DisruptionContext> = {}): DisruptionContext {
  const raw = disruptionRoute(route.id);
  return { bkk: raw !== null, from: at, until: at, route: raw, type: routeType(route.mode), stops: new Set(), label: route.name, ...extra };
}

export function stationContexts(stops: Stop[], at: number, departures: Departure[] = []): DisruptionContext[] {
  const ids = new Set(stops.flatMap((stop) => [stop.id, stop.rawId].map(disruptionStop).filter((id): id is string => id !== null)));
  const routes = new Map(stops.flatMap((stop) => stop.routes).map((route) => [route.id, route]));
  departures.forEach((departure) => routes.set(departure.route.id, departure.route));
  return [
    { bkk: ids.size > 0, from: at, until: at, stops: ids },
    ...[...routes.values()].map((route) => lineContext(route, at, { stops: ids })),
    ...departures.flatMap((departure): DisruptionContext[] => {
      const raw = disruptionRoute(departure.route.id);
      if (raw === null) return [];
      const stop = disruptionStop(departure.stopId);
      return [
        {
          bkk: true,
          from: departure.expected,
          until: departure.expected,
          route: raw,
          stops: new Set(stop ? [stop] : []),
          trip: disruptionTrip(departure.tripId),
          date: departure.serviceDate || null,
          label: `${departure.route.name} → ${departure.destination}`,
        },
      ];
    }),
  ];
}

export function itineraryContexts(trip: Itinerary): DisruptionContext[] {
  return trip.legs
    .filter((leg) => leg.mode !== "WALK")
    .map((leg) => {
      const raw = disruptionRoute(leg.routeId);
      return {
        bkk: raw !== null,
        from: leg.start,
        until: leg.end,
        route: raw,
        type: routeType(leg.mode),
        stops: new Set<string>(),
        trip: disruptionTrip(leg.tripId),
        date: leg.serviceDate ?? null,
        label: leg.name ? `${leg.name} → ${leg.headsign ?? leg.to}` : null,
      };
    });
}

/** Feed HTML is display text, never executable content. */
export function plainText(html: string) {
  if (typeof DOMParser !== "undefined") return (new DOMParser().parseFromString(html, "text/html").body.textContent ?? "").replace(/\s+/g, " ").trim();
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
export const localized = (texts: AlertText[], language = "hu") =>
  texts.find((text) => text.language.split("-")[0] === language)?.text ?? texts.find((text) => text.language === "hu")?.text ?? texts[0]?.text ?? "";
/** Only BKK's official HTTPS pages become links. */
export function safeUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && (parsed.port === "" || parsed.port === "443") && ["bkk.hu", "www.bkk.hu"].includes(parsed.hostname) && !parsed.username && !parsed.password
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

const text = (row: Row, key: string) => {
  const value = row[key];
  if (typeof value === "number") return String(value);
  const s = string(value);
  return s && s !== "null" ? s : null;
};
const long = (row: Row, key: string) => {
  const value = row[key];
  return typeof value === "number" && value > 0 ? value : null;
};
const int = (row: Row, key: string) => {
  const value = row[key];
  return typeof value === "number" ? Math.trunc(value) : null;
};
const trip = (row: Row): AlertTrip => ({ id: text(row, "tripId"), date: text(row, "startDate"), time: text(row, "startTime"), route: text(row, "routeId"), direction: int(row, "directionId") });
const texts = (row: Row, key: string) => array(row[key]).map((value) => ({ language: string(object(value).language), text: plainText(string(object(value).text)) }));

/** ServiceDisruptionsParser.parse: each feed succeeds or fails independently and keeps its source timestamp. */
export function parseDisruptions(root: Row, previous: DisruptionSnapshot = EMPTY_DISRUPTIONS): DisruptionSnapshot {
  if (root.status !== "OK") throw new Error("Hibás forgalmi tájékoztatás");
  const a = root.alerts && typeof root.alerts === "object" ? object(root.alerts) : null;
  const t = root.tripChanges && typeof root.tripChanges === "object" ? object(root.tripChanges) : null;
  const hasAlerts = a !== null && Array.isArray(a.items) && long(a, "timestamp") !== null;
  const hasChanges = t !== null && Array.isArray(t.items) && long(t, "timestamp") !== null;
  return {
    alerts: !hasAlerts
      ? previous.alerts
      : array(a.items)
          .slice(0, 2000)
          .map(object)
          .map((row) => ({
            id: string(row.id),
            periods: array(row.periods).map((p) => ({ start: long(object(p), "start"), end: long(object(p), "end") })),
            selectors: array(row.selectors).map((value) => {
              const s = object(value);
              return {
                agency: text(s, "agencyId"),
                route: text(s, "routeId"),
                type: int(s, "routeType"),
                stop: text(s, "stopId"),
                direction: int(s, "directionId"),
                trip: s.trip && typeof s.trip === "object" ? trip(object(s.trip)) : null,
              };
            }),
            title: texts(row, "title"),
            description: texts(row, "description"),
            urls: texts(row, "url"),
            effect: typeof row.effect === "number" ? row.effect : 8,
            severity: typeof row.severity === "number" ? row.severity : 1,
          })),
    changes: !hasChanges
      ? previous.changes
      : array(t.items)
          .slice(0, 10_000)
          .map(object)
          .map((row) => ({
            id: string(row.id),
            trip: trip(object(row.trip)),
            cancelled: row.cancelled === true,
            skipped: new Set(array(row.skippedStops).map(string).filter(Boolean)),
            updatedAt: long(row, "updatedAt") === null ? null : long(row, "updatedAt")! * 1000,
          })),
    alertsAt: hasAlerts ? long(a, "timestamp")! * 1000 : previous.alertsAt,
    changesAt: hasChanges ? long(t, "timestamp")! * 1000 : previous.changesAt,
    alertsUnavailable: !hasAlerts || a.unavailable === true,
    changesUnavailable: !hasChanges || t.unavailable === true,
    attempted: true,
  };
}
