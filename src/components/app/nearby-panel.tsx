import type { ReactNode } from "react";
import type { Departure, Stop } from "~/lib/transit/model";
import { CookieIconButton, Icon, RefreshBar, SegmentedItem, ShapeIconTile } from "~/components/ui";
import { DepartureWindowSelector } from "./departure-window-selector";
import { DepartureBoardRow } from "./departure-card";
import { DistancePill } from "./search-components";
import { PlatformBadge } from "./transit-components";
import { formatDistance } from "~/lib/transit/labels";
import { t } from "~/lib/strings";

export type NearbyStation = {
  stop: Stop;
  distance: number;
  /** Undefined while the station's board is loading. */
  departures?: Departure[];
  unavailable?: boolean;
};

type NearbyPanelProps = {
  loading: boolean;
  stations: NearbyStation[];
  now: number;
  atUser: boolean;
  /** Android's stopStatus: why there is nothing to show yet (zoom, network, location). */
  status?: string | null;
  notice?: ReactNode;
  expanded: boolean;
  onStop: (stop: Stop) => void;
  onDeparture: (departure: Departure, stop: Stop) => void;
  onRefresh: () => void;
  onToggleExpand: () => void;
  onCollapse: () => void;
  onSearch: () => void;
};

/** ui/NearbyPanel.kt: each nearby station is one boxed group, its header then its next three departures. */
export function NearbyPanel({
  stations,
  loading,
  now,
  atUser,
  status,
  notice,
  expanded,
  onStop,
  onDeparture,
  onRefresh,
  onToggleExpand,
  onCollapse,
  onSearch,
}: NearbyPanelProps) {
  return (
    <div className="panel-scroll">
      <div className="nearby-header" data-sheet-drag>
        <div className="nearby-title-row">
          <h2 className="t-headline-small grow">
            {expanded ? (
              t.nearbyTitle
            ) : (
              <button
                type="button"
                className="title-button"
                onClick={onToggleExpand}
                aria-label={`${t.nearbyTitle} – ${t.expandDepartures}`}
              >
                {t.nearbyTitle}
              </button>
            )}
          </h2>
          <CookieIconButton
            label="Indulások frissítése"
            size={52}
            disabled={loading}
            onClick={onRefresh}
          >
            <Icon name="refresh" className={loading ? "spinning" : ""} />
          </CookieIconButton>
          <button
            type="button"
            className="icon-button"
            onClick={onCollapse}
            aria-label={expanded ? t.collapseDepartures : t.hideDepartures}
            title={expanded ? t.collapseDepartures : t.hideDepartures}
          >
            <Icon name="keyboard_arrow_down" />
          </button>
        </div>
        <p className="t-body-small on-variant">{atUser ? t.nearbyYou : t.nearbyMap}</p>
        <DepartureWindowSelector />
      </div>
      <div className="nearby-refresh">
        <RefreshBar visible={loading && stations.length > 0} />
      </div>
      {notice}
      {stations.length === 0 && loading && (
        <div className="panel-loading">
          <RefreshBar visible />
        </div>
      )}
      {stations.length === 0 && !loading && (
        <div className="nearby-empty">
          <ShapeIconTile icon="near_me" shape="cookie7" />
          <p className="t-body-medium on-variant centered">
            {status ??
              "Ezen a környéken most nincs megjeleníthető indulás. Keress megállóra, vagy mozdítsd el a térképet."}
          </p>
          <button type="button" className="button button-outlined button-block" onClick={onSearch}>
            <Icon name="search" size={20} />
            {t.findStop}
          </button>
        </div>
      )}
      <div className="nearby-groups">
        {stations.map((station) => {
          const shown = station.departures?.slice(0, 3) ?? [];
          const count = 1 + shown.length;
          return (
            <section key={station.stop.id} className="nearby-station" aria-label={station.stop.name}>
              <SegmentedItem
                index={0}
                count={count}
                color="surface-container-high"
                onClick={() => onStop(station.stop)}
              >
                <span className="nearby-station-header">
                  <span className="nearby-station-title">
                    <span className="t-title-medium clamp-2">{station.stop.name}</span>
                    <PlatformBadge code={station.stop.platform} />
                    <span className="spacer" />
                    <DistancePill text={formatDistance(station.distance)} />
                    <Icon name="chevron_right" size={20} className="on-variant" />
                  </span>
                  {station.departures?.length === 0 && (
                    <span className="t-body-small on-variant">
                      {station.unavailable
                        ? "Az indulások nem érhetők el. Automatikusan újrapróbáljuk."
                        : "Ebben az időszakban nincs indulás."}
                    </span>
                  )}
                </span>
              </SegmentedItem>
              {shown.map((departure, index) => (
                <SegmentedItem
                  key={departure.id}
                  index={index + 1}
                  count={count}
                  onClick={departure.cancelled ? undefined : () => onDeparture(departure, station.stop)}
                >
                  <DepartureBoardRow departure={departure} now={now} clickable={false} />
                </SegmentedItem>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
