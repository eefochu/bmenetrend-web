import { useState } from "react";

import { Checkbox, Radio } from "~/components/material";
import TransitMap from "~/components/map/transit-map";
import { CookieIconButton, Dialog, EmptyState, Icon, RefreshBar, ShapeIconTile } from "~/components/ui";
import { mapStyleUrl } from "~/lib/map-config";
import { distanceMeters, formatDistance, type GeoPoint } from "~/lib/places";
import { LOCAL_PROVIDERS, usePreferences } from "~/lib/preferences";
import { t } from "~/lib/strings";
import { useBackLayer } from "~/lib/use-back-layer";
import type { UserLocation } from "~/lib/use-user-location";
import { MapAttribution } from "./map-attribution";
import { DistancePill, ExampleChips, SearchGroupTitle, SearchResultCard, TransitSearchInput, usePlaceSearch } from "./search-components";

type Endpoint = { id: string; name: string; detail: string; position: GeoPoint };
type Field = "origin" | "destination";

const ZONE = "Europe/Budapest";

/** Budapest wall-clock time to an instant; null for DST gaps/overlaps, like TripPlanner.departure. */
function budapestInstant(date: string, time: string): Date | null {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  if (!y || !m || !d || h == null || mi == null) return null;
  const naive = Date.UTC(y, m - 1, d, h, mi);
  const format = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const matches = [60, 120]
    .map((offset) => naive - offset * 60_000)
    .filter((ms) => {
      const parts = Object.fromEntries(format.formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
      return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute)) === naive;
    });
  return matches.length === 1 ? new Date(matches[0]!) : null;
}

