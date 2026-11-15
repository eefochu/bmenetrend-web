import type { Map } from "maplibre-gl";

/**
 * Draws the Google-style `bm-poi:<class>` place badges the street styles ask for. Their colours and
 * glyphs come from the style's own `bmenetrend:images` metadata, written by scripts/build-google-styles.mjs.
 */
type ImageMetadata = {
  ring: string;
  /** OpenMapTiles poi class (or "*") to [badge colour, Material Symbols glyph]. */
  poi: Record<string, [string, string]>;
};

const GLYPH_FAMILY = "BMenetrend Map Glyphs";
const BADGE = 20;
const RING = 1.5;
const PREFIX = "bm-poi:";

// The filled Material Symbols glyphs, loaded as their own font: the interface's icon font is outlined
// by default and canvas text cannot select a variable font axis.
const glyphFonts = new globalThis.Map<string, Promise<boolean>>();
function loadGlyphFont(glyphs: string[]) {
  const names = [...new Set(glyphs)].sort().join(",");
  let font = glyphFonts.get(names);
  if (!font) {
    font = (async () => {
      const response = await fetch(
        `https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20,500,1,0&icon_names=${names}`,
      );
      const url = /url\((https:[^)]+)\)/.exec(await response.text())?.[1];
      if (!url) return false;
      document.fonts.add(await new FontFace(GLYPH_FAMILY, `url(${url})`).load());
      return true;
    })().catch(() => false);
    glyphFonts.set(names, font);
  }
  return font;
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T) {
  return Promise.race([promise, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

function readMetadata(map: Map): ImageMetadata | null {
  // The loaded stylesheet, rather than getStyle(), which serialises the whole style on every call.
  const metadata = map.style?.stylesheet?.metadata as Record<string, unknown> | undefined;
  const images = metadata?.["bmenetrend:images"] as ImageMetadata | undefined;
  return images?.poi ? images : null;
}

function canvas(width: number, height: number, ratio: number) {
  const element = document.createElement("canvas");
  element.width = Math.round(width * ratio);
  element.height = Math.round(height * ratio);
  const context = element.getContext("2d")!;
  context.scale(ratio, ratio);
  return context;
}

function badge(colour: string, glyph: string, ring: string, ratio: number, withGlyph: boolean) {
  const size = BADGE + RING * 2;
  const context = canvas(size, size, ratio);
  const centre = size / 2;
  context.fillStyle = ring;
  context.beginPath();
  context.arc(centre, centre, centre, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = colour;
  context.beginPath();
  context.arc(centre, centre, BADGE / 2, 0, Math.PI * 2);
  context.fill();

  if (withGlyph) {
    context.font = `14px "${GLYPH_FAMILY}"`;
    const box = context.measureText(glyph);
    // A missing ligature measures as the whole word: leave the badge plain rather than print it.
    if (box.width < BADGE) {
      context.fillStyle = "#ffffff";
      context.fillText(
        glyph,
        centre - (box.actualBoundingBoxRight - box.actualBoundingBoxLeft) / 2,
        centre + (box.actualBoundingBoxAscent - box.actualBoundingBoxDescent) / 2,
      );
    }
  }
  return context.getImageData(0, 0, context.canvas.width, context.canvas.height);
}

/** Supplies the street styles' generated images on demand; other styles' missing images are left alone. */
export function attachStyleImages(map: Map) {
  const ratio = Math.min(3, Math.max(2, Math.ceil(window.devicePixelRatio || 1)));
  map.setMissingStyleImageResolver(async (id) => {
    if (!id.startsWith(PREFIX)) return;
    const glyphs = Object.values(readMetadata(map)?.poi ?? {}).map(([, name]) => name);
    if (!glyphs.length) return;
    // Without the glyph font (offline, blocked) the badges still show as plain category dots.
    const fontReady = await withTimeout(loadGlyphFont(glyphs), 4000, false);
    // Read after the wait: the style may have changed (theme switch) while the font loaded.
    const metadata = readMetadata(map);
    if (!metadata || map.hasImage(id)) return;
    const [colour, glyph] = metadata.poi[id.slice(PREFIX.length)] ?? metadata.poi["*"] ?? ["#5f6368", ""];
    map.addImage(id, badge(colour, glyph, metadata.ring, ratio, fontReady), { pixelRatio: ratio });
  });
}
