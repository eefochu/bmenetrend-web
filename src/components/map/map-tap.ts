/**
 * Port of map/MapTapResolver.kt and the overlap rule of map/StopHitTesting.kt. Screen units are CSS
 * pixels, which correspond to Android dp (density 1).
 *
 * A tap inside a drawn marker is a direct hit; among direct hits the one tapped closest to its centre
 * (relative to its size) wins, so a tap on a bus parked at a stop picks whichever circle the pointer is
 * more clearly on. Only when nothing is hit directly does a nearby marker within the slop count,
 * nearest edge first. Vehicles and stops get the same slop.
 */
export type TapTarget = { id: string; x: number; y: number; radius: number };
export type TapHit = { kind: "vehicle" | "stop"; target: TapTarget };

/** Extra reach around a marker's edge for a tap that just misses it. */
export const SLOP = 10;
/** Small markers are still this easy to hit (radius). */
export const MIN_REACH = 22;
/** StopMapClustering.PLATFORM_ZOOM: from here a tap never zooms in to separate rings. */
export const PLATFORM_ZOOM = 14;

export function resolveTap(
  x: number,
  y: number,
  vehicles: readonly TapTarget[],
  stops: readonly TapTarget[],
): TapHit | null {
  let direct: TapHit | null = null,
    directScore = Infinity,
    near: TapHit | null = null,
    nearScore = Infinity;
  const consider = (kind: TapHit["kind"], target: TapTarget) => {
    const distance = Math.hypot(target.x - x, target.y - y);
    const r = Math.max(target.radius, 1);
    if (distance <= r) {
      // Vehicles are considered first and draw on top, so a strict comparison lets them keep ties.
      const score = distance / r;
      if (score < directScore) {
        direct = { kind, target };
        directScore = score;
      }
    } else if (distance <= Math.max(r + SLOP, MIN_REACH)) {
      const score = distance - r;
      if (score < nearScore) {
        near = { kind, target };
        nearScore = score;
      }
    }
  };
  vehicles.forEach((target) => consider("vehicle", target));
  [...stops]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .forEach((target) => consider("stop", target));
  return direct ?? near;
}

/** StopHitTesting.needsZoom: below platform zoom, a tapped ring overlapping another zooms in first. */
export function needsZoom(
  stops: readonly TapTarget[],
  first: TapTarget,
  zoom: number,
) {
  if (zoom >= PLATFORM_ZOOM) return false;
  return stops.some(
    (other) =>
      other.id !== first.id &&
      Math.hypot(other.x - first.x, other.y - first.y) <
        other.radius + first.radius + 4,
  );
}

/** StopMarkerLayout.sizeStops / diameterDp: equal-size rings on one continuous zoom curve. */
const SIZE_STOPS: [number, number][] = [
  [9, 6],
  [12, 8],
  [13, 12],
  [15, 22],
  [19, 22],
];
export function stopDiameter(zoom: number, highlighted = false) {
  if (highlighted) return 16;
  const upper = SIZE_STOPS.findIndex(([at]) => zoom <= at);
  if (upper <= 0) return upper === 0 ? SIZE_STOPS[0]![1] : SIZE_STOPS.at(-1)![1];
  const [a, small] = SIZE_STOPS[upper - 1]!,
    [b, large] = SIZE_STOPS[upper]!;
  return small + ((large - small) * (zoom - a)) / (b - a);
}
