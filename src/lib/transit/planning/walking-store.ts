import type { GeoPoint } from "~/lib/places";
import { walkKey, type PlannerBackend, type WalkingLink, type WalkingResult, type WalkPair } from "./backend";

/**
 * Port of data/PersistentWalkingBackend.kt. Keeps routed street walks across searches and visits in
 * IndexedDB: transfers between the fixed stops of the local networks are the same walks every time.
 * Only walks the services actually routed are stored, so a cached link is exactly what a fresh request
 * returned; journeys are never cached. Entries expire so changed streets are routed again.
 */
export const MAX_ENTRIES = 4_096;
export const MAX_AGE_DAYS = 60;

export type StoredWalk = { key: string; seconds: number; meters: number; savedOn: string };

/** Six decimals (~0.1 m): the same stop always maps to the same entry. */
const rounded = (p: GeoPoint) => ({ lat: Math.round(p.lat * 1e6) / 1e6, lon: Math.round(p.lon * 1e6) / 1e6 });
export const storeKey = (a: GeoPoint, b: GeoPoint) =>
  [rounded(a).lat, rounded(a).lon, rounded(b).lat, rounded(b).lon].map((value) => value.toFixed(6)).join("\t");

/** Budapest calendar day (LocalDate.now()). */
export const budapestDay = (at = Date.now()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
const minusDays = (day: string, days: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! - days)).toISOString().slice(0, 10);
};

/** Storage behind [WalkingLinkStore]; IndexedDB in the browser, a map in tests. */
export interface WalkStorage {
  getAll(): Promise<StoredWalk[]>;
  putAll(walks: StoredWalk[], remove: string[]): Promise<void>;
}

export function indexedDbStorage(name = "bmenetrend-planner", store = "walks"): WalkStorage | null {
  if (typeof indexedDB === "undefined") return null;
  let database: Promise<IDBDatabase> | null = null;
  const open = () =>
    (database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store, { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB"));
      request.onblocked = () => reject(new Error("IndexedDB blocked"));
    }).catch((error: unknown) => {
      database = null;
      throw error;
    }));
  return {
    async getAll() {
      const db = await open();
      return new Promise((resolve, reject) => {
        const request = db.transaction(store, "readonly").objectStore(store).getAll();
        request.onsuccess = () => resolve(request.result as StoredWalk[]);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB"));
      });
    },
    async putAll(walks, remove) {
      const db = await open();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(store, "readwrite");
        const objects = transaction.objectStore(store);
        remove.forEach((key) => objects.delete(key));
        walks.forEach((walk) => objects.put(walk));
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB"));
        transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB"));
      });
    },
  };
}

/** A small, bounded store of routed walks (WalkingLinkStore). Failures only mean routing again. */
export class WalkingLinkStore {
  /** Access order: the walks searches keep using survive the size cap. */
  private walks: Map<string, StoredWalk> | null = null;
  private loading: Promise<Map<string, StoredWalk>> | null = null;
  constructor(
    private storage: WalkStorage | null,
    private today: () => string = budapestDay,
  ) {}

  private loaded() {
    if (this.walks) return Promise.resolve(this.walks);
    return (this.loading ??= (async () => {
      const map = new Map<string, StoredWalk>();
      try {
        for (const walk of (await this.storage?.getAll()) ?? [])
          if (typeof walk.key === "string" && walk.seconds >= 0 && walk.meters >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(walk.savedOn))
            map.set(walk.key, walk);
      } catch {
        /* Private mode or blocked storage: start empty. */
      }
      this.walks = map;
      return map;
    })());
  }

  async find(pairs: [GeoPoint, GeoPoint][]) {
    const loaded = await this.loaded();
    const oldest = minusDays(this.today(), MAX_AGE_DAYS);
    const found = new Map<string, StoredWalk>();
    for (const [a, b] of pairs) {
      const key = storeKey(a, b);
      const walk = loaded.get(key);
      if (!walk || walk.savedOn < oldest) continue;
      loaded.delete(key);
      loaded.set(key, walk);
      found.set(walkKey(a, b), walk);
    }
    return found;
  }

  async save(links: Iterable<WalkingLink>) {
    const list = [...links];
    if (!list.length) return;
    const loaded = await this.loaded();
    const day = this.today();
    const saved: StoredWalk[] = [];
    for (const link of list) {
      const key = storeKey(link.from.position, link.to.position);
      const walk = { key, seconds: link.seconds, meters: Math.round(link.meters * 10) / 10, savedOn: day };
      loaded.delete(key);
      loaded.set(key, walk);
      saved.push(walk);
    }
    const removed: string[] = [];
    while (loaded.size > MAX_ENTRIES) {
      const oldest = loaded.keys().next().value!;
      loaded.delete(oldest);
      removed.push(oldest);
    }
    try {
      await this.storage?.putAll(saved, removed);
    } catch {
      /* Storage failure must not throw away a valid routing answer. */
    }
  }
}

/** PersistentWalkingBackend: only the missing walks are routed; routed walks are kept. */
export function persistentWalking(delegate: PlannerBackend, store: WalkingLinkStore): PlannerBackend {
  return {
    routes: (...args) => delegate.routes(...args),
    plainRoutes: (...args) => delegate.plainRoutes(...args),
    walkAverseRoutes: (...args) => delegate.walkAverseRoutes(...args),
    stops: (...args) => delegate.stops(...args),
    clearRouteCache: () => delegate.clearRouteCache(),
    async walking(pairs: WalkPair[], ready: number, signal: AbortSignal): Promise<WalkingResult> {
      const known = await store.find(pairs.map(([a, b]) => [a.position, b.position]));
      const missing = pairs.filter(([a, b]) => !known.has(walkKey(a.position, b.position)));
      const fetched = missing.length ? await delegate.walking(missing, ready, signal) : { links: new Map<string, WalkingLink>(), partial: false };
      await store.save(fetched.links.values());
      const links = new Map<string, WalkingLink>();
      for (const [a, b] of pairs) {
        const key = walkKey(a.position, b.position);
        const fresh = fetched.links.get(key);
        const saved = known.get(key);
        if (fresh) links.set(key, fresh);
        else if (saved) links.set(key, { from: a, to: b, seconds: saved.seconds, meters: saved.meters });
      }
      return { links, partial: fetched.partial };
    },
  };
}
