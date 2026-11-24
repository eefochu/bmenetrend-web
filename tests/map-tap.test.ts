import { expect, test } from "bun:test";
import { needsZoom, resolveTap, stopDiameter } from "../src/components/map/map-tap";

test("MapTapResolver: direct hits win by relative depth, vehicles keep ties", () => {
  const bus = { id: "bus", x: 100, y: 100, radius: 13 };
  const stop = { id: "stop", x: 110, y: 100, radius: 11 };
  // Closer to the stop's centre relative to its size.
  expect(resolveTap(108, 100, [bus], [stop])?.kind).toBe("stop");
  expect(resolveTap(100, 100, [bus], [stop])?.kind).toBe("vehicle");
  // Exact tie: the vehicle (drawn on top) keeps it.
  expect(resolveTap(100, 100, [bus], [{ ...stop, x: 100 }])?.kind).toBe("vehicle");
});

test("MapTapResolver: overview-sized markers use their drawn radius plus slop", () => {
  const small = { id: "train", x: 0, y: 0, radius: (26 * 0.7) / 2 };
  // 9.1 radius: a tap 20 px away is within the 22 px minimum reach, not a direct hit.
  expect(resolveTap(20, 0, [small], [])?.target.id).toBe("train");
  expect(resolveTap(23, 0, [small], [])).toBeNull();
  // Full-size selected (15 px) reaches 25 px.
  expect(resolveTap(24, 0, [{ ...small, radius: 15 }], [])?.target.id).toBe("train");
});

test("StopHitTesting.needsZoom and StopMarkerLayout.diameterDp", () => {
  const a = { id: "a", x: 0, y: 0, radius: 4 };
  const b = { id: "b", x: 9, y: 0, radius: 4 };
  expect(needsZoom([a, b], a, 12)).toBe(true);
  expect(needsZoom([a, b], a, 14)).toBe(false);
  expect(needsZoom([a, { ...b, x: 20 }], a, 12)).toBe(false);
  expect(stopDiameter(9)).toBe(6);
  expect(stopDiameter(14)).toBe(17);
  expect(stopDiameter(18)).toBe(22);
  expect(stopDiameter(8)).toBe(6);
  expect(stopDiameter(12, true)).toBe(16);
});
