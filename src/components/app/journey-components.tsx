import { Fragment, useState } from "react";
import { Icon, PageHeader } from "~/components/ui";
import { serviceStyle } from "~/lib/transit/badges";
import { serviceTypeLabel } from "~/lib/transit/labels";
import { clock, type Itinerary, type Leg, type Route } from "~/lib/transit/model";
import { transfers, travelLegs } from "~/lib/transit/planner";
import { RouteBadge } from "./line-badge";
import { PlatformBadge } from "./transit-components";

/** Port of ui/JourneyComponents.kt: ItineraryCard, JourneyBar and JourneyDetail. */

/** PlannerScreen.kt clockMinutes / legMinutes. */
export const clockMinutes = (start: number, end: number) =>
  Math.max(0, Math.round((Math.floor(end / 60_000) * 60_000 - Math.floor(start / 60_000) * 60_000) / 60_000));
const legMinutes = (leg: Leg) => Math.max(1, clockMinutes(leg.start, leg.end));
const walking = (leg: Leg) => leg.mode === "WALK";

export const legRoute = (leg: Leg): Route => ({
  id: leg.routeId ?? "",
  name: leg.name || leg.mode,
  description: leg.headsign ?? "",
  mode: leg.mode,
  color: leg.color,
  textColor: "#ffffff",
});
const movementColor = (leg: Leg) =>
  walking(leg) ? "var(--md-sys-color-tertiary)" : serviceStyle(legRoute(leg)).background;

function ClockWithDate({ time, start }: { time: number; start: number }) {
  const day = (at: number) => new Date(at).toLocaleDateString("hu-HU", { timeZone: "Europe/Budapest" });
  return (
    <span className="journey-clock">
      <span className="t-title-medium-emphasized">{clock(time)}</span>
      {day(time) !== day(start) && <span className="t-label-small on-variant">{day(time)}</span>}
    </span>
  );
}

/** Walking and riding only; idle gaps stay in the total time and in the detailed steps. */
export function JourneyBar({ trip, ready }: { trip: Itinerary; ready: number }) {
  const start = Math.min(ready, trip.start);
  const legs = travelLegs(trip);
  const total = Math.max(1, legs.reduce((sum, leg) => sum + leg.end - leg.start, 0));
  return (
    <div className="journey-bar">
      <div className="journey-bar-clocks">
        <ClockWithDate time={start} start={start} />
        <ClockWithDate time={trip.end} start={start} />
      </div>
      <div className="journey-bar-track" aria-label="A sáv a gyaloglást és az utazást mutatja.">
        {legs.map((leg, index) => (
          <span
            key={index}
            style={{ flexGrow: (leg.end - leg.start) / total, background: movementColor(leg) }}
          />
        ))}
      </div>
    </div>
  );
}

export function ItineraryCard({
  trip,
  recommended,
  now,
  ready,
  onClick,
}: {
  trip: Itinerary;
  recommended: boolean;
  now: number;
  ready: number;
  onClick: () => void;
}) {
  const legs = travelLegs(trip);
  const walkMinutes = legs.filter(walking).reduce((sum, leg) => sum + legMinutes(leg), 0);
  const changes = transfers(trip);
  return (
    <button type="button" className={`itinerary-card${recommended ? " itinerary-recommended" : ""}`} onClick={onClick}>
      <JourneyBar trip={trip} ready={ready} />
      <span className="itinerary-legs">
        {legs.map((leg, index) => (
          <span key={index} className="itinerary-leg">
            {walking(leg) ? (
              <>
                <Icon name="directions_walk" size={22} />
                <span className="t-label-large">{legMinutes(leg)} p</span>
              </>
            ) : (
              <RouteBadge route={legRoute(leg)} />
            )}
          </span>
        ))}
      </span>
      <span className="itinerary-summary">
        <span className="grow">
          <span className="t-label-large-emphasized primary">
            {recommended ? "Ajánlott útvonal" : "Másik jó választás"}
          </span>
          <span className="t-body-small on-variant">
            {changes === 0 ? "Átszállás nélkül" : `${changes} átszállás`} · {walkMinutes} perc séta
          </span>
        </span>
        <span className="t-headline-medium-emphasized">{clockMinutes(Math.min(ready, trip.start), trip.end)} p</span>
      </span>
      <hr className="panel-divider" />
      <span className="itinerary-steps t-label-large primary">
        <span className="grow">Út részletei</span>
        <Icon name="chevron_right" />
      </span>
      {trip.start < now - 30_000 && (
        <span className="t-label-medium error-text">Az indulási idő elmúlt · tervezz újra</span>
      )}
    </button>
  );
}

