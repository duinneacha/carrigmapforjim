# Carrigtwohill Historical Places — System Brief

A one-page orientation for anyone joining the project.

## What it is

A static, client-side website presenting an interactive map of historical places
in Carrigtwohill Parish, Co. Cork. Pins on the map open a preview modal; "Further
Information" links through to a per-place detail page with images, narrative,
sources, and related places.

Authored content is JSON; the local historian (Aidan) edits a single file and
the site updates on the next deploy. Hosted on GitHub Pages from `main`.

## Who it's for

- **Authors:** Aidan (historian), Jim Barry, Carrigtwohill Historical Society
  members. They edit `data/places.json` directly; non-developer-friendly schema
  documented in `EDITING_GUIDE.md`.
- **Visitors:** general public and society members reading the map and place
  pages.

## Tech stack — deliberately tiny

- Plain HTML / CSS / vanilla JS. **No framework, no bundler, no build step.**
- [MapLibre GL](https://maplibre.org/) for the map (loaded via CDN).
- Esri World Imagery + OSM as raster tile sources (no API keys).
- GitHub Pages for hosting; `.nojekyll` committed.

The "no build step" rule is load-bearing — it lets the historian edit JSON and
just refresh.

## Architecture

```
index.html   ──▶  js/map.js      ─┐
                                  ├──▶  js/data-loader.js ──▶  data/places.json
place.html   ──▶  js/place.js    ─┘
```

- **Two pages.** `index.html` (map) and `place.html` (detail view, reads
  `?id=<place-id>` from the URL).
- **Shared loader.** `js/data-loader.js` fetches `data/places.json` once,
  exposes `PlacesData.load() / findById() / placeUrl()` globally.
- **Rendering logic** for the detail page lives in `js/place.js`
  (`renderBlock`, `renderSection`, etc.). Block types: paragraph, heading,
  quote, list, image. Add new types by extending the switch in `renderBlock`
  and documenting in `EDITING_GUIDE.md`.

## Data model

Top-level: `{ "places": [ ... ] }`. Each place has:

- `id` (URL-safe slug; required), `name`, `location {lat,lng}`
- `pinType` (key into `PIN_ICONS` in `js/map.js` — currently only `fort`)
- `category`, `type`, `dates {range|from|to}`
- `preview` (modal blurb), `lead` (italic intro on detail page)
- `images[]` (first image is the hero)
- `sections[]` → `blocks[]` (flexible body)
- `relatedPlaces[]` (array of place ids), `sources[]` (strings or objects)

Full schema and authoring rules: `EDITING_GUIDE.md`.

## Important constraints

- **Historian's prose is rendered verbatim.** No trimming, re-casing,
  auto-linking, or whitespace collapsing. CSS `white-space: pre-wrap` on
  `.place-section p` is load-bearing.
- **No external content fetches.** All text and images stay in-repo (CORS,
  caching, GDPR). Tiles are the only external resource.
- **No build step.** If interactivity outgrows what plain DOM can carry,
  reach for Preact via ESM before pulling in a framework.
- **Surface JSON errors visibly.** The `#map-error` panel and `.error` block
  on the place page exist so Aidan can see his typos.

## Notable features

- **Edit mode** (top-right toggle on the map): user double-clicks to drop
  ad-hoc pins, names them, then right-clicks to copy `Name | lng, lat |
  description` for pasting into WhatsApp. Persists to `localStorage` only —
  never mutates `places.json`.
- **Two base layers:** Satellite (Esri imagery + boundaries reference) and
  Simple (OSM). Switched via a custom MapLibre `IControl`.
- **Modal accessibility:** focus is captured on open and restored on close;
  `Escape` and `[data-close]` elements both close.

## Running locally

`fetch('data/places.json')` won't work over `file://`, so use any static server:

```bash
python -m http.server 8000
# or
npx serve .
```

Then open <http://localhost:8000/>.

## Deployment

Push to `main`. GitHub Pages serves from the repo root.

## Repository tour

| Path | Purpose |
| --- | --- |
| `index.html` | Map page |
| `place.html` | Per-place detail page |
| `js/map.js` | MapLibre setup, pins, modal, edit mode |
| `js/place.js` | Detail-page rendering |
| `js/data-loader.js` | Shared JSON loader (`PlacesData`) |
| `css/map.css`, `css/place.css` | Styles |
| `data/places.json` | All authored content |
| `assets/icons/` | Pin SVGs, registered in `PIN_ICONS` |
| `assets/images/` | Place imagery |
| `EDITING_GUIDE.md` | Author-facing schema reference |
| `CLAUDE.md` | Notes for AI coding sessions |
| `README.md` | High-level project readme |

## Open areas (deliberately unbuilt)

- Search / filter UI (data model already supports `category`, `type`,
  `dates.range` — no schema change needed).
- Pretty per-place URLs (`/places/leamlara-house.html`) — would need either
  a deploy script or a generator.
- Image optimisation pipeline — only worth doing if load times become an
  issue.
- Prev/next navigation between place pages.

## Who to ask

- Content / historical accuracy: Aidan, Jim Barry, Carrigtwohill Historical
  Society.
- Code: whoever's currently maintaining the repo on GitHub.
