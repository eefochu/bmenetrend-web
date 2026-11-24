import { useSyncExternalStore } from "react";
import { request } from "./client";
import { EMPTY_DISRUPTIONS, parseDisruptions, type DisruptionSnapshot } from "./disruptions";

/**
 * TransitViewModel.observe's disruption loop: one shared Worker request per minute while a notice is on
 * screen and the page is visible and online. A failed refresh keeps earlier notices, marked unavailable.
 */
let snapshot: DisruptionSnapshot = EMPTY_DISRUPTIONS;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let controller: AbortController | undefined;
let lastAttempt = 0;
const INTERVAL = 60_000;

function publish(next: DisruptionSnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

async function poll() {
  clearTimeout(timer);
  if (!listeners.size) return;
  if (document.hidden || !navigator.onLine) return;
  const wait = lastAttempt + INTERVAL - Date.now();
  if (wait > 0) {
    timer = setTimeout(() => void poll(), wait);
    return;
  }
  lastAttempt = Date.now();
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  try {
    publish(parseDisruptions(await request("service-disruptions", {}, signal), snapshot));
  } catch {
    if (signal.aborted) return;
    publish({ ...snapshot, alertsUnavailable: true, changesUnavailable: true, attempted: true });
  }
  if (listeners.size && !signal.aborted) timer = setTimeout(() => void poll(), INTERVAL);
}

const resume = () => {
  if (document.hidden || !navigator.onLine) {
    clearTimeout(timer);
    controller?.abort();
  } else void poll();
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    window.addEventListener("offline", resume);
    void poll();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", resume);
    }
  };
}

export function useDisruptions(): DisruptionSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => EMPTY_DISRUPTIONS,
  );
}
