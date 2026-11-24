/** Port of ui/DestinationFormatter.kt: strips origin/via legs and formats clean terminal directions. */
const RAIL_TERMINALS = new Set(["budapest-déli", "budapest-keleti", "budapest-nyugati", "budapest-kelenföld", "budapest-józsefváros"]);
const COMMON_TOWNS = new Set([
  "etyek", "sóskút", "biatorbágy", "budaörs", "budakeszi", "páty", "zsámbék", "telki", "herceghalom", "bicske", "győr", "érd",
  "százhalombatta", "törökbálint", "pusztazámor", "tárnok", "diósd", "perbál", "tök", "budajenő", "nagykovácsi", "remeteszőlős",
  "solymár", "pilisvörösvár", "gödöllő", "vác", "szentendre", "dunakeszi", "fót", "monor", "cegléd", "vecsés", "gyál",
  "szigetszentmiklós", "budapest",
]);
const ARROW = /\s*(?:->|→)\s*/;
const SPACED_DASH = /\s+[-–—]\s+/;

export function resolveBudapestTerminal(routeNumber?: string | null) {
  const digits = (routeNumber ?? "").replace(/\D/g, "");
  const num = digits ? Number(digits) : null;
  if (num !== null && ((num >= 781 && num <= 795) || num === 22 || num === 222)) return "Budapest, Széll Kálmán tér";
  if (num !== null && num >= 300 && num <= 321) return "Budapest, Újpest-Városkapu";
  if (num !== null && num >= 800 && num <= 840) return "Budapest, Árpád híd";
  if (num !== null && num >= 400 && num <= 499) return "Budapest, Stadion autóbusz-pályaudvar";
  if (num !== null && num >= 600 && num <= 661) return "Budapest, Népliget";
  return "Budapest, Kelenföld vasútállomás";
}

function formatTownAndStop(text: string) {
  if (text.includes(",")) return text;
  const space = text.indexOf(" ");
  if (space > 0) {
    const town = text.slice(0, space).trim();
    let stop = text.slice(space + 1).trim();
    if (stop.startsWith("(") && stop.endsWith(")")) stop = stop.slice(1, -1).trim();
    if (COMMON_TOWNS.has(town.toLowerCase()) && stop) return `${town}, ${stop}`;
  }
  return text;
}

const isUpper = (char: string) => char !== char.toLowerCase() && char === char.toUpperCase();

export function cleanDestination(raw: string, routeNumber?: string | null): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (RAIL_TERMINALS.has(trimmed.toLowerCase())) return trimmed;
  let candidate: string;
  const arrowParts = trimmed.split(ARROW).filter((part) => part.trim());
  if (arrowParts.length > 1) candidate = arrowParts.at(-1)!.trim();
  else {
    const dashParts = trimmed.split(SPACED_DASH).filter((part) => part.trim());
    if (dashParts.length > 1) candidate = dashParts.at(-1)!.trim();
    else {
      // Only a chain of place names is split: a hyphen inside a stop name must not leave just its tail.
      const parts = trimmed.split("-").map((part) => part.trim()).filter(Boolean);
      const placeChain = parts.length >= 2 && parts.every((part) => !part.includes(",")) && parts.every((part) => isUpper(part[0]!));
      if (placeChain) {
        const lastTwo = `${parts.at(-2)}-${parts.at(-1)}`;
        candidate = RAIL_TERMINALS.has(lastTwo.toLowerCase()) ? lastTwo : parts.at(-1)!;
      } else candidate = trimmed;
    }
  }
  const formatted = formatTownAndStop(candidate);
  return formatted.toLowerCase() === "budapest" ? resolveBudapestTerminal(routeNumber) : formatted;
}

/** DestinationFormatter.clean(...).ifBlank { destination } */
export const shownDestination = (raw: string, routeNumber?: string | null) => cleanDestination(raw, routeNumber) || raw;
