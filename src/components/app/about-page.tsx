import { ExternalLink, PageHeader } from "~/components/ui";
import { t } from "~/lib/strings";

const VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "web";

/** Port of ui/AboutPage.kt. The Android OTA update entry has no web counterpart. */
export function AboutPage({ onBack }: { onBack: () => void }) {
  return (
    <div className="fullscreen-layer page" role="dialog" aria-modal="true" aria-label={t.about}>
      <PageHeader title={t.about} onBack={onBack} />
      <div className="page-scroll">
        <div className="page-column about-column">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="" width={64} height={64} className="about-icon" />
          <h2 className="t-headline-medium">{t.brand}</h2>
          <span className="version-pill t-label-large">{t.aboutVersion(`${VERSION} (web)`)}</span>
          <div className="group-surface padded about-card">
            <h3 className="t-title-medium">{t.about}</h3>
            <p className="t-body-medium">{t.aboutAppDescription}</p>
          </div>
          <div className="about-sources">
            <h3 className="t-title-medium">{t.aboutAction}</h3>
            <p className="t-body-small">{t.aboutDescription}</p>
            <p className="t-body-small">{t.aboutLiveData}</p>
            <p className="t-body-small">{t.volanAbout}</p>
            <hr className="divider" />
            <ExternalLink href="https://mavplusz.hu/">{t.linkMavplusz}</ExternalLink>
            <ExternalLink href="https://openfreemap.org/">{t.linkOpenFreeMap}</ExternalLink>
            <ExternalLink href="https://github.com/komoot/photon">{t.linkPhoton}</ExternalLink>
            <ExternalLink href="https://viabusz.biatorbagy.hu/">{t.linkViabusz}</ExternalLink>
            <ExternalLink href="https://kanyargo.paty.hu/">{t.linkKanyargo}</ExternalLink>
            <ExternalLink href="https://homm.hu/helyi-kozlekedes/">{t.linkHomm}</ExternalLink>
          </div>
        </div>
      </div>
    </div>
  );
}
