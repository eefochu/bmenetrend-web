import { distanceMeters, type GeoPoint } from "~/lib/places";
import type { Journey, Stop } from "~/lib/transit/model";

/** StopDirections.bearing: clockwise from north, [0, 360). */
export function bearing(a: GeoPoint, b: GeoPoint) {
  const rad = Math.PI / 180;
  const lat1 = a.lat * rad,
    lat2 = b.lat * rad,
    lon = (b.lon - a.lon) * rad;
  const angle =
    Math.atan2(
      Math.sin(lon) * Math.cos(lat2),
      Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon),
    ) / rad;
  return (angle + 360) % 360;
}

/**
 * StopDirections.collect for one journey: the heading a vehicle leaves each stop with, taken from
 * the trip's shape (never guessed from a stop name). The terminus gets its arrival heading.
 */
export function journeyBearings(stops: Stop[], geometry: [number, number][]) {
  const shape = geometry.map(([lon, lat]) => ({ lat, lon }));
  const result = new Map<string, number>();
  let cursor = 0;
  for (let i = 0; i < stops.length - 1; i++) {
    const stop = stops[i]!;
    let next = i + 1;
    while (next < stops.length && distanceMeters(stop.position, stops[next]!.position) <= 8) next++;
    if (next === stops.length) continue;
    let target = stops[next]!.position;
    if (shape.length >= 2) {
      let index = cursor;
      for (let k = cursor; k < shape.length; k++)
        if (distanceMeters(stop.position, shape[k]!) < distanceMeters(stop.position, shape[index]!)) index = k;
      cursor = index;
      let ahead = index + 1;
      while (ahead < shape.length && distanceMeters(stop.position, shape[ahead]!) <= 12) ahead++;
      if (ahead < shape.length) target = shape[ahead]!;
    }
    if (!result.has(stop.id)) result.set(stop.id, bearing(stop.position, target));
  }
  const terminus = stops.at(-1);
  if (terminus && stops.length >= 2 && !result.has(terminus.id)) {
    let previous = stops.length - 2;
    while (previous >= 0 && distanceMeters(stops[previous]!.position, terminus.position) <= 8) previous--;
    if (previous >= 0) {
      let source = stops[previous]!.position;
      if (shape.length >= 2) {
        let end = 0;
        for (let k = 1; k < shape.length; k++)
          if (distanceMeters(terminus.position, shape[k]!) < distanceMeters(terminus.position, shape[end]!)) end = k;
        let back = end - 1;
        while (back >= 0 && distanceMeters(shape[back]!, terminus.position) <= 12) back--;
        if (back >= 0) source = shape[back]!;
      }
      result.set(terminus.id, bearing(source, terminus.position));
    }
  }
  return result;
}

/** A journey's stops for the map: BKK platform directions win, shape-derived headings fill the rest. */
export function journeyStops(journey: Journey): Stop[] {
  const stops = journey.stops.map((row) => row.stop);
  const derived = journeyBearings(stops, journey.geometry);
  return stops.map((stop) =>
    stop.bearing !== undefined || !derived.has(stop.id) ? stop : { ...stop, bearing: derived.get(stop.id) },
  );
}
