import type { GeoPoint } from "~/lib/places";
import type { Itinerary, Stop } from "../model";

/** PlannerEndpoint / PlanPoint: a named position (stops also carry their identity). */
export type PlanPlace = { id?: string; name: string; position: GeoPoint; platform?: string };
/** A directed street-network walk (WalkingLink). */
export type WalkingLink = { from: PlanPlace; to: PlanPlace; seconds: number; meters: number };
export type WalkPair = [PlanPlace, PlanPlace];
export type WalkingResult = { links: Map<string, WalkingLink>; partial: boolean };
export type Bounds = { west: number; south: number; east: number; north: number };

/** WalkKey: the exact positions of a walk's ends. */
export const walkKey = (a: GeoPoint, b: GeoPoint) => `${a.lat},${a.lon}>${b.lat},${b.lon}`;

/** Port of data/PlannerBackend.kt's interface. */
export interface PlannerBackend {
  routes(from: PlanPlace, to: PlanPlace, ready: number, busesOnly: boolean, signal: AbortSignal): Promise<Itinerary[]>;
  /** Without slower walk-sparing enrichment: for the many middle segments of combined journeys. */
  plainRoutes(from: PlanPlace, to: PlanPlace, ready: number, busesOnly: boolean, signal: AbortSignal): Promise<Itinerary[]>;
  /** Journeys found by a router told to avoid walking; empty when the source has no such mode. */
  walkAverseRoutes(from: PlanPlace, to: PlanPlace, ready: number, busesOnly: boolean, signal: AbortSignal): Promise<Itinerary[]>;
  walking(pairs: WalkPair[], ready: number, signal: AbortSignal): Promise<WalkingResult>;
  stops(bounds: Bounds, signal: AbortSignal): Promise<Stop[]>;
  clearRouteCache(): void;
}

export class Semaphore {
  private waiting: (() => void)[] = [];
  constructor(private free: number) {}
  async use<T>(signal: AbortSignal, task: () => Promise<T>): Promise<T> {
    if (this.free > 0) this.free--;
    else
      await new Promise<void>((resolve, reject) => {
        const go = () => {
          signal.removeEventListener("abort", stop);
          resolve();
        };
        const stop = () => {
          this.waiting = this.waiting.filter((entry) => entry !== go);
          reject(new DOMException("Megszakítva", "AbortError"));
        };
        if (signal.aborted) return stop();
        signal.addEventListener("abort", stop, { once: true });
        this.waiting.push(go);
      });
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.free++;
    }
  }
}

export const aborted = () => new DOMException("Megszakítva", "AbortError");

/** Runs [task] with its own signal, aborted after [ms] or with the parent; null on timeout (withTimeoutOrNull). */
export async function withTimeout<T>(ms: number, signal: AbortSignal, task: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
  if (signal.aborted) throw aborted();
  const controller = new AbortController();
  const stop = () => controller.abort();
  signal.addEventListener("abort", stop, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);
  try {
    return await task(controller.signal);
  } catch (error) {
    if (signal.aborted) throw aborted();
    if (timedOut) return null;
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
  }
}
