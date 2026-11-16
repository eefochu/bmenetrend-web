import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  OFFICIAL_EMMA_URL,
  EMMA_QUERIES,
  type EmmaOperation,
} from "../../src/lib/transit/emma-contract";

// Identify compatible adapters without exposing the local workspace path.
export const RELAY_IDENTITY = {
  protocol: 1,
  workspace: createHash("sha256")
    .update(realpathSync(fileURLToPath(new URL("../../", import.meta.url))))
    .digest("hex"),
  contract: createHash("sha256")
    .update(JSON.stringify(EMMA_QUERIES))
    .digest("hex"),
};

const TTL: Record<EmmaOperation, number> = {
  stops: 300_000,
  vehicles: 10_000,
  search: 30_000,
  board: 10_000,
  trip: 30_000,
  plan: 15_000,
  planWalkAverse: 15_000,
};
const MAX_BODY = 16_384,
  MAX_REPLY = 2_000_000;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export function validateOperation(
  query: unknown,
  input: unknown,
): { operation: EmmaOperation; variables: Record<string, unknown> } {
  const operation = (Object.keys(EMMA_QUERIES) as EmmaOperation[]).find(
    (name) => EMMA_QUERIES[name] === query,
  );
  if (!operation) throw new Error("Unsupported GraphQL operation");
  const variables = record(input);
  const expected =
    operation === "vehicles" || operation === "stops"
      ? ["east", "north", "south", "west"]
      : operation === "search"
        ? ["name"]
        : operation === "board"
          ? ["id", "range", "start"]
          : operation === "plan" || operation === "planWalkAverse"
            ? ["date", "from", "time", "to"]
            : ["id"];
  if (Object.keys(variables).sort().join(",") !== expected.join(","))
    throw new Error("Invalid variables");
  if (operation === "vehicles" || operation === "stops") {
    const { south, west, north, east } = variables;
    if (
      ![south, west, north, east].every(
        (v) => typeof v === "number" && Number.isFinite(v),
      )
    )
      throw new Error("Invalid bounds");
    const s = south as number,
      w = west as number,
      n = north as number,
      e = east as number;
    if (
      s < 45.5 ||
      n > 48.8 ||
      w < 15.9 ||
      e > 23.1 ||
      n <= s ||
      e <= w ||
      n - s > 0.12 ||
      e - w > 0.2
    )
      throw new Error("Area must be bounded to Hungary");
  }
  if (
    operation === "search" &&
    (typeof variables.name !== "string" ||
      variables.name.trim().length < 2 ||
      variables.name.length > 100)
  )
    throw new Error("Invalid search text");
  if (operation === "plan" || operation === "planWalkAverse") {
    // Coordinates only (no place names), inside Hungary; a local date and time near today.
    for (const field of ["from", "to"] as const) {
      const match =
        typeof variables[field] === "string"
          ? /^(-?\d{1,2}(?:\.\d{1,8})?),(-?\d{1,3}(?:\.\d{1,8})?)$/.exec(variables[field])
          : null;
      const lat = Number(match?.[1]),
        lon = Number(match?.[2]);
      if (!match || lat < 45.5 || lat > 48.8 || lon < 15.9 || lon > 23.1)
        throw new Error("Planner endpoints must be coordinates in Hungary");
    }
    const date = typeof variables.date === "string" ? Date.parse(`${variables.date}T12:00:00Z`) : NaN;
    if (
      typeof variables.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(variables.date) ||
      !Number.isFinite(date) ||
      date < Date.now() - 2 * 86_400_000 ||
      date > Date.now() + 62 * 86_400_000 ||
      typeof variables.time !== "string" ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(variables.time)
    )
      throw new Error("Invalid planner date or time");
  }
  if (operation === "board" || operation === "trip") {
    if (
      typeof variables.id !== "string" ||
      !/^(?:1|hkir):[A-Za-z0-9_.:-]{1,160}$/.test(variables.id)
    )
      // MÁV (`1:`) and Volán (`hkir:`) identities: FUTÁR lacks rural Volán timetables, as on Android.
      throw new Error("Only explicit MÁV or Volán identities are supported");
  }
  if (operation === "board") {
    if (
      typeof variables.start !== "number" ||
      !Number.isInteger(variables.start) ||
      Math.abs(variables.start - Date.now() / 1000) > 3600 ||
      typeof variables.range !== "number" ||
      !Number.isInteger(variables.range) ||
      variables.range < 1 ||
      variables.range > 18_000
    )
      throw new Error("Invalid departure window");
  }
  return { operation, variables };
}

async function boundedText(
  stream: ReadableStream<Uint8Array> | null,
  maximum: number,
) {
  if (!stream) throw new Error("Empty body");
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximum) {
        await reader.cancel();
        throw new Error("Body too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const part of chunks) {
    body.set(part, offset);
    offset += part.length;
  }
  return new TextDecoder().decode(body);
}

