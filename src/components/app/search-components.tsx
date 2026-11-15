import { useEffect, useRef, useState, type ReactNode } from "react";

import { Icon, SegmentedItem } from "~/components/ui";
import { cachedPlaces, searchPlaces, type PlaceResult } from "~/lib/places";
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
  trailing,
  index,
  count,
}: {
  name: string;
  detail: string;
  onClick: () => void;
  leading: ReactNode;
  trailing?: ReactNode;
  index: number;
  count: number;
}) {
  return (
    <SegmentedItem index={index} count={count} onClick={onClick} className="result-card">
      <span className="result-card-row">
        {leading}
        <span className="result-card-text">
          <span className="t-title-medium clamp-2">{name}</span>
          {detail && <span className="t-body-medium on-variant clamp-3">{detail}</span>}
        </span>
        {trailing}
      </span>
    </SegmentedItem>
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
