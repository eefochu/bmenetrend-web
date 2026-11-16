import { useMemo, useState } from "react";

import {
  ConnectedSelector,
  EmptyState,
  RefreshBar,
  ShapeIconTile,
} from "~/components/ui";
import {
  distanceMeters,
  formatDistance,
  type GeoPoint,
  type PlaceResult,
} from "~/lib/places";
import { searchTransit, knownStops } from "~/lib/transit/client";
import { emmaSearch, mergeStops } from "~/lib/transit/emma";
import { useRemote } from "~/lib/transit/hooks";
import type { Stop, Vehicle, Route } from "~/lib/transit/model";
import { DataStatus, RouteBadge } from "./transit-components";
import { normalize } from "~/lib/places";
import { t } from "~/lib/strings";
import { useBackLayer } from "~/lib/use-back-layer";
import {
  DistancePill,
  ExampleChips,
  SearchGroupTitle,
  SearchRecommendation,
  SearchResultCard,
  StopSearchRow,
  TransitSearchInput,
  usePlaceSearch,
} from "./search-components";
import { usePreferences } from "~/lib/preferences";
import { providerName, routeProvider, serviceTypeLabel } from "~/lib/transit/labels";

const CATEGORIES = ["all", "stations", "places", "vehicles"] as const;
type Category = (typeof CATEGORIES)[number];
const CATEGORY_TITLE: Record<Category, string> = {
  all: t.searchAll,
  stations: t.searchStations,
  places: t.searchPlaces,
  vehicles: t.searchVehicles,
};

