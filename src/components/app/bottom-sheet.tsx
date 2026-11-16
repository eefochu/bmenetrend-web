import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

import { t } from "~/lib/strings";

export type SheetValue = "hidden" | "partial" | "expanded";

type BottomSheetProps = {
  value: SheetValue;
  onChange: (value: SheetValue) => void;
  /** Height of the area the sheet lives in. */
  areaHeight: number;
  peek: number;
  /** Space kept free above the expanded sheet (the docked desktop panel stays below the search bar). */
  topReserve?: number;
  /** Receives the visible sheet height on every frame, drags included (Android reads requireOffset()). */
  onVisible: (visible: number) => void;
  children: ReactNode;
};

const ORDER: SheetValue[] = ["hidden", "partial", "expanded"];

/**
 * Material 3 standard bottom sheet (BottomSheetScaffold with skipHiddenState = false): hidden, peeking and
 * expanded anchors, a drag handle that toggles, and drags from the handle or any `[data-sheet-drag]` area.
 */
export function BottomSheet({ value, onChange, areaHeight, peek, topReserve = 8, onVisible, children }: BottomSheetProps) {
  const sheet = useRef<HTMLDivElement>(null);
  const height = Math.max(peek, Math.min(areaHeight - topReserve, Math.round(areaHeight * 0.88) + 48));
  const offsetFor = (target: SheetValue) => (target === "expanded" ? 0 : target === "partial" ? height - peek : height);
  const offset = useRef(offsetFor(value));
  const drag = useRef<{ startY: number; start: number; moved: boolean; samples: { y: number; at: number }[] } | null>(null);
  const suppressClick = useRef(false);
  const visible = useRef(onVisible);
  visible.current = onVisible;

  const place = (next: number, animate: boolean) => {
    offset.current = next;
    const node = sheet.current;
    if (!node) return;
    node.dataset.dragging = animate ? "false" : "true";
    node.style.transform = `translateY(${next}px)`;
    visible.current(Math.max(0, height - next));
  };

  useLayoutEffect(() => {
    place(offsetFor(value), true);
    // offsetFor depends only on height and peek.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, height, peek]);

  useEffect(() => {
    const node = sheet.current;
    if (!node) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (event.button !== 0 || !target.closest("[data-sheet-drag]")) return;
      if (target.closest("input, textarea, [role=radiogroup]")) return;
      drag.current = { startY: event.clientY, start: offset.current, moved: false, samples: [{ y: event.clientY, at: event.timeStamp }] };
    };
    const onPointerMove = (event: PointerEvent) => {
      const state = drag.current;
      if (!state) return;
      const dy = event.clientY - state.startY;
      if (!state.moved && Math.abs(dy) < 6) return;
      if (!state.moved) {
        state.moved = true;
        node.setPointerCapture(event.pointerId);
      }
      state.samples.push({ y: event.clientY, at: event.timeStamp });
      if (state.samples.length > 6) state.samples.shift();
      place(Math.min(height, Math.max(0, state.start + dy)), false);
    };
    const onPointerUp = (event: PointerEvent) => {
      const state = drag.current;
      drag.current = null;
      if (!state?.moved) return;
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
      if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
      const first = state.samples[0]!;
      const velocity = (event.clientY - first.y) / Math.max(1, event.timeStamp - first.at);
      const anchors = ORDER.map((anchor) => ({ anchor, at: offsetFor(anchor) }));
      let target: SheetValue;
      if (Math.abs(velocity) > 0.5) {
        // Fling: settle on the next anchor in the fling direction from where the drag ends. A drag that
        // already reached the last anchor (clamped at the bottom or top) stays there instead of bouncing back.
        const down = velocity > 0;
        const ahead = anchors.filter((a) => (down ? a.at >= offset.current - 1 : a.at <= offset.current + 1));
        const outermost = down ? anchors[0]! : anchors[anchors.length - 1]!;
        target = (down ? ahead.sort((a, b) => a.at - b.at)[0] : ahead.sort((a, b) => b.at - a.at)[0])?.anchor ?? outermost.anchor;
      } else {
        target = anchors.reduce((best, a) => (Math.abs(a.at - offset.current) < Math.abs(best.at - offset.current) ? a : best)).anchor;
      }
      place(offsetFor(target), true);
      if (target !== value) onChange(target);
    };
    node.addEventListener("pointerdown", onPointerDown);
    node.addEventListener("pointermove", onPointerMove);
    node.addEventListener("pointerup", onPointerUp);
    node.addEventListener("pointercancel", onPointerUp);
    return () => {
      node.removeEventListener("pointerdown", onPointerDown);
      node.removeEventListener("pointermove", onPointerMove);
      node.removeEventListener("pointerup", onPointerUp);
      node.removeEventListener("pointercancel", onPointerUp);
    };
    // offsetFor depends only on height and peek.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, peek, value, onChange]);

  const expanded = value === "expanded";
  return (
    <section
      ref={sheet}
      className="bottom-sheet"
      style={{ height }}
      aria-label={t.departures}
      inert={value === "hidden"}
      onClickCapture={(event) => {
        if (suppressClick.current) {
          event.stopPropagation();
          event.preventDefault();
        }
      }}
    >
      <button
        type="button"
        className="sheet-handle"
        data-sheet-drag
        aria-label={expanded ? t.collapseDepartures : t.expandDepartures}
        aria-expanded={expanded}
        onClick={() => onChange(expanded ? "partial" : "expanded")}
      >
        <span aria-hidden="true" />
      </button>
      <div className="sheet-content" style={{ height: height - 48 }}>
        {children}
      </div>
    </section>
  );
}
