# CLAUDE.md

Guidance for future Claude Code sessions working in this repository.

## What this is

A static, client-side web application that presents an interactive map of historical places in Carrigtwohill Parish, Co. Cork. Content is authored as JSON by the local historian (Aidan); no CMS, no backend, no build step. The site deploys to GitHub Pages.

## Architecture at a glance

```
index.html   ──▶  js/map.js      ─┐
                                  ├──▶  js/data-loader.js ──▶  data/places.json
place.html   ──▶  js/place.js    ─┘
```

- **Two pages.** `index.html` is the map; `place.html` is the detail view, which reads `?id=<place-id>` from the query string and renders that one place from the shared JSON.
- **Shared loader.** `js/data-loader.js` fetches `data/places.json` once per page load and exposes a tiny global `PlacesData` object (`load()`, `findById()`, `placeUrl()`).
- **No framework.** Plain DOM APIs throughout. If adding interactivity grows beyond what a few hundred lines can comfortably hold, reach for a tiny view layer (e.g. Preact via ESM) before pulling in a full framework.
- **No bundler.** Scripts are loaded directly via `<script>` tags. Keep it that way so non-developers can edit `places.json` and see the result with no build step.

## Data model (`data/places.json`)

Top-level shape:

```json
{ "places": [ ...place objects... ] }
```

A place object's contract (see `EDITING_GUIDE.md` for the author-facing version):

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | **Required.** Unique, URL-safe. Used as the `?id=` parameter and as the key for `relatedPlaces`. |
| `name` | string | **Required.** Display name. |
| `location` | `{lat:number, lng:number}` | **Required** to appear on the map. |
| `pinType` | string | Key into `PIN_ICONS` in `js/map.js`. Currently only `fort`; default falls back to `fort`. |
| `category`, `type` | string | Shown in the metadata strip on the detail page. |
| `dates` | `{range?:string, from?:string, to?:string}` | `range` takes precedence if both present. |
| `preview` | string | Modal blurb. |
| `lead` | string | Optional italic intro paragraph on the detail page, above the first section. |
| `images` | array of image objects | First image is the modal hero and the detail-page hero. |
| `sections` | array of section objects | Flexible body; see below. |
| `relatedPlaces` | array of place `id`s | Rendered as links at the bottom of the detail page. |
| `sources` | array of strings or source objects | Rendered in a bordered "Sources" box. |

### Image object

```
{ src, alt?, caption?, attribution?, width?, height? }
```

### Section object

```
{
  title?: string,
  blocks?: Block[],
  subsections?: { title?: string, blocks?: Block[] }[]
}
```

### Block types (handled in `js/place.js → renderBlock`)

- `paragraph` — `{ type, text }` — rendered with CSS `white-space: pre-wrap` so the historian's line breaks survive.
- `heading` — `{ type, level, text }` — `level` clamps to 2–4 (default 3).
- `quote` — `{ type, text }` — rendered as `<blockquote>`.
- `list` — `{ type, ordered?, items: string[] }`.
- `image` — `{ type, image: <image object> }`.

**If you add a new block type:** extend the `switch` in `renderBlock`, add any supporting CSS to `css/place.css`, and document it in `EDITING_GUIDE.md`. Never branch on block type in the data loader — keep rendering logic inside `place.js`.

## Text fidelity (important)

The historian's prose must be rendered **exactly as written**. Do not add helpers that trim, re-case, auto-link, or collapse whitespace in paragraph text. The `white-space: pre-wrap` rule on `.place-section p` is load-bearing — removing it silently breaks line breaks embedded in the JSON.

## Pin icons

All icons live in `assets/icons/` and are registered in `PIN_ICONS` at the top of `js/map.js`. To add a new pin type:

1. Drop the SVG into `assets/icons/`.
2. Add an entry to `PIN_ICONS`, e.g. `church: { iconUrl: 'assets/icons/church.svg', iconSize: [...], iconAnchor: [...], popupAnchor: [...] }`.
3. Set `"pinType": "church"` on the relevant places in `places.json`.
4. Update the `EDITING_GUIDE.md` note about available pin types.

Unknown `pinType` values fall back to `fort` — no crashes.

## Map tiles

- **Satellite:** Esri World Imagery + a boundaries-and-places reference layer on top, stacked as two raster layers in the MapLibre style so labels toggle with the imagery. No API key required, but respect Esri's attribution.
- **Simple:** OpenStreetMap.

If map usage grows and Esri throttles us, candidates are: MapTiler (free tier, API key), Stadia Maps, or Mapbox (non-free). Avoid switching to a vector/WebGL provider unless the "curved globe aesthetic" requirement explicitly requires it.

## Modal accessibility

`js/map.js` tracks `lastFocused` before opening the modal and restores focus on close; `Escape` and any `[data-close]` element close it. Keep this behaviour if you refactor.

## Deployment

GitHub Pages (root of `main`). `.nojekyll` is committed so Pages doesn't run Jekyll over the tree.

## Don'ts

- Don't introduce a build step or bundler — the author workflow assumes editing JSON and refreshing.
- Don't fetch from external origins for content (CORS, caching, GDPR). All content stays in-repo.
- Don't swallow JSON parse errors silently; surface them via the `#map-error` panel or the place-page `.error` block so Aidan can find mistakes.
- Don't reformat the historian's prose programmatically.

## Open areas (deliberately unbuilt)

- **Search / filtering** — the data model already supports `category`, `type`, and `dates.range`, so a filter panel could be added without a schema change.
- **Custom slug URLs** (`/places/leamlara-house.html`) — currently we use `place.html?id=…`. Moving to per-place HTML files would require either a tiny Node script at deploy time or switching Pages to a generator; flagged but not needed yet.
- **Image optimisation** — images are served as-is; add a build step only if load times become a problem.
