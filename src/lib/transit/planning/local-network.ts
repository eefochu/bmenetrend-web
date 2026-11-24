import type { GeoPoint } from "~/lib/places";
import { array, object, string, type Row } from "../model";
import { budapestDay, hommCalendar, isConfirmedWorkingDay, isYearReviewed, kanyargoCalendar, viabuszCalendar, type Day } from "./calendar";

/**
 * Ports of data/NetworkJson.kt, NetworkMerger.kt, SharedStops.kt and the bundled-network handling of
 * TransitRepository.kt for the reviewed local operators (ViaBusz, KanyarGO, HOMM).
 */
export type LocalStop = {
  id: string;
  name: string;
  position: GeoPoint;
  routeIds: string[];
  providerId: string;
  providerIds: string[];
  aliases: string[];
  sourceStopIds: string[];
};
export type LocalDirection = { id: string; name: string; stopIds: string[]; restrictedService: boolean };
export type LocalRoute = { id: string; number: string; name: string; directions: LocalDirection[]; providerId: string };
export type LocalTrip = { id: string; routeId: string; directionId: string; stopTimes: { stopId: string; minuteOfDay: number }[]; calendar: string };
export type LocalNetwork = {
  stops: LocalStop[];
  routes: LocalRoute[];
  trips: LocalTrip[];
  fetchedAt: number;
  source: string;
  serviceDate: Day | null;
  providerServiceDates: Record<string, Day | null>;
  providerWarnings: Record<string, string>;
  warning: string | null;
  /** Document verification is independent of whether an operator runs on the fetch date. */
  verifiedProviderIds: Set<string>;
};

const strings = (value: unknown) => array(value).map(string);
function fail(message: string): never {
  throw new Error(message);
}

/** NetworkJson.decode with its validation: a malformed asset never becomes a timetable. */
export function decodeNetwork(root: Row): LocalNetwork {
  const version = root.schemaVersion;
  if (typeof version !== "number" || version < 1 || version > 3) fail("Unsupported cached network");
  const stops = array(root.stops).map((value): LocalStop => {
    const stop = object(value);
    const provider = string(stop.providerId) || "viabusz";
    const lat = stop.lat,
      lon = stop.lon;
    if (!string(stop.id) || !string(stop.name) || typeof lat !== "number" || typeof lon !== "number") fail("Invalid stop");
    return {
      id: string(stop.id),
      name: string(stop.name),
      position: { lat, lon },
      routeIds: strings(stop.routeIds),
      providerId: provider,
      providerIds: Array.isArray(stop.providerIds) ? strings(stop.providerIds) : [provider],
      aliases: strings(stop.aliases),
      sourceStopIds: Array.isArray(stop.sourceStopIds) ? strings(stop.sourceStopIds) : [string(stop.id)],
    };
  });
  const routes = array(root.routes).map((value): LocalRoute => {
    const route = object(value);
    return {
      id: string(route.id),
      number: string(route.number),
      name: string(route.name),
      providerId: string(route.providerId) || "viabusz",
      directions: array(route.directions).map((entry) => {
        const direction = object(entry);
        return {
          id: string(direction.id),
          name: string(direction.name),
          stopIds: strings(direction.stopIds),
          restrictedService: direction.restrictedService === true,
        };
      }),
    };
  });
  const trips = array(root.trips).map((value): LocalTrip => {
    const trip = object(value);
    return {
      id: string(trip.id),
      routeId: string(trip.routeId),
      directionId: string(trip.directionId),
      calendar: string(trip.calendar) || "working_days",
      stopTimes: array(trip.stopTimes).map((entry) => {
        const time = object(entry);
        if (typeof time.minuteOfDay !== "number" || !Number.isInteger(time.minuteOfDay)) fail("Invalid time");
        return { stopId: string(time.stopId), minuteOfDay: time.minuteOfDay };
      }),
    };
  });
  const routeIds = new Set(routes.map((route) => route.id)),
    stopIds = new Set(stops.map((stop) => stop.id));
  if (!stops.length || !routes.length) fail("Empty network");
  if (routeIds.size !== routes.length || stopIds.size !== stops.length) fail("Duplicate network IDs");
  if (!routes.every((route) => route.directions.length && route.directions.every((d) => d.stopIds.length > 1 && d.stopIds.every((id) => stopIds.has(id)))))
    fail("Invalid route");
  if (!stops.every((stop) => stop.routeIds.every((id) => routeIds.has(id)))) fail("Invalid stop routes");
  const byRoute = new Map(routes.map((route) => [route.id, route]));
  if (
    !trips.every(
      (trip) =>
        routeIds.has(trip.routeId) &&
        trip.stopTimes.length > 1 &&
        trip.stopTimes.every((time) => stopIds.has(time.stopId) && time.minuteOfDay >= 0 && time.minuteOfDay <= 2879) &&
        trip.stopTimes.every((time, i) => i === 0 || trip.stopTimes[i - 1]!.minuteOfDay <= time.minuteOfDay) &&
        byRoute
          .get(trip.routeId)!
          .directions.some((d) => d.id === trip.directionId && d.stopIds.join("\u0000") === trip.stopTimes.map((time) => time.stopId).join("\u0000")),
    )
  )
    fail("Invalid trip sequence");
  const dates = object(root.providerServiceDates);
  const fetchedAt = Date.parse(string(root.fetchedAt));
  if (!Number.isFinite(fetchedAt)) fail("Invalid fetch time");
  return {
    stops,
    routes,
    trips,
    fetchedAt,
    source: string(root.source),
    serviceDate: string(root.serviceDate) || null,
    providerServiceDates: Object.fromEntries(Object.keys(dates).map((key) => [key, string(dates[key]) || null])),
    providerWarnings: {},
    warning: null,
    verifiedProviderIds: new Set(strings(root.verifiedProviderIds)),
  };
}

