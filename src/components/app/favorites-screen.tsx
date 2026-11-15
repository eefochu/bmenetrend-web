import { Icon, ShapeIconTile } from "~/components/ui";
import { t } from "~/lib/strings";

/**
 * Port of ui/FavoritesScreen.kt. Saved stops come with the stop catalogue port (the heart on a stop's
 * departure board); until then this is the screen's genuine empty state.
 */
export function FavoritesScreen({ onBrowse }: { onBrowse: () => void }) {
  return (
    <div className="favorites-screen">
      <div className="page-intro">
        <h1 className="t-headline-large-emphasized">{t.favoritesTitle}</h1>
      </div>
      <div className="favorites-list">
        <div className="favorites-empty">
          <ShapeIconTile icon="favorite" shape="cookie12" />
          <h2 className="t-title-large centered">{t.favoritesIntro}</h2>
          <p className="t-body-medium on-variant centered">{t.favoritesEmpty}</p>
        </div>
      </div>
      <div className="favorites-action">
        <button type="button" className="button button-filled button-hero" onClick={onBrowse}>
          <Icon name="add" size={20} />
          {t.addStop}
        </button>
      </div>
    </div>
  );
}
