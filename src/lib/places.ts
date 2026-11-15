// Port of data/PlacesRepository.kt and data/PlaceSearch.kt: Photon geocoding limited to Hungary.

export type GeoPoint = { lat: number; lon: number };
export type MapBounds = { west: number; south: number; east: number; north: number };
export type PlaceResult = {
  id: string;
  name: string;
  address: string;
  position: GeoPoint;
  bounds?: MapBounds;
};

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX", "XXI", "XXII", "XXIII"];
const DISTRICT_1 = /^(\d{1,2}|[ivx]+)\.?\s*(?:kerulet|ker\.?|district)$/;
const DISTRICT_2 = /^district\s+(\d{1,2}|[ivx]+)\.?$/;

/** TransitSearch.normalize: case- and accent-insensitive comparison text. */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function district(text: string): number | null {
  const normalized = normalize(text).replace(/^budapest/, "").trim();
  const match = DISTRICT_1.exec(normalized) ?? DISTRICT_2.exec(normalized);
  if (!match?.[1]) return null;
  const number = Number.parseInt(match[1], 10) || ROMAN.indexOf(match[1].toUpperCase()) + 1;
  return number >= 1 && number <= 23 ? number : null;
}

export function placeQuery(text: string): string {
  const number = district(text);
  return number ? `Budapest ${ROMAN[number - 1]}. kerület` : text.trim();
}

type PhotonFeature = {
  geometry?: { type?: string; coordinates?: number[] };
  properties?: Record<string, unknown>;
};

function parse(json: unknown, query: string): PlaceResult[] {
  const features = (json as { features?: PhotonFeature[] }).features ?? [];
  const requested = district(query);
  const results: PlaceResult[] = [];
  for (const feature of features) {
    const p = feature.properties;
    if (!p) continue;
    const value = (key: string) => {
      const raw = p[key];
      if (raw == null) return undefined;
      const text = typeof raw === "string" ? raw : typeof raw === "number" ? String(raw) : "";
      return text.trim() && text !== "null" ? text : undefined;
    };
    if (value("countrycode")?.toUpperCase() !== "HU") continue;
    if (feature.geometry?.type !== "Point") continue;
    const [lon, lat] = feature.geometry.coordinates ?? [];
    if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < 45.7 || lat > 48.6 || lon < 16.1 || lon > 22.9) continue;
    const streetLine = [value("street"), value("housenumber")].filter(Boolean).join(" ");
    const name = value("name") ?? (streetLine || undefined);
    if (!name) continue;
    if (requested != null && value("type") === "district" && district(name) !== requested) continue;
    let bounds: MapBounds | undefined;
    const extent = p.extent;
    if (Array.isArray(extent) && extent.length === 4) {
      const [west, north, east, south] = extent as number[];
      if (
        [west, north, east, south].every((n) => typeof n === "number" && Number.isFinite(n)) &&
        west! < east! && south! < north! && west! >= 16.1 && east! <= 22.9 && south! >= 45.7 && north! <= 48.6
      ) bounds = { west: west!, south: south!, east: east!, north: north! };
    }
    const city = value("city");
    const address = [
      streetLine && streetLine !== name ? streetLine : undefined,
      value("district") !== name ? value("district") : undefined,
      city !== name ? city : undefined,
      city == null && value("county") !== name ? value("county") : undefined,
      value("postcode"),
    ].filter((item): item is string => Boolean(item));
    results.push({
      id: `${value("osm_type") ?? "point"}:${value("osm_id") ?? `${lat},${lon}`}`,
      name,
      address: [...new Set(address)].join(" · "),
      position: { lat, lon },
      bounds,
    });
  }
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const unique = results.filter((place) => {
    const key = `${normalize(place.name)}|${normalize(place.address)}`;
    if (seenIds.has(place.id) || seenNames.has(key)) return false;
    seenIds.add(place.id);
    seenNames.add(key);
    return true;
  });
  if (requested == null) return unique;
  return unique.sort((a, b) => Number(district(b.name) === requested) - Number(district(a.name) === requested));
}

const memory = new Map<string, PlaceResult[]>();
let lastRequest = 0;

/** Immediate hit for search-as-you-type; never performs network work. */
export function cachedPlaces(raw: string): PlaceResult[] | undefined {
  return memory.get(placeQuery(raw));
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

/** One request per second at most, as Android's repository enforces for the public Photon instance. */
export async function searchPlaces(raw: string, signal: AbortSignal): Promise<PlaceResult[]> {
  const query = placeQuery(raw);
  const hit = memory.get(query);
  if (hit) return hit;
  await wait(Math.max(0, 1000 - (Date.now() - lastRequest)), signal);
  lastRequest = Date.now();
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "20");
  url.searchParams.set("bbox", "16.1,45.7,22.9,48.6");
  url.searchParams.set("lat", "47.4979");
  url.searchParams.set("lon", "19.0402");
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Place search HTTP ${response.status}`);
  const results = parse(await response.json(), query);
  memory.set(query, results);
  if (memory.size > 64) memory.delete(memory.keys().next().value!);
  return results;
}

/** Haversine distance, as StopClusters.distanceMeters. */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/** SearchComponents.kt formatStopDistance. */
export function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.floor(meters)} m` : `${(meters / 1000).toLocaleString("hu-HU", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} km`;
}
