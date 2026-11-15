import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import TransitMap from "~/components/map/transit-map";
import { CookieIconButton, Icon } from "~/components/ui";
import { mapStyleUrl, sheetPeekHeight } from "~/lib/map-config";
import type { PlaceResult } from "~/lib/places";
import { usePreferences } from "~/lib/preferences";
import { t } from "~/lib/strings";
import { useBackLayer } from "~/lib/use-back-layer";
import type { UserLocation } from "~/lib/use-user-location";
import { BottomSheet, type SheetValue } from "./bottom-sheet";
import { MapAttribution } from "./map-attribution";
import { NearbyPanel } from "./nearby-panel";
import { SearchScreen } from "./search-screen";

/** Above this map width the departures panel docks at the side, as a desktop layout. */
const DOCKED_WIDTH = 900;
const DOCKED_PANEL = 440;

type MapScreenProps = {
  location: UserLocation;
  active: boolean;
  openSearchRequest: number;
  onFullscreenChanged: (fullscreen: boolean) => void;
  onOpenSettings: () => void;
};

/** Port of ui/ViaBuszScreen.kt: full-screen map, floating search, departures sheet and map controls. */
export function MapScreen({ location, active, openSearchRequest, onFullscreenChanged, onOpenSettings }: MapScreenProps) {
  const preferences = usePreferences();
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [sheet, setSheet] = useState<SheetValue>("partial");
  const [searchOpen, setSearchOpen] = useState(false);
  const [place, setPlace] = useState<PlaceResult | null>(null);
  const [placeRequest, setPlaceRequest] = useState(0);
  const [locateRequest, setLocateRequest] = useState(0);
  const [locateQueued, setLocateQueued] = useState(false);

  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    onFullscreenChanged(searchOpen);
  }, [searchOpen, onFullscreenChanged]);

  const handledSearch = useRef(openSearchRequest);
  useEffect(() => {
    if (openSearchRequest === handledSearch.current) return;
    handledSearch.current = openSearchRequest;
    setSearchOpen(true);
  }, [openSearchRequest]);

  useBackLayer(searchOpen, () => setSearchOpen(false));

  const docked = size.width >= DOCKED_WIDTH;
  const peek = sheetPeekHeight(size.height || 800);
  const minimized = sheet === "hidden";

  const onVisible = useCallback((visible: number) => {
    root.current?.style.setProperty("--sheet-visible", String(Math.round(visible)));
  }, []);

  // Location button: ask for location (opt-in), then centre on the user when a fix exists.
  const locate = () => {
    location.request();
    setLocateQueued(true);
  };
  useEffect(() => {
    if (!locateQueued || !location.position) return;
    setLocateQueued(false);
    setLocateRequest((value) => value + 1);
  }, [locateQueued, location.position]);
  useEffect(() => {
    if (location.status === "denied" || location.status === "unavailable") setLocateQueued(false);
  }, [location.status]);

  const dismissHighlight = () => {
    if (place) setPlace(null);
    else if (sheet === "expanded") setSheet("partial");
  };

  return (
    <div
      ref={root}
      className={`map-screen${docked ? " map-docked" : ""}`}
      style={{ "--sheet-peek": String(Math.round(peek)), "--sheet-visible": "0" } as CSSProperties}
      hidden={!active}
    >
      <TransitMap
        styleUrl={mapStyleUrl(preferences.dark)}
        bottomPadding={docked || minimized ? 0 : Math.round(peek)}
        leftPadding={docked && !minimized ? DOCKED_PANEL + 16 : 0}
        userPosition={location.position}
        locateRequest={locateRequest}
        place={place}
        placeRequest={placeRequest}
        onMapClick={dismissHighlight}
      />

      {/* A quiet search bar leaves map labels and route geometry unobstructed. */}
      <div className="search-blob-row">
        <div className="search-blob">
          <button type="button" className="search-blob-main" onClick={() => setSearchOpen(true)}>
            <Icon name="search" className="primary" />
            <span className="t-title-medium">{t.searchShort}</span>
            <span className="visually-hidden">{t.searchHint}</span>
          </button>
          <span className="search-blob-action">
            <CookieIconButton label={t.settings} size={40} shape="cookie4" onClick={onOpenSettings}>
              <Icon name="settings" size={22} />
            </CookieIconButton>
          </span>
        </div>
      </div>

      <MapAttribution className="map-attribution-anchor" />

      {/* Floating MyLocation button above the bottom sheet. */}
      <CookieIconButton
        label={t.nearestStopAction}
        size={60}
        elevated
        className="locate-button"
        onClick={locate}
        aria-busy={location.status === "locating"}
      >
        <Icon name="my_location" />
      </CookieIconButton>

      {minimized && (
        <button type="button" className="button button-tonal show-departures" onClick={() => setSheet("partial")}>
          <Icon name="directions_bus" size={20} />
          {t.showDepartures}
        </button>
      )}

      {place && (
        <div className="place-card" style={{ bottom: docked ? 24 : minimized ? 96 : peek + 12 }}>
          <Icon name="location_on" className="primary" />
          <div className="place-card-text">
            <p className="t-title-medium clamp-2">{place.name}</p>
            {place.address && <p className="t-body-small clamp-2">{place.address}</p>}
          </div>
          <button type="button" className="icon-button" aria-label={t.searchClosePlace} title={t.searchClosePlace} onClick={() => setPlace(null)}>
            <Icon name="close" />
          </button>
        </div>
      )}

      {size.height > 0 && (
        <BottomSheet value={sheet} onChange={setSheet} areaHeight={size.height} peek={peek} topReserve={docked ? 80 : 8} onVisible={onVisible}>
          <NearbyPanel
            expanded={sheet === "expanded"}
            location={location}
            onToggleExpand={() => setSheet(sheet === "expanded" ? "partial" : "expanded")}
            onCollapse={() => setSheet(sheet === "expanded" ? "partial" : "hidden")}
            onSearch={() => setSearchOpen(true)}
          />
        </BottomSheet>
      )}

      {searchOpen && (
        <SearchScreen
          userPosition={location.position}
          onBack={() => setSearchOpen(false)}
          onPlace={(chosen) => {
            setPlace(chosen);
            setPlaceRequest((value) => value + 1);
            setSearchOpen(false);
            setSheet("partial");
          }}
        />
      )}
    </div>
  );
}
