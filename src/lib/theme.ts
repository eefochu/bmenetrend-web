// Port of ui/Theme.kt and ui/AccentColor.kt from the Android app.

export type ThemeMode = "system" | "light" | "dark";
export type AccentColor =
  | "system"
  | "green"
  | "blue"
  | "purple"
  | "rose"
  | "orange"
  | "custom";

export const ACCENTS: { key: AccentColor; hue: number | null }[] = [
  { key: "system", hue: null },
  { key: "green", hue: 145 },
  { key: "blue", hue: 215 },
  { key: "purple", hue: 275 },
  { key: "rose", hue: 345 },
  { key: "orange", hue: 25 },
  { key: "custom", hue: null },
];

export const DEFAULT_CUSTOM_ACCENT = 0x6750a4;

const ROLES = [
  "primary",
  "on-primary",
  "primary-container",
  "on-primary-container",
  "inverse-primary",
  "secondary",
  "on-secondary",
  "secondary-container",
  "on-secondary-container",
  "tertiary",
  "on-tertiary",
  "tertiary-container",
  "on-tertiary-container",
  "background",
  "on-background",
  "surface",
  "on-surface",
  "surface-variant",
  "on-surface-variant",
  "surface-container-lowest",
  "surface-container-low",
  "surface-container",
  "surface-container-high",
  "surface-container-highest",
  "surface-dim",
  "surface-bright",
  "surface-tint",
  "outline",
  "outline-variant",
  "inverse-surface",
  "inverse-on-surface",
  "error",
  "on-error",
  "error-container",
  "on-error-container",
  "shadow",
  "scrim",
] as const;

export type ColorRole = (typeof ROLES)[number];
export type ColorScheme = Record<ColorRole, string>;

// Material 3 baseline values that Compose's lightColorScheme()/darkColorScheme() supply by default.
const LIGHT_BASE = {
  error: "#b3261e",
  "on-error": "#ffffff",
  "error-container": "#f9dedc",
  "on-error-container": "#410e0b",
  "surface-dim": "#ded8e1",
  "surface-bright": "#fef7ff",
  shadow: "#000000",
  scrim: "#000000",
};
const DARK_BASE = {
  error: "#f2b8b5",
  "on-error": "#601410",
  "error-container": "#8c1d18",
  "on-error-container": "#f9dedc",
  "surface-dim": "#141218",
  "surface-bright": "#3b383e",
  shadow: "#000000",
  scrim: "#000000",
};