/** SharedStops: reviewed physical platforms shared between operators (docs/KOZOS-MEGALLOK.md). */
const SHARED_ALIASES: Record<string, string> = {
  "kanyargo:29": "1",
  "kanyargo:30": "1",
  "kanyargo:50": "2",
  "kanyargo:48": "67",
  "kanyargo:51": "10",
  "kanyargo:42": "26",
};
export const canonicalStopId = (id: string) => SHARED_ALIASES[id] ?? id;

function mergeShared(network: LocalNetwork): LocalNetwork {
  const groups = new Map<string, LocalStop[]>();
  for (const stop of network.stops) {
    const id = canonicalStopId(stop.id);
    groups.set(id, [...(groups.get(id) ?? []), stop]);
  }
  const unique = <T,>(values: T[]) => [...new Set(values)];
  const stops = [...groups].map(([id, members]) => {
    const primary = members.find((stop) => stop.id === id) ?? members[0]!;
    return {
      ...primary,
      id,
      routeIds: unique(members.flatMap((stop) => stop.routeIds)),
      providerIds: unique(members.flatMap((stop) => stop.providerIds)),
      aliases: unique(members.flatMap((stop) => [stop.name, ...stop.aliases])).filter((name) => name !== primary.name),
      sourceStopIds: unique(members.flatMap((stop) => stop.sourceStopIds)),
    };
  });
  const routes = network.routes.map((route) => ({
    ...route,
    directions: route.directions.map((direction) => ({ ...direction, stopIds: direction.stopIds.map(canonicalStopId) })),
  }));
  const trips = network.trips.map((trip) => ({
    ...trip,
    stopTimes: trip.stopTimes.map((time) => ({ ...time, stopId: canonicalStopId(time.stopId) })),
  }));
  return { ...network, stops, routes, trips };
}

