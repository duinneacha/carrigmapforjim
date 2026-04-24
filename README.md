# Carrigtwohill Parish — Historical Places Map

A standalone, client-side web application that presents an interactive map of historical places in Carrigtwohill Parish. Pins open a modal preview; a "Further Information" link opens the full place page in a new tab.

## Live site

Deployed via GitHub Pages. Push to `main` and enable Pages on the repository (Settings → Pages → Source: `main` / root).

## Tech stack

- Plain HTML, CSS, JavaScript (no build step, no framework)
- [MapLibre GL JS](https://maplibre.org/) for the map (globe projection for a curved-earth aesthetic), with Esri World Imagery for satellite and OpenStreetMap for the simple view
- Content loaded at runtime from `data/places.json`

## Repository layout

```
index.html              Map page
place.html              Dynamic place-detail page (reads ?id=… from URL)
css/
  map.css               Styles for the map page
  place.css             Styles for the place page
js/
  data-loader.js        Shared fetch + helpers for places.json
  map.js                MapLibre setup, markers, modal
  place.js              Renders a single place by id
data/
  places.json           All content — edited by the historian
assets/
  icons/fort.svg        Default pin icon
  images/               Place images (use real photos; placeholders shipped)
EDITING_GUIDE.md        Non-developer guide for adding/editing places
CLAUDE.md               Codebase + data-model notes for future maintenance
.nojekyll               Tells GitHub Pages to serve files as-is
```

## Running locally

Because the app uses `fetch('data/places.json')`, you need a static HTTP server (opening `index.html` with `file://` will hit CORS restrictions in most browsers).

Any of these works:

```bash
# Python
python -m http.server 8000

# Node
npx serve .

# VS Code: "Live Server" extension
```

Then open <http://localhost:8000/>.

## Adding or editing places

See [EDITING_GUIDE.md](EDITING_GUIDE.md). No code changes are required for new places, new sections, new images, or new sources — only `data/places.json` and files under `assets/images/`.

## Deployment

1. Push this repository to GitHub.
2. Repository → Settings → Pages → Source: `Deploy from a branch` → Branch: `main` / root → Save.
3. Your site will publish at `https://<user-or-org>.github.io/<repo-name>/`.
