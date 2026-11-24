import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import TransitMap from "~/components/map/transit-map";
import { CookieIconButton, Icon } from "~/components/ui";
import { mapStyleUrl, sheetPeekHeight } from "~/lib/map-config";
import { distanceMeters } from "~/lib/places";
import { boards, routeVehicles, stopsAt, tripVehicle, vehiclesAt, knownStops } from "~/lib/transit/client";
import { departureVehicle } from "~/lib/transit/departure-navigation";
import { journeyStops } from "~/components/map/stop-directions";
import { vehicleLineColor } from "~/lib/transit/labels";
import {
  emmaStops,
  emmaVehicles,
  mergeStops,
  mergeVehicles,
} from "~/lib/transit/emma";
import { useClock, useRemote } from "~/lib/transit/hooks";
import type {
  Departure,
  Stop,
  Vehicle,
  Journey,
  Snapshot,
  Route,
} from "~/lib/transit/model";
import {
  DataStatus,
  StopBoard,
  TripPanel,
  LinePanel,
} from "./transit-components";
import type { PlaceResult } from "~/lib/places";
import { usePreferences } from "~/lib/preferences";
import { t } from "~/lib/strings";
import { useBackLayer } from "~/lib/use-back-layer";
import type { UserLocation } from "~/lib/use-user-location";
import { BottomSheet, type SheetValue } from "./bottom-sheet";
import { MapAttribution } from "./map-attribution";
import { NearbyPanel, type NearbyStation } from "./nearby-panel";
import { SearchScreen } from "./search-screen";

/** Zoomed out further, "nearby" would be whatever lies near the map centre: keep the last selection. */
const NEARBY_MIN_ZOOM = 11;

/** Above this map width the departures panel docks at the side, as a desktop layout. */
const DOCKED_WIDTH = 900;

type MapScreenProps = {
  requestedStop?: Stop | null;
  location: UserLocation;
  active: boolean;
  openSearchRequest: number;
  onFullscreenChanged: (fullscreen: boolean) => void;
  onOpenSettings: () => void;
};

