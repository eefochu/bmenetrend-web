import { serviceStyle } from "./badges";
import type { Route, Stop, Vehicle } from "./model";

/**
 * Operator and service labels from ViaBuszScreen.kt providerName/transportLabel and RouteSummary.kt
 * serviceTypeLabel, so panels describe a stop or line the way the Android app does.
 */
export type ProviderId = "bkk" | "mav" | "hev" | "volan" | "viabusz" | "kanyargo" | "homm";
const LOCAL = new Set(["viabusz", "kanyargo", "homm"]);

export function routeProvider(route?: Route): ProviderId {
  if (route?.provider && LOCAL.has(route.provider)) return route.provider as ProviderId;
  const mode = route?.mode;
  if (mode === "RAIL" || mode === "TRAMTRAIN") return "mav";
  if (mode === "SUBURBAN_RAILWAY") return "hev";
  if (route?.id.startsWith("volan_") || route?.id.startsWith("emma:hkir:"))
    return "volan";
  return "bkk";
}

export function stopProviders(stop: Stop): ProviderId[] {
  const fromRoutes = stop.routes.map(routeProvider);
  if (fromRoutes.length) return [...new Set(fromRoutes)];
  if (stop.mode === "RAIL" || stop.mode === "TRAMTRAIN") return ["mav"];
  if (stop.mode === "SUBURBAN_RAILWAY") return ["hev"];
  if (stop.rawId.startsWith("volan_")) return ["volan"];
  return ["bkk"];
}

const PROVIDER_NAMES: Record<ProviderId, string> = {
  mav: "MÁV / GYSEV",
  hev: "MÁV-HÉV",
  volan: "Volán",
  bkk: "BKK",
  viabusz: "ViaBusz",
  kanyargo: "KanyarGO",
  homm: "HOMM",
};

export const providerName = (id: ProviderId) => PROVIDER_NAMES[id];
export const providerNames = (ids: ProviderId[]) =>
  [...new Set(ids)].map(providerName).join(" · ");

export function transportLabel(mode?: string): string | undefined {
  switch (mode) {
    case "TRAM":
      return "Villamos";
    case "TROLLEYBUS":
      return "Trolibusz";
    case "SUBWAY":
      return "Metró";
    case "BUS":
    case "COACH":
      return "Busz";
    case "SUBURBAN_RAILWAY":
      return "HÉV";
    case "RAIL":
    case "TRAMTRAIN":
      return "Vonat";
    default:
      return undefined;
  }
}

/** TransportServiceType.of + serviceTypeLabel. */
export function serviceTypeLabel(route?: Route): string {
  switch (route?.mode) {
    case "TRAM":
      return "Villamos";
    case "TROLLEYBUS":
      return "Trolibusz";
    case "SUBWAY":
      return "Metró";
    case "SUBURBAN_RAILWAY":
      return "HÉV";
    case "RAIL":
    case "TRAIN":
    case "TRAMTRAIN":
      return "Vonat";
    case "FERRY":
      return "Hajó";
  }
  const provider = routeProvider(route);
  return provider === "volan" ? "Regionális / helyközi busz" : LOCAL.has(provider) ? "Helyi busz" : "Városi busz";
}

/** The stop's own identifier for EMMA stops (ViaBuszScreen.kt stopLabel). */
export function boardingInfo(stop: Stop): string | undefined {
  if (stop.platform) return undefined;
  if (stop.id.startsWith("emma:"))
    return `Megálló: ${stop.id.slice(stop.id.lastIndexOf(":") + 1)}`;
  return undefined;
}

export function stopSubtitle(stop: Stop): string {
  return [
    providerNames(stopProviders(stop)),
    transportLabel(stop.mode),
    boardingInfo(stop),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function formatDistance(meters: number) {
  return meters < 1000
    ? `${Math.round(meters)} m`
    : `${(meters / 1000).toFixed(1).replace(".", ",")} km`;
}

/**
 * LineComponents.kt lineColor(providerId, transportMode, markerColor) as VehiclePanel and the map use it
 * for a selected vehicle: no line number, so trains get the generic rail blue rather than their S/G colour;
 * metro and HÉV keep their line colour, other modes their mode colour.
 */
export function vehicleLineColor(vehicle: Vehicle) {
  const mode = vehicle.mode ?? vehicle.route?.mode;
  if ((mode === "SUBWAY" || mode === "SUBURBAN_RAILWAY") && vehicle.route)
    return serviceStyle(vehicle.route).background;
  if (mode === "TRAM") return "#FFD800";
  if (mode === "TROLLEYBUS") return "#E31B23";
  if (mode === "SUBWAY" || mode === "RAIL" || mode === "SUBURBAN_RAILWAY" || mode === "TRAMTRAIN")
    return "#0066AA";
  const local = { viabusz: "#205C48", kanyargo: "#6750A4", homm: "#BF5700" }[vehicle.provider ?? ""];
  if (local) return local;
  return routeProvider(vehicle.route) === "volan" ? "#F9B900" : "#199DCF";
}
