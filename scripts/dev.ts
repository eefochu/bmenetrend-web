import { startLocalRelay } from "../tools/emma-relay/start";

// Development-only network adapter. Production remains a static frontend export.
const frontendArgs = process.argv.slice(2).filter((arg) => arg !== "--");
const portIndex = frontendArgs.findIndex(
  (arg) => arg === "--port" || arg === "-p",
);
const inlinePort = frontendArgs
  .find((arg) => arg.startsWith("--port="))
  ?.slice(7);
const port =
  inlinePort ??
  (portIndex >= 0
    ? (frontendArgs[portIndex + 1] ?? "3000")
    : (process.env.PORT ?? "3000"));
const endpoint = process.env.NEXT_PUBLIC_EMMA_GRAPHQL_URL?.trim();
const configured =
  endpoint !== undefined && endpoint.length > 0 ? endpoint : undefined;
const relay = configured
  ? undefined
  : await startLocalRelay({
      preferredPort: Number(process.env.EMMA_RELAY_PORT ?? "8788"),
      origins: [`http://localhost:${port}`, `http://127.0.0.1:${port}`],
    });
if (relay)
  console.log(
    `Local MÁV adapter${relay.reused ? " (reusing existing)" : ""}: ${relay.url}`,
  );
const nextArgs =
  portIndex >= 0 || inlinePort
    ? frontendArgs
    : [...frontendArgs, "--port", port];
try {
  const frontend = Bun.spawn(
    ["bunx", "--no-install", "next", "dev", "--turbo", ...nextArgs],
    {
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
      env: {
        ...process.env,
        NEXT_PUBLIC_EMMA_GRAPHQL_URL: configured ?? relay!.url,
      },
    },
  );
  const stop = () => {
    frontend.kill();
    relay?.stop();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.exitCode = await frontend.exited;
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
} finally {
  relay?.stop();
}
