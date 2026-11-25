import type { Route } from "./model";

/** LineComponents.kt / VehicleMarkerStyle.kt: shared native service colours and artwork. */
export function railColor(number: string) {
  const value = number.trim().toUpperCase();
  if (value.startsWith("IR")) return "#008001";
  if (/^G\d/.test(value) || value === "G") return "#A9CD45";
  if (/^S\d/.test(value)) return "#00AFEF";
  if (/^Z\d/.test(value) || value === "Z") return "#FECD28";
  return "#2E5EA7";
}
export function badgeTextColor(background: string) {
  const rgb = background
    .replace("#", "")
    .match(/.{2}/g)
    ?.map((part) => parseInt(part, 16) / 255) ?? [0, 0, 0];
  const linear = rgb.map((v) =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  );
  const light = linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
  if (1.05 / (light + 0.05) >= 4.5) return "#ffffff";
  return (light + 0.05) / 0.061 >= 4.5 ? "#171B20" : "#000000";
}
export function emblem(route?: Route, ui = true) {
  const name = route?.name.trim().toUpperCase() ?? "";
  if (route?.mode === "SUBWAY" && /^M?[1-4]$/.test(name))
    return `/transit/${ui ? "ui_" : ""}metro_m${name.replace("M", "")}.png`;
  if (route?.mode === "SUBURBAN_RAILWAY" && /^H[5-9]/.test(name))
    return `/transit/${ui ? "ui_" : ""}hev_h${name[1]}.png`;
  return "";
}
export function transport(route?: Route) {
  const mode = route?.mode;
  if (mode === "TRAM") return { asset: "vehicle_tram", color: "#FFD800" };
  if (mode === "TROLLEYBUS")
    return { asset: "vehicle_trolley", color: "#E31B23" };
  if (["RAIL", "TRAMTRAIN", "SUBWAY", "SUBURBAN_RAILWAY"].includes(mode ?? ""))
    return { asset: "vehicle_train", color: "#0066AA" };
  if (route?.id.startsWith("volan_") || route?.id.startsWith("emma:hkir:"))
    return { asset: "vehicle_volan_bus", color: "#F9B900" };
  // VehicleMarkerStyle / StopMarkerLayout.color: the local operators' own colours and artwork.
  if (route?.provider === "viabusz") return { asset: "vehicle_viabusz_bus", color: "#205C48" };
  if (route?.provider === "kanyargo") return { asset: "vehicle_kanyargo_bus", color: "#6750A4" };
  if (route?.provider === "homm") return { asset: "vehicle_homm_bus", color: "#BF5700" };
  return { asset: "vehicle_bkk_bus", color: "#199DCF" };
}
export function serviceStyle(route?: Route) {
  const rail = route?.mode === "RAIL" || route?.mode === "TRAMTRAIN";
  const background = rail
    ? railColor(route.name)
    : route && ["SUBWAY", "SUBURBAN_RAILWAY"].includes(route.mode)
      ? route.color
      : transport(route).color;
  const textColor =
    rail && (/^[SG]\d/i.test(route.name) || route.name === "G")
      ? "#ffffff"
      : badgeTextColor(background);
  return { background, color: textColor };
}

export function stationColor(route: Route) {
  if (route.mode === "SUBWAY") {
    return (
      (
        {
          "1": "#FFD800",
          "2": "#E41B13",
          "3": "#075DA4",
          "4": "#46A43B",
        } as Record<string, string>
      )[route.name.replace(/^M/i, "")] ?? "#0066AA"
    );
  }
  if (route.mode === "SUBURBAN_RAILWAY")
    return (
      (
        {
          "5": "#7B116B",
          "6": "#824B00",
          "7": "#EF7800",
          "8": "#EB6482",
          "9": "#EB6482",
        } as Record<string, string>
      )[route.name.replace(/^H/i, "")[0] ?? ""] ?? "#267D44"
    );
  return transport(route).color;
}