function TimelineRow({
  top,
  bottom,
  point = false,
  dotted = false,
  clockSlot,
  children,
}: {
  top?: string;
  bottom?: string;
  point?: boolean;
  dotted?: boolean;
  clockSlot?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="timeline-row">
      <span className="timeline-clock">{clockSlot}</span>
      <span className={`timeline-rail${dotted ? " timeline-dotted" : ""}`} aria-hidden="true">
        <span className="timeline-top" style={{ background: top ?? "transparent" }} />
        <span className="timeline-bottom" style={{ background: bottom ?? "transparent" }} />
        {point && <span className="timeline-dot" style={{ borderColor: bottom ?? top }} />}
      </span>
      <div className="timeline-content">{children}</div>
    </div>
  );
}

function TimelinePoint({
  name,
  platform,
  time,
  start,
  top,
  bottom,
}: {
  name: string;
  platform?: string;
  time: number;
  start: number;
  top?: string;
  bottom?: string;
}) {
  return (
    <TimelineRow top={top} bottom={bottom} point clockSlot={<ClockWithDate time={time} start={start} />}>
      <span className="timeline-point">
        <span className="t-body-large-emphasized">{name}</span>
        {platform && <PlatformBadge code={platform} />}
      </span>
    </TimelineRow>
  );
}

