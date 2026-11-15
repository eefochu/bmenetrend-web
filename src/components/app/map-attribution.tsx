import { useState } from "react";

import { Dialog, ExternalLink } from "~/components/ui";
import { usePreferences } from "~/lib/preferences";
import { t } from "~/lib/strings";

const LINKS: [string, string][] = [
  ["OpenStreetMap · ODbL 1.0", "https://www.openstreetmap.org/copyright"],
  ["OpenMapTiles · CC BY 4.0", "https://openmaptiles.org/"],
  ["OpenFreeMap", "https://openfreemap.org/"],
  ["EOxCloudless · EOX · Copernicus Sentinel 2016", "https://cloudless.eox.at/"],
  ["Sentinel-2 2016 · CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/"],
  ["MapLibre GL JS · BSD 3-Clause", "https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt"],
  ["Google Sans Flex · SIL OFL 1.1", "/map/fonts/OFL.txt"],
];

/** MapAttribution.kt MapCreditsDialog, with web sources (MapLibre GL JS instead of Native). */
export function MapCreditsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t.mapCreditsTitle}
      actions={
        <button type="button" className="text-button" onClick={onClose}>
          {t.close}
        </button>
      }
    >
      <p>
        Térképadatok: © OpenStreetMap közreműködők, ODbL 1.0. Online csempék: OpenFreeMap, OpenMapTiles séma (CC BY 4.0).
        Térképmotor: MapLibre GL JS (BSD 3-Clause).
      </p>
      <p className="t-body-small">{t.mapStyleCredit}</p>
      <p className="t-body-small">{t.mapSatelliteCredit}</p>
      {LINKS.map(([label, href]) => (
        <ExternalLink key={href} href={href}>
          {label}
        </ExternalLink>
      ))}
      <ExternalLink href="/map/credits.html">Részletes licencszövegek</ExternalLink>
    </Dialog>
  );
}

/**
 * On-map credit chip (MapAttribution.kt). Android labels it "Térképinfó"; the web keeps the required
 * OpenStreetMap / OpenFreeMap / OpenMapTiles names visible on the chip itself.
 */
export function MapAttribution({ className }: { className?: string }) {
  const { mapStyle } = usePreferences();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`map-attribution${className ? ` ${className}` : ""}`}
        onClick={() => setOpen(true)}
        aria-label={t.mapCreditsTitle}
        title={t.mapCreditsTitle}
      >
        {mapStyle === "satellite"
          ? "EOxCloudless by EOX IT Services GmbH · Copernicus Sentinel 2016"
          : "© OpenStreetMap · OpenMapTiles · OpenFreeMap"}
      </button>
      <MapCreditsDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
