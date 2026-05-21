(function () {
  'use strict';

  // Default view: Carrigtwohill, Co. Cork.
  // MapLibre uses [lng, lat] order (GeoJSON), which is the opposite of Leaflet.
  const DEFAULT_CENTER = [-8.2660, 51.9080];
  const DEFAULT_ZOOM = 12;
  const DEFAULT_PITCH = 30; // slight tilt → "curved globe" feel
  const DEFAULT_BEARING = 0;
  const FIT_MAX_ZOOM = 15;

  // Pin icon registry. Add new entries here to support more pin types without
  // code changes on the calling side — places.json just references the key.
  const PIN_ICONS = {
    fort: {
      iconUrl: 'assets/icons/fort.svg',
      iconSize: [36, 42]
    }
  };

  function getIconConfig(kind) {
    return (kind && PIN_ICONS[kind]) ? PIN_ICONS[kind] : PIN_ICONS.fort;
  }

  function showError(msg) {
    const el = document.getElementById('map-error');
    el.textContent = msg;
    el.hidden = false;
  }

  function showLoading(on) {
    document.getElementById('map-loading').hidden = !on;
  }

  // --- Modal -------------------------------------------------------------

  const modalEl = document.getElementById('preview-modal');
  const modalPanel = modalEl.querySelector('.modal-panel');
  let lastFocused = null;

  function openModal(place) {
    lastFocused = document.activeElement;

    document.getElementById('preview-title').textContent = place.name || '';
    document.getElementById('preview-text').textContent = place.preview || '';

    const figure = modalEl.querySelector('.modal-figure');
    const img = document.getElementById('preview-image');
    const cap = document.getElementById('preview-caption');
    const hero = (place.images && place.images[0]) || null;

    if (hero && hero.src) {
      img.src = hero.src;
      img.alt = hero.alt || place.name || '';
      const parts = [];
      if (hero.caption) parts.push(hero.caption);
      if (hero.attribution) parts.push('Image: ' + hero.attribution);
      cap.textContent = parts.join(' — ');
      figure.hidden = false;
    } else {
      figure.hidden = true;
      img.removeAttribute('src');
    }

    const link = document.getElementById('preview-link');
    link.href = PlacesData.placeUrl(place.id);

    modalEl.hidden = false;
    requestAnimationFrame(() => modalPanel.focus());
    document.addEventListener('keydown', onKeydown);
  }

  function closeModal() {
    modalEl.hidden = true;
    document.removeEventListener('keydown', onKeydown);
    if (lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus();
    }
  }

  function onKeydown(e) {
    if (e.key === 'Escape') closeModal();
  }

  modalEl.addEventListener('click', (e) => {
    if (e.target.matches('[data-close]')) closeModal();
  });

  // --- Boundary data: load + cache --------------------------------------
  // cork_townlands.geojson is ~25 MB — too large for localStorage's ~5 MB
  // quota. The Cache API is the right tool: many MB of capacity, scoped per
  // origin, accessible from the page (no service worker required). We use
  // localStorage solely for the small timestamp and the derived
  // townland→parish lookup map.

  const TOWNLANDS_URL = 'data/cork_townlands.geojson';
  const PARISHES_URL = 'data/parishes.geojson';
  const CACHE_NAME = 'jimmap-boundaries-v2';
  const TS_KEY_TOWNLANDS = 'cork_townlands_cache_ts';
  const TS_KEY_PARISHES = 'cork_parishes_cache_ts';
  const PARISH_MAP_KEY = 'cork_townland_parish_map_v3';
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  function lsGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, value); } catch (_) { /* quota / disabled */ }
  }
  function lsDel(key) {
    try { localStorage.removeItem(key); } catch (_) {}
  }

  // --- Layer state (persisted) ------------------------------------------
  // One place defines the four overlays. `buildStyle` uses this to bake
  // initial `visibility` into the style JSON (no flash of default state on
  // first paint), and LayersControl uses it to render the panel and to
  // re-apply visibility after every style swap.
  const BASEMAP_KEY = 'map.basemap';
  // Each overlay either toggles MapLibre layers (layerIds) or a class on the
  // #map element (domClass), or both. Pin labels are baked into marker HTML
  // rather than rendered as a symbol layer, so they're toggled via DOM class.
  // Array order is display order. `group` partitions the overlays into
  // sub-labelled clusters in the UI ("Borders" / "Names").
  const OVERLAYS = [
    { id: 'parishBorders',   label: 'Parish',     group: 'borders', icon: 'ti-vector-triangle', layerIds: ['parish-outline-casing', 'parish-outline'], storageKey: 'map.overlay.parishBorders',   defaultOn: false },
    { id: 'townlandBorders', label: 'Townland',   group: 'borders', icon: 'ti-polygon',         layerIds: ['townland-fill', 'townland-outline'],       storageKey: 'map.overlay.townlandBorders', defaultOn: false },
    { id: 'parishNames',     label: 'Parish',     group: 'names',   icon: 'ti-typography',      layerIds: ['parish-names'],                            storageKey: 'map.overlay.parishNames',     defaultOn: false },
    { id: 'townlandNames',   label: 'Townland',   group: 'names',   icon: 'ti-letter-case',     layerIds: ['townland-names'],                          storageKey: 'map.overlay.townlandNames',   defaultOn: false },
    { id: 'pinLabels',       label: 'Pin labels', group: 'names',   icon: 'ti-tag',             layerIds: [],                                          storageKey: 'map.overlay.pinLabels',       defaultOn: true,  domClass: 'hide-pin-labels' }
  ];

  const OVERLAY_GROUPS = [
    { id: 'borders', label: 'Borders' },
    { id: 'names',   label: 'Names' }
  ];

  const BASEMAPS = [
    { id: 'satellite', label: 'Satellite', icon: 'ti-mountain' },
    { id: 'simple',    label: 'Street',    icon: 'ti-map' }
  ];

  function readBasemap() {
    const v = lsGet(BASEMAP_KEY);
    return v === 'simple' ? 'simple' : 'satellite';
  }
  function readOverlayState() {
    const state = {};
    for (const o of OVERLAYS) {
      const v = lsGet(o.storageKey);
      state[o.id] = v == null ? o.defaultOn : v === 'true';
    }
    return state;
  }

  async function fetchJsonWithCache(url, tsKey, opts) {
    const force = !!(opts && opts.force);
    const ts = parseInt(lsGet(tsKey) || '0', 10);
    const fresh = !force && ts > 0 && (Date.now() - ts) < SEVEN_DAYS_MS;

    if ('caches' in window) {
      try {
        const cache = await caches.open(CACHE_NAME);
        if (fresh) {
          const cached = await cache.match(url);
          if (cached) return cached.json();
        }
        const resp = await fetch(url, { cache: 'no-cache' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status + ' for ' + url);
        await cache.put(url, resp.clone());
        lsSet(tsKey, String(Date.now()));
        return resp.json();
      } catch (e) {
        // If network fails but we have a stale cache entry, prefer that over erroring.
        try {
          const cache = await caches.open(CACHE_NAME);
          const cached = await cache.match(url);
          if (cached) return cached.json();
        } catch (_) {}
        throw e;
      }
    }

    // Cache API unavailable (rare). Fall back to plain fetch — browser HTTP
    // cache will at least serve the second hit from disk.
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status + ' for ' + url);
    return resp.json();
  }

  // --- Townland → parish lookup -----------------------------------------
  // cork_townlands.geojson does NOT carry parish info, so we compute it
  // ourselves via centroid point-in-polygon against parishes.geojson, then
  // cache the small (osm_id → parish name) map in localStorage. ~5300
  // entries, average ~30 bytes each, comfortably fits the quota.

  function ringContains(ring, x, y) {
    // Standard ray-casting. ring: [[lng, lat], ...]
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const intersect = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function polygonContains(polygon, x, y) {
    // polygon: [outerRing, hole1, hole2, ...]
    if (!polygon.length || !ringContains(polygon[0], x, y)) return false;
    for (let i = 1; i < polygon.length; i++) {
      if (ringContains(polygon[i], x, y)) return false;
    }
    return true;
  }

  function geometryContains(geom, x, y) {
    if (!geom) return false;
    if (geom.type === 'Polygon') return polygonContains(geom.coordinates, x, y);
    if (geom.type === 'MultiPolygon') {
      for (const p of geom.coordinates) {
        if (polygonContains(p, x, y)) return true;
      }
    }
    return false;
  }

  function bboxOfGeometry(geom) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const visit = (coords) => {
      for (const c of coords) {
        if (typeof c[0] === 'number') {
          if (c[0] < minX) minX = c[0];
          if (c[0] > maxX) maxX = c[0];
          if (c[1] < minY) minY = c[1];
          if (c[1] > maxY) maxY = c[1];
        } else {
          visit(c);
        }
      }
    };
    if (geom && geom.coordinates) visit(geom.coordinates);
    return [minX, minY, maxX, maxY];
  }

  function representativePoint(geom) {
    // Cheap centroid-of-largest-ring. Good enough to land inside the polygon
    // for the kinds of shapes townlands have (no extreme C-curves).
    if (!geom) return null;
    let largestRing = null, largestArea = -Infinity;
    const consider = (ring) => {
      // |signed area| via shoelace
      let a = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
      }
      const area = Math.abs(a) * 0.5;
      if (area > largestArea) { largestArea = area; largestRing = ring; }
    };
    if (geom.type === 'Polygon') consider(geom.coordinates[0]);
    else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) consider(poly[0]);
    }
    if (!largestRing) return null;
    let sx = 0, sy = 0;
    for (const pt of largestRing) { sx += pt[0]; sy += pt[1]; }
    return [sx / largestRing.length, sy / largestRing.length];
  }

  function buildTownlandParishMap(townlands, parishes) {
    // Pre-compute parish bboxes so we can early-exit most pairings.
    const parishIndex = parishes.features.map((p) => ({
      name: (p.properties && p.properties.name) || '',
      geom: p.geometry,
      bbox: bboxOfGeometry(p.geometry)
    }));

    const map = Object.create(null);
    for (const f of townlands.features) {
      const id = f.properties && f.properties.osm_id;
      if (id == null) continue;
      const pt = representativePoint(f.geometry);
      if (!pt) continue;
      const x = pt[0], y = pt[1];
      for (const p of parishIndex) {
        const b = p.bbox;
        if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
        if (geometryContains(p.geom, x, y)) { map[id] = p.name; break; }
      }
    }
    return map;
  }

  function getCachedParishMap() {
    const raw = lsGet(PARISH_MAP_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) { return null; }
  }

  function annotateTownlandsWithParish(townlands, parishMap) {
    for (const f of townlands.features) {
      const id = f.properties && f.properties.osm_id;
      const parish = (id != null && parishMap[id]) ? parishMap[id] : '';
      f.properties.parish = parish;
    }
  }

  // --- Layer definitions -------------------------------------------------

  function townlandLayers() {
    return [
      {
        id: 'townland-fill',
        type: 'fill',
        source: 'townlands',
        paint: {
          'fill-color': '#ffffff',
          'fill-opacity': 0.05
        }
      },
      {
        id: 'townland-outline',
        type: 'line',
        source: 'townlands',
        paint: {
          'line-color': '#ffffff',
          'line-opacity': 0.9,
          'line-width': 1
        }
      }
    ];
  }

  function parishLayers() {
    return [
      // Dark casing under the yellow so the line reads on both the dark
      // satellite imagery and the cream OSM basemap.
      {
        id: 'parish-outline-casing',
        type: 'line',
        source: 'parishes',
        paint: {
          'line-color': '#1c1a17',
          'line-opacity': 0.55,
          'line-width': 4.5
        }
      },
      {
        id: 'parish-outline',
        type: 'line',
        source: 'parishes',
        paint: {
          'line-color': '#ffdd00',
          'line-opacity': 1,
          'line-width': 2.5
        }
      }
    ];
  }

  // Centroid labels for the polygon sources. MapLibre auto-places one label
  // per polygon at its visual centroid and hides overlapping labels at low
  // zoom. Both layers are visibility-controlled by LayersControl.
  function townlandNameLayers() {
    return [
      {
        id: 'townland-names',
        type: 'symbol',
        source: 'townlands',
        minzoom: 13,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 12,
          'symbol-placement': 'point'
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': 'rgba(20, 16, 12, 0.85)',
          'text-halo-width': 1.4
        }
      }
    ];
  }

  function parishNameLayers() {
    return [
      {
        id: 'parish-names',
        type: 'symbol',
        source: 'parishes',
        minzoom: 9,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Semibold'],
          'text-size': 14,
          'text-letter-spacing': 0.05,
          'symbol-placement': 'point'
        },
        paint: {
          'text-color': '#ffdd00',
          'text-halo-color': 'rgba(20, 16, 12, 0.9)',
          'text-halo-width': 2
        }
      }
    ];
  }

  // --- Styles ------------------------------------------------------------
  // Raster tile styles; no API key required. The top-level `projection: globe`
  // gives the curved-earth aesthetic on zoomed-out views while automatically
  // falling back to a flat projection as the user zooms in.

  const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, ODbL';
  const ESRI_ATTRIBUTION = 'Tiles &copy; Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community';

  // Boundary sources are kept as empty FeatureCollections at style-definition
  // time and populated via map.getSource(...).setData(...) once the async
  // load completes. Embedding the URL directly would bypass our Cache API
  // logic and force a re-download on every basemap switch.
  function emptyFC() { return { type: 'FeatureCollection', features: [] }; }

  function buildStyle(kind) {
    const base = kind === 'simple'
      ? {
          background: '#f6f1e6',
          sources: {
            osm: {
              type: 'raster',
              tiles: [
                'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
                'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
                'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'
              ],
              tileSize: 256,
              maxzoom: 19,
              attribution: OSM_ATTRIBUTION
            }
          },
          baseLayers: [
            { id: 'background', type: 'background', paint: { 'background-color': '#f6f1e6' } },
            { id: 'osm', type: 'raster', source: 'osm' }
          ]
        }
      : {
          background: '#000',
          sources: {
            'esri-imagery': {
              type: 'raster',
              tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
              tileSize: 256,
              maxzoom: 19,
              attribution: ESRI_ATTRIBUTION
            },
            'esri-reference': {
              type: 'raster',
              tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
              tileSize: 256,
              maxzoom: 19
            }
          },
          baseLayers: [
            { id: 'background', type: 'background', paint: { 'background-color': '#000' } },
            { id: 'esri-imagery', type: 'raster', source: 'esri-imagery' }
          ]
        };

    return {
      version: 8,
      projection: { type: 'globe' },
      // MapLibre symbol layers need a glyphs URL to render text. Demotiles
      // is the project's own demo glyph server — no API key, CORS-open,
      // serves "Open Sans Regular" and "Open Sans Bold".
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources: Object.assign({}, base.sources, {
        townlands: { type: 'geojson', data: emptyFC(), attribution: OSM_ATTRIBUTION },
        parishes: { type: 'geojson', data: emptyFC(), attribution: OSM_ATTRIBUTION }
      }),
      layers: bakeInitialVisibility([
        ...base.baseLayers,
        ...townlandLayers(),
        ...parishLayers(),
        ...townlandNameLayers(),
        ...parishNameLayers(),
        // Esri's labels-and-places overlay (only present in satellite) goes
        // on top of boundaries so place names remain readable.
        ...(kind === 'satellite'
          ? [{ id: 'esri-reference', type: 'raster', source: 'esri-reference' }]
          : [])
      ])
    };
  }

  // Mutate layer definitions in-place to set visibility:'none' on any
  // overlay layer that should start hidden according to localStorage. Avoids
  // a flash of default state before LayersControl's style.load handler runs.
  function bakeInitialVisibility(layers) {
    const layerToOverlay = {};
    for (const o of OVERLAYS) {
      for (const lid of o.layerIds) layerToOverlay[lid] = o.id;
    }
    const state = readOverlayState();
    for (const layer of layers) {
      const oid = layerToOverlay[layer.id];
      if (oid && !state[oid]) {
        layer.layout = Object.assign({}, layer.layout, { visibility: 'none' });
      }
    }
    return layers;
  }

  const SATELLITE_STYLE = buildStyle('satellite');
  const SIMPLE_STYLE = buildStyle('simple');
  const INITIAL_STYLE = readBasemap() === 'simple' ? SIMPLE_STYLE : SATELLITE_STYLE;

  // --- Map controls (basemap + overlays + view actions) -----------------
  // Single class that owns all state for: basemap selection (radio),
  // overlay toggles (checkbox), and view actions (zoom in/out, reset).
  // Renders into any container via renderInto(el) — desktop puts it in the
  // page header; mobile reuses the same DOM as a drawer. State persists to
  // localStorage and is restored on next visit.
  //
  // Not a MapLibre IControl: it lives outside the map element so it can be
  // positioned by the page layout rather than the map's corner-anchor
  // system.

  function makeIcon(iconClass) {
    const i = document.createElement('i');
    i.className = 'ti ' + iconClass;
    i.setAttribute('aria-hidden', 'true');
    return i;
  }

  class LayersControl {
    constructor(map) {
      this._map = map;
      this._currentBasemap = readBasemap();
      this._overlayState = readOverlayState();
      this._basemapStyles = {
        satellite: SATELLITE_STYLE,
        simple: SIMPLE_STYLE
      };
      this._basemapRadios = {};
      this._overlayCheckboxes = {};

      // Apply DOM-class overlays (pin labels) now so labels don't flash on
      // first paint of markers. Layer-based overlays are already baked into
      // the initial style via bakeInitialVisibility.
      this._applyDomOverlays();

      // After every basemap swap the new style is rebuilt from scratch, so
      // re-apply current overlay state. (bakeInitialVisibility bakes from
      // localStorage, but in-memory state is newer if the user toggled
      // anything since page load.)
      this._onStyleLoad = () => this._applyAllOverlays();
      map.on('style.load', this._onStyleLoad);
    }

    renderInto(container) {
      container.innerHTML = '';
      container.appendChild(this._buildViewCluster());
      container.appendChild(this._buildBasemapCluster());
      container.appendChild(this._buildOverlayCluster());
    }

    // --- View cluster: zoom in, zoom out, reset --------------------------

    _buildViewCluster() {
      const cluster = document.createElement('div');
      cluster.className = 'control-cluster control-cluster-view';
      cluster.appendChild(this._clusterHeading('View'));

      const zoomIn = this._iconButton('ti-plus', 'Zoom in', () => this._map.zoomIn(), 'zoom-in-btn');
      const zoomOut = this._iconButton('ti-minus', 'Zoom out', () => this._map.zoomOut(), 'zoom-out-btn');
      const reset = this._iconButton('ti-home', 'Reset view', () => this._resetView(), 'reset-btn');

      cluster.appendChild(zoomIn);
      cluster.appendChild(zoomOut);
      cluster.appendChild(reset);
      return cluster;
    }

    // Cluster heading is hidden on desktop (icons are self-explanatory in
    // context) and shown in the mobile drawer where the layout is stacked.
    // aria-hidden because the parent already exposes the same label via
    // role + aria-label; rendering the text twice would double-announce.
    _clusterHeading(text) {
      const h = document.createElement('span');
      h.className = 'cluster-heading';
      h.textContent = text;
      h.setAttribute('aria-hidden', 'true');
      return h;
    }

    // Icon-only-by-default button. The visible text span is hidden on
    // desktop via CSS but revealed in the mobile drawer for the buttons
    // that remain there (currently only Reset).
    _iconButton(iconClass, label, onClick, extraClass) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'control-btn' + (extraClass ? ' ' + extraClass : '');
      btn.setAttribute('aria-label', label);
      btn.title = label;
      btn.appendChild(makeIcon(iconClass));
      const text = document.createElement('span');
      text.className = 'control-btn-text';
      text.textContent = label;
      btn.appendChild(text);
      btn.addEventListener('click', onClick);
      return btn;
    }

    _resetView() {
      this._map.flyTo({
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        pitch: DEFAULT_PITCH,
        bearing: DEFAULT_BEARING
      });
    }

    // --- Basemap cluster: Satellite / Street radios ----------------------

    _buildBasemapCluster() {
      const cluster = document.createElement('div');
      cluster.className = 'control-cluster control-cluster-basemap';
      cluster.setAttribute('role', 'radiogroup');
      cluster.setAttribute('aria-label', 'Base map');
      cluster.appendChild(this._clusterHeading('Base map'));

      this._basemapRadios = {};
      for (const bm of BASEMAPS) {
        const lbl = document.createElement('label');
        lbl.className = 'basemap-option' + (bm.id === this._currentBasemap ? ' is-active' : '');

        const r = document.createElement('input');
        r.type = 'radio';
        r.name = 'jimmap-basemap';
        r.value = bm.id;
        r.checked = bm.id === this._currentBasemap;
        r.addEventListener('change', () => { if (r.checked) this._setBasemap(bm.id); });

        lbl.appendChild(r);
        lbl.appendChild(makeIcon(bm.icon));
        const text = document.createElement('span');
        text.className = 'basemap-option-text';
        text.textContent = bm.label;
        lbl.appendChild(text);

        cluster.appendChild(lbl);
        this._basemapRadios[bm.id] = { input: r, label: lbl };
      }
      return cluster;
    }

    // --- Overlay cluster: grouped checkboxes -----------------------------

    _buildOverlayCluster() {
      const cluster = document.createElement('div');
      cluster.className = 'control-cluster control-cluster-overlays';
      cluster.appendChild(this._clusterHeading('Overlays'));

      this._overlayCheckboxes = {};
      for (const g of OVERLAY_GROUPS) {
        const sub = document.createElement('div');
        sub.className = 'overlay-subgroup';
        sub.setAttribute('role', 'group');
        sub.setAttribute('aria-label', g.label);

        const heading = document.createElement('span');
        heading.className = 'overlay-subgroup-label';
        heading.textContent = g.label;
        heading.setAttribute('aria-hidden', 'true');
        sub.appendChild(heading);

        for (const o of OVERLAYS) {
          if (o.group !== g.id) continue;
          const lbl = document.createElement('label');
          lbl.className = 'overlay-option';

          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = !!this._overlayState[o.id];
          cb.addEventListener('change', () => this._setOverlay(o.id, cb.checked));

          lbl.appendChild(cb);
          lbl.appendChild(makeIcon(o.icon || 'ti-stack-2'));
          const text = document.createElement('span');
          text.className = 'overlay-option-text';
          text.textContent = o.label;
          lbl.appendChild(text);

          sub.appendChild(lbl);
          this._overlayCheckboxes[o.id] = cb;
        }

        cluster.appendChild(sub);
      }
      return cluster;
    }

    // --- State transitions -----------------------------------------------

    _setBasemap(id) {
      if (id === this._currentBasemap) return;
      const style = this._basemapStyles[id];
      if (!style) return;
      this._currentBasemap = id;
      lsSet(BASEMAP_KEY, id);
      this._map.setStyle(style, { diff: false });
      for (const k in this._basemapRadios) {
        const entry = this._basemapRadios[k];
        entry.input.checked = k === id;
        entry.label.classList.toggle('is-active', k === id);
      }
    }

    _setOverlay(id, on) {
      this._overlayState[id] = on;
      const o = OVERLAYS.find((x) => x.id === id);
      if (o) lsSet(o.storageKey, on ? 'true' : 'false');
      this._applyOverlay(id);
    }

    _applyOverlay(id) {
      const o = OVERLAYS.find((x) => x.id === id);
      if (!o) return;
      const on = !!this._overlayState[id];

      if (o.layerIds && o.layerIds.length && this._map) {
        const visibility = on ? 'visible' : 'none';
        for (const layerId of o.layerIds) {
          if (this._map.getLayer(layerId)) {
            this._map.setLayoutProperty(layerId, 'visibility', visibility);
          }
        }
      }

      if (o.domClass) {
        const mapEl = document.getElementById('map');
        if (mapEl) mapEl.classList.toggle(o.domClass, !on);
      }
    }

    _applyAllOverlays() {
      for (const o of OVERLAYS) this._applyOverlay(o.id);
    }

    _applyDomOverlays() {
      const mapEl = document.getElementById('map');
      if (!mapEl) return;
      for (const o of OVERLAYS) {
        if (!o.domClass) continue;
        mapEl.classList.toggle(o.domClass, !this._overlayState[o.id]);
      }
    }
  }

  // --- Drawer (mobile) ---------------------------------------------------
  // Hamburger button in the header toggles a class on the header element.
  // CSS handles the actual drop-down visuals + responsive show/hide of the
  // toggle button itself.

  function attachDrawer() {
    const header = document.getElementById('site-header');
    const toggle = document.getElementById('drawer-toggle');
    if (!header || !toggle) return;

    const setOpen = (open) => {
      header.classList.toggle('drawer-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Close map controls' : 'Open map controls');
    };

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      setOpen(!header.classList.contains('drawer-open'));
    });

    // Outside click / tap closes. Use mousedown so the close feels immediate.
    const onDocPointer = (e) => {
      if (!header.classList.contains('drawer-open')) return;
      if (!header.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocPointer);
    document.addEventListener('touchstart', onDocPointer, { passive: true });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && header.classList.contains('drawer-open')) setOpen(false);
    });
  }

  function attachMobileZoom(map) {
    const zin = document.getElementById('mobile-zoom-in');
    const zout = document.getElementById('mobile-zoom-out');
    if (zin) zin.addEventListener('click', () => map.zoomIn());
    if (zout) zout.addEventListener('click', () => map.zoomOut());
  }

  // --- Hover tooltip -----------------------------------------------------

  const tooltipEl = document.getElementById('townland-tooltip');

  function showTooltip(html, x, y) {
    tooltipEl.innerHTML = html;
    tooltipEl.hidden = false;
    // Position after unhiding so we can measure it.
    const rect = tooltipEl.getBoundingClientRect();
    const pad = 14;
    let left = x + pad;
    let top = y + pad;
    if (left + rect.width > window.innerWidth - 4) left = x - rect.width - pad;
    if (top + rect.height > window.innerHeight - 4) top = y - rect.height - pad;
    tooltipEl.style.left = Math.max(4, left) + 'px';
    tooltipEl.style.top = Math.max(4, top) + 'px';
  }

  function hideTooltip() {
    tooltipEl.hidden = true;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function attachTooltipHandlers(map) {
    const onMove = (e) => {
      if (!map.getLayer('townland-fill')) { hideTooltip(); return; }
      const features = map.queryRenderedFeatures(e.point, { layers: ['townland-fill'] });
      if (!features.length) { hideTooltip(); return; }
      const props = features[0].properties || {};
      const name = props.name || 'Unknown townland';
      const parish = props.parish || '';
      const html = '<strong>' + escapeHtml(name) + '</strong>' +
        (parish ? '<br><span class="t-sub">Parish of ' + escapeHtml(parish) + '</span>' : '');
      const orig = e.originalEvent;
      showTooltip(html, orig.clientX, orig.clientY);
    };
    map.on('mousemove', onMove);
    map.on('mouseout', hideTooltip);
    map.getCanvas().addEventListener('mouseleave', hideTooltip);
  }

  // --- Map ---------------------------------------------------------------

  function buildMap() {
    const map = new maplibregl.Map({
      container: 'map',
      style: INITIAL_STYLE,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      pitch: DEFAULT_PITCH,
      bearing: DEFAULT_BEARING,
      maxPitch: 75,
      hash: false,
      attributionControl: { compact: true }
    });

    map.on('error', (e) => {
      console.error('[map error]', e && e.error ? e.error : e);
    });

    return map;
  }

  function createPinElement(place) {
    const cfg = getIconConfig(place.pinType);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'map-pin';
    btn.setAttribute('aria-label', place.name || 'Historical place');
    btn.title = place.name || '';
    btn.style.width = cfg.iconSize[0] + 'px';
    btn.style.height = cfg.iconSize[1] + 'px';
    btn.style.backgroundImage = 'url("' + cfg.iconUrl + '")';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openModal(place);
    });
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openModal(place);
      }
    });

    if (place.name) {
      const label = document.createElement('span');
      label.className = 'map-pin-label';
      label.textContent = place.name;
      btn.appendChild(label);
    }

    return btn;
  }

  function addMarkers(map, places) {
    const bounds = new maplibregl.LngLatBounds();
    let count = 0;

    places.forEach((place) => {
      if (!place.location || typeof place.location.lat !== 'number' || typeof place.location.lng !== 'number') {
        console.warn('Skipping place with no location:', place.id);
        return;
      }
      const el = createPinElement(place);
      new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([place.location.lng, place.location.lat])
        .addTo(map);
      bounds.extend([place.location.lng, place.location.lat]);
      count++;
    });

    const applyBounds = () => {
      if (count > 1) {
        map.fitBounds(bounds, {
          padding: 60,
          maxZoom: FIT_MAX_ZOOM,
          pitch: DEFAULT_PITCH,
          bearing: DEFAULT_BEARING,
          duration: 0
        });
      } else if (count === 1) {
        map.jumpTo({
          center: bounds.getCenter(),
          zoom: 14,
          pitch: DEFAULT_PITCH,
          bearing: DEFAULT_BEARING
        });
      }
    };

    if (map.loaded()) applyBounds();
    else map.once('load', applyBounds);
  }

  // --- Boundary load orchestration --------------------------------------
  // Loaded data is stashed in module scope so re-applying after a basemap
  // switch (which wipes the geojson sources) doesn't require another fetch.

  let townlandsData = null;
  let parishesData = null;

  function applyBoundaryDataToMap(map) {
    const tSrc = map.getSource('townlands');
    if (tSrc && townlandsData) tSrc.setData(townlandsData);
    const pSrc = map.getSource('parishes');
    if (pSrc && parishesData) pSrc.setData(parishesData);
  }

  async function loadBoundaries(opts) {
    const force = !!(opts && opts.force);
    if (force) {
      lsDel(TS_KEY_TOWNLANDS);
      lsDel(TS_KEY_PARISHES);
      lsDel(PARISH_MAP_KEY);
    }

    // Parishes first — small file, needed to compute the townland→parish map.
    parishesData = await fetchJsonWithCache(PARISHES_URL, TS_KEY_PARISHES, { force });
    townlandsData = await fetchJsonWithCache(TOWNLANDS_URL, TS_KEY_TOWNLANDS, { force });

    let parishMap = force ? null : getCachedParishMap();
    if (!parishMap) {
      parishMap = buildTownlandParishMap(townlandsData, parishesData);
      lsSet(PARISH_MAP_KEY, JSON.stringify(parishMap));
    }
    annotateTownlandsWithParish(townlandsData, parishMap);
  }

  // --- Boot --------------------------------------------------------------

  showLoading(true);
  const map = buildMap();
  attachTooltipHandlers(map);

  const layersControl = new LayersControl(map);
  layersControl.renderInto(document.getElementById('map-controls'));
  attachDrawer();
  attachMobileZoom(map);

  // After every style swap, re-apply visibility (handled by LayersControl)
  // and re-push the geojson data into the new sources.
  map.on('style.load', () => applyBoundaryDataToMap(map));

  loadBoundaries()
    .then(() => applyBoundaryDataToMap(map))
    .catch((err) => {
      console.warn('Boundary load failed:', err);
      // Non-fatal: places still load.
    });

  PlacesData.load()
    .then((data) => {
      addMarkers(map, data.places);
    })
    .catch((err) => {
      console.error(err);
      showError('Could not load places: ' + err.message);
    })
    .finally(() => showLoading(false));
})();
