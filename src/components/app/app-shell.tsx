import Router from "next/router";
import { useCallback, useEffect, useRef, useState } from "react";

import { Icon } from "~/components/ui";
import { PreferencesProvider } from "~/lib/preferences";
import { t } from "~/lib/strings";
import { useBackLayer } from "~/lib/use-back-layer";
import { useUserLocation } from "~/lib/use-user-location";
import { AboutPage } from "./about-page";
import { FavoritesScreen } from "./favorites-screen";
import { MapScreen } from "./map-screen";
import { PlannerScreen } from "./planner-screen";
import { SettingsPage } from "./settings-page";

type Tab = "map" | "planner" | "favorites";
const TABS: { tab: Tab; label: string; icon: string }[] = [
  { tab: "map", label: t.navMap, icon: "map" },
  { tab: "planner", label: t.navPlan, icon: "route" },
  { tab: "favorites", label: t.navFavorites, icon: "favorite" },
];

export default function AppShell() {
  return (
    <PreferencesProvider>
      <MainNavigation />
    </PreferencesProvider>
  );
}

/**
 * Port of ui/MainNavigation.kt: a navigation rail from 840px, a bottom bar below it. Screens keep their
 * state while another tab is shown, like rememberSaveableStateHolder; back from another tab returns to the map.
 */
function MainNavigation() {
  const [tab, setTab] = useState<Tab>("map");
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set(["map"]));
  const [mapFullscreen, setMapFullscreen] = useState(false);
  const [searchRequest, setSearchRequest] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const location = useUserLocation();

  // This single-page app owns history entries for its layers; Next's router must not re-route on them.
  useEffect(() => {
    Router.beforePopState(() => false);
    return () => Router.beforePopState(() => true);
  }, []);

  const select = useCallback((next: Tab) => {
    setSettingsOpen(false);
    setAboutOpen(false);
    setTab(next);
    setVisited((current) => (current.has(next) ? current : new Set(current).add(next)));
  }, []);
  useBackLayer(tab !== "map", () => setTab("map"));
  useBackLayer(settingsOpen, () => setSettingsOpen(false));
  useBackLayer(aboutOpen, () => setAboutOpen(false));
  const openSettings = useCallback(() => setSettingsOpen(true), []);

  const hideNavigation = tab === "map" && mapFullscreen && !settingsOpen;
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const navigation = (kind: "rail" | "bar") => (
    <nav className={kind === "rail" ? "nav-rail" : "nav-bar"} aria-label="Fő navigáció">
      <div
        role="tablist"
        aria-orientation={kind === "rail" ? "vertical" : "horizontal"}
        className="nav-items"
        onKeyDown={(event) => {
          const forward = kind === "rail" ? "ArrowDown" : "ArrowRight";
          const backward = kind === "rail" ? "ArrowUp" : "ArrowLeft";
          if (event.key !== forward && event.key !== backward) return;
          event.preventDefault();
          const index = TABS.findIndex((item) => item.tab === tab);
          const next = (index + (event.key === forward ? 1 : -1) + TABS.length) % TABS.length;
          select(TABS[next]!.tab);
          items.current[next]?.focus();
        }}
      >
        {TABS.map((item, index) => {
          const selected = tab === item.tab;
          return (
            <button
              key={item.tab}
              ref={(element) => {
                items.current[index] = element;
              }}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`screen-${item.tab}`}
              tabIndex={selected ? 0 : -1}
              className={`nav-item${selected ? " nav-selected" : ""}`}
              onClick={() => select(item.tab)}
            >
              <span className="nav-indicator">
                <Icon name={item.icon} />
              </span>
              <span className="t-label-medium">{item.label}</span>
            </button>
          );
        })}
      </div>
      {kind === "rail" && (
        // Desktop: Settings sits at the bottom of the rail; on phones it stays in the search bar.
        <button
          type="button"
          className={`nav-item nav-settings${settingsOpen ? " nav-selected" : ""}`}
          aria-pressed={settingsOpen}
          onClick={() => {
            setAboutOpen(false);
            setSettingsOpen((open) => !open);
          }}
        >
          <span className="nav-indicator">
            <Icon name="settings" />
          </span>
          <span className="t-label-medium">{t.settings}</span>
        </button>
      )}
    </nav>
  );

  return (
    <div className={`app-shell${hideNavigation ? " nav-hidden" : ""}${settingsOpen ? " settings-open" : ""}`}>
      {navigation("rail")}
      <div className="app-content">
        <main className="app-screens">
          <section id="screen-map" role="tabpanel" aria-label={t.navMap} className="screen" hidden={tab !== "map"}>
            <MapScreen
              location={location}
              active={tab === "map"}
              openSearchRequest={searchRequest}
              onFullscreenChanged={setMapFullscreen}
              onOpenSettings={openSettings}
            />
          </section>
          {visited.has("planner") && (
            <section id="screen-planner" role="tabpanel" aria-label={t.navPlan} className="screen" hidden={tab !== "planner"}>
              <PlannerScreen location={location} />
            </section>
          )}
          {visited.has("favorites") && (
            <section id="screen-favorites" role="tabpanel" aria-label={t.navFavorites} className="screen screen-content-width" hidden={tab !== "favorites"}>
              <FavoritesScreen
                onBrowse={() => {
                  select("map");
                  setSearchRequest((value) => value + 1);
                }}
              />
            </section>
          )}
          {settingsOpen && <SettingsPage onBack={() => setSettingsOpen(false)} onAbout={() => setAboutOpen(true)} />}
          {aboutOpen && <AboutPage onBack={() => setAboutOpen(false)} />}
        </main>
        {navigation("bar")}
      </div>
    </div>
  );
}
