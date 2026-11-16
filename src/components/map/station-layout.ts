import type { Stop } from "~/lib/transit/model";
export type Offset = { x: number; y: number };
const WORLD = 512 * 65536,
  SPACING = 24;
const candidates: Offset[] = [{ x: 0, y: 0 }];
for (let ring = 1; ring <= 4; ring++)
  for (let step = 0; step < 16; step++) {
    const angle = (step * Math.PI) / 8 - Math.PI / 2;
    candidates.push({
      x: Math.cos(angle) * ring * 6,
      y: Math.sin(angle) * ring * 6,
    });
  }

/** Direct port of map/StopMarkerLayout.kt. Fixed zoom-16 coordinates; never use camera pixels. */
export function stationOffsets(
  stops: Stop[],
  previous = new Map<string, Offset>(),
) {
  const nodes = [...new Map(stops.map((stop) => [stop.id, stop])).values()]
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    .map((stop) => {
      const lat =
        (Math.max(-85, Math.min(85, stop.position.lat)) * Math.PI) / 180;
      return {
        stop,
        x: ((stop.position.lon + 180) / 360) * WORLD,
        y:
          ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) *
          WORLD,
      };
    });
  const buckets = new Map<string, Offset[]>();
  const cell = (value: number) => Math.floor(value / SPACING);
  const place = (x: number, y: number) => {
    const key = `${cell(x)}:${cell(y)}`;
    const list = buckets.get(key) ?? [];
    list.push({ x, y });
    buckets.set(key, list);
  };
  for (const node of nodes) {
    const saved = previous.get(node.stop.id);
    if (saved) place(node.x + saved.x, node.y + saved.y);
  }
  const result = new Map<string, Offset>();
  for (const node of nodes) {
    const saved = previous.get(node.stop.id);
    if (saved) {
      result.set(node.stop.id, saved);
      continue;
    }
    const neighbors: Offset[] = [];
    for (let dx = -3; dx <= 3; dx++)
      for (let dy = -3; dy <= 3; dy++)
        neighbors.push(
          ...(buckets.get(`${cell(node.x) + dx}:${cell(node.y) + dy}`) ?? []),
        );
    const overlap = (offset: Offset) =>
      neighbors.reduce(
        (score, point) =>
          score +
          Math.max(
            0,
            SPACING -
              Math.hypot(
                node.x + offset.x - point.x,
                node.y + offset.y - point.y,
              ),
          ) **
            2,
        0,
      );
    let offset = candidates[0]!,
      penalty = overlap(offset);
    if (penalty > 0.001)
      for (const candidate of candidates.slice(1)) {
        const score = overlap(candidate);
        if (
          score < penalty - 0.001 ||
          (Math.abs(score - penalty) < 0.001 &&
            Math.hypot(candidate.x, candidate.y) <
              Math.hypot(offset.x, offset.y))
        ) {
          offset = candidate;
          penalty = score;
        }
        if (penalty < 0.001) break;
      }
    place(node.x + offset.x, node.y + offset.y);
    result.set(node.stop.id, offset);
  }
  return result;
}
