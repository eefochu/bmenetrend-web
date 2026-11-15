import { useCallback, useEffect, useRef, useState } from "react";

import type { GeoPoint } from "~/lib/places";

export type LocationStatus = "off" | "locating" | "on" | "denied" | "unavailable";

export type UserLocation = {
  position: GeoPoint | null;
  accuracy: number | null;
  status: LocationStatus;
  /** Opt-in from a control, like Android's permission request from the location button. */
  request: () => void;
};

/**
 * Location stays off until the person asks for it. A permission granted on an earlier visit counts as
 * that opt-in, as Android keeps tracking once the permission exists.
 */
export function useUserLocation(): UserLocation {
  const [position, setPosition] = useState<GeoPoint | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [status, setStatus] = useState<LocationStatus>("off");
  const watch = useRef<number | null>(null);

  const start = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setStatus("unavailable");
      return;
    }
    if (watch.current != null) return;
    setStatus((current) => (current === "on" ? current : "locating"));
    watch.current = navigator.geolocation.watchPosition(
      (fix) => {
        setPosition({ lat: fix.coords.latitude, lon: fix.coords.longitude });
        setAccuracy(fix.coords.accuracy);
        setStatus("on");
      },
      (error) => {
        if (watch.current != null) navigator.geolocation.clearWatch(watch.current);
        watch.current = null;
        setStatus(error.code === error.PERMISSION_DENIED ? "denied" : "unavailable");
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    void navigator.permissions
      ?.query({ name: "geolocation" })
      .then((permission) => {
        if (!cancelled && permission.state === "granted") start();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (watch.current != null) navigator.geolocation.clearWatch(watch.current);
      watch.current = null;
    };
  }, [start]);

  return { position, accuracy, status, request: start };
}
