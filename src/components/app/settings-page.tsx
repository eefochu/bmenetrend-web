import { useEffect, useState } from "react";

import { Slider, Switch } from "~/components/material";
import { Icon, PageHeader, SectionTitle } from "~/components/ui";
import { usePreferences, type MapStyle } from "~/lib/preferences";
import { t } from "~/lib/strings";
import { accentSwatch, ACCENTS, luminance, type ThemeMode } from "~/lib/theme";
import { MapCreditsDialog } from "./map-attribution";

const THEMES: { mode: ThemeMode; label: string }[] = [
  { mode: "system", label: t.themeAuto },
  { mode: "light", label: t.themeLight },
  { mode: "dark", label: t.themeDark },
];
const MAP_STYLES: { style: MapStyle; label: string }[] = [
  { style: "street", label: t.mapStyleStreet },
  { style: "satellite", label: t.mapStyleSatellite },
];

/** Port of ui/SettingsPage.kt. Offline packs and OTA updates are Android-only and not part of the web app. */
export function SettingsPage({ onBack, onAbout }: { onBack: () => void; onAbout: () => void }) {
  const preferences = usePreferences();
  const [credits, setCredits] = useState(false);
  return (
    <div className="fullscreen-layer page" role="dialog" aria-modal="true" aria-label={t.settings}>
      <PageHeader title={t.settings} onBack={onBack} />
      <div className="page-scroll">
        <div className="page-column settings-column">
          <SectionTitle>{t.themeTitle}</SectionTitle>
          <div className="group-surface" role="radiogroup" aria-label={t.themeTitle}>
            <div className="choice-row">
              {THEMES.map(({ mode, label }) => (
                <ChoiceButton key={mode} selected={preferences.themeMode === mode} onClick={() => preferences.update({ themeMode: mode })}>
                  {label}
                </ChoiceButton>
              ))}
            </div>
          </div>

          <SectionTitle>{t.mapStyleTitle}</SectionTitle>
          <div className="group-surface">
            <div className="choice-row" role="radiogroup" aria-label={t.mapStyleTitle}>
              {MAP_STYLES.map(({ style, label }) => (
                <ChoiceButton key={style} selected={preferences.mapStyle === style} onClick={() => preferences.update({ mapStyle: style })}>
                  {label}
                </ChoiceButton>
              ))}
            </div>
            <p className="t-body-small on-variant group-hint">{t.mapStyleHint}</p>
          </div>

          <SectionTitle>{t.accentTitle}</SectionTitle>
          <p className="t-body-medium on-variant">{t.accentHint}</p>
          <div className="accent-grid" role="radiogroup" aria-label={t.accentTitle}>
            {ACCENTS.map(({ key }) => {
              const selected = preferences.accent === key;
              const color = accentSwatch(key, preferences.customAccent, preferences.scheme.primary);
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={`accent-tile${selected ? " accent-selected" : ""}`}
                  onClick={() => preferences.update({ accent: key })}
                >
                  <span className="accent-swatch" style={{ background: color }}>
                    {selected && <Icon name="check" size={18} style={{ color: luminance(color) > 0.35 ? "#000" : "#fff" }} />}
                  </span>
                  <span className="t-label-large fit-text">{t.accents[key]}</span>
                </button>
              );
            })}
          </div>
          {preferences.accent === "custom" && (
            <CustomColorPicker value={preferences.customAccent} onChange={(customAccent) => preferences.update({ customAccent })} />
          )}

          <SectionTitle>{t.transitData}</SectionTitle>
          <div className="group-surface padded">
            <label className="switch-row">
              <span className="t-title-medium">{t.nationwide}</span>
              <Switch
                selected={preferences.nationwide}
                onChange={(event) => preferences.update({ nationwide: (event.target as HTMLInputElement & { selected: boolean }).selected })}
                aria-label={t.nationwide}
              />
            </label>
            <p className="t-body-medium">{t.localScope}</p>
            <p className="t-body-small on-variant">{t.nationwideHint}</p>
          </div>
          <div className="group-surface padded">
            <p className="t-title-medium">{t.downloadedTimetables}</p>
            <p className="t-body-small on-variant">{t.noDownloadedTimetables}</p>
          </div>

          <button type="button" className="button button-outlined button-block" onClick={() => setCredits(true)}>
            {t.mapCreditsTitle}
          </button>
          <button type="button" className="button button-outlined button-block button-tall" onClick={onAbout}>
            <Icon name="info" size={20} />
            {t.about}
          </button>
        </div>
      </div>
      <MapCreditsDialog open={credits} onClose={() => setCredits(false)} />
    </div>
  );
}

function ChoiceButton({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" role="radio" aria-checked={selected} className={`choice-button t-label-large${selected ? " choice-selected" : ""}`} onClick={onClick}>
      <span className="fit-text">{children}</span>
    </button>
  );
}

/** SettingsPage.kt CustomColorPicker: preview, hex field and RGB sliders. */
function CustomColorPicker({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const toHex = (rgb: number) => rgb.toString(16).padStart(6, "0").toUpperCase();
  const [hex, setHex] = useState(toHex(value));
  useEffect(() => setHex(toHex(value)), [value]);
  const channels: [string, number][] = [
    [t.customColorRed, 16],
    [t.customColorGreen, 8],
    [t.customColorBlue, 0],
  ];
  return (
    <div className="custom-color">
      <p className="t-title-medium">{t.customColorTitle}</p>
      <div className="custom-color-preview" style={{ background: `#${toHex(value)}` }} />
      <label className="text-field">
        <span className="text-field-label t-body-small">{t.customColorHex}</span>
        <span className="text-field-input">
          <span className="on-variant">#</span>
          <input
            value={hex}
            maxLength={6}
            spellCheck={false}
            autoComplete="off"
            className="t-body-large"
            onChange={(event) => {
              const next = event.target.value.replace(/[^0-9a-f]/gi, "").slice(0, 6);
              setHex(next);
              if (next.length === 6) onChange(parseInt(next, 16));
            }}
          />
        </span>
      </label>
      {channels.map(([label, shift]) => {
        const channel = (value >> shift) & 255;
        return (
          <div key={label} className="slider-row">
            <span className="t-label-medium">
              {label} · {channel}
            </span>
            <Slider
              min={0}
              max={255}
              value={channel}
              aria-label={label}
              onInput={(event) => {
                const next = Number((event.target as HTMLInputElement).value);
                onChange((value & ~(255 << shift)) | (Math.min(255, Math.max(0, next)) << shift));
              }}
            />
          </div>
        );
      })}
      <p className="t-body-small on-variant">{t.customColorHint}</p>
    </div>
  );
}
