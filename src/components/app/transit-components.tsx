import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  CookieIconButton,
  EmptyState,
  Icon,
  RefreshBar,
} from "~/components/ui";
import { DepartureWindowSelector } from "./departure-window-selector";
import { DepartureBoardRow, NextDepartureHero } from "./departure-card";
import { usePreferences } from "~/lib/preferences";
import {
  board,
  tripDetails,
  routeDetails,
  rememberStops,
} from "~/lib/transit/client";
import {
  clock,
  type Departure,
  type Route,
  type Stop,
  type Vehicle,
  type Journey,
  type Snapshot,
} from "~/lib/transit/model";
import {
  providerName,
  routeProvider,
  serviceTypeLabel,
  stopSubtitle,
  vehicleLineColor,
} from "~/lib/transit/labels";
import { serviceStyle, transport } from "~/lib/transit/badges";
import { useClock, useRemote } from "~/lib/transit/hooks";
import { disruptionStop, disruptionTrip, lineContext } from "~/lib/transit/disruptions";
import { shownDestination } from "~/lib/transit/destination";
import { DisruptionNotice, StationDisruptionNotice } from "./disruption-notice";

export { RouteBadge } from "./line-badge";
import { RouteBadge } from "./line-badge";

/** ViaBuszScreen.kt Notice: a quiet rounded message; errors use the error container. */
export function Notice({
  icon,
  children,
  error = false,
}: {
  icon: string;
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div className={`notice${error ? " notice-error" : ""}`} role="status">
      <Icon name={icon} size={17} />
      <p className="t-body-small">{children}</p>
    </div>
  );
}

export function DataStatus({
  at,
  error,
  loading,
  incomplete,
  fallbackUnavailable,
  retry,
}: {
  at?: number;
  error?: string;
  loading?: boolean;
  incomplete?: boolean;
  fallbackUnavailable?: boolean;
  retry?: () => void;
}) {
  const now = useClock();
  return (
    <div className="transit-status" aria-live="polite">
      <RefreshBar visible={!!loading} />
      {error ? (
        <div className="notice notice-error" role="status">
          <Icon name="wifi_off" size={17} />
          <p className="t-body-small">
            {error}{" "}
            {retry && (
              <button type="button" className="inline-link" onClick={retry}>
                Újra
              </button>
            )}
          </p>
        </div>
      ) : null}
      {at && now - at > 60_000 ? (
        <p className="t-label-medium on-variant status-line">
          Utolsó frissítés: {clock(at)}
        </p>
      ) : null}
      {incomplete && (
        <p className="t-body-small on-variant status-line">
          A szolgáltató csak a találatok egy részét adta vissza.
        </p>
      )}
      {fallbackUnavailable && !/MÁV|EMMA/i.test(error ?? "") && (
        <p className="t-body-small on-variant status-line">
          Az EMMA vasúti kiegészítés nem érhető el. A BKK adatai láthatók.
        </p>
      )}
    </div>
  );
}

/** ViaBuszScreen.kt StopPanel favourite: an icon button tinted with the accent. */
export function FavoriteButton({ stop }: { stop: Stop }) {
  const preferences = usePreferences(),
    saved = preferences.favorites.includes(stop.id);
  const label = saved ? "Eltávolítás a kedvencek közül" : "Megálló a kedvencekhez";
  return (
    <button
      type="button"
      className="icon-button primary"
      aria-label={label}
      title={label}
      aria-pressed={saved}
      onClick={() => {
        rememberStops([stop]);
        preferences.update({
          favorites: saved
            ? preferences.favorites.filter((id) => id !== stop.id)
            : [...preferences.favorites, stop.id],
        });
      }}
    >
      <Icon name="favorite" className={saved ? "" : "icon-outlined"} />
    </button>
  );
}

export function PlatformBadge({ code }: { code: string }) {
  return code.trim() ? (
    <span className="native-platform-badge">{code.trim()}</span>
  ) : null;
}