/** Port of ViaBuszScreen.SearchAndRoutes + CategorizedSearch.kt. */
export function SearchScreen({
  userPosition,
  onStop,
  onVehicle,
  onRoute,
  onBack,
  onPlace,
}: {
  userPosition: GeoPoint | null;
  onStop: (stop: Stop) => void;
  onVehicle: (vehicle: Vehicle) => void;
  onRoute?: (route: Route) => void;
  onBack: () => void;
  onPlace: (place: PlaceResult) => void;
}) {
  const { favorites } = usePreferences();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("all");
  useBackLayer(category !== "all", () => setCategory("all"));
  const searchPlaces = category === "all" || category === "places";
  const placeSearch = usePlaceSearch(query, searchPlaces);
  const places = placeSearch.query === query ? placeSearch.places : [];
  const placeLoading =
    searchPlaces &&
    query.trim().length >= 2 &&
    (placeSearch.query !== query || placeSearch.loading);
  const limit = category === "all" ? 3 : 100;
  const shownPlaces = places.slice(0, limit);

  const near = userPosition ?? { lat: 47.4979, lon: 19.0402 };
  const transit = useRemote(
    query.trim().length >= 2 && category !== "places"
      ? `search:${query.trim()}:${near.lat.toFixed(2)}:${near.lon.toFixed(2)}`
      : "",
    (signal) => searchTransit(query, near, signal),
    { debounce: 350 },
  );
  const local = useMemo(
    () =>
      query.trim().length >= 2
        ? knownStops()
            .filter((stop) => normalize(stop.name).includes(normalize(query)))
            .slice(0, 30)
        : [],
    [query],
  );
  const emma = useRemote(
    query.trim().length >= 2 && category !== "places"
      ? `emma-search:${query.trim()}`
      : "",
    (signal) => emmaSearch(query, signal),
    { debounce: 400 },
  );
  const stops = mergeStops(
    transit.data?.value.stops ?? local,
    emma.data?.value ?? [],
  );
  const vehicles = transit.data?.value.vehicles ?? [];
  const routes = transit.data?.value.routes ?? [];
  // CategorizedSearch.kt: the best station match leads as a recommendation and is not repeated below.
  const recommendation =
    category === "all" || category === "stations" ? stops[0] : undefined;
  const otherStops = recommendation ? stops.slice(1) : stops;
  const favoriteStops = knownStops().filter((stop) => favorites.includes(stop.id)).slice(0, 5);
  const shownStops = otherStops.slice(0, limit);
  const shownRoutes = routes.slice(0, limit);
  const vehicleLimit = category === "all" ? Math.max(0, 3 - shownRoutes.length) : 100;
  const shownVehicles = vehicles.slice(0, vehicleLimit);
  const joined = category !== "vehicles";
  const lineGroup = joined ? shownRoutes.length + shownVehicles.length : shownRoutes.length;

  const section = (target: Category, count: number) => (
    <SearchGroupTitle
      title={CATEGORY_TITLE[target]}
      action={
        category === "all" && count > 3 ? (
          <button
            type="button"
            className="text-button"
            onClick={() => setCategory(target)}
          >
            {t.searchShowMore}
          </button>
        ) : undefined
      }
    />
  );

  return (
    <div
      className="fullscreen-layer search-screen"
      role="dialog"
      aria-modal="true"
      aria-label={t.searchShort}
    >
      <div className="search-screen-column">
        <TransitSearchInput
          query={query}
          onQuery={setQuery}
          onBack={() => (category !== "all" ? setCategory("all") : onBack())}
        />
        <ConnectedSelector
          options={CATEGORIES}
          selected={category}
          onSelect={setCategory}
          label={t.searchShort}
          text={(value) => CATEGORY_TITLE[value]}
          className="search-categories"
        />
        <div className="search-results">
          {query.trim() === "" ? (
            <>
              <EmptyState
                title={t.searchDiscoverTitle}
                body={t.searchDiscoverBody}
                icon="search"
              />
              <SearchGroupTitle title={t.searchExamples} />
              <ExampleChips
                examples={["Keleti pályaudvar", "Kelenföld", "1 villamos"]}
                onPick={setQuery}
              />
              {favoriteStops.length > 0 && (
                <>
                  <SearchGroupTitle title="Kedvenc megállóid" />
                  <div className="segment-group">
                    {favoriteStops.map((stop, index) => (
                      <StopSearchRow
                        key={stop.id}
                        stop={stop}
                        favorite
                        userPosition={userPosition}
                        onStop={onStop}
                        index={index}
                        count={favoriteStops.length}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <DataStatus
                {...transit.data}
                fallbackUnavailable={Boolean(
                  transit.data?.fallbackUnavailable &&
                  !emma.data &&
                  !emma.loading,
                )}
                loading={transit.loading}
                error={transit.error || emma.error}
                retry={transit.retry}
              />
              {recommendation && (
                <SearchRecommendation stop={recommendation} onClick={() => onStop(recommendation)} />
              )}
              {(category === "stations" ||
                (category === "all" && (otherStops.length > 0 || transit.loading))) && (
                <>
                  {section("stations", otherStops.length)}
                  {transit.loading && !stops.length && <RefreshBar visible inset={22} />}
                  <div className="segment-group">
                    {shownStops.map((stop, index) => (
                      <StopSearchRow
                        key={stop.id}
                        stop={stop}
                        favorite={favorites.includes(stop.id)}
                        userPosition={userPosition}
                        onStop={onStop}
                        index={index}
                        count={shownStops.length}
                      />
                    ))}
                  </div>
                  {category === "stations" && !transit.loading && transit.data && !stops.length && <SearchEmpty />}
                </>
              )}
              {searchPlaces &&
                (category === "places" ||
                  places.length > 0 ||
                  placeLoading ||
                  placeSearch.unavailable) && (
                  <>
                    {section("places", places.length)}
                    {placeLoading && <RefreshBar visible inset={22} />}
                    {placeSearch.query === query && placeSearch.unavailable && (
                      <div className="unavailable-row">
                        <p className="t-body-medium">
                          {t.searchPlacesUnavailable}
                        </p>
                        <button
                          type="button"
                          className="text-button"
                          onClick={placeSearch.retry}
                        >
                          {t.searchRetry}
                        </button>
                      </div>
                    )}
                    <div className="segment-group">
                      {shownPlaces.map((place, index) => (
                        <SearchResultCard
                          key={place.id}
                          name={place.name}
                          detail={place.address}
                          onClick={() => onPlace(place)}
                          leading={
                            <ShapeIconTile
                              icon="location_on"
                              size={44}
                              shape="cookie4"
                            />
                          }
                          trailing={
                            userPosition ? (
                              <DistancePill
                                text={formatDistance(
                                  distanceMeters(userPosition, place.position),
                                )}
                              />
                            ) : undefined
                          }
                          index={index}
                          count={shownPlaces.length}
                        />
                      ))}
                    </div>
                    {category === "places" &&
                      places.length === 0 &&
                      !placeLoading &&
                      !placeSearch.unavailable && <SearchEmpty />}
                    {places.length > 0 && (
                      <a
                        className="text-button attribution-link t-label-small"
                        href="https://www.openstreetmap.org/copyright"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {t.searchPlacesAttribution}
                      </a>
                    )}
                  </>
                )}
              {(category === "vehicles" ||
                (category === "all" && (routes.length > 0 || vehicles.length > 0 || transit.loading))) && (
                <>
                  {section("vehicles", routes.length + vehicles.length)}
                  {transit.loading && !routes.length && !vehicles.length && <RefreshBar visible inset={22} />}
                  <div className="segment-group">
                    {shownRoutes.map((route, index) => (
                      <SearchResultCard
                        key={route.id}
                        name={route.description && route.description !== route.name ? route.description : "Válassz irányt"}
                        detail={`${providerName(routeProvider(route))} · ${serviceTypeLabel(route)}`}
                        onClick={() => onRoute?.(route)}
                        leading={<RouteBadge route={route} />}
                        index={index}
                        count={lineGroup}
                      />
                    ))}
                  </div>
                  {category === "vehicles" && shownVehicles.length > 0 && (
                    <h3 className="t-title-small primary search-subgroup">Élő járművek</h3>
                  )}
                  <div className="segment-group">
                    {shownVehicles.map((vehicle, index) => (
                      <SearchResultCard
                        key={vehicle.id}
                        name={vehicle.registration || vehicle.name || vehicle.id.slice(vehicle.id.lastIndexOf(":") + 1)}
                        detail={[vehicle.destination, "Élő jármű"].filter(Boolean).join(" · ")}
                        onClick={() => onVehicle(vehicle)}
                        leading={<RouteBadge route={vehicle.route} />}
                        index={joined ? shownRoutes.length + index : index}
                        count={joined ? lineGroup : shownVehicles.length}
                      />
                    ))}
                  </div>
                  {category === "vehicles" && !transit.loading && transit.data && !routes.length && !vehicles.length && <SearchEmpty />}
                </>
              )}
              {category === "all" &&
                !recommendation &&
                !stops.length &&
                !places.length &&
                !routes.length &&
                !vehicles.length &&
                !transit.loading &&
                !emma.loading &&
                !placeLoading &&
                transit.data && <SearchEmpty />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SearchEmpty() {
  return (
    <div className="search-empty">
      <ShapeIconTile icon="search_off" size={72} shape="cookie7" />
      <p className="t-body-large on-variant centered">{t.searchNoMatches}</p>
    </div>
  );
}
