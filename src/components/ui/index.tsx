import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from "react";

import { t } from "~/lib/strings";
import { SHAPES, type CookieShape } from "./shapes";

/** Material Symbols Rounded, filled like Compose's Icons.Rounded set. */
export function Icon({
  name,
  size = 24,
  className,
  style,
}: {
  name: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={`icon${className ? ` ${className}` : ""}`}
      style={{ fontSize: size, ...style }}
      aria-hidden="true"
    >
      {name}
    </span>
  );
}

type CookieIconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  size?: number;
  shape?: CookieShape;
  elevated?: boolean;
  tone?: "secondary" | "high" | "primary";
};

/**
 * DesignSystem.kt CookieIconButton: a cookie that morphs into a circle under the pointer and springs
 * back on release. The hit target is the full square.
 */
export function CookieIconButton({
  label,
  size = 48,
  shape = "cookie9",
  elevated = false,
  tone = "secondary",
  className,
  style,
  children,
  ...rest
}: CookieIconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={[
        "cookie-button",
        `cookie-${tone}`,
        elevated ? "cookie-elevated" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={
        {
          width: size,
          height: size,
          "--cookie-shape": SHAPES[shape],
          "--cookie-pressed": SHAPES.circle,
          ...style,
        } as CSSProperties
      }
      {...rest}
    >
      <span className="cookie-surface" aria-hidden="true" />
      <span className="cookie-content">{children}</span>
    </button>
  );
}

/** DesignSystem.kt ShapeIconTile: an expressive shape with a large centred icon. */
export function ShapeIconTile({
  icon,
  shape = "cookie9",
  size = 96,
  prominent = false,
}: {
  icon: string;
  shape?: CookieShape;
  size?: number;
  prominent?: boolean;
}) {
  return (
    <span
      className={`shape-tile ${prominent ? "shape-tile-prominent" : ""}`}
      style={{ width: size, height: size, clipPath: SHAPES[shape] }}
      aria-hidden="true"
    >
      <Icon name={icon} size={Math.round(size * 0.42)} />
    </span>
  );
}

/** ViaBuszScreen.kt EmptyState. */
export function EmptyState({
  title,
  body,
  icon,
  shape = "cookie9",
}: {
  title: string;
  body: string;
  icon: string;
  shape?: CookieShape;
}) {
  return (
    <div className="empty-state">
      <ShapeIconTile icon={icon} shape={shape} />
      <h2 className="t-title-large">{title}</h2>
      <p className="t-body-medium on-variant">{body}</p>
    </div>
  );
}

/**
 * DesignSystem.kt SegmentedItem: one item of a grouped list. Ends of a group are round (28px), the
 * inside corners tight (8px); a pressed item springs its corners open and gives a little.
 */
export function SegmentedItem({
  index,
  count,
  onClick,
  color = "surface-container",
  className,
  children,
  label,
}: {
  index: number;
  count: number;
  onClick?: () => void;
  color?: "surface-container" | "surface-container-high";
  className?: string;
  children: ReactNode;
  label?: string;
}) {
  const classes = [
    "segment",
    `segment-${color}`,
    index <= 0 ? "segment-first" : "",
    index >= count - 1 ? "segment-last" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  if (!onClick) return <div className={classes}>{children}</div>;
  return (
    <button
      type="button"
      className={`${classes} segment-action`}
      onClick={onClick}
      aria-label={label}
    >
      {children}
    </button>
  );
}

/**
 * DesignSystem.kt ConnectedSelector: a single-choice connected button group (M3 Expressive).
 * Every option is visible; the chosen one morphs to a pill.
 */
export function ConnectedSelector<T extends string | number>({
  options,
  selected,
  onSelect,
  label,
  text,
  className,
  selectedShape,
}: {
  options: readonly T[];
  selected: T;
  onSelect: (value: T) => void;
  label: string;
  text: (value: T) => string;
  className?: string;
  selectedShape?: CookieShape;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={[
        "connected-selector",
        selectedShape ? "connected-cookie" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={
        selectedShape
          ? ({
              "--connected-shape": SHAPES[selectedShape],
              "--connected-pressed-shape": SHAPES.circle,
            } as CSSProperties)
          : undefined
      }
      onKeyDown={(event) => {
        const current = options.indexOf(selected);
        const step =
          event.key === "ArrowRight" || event.key === "ArrowDown"
            ? 1
            : event.key === "ArrowLeft" || event.key === "ArrowUp"
              ? -1
              : 0;
        if (!step) return;
        event.preventDefault();
        const next = (current + step + options.length) % options.length;
        onSelect(options[next]!);
        refs.current[next]?.focus();
      }}
    >
      {options.map((option, index) => {
        const chosen = option === selected;
        return (
          <button
            key={String(option)}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={chosen}
            tabIndex={chosen ? 0 : -1}
            className={[
              "connected-option",
              chosen ? "connected-checked" : "",
              index === 0 ? "connected-leading" : "",
              index === options.length - 1 ? "connected-trailing" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => onSelect(option)}
          >
            <span className="fit-text">{text(option)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** DesignSystem.kt TransitPageHeader. */
export function PageHeader({
  title,
  onBack,
  actions,
}: {
  title: string;
  onBack: () => void;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <button
        type="button"
        className="icon-button"
        onClick={onBack}
        aria-label={t.back}
        title={t.back}
      >
        <Icon name="arrow_back" />
      </button>
      <h1 className="t-headline-small">{title}</h1>
      {actions}
    </header>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="section-title t-title-medium">{children}</h2>;
}

const WAVE_WIDTH = 2400;
const WAVE_PATH = `M0 5${" q5 -4 10 0 t10 0".repeat(WAVE_WIDTH / 20)}`;

/** DesignSystem.kt TransitRefreshBar (Material 3 Expressive wavy progress, indeterminate). */
export function RefreshBar({
  visible,
  inset = 0,
}: {
  visible: boolean;
  inset?: number;
}) {
  return (
    <div className="refresh-bar" style={{ paddingInline: inset }}>
      {visible && (
        <div
          className="wavy-progress"
          role="progressbar"
          aria-label={t.loading}
        >
          <svg
            width={WAVE_WIDTH}
            height="10"
            viewBox={`0 0 ${WAVE_WIDTH} 10`}
            aria-hidden="true"
          >
            <path d={WAVE_PATH} />
          </svg>
        </div>
      )}
    </div>
  );
}

/** Material AlertDialog on the native <dialog>: focus trap, Escape and inert background for free. */
export function Dialog({
  open,
  onClose,
  title,
  icon,
  children,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: string;
  children: ReactNode;
  actions: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="m3-dialog"
      aria-labelledby="dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="m3-dialog-body">
          {icon && <Icon name={icon} className="m3-dialog-icon" />}
          <h2
            id="dialog-title"
            className={`t-headline-small ${icon ? "centered" : ""}`}
          >
            {title}
          </h2>
          <div className="m3-dialog-content t-body-medium">{children}</div>
          <div className="m3-dialog-actions">{actions}</div>
        </div>
      )}
    </dialog>
  );
}

export function ExternalLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      className="text-button link-row"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span>{children}</span>
      <Icon name="open_in_new" size={16} />
    </a>
  );
}
