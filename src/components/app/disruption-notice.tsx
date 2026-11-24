import { useMemo, useState } from "react";
import { Dialog, Icon } from "~/components/ui";
import {
  alertsStale,
  changesStale,
  disruptionWarnings,
  isImportant,
  localized,
  safeUrl,
  stationContexts,
  type DisruptionContext,
  type DisruptionWarning,
} from "~/lib/transit/disruptions";
import type { Departure, Stop } from "~/lib/transit/model";
import { useClock } from "~/lib/transit/hooks";
import { useDisruptions } from "~/lib/transit/use-disruptions";

/** values/disruption_strings.xml */
const s = {
  title: "Forgalmi változások",
  details: "Forgalmi változások részletei",
  more: (count: number) => `További ${count} tájékoztatás`,
  unavailableDetail:
    "A friss forgalmi tájékoztatás nem érhető el. A korábbi figyelmeztetések elavulhattak; indulás előtt ellenőrizd a BKK aktuális tájékoztatását.",
  staleShort: "A friss adatok nem érhetők el",
  official: "Részletek a BKK oldalán",
  updated: (at: string) => `BKK forgalmi tájékoztatás: ${at}`,
  cancelled: "Ez a járat kimarad",
  cancelledDetail: "A BKK friss menetmódosításai szerint az érintett indulás elmarad. Válassz másik indulást, vagy tervezz újra.",
  skipped: "Ez a járat érintett megállót hagy ki",
  skippedDetail:
    "A BKK friss menetmódosításai szerint ez a járat az útvonalad legalább egy megállójában nem áll meg. Ellenőrizd a fel- és leszállási lehetőségeket, vagy tervezz újra.",
  close: "Bezárás",
  cancelledRoute: (label: string) => `${label}: ez az indulás kimarad`,
  skippedRoute: (label: string) => `${label}: megállókimaradás`,
};

function warningTitle(warning: DisruptionWarning) {
  if (warning.alert) return localized(warning.alert.title) || s.title;
  if (warning.serviceLabel) return warning.change?.cancelled ? s.cancelledRoute(warning.serviceLabel) : s.skippedRoute(warning.serviceLabel);
  return warning.change?.cancelled ? s.cancelled : s.skipped;
}

const updatedFormat = new Intl.DateTimeFormat("hu-HU", {
  timeZone: "Europe/Budapest",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** Port of ui/DisruptionNotice.kt: one compact, relevant notice; details stay behind a deliberate tap. */
export function DisruptionNotice({ contexts, className }: { contexts: DisruptionContext[]; className?: string }) {
  const snapshot = useDisruptions();
  const now = useClock();
  const minute = Math.floor(now / 60_000);
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  const warnings = useMemo(
    () => disruptionWarnings(snapshot, contexts, now, offline),
    // Recomputed each minute, like Android's epochSecond / 60 key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapshot, contexts, minute, offline],
  );
  const [open, setOpen] = useState(false);
  if (!warnings.length) return null;
  const unavailable =
    snapshot.attempted && contexts.some((c) => c.bkk) && (offline || alertsStale(snapshot, now) || changesStale(snapshot, now));
  const important = warnings.some(isImportant);
  const icon = important ? "warning" : "info";
  return (
    <>
      <button
        type="button"
        className={`disruption-notice ${important ? "important" : ""} ${className ?? ""}`}
        onClick={() => setOpen(true)}
        aria-label={`${warningTitle(warnings[0]!)} – ${s.details}`}
      >
        <Icon name={icon} size={22} />
        <span className="disruption-text">
          <span className="t-label-large clamp-2">{warningTitle(warnings[0]!)}</span>
          {warnings.length > 1 && <span className="t-body-small">{s.more(warnings.length - 1)}</span>}
          {unavailable && <span className="t-body-small">{s.staleShort}</span>}
        </span>
        <Icon name="chevron_right" size={20} />
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={s.title}
        icon={icon}
        actions={
          <button type="button" className="text-button" onClick={() => setOpen(false)}>
            {s.close}
          </button>
        }
      >
        <div className="disruption-details">
          {unavailable && <p className="t-body-medium">{s.unavailableDetail}</p>}
          {warnings.map((warning) => {
            const body = warning.alert ? localized(warning.alert.description) : "";
            const link = warning.alert ? safeUrl(localized(warning.alert.urls)) : null;
            return (
              <section key={`${warning.alert ? "a" : "t"}:${warning.id}`} className="disruption-item">
                <h3 className="t-title-medium">{warningTitle(warning)}</h3>
                {body && <p className="t-body-medium">{body}</p>}
                {link && (
                  <a className="text-button" href={link} target="_blank" rel="noopener noreferrer">
                    {s.official}
                  </a>
                )}
                {warning.change && <p className="t-body-medium">{warning.change.cancelled ? s.cancelledDetail : s.skippedDetail}</p>}
                {warning.stale && <p className="t-label-medium">{s.staleShort}</p>}
                <hr />
              </section>
            );
          })}
          {snapshot.alertsAt !== null && <p className="t-label-small">{s.updated(updatedFormat.format(snapshot.alertsAt))}</p>}
        </div>
      </Dialog>
    </>
  );
}

/** StationDisruptionNotice */
export function StationDisruptionNotice({ stops, departures, className }: { stops: Stop[]; departures: Departure[]; className?: string }) {
  const now = useClock();
  const minute = Math.floor(now / 60_000);
  const contexts = useMemo(
    () => stationContexts(stops, minute * 60_000, departures),
    [stops, departures, minute],
  );
  return <DisruptionNotice contexts={contexts} className={className} />;
}
