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
  const CACHE_NAME = 'jimmap-boundaries-v1';
  const TS_KEY_TOWNLANDS = 'cork_townlands_cache_ts';
  const TS_KEY_PARISHES = 'cork_parishes_cache_ts';
  const PARISH_MAP_KEY = 'cork_townland_parish_map_v1';
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

  const TOWNLAND_LAYER_IDS = ['townland-fill', 'townland-outline'];
  const PARISH_LAYER_IDS = ['parish-outline-casing', 'parish-outline'];

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
      sources: Object.assign({}, base.sources, {
        townlands: { type: 'geojson', data: emptyFC(), attribution: OSM_ATTRIBUTION },
        parishes: { type: 'geojson', data: emptyFC(), attribution: OSM_ATTRIBUTION }
      }),
      layers: [
        ...base.baseLayers,
        ...townlandLayers(),
        ...parishLayers(),
        // Esri's labels-and-places overlay (only present in satellite) goes
        // on top of boundaries so place names remain readable.
        ...(kind === 'satellite'
          ? [{ id: 'esri-reference', type: 'raster', source: 'esri-reference' }]
          : [])
      ]
    };
  }

  const SATELLITE_STYLE = buildStyle('satellite');
  const SIMPLE_STYLE = buildStyle('simple');

  // --- Base layer switcher (custom IControl) ----------------------------

  class BaseLayerSwitcher {
    constructor(layers, initialId) {
      this._layers = layers;
      this._current = initialId;
    }
    onAdd(map) {
      this._map = map;
      const el = document.createElement('div');
      el.className = 'maplibregl-ctrl maplibregl-ctrl-group base-layer-switcher';
      el.setAttribute('role', 'group');
      el.setAttribute('aria-label', 'Base layer');
      this._buttons = this._layers.map((layer) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = layer.label;
        btn.className = 'base-layer-btn' + (layer.id === this._current ? ' is-active' : '');
        btn.setAttribute('aria-pressed', layer.id === this._current ? 'true' : 'false');
        btn.addEventListener('click', () => this._switch(layer.id));
        el.appendChild(btn);
        return { id: layer.id, el: btn };
      });
      this._el = el;
      return el;
    }
    _switch(id) {
      if (id === this._current) return;
      const layer = this._layers.find((l) => l.id === id);
      if (!layer) return;
      this._current = id;
      this._map.setStyle(layer.style, { diff: false });
      this._buttons.forEach((b) => {
        const active = b.id === id;
        b.el.classList.toggle('is-active', active);
        b.el.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    }
    onRemove() {
      if (this._el && this._el.parentNode) this._el.parentNode.removeChild(this._el);
      this._map = undefined;
    }
  }

  // --- Boundary visibility toggle (one button per layer set) ------------
  // Boundary layers live inside both basemap styles (so they survive
  // setStyle), but visibility is per-layer layout that resets on style swap.
  // Re-apply on 'style.load'.

  const VIS_KEY_TOWNLANDS = 'jimmap_show_townlands';
  const VIS_KEY_PARISHES = 'jimmap_show_parishes';

  class BoundaryToggle {
    constructor(opts) {
      this._label = opts.label;
      this._layerIds = opts.layerIds;
      this._storageKey = opts.storageKey;
      const stored = lsGet(this._storageKey);
      this._visible = stored == null ? true : stored !== '0';
    }
    onAdd(map) {
      this._map = map;
      const el = document.createElement('div');
      el.className = 'maplibregl-ctrl maplibregl-ctrl-group base-layer-switcher boundary-toggle';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'base-layer-btn' + (this._visible ? ' is-active' : '');
      btn.setAttribute('aria-pressed', this._visible ? 'true' : 'false');
      btn.textContent = this._label;
      btn.addEventListener('click', () => this._toggle());
      el.appendChild(btn);
      this._btn = btn;
      this._el = el;

      this._reapply = () => this._applyVisibility();
      map.on('style.load', this._reapply);

      return el;
    }
    _toggle() {
      this._visible = !this._visible;
      this._btn.classList.toggle('is-active', this._visible);
      this._btn.setAttribute('aria-pressed', this._visible ? 'true' : 'false');
      lsSet(this._storageKey, this._visible ? '1' : '0');
      this._applyVisibility();
    }
    _applyVisibility() {
      if (!this._map) return;
      const value = this._visible ? 'visible' : 'none';
      this._layerIds.forEach((id) => {
        if (this._map.getLayer(id)) {
          this._map.setLayoutProperty(id, 'visibility', value);
        }
      });
    }
    onRemove() {
      if (this._map && this._reapply) this._map.off('style.load', this._reapply);
      if (this._el && this._el.parentNode) this._el.parentNode.removeChild(this._el);
      this._map = undefined;
    }
  }

  // --- Edit mode: user-placed pins --------------------------------------

  const USER_PIN_ICON = 'assets/icons/user-pin.svg';
  const USER_PIN_SIZE = [36, 42];
  const STORAGE_KEY = 'jimmap_user_pins';

  const userPins = new Map();
  let userPinSeq = 0;
  let editMode = false;
  let pendingLngLat = null;

  const editToggleBtn = document.getElementById('edit-toggle-btn');
  editToggleBtn.addEventListener('click', () => toggleEditMode());

  function setEditToggleActive(active) {
    editToggleBtn.classList.toggle('is-active', active);
    editToggleBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
    editToggleBtn.textContent = active ? 'Exit edit' : 'Edit';
  }

  function toggleEditMode(force) {
    const next = typeof force === 'boolean' ? force : !editMode;
    if (next === editMode) return;
    editMode = next;
    setEditToggleActive(editMode);
    document.getElementById('edit-mode-indicator').hidden = !editMode;
    if (editMode) {
      if (map.doubleClickZoom) map.doubleClickZoom.disable();
    } else {
      if (map.doubleClickZoom) map.doubleClickZoom.enable();
      closePinContextMenu();
    }
  }

  function persistUserPins() {
    try {
      const arr = Array.from(userPins.values()).map((p) => ({
        name: p.name,
        description: p.description,
        lat: p.lat,
        lng: p.lng
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    } catch (e) {
      console.warn('Could not save user pins to localStorage:', e);
    }
  }

  function restoreUserPins() {
    let raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (_) { return; }
    if (!raw) return;
    let arr;
    try {
      arr = JSON.parse(raw);
    } catch (e) {
      console.warn('Stored user pins were not valid JSON; clearing.', e);
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
      return;
    }
    if (!Array.isArray(arr)) return;
    arr.forEach((p) => {
      if (!p || typeof p.lng !== 'number' || typeof p.lat !== 'number') return;
      if (typeof p.name !== 'string' || !p.name.trim()) return;
      createUserPin({
        lng: p.lng,
        lat: p.lat,
        name: p.name,
        description: typeof p.description === 'string' ? p.description : '',
        skipPersist: true
      });
    });
  }

  function onMapDblClick(e) {
    if (!editMode) return;
    openEditPinModal(e.lngLat);
  }

  // --- Edit-pin modal ----------------------------------------------------

  const editpinModal = document.getElementById('editpin-modal');
  const editpinPanel = editpinModal.querySelector('.modal-panel');
  const editpinForm = document.getElementById('editpin-form');
  const editpinNameInput = document.getElementById('editpin-name');
  const editpinDescInput = document.getElementById('editpin-desc');
  let editpinPrevFocus = null;

  function openEditPinModal(lngLat) {
    pendingLngLat = lngLat;
    editpinNameInput.value = '';
    editpinDescInput.value = '';
    editpinPrevFocus = document.activeElement;
    editpinModal.hidden = false;
    requestAnimationFrame(() => editpinNameInput.focus());
    document.addEventListener('keydown', onEditpinKey);
  }

  function closeEditPinModal() {
    editpinModal.hidden = true;
    pendingLngLat = null;
    document.removeEventListener('keydown', onEditpinKey);
    if (editpinPrevFocus && typeof editpinPrevFocus.focus === 'function') {
      editpinPrevFocus.focus();
    }
  }

  function onEditpinKey(e) {
    if (e.key === 'Escape') closeEditPinModal();
  }

  editpinModal.addEventListener('click', (e) => {
    if (e.target.matches('[data-close]') || e.target.matches('[data-cancel]')) {
      closeEditPinModal();
    }
  });

  editpinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = editpinNameInput.value.trim();
    if (!name) {
      editpinNameInput.focus();
      return;
    }
    const description = editpinDescInput.value.trim();
    if (pendingLngLat) {
      createUserPin({
        lng: pendingLngLat.lng,
        lat: pendingLngLat.lat,
        name: name,
        description: description
      });
    }
    closeEditPinModal();
  });

  function createUserPin(opts) {
    const id = 'user-pin-' + (++userPinSeq);
    const el = document.createElement('div');
    el.className = 'map-pin map-pin-user';
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', 'User pin: ' + opts.name);
    el.title = opts.description ? opts.name + ' — ' + opts.description : opts.name;
    el.style.width = USER_PIN_SIZE[0] + 'px';
    el.style.height = USER_PIN_SIZE[1] + 'px';
    el.style.backgroundImage = 'url("' + USER_PIN_ICON + '")';
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPinContextMenu(e.clientX, e.clientY, id);
    });
    el.addEventListener('click', (e) => { e.stopPropagation(); });

    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([opts.lng, opts.lat])
      .addTo(map);

    userPins.set(id, {
      marker: marker,
      el: el,
      name: opts.name,
      description: opts.description,
      lng: opts.lng,
      lat: opts.lat
    });

    if (!opts.skipPersist) persistUserPins();
  }

  const pinContextEl = document.getElementById('pin-context');
  let pinContextId = null;

  function openPinContextMenu(x, y, id) {
    pinContextId = id;
    pinContextEl.hidden = false;
    const rect = pinContextEl.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 6;
    const maxY = window.innerHeight - rect.height - 6;
    pinContextEl.style.left = Math.max(6, Math.min(x, maxX)) + 'px';
    pinContextEl.style.top = Math.max(6, Math.min(y, maxY)) + 'px';
    document.addEventListener('mousedown', onOutsidePinContext, true);
    document.addEventListener('keydown', onPinContextKey);
  }

  function closePinContextMenu() {
    pinContextEl.hidden = true;
    pinContextId = null;
    document.removeEventListener('mousedown', onOutsidePinContext, true);
    document.removeEventListener('keydown', onPinContextKey);
  }

  function onOutsidePinContext(e) {
    if (!pinContextEl.contains(e.target)) closePinContextMenu();
  }

  function onPinContextKey(e) {
    if (e.key === 'Escape') closePinContextMenu();
  }

  pinContextEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn || !pinContextId) return;
    const action = btn.getAttribute('data-action');
    const pin = userPins.get(pinContextId);
    const id = pinContextId;
    closePinContextMenu();
    if (!pin) return;
    if (action === 'copy') {
      copyPinData(pin);
    } else if (action === 'delete') {
      pin.marker.remove();
      userPins.delete(id);
      persistUserPins();
    }
  });

  function formatPinText(pin) {
    const lng = Number(pin.lng).toFixed(7);
    const lat = Number(pin.lat).toFixed(7);
    const parts = [pin.name, lng + ', ' + lat];
    if (pin.description) parts.push(pin.description);
    return parts.join(' | ');
  }

  function copyPinData(pin) {
    const text = formatPinText(pin);
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (_) { /* best-effort */ }
      document.body.removeChild(ta);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(fallback);
    } else {
      fallback();
    }
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
      style: SATELLITE_STYLE,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      pitch: DEFAULT_PITCH,
      bearing: DEFAULT_BEARING,
      maxPitch: 75,
      hash: false,
      attributionControl: { compact: true }
    });

    map.addControl(
      new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }),
      'top-right'
    );
    map.addControl(
      new BaseLayerSwitcher(
        [
          { id: 'satellite', label: 'Satellite', style: SATELLITE_STYLE },
          { id: 'simple', label: 'Simple', style: SIMPLE_STYLE }
        ],
        'satellite'
      ),
      'top-right'
    );
    map.addControl(new BoundaryToggle({
      label: 'Townlands',
      layerIds: TOWNLAND_LAYER_IDS,
      storageKey: VIS_KEY_TOWNLANDS
    }), 'top-right');
    map.addControl(new BoundaryToggle({
      label: 'Parishes',
      layerIds: PARISH_LAYER_IDS,
      storageKey: VIS_KEY_PARISHES
    }), 'top-right');

    map.on('error', (e) => {
      console.error('[map error]', e && e.error ? e.error : e);
    });
    map.on('dblclick', onMapDblClick);

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
  restoreUserPins();
  attachTooltipHandlers(map);

  // After every style swap, re-apply visibility (handled by BoundaryToggle)
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