/** NetworkMerger.merge: provider IDs and dates stay independent, so one outage cannot invalidate another. */
export function mergeNetworks(networks: LocalNetwork[]): LocalNetwork {
  if (!networks.length) fail("No network");
  const dates: Record<string, Day | null> = {};
  const warnings: Record<string, string> = {};
  for (const network of networks)
    for (const provider of new Set(network.routes.map((route) => route.providerId))) {
      dates[provider] = provider in network.providerServiceDates ? network.providerServiceDates[provider]! : network.serviceDate;
      const warning = network.providerWarnings[provider] ?? network.warning;
      if (warning) warnings[provider] = warning;
    }
  const stops = networks.flatMap((network) => network.stops);
  const routes = networks.flatMap((network) => network.routes);
  if (new Set(stops.map((stop) => stop.id)).size !== stops.length || new Set(routes.map((route) => route.id)).size !== routes.length)
    fail("Duplicate network IDs");
  const distinctDates = [...new Set(Object.values(dates).filter((day): day is Day => day !== null))];
  const allWarnings = [...new Set(networks.map((network) => network.warning).filter((w): w is string => !!w))];
  return mergeShared({
    stops,
    routes,
    trips: networks.flatMap((network) => network.trips),
    fetchedAt: Math.max(...networks.map((network) => network.fetchedAt)),
    source: [...new Set(networks.map((network) => network.source))].join("; "),
    serviceDate: distinctDates.length === 1 ? distinctDates[0]! : null,
    providerServiceDates: dates,
    providerWarnings: warnings,
    warning: allWarnings.length ? allWarnings.join("\n") : null,
    verifiedProviderIds: new Set(networks.flatMap((network) => [...network.verifiedProviderIds])),
  });
}

/** TransitRepository providers: public websites, no authentication or keys. */
export const LOCAL_PROVIDERS = [
  {
    id: "viabusz",
    name: "ViaBusz",
    url: "https://viabusz.biatorbagy.hu/",
    asset: "viabusz-calendar-network.json",
    page: "",
    school: "documents/viabusz-menetrend-tanitas-261001.pdf",
    holiday: "documents/viabusz-menetrend-szunet-260901.pdf",
    schoolSha: "546466bd8d5a0afe0396015dc43252979995a7bce98346a9c9b063e63e65deb0",
    holidaySha: "e18278f78baf63477af6737debf9352a5e3feecd869c354d5325299a0224a846",
    numbers: ["1", "1P", "2", "3", "4"],
  },
  {
    id: "kanyargo",
    name: "KanyarGO",
    url: "https://kanyargo.paty.hu/",
    asset: "kanyargo-network.json",
    page: "Menetrend",
    school: "documents/menetrend-KanyarGO-2026-szept-1-tol.pdf",
    holiday: "documents/menetrend-KanyarGO-2026-aug-10-tanszuneti.pdf",
    schoolSha: "866231b9e84d16f16cde34b11adc67682cc049a360ed7f41ae430e7e7f1cdd66",
    holidaySha: "60f7e5db621e456fb63e747fe8ca204e0fd58b744d75ba2897ba3aaae6330e98",
    numbers: ["1A", "1D", "1J", "1M", "1MT", "1MV", "1T", "1V"],
  },
  {
    id: "homm",
    name: "HOMM",
    url: "https://homm.hu/",
    asset: "homm-network.json",
    page: "helyi-kozlekedes/",
    school: "www/menetrend-budaors/Közlekedési rend tanítási napokon.pdf",
    holiday: "www/menetrend-budaors/Közlekedési rend tanítási szünetben.pdf",
    schoolSha: "c7fb61b7abbc6fbf1fc65b828870c8fe2d805dc3e6b2f03f4bdb05a505b0ff82",
    holidaySha: "792cc9db653af9c453ade424075568f55098ca5a2a6fac8028374e66d902d593",
    numbers: ["288", "289"],
  },
] as const;
export type LocalProvider = (typeof LOCAL_PROVIDERS)[number];

/** Android data_* strings (values/strings.xml). */
export const localWarnings = {
  networkUnavailable: (name: string) =>
    `${name}: a hálózat nem érhető el. A mentett megállók és útvonalak láthatók; az indulásokhoz ma ellenőrzött menetrend szükséges.`,
  sourceChanged: (name: string) =>
    `${name}: a hivatalos menetrend megváltozott. A megállók és útvonalak elérhetők; a menetrendi indulások ellenőrzött frissítésre várnak.`,
  calendarUnreviewed: (name: string, year: number) =>
    `${name}: a ${year}. évi közlekedési naptár még nincs ellenőrizve. A megállók és útvonalak elérhetők.`,
  noVerifiedTimetable: (name: string) => `${name}: mára nincs ellenőrzött menetrend. A megállók és útvonalak elérhetők.`,
  noServiceToday: (name: string) =>
    `${name}: az ellenőrzött naptár szerint ma nincs menetrendi közlekedés. A megállók és útvonalak elérhetők.`,
};

