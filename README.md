# BMenetrend Web

The browser version of the sibling `../bmenetrend` Android transit app. Built with Next.js Pages Router, React, TypeScript, Tailwind, Material Web and MapLibre. Originally scaffolded with Create T3 App; the unused auth, database and tRPC backend have been removed.

## Client-first architecture

The frontend exports to static HTML/CSS/JS in `out/`. Navigation, preferences, maps, location and data requests run in the browser. No Next.js runtime server, local database or authentication secrets are required. A small loopback-only MÁV adapter is used in local development because the official API does not allow browser CORS access.

The existing Cloudflare Worker at `https://bmenetrend-bkk-proxy.bmenetrend-backend.workers.dev` is the transit backend, shared with Android. Typed transit clients call it directly from the browser; BKK API keys remain in Worker secrets. Photon place search and OpenFreeMap resources already load directly from their providers. Stops, vehicles, departures, line/trip details, search, local favourites and journey planning are wired. Check CORS and source limitations before adding another data source.

See [AGENTS.md](AGENTS.md) for architecture rules, Android reference files, backend contracts and the current feature scope. `CLAUDE.md` is a relative symlink to those same instructions.

## Development and deployment

```sh
bun install
bun run dev
```

Open http://localhost:3000. `bun run dev` automatically starts the local MÁV adapter on port 8788 and points the frontend at it. If that port is occupied, it reuses a compatible adapter or selects a free port automatically. No `.env` setup is necessary. Preferences persist locally in the browser.

```sh
bun run test
bun run check
bun run build
bun run start
# Or build and serve together:
bun run preview
```

Deploy the contents of `out/` to static hosting, independently of the existing Cloudflare backend. `start` serves those files on port 3000; it does not run a Next.js application server. Next.js remains the development server and static build tool.

## UI and maps

The responsive Android UI shell includes navigation, map, search, planner, favourites, settings and about screens. Local operator timetable integration and offline timetable packs remain unported; these limitations are disclosed. The app uses Hungarian labels, Material You / Material 3 Expressive styling and the Android fallback palette.

The map uses MapLibre GL JS with OpenFreeMap Liberty recoloured through `scripts/build-google-styles.mjs`. Light and dark street styles follow the app's theme; satellite is intentionally unavailable. The original Android Night style is retained as a reference. Preserve visible map attribution and the bundled licences.

The **MapLibre browser rendering worker** is separate from the Cloudflare transit backend. It is prepared automatically before dev/build and served as a versioned static asset. MapLibre, the app shell and typed Material Web wrappers load through browser-only dynamic imports. UI state belongs in `src/components/app/` and `src/lib/`; shared visual primitives live in `src/components/ui/` and `src/components/material/`.

## Live data and local state

Map traffic is bounded to a grid-snapped area, shared/cached by endpoint and paused when the tab or screen is inactive. Old vehicle observations expire; source times and scheduled/live/cancelled departure states remain distinct. Favourites and static stop metadata persist in this browser without an account. Real-time predictions are not saved as offline data.

The official MÁV/EMMA API supplies railway supplementation and board/trip fallback. It currently omits browser CORS headers, while the Cloudflare path reports unavailable. For local development, the user-approved adapter in `tools/emma-relay/` reaches the official API from this machine and provides origin-scoped CORS responses. It permits only five fixed, bounded MÁV queries, with coalescing, short caches, response/concurrency/request limits and no arbitrary target URL. The BKK Worker remains the primary transit backend.

Local development is ready through `bun run dev`. A deployed static site still needs a separately deployed adapter on an upstream-accepted host, configured at build time with `NEXT_PUBLIC_EMMA_GRAPHQL_URL=https://your-host/graphql`; the local adapter is not deployed automatically. `bun run dev:frontend` runs only Next if you want to use an existing configured adapter. See [adapter setup](tools/emma-relay/README.md).

Transit badges reuse Android's actual PNG artwork and Open Sans bold font. Station dots omit name labels and follow Android's sprite sizing, zoom gates and stable offsets. The tests cover parsing, coupled-vehicle deduplication, response sharing/cancellation, cooldowns, hook visibility, native badge colours, station layout and MapLibre layer validation. Browser WebGL appearance still needs manual visual verification.
