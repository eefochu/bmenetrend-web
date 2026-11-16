import { expect, test, mock } from "bun:test";
import { createEmmaRelay, validateOperation } from "../tools/emma-relay/server";
import {
  EMMA_QUERIES,
  OFFICIAL_EMMA_URL,
} from "../src/lib/transit/emma-contract";

const origin = "http://localhost:3000";
const variables = { south: 47.45, west: 18.8, north: 47.5, east: 18.87 };
const request = (
  query: string = EMMA_QUERIES.vehicles,
  vars: object = variables,
  from = origin,
) =>
  new Request("http://localhost:8788/graphql", {
    method: "POST",
    headers: { Origin: from, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: vars }),
  });
const mockedFetch = (
  handler: (
    url: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>,
) => mock(handler) as unknown as typeof fetch;

test("adapter supplies actual browser CORS headers and fixed official upstream", async () => {
  const upstream = mockedFetch(async (url, init) => {
    expect(url).toBe(OFFICIAL_EMMA_URL);
    expect(init?.redirect).toBe("error");
    return Response.json({
      data: { vehiclePositions: [{ vehicleId: "1:real-feed" }] },
    });
  });
  const handler = createEmmaRelay({
    origins: [origin],
    upstreamFetch: upstream,
  });
  const preflight = await handler(
    new Request("http://localhost:8788/graphql", {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    }),
  );
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(origin);
  const response = await handler(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({
    data: { vehiclePositions: [{ vehicleId: "1:real-feed" }] },
  });
});
test("unapproved origins, arbitrary GraphQL and oversized areas never reach upstream", async () => {
  const upstream = mockedFetch(async () => Response.json({ data: {} })),
    handler = createEmmaRelay({ origins: [origin], upstreamFetch: upstream });
  expect(
    (
      await handler(
        request(EMMA_QUERIES.vehicles, variables, "https://unapproved.example"),
      )
    ).status,
  ).toBe(403);
  expect((await handler(request("{ __schema { types {name} } }"))).status).toBe(
    400,
  );
  expect(
    (
      await handler(
        request(EMMA_QUERIES.vehicles, {
          south: 46,
          west: 16,
          north: 48,
          east: 22,
        }),
      )
    ).status,
  ).toBe(400);
  expect(
    (await handler(request(EMMA_QUERIES.trip, { id: "BKK_F00057" }))).status,
  ).toBe(400);
  expect(
    (await handler(request(EMMA_QUERIES.trip, { id: "BKK:F00057" }))).status,
  ).toBe(400);
  expect(
    (
      await handler(
        request(EMMA_QUERIES.trip, {
          id: "1:trip",
          url: "https://example.com",
        }),
      )
    ).status,
  ).toBe(400);
  expect(upstream).not.toHaveBeenCalled();
});
test("identical adapter requests are coalesced and TTL-cached", async () => {
  let finish!: () => void;
  const upstream = mockedFetch(async () => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return Response.json({ data: { vehiclePositions: [] } });
  });
  const handler = createEmmaRelay({
    origins: [origin],
    upstreamFetch: upstream,
  });
  const one = handler(request()),
    two = handler(request());
  // Request body parsing yields before the single upstream call.
  await new Promise((resolve) => setTimeout(resolve, 5));
  finish();
  expect((await one).status).toBe(200);
  expect((await two).status).toBe(200);
  expect((await handler(request())).status).toBe(200);
  expect(upstream).toHaveBeenCalledTimes(1);
});
test("GraphQL failures are not cached as empty successful snapshots", async () => {
  const upstream = mockedFetch(async () =>
      Response.json({ data: null, errors: [{ message: "backend failure" }] }),
    ),
    handler = createEmmaRelay({ origins: [origin], upstreamFetch: upstream });
  expect((await handler(request())).status).toBe(502);
  expect((await handler(request())).status).toBe(502);
  expect(upstream).toHaveBeenCalledTimes(2);
});
test("relay refuses oversized payloads and stale board requests", async () => {
  const handler = createEmmaRelay({
    origins: [origin],
    upstreamFetch: mockedFetch(async () => Response.json({ data: {} })),
  });
  const big = new Request("http://localhost:8788/graphql", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: "x".repeat(20000),
  });
  expect((await handler(big)).status).toBe(400);
  expect(() =>
    validateOperation(EMMA_QUERIES.board, {
      id: "1:station",
      start: 0,
      range: 3600,
    }),
  ).toThrow();
});
test("Volán stop boards and trips pass, other operators' IDs do not", () => {
  const start = Math.floor(Date.now() / 1000);
  expect(() =>
    validateOperation(EMMA_QUERIES.board, { id: "hkir:hkir_669106_2", start, range: 7200 }),
  ).not.toThrow();
  expect(() => validateOperation(EMMA_QUERIES.trip, { id: "hkir:hkir_8464_328-3" })).not.toThrow();
  expect(() => validateOperation(EMMA_QUERIES.trip, { id: "BKK:F00057" })).toThrow();
});