export function createEmmaRelay({
  origins,
  upstreamFetch = fetch,
}: {
  origins: string[];
  upstreamFetch?: typeof fetch;
}) {
  const allowed = new Set(origins);
  const cache = new Map<string, { body: string; until: number }>();
  const pending = new Map<
    string,
    Promise<{ body: string; status: number; retry?: string }>
  >();
  let cacheSize = 0,
    times: number[] = [],
    inFlight = 0,
    cooldown = 0;
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url),
      origin = request.headers.get("Origin");
    const headers = new Headers({
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Vary: "Origin",
      "X-Content-Type-Options": "nosniff",
    });
    if (origin && !allowed.has(origin))
      return Response.json(
        { error: "Origin not allowed" },
        { status: 403, headers },
      );
    if (origin) headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");
    headers.set("Access-Control-Expose-Headers", "Retry-After");
    const response = (body: string, status = 200) =>
      new Response(body, { status, headers });
    const error = (text: string, status: number) =>
      response(JSON.stringify({ error: text }), status);
    if (request.method === "GET" && url.pathname === "/health")
      return response(
        JSON.stringify({
          status: "ok",
          service: "Local MÁV adapter",
          ...RELAY_IDENTITY,
          origins: [...allowed],
        }),
      );
    if (url.pathname !== "/graphql") return error("Not found", 404);
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return error("Method not allowed", 405);
    if (!request.headers.get("Content-Type")?.includes("application/json"))
      return error("JSON body required", 415);
    let operation: EmmaOperation, variables: Record<string, unknown>;
    try {
      const input = record(
        JSON.parse(await boundedText(request.body, MAX_BODY)),
      );
      if (
        Object.keys(input).some((key) => key !== "query" && key !== "variables")
      )
        throw new Error("Unsupported request field");
      ({ operation, variables } = validateOperation(
        input.query,
        input.variables,
      ));
    } catch {
      return error("Unsupported or invalid MÁV request", 400);
    }
    const key = JSON.stringify([
      operation,
      Object.entries(variables).sort(([a], [b]) => a.localeCompare(b)),
    ]);
    const cached = cache.get(key);
    if (cached && cached.until > Date.now()) return response(cached.body);
    if (cooldown > Date.now()) {
      headers.set(
        "Retry-After",
        String(Math.ceil((cooldown - Date.now()) / 1000)),
      );
      return error("MÁV retry cooldown", 429);
    }
    let shared = pending.get(key);
    if (!shared) {
      times = times.filter((time) => Date.now() - time < 60_000);
      if (times.length >= 60 || inFlight >= 4) {
        headers.set("Retry-After", "10");
        return error("Local adapter request limit", 429);
      }
      times.push(Date.now());
      inFlight++;
      shared = (async () => {
        const controller = new AbortController(),
          timer = setTimeout(() => controller.abort(), 6000);
        try {
          const upstream = await upstreamFetch(OFFICIAL_EMMA_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({ query: EMMA_QUERIES[operation], variables }),
            signal: controller.signal,
            redirect: "error",
            cache: "no-store",
          });
          if (!upstream.ok) {
            if (upstream.status === 429 || upstream.status === 403)
              cooldown = Date.now() + 60_000;
            return {
              body: JSON.stringify({
                error: `MÁV upstream unavailable (${upstream.status})`,
              }),
              status: 502,
            };
          }
          const body = await boundedText(upstream.body, MAX_REPLY),
            json = record(JSON.parse(body));
          if (!json.data || (Array.isArray(json.errors) && json.errors.length))
            return {
              body: JSON.stringify({ error: "MÁV query failed" }),
              status: 502,
            };
          cacheSize -= cache.get(key)?.body.length ?? 0;
          cacheSize += body.length;
          cache.set(key, { body, until: Date.now() + TTL[operation] });
          while (cacheSize > MAX_REPLY || cache.size > 60) {
            const oldest = cache.keys().next().value!;
            cacheSize -= cache.get(oldest)!.body.length;
            cache.delete(oldest);
          }
          return { body, status: 200 };
        } catch {
          return {
            body: JSON.stringify({
              error: "MÁV connection failed or timed out",
            }),
            status: 502,
          };
        } finally {
          clearTimeout(timer);
          inFlight--;
          pending.delete(key);
        }
      })();
      pending.set(key, shared);
    }
    const result = await shared;
    return response(result.body, result.status);
  };
}

if (import.meta.main) {
  const port = Number(process.env.EMMA_RELAY_PORT ?? 8788);
  const origins = (
    process.env.EMMA_RELAY_ORIGINS ??
    "http://localhost:3000,http://127.0.0.1:3000"
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch: createEmmaRelay({ origins }),
  });
  console.log(`Local MÁV adapter: http://localhost:${server.port}/graphql`);
}
