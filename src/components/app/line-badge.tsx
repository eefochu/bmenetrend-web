import Image from "next/image";
import type { Route } from "~/lib/transit/model";
import { emblem, serviceStyle, transport } from "~/lib/transit/badges";

/** Exact assets, 18%-corner pill, Open Sans bold and native dimensions from LineComponents.kt. */
export function RouteBadge({
  route,
  compact = false,
}: {
  route?: Route;
  compact?: boolean;
}) {
  const logo = emblem(route);
  if (logo)
    return (
      <Image
        unoptimized
        src={logo}
        alt={route?.name ?? "Járat"}
        width={compact ? 52 : 76}
        height={compact ? 28 : 36}
        className="native-line-emblem"
      />
    );
  return (
    <span
      className={`native-line-badge ${compact ? "native-line-compact" : ""}`}
    >
      {!compact && (
        <Image
          unoptimized
          src={`/transit/${transport(route).asset}_ui.png`}
          alt=""
          width={28}
          height={28}
        />
      )}
      <span
        className="native-line-number"
        style={{
          ...serviceStyle(route),
          ...(compact
            ? {
                fontSize: Math.min(
                  17,
                  Math.max(9, 70 / (route?.name.length ?? 1)),
                ),
              }
            : {}),
        }}
      >
        {route?.name ?? "?"}
      </span>
    </span>
  );
}
