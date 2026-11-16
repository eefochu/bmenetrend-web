import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "./model";
import { message, TransitError } from "./client";

export function useRemote<T>(
  key: string,
  loader: (signal: AbortSignal) => Promise<Snapshot<T>>,
  options: {
    active?: boolean;
    interval?: number;
    debounce?: number;
    once?: boolean;
    /**
     * Keep showing the previous key's data until the new key loads (map areas: panning must not blank
     * the stop and vehicle markers while the next area is requested).
     */
    keepPrevious?: boolean;
  } = {},
) {
  const { active = true, interval = 0, debounce = 0, once = false, keepPrevious = false } = options;
  const completed = useRef("");
  const load = useRef(loader);
  load.current = loader;
  const [state, setState] = useState<{
    key: string;
    data?: Snapshot<T>;
    loading: boolean;
    error: string;
  }>({ key, loading: Boolean(key && active), error: "" });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!key || !active) return;
    let disposed = false,
      timer: ReturnType<typeof setTimeout>,
      controller: AbortController | undefined,
      retryAt = 0;
    const run = async () => {
      clearTimeout(timer);
      if (once && completed.current === `${key}:${revision}`) return;
      if (disposed || document.hidden) return;
      if (!navigator.onLine) {
        setState((current) => ({
          key,
          data: current.key === key ? current.data : undefined,
          loading: false,
          error:
            "Nincs internetkapcsolat. A mentett megállóadatok továbbra is elérhetők.",
        }));
        return;
      }
      if (retryAt > Date.now()) {
        timer = setTimeout(() => void run(), retryAt - Date.now());
        return;
      }
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      setState((current) => ({
        key,
        data: current.key === key || keepPrevious ? current.data : undefined,
        loading: true,
        error: current.key === key ? current.error : "",
      }));
      try {
        const data = await load.current(signal);
        if (!signal.aborted && !disposed) {
          completed.current = `${key}:${revision}`;
          setState({ key, data, loading: false, error: "" });
        }
      } catch (error) {
        if (signal.aborted || disposed) return;
        if (error instanceof TransitError) retryAt = error.retryAt;
        setState((current) => ({
          key,
          data: current.key === key || keepPrevious ? current.data : undefined,
          loading: false,
          error: message(error),
        }));
      }
      if (!disposed && !signal.aborted && interval)
        timer = setTimeout(
          () => void run(),
          Math.max(interval, retryAt - Date.now()),
        );
    };
    const resume = () => {
      clearTimeout(timer);
      if (document.hidden || !navigator.onLine) {
        controller?.abort();
        setState((current) => ({ ...current, loading: false }));
        return;
      }
      void run();
    };
    const first = () => {
      timer = setTimeout(() => void run(), debounce);
    };
    first();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    window.addEventListener("offline", resume);
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", resume);
    };
  }, [key, active, interval, debounce, revision, once, keepPrevious]);
  return {
    data: state.key === key || keepPrevious ? state.data : undefined,
    loading: Boolean(key && active && (state.key !== key || state.loading)),
    error: state.key === key ? state.error : "",
    retry: () => setRevision((value) => value + 1),
  };
}
export function useClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, 15_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