function budapestParts(at: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function departureLabel(at: Date) {
  return new Intl.DateTimeFormat("hu-HU", { timeZone: ZONE, dateStyle: "medium", timeStyle: "short" }).format(at);
}

/** Port of ui/PlannerScreen.kt (PlannerMapOverlay and PlannerSearch). Itineraries come with the EMMA planner port. */
export function PlannerScreen({ location }: { location: UserLocation }) {
  const preferences = usePreferences();
  const [origin, setOrigin] = useState<Endpoint | null>(null);
  const [destination, setDestination] = useState<Endpoint | null>(null);
  const [useLocation, setUseLocation] = useState(true);
  const [departure, setDeparture] = useState<Date | null>(null);
  const [editing, setEditing] = useState<Field | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(false);
  useBackLayer(editing != null, () => setEditing(null));

  const current: Endpoint | null = location.position
    ? { id: "current", name: t.plannerCurrent, detail: "", position: location.position }
    : null;
  const effectiveOrigin = useLocation ? current : origin;

  if (editing) {
    return (
      <PlannerSearch
        field={editing}
        userPosition={location.position}
        onBack={() => setEditing(null)}
        onCurrent={() => {
          setUseLocation(true);
          setOrigin(null);
          location.request();
          setEditing(null);
        }}
        onChoose={(endpoint) => {
          if (editing === "origin") {
            setOrigin(endpoint);
            setUseLocation(false);
          } else setDestination(endpoint);
          setEditing(null);
        }}
      />
    );
  }

  const swap = () => {
    setOrigin(destination);
    setDestination(effectiveOrigin);
    setUseLocation(false);
  };

  const findButton = (
    <div className="planner-find">
      <button type="button" className="button button-filled button-block button-tall" disabled aria-describedby="planner-pending">
        <Icon name="route" size={20} />
        {t.plannerFind}
      </button>
      <p id="planner-pending" className="t-body-small on-variant">
        {t.webPlannerPending}
      </p>
    </div>
  );

  return (
    <div className="planner">
      <div className="planner-layout">
      <div className="planner-controls">
        <div className="planner-title-row">
          <h1 className="t-title-large">{t.plannerTitle}</h1>
        </div>
        <div className="endpoints">
          <div className="endpoints-fields">
            <EndpointField field="origin" endpoint={effectiveOrigin} current={useLocation} onClick={() => setEditing("origin")} />
            <hr className="endpoint-divider" />
            <EndpointField field="destination" endpoint={destination} current={false} onClick={() => setEditing("destination")} />
          </div>
          <CookieIconButton label={t.plannerSwap} size={52} tone="high" onClick={swap} disabled={!effectiveOrigin && !destination}>
            <Icon name="swap_vert" />
          </CookieIconButton>
        </div>
        <div className="chip-row tight">
          <button type="button" className="assist-chip" onClick={() => setPickerOpen(true)}>
            <Icon name="schedule" size={18} />
            {departure ? departureLabel(departure) : t.plannerLeaveNow}
            <Icon name="expand_more" size={16} />
          </button>
          <button type="button" className="assist-chip" onClick={() => setServicesOpen(true)}>
            <Icon name="tune" size={18} />
            {t.plannerLocalServices}
            <Icon name="expand_more" size={16} />
          </button>
        </div>
        {destination && <div className="planner-find-wide">{findButton}</div>}
      </div>
      <div className="planner-map">
        <TransitMap
          styleUrl={mapStyleUrl(preferences.dark)}
          userPosition={location.position}
          route={{ origin: effectiveOrigin?.position ?? null, destination: destination?.position ?? null }}
          routeColor={preferences.scheme.primary}
        />
        <MapAttribution className="planner-attribution" />
      </div>
      {destination && <div className="planner-find-narrow">{findButton}</div>}
      </div>

      {pickerOpen && (
        <DeparturePicker
          open
          departure={departure}
          onClose={() => setPickerOpen(false)}
          onConfirm={(value) => {
            setDeparture(value);
            setPickerOpen(false);
          }}
        />
      )}
      <Dialog
        open={servicesOpen}
        onClose={() => setServicesOpen(false)}
        title={t.plannerLocalServices}
        actions={
          <button type="button" className="text-button" onClick={() => setServicesOpen(false)}>
            {t.plannerLocalServicesDone}
          </button>
        }
      >
        <p>{t.plannerLocalServicesDetail}</p>
        <div className="service-list">
          {LOCAL_PROVIDERS.map((provider) => {
            const checked = preferences.localProviders.includes(provider.id);
            return (
              <label key={provider.id} className="service-row">
                <span className="service-icon" aria-hidden="true">
                  <Icon name="directions_bus" size={22} />
                </span>
                <span className="t-body-large grow">{provider.name}</span>
                <Checkbox
                  checked={checked}
                  aria-label={provider.name}
                  onChange={(event) => {
                    const enabled = (event.target as HTMLInputElement).checked;
                    preferences.update({
                      localProviders: enabled
                        ? [...new Set([...preferences.localProviders, provider.id])]
                        : preferences.localProviders.filter((id) => id !== provider.id),
                    });
                  }}
                />
              </label>
            );
          })}
        </div>
      </Dialog>
    </div>
  );
}

function EndpointField({ field, endpoint, current, onClick }: { field: Field; endpoint: Endpoint | null; current: boolean; onClick: () => void }) {
  const label = field === "origin" ? t.plannerFrom : t.plannerTo;
  const icon = current ? "my_location" : field === "origin" ? "trip_origin" : "location_on";
  const name = current || endpoint?.id === "current" ? t.plannerCurrent : (endpoint?.name ?? (field === "destination" ? t.plannerSubtitle : t.plannerChoose));
  return (
    <button type="button" className="endpoint-field" onClick={onClick}>
      <Icon name={icon} className="primary" />
      <span className="endpoint-text">
        <span className="t-label-medium on-variant">{label}</span>
        <span className="t-body-large clamp-2">{name}</span>
        {endpoint?.detail && !current && <span className="t-body-small on-variant clamp-1">{endpoint.detail}</span>}
      </span>
      <Icon name="chevron_right" className="on-variant" />
    </button>
  );
}

/** DeparturePicker.kt: now, or a date and time in Budapest time. */
function DeparturePicker({ open, departure, onClose, onConfirm }: { open: boolean; departure: Date | null; onClose: () => void; onConfirm: (value: Date | null) => void }) {
  const initial = budapestParts(departure ?? new Date(Date.now() + 300_000));
  const [later, setLater] = useState(departure != null);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [invalid, setInvalid] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      icon="schedule"
      title={t.plannerDeparture}
      actions={
        <>
          <button type="button" className="text-button" onClick={onClose}>
            {t.plannerCancel}
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              if (!later) return onConfirm(null);
              const chosen = budapestInstant(date, time);
              if (!chosen || chosen.getTime() < Date.now()) setInvalid(true);
              else onConfirm(chosen);
            }}
          >
            {t.plannerApply}
          </button>
        </>
      }
    >
      {[false, true].map((option) => (
        <label key={String(option)} className="radio-row">
          <Radio
            name="departure"
            checked={later === option}
            onChange={() => {
              setLater(option);
              setInvalid(false);
            }}
          />
          <span>{option ? t.plannerLeaveLater : t.plannerLeaveNow}</span>
        </label>
      ))}
      {later && (
        <>
          <label className="date-field">
            <Icon name="calendar_month" size={20} />
            <input type="date" value={date} min={budapestParts(new Date()).date} onChange={(event) => setDate(event.target.value)} aria-label={t.plannerDeparture} />
          </label>
          <label className="date-field">
            <Icon name="schedule" size={20} />
            <input type="time" value={time} onChange={(event) => setTime(event.target.value)} aria-label={t.plannerDeparture} />
          </label>
          <p className="t-body-small">{t.plannerDepartureZone}</p>
        </>
      )}
      {invalid && <p className="error-text">{t.plannerDepartureInvalid}</p>}
    </Dialog>
  );
}