function stationAsset(stop: Stop) {
  if (stop.mode === "TRAM") return "tram";
  if (stop.mode === "TROLLEYBUS") return "trolley";
  if (["RAIL", "TRAMTRAIN"].includes(stop.mode)) return "train";
  if (stop.mode === "SUBURBAN_RAILWAY") return "hev";
  return stop.rawId.startsWith("volan_") ? "volan" : "bkk";
}

export function StopRow({
  stop,
  onSelect,
  allRoutes = false,
}: {
  allRoutes?: boolean;
  stop: Stop;
  onSelect: (stop: Stop) => void;
}) {
  return (
    <div className="transit-stop-row">
      <button
        type="button"
        className="transit-stop-main"
        onClick={() => onSelect(stop)}
      >
        <Image
          unoptimized
          src={`/transit/station_${stationAsset(stop)}.png`}
          alt=""
          width={30}
          height={30}
        />
        <span>
          <strong className="t-title-medium">
            {stop.name} <PlatformBadge code={stop.platform} />
          </strong>
          <span className="t-body-small on-variant">{stopSubtitle(stop)}</span>
          <span className="route-badges">
            {stop.routes.slice(0, allRoutes ? undefined : 7).map((route) => (
              <RouteBadge key={route.id} route={route} compact />
            ))}
            {!allRoutes && stop.routes.length > 7 && (
              <span>+{stop.routes.length - 7}</span>
            )}
          </span>
        </span>
      </button>
      <FavoriteButton stop={stop} />
    </div>
  );
}

/** The sheet's collapse chevron (ViaBuszScreen.kt onCollapse). */
function CollapseButton({
  expanded,
  onCollapse,
}: {
  expanded: boolean;
  onCollapse: () => void;
}) {
  const label = expanded
    ? "Indulások részleges nézete"
    : "Indulások elrejtése, térkép nagyítása";
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      title={label}
      onClick={onCollapse}
    >
      <Icon name="keyboard_arrow_down" />
    </button>
  );
}

