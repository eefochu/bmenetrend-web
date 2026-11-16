import { MercatorCoordinate } from "maplibre-gl";

/** Fit the whole highlighted line, centring on the canvas when it clears the card,
 * otherwise moving it only as far as needed into the unobstructed map area. */
export function routeCamera(
  points: readonly (readonly [number, number])[],
  width: number,
  height: number,
  left: number,
  bottom: number,
) {
  const margin = Math.min(
    48,
    Math.max(24, Math.min(width - left, height - bottom) * 0.08),
  );
  const safe = {
    left: left + margin,
    right: width - margin,
    top: left > 0 ? margin : 96,
    bottom: height - bottom - margin,
  };
  const availableWidth = safe.right - safe.left,
    availableHeight = safe.bottom - safe.top;
  // An almost-full-screen sheet leaves no useful route overview. Keep the camera
  // until the sheet is lowered instead of zooming out into an unusable sliver.
  if (availableWidth < 64 || availableHeight < 64) return null;
  let west = Infinity,
    east = -Infinity,
    north = Infinity,
    south = -Infinity;
  for (const [lng, lat] of points) {
    if (
      !Number.isFinite(lng) ||
      !Number.isFinite(lat) ||
      Math.abs(lat) > 85.051129
    )
      continue;
    const point = MercatorCoordinate.fromLngLat([lng, lat]);
    west = Math.min(west, point.x);
    east = Math.max(east, point.x);
    north = Math.min(north, point.y);
    south = Math.max(south, point.y);
  }
  if (!Number.isFinite(west)) return null;
  const zoom = Math.min(
    16,
    Math.log2(availableWidth / (512 * (east - west))),
    Math.log2(availableHeight / (512 * (south - north))),
  );
  const worldSize = 512 * 2 ** zoom;
  const routeWidth = (east - west) * worldSize,
    routeHeight = (south - north) * worldSize;
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value));
  const x = clamp(
    width / 2,
    safe.left + routeWidth / 2,
    safe.right - routeWidth / 2,
  );
  const y = clamp(
    height / 2,
    safe.top + routeHeight / 2,
    safe.bottom - routeHeight / 2,
  );
  // Retain only the existing overlay padding; margins are used for fitting once.
  const center = new MercatorCoordinate(
    (west + east) / 2 + ((width + left) / 2 - x) / worldSize,
    (north + south) / 2 + ((height - bottom) / 2 - y) / worldSize,
  ).toLngLat();
  return {
    key: [west, east, north, south, width, height, left, bottom].join(":"),
    center: [center.lng, center.lat] as [number, number],
    zoom,
    bearing: 0,
    pitch: 0,
    padding: { top: 0, right: 0, left, bottom },
  };
}
