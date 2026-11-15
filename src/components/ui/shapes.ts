/**
 * Material 3 Expressive cookie shapes (MaterialShapes.Cookie4Sided … Cookie12Sided) as CSS polygons.
 * Every shape, the circle included, has the same number of vertices, so `clip-path` transitions
 * between them morph smoothly: the web version of CookieIconButton's Morph(cookie, Circle).
 */
const POINTS = 120;

export type CookieShape = "cookie4" | "cookie7" | "cookie9" | "cookie12" | "circle";

const SPEC: Record<CookieShape, { sides: number; depth: number; rotation: number }> = {
  cookie4: { sides: 4, depth: 0.16, rotation: Math.PI / 4 },
  cookie7: { sides: 7, depth: 0.11, rotation: -Math.PI / 2 },
  cookie9: { sides: 9, depth: 0.09, rotation: -Math.PI / 2 },
  cookie12: { sides: 12, depth: 0.075, rotation: -Math.PI / 2 },
  circle: { sides: 1, depth: 0, rotation: 0 },
};

function polygon(shape: CookieShape): string {
  const { sides, depth, rotation } = SPEC[shape];
  const points: string[] = [];
  for (let i = 0; i < POINTS; i++) {
    const angle = (i / POINTS) * Math.PI * 2;
    // Rounded scallops: a softened cosine keeps the lobes round and the valleys shallow.
    const wave = Math.cos(sides * (angle - rotation));
    const radius = 50 * (1 - depth * (1 - Math.sign(wave) * Math.abs(wave) ** 0.7) / 2);
    const x = 50 + radius * Math.cos(angle);
    const y = 50 + radius * Math.sin(angle);
    points.push(`${x.toFixed(2)}% ${y.toFixed(2)}%`);
  }
  return `polygon(${points.join(",")})`;
}

export const SHAPES: Record<CookieShape, string> = {
  cookie4: polygon("cookie4"),
  cookie7: polygon("cookie7"),
  cookie9: polygon("cookie9"),
  cookie12: polygon("cookie12"),
  circle: polygon("circle"),
};
