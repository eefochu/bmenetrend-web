import { ConnectedSelector } from "~/components/ui";
import {
  compactDuration,
  DEPARTURE_WINDOWS,
  usePreferences,
} from "~/lib/preferences";
import { t } from "~/lib/strings";

/**
 * DesignSystem.kt DepartureWindowSelector: Material's connected toggle group, the chosen window a pill.
 * Shared by nearby stops and station boards.
 */
export function DepartureWindowSelector() {
  const { windowMinutes, update } = usePreferences();
  return (
    <ConnectedSelector
      options={DEPARTURE_WINDOWS}
      selected={windowMinutes}
      onSelect={(value) => update({ windowMinutes: value })}
      label={t.departures}
      text={compactDuration}
    />
  );
}
