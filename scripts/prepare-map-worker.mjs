import { copyFile, mkdir } from "node:fs/promises";

// Serve the matching standalone ESM worker from this origin. Next 15's
// webpack URL handling cannot resolve MapLibre 6's ESM worker package.
const destination = new URL("../public/maplibre/", import.meta.url);
await mkdir(destination, { recursive: true });
await copyFile(
  new URL(
    "../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs",
    import.meta.url,
  ),
  new URL("maplibre-gl-worker.mjs", destination),
);
