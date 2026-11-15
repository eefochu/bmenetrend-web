import { useEffect, useRef } from "react";

type LayerState = { bmDepth?: number } | null;

function depthOf(state: unknown): number {
  return (state as LayerState)?.bmDepth ?? 0;
}

// history.back() is asynchronous. While our own back navigations are in flight, new layers wait,
// and the popstate events they cause are not mistaken for the person pressing back.
let installed = false;
let pendingBacks = 0;
let ignoringPop = false;
const queued: (() => void)[] = [];

function install() {
  if (installed) return;
  installed = true;
  window.addEventListener("popstate", () => {
    ignoringPop = pendingBacks > 0;
    if (!ignoringPop) return;
    pendingBacks--;
    if (pendingBacks === 0) setTimeout(() => queued.splice(0).forEach((run) => run()), 0);
  });
}

function whenSettled(run: () => void) {
  if (pendingBacks > 0) queued.push(run);
  else run();
}

/**
 * The web counterpart of Compose's BackHandler: while `open`, a history entry represents the layer,
 * so the browser or phone back gesture closes it, like Android's system back. Escape closes the
 * top-most layer too. Closing from the UI removes the entry again.
 */
export function useBackLayer(open: boolean, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  const depth = useRef(0);

  useEffect(() => {
    if (!open) return;
    install();
    let mine = 0;
    let active = true;
    let poppedHere = false;
    whenSettled(() => {
      if (!active) return;
      mine = depthOf(window.history.state) + 1;
      depth.current = mine;
      window.history.pushState({ bmDepth: mine }, "");
    });
    const onPop = (event: PopStateEvent) => {
      if (ignoringPop || mine === 0) return;
      if (depthOf(event.state) < mine) {
        poppedHere = true;
        close.current();
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || mine === 0) return;
      if (depthOf(window.history.state) !== mine || document.querySelector("dialog[open]")) return;
      event.preventDefault();
      close.current();
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown", onKey);
    return () => {
      active = false;
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", onKey);
      if (mine !== 0 && !poppedHere && depthOf(window.history.state) === mine) {
        pendingBacks++;
        window.history.back();
      }
    };
  }, [open]);
}
