# Local MÁV adapter

The official MÁV GraphQL endpoint answers this machine but does not send `Access-Control-Allow-Origin` for the web app. The existing Cloudflare Worker also reports MÁV fallback unavailable. This adapter is the user-approved **local development** solution: the frontend stays a static client, the BKK Worker stays primary, and the adapter supplies readable MÁV responses.

## Run

```sh
bun run dev
```

This starts the adapter at `http://localhost:8788/graphql` and Next development at `http://localhost:3000`, with the public adapter URL supplied automatically. If the preferred adapter port is occupied, the launcher reuses a compatible adapter from this workspace with matching queries and allowed origins, or chooses a free port while leaving the existing service untouched. The frontend always receives the selected URL. `EMMA_RELAY_PORT` changes the preferred port.

The adapter runs inside the launcher, so it cannot remain as an orphaned child. Interrupting the launcher or exiting Next stops its owned adapter; a reused adapter is left running. `--port 3001` changes the frontend port and the adapter's allowed origins together.

To run the adapter separately:

```sh
bun run emma:relay
```

Use `bun run dev:frontend` with `NEXT_PUBLIC_EMMA_GRAPHQL_URL=http://localhost:8788/graphql` if starting the processes separately.

The server binds to **127.0.0.1**, and allows localhost / 127.0.0.1 frontend origins on the chosen development port. It is intended for the browser on this machine; LAN devices cannot use this loopback service. `/health` only checks that the adapter process is running, not the upstream MÁV service.

## Contract and limits

`POST /graphql` accepts only `{query, variables}`, with exact query strings shared in `src/lib/transit/emma-contract.ts`: bounded railway-area vehicles/stops, stop search, a MÁV platform board, an exact MÁV trip, and Android's national trip plan (`TripPlanner.query`, normal and walk-averse; coordinate endpoints inside Hungary and a date within two months only). It rejects arbitrary GraphQL/introspection, IDs other than MÁV (`1:`) and Volán (`hkir:`; boards and trips only, because the BKK Worker knows rural Volán stops without their timetables), unexpected variables, arbitrary URLs, oversized areas and bodies. All upstream requests target the one fixed official MÁV endpoint; redirects are rejected.

Only public MÁV data is cached: endpoint TTLs, at most 60 entries / two million characters. Concurrent identical requests share one upstream call. Limits: six upstream requests in flight (beyond that a 1-second `Retry-After`), 60 new requests/minute process-wide (10-second `Retry-After`), six-second upstream timeout (20 seconds for the national planner, which routinely needs 8–10 s), 16KiB request and 2MB response caps. Failure envelopes are not cached as successful data. No API key is needed, and no BKK secrets are handled.

## Production

This server is **not** bundled into `out/` and is not a Next API route. The static site can use a separately hosted, approved adapter by building with `NEXT_PUBLIC_EMMA_GRAPHQL_URL=https://your-adapter.example/graphql`. Configuring a URL does not deploy or prove upstream access. Keep the local loopback binding for development; public deployment needs a deliberate host, HTTPS, allowed origins and appropriate public-service limits. Never deploy the static site with a localhost adapter URL.

Direct browser requests without an adapter still depend on MÁV enabling CORS. `mode: no-cors` cannot make the response readable. Hiding availability warnings cannot restore the missing data.
