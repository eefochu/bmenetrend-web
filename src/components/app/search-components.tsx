import { useEffect, useRef, useState, type ReactNode } from "react";

import { Icon, SegmentedItem, ShapeIconTile } from "~/components/ui";
import {
  cachedPlaces,
  distanceMeters,
  searchPlaces,
  type GeoPoint,
  type PlaceResult,
} from "~/lib/places";
import { formatDistance, providerNames, stopProviders, stopSubtitle } from "~/lib/transit/labels";
import type { Route, Stop } from "~/lib/transit/model";
import { RouteBadge } from "./line-badge";
import { t } from "~/lib/strings";

/** SearchComponents.kt TransitSearchInput: one filled field with the back arrow inside it. */
export function TransitSearchInput({
  query,
  onQuery,
  onBack,
  label = t.searchShort,
}: {
  query: string;
  onQuery: (value: string) => void;
  onBack: () => void;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <div className="search-input-row">
      <div className="search-field">
        <button type="button" className="icon-button" onClick={onBack} aria-label={t.back} title={t.back}>
          <Icon name="arrow_back" />
        </button>
        <label className="search-field-text">
          <span className="search-field-label t-body-small">{label}</span>
          <input
            ref={input}
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
            value={query}
            placeholder={t.searchInputHint}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            className="t-body-large"
          />
        </label>
        {query ? (
          <button type="button" className="icon-button" onClick={() => onQuery("")} aria-label={t.clearSearch} title={t.clearSearch}>
            <Icon name="close" />
          </button>
        ) : (
          <Icon name="search" className="primary search-field-icon" />
        )}
      </div>
    </div>
  );
}

export function SearchGroupTitle({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="search-group-title">
      <h3 className="t-title-medium primary">{title}</h3>
      {action}
    </div>
  );
}

/** SearchComponents.kt SearchResultCard on a SegmentedItem. */
export function SearchResultCard({
  name,
  detail,
  onClick,
  leading,
  badge,
  supporting,
  trailing,
  index,
  count,
}: {
  name: string;
  detail: string;
  onClick: () => void;
  leading: ReactNode;
  /** After the name while it fits (platform, saved). */
  badge?: ReactNode;
  supporting?: ReactNode;
  trailing?: ReactNode;
  index: number;
  count: number;
}) {
  return (
    <SegmentedItem index={index} count={count} onClick={onClick} className="result-card">
      <span className="result-card-row">
        {leading}
        <span className="result-card-text">
          <span className="result-card-name">
            <span className="t-title-medium clamp-2">{name}</span>
            {badge}
          </span>
          {detail && <span className="t-body-medium on-variant clamp-3">{detail}</span>}
          {supporting}
        </span>
        {trailing}
      </span>
    </SegmentedItem>
  );
}

/** SearchComponents.kt stopModeIcon: rail, then metro, HÉV, tram, otherwise bus. */
export function stopModeIcon(stop: Stop) {
  const modes = new Set([stop.mode, ...stop.routes.map((route) => route.mode)]);
  if (modes.has("RAIL") || modes.has("TRAMTRAIN")) return "train";
  if (modes.has("SUBWAY")) return "subway";
  if (modes.has("SUBURBAN_RAILWAY")) return "directions_railway";
  if (modes.has("TRAM")) return "tram";
  return "directions_bus";
}

/** SearchComponents.kt StopModeBadge: the stop's main transport as a cookie badge. */
export function StopModeBadge({ stop, size = 44, prominent = false }: { stop: Stop; size?: number; prominent?: boolean }) {
  return <ShapeIconTile icon={stopModeIcon(stop)} size={size} shape="cookie9" prominent={prominent} />;
}

const BADGE_WIDTH = 52;
const BADGE_GAP = 6;
const MORE_RESERVE = 64;

