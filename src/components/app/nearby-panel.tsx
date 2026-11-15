import { ConnectedSelector, Icon, RefreshBar, ShapeIconTile } from "~/components/ui";
import { compactDuration, DEPARTURE_WINDOWS, usePreferences } from "~/lib/preferences";
import { t } from "~/lib/strings";
import type { UserLocation } from "~/lib/use-user-location";

type NearbyPanelProps = {
  expanded: boolean;
  location: UserLocation;
  onToggleExpand: () => void;
  onCollapse: () => void;
  onSearch: () => void;
};

/**
 * Port of ui/NearbyPanel.kt. The station list arrives with the departures port; until then the panel
 * shows Android's status slot (stopStatus) instead of an "empty area" claim.
 */
export function NearbyPanel({ expanded, location, onToggleExpand, onCollapse, onSearch }: NearbyPanelProps) {
  const { windowMinutes, update } = usePreferences();
  const notice =
    location.status === "denied" || location.status === "unavailable"
      ? t.locationDenied
      : location.status === "locating"
        ? t.locating
        : null;
  return (
    <div className="panel-scroll">
      <div className="nearby-header" data-sheet-drag>
        <div className="nearby-title-row">
          <h2 className="t-headline-small grow">
            {expanded ? (
              t.nearbyTitle
            ) : (
              <button type="button" className="title-button" onClick={onToggleExpand} aria-label={`${t.nearbyTitle} – ${t.expandDepartures}`}>
                {t.nearbyTitle}
              </button>
            )}
          </h2>
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
        <p className="t-body-small on-variant">{location.position ? t.nearbyYou : t.nearbyMap}</p>
        <ConnectedSelector
          options={DEPARTURE_WINDOWS}
          selected={windowMinutes as (typeof DEPARTURE_WINDOWS)[number]}
          onSelect={(value) => update({ windowMinutes: value })}
          label={t.departures}
          text={compactDuration}
        />
      </div>
      <RefreshBar visible={false} inset={22} />
      {notice && (
        <div className="notice">
          <Icon name="my_location" size={17} />
          <p className="t-body-small">{notice}</p>
        </div>
      )}
      <div className="nearby-empty">
        <ShapeIconTile icon="near_me" shape="cookie7" />
        <p className="t-body-medium on-variant centered">{t.webNearbyPending}</p>
        <button type="button" className="button button-outlined button-block" onClick={onSearch}>
          <Icon name="search" size={20} />
          {t.findStop}
        </button>
      </div>
    </div>
  );
}