/** Port of ui/ViaBuszScreen.kt: full-screen map, floating search, departures sheet and map controls. */
export function MapScreen({
  requestedStop,
  location,
  active,
  openSearchRequest,
  onFullscreenChanged,
  onOpenSettings,
}: MapScreenProps) {
  const preferences = usePreferences();
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [sheet, setSheet] = useState<SheetValue>("partial");
  const [visibleSheetHeight, setVisibleSheetHeight] = useState<number | null>(null);
  const sheetCameraTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(sheetCameraTimer.current), []);
  const [searchOpen, setSearchOpen] = useState(false);
  const [place, setPlace] = useState<PlaceResult | null>(null);
  const [placeRequest, setPlaceRequest] = useState(0);
  const [locateRequest, setLocateRequest] = useState(0);
  const [nearestRequested, setNearestRequested] = useState(false);
  const [locateQueued, setLocateQueued] = useState(false);

  const [area, setArea] = useState({
    lat: 47.473,
    lon: 18.825,
    radius: 4000,
    zoom: 13.2,
  });
  const areaKey = `${area.lat}:${area.lon}:${area.radius}`;
  const stopResource = useRemote(
    `stops:${areaKey}`,
    (signal) => stopsAt(area, area.radius, signal),
    {
      // TransitViewModel.NEARBY_MIN_ZOOM: nearby boards (and so the stops they need) follow the map from 11.
      active: active && !searchOpen && area.zoom >= NEARBY_MIN_ZOOM,
      interval: 300_000,
      debounce: 350,
      keepPrevious: true,
    },
  );
  const vehicleResource = useRemote(
    `vehicles:${areaKey}`,
    (signal) => vehiclesAt(area, area.radius, signal),
    {
      active: active && !searchOpen && area.zoom >= 9,
      interval: 10_000,
      debounce: 350,
      keepPrevious: true,
    },
  );
  const emmaStopResource = useRemote(
    `emma-stops:${areaKey}`,
    (signal) => emmaStops(area, signal),
    {
      active: active && !searchOpen && area.zoom >= 9,
      interval: 300_000,
      debounce: 400,
      keepPrevious: true,
    },
  );
  const emmaVehicleResource = useRemote(
    `emma-vehicles:${areaKey}`,
    (signal) => emmaVehicles(area, signal),
    {
      active: active && !searchOpen && area.zoom >= 7,
      interval: 15_000,
      debounce: 400,
      keepPrevious: true,
    },
  );
  const now = useClock();
  const stops = useMemo(
    () =>
      mergeStops(
        // The loaded area (possibly the previous one while panning) plus already known stops of the new
        // area, so markers never blank out between requests.
        [
          ...new Map(
            [
              ...knownStops().filter(
                (stop) =>
                  distanceMeters({ lat: area.lat, lon: area.lon }, stop.position) <
                  area.radius,
              ),
              ...(stopResource.data?.value ?? []),
            ].map((stop) => [stop.id, stop]),
          ).values(),
        ],
        emmaStopResource.data?.value ?? [],
      ),
    [stopResource.data, emmaStopResource.data, area.lat, area.lon, area.radius],
  );
  const vehicles = useMemo(
    () =>
      mergeVehicles(
        vehicleResource.data?.value ?? [],
        emmaVehicleResource.data?.value ?? [],
      ).filter((vehicle) => now - vehicle.observedAt < 180_000),
    [vehicleResource.data, emmaVehicleResource.data, now],
  );
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null);
  const [nearestStopId, setNearestStopId] = useState("");
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null);
  const [tripId, setTripId] = useState("");
  const [selectedDeparture, setSelectedDeparture] = useState<Departure | null>(
    null,
  );
  const [journey, setJourney] = useState<Snapshot<Journey> | null>(null);
  // TransitViewModel.departureVehicleJob: a departure whose vehicle is not on the map yet asks the
  // Worker which vehicle runs its trip. Any other navigation aborts it, so a late answer never opens a vehicle.
  const departureLookup = useRef<AbortController | null>(null);
  const cancelDepartureVehicle = useCallback(() => {
    departureLookup.current?.abort();
    departureLookup.current = null;
  }, []);
  useEffect(() => cancelDepartureVehicle, [cancelDepartureVehicle]);
  const chooseStop = useCallback((stop: Stop) => {
    cancelDepartureVehicle();
    setSelectedRoute(null);
    setSelectedStop(stop);
    setSelectedDeparture(null);
    setTripId("");
    setJourney(null);
    setSelectedVehicle(null);
    setSearchOpen(false);
    setSheet("partial");
  }, [cancelDepartureVehicle]);
  const chooseVehicle = useCallback((vehicle: Vehicle) => {
    cancelDepartureVehicle();
    setSelectedRoute(null);
    setSelectedVehicle(vehicle);
    setSelectedDeparture(null);
    setSelectedStop(null);
    setJourney(null);
    setTripId(vehicle.tripId);
    setSearchOpen(false);
    setSheet("partial");
  }, [cancelDepartureVehicle]);
  useEffect(() => {
    if (requestedStop) chooseStop(requestedStop);
  }, [requestedStop, chooseStop]);
  useBackLayer(
    !!selectedStop || !!tripId || !!selectedVehicle || !!selectedRoute,
    () => {
      cancelDepartureVehicle();
      setSelectedRoute(null);
      setSelectedStop(null);
      setSelectedDeparture(null);
      setTripId("");
      setJourney(null);
      setSelectedVehicle(null);
    },
  );
  const lines = useMemo(
    () =>
      journey
        ? [
            {
              coordinates: journey.value.geometry,
              // ViaBuszScreen: a vehicle's route takes the vehicle's mode colour (lineColor without a number).
              color: selectedVehicle ? vehicleLineColor(selectedVehicle) : journey.value.color,
            },
          ]
        : [],
    [journey, selectedVehicle],
  );
  const shownStops = useMemo(
    () => (journey ? journeyStops(journey.value) : stops),
    [journey, stops],
  );
  const focusedRouteId =
    selectedRoute?.id ??
    selectedVehicle?.route?.id ??
    (tripId ? selectedDeparture?.route.id : undefined) ??
    journey?.value.routeId;
  // The highlighted line's own vehicles, whatever the zoom or map area (Worker-served lines only;
  // MÁV-only `emma:` lines keep the area vehicles).
  const routeVehicleResource = useRemote(
    focusedRouteId && !focusedRouteId.startsWith("emma:") ? `route-vehicles:${focusedRouteId}` : "",
    (signal) => routeVehicles(focusedRouteId!, signal),
    { active: active && !searchOpen, interval: 10_000, keepPrevious: false },
  );
  const displayedVehicles = useMemo(() => {
    if (!focusedRouteId) return vehicles;
    const onLine = mergeVehicles(
      routeVehicleResource.data?.value ?? [],
      vehicles.filter((vehicle) => vehicle.route?.id === focusedRouteId),
    ).filter((vehicle) => now - vehicle.observedAt < 180_000);
    // The selected vehicle stays visible even when no list contains it yet.
    if (selectedVehicle && !onLine.some((vehicle) => vehicle.id === selectedVehicle.id)) {
      const live = vehicles.find((vehicle) => vehicle.id === selectedVehicle.id);
      onLine.push(live ?? selectedVehicle);
    }
    return onLine;
  }, [vehicles, focusedRouteId, routeVehicleResource.data, selectedVehicle, now]);
  // NearbyDepartures.kt: anchor on the user when they are near the map centre, else on the centre;
  // board the six closest stops within 1.5 km and show the first three that have departures.
  const userLat = location.position?.lat;
  const userLon = location.position?.lon;
  const nearbyAtUser =
    userLat !== undefined &&
    userLon !== undefined &&
    distanceMeters(area, { lat: userLat, lon: userLon }) < 700;
  const previousCandidates = useRef<{ stop: Stop; distance: number }[]>([]);
  const nearbyCandidates = useMemo(() => {
    if (area.zoom < NEARBY_MIN_ZOOM) return previousCandidates.current;
    const anchor =
      nearbyAtUser && userLat !== undefined && userLon !== undefined
        ? { lat: userLat, lon: userLon }
        : { lat: area.lat, lon: area.lon };
    return stops
      .map((stop) => ({ stop, distance: distanceMeters(anchor, stop.position) }))
      .filter((candidate) => candidate.distance <= 1_500)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 6);
  }, [stops, area.lat, area.lon, area.zoom, nearbyAtUser, userLat, userLon]);
  previousCandidates.current = nearbyCandidates;
  const nearbyKey = nearbyCandidates.length
    ? `nearby:${nearbyCandidates.map((candidate) => candidate.stop.id).join(",")}:${preferences.windowMinutes}`
    : "";
  const showingNearby = !selectedStop && !tripId && !selectedRoute;
  const nearbyResource = useRemote(
    nearbyKey,
    async (signal) => {
      // One batched Worker request for all six candidates (NearbyDepartures uses the same endpoint).
      const value = await boards(
        nearbyCandidates.map((candidate) => candidate.stop),
        preferences.windowMinutes,
        signal,
      );
      return {
        value,
        at: Date.now(),
        incomplete: false,
        fallbackUnavailable: false,
      };
    },
    {
      active: active && !searchOpen && showingNearby && sheet !== "hidden",
      interval: 60_000,
      debounce: 500,
    },
  );
  const nearbyStations = useMemo<NearbyStation[]>(() => {
    const results = nearbyResource.data?.value;
    return nearbyCandidates
      .map(({ stop, distance }, index): NearbyStation => {
        const rows = results?.[index];
        return {
          stop,
          distance,
          departures: rows
            ? rows
                .filter(
                  (row) =>
                    row.expected >= now - 30_000 &&
                    row.expected <= now + preferences.windowMinutes * 60_000,
                )
                .sort((a, b) => a.expected - b.expected)
            : undefined,
          unavailable: results ? rows === null : false,
        };
      })
      .filter((station) => !results || (station.departures?.length ?? 0) > 0)
      .slice(0, 3);
  }, [nearbyCandidates, nearbyResource.data, now, preferences.windowMinutes]);

  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
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
  const dockedPanelWidth = Math.min(
    560,
    Math.max(460, Math.round(size.width * 0.42)),
  );
  const peek = sheetPeekHeight(size.height || 800);
  const minimized = sheet === "hidden";

  const onVisible = useCallback((visible: number) => {
    root.current?.style.setProperty(
      "--sheet-visible",
      String(Math.round(visible)),
    );
    // The CSS follows every drag frame; refit the camera only once the drag settles.
    clearTimeout(sheetCameraTimer.current);
    sheetCameraTimer.current = setTimeout(
      () => setVisibleSheetHeight(Math.round(visible)),
      150,
    );
  }, []);

  // Location button: ask for location (opt-in), then centre on the user when a fix exists.
  const locate = () => {
    location.request();
    setLocateQueued(true);
    setNearestRequested(true);
  };
  useEffect(() => {
    if (!locateQueued || !location.position) return;
    setLocateQueued(false);
    setLocateRequest((value) => value + 1);
  }, [locateQueued, location.position]);
  useEffect(() => {
    if (location.status === "denied" || location.status === "unavailable")
      setLocateQueued(false);
  }, [location.status]);

  useEffect(() => {
    if (
      !nearestRequested ||
      !location.position ||
      stopResource.loading ||
      !stopResource.data ||
      distanceMeters(area, location.position) > area.radius / 2
    )
      return;
    const position = location.position;
    const nearest = [...stops].sort(
      (a, b) =>
        distanceMeters(position, a.position) -
        distanceMeters(position, b.position),
    )[0];
    if (nearest) {
      setNearestRequested(false);
      chooseStop(nearest);
      setNearestStopId(nearest.id);
    }
  }, [
    nearestRequested,
    location.position,
    stopResource.loading,
    stopResource.data,
    stops,
    area,
    chooseStop,
  ]);

  // ViaBuszScreen.kt openDeparture: a departure whose vehicle is loaded opens exactly as tapping that
  // vehicle on the map; otherwise its trip opens at once and the Worker is asked for the running vehicle
  // (TransitViewModel.findDepartureVehicle), which then replaces the preview with the vehicle view.
  const loadedVehicles = useRef<Vehicle[]>([]);
  loadedVehicles.current = [...displayedVehicles, ...vehicles];
  const openDeparture = (departure: Departure) => {
    cancelDepartureVehicle();
    const observed = departureVehicle(departure, loadedVehicles.current);
    if (observed) {
      chooseVehicle(observed);
      return;
    }
    setSelectedRoute(null);
    setSelectedVehicle(null);
    setSelectedDeparture(departure);
    setTripId(departure.tripId);
    setJourney(null);
    setSearchOpen(false);
    setSheet("partial");
    if (departure.cancelled || !departure.tripId || !navigator.onLine) return;
    const controller = new AbortController();
    departureLookup.current = controller;
    // BKK_JOURNEY_TIMEOUT_MS
    const timeout = setTimeout(() => controller.abort(), 5_000);
    tripVehicle(departure.tripId, controller.signal)
      .then((vehicle) => {
        if (vehicle && !controller.signal.aborted && departureLookup.current === controller)
          chooseVehicle(vehicle);
      })
      .catch(() => {
        /* No vehicle yet, a failed lookup or a superseded one: the trip preview stays. */
      })
      .finally(() => {
        clearTimeout(timeout);
        if (departureLookup.current === controller) departureLookup.current = null;
      });
  };

  // ViaBuszScreen.kt closeLine / closeVehicle: leave the route view, back to the board that opened it.
  const closeRoute = () => {
    cancelDepartureVehicle();
    setSelectedRoute(null);
    setTripId("");
    setSelectedDeparture(null);
    setJourney(null);
    setSelectedVehicle(null);
    setSheet("partial");
  };
  const returnToNearby = () => {
    closeRoute();
    setSelectedStop(null);
  };
  const dismissHighlight = () => {
    if (tripId || selectedVehicle || selectedRoute) closeRoute();
    else if (place) setPlace(null);
    else if (selectedStop) returnToNearby();
    else if (sheet === "expanded") setSheet("partial");
  };
  const toggleExpand = () =>
    setSheet(sheet === "expanded" ? "partial" : "expanded");
  const collapse = () => setSheet(sheet === "expanded" ? "partial" : "hidden");
  // Hiding the sheet dismisses whatever it showed, like Android's sheet-hidden LaunchedEffect.
  const changeSheet = (value: SheetValue) => {
    if (value === "hidden") {
      cancelDepartureVehicle();
      setSelectedRoute(null);
      setTripId("");
      setSelectedDeparture(null);
      setJourney(null);
      setSelectedVehicle(null);
      setSelectedStop(null);
    }
    setSheet(value);
  };
  const routeView =
    tripId !== "" || selectedVehicle !== null || selectedRoute !== null;

  return (
    <div
      ref={root}
      className={`map-screen ${docked ? "map-docked" : ""}`}
      style={
        {
          "--sheet-peek": String(Math.round(peek)),
          "--sheet-visible": "0",
          "--docked-panel-width": `${dockedPanelWidth}px`,
        } as CSSProperties
      }
      hidden={!active}
    >
      <TransitMap
        styleUrl={mapStyleUrl(preferences.dark)}
        bottomPadding={
          docked || minimized ? 0 : (visibleSheetHeight ?? Math.round(peek))
        }
        leftPadding={docked && !minimized ? dockedPanelWidth + 16 : 0}
        userPosition={location.position}
        locateRequest={locateRequest}
        place={place}
        placeRequest={placeRequest}
        onMapClick={dismissHighlight}
        stops={shownStops}
        vehicles={displayedVehicles}
        selected={selectedStop?.id ?? selectedVehicle?.id ?? ""}
        lines={lines}
        focusPoint={selectedStop?.position ?? selectedVehicle?.position}
        focused={routeView}
        onViewportChanged={setArea}
        onStopSelected={chooseStop}
        onVehicleSelected={chooseVehicle}
      />

      {/* A quiet search bar leaves map labels and route geometry unobstructed. */}
      <div className="search-blob-row">
        <div className="search-blob">
          <button
            type="button"
            className="search-blob-main"
            onClick={() => setSearchOpen(true)}
          >
            <Icon name="search" className="primary" />
            <span className="t-title-medium">{t.searchShort}</span>
            <span className="visually-hidden">{t.searchHint}</span>
          </button>
          <span className="search-blob-action">
            <CookieIconButton
              label={t.settings}
              size={40}
              shape="cookie4"
              onClick={onOpenSettings}
            >
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
        <button
          type="button"
          className="button button-tonal show-departures"
          onClick={() => setSheet("partial")}
        >
          <Icon name="directions_bus" size={20} />
          {t.showDepartures}
        </button>
      )}

      {routeView && (
        <button
          type="button"
          className="button button-tonal exit-route"
          onClick={dismissHighlight}
        >
          <Icon name="close" size={18} />
          Útvonalnézet bezárása
        </button>
      )}

      {place && (
        <div
          className="place-card"
          style={{ bottom: docked ? 24 : minimized ? 96 : peek + 12 }}
        >
          <Icon name="location_on" className="primary" />
          <div className="place-card-text">
            <p className="t-title-medium clamp-2">{place.name}</p>
            {place.address && (
              <p className="t-body-small clamp-2">{place.address}</p>
            )}
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label={t.searchClosePlace}
            title={t.searchClosePlace}
            onClick={() => setPlace(null)}
          >
            <Icon name="close" />
          </button>
        </div>
      )}

      {size.height > 0 && (
        <BottomSheet
          value={sheet}
          onChange={changeSheet}
          areaHeight={size.height}
          peek={peek}
          topReserve={docked ? 80 : 8}
          onVisible={onVisible}
        >
          {selectedRoute ? (
            <LinePanel
              key={selectedRoute.id}
              active={active && !searchOpen}
              route={selectedRoute}
              highlightStopId={selectedStop?.id}
              onClose={closeRoute}
              onStop={chooseStop}
              onGeometry={setJourney}
            />
          ) : tripId ? (
            <TripPanel
              key={tripId}
              tripId={tripId}
              active={active && !searchOpen}
              departure={selectedDeparture}
              vehicle={selectedVehicle}
              highlightStopId={selectedStop?.id ?? selectedDeparture?.stopId}
              onBack={closeRoute}
              onClose={closeRoute}
              onStop={chooseStop}
              onGeometry={setJourney}
            />
          ) : selectedStop ? (
            <StopBoard
              key={selectedStop.id}
              stop={selectedStop}
              active={active && !searchOpen}
              nearest={selectedStop.id === nearestStopId}
              expanded={sheet === "expanded"}
              onToggleExpand={toggleExpand}
              onCollapse={collapse}
              onTrip={(departure) => openDeparture(departure)}
            />
          ) : (
            <NearbyPanel
              loading={
                nearbyResource.loading ||
                (stopResource.loading && !nearbyCandidates.length)
              }
              stations={nearbyStations}
              now={now}
              atUser={nearbyAtUser}
              status={
                location.status === "denied" || location.status === "unavailable" ? t.locationDenied : null
              }
              notice={
                <DataStatus
                  fallbackUnavailable={Boolean(
                    (stopResource.data?.fallbackUnavailable === true ||
                      vehicleResource.data?.fallbackUnavailable === true) &&
                      !emmaStopResource.data &&
                      !emmaVehicleResource.data &&
                      !emmaStopResource.loading &&
                      !emmaVehicleResource.loading,
                  )}
                  error={
                    stopResource.error ||
                    vehicleResource.error ||
                    emmaStopResource.error ||
                    emmaVehicleResource.error
                  }
                  retry={() => {
                    stopResource.retry();
                    vehicleResource.retry();
                    emmaStopResource.retry();
                    emmaVehicleResource.retry();
                  }}
                />
              }
              expanded={sheet === "expanded"}
              onStop={chooseStop}
              onDeparture={(departure) => openDeparture(departure)}
              onRefresh={() => {
                nearbyResource.retry();
                stopResource.retry();
              }}
              onToggleExpand={toggleExpand}
              onCollapse={collapse}
              onSearch={() => setSearchOpen(true)}
            />
          )}
        </BottomSheet>
      )}

      {searchOpen && (
        <SearchScreen
          onStop={chooseStop}
          onRoute={(route) => {
            cancelDepartureVehicle();
            setSelectedRoute(route);
            setSelectedStop(null);
            setTripId("");
            setJourney(null);
            setSelectedVehicle(null);
            setSearchOpen(false);
            setSheet("partial");
          }}
          onVehicle={chooseVehicle}
          userPosition={location.position}
          onBack={() => setSearchOpen(false)}
          onPlace={(chosen) => {
            cancelDepartureVehicle();
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
