// Match NativeTransitMap.kt in the sibling ../bmenetrend Android app.
export const INITIAL_CAMERA = {
  center: [18.825, 47.473] as [number, number],
  zoom: 13.2,
  maxZoom: 19,
};

export const MAP_STYLES = {
  // OpenFreeMap Liberty recoloured to the Android Google basemap palette (scripts/build-google-styles.mjs).
  light: "/map/google-light.json",
  dark: "/map/google-dark.json",
  // assets/map/satellite.json, copied unchanged.
  satellite: "/map/satellite.json",
};

export function mapStyleUrl(style: "street" | "satellite", dark: boolean) {
  if (style === "satellite") return MAP_STYLES.satellite;
  return dark ? MAP_STYLES.dark : MAP_STYLES.light;
}

/** ViaBuszScreen.kt: the sheet peeks at 36% of the screen, between 220 and 340 dp. */
export function sheetPeekHeight(screenHeight: number) {
  return Math.min(340, Math.max(220, screenHeight * 0.36));
}