function LegDescription({ leg }: { leg: Leg }) {
  const [expanded, setExpanded] = useState(false);
  if (walking(leg))
    return (
      <div className="leg-description">
        <Icon name="directions_walk" className="tertiary" />
        <span className="t-title-small">
          Gyaloglás: {legMinutes(leg)} perc · {Math.round(leg.distance)} m
        </span>
      </div>
    );
  const route = legRoute(leg);
  return (
    <div className="leg-description">
      <span className="leg-heading">
        <RouteBadge route={route} />
        <Icon name="arrow_forward" size={16} className="on-variant" />
        <span className="t-title-medium grow">{leg.headsign ?? leg.to}</span>
      </span>
      <span className="t-body-small on-variant">{serviceTypeLabel(route)}</span>
      <span className="t-body-small on-variant">
        {legMinutes(leg)} p · {leg.live ? "Élő előrejelzés" : "Menetrend szerint"}
      </span>
      {leg.stayOnBoard && <span className="t-label-large primary">Maradj a járművön</span>}
      {leg.intermediate.length > 0 && (
        <>
          <button
            type="button"
            className="leg-stops-toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            <span className="grow">{leg.intermediate.length} köztes megálló</span>
            <Icon
              name={expanded ? "expand_less" : "expand_more"}
              aria-label={expanded ? "Köztes megállók elrejtése" : "Köztes megállók megjelenítése"}
            />
          </button>
          {expanded && (
            <ul className="leg-stops">
              {leg.intermediate.map((stop, index) => (
                <li key={index}>
                  <span className="leg-stop-dot" style={{ background: movementColor(leg) }} />
                  <span className="t-body-medium">{stop}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** The arrival and departure are one point when the source reports the same instant and place. */
const sharedJunction = (previous?: Leg, next?: Leg) =>
  Boolean(
    previous &&
      next &&
      previous.end === next.start &&
      previous.toPosition &&
      next.fromPosition &&
      Math.abs(previous.toPosition.lat - next.fromPosition.lat) < 1e-5 &&
      Math.abs(previous.toPosition.lon - next.fromPosition.lon) < 1e-5,
  );

export function JourneyDetail({
  trip,
  readyAt,
  originName,
  destinationName,
  now,
  departureText,
  onBack,
}: {
  trip: Itinerary;
  readyAt: number;
  originName: string;
  destinationName: string;
  now: number;
  departureText: string;
  onBack: () => void;
}) {
  const legs = travelLegs(trip);
  const colors = legs.map(movementColor);
  const wait = "var(--md-sys-color-outline-variant)";
  const initialWait = clockMinutes(readyAt, trip.start);
  return (
    <div className="fullscreen-layer page journey-detail" role="dialog" aria-modal="true" aria-label="Az út lépései">
      <PageHeader title="Az út lépései" onBack={onBack} />
      <div className="page-scroll">
        <div className="journey-detail-column">
          <section className="journey-summary">
            <span className="t-label-large primary">{departureText}</span>
            <h2 className="t-title-large-emphasized">
              {originName} → {destinationName}
            </h2>
            <JourneyBar trip={trip} ready={readyAt} />
            <span className="t-title-medium">{clockMinutes(Math.min(readyAt, trip.start), trip.end)} perces út</span>
            <span className="t-body-small on-variant">
              A sáv a gyaloglást és az utazást mutatja. A teljes idő a várakozást is tartalmazza, amely a lépéseknél
              külön látható.
            </span>
            {trip.start < now - 30_000 && (
              <span className="error-text">Ez az út már elkezdődött. Indulás előtt tervezz újra.</span>
            )}
          </section>
          <div className="journey-timeline">
            {trip.start - readyAt >= 60_000 && initialWait > 0 && (
              <>
                <TimelinePoint name={originName} time={readyAt} start={readyAt} bottom={wait} />
                <TimelineRow top={wait} bottom={wait}>
                  <span className="timeline-wait t-body-small on-variant">{initialWait} perc várakozás</span>
                </TimelineRow>
              </>
            )}
            {legs.map((leg, index) => {
              const previous = legs[index - 1];
              const next = legs[index + 1];
              const color = colors[index]!;
              const waitAfter = next ? next.start - leg.end : 0;
              return (
                <Fragment key={index}>
                  {!sharedJunction(previous, leg) && (
                    <TimelinePoint
                      name={index === 0 ? originName : leg.from}
                      platform={walking(leg) ? undefined : leg.fromPlatform}
                      time={leg.start}
                      start={trip.start}
                      top={previous ? (previous.end < leg.start ? wait : color) : undefined}
                      bottom={color}
                    />
                  )}
                  <TimelineRow top={color} bottom={color} dotted={walking(leg)}>
                    <LegDescription leg={leg} />
                  </TimelineRow>
                  <TimelinePoint
                    name={next ? leg.to : destinationName}
                    platform={walking(leg) ? next?.fromPlatform : (leg.toPlatform ?? (sharedJunction(leg, next) ? next?.fromPlatform : undefined))}
                    time={leg.end}
                    start={trip.start}
                    top={color}
                    bottom={next ? (waitAfter > 0 ? wait : colors[index + 1]) : undefined}
                  />
                  {next && waitAfter >= 60_000 && clockMinutes(leg.end, next.start) > 0 && (
                    <TimelineRow top={wait} bottom={wait}>
                      <span className="timeline-wait t-body-small on-variant">
                        <Icon name="schedule" size={18} />
                        {clockMinutes(leg.end, next.start)} perc várakozás
                      </span>
                    </TimelineRow>
                  )}
                </Fragment>
              );
            })}
          </div>
          <p className="t-body-small on-variant journey-source">{PLANNER_SOURCE}</p>
        </div>
      </div>
    </div>
  );
}

export const PLANNER_SOURCE =
  "Útvonaltervezés: BKK FUTÁR, kiegészítve az országos EMMA/MÁVPlusz tervezővel. Csak az élőként jelzett szakaszok használnak valós idejű előrejelzést.";
