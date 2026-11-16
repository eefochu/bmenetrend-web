import { Icon } from "~/components/ui";
import { clock, type Departure } from "~/lib/transit/model";
import { RouteBadge } from "./line-badge";

function timing(row: Departure, now: number) {
  const shown = row.cancelled ? row.scheduled : row.expected;
  const minutes = Math.max(0, Math.ceil((shown - now) / 60_000));
  const delay = Math.max(
    0,
    Math.floor((row.expected - row.scheduled) / 60_000),
  );
  const live = row.live && !row.cancelled;
  const destination =
    row.destination || row.route.description || "A forrás nem adta meg a menetirányt.";
  return { shown, minutes, delay, live, destination };
}

function description(
  row: Departure,
  { shown, delay, live, destination }: ReturnType<typeof timing>,
  platform?: string,
) {
  return [
    row.route.name,
    destination,
    row.cancelled ? "Kimarad" : live ? "Élő előrejelzés" : "Menetrend szerint",
    live && row.expected !== row.scheduled
      ? `Várható: ${clock(shown)} · Menetrend: ${clock(row.scheduled)}`
      : clock(shown),
    delay ? `+${delay} perc` : "",
    platform ?? "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** DesignSystem.kt NextDepartureHero: the next departure on the accent container. */
export function NextDepartureHero({
  departure: row,
  now,
  platform,
  onSelect,
}: {
  departure: Departure;
  now: number;
  platform?: string;
  onSelect: () => void;
}) {
  const time = timing(row, now);
  const { shown, minutes, delay, live, destination } = time;
  return (
    <button
      type="button"
      className="departure-hero"
      onClick={onSelect}
      disabled={row.cancelled}
      aria-label={description(row, time, platform)}
    >
      <span className="departure-hero-main">
        <span className="departure-hero-badges">
          <RouteBadge route={row.route} />
          {platform && <span className="native-platform-badge">{platform}</span>}
        </span>
        <span className="t-title-large clamp-2">{destination}</span>
        <span className="departure-hero-status t-label-large">
          {live && <Icon name="sensors" size={15} />}
          {live ? "Élő előrejelzés" : "Menetrend szerint"} · {clock(shown)}
        </span>
      </span>
      <span className="departure-hero-time">
        {row.cancelled ? (
          <>
            <Icon name="cancel" size={32} />
            <span className="t-label-large-emphasized">Kimarad</span>
          </>
        ) : minutes <= 0 ? (
          <span className="t-headline-medium">Most</span>
        ) : minutes < 60 ? (
          <>
            <span className="t-display-medium">{minutes}</span>
            <span className="t-label-large-emphasized">perc</span>
          </>
        ) : (
          <span className="t-headline-medium">{clock(shown)}</span>
        )}
        {!row.cancelled && delay > 0 && (
          <span className="t-label-medium">+{delay} perc</span>
        )}
      </span>
    </button>
  );
}

/** DesignSystem.kt DepartureBoardRow: badge, destination and time; details open on tap. */
export function DepartureBoardRow({
  departure: row,
  now,
  platform,
  onSelect,
  clickable = true,
}: {
  departure: Departure;
  now: number;
  platform?: string;
  onSelect?: () => void;
  /** False inside a SegmentedItem that already handles the click. */
  clickable?: boolean;
}) {
  const time = timing(row, now);
  const { shown, minutes, delay, live, destination } = time;
  const content = (
    <>
      <RouteBadge route={row.route} />
      <span className="departure-row-destination t-body-large-emphasized">
        <span className="departure-direction" aria-hidden="true" />
        <span className="clamp-2">{destination}</span>
      </span>
      <span
        className={`departure-row-time t-title-medium${row.cancelled || delay > 0 ? " error-text" : ""}`}
      >
        {live && <Icon name="sensors" size={13} className="primary" />}
        <strong>
          {row.cancelled
            ? "Kimarad"
            : minutes < 60
              ? `${minutes}′`
              : clock(shown)}
        </strong>
      </span>
    </>
  );
  if (!clickable)
    return (
      <span className="departure-row" aria-label={description(row, time, platform)}>
        {content}
      </span>
    );
  return (
    <button
      type="button"
      className="departure-row departure-row-action"
      onClick={onSelect}
      disabled={row.cancelled}
      aria-label={description(row, time, platform)}
    >
      {content}
    </button>
  );
}
