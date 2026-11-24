import { useEffect, useMemo, useRef, useState } from "react";
import { CookieIconButton, Icon, RefreshBar, SegmentedItem, ShapeIconTile } from "~/components/ui";
import { compactDuration, usePreferences } from "~/lib/preferences";
import { boards, knownStops } from "~/lib/transit/client";
import { useClock, useRemote } from "~/lib/transit/hooks";
import { providerNames, stopProviders } from "~/lib/transit/labels";
import { clock, type Departure, type Route, type Stop } from "~/lib/transit/model";
import { t } from "~/lib/strings";
import { RouteBadge } from "./line-badge";
import { stopModeIcon } from "./search-components";
import { PlatformBadge } from "./transit-components";
import { StationDisruptionNotice } from "./disruption-notice";
import { shownDestination } from "~/lib/transit/destination";

const EMPTY: Departure[] = [];
const RAIL_LABEL = /^[GSZ]\d+/i;
const RAIL_SERVICES = new Set(["S", "SZ", "G", "GY", "Z", "IC", "IR", "RJ", "RJX", "EC", "EN", "EX"]);
const isTrain = (route: Route) =>
  ["RAIL", "SUBURBAN_RAILWAY", "TRAMTRAIN"].includes(route.mode) ||
  RAIL_LABEL.test(route.name) ||
  RAIL_SERVICES.has(route.name.toUpperCase());

/** FavoritesScreen.kt naturalCompare: numbers by value, uppercase before lowercase. */
function naturalCompare(a: string, b: string) {
  const left = a.match(/[a-zA-Z]+|\d+/g) ?? [];
  const right = b.match(/[a-zA-Z]+|\d+/g) ?? [];
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const x = left[i]!,
      y = right[i]!;
    const nx = /^\d+$/.test(x) ? Number(x) : null;
    const ny = /^\d+$/.test(y) ? Number(y) : null;
    if (nx !== null && ny !== null) {
      if (nx !== ny) return nx - ny;
    } else if (nx !== null) return -1;
    else if (ny !== null) return 1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return left.length - right.length;
}

/** extractStationLines: trains first, each group de-duplicated by label and naturally sorted. */
function stationLines(stop: Stop) {
  const sorted = (routes: Route[]) =>
    routes
      .filter((route, index) => route.name && route.name !== "?" && routes.findIndex((other) => other.name === route.name) === index)
      .sort((a, b) => naturalCompare(a.name, b.name));
  return [...sorted(stop.routes.filter(isTrain)), ...sorted(stop.routes.filter((route) => !isTrain(route)))];
}

/** DesignSystem.kt DepartureCount as FavoritesScreen calls it: minutes, clock and the live accent only. */
function DepartureCount({ departure, now }: { departure: Departure; now: number }) {
  const minutes = Math.max(0, Math.ceil((departure.expected - now) / 60_000));
  return (
    <span className={`departure-count ${departure.live ? "count-live" : ""}`}>
      <span className="t-title-large">{minutes <= 0 ? "Most" : compactDuration(minutes)}</span>
      <span className="departure-count-time t-label-large">
        {departure.live && <Icon name="sensors" size={12} />}
        {clock(departure.expected)}
      </span>
    </span>
  );
}

function FavoriteMenu({ onAll, onRemove }: { onAll: () => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !root.current?.contains(event.target as Node))
        setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <span ref={root} className="favorite-menu-anchor">
      <button
        type="button"
        className="icon-button"
        aria-label="Továbbiak"
        title="Továbbiak"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="more_vert" className="on-variant" />
      </button>
      {open && (
        <span className="favorite-menu" role="menu">
          <span className="favorite-menu-group">
            <button type="button" role="menuitem" className="favorite-menu-item" onClick={() => { setOpen(false); onAll(); }}>
              <Icon name="schedule" />
              Összes indulás
            </button>
          </span>
          <span className="favorite-menu-group">
            <button type="button" role="menuitem" className="favorite-menu-item error-text" onClick={() => { setOpen(false); onRemove(); }}>
              <Icon name="delete" />
              Eltávolítás a kedvencek közül
            </button>
          </span>
        </span>
      )}
    </span>
  );
}