/** SearchComponents.kt OneLineBadges: uniform 52x28 badges on one line, then "+N járat". */
export function OneLineBadges({ routes }: { routes: Route[] }) {
  const unique = routes.filter(
    (route, index) => routes.findIndex((other) => other.name === route.name && other.mode === route.mode) === index,
  );
  const ref = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  if (!unique.length) return null;
  const full = unique.length * BADGE_WIDTH + (unique.length - 1) * BADGE_GAP;
  const shown =
    !width || full <= width
      ? unique.length
      : Math.max(1, Math.floor((width - MORE_RESERVE + BADGE_GAP) / (BADGE_WIDTH + BADGE_GAP)));
  return (
    <span ref={ref} className="one-line-badges">
      {unique.slice(0, shown).map((route) => (
        <RouteBadge key={route.id} route={route} compact />
      ))}
      {shown < unique.length && (
        <span className="t-label-medium on-variant">+{unique.length - shown} járat</span>
      )}
    </span>
  );
}

/** SearchComponents.kt SearchRecommendation: "Talán ezt keresed" on the primary container. */
export function SearchRecommendation({ stop, onClick }: { stop: Stop; onClick: () => void }) {
  return (
    <div className="search-recommendation">
      <h3 className="t-title-small primary">Talán ezt keresed</h3>
      <button type="button" className="search-recommendation-card" onClick={onClick}>
        <StopModeBadge stop={stop} size={56} prominent />
        <span className="search-recommendation-text">
          <span className="t-title-large clamp-3">{stop.name}</span>
          <span className="t-body-medium clamp-2">{providerNames(stopProviders(stop))}</span>
          <OneLineBadges routes={stop.routes} />
        </span>
      </button>
    </div>
  );
}

/** ViaBuszScreen.kt StopSearchRow. */
export function StopSearchRow({
  stop,
  favorite,
  userPosition,
  onStop,
  index,
  count,
}: {
  stop: Stop;
  favorite: boolean;
  userPosition?: GeoPoint | null;
  onStop: (stop: Stop) => void;
  index: number;
  count: number;
}) {
  return (
    <SearchResultCard
      name={stop.name}
      detail={stopSubtitle(stop)}
      onClick={() => onStop(stop)}
      leading={<StopModeBadge stop={stop} />}
      badge={
        <>
          {stop.platform && <span className="native-platform-badge">{stop.platform}</span>}
          {favorite && <Icon name="favorite" size={16} className="primary" />}
        </>
      }
      supporting={<OneLineBadges routes={stop.routes} />}
      trailing={
        userPosition ? (
          <DistancePill text={formatDistance(distanceMeters(userPosition, stop.position))} />
        ) : undefined
      }
      index={index}
      count={count}
    />
  );
}

/** SearchComponents.kt DistancePill. */
export function DistancePill({ text }: { text: string }) {
  return (
    <span className="distance-pill t-label-medium-emphasized">
      <Icon name="directions_walk" size={14} />
      {text}
    </span>
  );
}

export function ExampleChips({ examples, onPick }: { examples: string[]; onPick: (value: string) => void }) {
  return (
    <div className="chip-row">
      {examples.map((example) => (
        <button key={example} type="button" className="suggestion-chip" onClick={() => onPick(example)}>
          <Icon name="search" size={18} className="primary" />
          {example}
        </button>
      ))}
    </div>
  );
}

export type PlaceSearchState = {
  query: string;
  places: PlaceResult[];
  loading: boolean;
  unavailable: boolean;
  retry: () => void;
};

/**
 * TransitViewModel.searchPlaces: 250 ms debounce, cancellation of superseded queries, cached hits shown
 * at once, and a failed source kept distinct from an empty result.
 */
export function usePlaceSearch(query: string, enabled: boolean): PlaceSearchState {
  const [state, setState] = useState<Omit<PlaceSearchState, "retry">>({ query: "", places: [], loading: false, unavailable: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const online = enabled && query.trim().length >= 2;
    const cached = online ? cachedPlaces(query) : undefined;
    setState({ query, places: cached ?? [], loading: online && !cached, unavailable: false });
    if (!online || cached) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchPlaces(query, controller.signal)
        .then((places) => setState({ query, places, loading: false, unavailable: false }))
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          console.warn("Place search failed", error);
          setState({ query, places: [], loading: false, unavailable: true });
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, enabled, attempt]);
  return { ...state, retry: () => setAttempt((value) => value + 1) };
}