/** PlannerScreen.kt PlannerSearch. Stop suggestions arrive with the EMMA/BKK stop port. */
function PlannerSearch({
  field,
  userPosition,
  onBack,
  onCurrent,
  onChoose,
}: {
  field: Field;
  userPosition: GeoPoint | null;
  onBack: () => void;
  onCurrent: () => void;
  onChoose: (endpoint: Endpoint) => void;
}) {
  const [query, setQuery] = useState("");
  const search = usePlaceSearch(query, true);
  const places = search.query === query ? search.places : [];
  const searching = query.trim().length >= 2 && (search.query !== query || search.loading);
  return (
    <div className="planner planner-search">
      <div className="search-screen-column">
        <TransitSearchInput query={query} onQuery={setQuery} onBack={onBack} label={field === "origin" ? t.plannerFrom : t.plannerTo} />
        {field === "origin" && (
          <button type="button" className="button button-tonal current-location-button" onClick={onCurrent}>
            <Icon name="my_location" size={20} />
            {t.plannerCurrent}
          </button>
        )}
        <RefreshBar visible={searching} />
        <div className="search-results">
          {query.trim().length < 2 ? (
            <>
              <EmptyState title={t.searchDiscoverTitle} body={t.searchDiscoverBody} icon="search" />
              <ExampleChips examples={["Keleti pályaudvar", "Kelenföld", "Nyugati pályaudvar"]} onPick={setQuery} />
            </>
          ) : (
            <>
              <p className="status-line t-body-medium">{t.webStopSearchPending}</p>
              {places.length > 0 && (
                <>
                  <SearchGroupTitle title={t.searchPlaces} />
                  <div className="segment-group">
                    {places.map((place, index) => (
                      <SearchResultCard
                        key={place.id}
                        name={place.name}
                        detail={place.address}
                        index={index}
                        count={places.length}
                        leading={<ShapeIconTile icon="location_on" size={44} shape="cookie4" />}
                        trailing={userPosition ? <DistancePill text={formatDistance(distanceMeters(userPosition, place.position))} /> : undefined}
                        onClick={() => onChoose({ id: place.id, name: place.name, detail: place.address, position: place.position })}
                      />
                    ))}
                  </div>
                  <p className="status-line t-label-small on-variant">{t.searchPlacesAttribution}</p>
                </>
              )}
              {!searching && places.length === 0 && (
                <p className="status-line t-body-medium">{search.unavailable ? t.plannerSearchError : t.plannerNoPlaces}</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
