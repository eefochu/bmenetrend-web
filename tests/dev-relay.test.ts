import { expect, test } from "bun:test";
import { createEmmaRelay } from "../tools/emma-relay/server";
import { startLocalRelay } from "../tools/emma-relay/start";

const origins = ["http://localhost:3000", "http://127.0.0.1:3000"];

test("occupied port with this workspace's compatible adapter is reused", async () => {
  const existing = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: createEmmaRelay({ origins }),
  });
  try {
    const relay = await startLocalRelay({
      preferredPort: existing.port!,
      origins,
    });
    try {
      expect(relay.reused).toBe(true);
      expect(new URL(relay.url).port).toBe(String(existing.port));
    } finally {
      relay.stop();
    }
    expect((await fetch(`http://127.0.0.1:${existing.port}/health`)).ok).toBe(
      true,
    );
  } finally {
    await existing.stop(true);
  }
});

test("an unrelated service on the preferred port is preserved and a free port is used", async () => {
  const existing = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("unrelated service"),
  });
  try {
    const relay = await startLocalRelay({
      preferredPort: existing.port!,
      origins,
    });
    try {
      expect(relay.reused).toBe(false);
      expect(new URL(relay.url).port).not.toBe(String(existing.port));
      expect(
        await (await fetch(`http://127.0.0.1:${existing.port}/`)).text(),
      ).toBe("unrelated service");
      const health = await fetch(relay.url.replace("/graphql", "/health"));
      expect(health.ok).toBe(true);
    } finally {
      relay.stop();
    }
  } finally {
    await existing.stop(true);
  }
});

test("an adapter that does not allow the requested frontend origin is not reused", async () => {
  const existing = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: createEmmaRelay({ origins: ["http://localhost:9999"] }),
  });
  try {
    const relay = await startLocalRelay({
      preferredPort: existing.port!,
      origins,
    });
    try {
      expect(relay.reused).toBe(false);
      expect(new URL(relay.url).port).not.toBe(String(existing.port));
    } finally {
      relay.stop();
    }
  } finally {
    await existing.stop(true);
  }
});