/** FavoritesScreen.kt FavoriteStationCard. */
function FavoriteStationCard({
  stop,
  next,
  departures,
  loading,
  unavailable,
  now,
  index,
  count,
  onStop,
  onRemove,
}: {
  stop: Stop;
  next?: Departure;
  departures: Departure[];
  loading: boolean;
  unavailable: boolean;
  now: number;
  index: number;
  count: number;
  onStop: () => void;
  onRemove: () => void;
}) {
  const lines = stationLines(stop);
  const stops = useMemo(() => [stop], [stop]);
  return (
    <SegmentedItem index={index} count={count} className="favorite-card">
      <div className="favorite-card-body" data-favorite={stop.id} onClick={onStop}>
        <div className="favorite-card-head">
          <button type="button" className="favorite-card-main" onClick={(event) => { event.stopPropagation(); onStop(); }}>
            <ShapeIconTile icon={stopModeIcon(stop)} size={44} shape="cookie9" />
            <span className="favorite-card-title">
              <span className="favorite-card-name">
                <span className="t-title-medium clamp-2">{stop.name}</span>
                <PlatformBadge code={stop.platform} />
              </span>
              <span className="t-label-medium on-variant clamp-1">{providerNames(stopProviders(stop))}</span>
            </span>
          </button>
          <span onClick={(event) => event.stopPropagation()}>
            <FavoriteMenu onAll={onStop} onRemove={onRemove} />
          </span>
        </div>
        <span className="favorite-card-lines">
          {lines.length ? (
            <span className="station-badge-grid">
              {lines.map((route) => (
                <RouteBadge key={route.id} route={route} compact />
              ))}
            </span>
          ) : loading ? (
            <RefreshBar visible />
          ) : (
            <span className="t-body-medium on-variant">
              {unavailable
                ? "A megálló járatlistája nem tölthető be. Próbálj frissíteni."
                : "Nincsenek elérhető vonalak ehhez a megállóhoz"}
            </span>
          )}
          <span onClick={(event) => event.stopPropagation()}>
            <StationDisruptionNotice stops={stops} departures={departures} />
          </span>
          {unavailable && lines.length > 0 && (
            <span className="t-body-small on-variant">A frissítés nem sikerült. A legutóbbi ismert járatlistát látod.</span>
          )}
          {next && (
            <span className="favorite-next">
              <RouteBadge route={next.route} compact />
              <span className="t-body-medium-emphasized clamp-2 grow">{shownDestination(next.destination, next.route.name)}</span>
              <DepartureCount departure={next} now={now} />
            </span>
          )}
        </span>
      </div>
    </SegmentedItem>
  );
}

