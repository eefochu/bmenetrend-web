import { expect, test } from "bun:test";
import { journeyBearings, journeyStops } from "../src/components/map/stop-directions";
import type { Stop } from "../src/lib/transit/model";

const stop = (id: string, lon: number, lat = 47.5, bearing?: number): Stop => ({
  id,
  rawId: id,
  name: id,
  position: { lat, lon },
  platform: "",
  mode: "RAIL",
  routes: [],
  source: "EMMA",
  bearing,
});

test("route stops take their departure heading from the trip shape, the terminus its arrival", () => {
  // East along the parallel, then the shape turns north before the terminus.
  const stops = [stop("a", 19.0), stop("b", 19.01), stop("c", 19.02, 47.51)];
  const geometry: [number, number][] = [
    [19.0, 47.5],
    [19.005, 47.5],
    [19.01, 47.5],
    [19.02, 47.5],
    [19.02, 47.505],
    [19.02, 47.51],
  ];
  const bearings = journeyBearings(stops, geometry);
  expect(Math.round(bearings.get("a")!)).toBe(90);
  expect(Math.round(bearings.get("b")!)).toBe(90);
  expect(Math.round(bearings.get("c")!)).toBe(0);
});

test("BKK platform directions win over shape-derived ones", () => {
  const stops = [stop("a", 19.0, 47.5, 200), stop("b", 19.01)];
  const shown = journeyStops({ name: "S10", color: "#00AFEF", geometry: [], stops: stops.map((s) => ({ stop: s, time: 0, live: false })) });
  expect(shown[0]!.bearing).toBe(200);
  expect(Math.round(shown[1]!.bearing!)).toBe(90);
});
