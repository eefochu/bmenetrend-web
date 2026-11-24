import { distanceMeters } from "~/lib/places";
import { knownStops } from "../client";
import type { Stop } from "../model";
import { aborted, type PlannerBackend, type PlanPlace } from "./backend";
import { BkkFirstPlannerBackend } from "./bkk-first";
import { budapestDay } from "./calendar";
import { feasible, supported } from "./core";
import { EmmaPlannerBackend } from "./emma-planner";
import { HybridTripPlanner, timelyChoices, type TripPlan } from "./hybrid";
import type { LocalNetwork } from "./local-network";
import { localNetwork } from "../local";
import { indexedDbStorage, persistentWalking, WalkingLinkStore } from "./walking-store";

/** A GPS origin moving less than this between prefetch and Find still counts as the same search. */
export const SAME_ORIGIN_METERS = 20;
/** Oldest prefetched search Find may reuse. */
export const WARM_PLAN_MAX_AGE_SECONDS = 90;
/** Prefetch starts this long after the completed form settles. */
export const WARM_DELAY_MILLIS = 250;

export type PlanForm = {
  origin: PlanPlace;
  destination: PlanPlace;
  /** Chosen departure (epoch ms); null leaves now. */
  departure: number | null;
  localProviders: readonly string[];
};

type WarmPlan = { form: PlanForm; startedAt: number; ready: number; result: Promise<TripPlan>; controller: AbortController };

/** PlanKey.matches: same destination, departure and providers; the origin moved at most 20 m. */
export function sameSearch(a: PlanForm, b: PlanForm) {
  const providers = (form: PlanForm) => [...new Set(form.localProviders)].sort().join(",");
  return (
    a.destination.position.lat === b.destination.position.lat &&
    a.destination.position.lon === b.destination.position.lon &&
    a.departure === b.departure &&
    providers(a) === providers(b) &&
    distanceMeters(a.origin.position, b.origin.position) <= SAME_ORIGIN_METERS
  );
}

export type PlannerDependencies = {
  backend: PlannerBackend;
  planner: HybridTripPlanner;
  loadNetwork: (signal: AbortSignal) => Promise<LocalNetwork>;
  nationalStops: () => readonly Stop[];
  clock: () => number;
};

/**
 * PlannerViewModel's search orchestration without UI state: the complete search runs in the background
 * once the form is complete (warm plan); Find joins it when it still answers exactly this form.
 */
export class PlannerSession {
  private warm: WarmPlan | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Local timetables load once per Budapest day and are shared by every search (planningNetwork()). */
  private network: { day: string; promise: Promise<LocalNetwork> } | null = null;

  constructor(private deps: PlannerDependencies) {}

  private sharedNetwork = (signal: AbortSignal): Promise<LocalNetwork> => {
    const day = budapestDay(this.deps.clock());
    if (this.network?.day !== day) {
      const controller = new AbortController();
      const promise = this.deps.loadNetwork(controller.signal);
      const entry = { day, promise };
      promise.catch(() => {
        if (this.network === entry) this.network = null;
      });
      this.network = entry;
    }
    const shared = this.network.promise;
    return new Promise((resolve, reject) => {
      const stop = () => reject(aborted());
      if (signal.aborted) return stop();
      signal.addEventListener("abort", stop, { once: true });
      shared.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
    });
  };

  private run(form: PlanForm, requested: number, ready: number, signal: AbortSignal) {
    return this.deps.planner.plan(
      form.origin,
      form.destination,
      requested,
      ready,
      this.deps.nationalStops(),
      this.sharedNetwork,
      new Set(form.localProviders),
      signal,
    );
  }

  /** Whether a form can be searched at all (same checks as Find, without reporting errors). */
  static plannable(form: PlanForm) {
    return supported(form.origin.position) && supported(form.destination.position) && distanceMeters(form.origin.position, form.destination.position) >= 25;
  }

  cancelWarmup() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.warm?.controller.abort();
    this.warm = null;
  }

  /** warmOnlinePlan: after any change to the completed form, debounce 250 ms and run the whole search. */
  prefetch(form: PlanForm) {
    this.cancelWarmup();
    if (!PlannerSession.plannable(form)) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const requested = this.deps.clock();
      const ready = form.departure ?? requested;
      if (ready < requested) return;
      const controller = new AbortController();
      const result = this.run(form, requested, ready, controller.signal);
      // A failed prefetch is not an error: Find searches again.
      result.catch(() => undefined);
      this.warm = { form, startedAt: requested, ready, result, controller };
    }, WARM_DELAY_MILLIS);
  }

  /**
   * joinWarmPlan: the prefetched answer when every journey in it can still be caught at [ready] and it is
   * complete; null means search again. A later departure time can only remove journeys, never add better ones.
   */
  private async join(warm: WarmPlan, requested: number, ready: number, signal: AbortSignal): Promise<TripPlan | null> {
    // Wall-clock age, not departure-time distance: a fixed departure's live delays still go stale.
    const age = Math.floor((requested - warm.startedAt) / 1000);
    if (age < 0 || age > WARM_PLAN_MAX_AGE_SECONDS || ready < warm.ready) return null;
    let plan: TripPlan;
    try {
      plan = await new Promise<TripPlan>((resolve, reject) => {
        const stop = () => reject(aborted());
        if (signal.aborted) return stop();
        signal.addEventListener("abort", stop, { once: true });
        warm.result.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
      });
    } catch (error) {
      if (signal.aborted) throw aborted();
      void error;
      return null;
    }
    if (plan.partial || !plan.itineraries.length || plan.itineraries.some((trip) => !feasible(trip.legs, ready))) return null;
    return { ...plan, requestedAt: requested, readyAt: ready };
  }

  /** PlannerViewModel.plan: join a matching prefetch, else search fresh. [force] (refresh) always searches fresh. */
  async plan(form: PlanForm, force: boolean, signal: AbortSignal): Promise<TripPlan> {
    // A prefetch for exactly this form keeps running and is joined below; anything else is dropped.
    const warm = !force && this.warm && sameSearch(this.warm.form, form) ? this.warm : null;
    if (!warm) this.cancelWarmup();
    if (force) this.deps.backend.clearRouteCache();
    const requested = this.deps.clock();
    const ready = form.departure ?? requested;
    const result = (warm ? await this.join(warm, requested, ready, signal) : null) ?? (await this.run(form, requested, ready, signal));
    return { ...result, itineraries: timelyChoices(result.itineraries, ready) };
  }
}

let shared: PlannerSession | null = null;
/** The app's planner: BKK first, EMMA nationally, routed walks kept in IndexedDB, local timetables when verified. */
export function plannerSession() {
  if (!shared) {
    const backend = persistentWalking(new BkkFirstPlannerBackend(new EmmaPlannerBackend()), new WalkingLinkStore(indexedDbStorage()));
    shared = new PlannerSession({
      backend,
      planner: new HybridTripPlanner(backend),
      loadNetwork: (signal) => localNetwork(signal),
      nationalStops: () => knownStops(),
      clock: Date.now,
    });
  }
  return shared;
}
