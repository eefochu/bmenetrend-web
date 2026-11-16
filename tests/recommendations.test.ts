import { expect, test } from "bun:test";
import { recommendStations } from "../src/lib/transit/recommendations";
import type { Stop } from "../src/lib/transit/model";

const stop = (id: string, name: string, mode: string, platform = "", lat = 47.5): Stop => ({
  id,
  rawId: id,
  name,
  position: { lat, lon: 19.05 },
  platform,
  mode,
  routes: [],
  source: "BKK API",
});

test("StationRecommendations: the railway hub beats a same-named bus platform", () => {
  const stops = [
    stop("emma:BKK:bus", "Keleti pályaudvar M", "BUS", "A"),
    stop("emma:1:005510017_0", "Budapest-Keleti", "RAIL"),
  ];
  expect(recommendStations(stops, "Keleti", null, [])[0]?.id).toBe("emma:1:005510017_0");
});

test("shorthand, one typo and short or mode-only queries", () => {
  const stops = [stop("emma:1:kelenfold", "Budapest-Kelenföld", "RAIL"), stop("emma:BKK:x", "Kelemen László utca", "BUS", "B")];
  expect(recommendStations(stops, "kelen", null, [])[0]?.id).toBe("emma:1:kelenfold");
  expect(recommendStations(stops, "Kelenföd", null, [])[0]?.id).toBe("emma:1:kelenfold");
  expect(recommendStations(stops, "ke", null, [])).toEqual([]);
  expect(recommendStations(stops, "busz kelen", null, [])).toEqual([]);
});
