# Android transit artwork

Source: sibling `bmenetrend/app/src/main/res/drawable-nodpi`, inspected 2026-11-15 (Android HEAD `8192cf1d5c2790a820f42f53bcd9462fbf541345`). Original artwork is reused, not redrawn with generic web icons.

- `ui_metro_*` / `ui_hev_*`: full native line emblems, resized for browser display. H8/H9 use the same two-panel composition as `ui/TransitLineLogo.kt`.
- `metro_*` / `hev_*`: numeric panels extracted with `map/NumberCircleRenderer.kt`'s source rectangle, rendered at 108px (36dp at 3×).
- `vehicle_*`: 108px marker PNGs matching `map/VehicleMapScene.kt` (white disc, source artwork in the 3..105 rectangle). `_ui` variants are the unframed 84px artwork for 28dp UI icons.
- `station_*`: baseline 3× station ring PNGs generated from `map/StationSprite.kt`, with operator/mode colours from `StopMarkerLayout.kt`. The browser renderer rasterizes and caches the same rings for selected, multicolour and accent-dependent variants.

Do not replace these with a new badge design. The Open Sans font and licence are in `/fonts/`. Runtime colour/dimension rules are in `src/lib/transit/badges.ts` and `src/components/app/line-badge.tsx`.
