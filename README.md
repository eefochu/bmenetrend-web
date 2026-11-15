# bmenetrend-web

T3 Stack project scaffolded with `bun create t3-app@latest`: Next.js (Pages Router), React, TypeScript, Tailwind CSS, tRPC, Prisma with SQLite, and NextAuth.

## Web app parity

This is the web version of the sibling `../bmenetrend` Android app. See [AGENTS.md](AGENTS.md) for source locations, backend contracts and scope. `CLAUDE.md` symlinks to the same instructions.

The root page is an interactive, full-screen MapLibre GL JS map. It matches Android's OpenFreeMap Positron (light) and bundled Night (dark) styles, system-theme switching, initial camera `[18.825, 47.473]` / zoom `13.2`, and blue fallback theme. Pan, zoom, compass and opt-in location work; transit overlays and search are future work.

Map resources load directly from OpenFreeMap without a key. Map credits and style licences are available from the attribution control. The Night style is copied unchanged from Android; preserve its provenance and licences when updating it. The matching MapLibre worker is prepared automatically before dev/build and served locally, with a versioned URL to prevent stale workers.

## Development

```sh
bun install
# On a fresh clone, copy .env.example to .env and generate AUTH_SECRET:
# bunx auth secret
bun run db:push
bun run dev
```

Open http://localhost:3000. This workspace already has a local `.env`, a generated auth secret, and an initialized SQLite database. Local secrets and database files are ignored by Git.

Discord sign-in becomes available once `AUTH_DISCORD_ID` and `AUTH_DISCORD_SECRET` are configured in `.env`. The app runs without these credentials; sign-in requires a configured provider. For Discord development, use `http://localhost:3000/api/auth/callback/discord` as the redirect URI.

```sh
bun run check
bun run build
```

## Material UI direction

Use Material You / Material 3 Expressive as the direction for future UI work. `@material/web` is installed from the [Material Web documentation](https://github.com/material-components/material-web/tree/main/docs). It provides Material 3 web components; it does not provide a complete Material 3 Expressive component library. No Expressive styling or component showcase is needed yet.

Typed React wrappers are available from `~/components/material`: `FilledButton`, `OutlinedButton`, `Checkbox`, `Switch`, and `OutlinedTextField`. They use `@lit/react` for property and event handling, and Next.js dynamic imports with `ssr: false` to register web components only in the browser. The map error state uses `OutlinedButton` for retry. Shared light/dark Material tokens live in `src/styles/globals.css`.

```tsx
import { FilledButton, OutlinedTextField } from "~/components/material";

<OutlinedTextField
  label="Search"
  onInput={(event) => console.log(event.target)}
/>;
<FilledButton type="button" onClick={() => console.log("clicked")}>
  Search
</FilledButton>;
```

Import through the entry point above; the individual implementation files load browser APIs. Add more wrappers as needed instead of importing the full component library.

Material Web is currently in maintenance mode; see its [README](https://github.com/material-components/material-web#readme). Keep this in mind when selecting future Expressive components.