/** ViaBuszScreen.kt StopPanel: pinned station header and window picker, then the departure list. */
export function StopBoard({
  stop,
  active = true,
  nearest = false,
  expanded = true,
  onToggleExpand,
  onCollapse,
  onTrip,
}: {
  stop: Stop;
  active?: boolean;
  nearest?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onCollapse?: () => void;
  onTrip: (departure: Departure) => void;
}) {
  const preferences = usePreferences(),
    now = useClock();
  const resource = useRemote(
    `board:${stop.id}:${preferences.windowMinutes}`,
    (signal) => board(stop, preferences.windowMinutes, signal),
    // A short debounce: quickly tapping through stops requests only the one that stays open.
    { active, interval: 20_000, debounce: 200 },
  );
  const rows = useMemo(
    () =>
      resource.data?.value.filter(
        (row) =>
          row.expected >= now - 30_000 &&
          row.expected <= now + preferences.windowMinutes * 60_000,
      ) ?? [],
    [resource.data, now, preferences.windowMinutes],
  );
  const stops = useMemo(() => [stop], [stop]);
  const refreshing = resource.loading;
  return (
    <div className="stop-panel">
      <div className="stop-panel-header" data-sheet-drag>
        <div className="stop-panel-eyebrow-row">
          <span className="t-label-medium primary grow">
            {nearest ? "Legközelebbi megálló" : "Kiválasztott megálló"}
          </span>
          <FavoriteButton stop={stop} />
          <CookieIconButton
            label="Indulások frissítése"
            size={44}
            disabled={refreshing}
            onClick={resource.retry}
          >
            <Icon name="refresh" className={refreshing ? "spinning" : ""} />
          </CookieIconButton>
          {onCollapse && (
            <CollapseButton expanded={expanded} onCollapse={onCollapse} />
          )}
        </div>
        <div className="stop-panel-title">
          {expanded || !onToggleExpand ? (
            <h2 className="t-headline-small">{stop.name}</h2>
          ) : (
            <h2 className="t-headline-small">
              <button
                type="button"
                className="title-button"
                onClick={onToggleExpand}
                aria-label={`${stop.name} – Indulások kibontása`}
              >
                {stop.name}
              </button>
            </h2>
          )}
          <PlatformBadge code={stop.platform} />
        </div>
        <p className="t-body-small on-variant stop-panel-subtitle">
          {stopSubtitle(stop)}
        </p>
      </div>
      <div className="stop-panel-selector">
        <DepartureWindowSelector />
      </div>
      {rows.length > 0 && refreshing ? (
        <RefreshBar visible />
      ) : (
        <hr className="panel-divider" />
      )}
      <div className="panel-scroll">
        <StationDisruptionNotice stops={stops} departures={rows} className="panel-notice" />
        {resource.error && (
          <Notice icon="wifi_off" error>
            {resource.error}{" "}
            <button type="button" className="inline-link" onClick={resource.retry}>
              Újra
            </button>
          </Notice>
        )}
        {resource.data?.incomplete && (
          <Notice icon="info">
            A szolgáltató csak a találatok egy részét adta vissza.
          </Notice>
        )}
        {rows.length === 0 && refreshing && (
          <div className="panel-loading">
            <RefreshBar visible />
          </div>
        )}
        {!refreshing && !resource.error && resource.data && rows.length === 0 && (
          <EmptyState
            icon="schedule"
            shape="cookie12"
            title="Most nincs közeli indulás"
            body={`A következő ${preferences.windowMinutes} percben nincs listázható járat. Válassz nagyobb időablakot vagy egy másik megállót.`}
          />
        )}
        <ul className="departure-list" aria-label="Indulások">
          {rows.map((row, index) => (
            <li key={row.id}>
              {index === 0 ? (
                <NextDepartureHero
                  departure={row}
                  now={now}
                  platform={stop.platform}
                  onSelect={() => onTrip(row)}
                />
              ) : (
                <DepartureBoardRow
                  departure={row}
                  now={now}
                  platform={stop.platform}
                  onSelect={() => onTrip(row)}
                />
              )}
            </li>
          ))}
        </ul>
        <p className="panel-footer t-label-medium on-variant">
          {resource.data
            ? `Utolsó frissítés: ${clock(resource.data.at)} · ${resource.data.source ?? stop.source}`
            : refreshing
              ? "Adatok betöltése…"
              : "Még nincs sikeres élő frissítés"}
        </p>
      </div>
    </div>
  );
}

