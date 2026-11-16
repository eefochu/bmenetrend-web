import { createEmmaRelay, RELAY_IDENTITY } from "./server";

export async function startLocalRelay({
  preferredPort,
  origins,
}: {
  preferredPort: number;
  origins: string[];
}) {
  if (
    !Number.isInteger(preferredPort) ||
    preferredPort < 1 ||
    preferredPort > 65535
  )
    throw new Error("EMMA_RELAY_PORT must be a port between 1 and 65535.");

  const serve = (port: number) =>
    Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch: createEmmaRelay({ origins }),
    });
  let server;
  try {
    server = serve(preferredPort);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "EADDRINUSE"
    )
      throw error;
    // Never stop an existing service. Reuse only this workspace's exact contract
    // with all requested frontend origins allowed.
    try {
      const response = await fetch(`http://127.0.0.1:${preferredPort}/health`, {
        signal: AbortSignal.timeout(500),
      });
      const health = (await response.json()) as Record<string, unknown>;
      const allowedOrigins = health.origins;
      if (
        response.ok &&
        health.status === "ok" &&
        Object.entries(RELAY_IDENTITY).every(
          ([key, value]) => health[key] === value,
        ) &&
        Array.isArray(allowedOrigins) &&
        origins.every((origin) => allowedOrigins.includes(origin))
      ) {
        return {
          url: `http://localhost:${preferredPort}/graphql`,
          reused: true,
          stop() {
            // The existing adapter belongs to another launcher.
          },
        };
      }
    } catch {
      // An unrelated or unresponsive listener is left untouched.
    }
    server = serve(0);
  }
  const owned = server;
  return {
    url: `http://localhost:${owned.port}/graphql`,
    reused: false,
    stop() {
      void owned.stop(true);
    },
  };
}