const activeToday = (provider: string, day: Day) =>
  (provider === "homm" ? hommCalendar(day) : provider === "viabusz" ? viabuszCalendar(day) : kanyargoCalendar(day)) !== null;

/** TransitRepository.checkedDate: a provider's countdowns need today's verified date and an active calendar. */
export function checkedDate(network: LocalNetwork, provider: LocalProvider, now: number): LocalNetwork {
  const today = budapestDay(now);
  const saved = provider.id in network.providerServiceDates ? network.providerServiceDates[provider.id] : network.serviceDate;
  const active = activeToday(provider.id, today);
  const valid = saved === today && active;
  const year = Number(today.slice(0, 4));
  const warning = valid
    ? null
    : !isYearReviewed(year)
      ? localWarnings.calendarUnreviewed(provider.name, year)
      : today < "2026-09-01"
        ? localWarnings.noVerifiedTimetable(provider.name)
        : !active
          ? localWarnings.noServiceToday(provider.name)
          : localWarnings.noVerifiedTimetable(provider.name);
  return {
    ...network,
    serviceDate: valid ? today : null,
    providerServiceDates: { [provider.id]: valid ? today : null },
    warning,
    providerWarnings: warning ? { [provider.id]: warning } : {},
  };
}

async function sha256(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The operator's active timetable documents, as each provider's validateNetwork reads its page. */
export function activeDocumentsMatch(provider: LocalProvider, html: string, today: Day): boolean {
  const document = new DOMParser().parseFromString(html, "text/html");
  const base = provider.url + provider.page;
  const absolute = (href: string) => {
    try {
      return new URL(href, base).href.split("?")[0]!.split("#")[0]!;
    } catch {
      return "";
    }
  };
  const school = provider.url + provider.school,
    holiday = provider.url + provider.holiday;
  if (provider.id === "viabusz") {
    const links = new Set(
      [...document.querySelectorAll(".dropdown-content a[href], a.mobileMenu[href]")]
        .map((a) => absolute(a.getAttribute("href") ?? ""))
        .filter((href) => href.toLowerCase().endsWith(".pdf")),
    );
    // Check the timetable menu, not old links kept in historical news articles.
    return links.size === 2 && links.has(school) && links.has(holiday);
  }
  if (provider.id === "kanyargo") {
    const links = [...document.querySelectorAll(".tmtbl-cnt a[href]")]
      .map((a) => (a.getAttribute("href") ?? "").split("?")[0]!)
      .filter((href) => href.toLowerCase().endsWith(".pdf"));
    return (
      links.length > 0 &&
      links.every((href) => href === school || href === holiday) &&
      (kanyargoCalendar(today) !== "school_term" || links.some((href) => href.endsWith(provider.school)))
    );
  }
  const known = new Set([
    school,
    holiday,
    ...["Átszállási időpontok.pdf", "288 Budaörs ltp - Kamaraerdői Iglói köz.pdf", "288 Kamaraerdő Iglói köz - Budaörs ltp.pdf", "289 Budaörsi ltp - Ötvös utca.pdf", "289 Ötvös utca - Budaörsi ltp.pdf"].map(
      (name) => `${provider.url}www/menetrend-budaors/${name}`,
    ),
  ]);
  const links = new Set(
    [...document.querySelectorAll("a[href]")]
      .map((a) => {
        try {
          return decodeURIComponent(absolute(a.getAttribute("href") ?? "").replace(/\+/g, "%2B"));
        } catch {
          return "";
        }
      })
      .filter((href) => href.startsWith(`${provider.url}www/menetrend-budaors/`) && href.toLowerCase().endsWith(".pdf")),
  );
  return links.has(school) && links.has(holiday) && [...links].every((href) => known.has(href));
}

export class SourceChanged extends Error {}

/**
 * The provider's validateNetwork: today's operator page lists exactly the reviewed documents and both
 * PDFs still have the reviewed fingerprints. Browsers can only do this where the operator allows CORS;
 * a network/CORS failure is reported like Android's IOException branch (fail closed).
 */
export async function verifyProvider(provider: LocalProvider, base: LocalNetwork, now: number, signal: AbortSignal): Promise<LocalNetwork> {
  const get = async (path: string) => {
    const response = await fetch(provider.url + path, { mode: "cors", credentials: "omit", cache: "no-store", signal });
    if (!response.ok) throw new TypeError(`HTTP ${response.status}`);
    return response;
  };
  const [page, school, holiday] = await Promise.all([
    get(provider.page).then((response) => response.text()),
    get(provider.school).then((response) => response.arrayBuffer()).then(sha256),
    get(provider.holiday).then((response) => response.arrayBuffer()).then(sha256),
  ]);
  const today = budapestDay(now);
  const numbers = new Set(base.routes.map((route) => route.number));
  if (!base.routes.every((route) => route.providerId === provider.id) || numbers.size !== provider.numbers.length || !provider.numbers.every((n) => numbers.has(n)))
    throw new SourceChanged("Route set changed");
  if (provider.id === "viabusz" && !base.trips.every((trip) => trip.calendar === "school_term" || trip.calendar === "school_break"))
    throw new SourceChanged("ViaBusz requires reviewed school and holiday tables");
  if (school !== provider.schoolSha || holiday !== provider.holidaySha) throw new SourceChanged("Timetable document changed");
  if (!activeDocumentsMatch(provider, page, today)) throw new SourceChanged("Active timetable changed");
  const date = activeToday(provider.id, today) ? today : null;
  return { ...base, fetchedAt: now, serviceDate: date, providerServiceDates: { [provider.id]: date }, warning: null, verifiedProviderIds: new Set([provider.id]) };
}

const bundled = new Map<string, Promise<LocalNetwork>>();
/** Bundled timetables are immutable static assets: decode each once, lazily. */
export function bundledNetwork(provider: LocalProvider, signal?: AbortSignal) {
  let loading = bundled.get(provider.id);
  if (!loading) {
    loading = fetch(`/transit/local/${provider.asset}`, { signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<Row>;
      })
      .then(decodeNetwork);
    loading.catch(() => bundled.delete(provider.id));
    bundled.set(provider.id, loading);
  }
  return loading;
}

/** Today's verified networks; a day's verification is reused like Android's same-day cache file. */
const verified = new Map<string, { day: Day; network: Promise<LocalNetwork> }>();

/** TransitRepository.loadProvider(requireVerification = true) */
async function loadProvider(provider: LocalProvider, now: number, signal: AbortSignal, verify: typeof verifyProvider): Promise<LocalNetwork> {
  const day = budapestDay(now);
  const saved = verified.get(provider.id);
  if (saved?.day === day) {
    try {
      return checkedDate(await saved.network, provider, now);
    } catch {
      verified.delete(provider.id);
    }
  }
  const base = await bundledNetwork(provider, signal);
  try {
    const network = verify(provider, base, now, signal);
    verified.set(provider.id, { day, network });
    return checkedDate(await network, provider, now);
  } catch (failure) {
    verified.delete(provider.id);
    if (signal.aborted) throw failure;
    const fallback = checkedDate(base, provider, now);
    // A source format/version change invalidates even a same-day countdown.
    if (failure instanceof SourceChanged) {
      const warning = localWarnings.sourceChanged(provider.name);
      return { ...fallback, fetchedAt: now, serviceDate: null, providerServiceDates: { [provider.id]: null }, verifiedProviderIds: new Set(), warning, providerWarnings: { [provider.id]: warning } };
    }
    const warning = localWarnings.networkUnavailable(provider.name);
    return { ...fallback, warning, providerWarnings: { [provider.id]: warning } };
  }
}

/** TransitRepository.planningNetwork: every provider loaded independently, then merged. */
export async function planningNetwork(signal: AbortSignal, now = Date.now(), verify = verifyProvider): Promise<LocalNetwork> {
  return mergeNetworks(await Promise.all(LOCAL_PROVIDERS.map((provider) => loadProvider(provider, now, signal, verify))));
}

/** Clears same-day verification (tests and a forced refresh). */
export function resetLocalNetworks() {
  verified.clear();
}

export const isWorkingDay = isConfirmedWorkingDay;
