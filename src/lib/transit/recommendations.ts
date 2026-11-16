import type { GeoPoint } from "~/lib/places";
import type { Stop } from "./model";

/** TransitSearch.normalize: accents removed, lowercase. */
export function searchNormalize(text: string) {
  return text.trim().normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
}

const MODE_ALIASES = new Set([
  "villamos", "tram", "troli", "trolibusz", "trolley", "trolleybus", "busz", "autobusz", "bus", "coach",
  "hev", "suburban", "metro", "subway", "vonat", "train",
]);
const PROVIDERS = new Set(["volan", "bkk", "viabusz", "kanyargo", "homm", "mav"]);

/** TransitSearch.query: normalized text, plain terms, whether a mode word was used, and a provider word. */
export function searchQuery(text: string) {
  const normalized = searchNormalize(text).replace(/\b([a-z]?\d+[a-z]?)-(?:es|as|os)\b/g, "$1");
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const provider = tokens.find((token) => PROVIDERS.has(token));
  return {
    text: normalized,
    terms: tokens.filter((token) => !MODE_ALIASES.has(token) && token !== provider),
    modes: tokens.some((token) => MODE_ALIASES.has(token)),
    provider,
  };
}

const HUBS = ["keleti", "kelenfold", "nyugati", "deli"];
const SHORTHAND: Record<string, string> = { kelen: "kelenfold", kelenfoldi: "kelenfold", kelet: "keleti" };
const STATION_WORDS = new Set(["palyaudvar", "vasutallomas", "allomas", "pu", "pu."]);

const words = (name: string) => name.split(/[ ,\-()]/).filter(Boolean);
const isRail = (stop: Stop) =>
  stop.mode === "RAIL" || stop.mode === "TRAMTRAIN" || stop.id.startsWith("emma:1:");
const providers = (stop: Stop) =>
  isRail(stop) ? ["mav"] : stop.id.startsWith("emma:hkir:") ? ["volan"] : ["bkk"];

/** One insertion, deletion, substitution or adjacent transposition. */
function nearWord(a: string, b: string) {
  if (b.length < 4 || !b.startsWith(a.charAt(0)) || Math.abs(a.length - b.length) > 1) return false;
  let i = 0,
    j = 0,
    edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else if (i + 1 < a.length && a[i] === b[j + 1] && a[i + 1] === b[j]) {
      i += 2;
      j += 2;
    } else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/**
 * StationRecommendations.stops: a separate suggestion layer over the found stations. Exact and prefix word
 * matches, railway stations, hubs for generic words ("pályaudvar") and favourites score higher; one typo is
 * tolerated; ties go to the nearest. Literal results are never replaced, only led by the recommendation.
 */
export function recommendStations(
  stops: Stop[],
  text: string,
  location: GeoPoint | null,
  favorites: string[],
) {
  const query = searchQuery(text);
  if (query.text.length < 3 || query.terms.length === 0 || query.modes) return [];
  const terms = query.terms.map(
    (term) => SHORTHAND[term] ?? (term.startsWith("palyaudvar") ? "palyaudvar" : term),
  );
  const generic = terms.every((term) => STATION_WORDS.has(term));
  const best = new Map<string, { stop: Stop; score: number; distance: number }>();
  for (const stop of stops) {
    if (query.provider && !providers(stop).includes(query.provider)) continue;
    const name = searchNormalize(stop.name);
    const entryText = searchNormalize(`${stop.name} ${stop.platform}`);
    const entryWords = words(name);
    const rail = isRail(stop);
    const hub = HUBS.find((key) => entryWords.some((word) => word.startsWith(key)));
    let quality = 0,
      rejected = false;
    for (const term of terms) {
      const inText = entryText.includes(term);
      if (STATION_WORDS.has(term) && (rail || hub || entryWords.some((word) => STATION_WORDS.has(word)))) quality += 20;
      else if (inText && entryWords.includes(term)) quality += 50;
      else if (inText && entryWords.some((word) => word.startsWith(term))) quality += 40;
      else if (inText) quality += 30;
      else if (term.length >= 4 && entryWords.some((word) => nearWord(term, word))) quality += 10;
      else {
        rejected = true;
        break;
      }
    }
    if (rejected) continue;
    const group = hub ?? name;
    const score =
      quality +
      (rail ? 18 : 0) +
      (!stop.platform ? 12 : 0) +
      (favorites.includes(stop.id) ? 5 : 0) +
      (generic && hub ? 120 - HUBS.indexOf(hub) * 40 : 0);
    const distance = location
      ? (stop.position.lat - location.lat) ** 2 + (stop.position.lon - location.lon) ** 2
      : 0;
    const previous = best.get(group);
    if (!previous || score > previous.score || (score === previous.score && distance < previous.distance))
      best.set(group, { stop, score, distance });
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score || a.distance - b.distance)
    .slice(0, 3)
    .map((candidate) => candidate.stop);
}
