import type { Departure, Vehicle } from "./model";

/**
 * Port of ui/DepartureNavigation.kt `departureVehicle`: the loaded vehicle running a departure.
 * Never identify a departure by line number alone: two buses can share a line and stop.
 */
export function departureVehicle(
  departure: Departure,
  vehicles: readonly Vehicle[],
): Vehicle | null {
  if (departure.cancelled) return null;
  const id = (value: string) => value.replace(/^emma:/, "");
  const byId = departure.vehicleId
    ? vehicles.find((vehicle) => id(vehicle.id) === id(departure.vehicleId!))
    : undefined;
  if (byId) return byId;
  // A BKK board names BKK's trip; a Volán bus merged with its EMMA record keeps EMMA's trip as
  // tripId and BKK's as bkkTripId.
  return departure.tripId
    ? (vehicles.find(
        (vehicle) =>
          vehicle.tripId === departure.tripId ||
          vehicle.bkkTripId === departure.tripId,
      ) ?? null)
    : null;
}