/** FavoritesScreen.kt: device-local saved stops, their lines and next departure. */
export function FavoritesScreen({
  active = true,
  onBrowse,
  onStop,
}: {
  active?: boolean;
  onBrowse: () => void;
  onStop: (stop: Stop) => void;
}) {
  const { favorites, update, windowMinutes } = usePreferences();
  const now = useClock();
  const catalogue = new Map(knownStops().map((stop) => [stop.id, stop]));
  // FavoriteDepartures.stations: saved stations in name order, independent of the map.
  const stops = favorites
    .map((id) => catalogue.get(id))
    .filter((stop): stop is Stop => Boolean(stop))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  // ensureFavoriteRequest: only the favourites on screen (or the first three), at most eight.
  const list = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState<string[]>([]);
  const order = stops.map((stop) => stop.id).join(",");
  useEffect(() => {
    const root = list.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const shown = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.favorite;
        if (!id) continue;
        if (entry.isIntersecting) shown.add(id);
        else shown.delete(id);
      }
      clearTimeout(timer);
      timer = setTimeout(() => setVisible([...shown].sort()), 250);
    });
    root.querySelectorAll<HTMLElement>("[data-favorite]").forEach((node) => observer.observe(node));
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [order]);
  const requested = (() => {
    const onScreen = stops.filter((stop) => visible.includes(stop.id));
    return (onScreen.length ? onScreen : stops.slice(0, 3)).slice(0, 8);
  })();
  const key = requested.length ? `favorites:${requested.map((stop) => stop.id).sort().join(",")}:${windowMinutes}` : "";
  const remote = useRemote(
    key,
    async (signal) => {
      const rows = await boards(requested, windowMinutes, signal);
      return {
        value: new Map(requested.map((stop, index) => [stop.id, rows[index] ?? null])),
        at: Date.now(),
        incomplete: false,
        fallbackUnavailable: false,
      };
    },
    { active, interval: 60_000, debounce: 300, keepPrevious: true },
  );
  // Failed stations are retried after 15, 30, 60 and then every 120 seconds while the screen is visible.
  const failures = remote.data ? [...remote.data.value].filter(([, rows]) => rows === null).length : 0;
  const attempts = useRef(0);
  const retry = remote.retry;
  useEffect(() => {
    if (!active || remote.loading) return;
    if (!failures) {
      attempts.current = 0;
      return;
    }
    const wait = Math.min(120_000, 15_000 * 2 ** Math.min(attempts.current, 3));
    attempts.current++;
    const timer = setTimeout(retry, wait);
    return () => clearTimeout(timer);
  }, [failures, remote.data, remote.loading, active, retry]);
  useEffect(() => {
    attempts.current = 0;
  }, [key]);
  const missing = favorites.filter((id) => !catalogue.has(id));
  return (
    <div className="favorites-screen">
      <div className="page-intro favorites-intro">
        <h1 className="t-headline-large-emphasized grow">{t.favoritesTitle}</h1>
        {favorites.length > 0 && (
          <CookieIconButton
            label="Járatlisták frissítése"
            size={52}
            disabled={remote.loading}
            onClick={remote.retry}
          >
            <Icon name="refresh" className={remote.loading ? "spinning" : ""} />
          </CookieIconButton>
        )}
      </div>
      <div className="favorites-list" ref={list}>
        {stops.length === 0 ? (
          <div className="favorites-empty">
            <ShapeIconTile icon="favorite" shape="cookie12" />
            <h2 className="t-title-large centered">{t.favoritesIntro}</h2>
            <p className="t-body-medium on-variant centered">
              {favorites.length ? "A kedvenc megállók betöltése…" : t.favoritesEmpty}
            </p>
          </div>
        ) : (
          stops.map((stop, index) => {
            const rows = remote.data?.value.get(stop.id);
            const next = rows
              ?.filter((row) => !row.cancelled && row.expected >= now)
              .sort((a, b) => a.expected - b.expected)[0];
            return (
              <FavoriteStationCard
                key={stop.id}
                stop={stop}
                next={next}
                departures={rows ?? EMPTY}
                loading={remote.loading && rows === undefined}
                unavailable={rows === null}
                now={now}
                index={index}
                count={stops.length}
                onStop={() => onStop(stop)}
                onRemove={() => update({ favorites: favorites.filter((saved) => saved !== stop.id) })}
              />
            );
          })
        )}
        {missing.map((id) => (
          <div key={id} className="notice">
            <Icon name="info" size={17} />
            <p className="t-body-small grow">A mentett megálló adatai nem érhetők el: {id}</p>
            <button
              type="button"
              className="text-button"
              onClick={() => update({ favorites: favorites.filter((saved) => saved !== id) })}
            >
              Eltávolítás
            </button>
          </div>
        ))}
      </div>
      <div className="favorites-action">
        <button type="button" className="button button-filled button-hero" onClick={onBrowse}>
          <Icon name="add" size={20} />
          {t.addStop}
        </button>
      </div>
    </div>
  );
}