// Fallback palette for devices without dynamic colour (Theme.kt LightColors / DarkColors).
const LIGHT_COLORS: ColorScheme = {
  ...LIGHT_BASE,
  primary: "#145fad",
  "on-primary": "#ffffff",
  "primary-container": "#e1edfa",
  "on-primary-container": "#163d66",
  "inverse-primary": "#94c9ff",
  secondary: "#536171",
  "on-secondary": "#ffffff",
  "secondary-container": "#e8ecf1",
  "on-secondary-container": "#293542",
  tertiary: "#356b71",
  "on-tertiary": "#ffffff",
  "tertiary-container": "#d8eef0",
  "on-tertiary-container": "#173b40",
  background: "#f6f7f9",
  "on-background": "#1c2025",
  surface: "#f6f7f9",
  "on-surface": "#1c2025",
  "surface-variant": "#e7ebef",
  "on-surface-variant": "#53606c",
  "surface-container-lowest": "#ffffff",
  "surface-container-low": "#edf0f3",
  "surface-container": "#e7ebef",
  "surface-container-high": "#e0e5eb",
  "surface-container-highest": "#d8dfe6",
  "surface-tint": "#145fad",
  outline: "#75808a",
  "outline-variant": "#ced5dc",
  "inverse-surface": "#252a30",
  "inverse-on-surface": "#f1f3f5",
};
const DARK_COLORS: ColorScheme = {
  ...DARK_BASE,
  primary: "#94c9ff",
  "on-primary": "#102f4b",
  "primary-container": "#213950",
  "on-primary-container": "#d7eafe",
  "inverse-primary": "#145fad",
  secondary: "#b7c1cc",
  "on-secondary": "#26323d",
  "secondary-container": "#303841",
  "on-secondary-container": "#dde4ec",
  tertiary: "#9cd1d7",
  "on-tertiary": "#12363a",
  "tertiary-container": "#27474c",
  "on-tertiary-container": "#cfedf0",
  background: "#131519",
  "on-background": "#f1f3f5",
  surface: "#131519",
  "on-surface": "#f1f3f5",
  "surface-variant": "#2a2f36",
  "on-surface-variant": "#b8c1cc",
  "surface-container-lowest": "#1b1e23",
  "surface-container-low": "#22262c",
  "surface-container": "#2a2f36",
  "surface-container-high": "#323841",
  "surface-container-highest": "#3c444e",
  "surface-tint": "#94c9ff",
  outline: "#85919e",
  "outline-variant": "#3b434d",
  "inverse-surface": "#f1f3f5",
  "inverse-on-surface": "#252a30",
};

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const value = parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function rgbToHex([r, g, b]: Rgb): string {
  const channel = (value: number) =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** Compose's Color.hsl(hue, saturation, lightness). */
export function hsl(hue: number, saturation: number, lightness: number): string {
  const h = ((hue % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lightness - c / 2;
  const [r, g, b]: Rgb =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return rgbToHex([r + m, g + m, b + m]);
}

function hueOf(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta < 1e-4) return 0;
  const hue =
    max === r ? 60 * (((g - b) / delta) % 6) : max === g ? 60 * ((b - r) / delta + 2) : 60 * ((r - g) / delta + 4);
  return (hue + 360) % 360;
}

function lightnessOf(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return Math.min(1, Math.max(0, (Math.max(r, g, b) + Math.min(r, g, b)) / 2));
}

/** AccentColor.kt accentHueSaturation(). */
export function accentHueSaturation(rgb: number): [number, number] {
  const r = ((rgb >> 16) & 255) / 255;
  const g = ((rgb >> 8) & 255) / 255;
  const b = (rgb & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return [0, 0];
  const lightness = (max + min) / 2;
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  const hue = (max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60;
  return [(hue + 360) % 360, saturation];
}

/** Theme.kt accentColorScheme(): tonal roles that keep the chosen hue readable in both themes. */
function accentColorScheme(accent: AccentColor, dark: boolean, customRgb: number): ColorScheme {
  const custom = accentHueSaturation(customRgb);
  const preset = ACCENTS.find((item) => item.key === accent)?.hue ?? null;
  const hue = preset ?? (accent === "custom" ? custom[0] : null);
  if (hue === null) return dark ? DARK_COLORS : LIGHT_COLORS;
  const baseSaturation = accent === "custom" ? Math.min(custom[1], 0.85) : 0.65;
  const tone = (lightness: number, saturation = baseSaturation, shift = 0) => hsl((hue + shift) % 360, saturation, lightness);
  const lightPrimary = accent === "custom" ? 0.27 : 0.3;
  return {
    ...(dark ? DARK_BASE : LIGHT_BASE),
    primary: tone(dark ? 0.8 : lightPrimary),
    "on-primary": dark ? tone(0.12) : "#ffffff",
    "primary-container": tone(dark ? 0.24 : 0.9),
    "on-primary-container": tone(dark ? 0.93 : 0.12),
    "inverse-primary": tone(dark ? lightPrimary : 0.8),
    secondary: tone(dark ? 0.78 : 0.3, 0.22),
    "on-secondary": dark ? tone(0.12, 0.22) : "#ffffff",
    "secondary-container": tone(dark ? 0.24 : 0.9, 0.22),
    "on-secondary-container": tone(dark ? 0.93 : 0.12, 0.22),
    tertiary: tone(dark ? 0.8 : 0.3, 0.45, 45),
    "on-tertiary": dark ? tone(0.12, 0.45, 45) : "#ffffff",
    "tertiary-container": tone(dark ? 0.24 : 0.9, 0.45, 45),
    "on-tertiary-container": tone(dark ? 0.93 : 0.12, 0.45, 45),
    background: tone(dark ? 0.065 : 0.985, 0.08),
    "on-background": tone(dark ? 0.92 : 0.1, 0.08),
    surface: tone(dark ? 0.065 : 0.985, 0.08),
    "on-surface": tone(dark ? 0.92 : 0.1, 0.08),
    "surface-container-lowest": tone(dark ? 0.04 : 1, 0.08),
    "surface-container-low": tone(dark ? 0.1 : 0.97, 0.08),
    "surface-container": tone(dark ? 0.12 : 0.945, 0.08),
    "surface-container-high": tone(dark ? 0.16 : 0.92, 0.08),
    "surface-container-highest": tone(dark ? 0.2 : 0.9, 0.08),
    "surface-dim": tone(dark ? 0.065 : 0.87, 0.08),
    "surface-bright": tone(dark ? 0.24 : 0.985, 0.08),
    "surface-variant": tone(dark ? 0.24 : 0.9, 0.12),
    "on-surface-variant": tone(dark ? 0.8 : 0.3, 0.12),
    "surface-tint": tone(dark ? 0.8 : 0.3),
    outline: tone(dark ? 0.6 : 0.46, 0.1),
    "outline-variant": tone(dark ? 0.3 : 0.8, 0.1),
    "inverse-surface": dark ? "#e6e1e5" : "#313033",
    "inverse-on-surface": dark ? "#313033" : "#f4eff4",
  };
}

const TINTED: ColorRole[] = [
  "background",
  "surface",
  "surface-container-lowest",
  "surface-container-low",
  "surface-container",
  "surface-container-high",
  "surface-container-highest",
  "surface-dim",
  "surface-bright",
  "surface-variant",
];

/** Theme.kt withAccentSurfaces(): every surface carries the same small chroma of the accent. */
function withAccentSurfaces(scheme: ColorScheme, dark: boolean): ColorScheme {
  const hue = hueOf(scheme.primary);
  const chroma = dark ? 0.045 : 0.035;
  const result = { ...scheme };
  for (const role of TINTED) {
    const base = lightnessOf(scheme[role]);
    const lightness = dark ? Math.max(base, 0.05) : base;
    const span = Math.max(1 - Math.abs(2 * lightness - 1), 0.001);
    result[role] = hsl(hue, Math.min(chroma / span, 0.6), lightness);
  }
  return result;
}

export function colorScheme(accent: AccentColor, dark: boolean, customRgb: number): ColorScheme {
  return withAccentSurfaces(accentColorScheme(accent, dark, customRgb), dark);
}

/** Swatch colour shown for each accent choice in Settings (SettingsPage.kt). */
export function accentSwatch(accent: AccentColor, customRgb: number, currentPrimary: string): string {
  if (accent === "green") return accentColorScheme("green", false, customRgb).primary;
  if (accent === "custom") return `#${customRgb.toString(16).padStart(6, "0")}`;
  const hue = ACCENTS.find((item) => item.key === accent)?.hue;
  return hue == null ? currentPrimary : hsl(hue, 0.65, 0.35);
}

export function luminance(hex: string): number {
  const linear = hexToRgb(hex).map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

export function applyColorScheme(element: HTMLElement, scheme: ColorScheme, dark: boolean) {
  for (const role of ROLES) element.style.setProperty(`--md-sys-color-${role}`, scheme[role]);
  element.style.colorScheme = dark ? "dark" : "light";
  element.dataset.dark = dark ? "true" : "false";
}

/** CSS for the first paint, before preferences are read. Used by scripts to regenerate globals.css. */
export function schemeCss(scheme: ColorScheme): string {
  return ROLES.map((role) => `  --md-sys-color-${role}: ${scheme[role]};`).join("\n");
}
