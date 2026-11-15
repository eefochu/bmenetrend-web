import { useState } from "react";

import { ConnectedSelector, EmptyState, RefreshBar, ShapeIconTile } from "~/components/ui";
import { distanceMeters, formatDistance, type GeoPoint, type PlaceResult } from "~/lib/places";
import { t } from "~/lib/strings";
import { useBackLayer } from "~/lib/use-back-layer";
import {
  DistancePill,
  ExampleChips,
  SearchGroupTitle,
  SearchResultCard,
  TransitSearchInput,
  usePlaceSearch,
} from "./search-components";

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
  onBack,
  onPlace,
}: {
  userPosition: GeoPoint | null;
  onBack: () => void;
  onPlace: (place: PlaceResult) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("all");
  useBackLayer(category !== "all", () => setCategory("all"));
  const searchPlaces = category === "all" || category === "places";
  const placeSearch = usePlaceSearch(query, searchPlaces);
  const places = placeSearch.query === query ? placeSearch.places : [];
  const placeLoading = searchPlaces && query.trim().length >= 2 && (placeSearch.query !== query || placeSearch.loading);
  const limit = category === "all" ? 3 : 100;
  const shownPlaces = places.slice(0, limit);

  const section = (target: Category, count: number) => (
    <SearchGroupTitle
      title={CATEGORY_TITLE[target]}
      action={
        category === "all" && count > 3 ? (
          <button type="button" className="text-button" onClick={() => setCategory(target)}>
            {t.searchShowMore}
          </button>
        ) : undefined
      }
    />
  );

  return (
    <div className="fullscreen-layer search-screen" role="dialog" aria-modal="true" aria-label={t.searchShort}>
      <div className="search-screen-column">
        <TransitSearchInput query={query} onQuery={setQuery} onBack={() => (category !== "all" ? setCategory("all") : onBack())} />
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
              <EmptyState title={t.searchDiscoverTitle} body={t.searchDiscoverBody} icon="search" />
              <SearchGroupTitle title={t.searchExamples} />
              <ExampleChips examples={["Keleti pályaudvar", "Kelenföld", "1 villamos"]} onPick={setQuery} />
            </>
          ) : (
            <>
              {(category === "all" || category === "stations") && (
                <>
                  {section("stations", 0)}
                  <p className="status-line t-body-medium">{t.webStopSearchPending}</p>
                </>
              )}
              {searchPlaces && (category === "places" || places.length > 0 || placeLoading || placeSearch.unavailable) && (
                <>
                  {section("places", places.length)}
                  {placeLoading && <RefreshBar visible inset={22} />}
                  {placeSearch.query === query && placeSearch.unavailable && (
                    <div className="unavailable-row">
                      <p className="t-body-medium">{t.searchPlacesUnavailable}</p>
                      <button type="button" className="text-button" onClick={placeSearch.retry}>
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
                        leading={<ShapeIconTile icon="location_on" size={44} shape="cookie4" />}
                        trailing={userPosition ? <DistancePill text={formatDistance(distanceMeters(userPosition, place.position))} /> : undefined}
                        index={index}
                        count={shownPlaces.length}
                      />
                    ))}
                  </div>
                  {category === "places" && places.length === 0 && !placeLoading && !placeSearch.unavailable && <SearchEmpty />}
                  {places.length > 0 && (
                    <a className="text-button attribution-link t-label-small" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
                      {t.searchPlacesAttribution}
                    </a>
                  )}
                </>
              )}
              {(category === "all" || category === "vehicles") && (
                <>
                  {section("vehicles", 0)}
                  <p className="status-line t-body-medium">{t.webStopSearchPending}</p>
                </>
              )}
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
