import { expect, test } from "bun:test";
import { MercatorCoordinate } from "maplibre-gl";
import { routeCamera } from "../src/components/map/route-camera";

type Point = [number, number];
function screen(
  points: Point[],
  width: number,
  height: number,
  left: number,
  bottom: number,
) {
  const camera = routeCamera(points, width, height, left, bottom)!;
  expect(camera).not.toBeNull();
  const center = MercatorCoordinate.fromLngLat(camera.center);
  const scale = 512 * 2 ** camera.zoom;
  return {
    camera,
    points: points.map((point) => {
      const world = MercatorCoordinate.fromLngLat(point);
      return [
        (world.x - center.x) * scale + (width + left) / 2,
        (world.y - center.y) * scale + (height - bottom) / 2,
      ] as Point;
    }),
  };
}

test("a narrow highlighted line centres on the canvas when it clears the desktop card", () => {
  const result = screen(
    [
      [18.8, 47.2],
      [18.8, 47.7],
    ],
    1600,
    900,
    560,
    0,
  );
  for (const [x, y] of result.points) {
    expect(x).toBeCloseTo(800, 5);
    expect(x).toBeGreaterThan(560 + 24);
    expect(y).toBeGreaterThanOrEqual(24);
    expect(y).toBeLessThanOrEqual(900 - 24);
  }
});

test("wide routes move clear of the card with all geometry visible after resizing", () => {
  const route: Point[] = [
    [18, 47.3],
    [19, 48],
    [20, 47.3],
  ];
  for (const [width, height, left] of [
    [1600, 900, 560],
    [960, 650, 460],
  ]) {
    const result = screen(route, width!, height!, left!, 0);
    for (const [x, y] of result.points) {
      expect(x).toBeGreaterThan(left! + 23);
      expect(x).toBeLessThan(width! - 23);
      expect(y).toBeGreaterThan(23);
      expect(y).toBeLessThan(height! - 23);
    }
    expect(result.camera.padding.left).toBe(left!);
  }
});

test("mobile framing clears the actual sheet and search bar, and waits if the sheet fills the screen", () => {
  const route: Point[] = [
    [18.8, 47.2],
    [19, 47.7],
  ];
  const partial = screen(route, 390, 844, 0, 300);
  const taller = screen(route, 390, 844, 0, 420);
  expect(taller.camera.zoom).toBeLessThan(partial.camera.zoom);
  for (const [x, y] of taller.points) {
    expect(x).toBeGreaterThan(23);
    expect(x).toBeLessThan(367);
    expect(y).toBeGreaterThanOrEqual(96 - 0.001);
    expect(y).toBeLessThan(844 - 420 - 23);
  }
  expect(routeCamera(route, 390, 844, 0, 780)).toBeNull();
});

test("framing keys include interior route extents and viewport, but remain stable for identical geometry", () => {
  const original: Point[] = [
    [18, 47],
    [19, 47.2],
    [20, 47],
  ];
  const changed: Point[] = [
    [18, 47],
    [19, 48],
    [20, 47],
  ];
  expect(routeCamera(original, 1600, 900, 560, 0)!.key).not.toBe(
    routeCamera(changed, 1600, 900, 560, 0)!.key,
  );
  expect(routeCamera(original, 1600, 900, 560, 0)!.key).toBe(
    routeCamera([...original], 1600, 900, 560, 0)!.key,
  );
  expect(routeCamera([], 1600, 900, 560, 0)).toBeNull();
});