/** LineComponents.kt LineStopRow: the route rail with a stop dot, its name and time. */
function LineStopRow({
  stop,
  first,
  last,
  color,
  onClick,
  past = false,
  highlighted = false,
  vehicle,
  time,
  live = false,
}: {
  stop: Stop;
  first: boolean;
  last: boolean;
  color: string;
  onClick: () => void;
  past?: boolean;
  highlighted?: boolean;
  vehicle?: string;
  time?: number;
  live?: boolean;
}) {
  const subtitle = first ? "Kiindulópont" : last ? "Végállomás" : "";
  return (
    <button
      type="button"
      className={[
        "line-stop-row",
        past ? "line-stop-past" : "",
        highlighted ? "line-stop-highlighted" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ "--line-color": color } as CSSProperties}
      onClick={onClick}
      aria-current={highlighted ? "location" : undefined}
    >
      <span
        className={[
          "line-stop-rail",
          first ? "line-stop-first" : "",
          last ? "line-stop-last" : "",
          first || last ? "line-stop-end" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-hidden="true"
      >
        <span className="line-stop-dot" />
        {vehicle && (
          <Image unoptimized src={vehicle} alt="Jármű helyzete" width={30} height={30} />
        )}
      </span>
      <span className="line-stop-text">
        <span className="line-stop-name">
          <span className="t-body-large">{stop.name}</span>
          <PlatformBadge code={stop.platform} />
        </span>
        {subtitle && (
          <span className="t-label-medium on-variant">{subtitle}</span>
        )}
      </span>
      {time !== undefined && (
        <span className="line-stop-time t-title-medium">
          {live && <Icon name="sensors" size={13} />}
          {clock(time)}
        </span>
      )}
    </button>
  );
}

/** LineComponents.kt LineVehicleBetween: the vehicle on the rail between two stops. */
function LineVehicleBetween({ color, vehicle }: { color: string; vehicle: string }) {
  return (
    <div className="line-vehicle-between" style={{ "--line-color": color } as CSSProperties}>
      <span className="line-stop-rail" aria-hidden="true">
        <Image unoptimized src={vehicle} alt="Jármű helyzete" width={30} height={30} />
      </span>
      <span className="t-label-large on-variant">Úton a következő megállóhoz</span>
    </div>
  );
}

/** RouteSummary.kt RouteDirectionRow. */
function RouteDirectionRow({
  route,
  destination,
  origin,
  onClick,
}: {
  route: Route;
  destination: string;
  origin?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <RouteBadge route={route} />
      <Icon name="arrow_forward" size={18} className="on-variant" />
      <span className="route-direction-text">
        <span className="t-title-medium clamp-2">{destination}</span>
        {origin && origin !== destination && (
          <span className="t-body-small on-variant clamp-2">Innen: {origin}</span>
        )}
      </span>
    </>
  );
  return onClick ? (
    <button type="button" className="route-direction-row route-direction-action" onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className="route-direction-row">{content}</div>
  );
}

/** DesignSystem.kt DepartureDetails: the chosen departure's own metadata. */
function DepartureDetails({ departure, platform }: { departure: Departure; platform?: string }) {
  const live = departure.live && !departure.cancelled;
  const destination = shownDestination(departure.destination, departure.route.name);
  return (
    <div className="departure-details">
      <span className="t-title-medium">{destination}</span>
      <span className="t-body-large">
        {live ? `Várható: ${clock(departure.expected)}` : clock(departure.expected)}
      </span>
      {live && departure.scheduled !== departure.expected && (
        <span className="t-body-medium">Menetrend: {clock(departure.scheduled)}</span>
      )}
      <span className="t-label-medium on-variant">
        {departure.cancelled ? "Kimarad" : live ? "Élő előrejelzés" : "Menetrend szerint"}
      </span>
      {platform && (
        <span>
          <PlatformBadge code={platform} />
        </span>
      )}
    </div>
  );
}

/** RouteBrowserCard.kt header: back, line badge, service type and operator, close. */
function RouteHeader({
  route,
  onBack,
  onClose,
}: {
  route: Route;
  onBack: () => void;
  onClose: () => void;
}) {
  return (
    <div className="route-header" data-sheet-drag>
      <button type="button" className="icon-button" aria-label="Vissza" title="Vissza" onClick={onBack}>
        <Icon name="arrow_back" />
      </button>
      <RouteBadge route={route} />
      <span className="route-header-text">
        <span className="t-title-medium">{serviceTypeLabel(route)}</span>
        <span className="t-label-medium on-variant">{providerName(routeProvider(route))}</span>
      </span>
      <button
        type="button"
        className="icon-button"
        aria-label="Vonalnézet bezárása"
        title="Vonalnézet bezárása"
        onClick={onClose}
      >
        <Icon name="close" />
      </button>
    </div>
  );
}

const stopsCount = (count: number) =>
  count === 1
    ? "1 megálló ezen a meneten"
    : `${count} megálló ezen a meneten · koppints az indulásokhoz`;

function lineColor(route?: Route, journey?: Journey) {
  if (route) return serviceStyle(route).background;
  return journey?.color ?? "var(--md-sys-color-primary)";
}

const vehicleIcon = (route?: Route) => `/transit/${transport(route).asset}_ui.png`;

/**
 * A trip opened from a departure (RouteBrowserCard.kt with DepartureDetails) or from a vehicle on the
 * map (VehiclePanel.kt), both ending in the LineStopRow timeline.
 */
export function TripPanel({
  tripId,
  active = true,
  departure,
  vehicle,
  highlightStopId,
  onBack,
  onClose,
  onStop,
  onGeometry,
}: {
  tripId: string;
  active?: boolean;
  departure?: Departure | null;
  vehicle?: Vehicle | null;
  highlightStopId?: string;
  onBack: () => void;
  onClose: () => void;
  onStop: (stop: Stop) => void;
  onGeometry?: (journey: Snapshot<Journey>) => void;
}) {
  const now = useClock();
  const resource = useRemote(tripId, (signal) => tripDetails(tripId, signal), {
    active,
    interval: 30_000,
    debounce: 150,
  });
  const geometryCallback = useRef(onGeometry);
  geometryCallback.current = onGeometry;
  useEffect(() => {
    if (resource.data) geometryCallback.current?.(resource.data);
  }, [resource.data]);
  const journey = resource.data?.value;
  const stops = useMemo(() => journey?.stops ?? [], [journey]);
  const scroller = useRef<HTMLDivElement>(null);
  const route: Route = useMemo(
    () =>
      departure?.route ??
      vehicle?.route ?? {
        id: journey?.routeId ?? tripId,
        name: journey?.name ?? vehicle?.name ?? "?",
        description: "",
        mode: vehicle?.mode ?? "BUS",
        color: journey?.color ?? "#199DCF",
        textColor: "#ffffff",
      },
    [departure, vehicle, journey, tripId],
  );
  const color = vehicle ? vehicleLineColor(vehicle) : lineColor(route, journey);
  // VehiclePanel / LineBrowser: the line's notices, its stops on this trip and (for a vehicle) its trip.
  const minute = Math.floor(now / 60_000);
  const disruptionContexts = useMemo(
    () => [
      lineContext(route, minute * 60_000, {
        stops: new Set(stops.flatMap(({ stop }) => [disruptionStop(stop.id) ?? disruptionStop(stop.rawId)].filter((id): id is string => !!id))),
        trip: vehicle ? disruptionTrip(vehicle.bkkTripId ?? vehicle.tripId) : null,
      }),
    ],
    [route, stops, vehicle, minute],
  );
  const destination =
    [departure?.destination, vehicle?.destination, stops.at(-1)?.stop.name].find(Boolean) ?? "";
  const origin = stops[0]?.stop.name;
  // VehicleStopProgress, from the timetable: the next stop is the first one not yet departed.
  const next = vehicle ? stops.findIndex((row) => row.time >= now - 30_000) : -1;
  const previous = next > 0 ? stops[next - 1] : undefined;
  // VehiclePanel.kt scrolls the timeline to the vehicle's next stop once its trip arrives.
  const scrolledTrip = useRef("");
  useEffect(() => {
    if (!vehicle || next < 0 || scrolledTrip.current === tripId) return;
    const box = scroller.current;
    const row = box?.querySelector<HTMLElement>(".line-stop-highlighted");
    if (!box || !row) return;
    scrolledTrip.current = tripId;
    // Scroll only the timeline. scrollIntoView would also scroll the overflow-hidden map screen and sheet,
    // shifting the whole layout up.
    const offset = row.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    box.scrollTop = Math.max(0, offset - (box.clientHeight - row.offsetHeight) / 2);
  }, [vehicle, next, tripId]);
  const timeline = (
    <>
      {resource.error && (
        <Notice icon="wifi_off" error>
          A menet megállói nem tölthetők be. Az újrapróbáláshoz koppints a frissítésre.
        </Notice>
      )}
      {!resource.data && resource.loading && (
        <p className="panel-message t-body-medium">A menet megállóinak betöltése…</p>
      )}
      {resource.data && stops.length === 0 && (
        <p className="panel-message t-body-medium on-variant">
          A forrás nem közölt megállólistát ehhez a járműhöz.
        </p>
      )}
      {stops.length > 0 && (
        <p className="stops-count t-label-medium on-variant">{stopsCount(stops.length)}</p>
      )}
      <ol className="line-stop-list">
        {stops.map(({ stop, time, live }, index) => (
          <li key={`${stop.id}:${index}`}>
            {vehicle && index === next && previous && (
              <LineVehicleBetween color={color} vehicle={vehicleIcon(route)} />
            )}
            <LineStopRow
              stop={stop}
              first={index === 0}
              last={index === stops.length - 1}
              color={color}
              time={time}
              live={live}
              past={next >= 0 && index < next}
              highlighted={vehicle ? index === next : stop.id === highlightStopId}
              onClick={() => onStop(stop)}
            />
          </li>
        ))}
      </ol>
      {resource.data && (
        <p className="panel-footer t-label-medium on-variant">
          Utolsó frissítés: {clock(resource.data.at)} · {resource.data.source ?? vehicle?.source ?? "BKK API"}
        </p>
      )}
    </>
  );

  if (vehicle) {
    const nextStop = next >= 0 ? stops[next] : undefined;
    const progress = nextStop
      ? previous
        ? `Megállók között: ${previous.stop.name} → ${nextStop.stop.name}`
        : `Következő megálló: ${nextStop.stop.name}`
      : "";
    const stale = now - vehicle.observedAt > 180_000;
    return (
      <div className="stop-panel">
        <DisruptionNotice contexts={disruptionContexts} className="panel-notice" />
        <div className="vehicle-header" data-sheet-drag>
          <button type="button" className="icon-button" aria-label="Vissza" title="Vissza" onClick={onBack}>
            <Icon name="arrow_back" />
          </button>
          <span className="vehicle-header-text">
            <span className="vehicle-header-line">
              <RouteBadge route={route} />
              <Icon name="arrow_forward" size={18} className="on-variant" />
              <span className="t-title-medium clamp-2">
                {destination || "A forrás nem adta meg a menetirányt."}
              </span>
            </span>
            <span className="t-label-medium on-variant">
              {serviceTypeLabel(route)} · {providerName(routeProvider(route))}
            </span>
            {origin && origin !== destination && (
              <span className="t-body-small on-variant clamp-2">Innen: {origin}</span>
            )}
          </span>
          <CookieIconButton
            label="Járműadatok frissítése"
            size={44}
            disabled={resource.loading}
            onClick={resource.retry}
          >
            <Icon name="refresh" className={resource.loading ? "spinning" : ""} />
          </CookieIconButton>
        </div>
        {progress && <p className="vehicle-progress t-label-large primary">{progress}</p>}
        {(vehicle.registration || vehicle.model) && (
          <p className="vehicle-meta t-label-medium on-variant">
            {[vehicle.model, vehicle.registration].filter(Boolean).join(" · ")}
          </p>
        )}
        <p className="vehicle-observed t-body-small on-variant">
          Forrásadat ideje:{" "}
          {new Date(vehicle.observedAt).toLocaleTimeString("hu-HU", {
            timeZone: "Europe/Budapest",
          })}{" "}
          · {vehicle.source}
        </p>
        {resource.loading ? <RefreshBar visible /> : <hr className="panel-divider full" />}
        <div className="panel-scroll" ref={scroller}>
          {stale && (
            <p className="panel-message t-body-medium error-text">
              Ez a pozíció már nem friss. A legutóbbi forrásadat ideje fent látható.
            </p>
          )}
          {timeline}
        </div>
      </div>
    );
  }

  return (
    <div className="stop-panel">
      <RouteHeader route={route} onBack={onBack} onClose={onClose} />
      <hr className="panel-divider full" />
      <div className="panel-scroll">
        {departure && <DepartureDetails departure={departure} />}
        <DisruptionNotice contexts={disruptionContexts} className="panel-notice" />
        {resource.loading && resource.data && <RefreshBar visible />}
        {destination && (
          <RouteDirectionRow route={route} destination={destination} origin={origin} />
        )}
        {timeline}
      </div>
    </div>
  );
}

/** RouteBrowserCard.kt / LineBrowser.kt: a line's directions, then the chosen direction's stops. */
export function LinePanel({
  route,
  active = true,
  highlightStopId,
  onClose,
  onStop,
  onGeometry,
}: {
  active?: boolean;
  route: Route;
  highlightStopId?: string;
  onClose: () => void;
  onStop: (stop: Stop) => void;
  onGeometry: (journey: Snapshot<Journey>) => void;
}) {
  const resource = useRemote(
    route.id,
    (signal) => routeDetails(route.id, signal),
    { active },
  );
  const [direction, setDirection] = useState<number | null>(null);
  const callback = useRef(onGeometry);
  callback.current = onGeometry;
  useEffect(() => {
    const value = resource.data?.value[direction ?? 0];
    if (value && resource.data) callback.current({ ...resource.data, value });
  }, [resource.data, direction]);
  const variants = useMemo(() => resource.data?.value ?? [], [resource.data]);
  const journey = direction === null ? undefined : variants[direction];
  const color = lineColor(route, journey);
  const now = useClock();
  const minute = Math.floor(now / 60_000);
  // LineBrowser.kt: the line's notices with every stop of its variants.
  const disruptionContexts = useMemo(
    () => [
      lineContext(route, minute * 60_000, {
        stops: new Set(
          variants.flatMap((variant) =>
            variant.stops.map(({ stop }) => disruptionStop(stop.id) ?? disruptionStop(stop.rawId)).filter((id): id is string => !!id),
          ),
        ),
      }),
    ],
    [route, variants, minute],
  );
  return (
    <div className="stop-panel">
      <RouteHeader
        route={route}
        onBack={() => (direction === null ? onClose() : setDirection(null))}
        onClose={onClose}
      />
      <hr className="panel-divider full" />
      <div className="panel-scroll">
        {resource.loading && <RefreshBar visible />}
        <DisruptionNotice contexts={disruptionContexts} className="panel-notice" />
        {resource.error && (
          <div className="panel-message">
            <p className="t-body-medium">A menetirányok nem tölthetők be. Próbáld újra.</p>
            <button type="button" className="button button-outlined" onClick={resource.retry}>
              Járműadatok frissítése
            </button>
          </div>
        )}
        {resource.data && variants.length === 0 && (
          <p className="panel-message t-body-medium">
            Ehhez a vonalhoz jelenleg nem érhető el menetirány.
          </p>
        )}
        {journey ? (
          <>
            <RouteDirectionRow
              route={route}
              destination={journey.name}
              origin={journey.stops[0]?.stop.name}
            />
            <p className="stops-count t-label-medium on-variant">
              {stopsCount(journey.stops.length)}
            </p>
            <ol className="line-stop-list">
              {journey.stops.map(({ stop }, index) => (
                <li key={`${stop.id}:${index}`}>
                  <LineStopRow
                    stop={stop}
                    first={index === 0}
                    last={index === journey.stops.length - 1}
                    color={color}
                    highlighted={stop.id === highlightStopId}
                    onClick={() => onStop(stop)}
                  />
                </li>
              ))}
            </ol>
          </>
        ) : (
          variants.map((variant, index) => (
            <RouteDirectionRow
              key={index}
              route={route}
              destination={variant.name}
              origin={variant.stops[0]?.stop.name}
              onClick={() => setDirection(index)}
            />
          ))
        )}
      </div>
    </div>
  );
}
