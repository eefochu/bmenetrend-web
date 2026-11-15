import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  applyColorScheme,
  colorScheme,
  DEFAULT_CUSTOM_ACCENT,
  type AccentColor,
  type ColorScheme,
  type ThemeMode,
} from "~/lib/theme";

export type MapStyle = "street" | "satellite";
export const LOCAL_PROVIDERS = [
  { id: "viabusz", name: "ViaBusz" },
  { id: "homm", name: "HOMM" },
  { id: "kanyargo", name: "KanyarGO" },
] as const;

export type Preferences = {
  themeMode: ThemeMode;
  accent: AccentColor;
  customAccent: number;
  mapStyle: MapStyle;
  localProviders: string[];
  /** Departure window in minutes (DepartureTime.windows); read by the departures port. */
  windowMinutes: number;
  /** Settings → Országos hálózat; read by the vehicle/stop catalogue port. */
  nationwide: boolean;
  favorites: string[];
};

const DEFAULTS: Preferences = {
  themeMode: "system",
  accent: "system",
  customAccent: DEFAULT_CUSTOM_ACCENT,
  mapStyle: "street",
  localProviders: LOCAL_PROVIDERS.map((provider) => provider.id),
  windowMinutes: 60,
  nationwide: true,
  favorites: [],
};

export const DEPARTURE_WINDOWS = [30, 60, 120, 180, 240, 300] as const;

/** DepartureTime.compact with Hungarian units. */
export function compactDuration(minutes: number) {
  const value = Math.max(0, minutes);
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  if (hours === 0) return `${rest}p`;
  return rest === 0 ? `${hours}ó` : `${hours}ó ${rest}p`;
}

export const PREFERENCES_KEY = "bmenetrend:preferences";

function read(): Preferences {
  try {
    const raw = window.localStorage.getItem(PREFERENCES_KEY);
    if (!raw) return DEFAULTS;
    const stored = JSON.parse(raw) as Partial<Preferences>;
    return { ...DEFAULTS, ...stored };
  } catch {
    return DEFAULTS;
  }
}

type PreferencesContext = Preferences & {
  dark: boolean;
  scheme: ColorScheme;
  update: (change: Partial<Preferences>) => void;
};

const Context = createContext<PreferencesContext | null>(null);

/** Settings persist per browser, like Android's DataStore preferences persist per device. */
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<Preferences>(read);
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  const dark =
    preferences.themeMode === "dark" ||
    (preferences.themeMode === "system" && systemDark);
  const scheme = useMemo(
    () => colorScheme(preferences.accent, dark, preferences.customAccent),
    [preferences.accent, preferences.customAccent, dark],
  );

  useEffect(() => {
    const root = document.documentElement;
    applyColorScheme(root, scheme, dark);
    root.dataset.theme = preferences.themeMode;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", scheme.surface);
  }, [scheme, dark, preferences.themeMode]);

  const update = useCallback((change: Partial<Preferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...change };
      try {
        window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
      } catch {
        // Private windows may refuse storage; the choice still applies for this visit.
      }
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ ...preferences, dark, scheme, update }),
    [preferences, dark, scheme, update],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePreferences() {
  const value = useContext(Context);
  if (!value) throw new Error("usePreferences outside PreferencesProvider");
  return value;
}
