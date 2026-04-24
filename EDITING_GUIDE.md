# Editing Guide for Aidan

This guide explains how to add and edit historical places on the map. **You do not need to touch any code.** All content lives in one file: `data/places.json`, and images live under `assets/images/`.

## At a glance

1. Put image files into `assets/images/`.
2. Open `data/places.json` in a text editor (VS Code, Notepad++, Sublime, etc.).
3. Copy an existing place entry and change the values.
4. Save, refresh the browser. Done.

## The `places.json` structure

The file looks like this:

```json
{
  "places": [
    { ...first place... },
    { ...second place... }
  ]
}
```

Each place is an object with the following fields. **Only `id`, `name`, and `location` are strictly required; everything else is optional.**

### Required fields

| Field | What it is |
| --- | --- |
| `id` | A short, lowercase, hyphenated identifier used in the URL (e.g. `leamlara-house`). Must be unique. |
| `name` | The display name of the place (e.g. `"Leamlara House"`). |
| `location` | An object `{ "lat": 51.9325, "lng": -8.2010 }`. Get coordinates from Google Maps: right-click → the first line is `lat, lng`. |

### Common optional fields

| Field | Purpose |
| --- | --- |
| `pinType` | Which pin icon to use. Currently only `"fort"` exists; leave it as `"fort"` for now. |
| `category` | e.g. `"Estate"`, `"Castle"`, `"Ecclesiastical"`. Displayed in the metadata strip. |
| `type` | e.g. `"Tower house"`, `"House"`, `"Parish church"`. |
| `dates` | Either `{ "range": "17th – 20th century" }` or `{ "from": "1650", "to": "1920" }`. |
| `preview` | A short blurb (1–2 sentences) shown in the map modal. |
| `lead` | An optional italic lead paragraph shown above the first section on the full page. |
| `images` | An array of images (see below). The **first image** is used as the modal preview image and the hero on the full page. |
| `sections` | The main body of the page — any number of titled sections (see below). |
| `relatedPlaces` | An array of other place `id`s, e.g. `["leamlara-house"]`. |
| `sources` | An array of citations (see below). |

## Images

Put image files in `assets/images/`. Reference them like this:

```json
"images": [
  {
    "src": "assets/images/leamlara-1905.jpg",
    "alt": "View of Leamlara House from the south",
    "caption": "Leamlara House, circa 1905",
    "attribution": "Carrigtwohill Historical Society archive"
  }
]
```

- `src` — path to the image file (always starts with `assets/images/`).
- `alt` — short description for screen readers and if the image fails to load.
- `caption` — shown below the image.
- `attribution` — shown below the caption; prefixed automatically with "Image: ".

Use JPEG for photos, PNG for line art. Aim for no wider than 1600 pixels to keep the site fast.

## Sections — the flexible page body

Each place can have any number of sections. A section looks like:

```json
{
  "title": "Origins",
  "blocks": [
    { "type": "paragraph", "text": "The lands came into the possession of..." },
    { "type": "paragraph", "text": "A second paragraph..." }
  ]
}
```

### Block types

Inside `blocks` you can mix and match:

**Paragraph** — plain prose (line breaks inside the text are preserved):

```json
{ "type": "paragraph", "text": "Paragraph text goes here." }
```

**Heading** (sub-heading inside a section):

```json
{ "type": "heading", "level": 3, "text": "A smaller heading" }
```

**Quote** — styled as a block quote:

```json
{ "type": "quote", "text": "There was never a finer avenue of limes...\n— Local recollection, 1962" }
```

**List** — bullets or numbers:

```json
{ "type": "list", "ordered": false, "items": ["First", "Second", "Third"] }
```

Set `"ordered": true` for a numbered list.

**Image** — an image inline in the text:

```json
{
  "type": "image",
  "image": {
    "src": "assets/images/lime-avenue.jpg",
    "alt": "The lime avenue",
    "caption": "The avenue of limes",
    "attribution": "Photograph: A. O'Sullivan, 1978"
  }
}
```

### Subsections

Sections can also have subsections (rendered as H3 sub-headings):

```json
{
  "title": "The House",
  "blocks": [ { "type": "paragraph", "text": "..." } ],
  "subsections": [
    { "title": "Interior", "blocks": [ { "type": "paragraph", "text": "..." } ] },
    { "title": "Demesne",  "blocks": [ { "type": "paragraph", "text": "..." } ] }
  ]
}
```

## Sources

Either free-text strings or structured objects:

```json
"sources": [
  "Carrigtwohill Historical Society archive, file LEA/1–12",
  {
    "author": "Bence-Jones, M.",
    "title": "A Guide to Irish Country Houses",
    "publication": "Constable",
    "year": "1988"
  },
  {
    "title": "National Monuments Record",
    "url": "https://www.archaeology.ie/...",
    "note": "Site reference CO065-012"
  }
]
```

## Preserving your text exactly

The application renders your paragraphs verbatim, including the spacing you type. **No reformatting, no cleanups.** If you want a line break inside a paragraph, type it with `\n` in the JSON, e.g.:

```json
{ "type": "paragraph", "text": "First line.\nSecond line directly under it." }
```

## Common mistakes

- **Missing commas.** JSON is fussy — every item in a list needs a comma after it (except the last).
- **Trailing commas.** JSON does *not* allow a comma after the last item. This is invalid:

  ```json
  [ "a", "b", ]   ← the trailing comma breaks it
  ```
- **Smart quotes inside JSON strings.** The surrounding quotes in JSON must be straight double-quotes `"`, not curly `"` `"`. Inside your text you can use any punctuation you like.
- **Escaping double-quotes inside prose.** If your text contains `"`, write it as `\"` inside the JSON string. Single quotes `'` and em-dashes `—` are fine.

## Checking your work

After editing, open the site (locally or on GitHub Pages) and refresh:

- Does the pin appear on the map? If not, check the `location` coordinates.
- Does the modal open with your preview text? If not, check the `preview` field.
- Does "Further Information" open the full page with all your sections? If the page shows an error, you probably have a JSON formatting mistake — paste the file into <https://jsonlint.com/> to find the bad line.

## Adding a new place — quick recipe

1. Copy any existing place object in `places.json` (everything from `{` to the matching `}`).
2. Paste it as a new entry in the `"places": [ ... ]` array, separated by a comma.
3. Change `id`, `name`, `location`, `preview`, and so on.
4. Put any new images into `assets/images/` and reference them from the entry.
5. Save. Refresh the page.
